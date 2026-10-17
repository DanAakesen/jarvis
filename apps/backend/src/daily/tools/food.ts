import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ConversationMessage } from '../../core/conversation-store.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import { exactLabelIntent, favoriteIntent } from '../nutrition/intent.js';
import { canonicalJson, prepareMeal, type FoodDefinition } from '../nutrition/model.js';
import type { NutritionStore } from '../nutrition/store.js';
import { resolveDailyOwner } from '../owner.js';
import { favoriteFingerprint, projectNutritionRecord } from '../records.js';

export type InternalNutrition = (request: FastifyRequest) => Pick<NutritionStore, 'intake' | 'lookupSaved' | 'log'>;

async function sourceMessage(request: FastifyRequest, signal: AbortSignal): Promise<ConversationMessage> {
  const direct = request.jarvisConversationMessage;
  if (direct?.role === 'dan' && request.principal && !request.agentPrincipal) return direct;
  const id = request.headers['x-jarvis-message-id'];
  if (!request.agentPrincipal || typeof id !== 'string' || !/^[1-9]\d{0,18}$/u.test(id) ||
      BigInt(id) > 9223372036854775807n || !request.server.conversationStore) {
    throw new ToolRefusal('A verified current Dan message is required for food logging.');
  }
  const page = await request.server.conversationStore.getHistory({ limit: 1 });
  signal.throwIfAborted();
  const message = page.messages[0];
  if (!message || message.id !== id || message.role !== 'dan') throw new ToolRefusal('The current food-log message could not be verified.');
  return message;
}

function receipt(row: Record<string, unknown>, key: string, sourceFingerprint: string, operation: string) {
  if (!row || typeof row.id !== 'string' || row.idempotency_key !== key || !/^[1-9]\d*$/u.test(String(row.revision ?? ''))) {
    throw new ToolFailure('The intake may have committed, but its receipt is unavailable. Retry this same message; do not create a new intake.');
  }
  if (row.deleted_at !== null) throw new ToolRefusal('This message previously logged an intake that was deleted. It was not recreated.');
  const provenance: unknown = typeof row.nutrient_provenance_json === 'string' ? JSON.parse(row.nutrient_provenance_json) : null;
  const origin: unknown = provenance && typeof provenance === 'object' && !Array.isArray(provenance)
    ? (provenance as Record<string, unknown>).jarvisIntake : null;
  if (!origin || typeof origin !== 'object' || Array.isArray(origin) ||
      (origin as Record<string, unknown>).sourceFingerprint !== sourceFingerprint ||
      (origin as Record<string, unknown>).operation !== operation) throw new ToolRefusal('This message has a different committed intake. Read it before correcting it; no new intake was logged.');
  return { status: 'committed', record: projectNutritionRecord(row, 'history') };
}

export function dailyFoodTool(nutrition: InternalNutrition, now: () => number = Date.now): JarvisTool {
  return {
    name: 'daily_food',
    description: 'Log intake only from the current verified Dan message. log_favorite derives the saved name/alias from an explicit "Log [my] [favourite] NAME" request; quantities come only from that owned favourite. log_exact derives all values from an explicit label such as "Log yoghurt: 200 kcal, protein 10 g, carbs 20 g". Supply only the operation: no food name, nutrients, IDs, dates or confirmation flags. No extra approval for these direct explicit requests. New photo/portion estimates, conditional/time-qualified requests and unsupported wording are refused. Repeating the same message cannot create another intake. No Health export.',
    inputSchema: {
      type: 'object',
      properties: { operation: { type: 'string', enum: ['log_exact', 'log_favorite'] } },
      required: ['operation'], additionalProperties: false,
    },
    sensitive: true,
    execute: async (raw, request, signal) => {
      const owner = resolveDailyOwner(request);
      if (request.dailyConnectorPrincipal) throw new ToolRefusal('Use the separate nutrition connector boundary for external clients.');
      signal.throwIfAborted();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolRefusal('Invalid food-log input.');
      const input = raw as Record<string, unknown>;
      if (Object.keys(input).some(key => key !== 'operation') ||
          typeof input.operation !== 'string' || !['log_exact', 'log_favorite'].includes(input.operation)) throw new ToolRefusal('Choose an exact label or saved favourite without extra authority or quantities.');
      const source = await sourceMessage(request, signal);
      if (!/^[1-9]\d{0,18}$/u.test(source.id) || BigInt(source.id) > 9223372036854775807n ||
          !source.sessionId || !Number.isFinite(source.at.getTime())) throw new ToolRefusal('The persisted food-log source is invalid.');
      const name = input.operation === 'log_favorite' ? favoriteIntent(source.text) : null;
      const exact = input.operation === 'log_exact' ? exactLabelIntent(source.text) : null;
      const digest = createHash('sha256').update(`${owner.toLowerCase()}:${source.sessionId}:${source.id}:daily-intake`).digest('hex');
      const key = `jarvis-message:${digest}`;
      const sourceFingerprint = createHash('sha256').update(canonicalJson({ text: source.text, at: source.at.toISOString() })).digest('hex');
      const store = nutrition(request);
      const existing = await store.intake(key, signal);
      if (existing) return receipt(existing, key, sourceFingerprint, input.operation);
      const clock = now();
      if (source.at.getTime() > clock + 300_000 || clock - source.at.getTime() > 600_000) throw new ToolRefusal('The food-log request is no longer current. No intake was logged.');
      const session = await request.server.conversationStore?.getSession(source.sessionId);
      signal.throwIfAborted();
      if (!session || session.id !== source.sessionId || session.channel === 'phone' || session.endedAt !== null) throw new ToolRefusal('An active verified chat or voice session is required for food logging.');
      let definition: FoodDefinition;
      let favorite: { id: string; fingerprint: string } | undefined;
      if (exact) definition = exact;
      else {
        const match = await store.lookupSaved(name!, signal);
        if (!match || match.source !== 'favorite') throw new ToolRefusal('The named owned favourite is missing or ambiguous. No history or provider fallback was logged.');
        const row = match.row;
        definition = {
          mealName: row.meal_name as string, mealType: row.meal_type as string | null,
          components: JSON.parse(row.components_json as string), provenance: JSON.parse(row.nutrient_provenance_json as string),
          confidence: row.confidence as FoodDefinition['confidence'], energyKcal: row.energy_kcal as number,
          proteinGrams: row.protein_grams as number | null, carbohydratesGrams: row.carbohydrates_grams as number | null,
          fatGrams: row.fat_grams as number | null, fiberGrams: row.fiber_grams as number | null,
        };
        if (typeof row.id !== 'string') throw new ToolFailure('The saved favourite could not be represented safely.');
        favorite = { id: row.id, fingerprint: favoriteFingerprint(row) };
      }
      const intake = prepareMeal({
        ...definition, id: digest, idempotencyKey: key, captureMethod: session.channel === 'voice' ? 'voice' : 'text',
        provenance: { ...definition.provenance, jarvisIntake: { sourceMessageId: source.id, sourceFingerprint, operation: input.operation, ...(favorite ? { favoriteId: favorite.id } : {}) } },
      }, source.at.toISOString());
      return receipt(await store.log(intake, {
        intent: 'log-intake', explicit: true, proposalRequired: false, estimateAccepted: favorite !== undefined,
        ...(favorite ? { favorite } : {}),
      }, signal), key, sourceFingerprint, input.operation);
    },
  };
}
