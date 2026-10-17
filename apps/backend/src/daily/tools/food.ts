import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ConversationMessage } from '../../core/conversation-store.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import { exactLabelIntent, favoriteIntent } from '../nutrition/intent.js';
import { canonicalJson, prepareMeal, type FoodDefinition } from '../nutrition/model.js';
import type { NutritionStore } from '../nutrition/store.js';
import { resolveDailyOwner } from '../owner.js';
import { favoriteFingerprint, projectNutritionRecord } from '../records.js';
import { activeDailySession as activeFoodSession, currentDailyMessage as foodSourceMessage } from './context.js';
export { activeDailySession as activeFoodSession, currentDailyMessage as foodSourceMessage, requireDailyReviewPresence as requireFoodReviewPresence } from './context.js';

type DirectNutrition = (request: FastifyRequest) => Pick<NutritionStore, 'intake' | 'lookupSaved' | 'log'>;
export type InternalNutrition = (request: FastifyRequest) => Pick<NutritionStore, 'intake' | 'lookupSaved' | 'log' | 'correct' | 'remove'>;

export function foodMessageIdentity(owner: string, source: ConversationMessage) {
  if (!/^[1-9]\d{0,18}$/u.test(source.id) || BigInt(source.id) > 9223372036854775807n ||
      !source.sessionId || !(source.at instanceof Date) || !Number.isFinite(source.at.getTime())) {
    throw new ToolRefusal('The persisted food-log source is invalid.');
  }
  const id = createHash('sha256').update(`${owner.toLowerCase()}:${source.sessionId}:${source.id}:daily-intake`).digest('hex');
  return { id, key: `jarvis-message:${id}`,
    sourceFingerprint: createHash('sha256').update(canonicalJson({ text: source.text, at: source.at.toISOString() })).digest('hex') };
}

export function foodReceipt(row: Record<string, unknown>, key: string, sourceFingerprint: string, operation: string, proposalFingerprint?: string) {
  if (!row || typeof row.id !== 'string' || row.idempotency_key !== key || !/^[1-9]\d*$/u.test(String(row.revision ?? ''))) {
    throw new ToolFailure('The intake may have committed, but its receipt is unavailable. Retry this same message; do not create a new intake.');
  }
  if (row.deleted_at !== null) throw new ToolRefusal('This message previously logged an intake that was deleted. It was not recreated.');
  const provenance: unknown = typeof row.nutrient_provenance_json === 'string' ? JSON.parse(row.nutrient_provenance_json) : null;
  const origin: unknown = provenance && typeof provenance === 'object' && !Array.isArray(provenance)
    ? (provenance as Record<string, unknown>).jarvisIntake : null;
  if (!origin || typeof origin !== 'object' || Array.isArray(origin) ||
      (origin as Record<string, unknown>).sourceFingerprint !== sourceFingerprint ||
      (origin as Record<string, unknown>).operation !== operation ||
      proposalFingerprint !== undefined && (origin as Record<string, unknown>).proposalFingerprint !== proposalFingerprint) throw new ToolRefusal('This message has a different committed intake. Read it before correcting it; no new intake was logged.');
  return { status: 'committed', record: projectNutritionRecord(row, 'history') };
}

export function dailyFoodTool(nutrition: DirectNutrition, now: () => number = Date.now): JarvisTool {
  return {
    name: 'daily_food',
    description: 'Log intake only from the current verified Dan message. log_favorite derives the saved name/alias from an explicit "Log [my] [favourite] NAME" request; quantities come only from that owned favourite. log_exact derives all values from an explicit label such as "Log yoghurt: 200 kcal, protein 10 g, carbs 20 g". Supply only the operation: no food name, nutrients, IDs, dates or confirmation flags. No extra approval for these direct explicit requests. New photo/portion estimates, conditional/time-qualified requests and unsupported wording are refused. Repeating the same message cannot create another intake. Active chat/browser voice only; no phone or Health export.',
    inputSchema: {
      type: 'object',
      properties: { operation: { type: 'string', enum: ['log_exact', 'log_favorite'] } },
      required: ['operation'], additionalProperties: false,
    },
    sensitive: true,
    denyOnPhone: true,
    execute: async (raw, request, signal) => {
      const owner = resolveDailyOwner(request);
      if (request.dailyConnectorPrincipal) throw new ToolRefusal('Use the separate nutrition connector boundary for external clients.');
      signal.throwIfAborted();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolRefusal('Invalid food-log input.');
      const input = raw as Record<string, unknown>;
      if (Object.keys(input).some(key => key !== 'operation') ||
          typeof input.operation !== 'string' || !['log_exact', 'log_favorite'].includes(input.operation)) throw new ToolRefusal('Choose an exact label or saved favourite without extra authority or quantities.');
      const source = await foodSourceMessage(request, signal);
      const { id: digest, key, sourceFingerprint } = foodMessageIdentity(owner, source);
      const name = input.operation === 'log_favorite' ? favoriteIntent(source.text) : null;
      const exact = input.operation === 'log_exact' ? exactLabelIntent(source.text) : null;
      const store = nutrition(request);
      const existing = await store.intake(key, signal);
      if (existing) return foodReceipt(existing, key, sourceFingerprint, input.operation);
      const session = await activeFoodSession(request, source, signal, now());
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
      let committed: Record<string, unknown>;
      try {
        committed = await store.log(intake, {
          intent: 'log-intake', explicit: true, proposalRequired: false, estimateAccepted: favorite !== undefined,
          ...(favorite ? { favorite } : {}),
        }, signal);
      } catch (error) {
        if (signal.aborted || !(error instanceof ToolRefusal || error instanceof ToolFailure)) throw error;
        const recovered = await store.intake(key, signal);
        if (!recovered) throw error;
        committed = recovered;
      }
      return foodReceipt(committed, key, sourceFingerprint, input.operation);
    },
  };
}
