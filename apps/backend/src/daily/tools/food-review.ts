import type { FastifyRequest } from 'fastify';
import { ToolFailure, ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import { prepareMeal, storedMeal, type MealInput } from '../nutrition/model.js';
import { exactLabelIntent, favoriteIntent } from '../nutrition/intent.js';
import { foodRecordRevision, foodReviewFingerprint, foodReviewInputSchema, foodReviewSchema, foodReviewSummary, hasFoodReview, reviewedCorrection } from '../nutrition/review.js';
import { resolveDailyOwner } from '../owner.js';
import { projectNutritionRecord } from '../records.js';
import { activeFoodSession, foodMessageIdentity, foodReceipt, foodSourceMessage, type InternalNutrition } from './food.js';

function optionalIntent<T>(parse: (text: string) => T, text: string): T | null {
  try { return parse(text); }
  catch (error) { if (error instanceof ToolRefusal) return null; throw error; }
}

async function requirePresent(request: FastifyRequest, signal: AbortSignal) {
  try {
    if (!request.server.awayModeStore || (await request.server.awayModeStore.read()).mode !== 'present') {
      throw new ToolRefusal('Food review requires Dan to be present and approve the exact proposal in Now.');
    }
    signal.throwIfAborted();
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof ToolRefusal) throw error;
    throw new ToolRefusal('Presence is unavailable. No food change was authorised.');
  }
}

