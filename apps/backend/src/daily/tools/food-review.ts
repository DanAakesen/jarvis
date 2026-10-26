import { ToolFailure, ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import { prepareMeal, storedMeal, type MealInput } from '../nutrition/model.js';
import { exactLabelIntent, favoriteIntent } from '../nutrition/intent.js';
import { foodRecordRevision, foodReviewFingerprint, foodReviewInputSchema, foodReviewSchema, foodReviewSummary, nutritionSummary, hasFoodReview, reviewedCorrection } from '../nutrition/review.js';
import type { FridaLookup } from '../nutrition/frida.js';
import { dailyResultByteLimit, type DailyFoodLookup } from '../query.js';
import { resolveDailyOwner } from '../owner.js';
import { projectNutritionRecord } from '../records.js';
import { activeFoodSession, foodMessageIdentity, foodReceipt, foodSourceMessage, requireFoodReviewPresence, type InternalNutrition } from './food.js';

function optionalIntent<T>(parse: (text: string) => T, text: string): T | null {
  try { return parse(text); }
  catch (error) { if (error instanceof ToolRefusal) return null; throw error; }
}

function lookupReply(result: FridaLookup, status?: 'needs_details') {
  const presentation = `Estimated nutrition (Frida; not measured):\n${nutritionSummary(result.totals)}`;
  const response = status ? { status, lookup: result, intakeLogged: false, presentation } : { ...result, intakeLogged: false, presentation };
  if (Buffer.byteLength(JSON.stringify(response)) > dailyResultByteLimit) {
    throw new ToolRefusal('Food reference result exceeds the shared Health response limit. Request fewer components; no complete result is claimed.');
  }
  return response;
}

function reviewComponents(result: FridaLookup) {
  return result.components.map(({ input, match, unknowns }) => ({
    name: input.name, grams: input.grams, preparationMethod: input.preparationMethod,
    reference: match ? { foodId: match.foodId, name: match.name, values: match.values,
      provenance: match.provenance, retrievedAt: match.retrievedAt } : null,
    unknowns,
  }));
}

function needsFoodDetails(result: FridaLookup): boolean {
  return result.components.some(({ input, match }) => input.grams === null || !match) || result.totals.energyKcal === null;
}

export function dailyFoodReviewTool(nutrition: InternalNutrition, now: () => number = Date.now, lookup?: DailyFoodLookup): JarvisTool {
  const pending = new Set<string>();
  return {
    name: 'health_food_review',
    description: 'For food photos, use the existing image input only to propose generic food components and estimated grams; Frida is a nutrient reference, not image or portion recognition. Never describe estimates as measured. If an image is unreadable or not food, say so and ask for a clearer photo or description. If Frida fails, report that reference failure without guessing nutrition and offer a retry or text description. Use lookup_components with 1-25 {name, grams|null, preparationMethod|null} values to resolve references. Always present actual returned protein (g), calories (kcal) and fat (g) as a bulleted list, including for lookup-only estimates. Use the returned presentation; never stop at an acknowledgment. Show unknown nutrients as unknown, never zero or invented numbers. Present component/portion estimates and uncertainty and invite edits. Ask about missing quantities or preparation where needed. If identity, preparation or grams change, look up the edited components again. Then call log_estimate with referenceComponents and a mealName BEFORE inviting confirmation; the server re-resolves Frida, calculates totals and stages the exact proposal. A prose estimate or lookup alone does not stage approval. Nothing writes until Dan approves the exact proposal; his next natural text/browser-voice reply can approve the current pending estimate, or he can use Now. Never restage an estimate from an affirmative reply or treat historical agreement as approval. If no proposal is pending, prepare and stage a new proposal for a new confirmation; do not claim intake was logged. Report lookup estimates immediately; only claim intake was logged after a committed tool receipt. Never supply totals, provider provenance, capture method, owner or confirmation flags for a reference estimate. Use health_food for exact labels/favourites. Corrections/deletions require the exact owned intake key/current revision and Now approval. Present-mode browser chat/browser voice on desktop or mobile are supported; a mobile browser is NOT a telephone call. Telephone calls, Teams and Health export are unsupported.',
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
      if (change.operation === 'lookup_components') {
        if (!lookup) throw new ToolFailure('Food reference lookup is unavailable. No proposal or intake was created.');
        await activeFoodSession(request, source, signal, now());
        const result = lookupReply(await lookup(structuredClone(change.components), request, signal));
        request.server.nowEventHub?.publish({ type: 'food_estimate_result', sessionId: source.sessionId,
          sourceMessageId: source.id, summary: result.presentation });
        return result;
      }
      if (change.operation === 'log_estimate' && identity.hasPhoto && !change.food.referenceComponents) {
        throw new ToolRefusal('A food-photo estimate needs Frida-resolved components before it can be reviewed.');
      }
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
      const captureMethod = identity.hasPhoto
        ? session.channel === 'voice' ? 'mixed' : 'photo'
        : session.channel === 'voice' ? 'voice' : 'text';
      if (change.operation === 'log_estimate') {
        if (optionalIntent(exactLabelIntent, source.text)) throw new ToolRefusal('Use health_food log_exact for this explicit exact label; no extra approval is needed.');
        const name = optionalIntent(favoriteIntent, source.text);
        if (name && (await store.lookupSaved(name, signal))?.source === 'favorite') {
          throw new ToolRefusal('Use health_food log_favorite for this explicit saved favourite; no extra approval is needed.');
        }
      }
      await requireFoodReviewPresence(request, signal);
      const service = request.server.ownerInteractions;
      if (!service) throw new ToolRefusal('Dan’s Now approval service is unavailable. No food was changed.');
      const lock = `${owner.toLowerCase()}:${key}`;
      if (pending.has(lock)) throw new ToolRefusal('This food entry is already awaiting review. Resolve that proposal first.');
      if (pending.size >= 10) throw new ToolRefusal('There are too many pending food proposals. Resolve one first.');
      const operationSignal = signal;
      const requestTime = new Date(now()).toISOString();
      let after: MealInput | null;
      if (change.operation === 'log_estimate') {
        const { referenceComponents, ...food } = change.food;
        if (referenceComponents) {
          if (!lookup) throw new ToolFailure('Food reference lookup is unavailable. No intake was changed.');
          if (food.energyKcal !== undefined || food.proteinGrams !== null || food.carbohydratesGrams !== null ||
              food.fatGrams !== null || food.fiberGrams !== null || food.components.length > 0) {
            throw new ToolRefusal('Supply food identity, portion and preparation only; Frida totals and component provenance are server-derived.');
          }
          const reference = await lookup(structuredClone(referenceComponents), request, operationSignal);
          if (needsFoodDetails(reference)) {
            const result = lookupReply(reference, 'needs_details');
            request.server.nowEventHub?.publish({ type: 'food_estimate_result', sessionId: source.sessionId,
              sourceMessageId: source.id, summary: result.presentation });
            return result;
          }
          const totals = reference.totals;
          after = prepareMeal({
            ...food, components: reviewComponents(reference), energyKcal: totals.energyKcal!,
            proteinGrams: totals.proteinGrams, carbohydratesGrams: totals.carbohydratesGrams,
            fatGrams: totals.fatGrams, fiberGrams: totals.fiberGrams,
            occurredAt: food.occurredAt ?? source.at.toISOString(),
            id: identity.id, idempotencyKey: key, confidence: 'estimate', captureMethod,
            provenance: { source: 'frida-estimate', independentlyVerified: false, reference: reference.reference,
              matchedSubtotals: reference.matchedSubtotals, unknowns: reference.unknowns, jarvisIntake: origin },
          }, requestTime);
        } else {
          const energyKcal = food.energyKcal;
          if (typeof energyKcal !== 'number') throw new ToolRefusal('A calorie quantity or Frida-backed estimate is required.');
          after = prepareMeal({ ...food, occurredAt: food.occurredAt ?? source.at.toISOString(),
            energyKcal, id: identity.id, idempotencyKey: key, confidence: 'estimate', captureMethod,
            provenance: { source: 'jarvis-proposed', independentlyVerified: false, jarvisIntake: origin } }, requestTime);
        }
      } else after = change.operation === 'correct' ? reviewedCorrection(before!, change.changes, origin, requestTime) : null;
      const summary = foodReviewSummary(change.operation, before ? storedMeal(before) : null, after,
        change.operation === 'log_estimate' ? undefined : change.expectedRevision);
      if (change.operation === 'log_estimate') {
        const laterReplies = await request.server.conversationStore?.getDanMessagesAfter({
          sessionId: source.sessionId, after: source.id, limit: 1,
        });
        operationSignal.throwIfAborted();
        if (!laterReplies || laterReplies.length) throw new ToolRefusal('The food request was superseded while preparing the estimate. Review the current request; nothing was logged.');
      }
      if (pending.has(lock)) throw new ToolRefusal('This food entry is already awaiting review. Resolve that proposal first.');
      pending.add(lock);
      if (after && change.operation === 'log_estimate') {
        request.server.nowEventHub?.publish({ type: 'food_estimate_result', sessionId: source.sessionId,
          sourceMessageId: source.id, summary: `Estimated nutrition (not measured):\n${nutritionSummary(after)}` });
      }
      try {
        return await service.runConfirmed(change.operation === 'delete' ? 'delete' : 'other', summary, async () => {
          await requireFoodReviewPresence(request, operationSignal);
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
        }, operationSignal, { channel: 'browser', lifetimeSeconds: 120,
          ...(change.operation === 'log_estimate' ? { foodEstimate: { sessionId: source.sessionId, sourceMessageId: source.id } } : {}) });
      } finally { pending.delete(lock); }
    },
  };
}
