import { nutritionSummary } from '../nutrition/review.js';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ConversationAttachmentReference, ConversationMessage } from '../../core/conversation-store.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import { exactLabelIntent, favoriteIntent } from '../nutrition/intent.js';
import { canonicalJson, prepareMeal, type FoodDefinition } from '../nutrition/model.js';
import type { NutritionStore } from '../nutrition/store.js';
import { resolveDailyOwner } from '../owner.js';
import { favoriteFingerprint, projectNutritionRecord } from '../records.js';
import { activeDailySession as activeFoodSession, currentDailyMessage } from './context.js';
export { activeDailySession as activeFoodSession, requireDailyReviewPresence as requireFoodReviewPresence } from './context.js';

type DirectNutrition = (request: FastifyRequest) => Pick<NutritionStore, 'intake' | 'lookupSaved' | 'log'>;
export type InternalNutrition = (request: FastifyRequest) => Pick<NutritionStore, 'intake' | 'lookupSaved' | 'log' | 'correct' | 'remove'>;
type FoodSourceMessage = ConversationMessage & { readonly attachments?: readonly ConversationAttachmentReference[] };

export async function foodSourceMessage(request: FastifyRequest, signal: AbortSignal): Promise<FoodSourceMessage> {
  const source = await currentDailyMessage(request, signal) as FoodSourceMessage;
  if (request.agentPrincipal) return source;
  const store = request.server.conversationStore;
  const page = store?.getHistory ? await store.getHistory({ limit: 1 }) : undefined;
  signal.throwIfAborted();
  const persisted = page?.messages[0];
  if (persisted && persisted.id === source.id && persisted.sessionId === source.sessionId &&
      persisted.role === 'dan' && persisted.text === source.text && persisted.at instanceof Date &&
      persisted.at.getTime() === source.at.getTime()) return persisted;
  if (!Object.hasOwn(source, 'attachments')) return source;
  return { id: source.id, sessionId: source.sessionId, role: source.role, text: source.text, model: source.model,
    at: source.at, ...(source.metadata ? { metadata: source.metadata } : {}) };
}

function validSourceAttachment(attachment: ConversationAttachmentReference): boolean {
  if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(attachment.id) ||
      typeof attachment.name !== 'string' || !attachment.name.length || attachment.name.length > 255 ||
      typeof attachment.contentType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/u.test(attachment.contentType) ||
      !Number.isSafeInteger(attachment.size) || attachment.size < 1 ||
      attachment.size > (attachment.contentType.startsWith('image/') ? 10 : 20) * 1024 * 1024 ||
      attachment.contentType.startsWith('image/') && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(attachment.contentType)) return false;
  for (const character of attachment.name) {
    if (character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) return false;
  }
  return true;
}

function sourceAttachments(source: FoodSourceMessage): { fingerprint: { id: string; contentType: string; size: number }[]; hasPhoto: boolean } {
  const attachments = source.attachments;
  if (attachments === undefined) return { fingerprint: [], hasPhoto: false };
  if (!Array.isArray(attachments) || attachments.length > 5) throw new ToolRefusal('The persisted food-photo source is invalid.');
  const ids = new Set<string>();
  const images = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const fingerprint = attachments.map((attachment) => {
    if (!validSourceAttachment(attachment) || ids.has(attachment.id)) {
      throw new ToolRefusal('The persisted food-photo source is invalid.');
    }
    ids.add(attachment.id);
    return { id: attachment.id, contentType: attachment.contentType, size: attachment.size };
  });
  return { fingerprint, hasPhoto: fingerprint.some(attachment => images.has(attachment.contentType)) };
}

export function foodMessageIdentity(owner: string, source: ConversationMessage) {
  if (!/^[1-9]\d{0,18}$/u.test(source.id) || BigInt(source.id) > 9223372036854775807n ||
      !source.sessionId || !(source.at instanceof Date) || !Number.isFinite(source.at.getTime())) {
    throw new ToolRefusal('The persisted food-log source is invalid.');
  }
  const { fingerprint, hasPhoto } = sourceAttachments(source as FoodSourceMessage);
  const id = createHash('sha256').update(`${owner.toLowerCase()}:${source.sessionId}:${source.id}:daily-intake`).digest('hex');
  return { id, key: `jarvis-message:${id}`,
    sourceFingerprint: createHash('sha256').update(canonicalJson({ text: source.text, at: source.at.toISOString(),
      ...(fingerprint.length ? { attachments: fingerprint } : {}) })).digest('hex'), hasPhoto };
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
  const quantity = (key: string): number | null => typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] : null;
  return { status: 'committed', record: projectNutritionRecord(row, 'history'),
    presentation: `Logged nutrition:\n${nutritionSummary({ energyKcal: quantity('energy_kcal'),
      proteinGrams: quantity('protein_grams'), fatGrams: quantity('fat_grams'),
      carbohydratesGrams: quantity('carbohydrates_grams'), fiberGrams: quantity('fiber_grams') })}` };
}

export function dailyFoodTool(nutrition: DirectNutrition, now: () => number = Date.now): JarvisTool {
  return {
    name: 'health_food',
    description: 'Log intake only from the current verified Dan message. log_favorite derives the saved name/alias from an explicit "Log [my] [favourite] NAME" request; quantities come only from that owned favourite. log_exact derives all values from an explicit label such as "Log yoghurt: 200 kcal, protein 10 g, carbs 20 g". Supply only the operation: no food name, nutrients, IDs, dates or confirmation flags. No extra approval for these direct explicit requests. New photo/portion estimates, conditional/time-qualified requests and unsupported wording are refused. Repeating the same message cannot create another intake. Active browser chat/browser voice on desktop or mobile are supported; a mobile browser is NOT a telephone call. Telephone calls and Health export are unsupported.',
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
      const { id: digest, key, sourceFingerprint, hasPhoto } = foodMessageIdentity(owner, source);
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
        ...definition, id: digest, idempotencyKey: key,
        captureMethod: hasPhoto ? session.channel === 'voice' ? 'mixed' : 'photo' : session.channel === 'voice' ? 'voice' : 'text',
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
