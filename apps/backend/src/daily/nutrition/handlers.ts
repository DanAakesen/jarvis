import type sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { ToolRefusal } from '../../core/tool-registry.js';
import { resolveDailyOwner } from '../owner.js';
import { copenhagenDate, prepareMeal, storedMeal, type FavoriteInput, type MealInput, type PlanRequest } from './model.js';
import { NutritionStore } from './store.js';
import type { FridaLookupAdapter, LookupComponent } from './frida.js';
import type { DailyChangeSink } from '../revisions.js';

/** P12-09 derives this from existing trusted user-intent/confirmation/evidence metadata.
 * Never deserialize it from client/model tool arguments or legacy userConfirmed.
 * Photo/portion proposals must retain proposalRequired independent of claimed confidence.
 */
export interface NutritionExecution {
  request: FastifyRequest; signal: AbortSignal; requestTime: string;
  intent: 'lookup' | 'log-intake' | 'correct-intake' | 'delete-intake' | 'save-favorite' | 'save-plan' | 'delete-plan' | 'set-feedback';
  explicit: boolean; proposalRequired: boolean; proposalAccepted: boolean;
  expectedRevision?: bigint; sourceRevision?: bigint; reviewedFavorites?: ReadonlyMap<string, string>;
}
type LogInput = Parameters<typeof prepareMeal>[0];
type Changes = Partial<Omit<MealInput,'id'|'idempotencyKey'|'expiresAt'>>;
function requireIntent(context: NutritionExecution, intent: NutritionExecution['intent']): void {
  resolveDailyOwner(context.request); context.signal.throwIfAborted();
  if (context.intent !== intent || context.explicit !== true || typeof context.proposalRequired !== 'boolean' || typeof context.proposalAccepted !== 'boolean' ||
      context.proposalRequired && context.proposalAccepted !== true) throw new ToolRefusal('Explicit authorized intent or acceptance of the displayed proposal is required.');
}
/** Reusable typed handlers, not a tool catalogue, router or new dispatcher. */
export function createNutritionHandlers(pool: sql.ConnectionPool, frida: FridaLookupAdapter, changes?: DailyChangeSink) {
  const store = (context: NutritionExecution) => NutritionStore.forRequest(pool, context.request, () => context.requestTime, changes);
  return {
    lookup: async (input: readonly LookupComponent[], context: NutritionExecution) => {
      resolveDailyOwner(context.request); if (context.intent !== 'lookup') throw new ToolRefusal('Lookup intent required.');
      return frida.lookup(input, context.signal);
    },
    lookupSaved: async (name: string, context: NutritionExecution) => store(context).lookupSaved(name, context.signal),
    favoriteRecords: async (ids: readonly string[], context: NutritionExecution) => store(context).favoriteRecords(ids, context.signal),
    preferences: async (keys: readonly string[], context: NutritionExecution) => store(context).preferences(keys, context.signal),
    planRecord: async (id: string, context: NutritionExecution) => store(context).planRecord(id, context.signal),
    intake: async (key: string, context: NutritionExecution) => store(context).intake(key, context.signal),
    log: async (input: LogInput, context: NutritionExecution) => {
      requireIntent(context, 'log-intake');
      return store(context).log(prepareMeal(input, context.requestTime), { intent: 'log-intake', explicit: context.explicit,
        proposalRequired: context.proposalRequired, estimateAccepted: context.proposalAccepted }, context.signal);
    },
    correct: async (input: { idempotencyKey: string; expectedRevision: bigint; changes: Changes }, context: NutritionExecution) => {
      requireIntent(context, 'correct-intake');
      if (Object.keys(input).some((key) => !['idempotencyKey','expectedRevision','changes'].includes(key)) || !input.changes ||
          Object.keys(input.changes).some((key) => !['mealName','mealType','components','provenance','occurredAt','mealDate','energyKcal','proteinGrams','carbohydratesGrams','fatGrams','fiberGrams','confidence','captureMethod'].includes(key))) throw new TypeError('Invalid intake correction');
      const persistence = store(context); const row = await persistence.intake(input.idempotencyKey, context.signal);
      if (!row) throw new ToolRefusal('Intake not found.');
      const saved = storedMeal(row); const changed = { ...saved, ...input.changes };
      if (input.changes.occurredAt !== undefined && input.changes.mealDate === undefined) {
        changed.mealDate = copenhagenDate(input.changes.occurredAt);
      }
      return persistence.correct(changed, input.expectedRevision, context.signal);
    },
    remove: async (key: string, expectedRevision: bigint, context: NutritionExecution) => {
      requireIntent(context, 'delete-intake'); return store(context).remove(key, expectedRevision, context.signal);
    },
    favorite: async (input: FavoriteInput, context: NutritionExecution) => {
      requireIntent(context, 'save-favorite'); return store(context).favorite(input, {
        explicit: context.explicit, estimateAccepted: context.proposalAccepted,
        ...(context.expectedRevision !== undefined ? { expectedRevision: context.expectedRevision } : {}),
        ...(context.sourceRevision !== undefined ? { sourceRevision: context.sourceRevision } : {}),
      }, context.signal);
    },
    plan: async (input: PlanRequest, expectedRevision: bigint, context: NutritionExecution) => {
      requireIntent(context, 'save-plan'); return store(context).savePlan(input, expectedRevision, context.signal, context.reviewedFavorites);
    },
    removePlan: async (id: string, expectedRevision: bigint, context: NutritionExecution) => {
      requireIntent(context, 'delete-plan'); return store(context).removePlan(id, expectedRevision, context.signal);
    },
    feedback: async (key: string, preference: 'like' | 'dislike' | null, expectedRevision: bigint, context: NutritionExecution) => {
      requireIntent(context, 'set-feedback');
      return store(context).feedback(key, preference, context.signal, expectedRevision, context.reviewedFavorites?.get(key));
    },
  };
}