export function dailyFoodReviewTool(nutrition: InternalNutrition, now: () => number = Date.now): JarvisTool {
  const pending = new Set<string>();
  return {
    name: 'daily_food_review',
    description: 'Review an estimated eaten meal, correction or soft deletion using the existing Now approval, with a two-minute review window. Nothing writes until Dan approves the exact displayed proposal. Use daily_food instead for direct exact labels or saved favourites; those must not gain redundant approval. Read the exact owned intake key/current revision before correction/deletion. Nutrient/component proposals remain estimates, never independently verified. Supply no owner, capture method, provenance, confidence or confirmation flags. Present-mode chat/voice only; no phone, Teams, Health export or claim that a spoken yes has approved the Now card.',
    inputSchema: foodReviewInputSchema,
    bodyLimit: 96 * 1024,
    sensitive: true,
    denyOnPhone: true,
    execute: async (raw, request, signal) => {
      signal = AbortSignal.any([signal, AbortSignal.timeout(3 * 60_000)]);
      const owner = resolveDailyOwner(request);
      if (request.dailyConnectorPrincipal) throw new ToolRefusal('Use the separate nutrition connector boundary for external clients.');
      signal.throwIfAborted();
      const parsed = foodReviewSchema.safeParse(raw);
      if (!parsed.success) throw new ToolRefusal('Choose a bounded food estimate, correction or deletion without authority flags.');
      const change = structuredClone(parsed.data.change);
      const source = structuredClone(await foodSourceMessage(request, signal));
      const identity = foodMessageIdentity(owner, source);
      const origin = { sourceMessageId: source.id, sourceFingerprint: identity.sourceFingerprint,
        operation: change.operation, proposalFingerprint: foodReviewFingerprint(change, identity.sourceFingerprint) };
      const key = change.operation === 'log_estimate' ? identity.key : change.idempotencyKey;
      const store = nutrition(request);
      const selected = await store.intake(key, signal);
      const before = selected ? structuredClone(selected) : null;
      if (change.operation === 'log_estimate' && before) return foodReceipt(before, key, identity.sourceFingerprint, change.operation, origin.proposalFingerprint);
      const expected = change.operation === 'log_estimate' ? null : BigInt(change.expectedRevision);
      const replayedChange = (row: Record<string, unknown> | null) => {
        if (!row || change.operation === 'log_estimate') return null;
        if (row.idempotency_key !== key) throw new ToolFailure('The stored intake does not match the reviewed exact key.');
        const revision = foodRecordRevision(row);
        if (change.operation === 'correct' && row.deleted_at === null && revision === expected! + 1n && hasFoodReview(row, origin)) {
          return { status: 'committed', operation: change.operation, record: projectNutritionRecord(row, 'history') };
        }
        if (change.operation === 'delete' && row.deleted_at !== null && revision === expected! + 1n) {
          return { status: 'already-deleted', operation: change.operation, record: projectNutritionRecord(row, 'history') };
        }
        return null;
      };
      if (change.operation !== 'log_estimate') {
        if (!before) throw new ToolRefusal('The exact owned intake was not found.');
        const replay = replayedChange(before);
        if (replay) return replay;
        const revision = foodRecordRevision(before);
        if (before.deleted_at !== null || revision !== expected) throw new ToolRefusal('The intake changed. Read its current revision before reviewing a change.');
      }
      const session = await activeFoodSession(request, source, signal, now());
      if (change.operation === 'log_estimate') {
        if (optionalIntent(exactLabelIntent, source.text)) throw new ToolRefusal('Use daily_food log_exact for this explicit exact label; no extra approval is needed.');
        const name = optionalIntent(favoriteIntent, source.text);
        if (name && (await store.lookupSaved(name, signal))?.source === 'favorite') {
          throw new ToolRefusal('Use daily_food log_favorite for this explicit saved favourite; no extra approval is needed.');
        }
      }
      await requirePresent(request, signal);
      const service = request.server.teamsNotifications;
      if (!service) throw new ToolRefusal('Dan’s Now approval service is unavailable. No food was changed.');
      const lock = `${owner.toLowerCase()}:${key}`;
      if (pending.has(lock)) throw new ToolRefusal('This food entry is already awaiting review. Resolve that proposal first.');
      if (pending.size >= 10) throw new ToolRefusal('There are too many pending food proposals. Resolve one first.');
      const operationSignal = signal;
      const requestTime = new Date(now()).toISOString();
      let after: MealInput | null;
      if (change.operation === 'log_estimate') {
        after = prepareMeal({ ...change.food, occurredAt: change.food.occurredAt ?? source.at.toISOString(),
          id: identity.id, idempotencyKey: key, confidence: 'estimate', captureMethod: session.channel === 'voice' ? 'voice' : 'text',
          provenance: { source: 'jarvis-proposed', independentlyVerified: false, jarvisIntake: origin } }, requestTime);
      } else after = change.operation === 'correct' ? reviewedCorrection(before!, change.changes, origin, requestTime) : null;
      const summary = foodReviewSummary(change.operation, before ? storedMeal(before) : null, after,
        change.operation === 'log_estimate' ? undefined : change.expectedRevision);
      pending.add(lock);
      try {
        return await service.runConfirmed(change.operation === 'delete' ? 'delete' : 'other', summary, async () => {
          await requirePresent(request, operationSignal);
          operationSignal.throwIfAborted();
          const current = await store.intake(key, operationSignal);
          const replay = replayedChange(current);
          if (replay) return replay;
          if (change.operation !== 'log_estimate' && (!current || current.deleted_at !== null || foodRecordRevision(current) !== expected)) {
            throw new ToolRefusal('The reviewed intake changed while approval was pending. Review the latest revision; nothing was changed by this call.');
          }
          let row: Record<string, unknown>;
          try {
            row = change.operation === 'log_estimate'
              ? await store.log(after!, { intent: 'log-intake', explicit: true, proposalRequired: true, estimateAccepted: true }, operationSignal)
              : change.operation === 'correct' ? await store.correct(after!, expected!, operationSignal)
                : await store.remove(key, expected!, operationSignal);
          } catch (error) {
            if (operationSignal.aborted || !(error instanceof ToolRefusal || error instanceof ToolFailure)) throw error;
            const recovered = await store.intake(key, operationSignal);
            if (!recovered) throw error;
            if (change.operation !== 'log_estimate' && (foodRecordRevision(recovered) !== expected! + 1n ||
                (change.operation === 'delete' ? recovered.deleted_at === null : recovered.deleted_at !== null || !hasFoodReview(recovered, origin)))) throw error;
            row = recovered;
          }
          if (change.operation === 'log_estimate') return foodReceipt(row, key, identity.sourceFingerprint, change.operation, origin.proposalFingerprint);
          if (row.idempotency_key !== key || foodRecordRevision(row) !== expected! + 1n ||
              (change.operation === 'delete' ? row.deleted_at === null : row.deleted_at !== null || !hasFoodReview(row, origin))) {
            throw new ToolFailure('The food change may have committed, but its receipt is unavailable. Read this exact intake before retrying.');
          }
          return { status: 'committed', operation: change.operation, record: projectNutritionRecord(row, 'history') };
        }, operationSignal, { channel: 'browser', lifetimeSeconds: 120 });
      } finally { pending.delete(lock); }
    },
  };
}
