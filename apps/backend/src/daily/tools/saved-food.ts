import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ToolFailure, ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import { canonicalJson, normalizeSearchText, preparePlan, storedMeal, type FavoriteInput, type PlanRequest } from '../nutrition/model.js';
import type { NutritionStore } from '../nutrition/store.js';
import { internalSavedInput, internalSavedInputSchema, savedChangeSchema, savedReadSchema } from '../nutrition/saved-schema.js';
import { foodRecordRevision } from '../nutrition/review.js';
import { resolveDailyOwner } from '../owner.js';
import { favoriteFingerprint, projectDailyRecord, projectNutritionRecord } from '../records.js';
import { activeFoodSession, foodMessageIdentity, foodSourceMessage, requireFoodReviewPresence } from './food.js';

export type InternalSavedNutrition = (request: FastifyRequest) => Pick<NutritionStore,
  'lookupSaved' | 'preferences' | 'intake' | 'findFavorite' | 'favorite' | 'favoriteRecords' |
  'findPlan' | 'planRecord' | 'savePlan' | 'removePlan' | 'feedback'>;
type Row = Record<string, unknown>;
type SavedKind = 'favorite' | 'plan' | 'feedback';
const nutrients = ['energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams'] as const;
const feedbackFields = ['meal_key', 'preference', 'revision', 'created_at', 'updated_at'];
function same(row: Row, desired: Row): boolean {
  return canonicalJson(projectDailyRecord(row, Object.keys(desired))) === canonicalJson(desired);
}
function display(row: Row | null, kind: SavedKind): Row | null {
  if (!row) return null;
  if (kind === 'feedback') return projectDailyRecord(row, feedbackFields);
  if (kind === 'favorite') return projectDailyRecord(row, [
    'id', 'favorite_name', 'aliases_json', 'meal_name', 'meal_type', 'components_json',
    ...nutrients, 'confidence', 'source_idempotency_key', 'revision',
  ]);
  const result: Row = projectDailyRecord(row, ['id', 'plan_name', 'description', ...nutrients, 'revision', 'deleted_at']);
  const value: unknown = typeof row.items_json === 'string' ? JSON.parse(row.items_json) : row.items_json;
  if (!Array.isArray(value)) throw new ToolFailure('The saved plan cannot be reviewed safely.');
  result.entries = value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ToolFailure('The saved plan cannot be reviewed safely.');
    return projectDailyRecord(entry as Row, ['slot', 'favoriteId', 'name', 'nutrients', 'components']);
  });
  return result;
}

export function dailySavedFoodTool(nutrition: InternalSavedNutrition, now: () => number = Date.now): JarvisTool {
  const pending = new Set<string>();
  return {
    name: 'daily_saved_food',
    description: 'Read owned saved food by exact name/alias (lookup_saved) or canonical favourite preferences (read_preferences). Save favourite/aliases from an owned intake or a proposed definition; save a plan from owned favourites; soft-delete a plan; set like/dislike/null feedback on an exact favourite. Reads need no review; every mutation needs the exact browser Now approval within two minutes. Read current revisions first (0 means new); plans require one breakfast, lunch and dinner. Never supply operation IDs, owners, confidence, provenance or confirmation flags. Writes require a current verified present chat/browser-voice source; no phone or Teams. Definitions/plans/preferences never log intake or export Health. Keep the same source and revision on retry.',
    inputSchema: internalSavedInputSchema,
    execution: {
      defaultEffect: 'unclassified',
      operation: {
        field: 'operation',
        effects: {
          lookup_saved: 'read', read_preferences: 'read', save_favorite: 'action',
          save_plan: 'action', delete_plan: 'action', set_feedback: 'action',
        },
      },
    },
    bodyLimit: 96 * 1024,
    sensitive: true,
    denyOnPhone: true,
    execute: async (raw, request, signal) => {
      signal = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
      const operationSignal = signal;
      const owner = resolveDailyOwner(request);
      if (request.dailyConnectorPrincipal) throw new ToolRefusal('Use the separate nutrition connector boundary for external clients.');
      signal.throwIfAborted();
      const parsed = internalSavedInput.safeParse(raw);
      if (!parsed.success) throw new ToolRefusal('Choose one bounded saved-food operation without authority or operation-ID fields.');
      const input = structuredClone(parsed.data);
      const store = nutrition(request);
      if (input.operation === 'lookup_saved' || input.operation === 'read_preferences') {
        const read = savedReadSchema.safeParse(input);
        if (!read.success) throw new ToolRefusal('Use only the selectors for the chosen saved-food read.');
        if (read.data.operation === 'lookup_saved') {
          const match = await store.lookupSaved(read.data.name, signal);
          return { status: match ? 'available' : 'empty', ...(match ? {
            source: match.source, record: projectNutritionRecord(match.row, match.source),
          } : {}), intakeLogged: false, provenance: { store: 'daily-sql' } };
        }
        const keys = [...new Set(read.data.favoriteIds)];
        const rows = await store.preferences(keys, signal);
        return { records: keys.map(key => {
          const row = rows.find(row => row.meal_key === key);
          return { favoriteId: key, status: row ? row.preference === null ? 'cleared' : 'available' : 'not-set',
            revision: row ? String(foodRecordRevision(row)) : '0', preference: row?.preference ?? null };
        }), provenance: { store: 'daily-sql' } };
      }
      const source = structuredClone(await foodSourceMessage(request, signal));
      await activeFoodSession(request, source, signal, now());
      await requireFoodReviewPresence(request, signal);
      const identity = foodMessageIdentity(owner, source);
      const operationId = createHash('sha256').update(`${identity.id}:${input.operation}:daily-saved`).digest('hex');
      const changeResult = savedChangeSchema.safeParse({ change: {
        ...input,
        ...(['save_favorite', 'save_plan'].includes(input.operation) ? { operationId } : {}),
        ...(input.definition ? { definition: { ...input.definition, confidence: 'estimate' } } : {}),
      } });
      if (!changeResult.success) throw new ToolRefusal('Use only the exact fields and current revision for this saved-food change.');
      const change = changeResult.data.change;
      const expected = BigInt(change.expectedRevision);
      let kind: SavedKind;
      let before: Row | null;
      let desired: Row;
      let target: string;
      let details: Row | undefined;
      let commit: () => Promise<Row>;
      let readBack: () => Promise<Row | null>;
      if (change.operation === 'save_favorite') {
        kind = 'favorite';
        const sourceRow = change.sourceIdempotencyKey ? await store.intake(change.sourceIdempotencyKey, signal) : null;
        if (change.sourceIdempotencyKey && (!sourceRow || sourceRow.deleted_at !== null)) throw new ToolRefusal('The exact owned source intake is unavailable.');
        const savedSource = sourceRow ? structuredClone(sourceRow) : null;
        before = structuredClone(await store.findFavorite(change.name, signal));
        const definition = savedSource ? storedMeal(savedSource) : {
          ...change.definition!, provenance: { source: 'jarvis-saved-proposal', independentlyVerified: false,
            jarvisSaved: { sourceFingerprint: identity.sourceFingerprint,
              proposalFingerprint: createHash('sha256').update(canonicalJson(change)).digest('hex') } },
        };
        const favorite: FavoriteInput = {
          id: before ? String(before.id) : operationId, name: change.name, aliases: change.aliases,
          ...(change.sourceIdempotencyKey ? { sourceIdempotencyKey: change.sourceIdempotencyKey } : { definition }),
        };
        desired = {
          favorite_name: change.name, normalized_name: normalizeSearchText(change.name),
          aliases_json: [...new Set(change.aliases)], meal_name: definition.mealName, meal_type: definition.mealType,
          components_json: definition.components, energy_kcal: definition.energyKcal, protein_grams: definition.proteinGrams,
          carbohydrates_grams: definition.carbohydratesGrams, fat_grams: definition.fatGrams, fiber_grams: definition.fiberGrams,
          confidence: definition.confidence, nutrient_provenance_json: definition.provenance,
          source_meal_id: savedSource?.id ?? null, source_idempotency_key: savedSource?.idempotency_key ?? null,
        };
        target = `favorite:${before ? String(before.id) : normalizeSearchText(change.name)}`;
        details = savedSource ? { sourceIntake: projectDailyRecord(savedSource, ['idempotency_key', 'revision', 'occurred_at', 'meal_date']) } : undefined;
        commit = () => store.favorite(favorite, { explicit: true, estimateAccepted: true, expectedRevision: expected,
          ...(savedSource ? { sourceRevision: foodRecordRevision(savedSource) } : {}) }, operationSignal);
        readBack = () => store.findFavorite(change.name, operationSignal);
      } else if (change.operation === 'save_plan') {
        kind = 'plan';
        if (['breakfast', 'lunch', 'dinner'].some(slot => change.entries.filter(entry => entry.slot === slot).length !== 1)) {
          throw new ToolRefusal('A plan requires exactly one breakfast, lunch and dinner, plus optional snacks.');
        }
        before = structuredClone(await store.findPlan(change.name, signal));
        const favorites = structuredClone(await store.favoriteRecords([...new Set(change.entries.map(entry => entry.favoriteId))], signal));
        const plan: PlanRequest = { id: before ? String(before.id) : operationId, name: change.name, description: change.description, entries: change.entries };
        const snapshot = preparePlan(plan, favorites);
        desired = { plan_name: plan.name, normalized_name: normalizeSearchText(plan.name), description: plan.description,
          items_json: snapshot.items, energy_kcal: snapshot.energyKcal, protein_grams: snapshot.proteinGrams,
          carbohydrates_grams: snapshot.carbohydratesGrams, fat_grams: snapshot.fatGrams, fiber_grams: snapshot.fiberGrams,
          deleted_at: null };
        target = `plan:${before ? String(before.id) : normalizeSearchText(change.name)}`;
        const fingerprints = new Map(favorites.map(row => [String(row.id), favoriteFingerprint(row)]));
        commit = () => store.savePlan(plan, expected, operationSignal, fingerprints);
        readBack = () => store.findPlan(change.name, operationSignal);
      } else if (change.operation === 'delete_plan') {
        kind = 'plan';
        before = structuredClone(await store.planRecord(change.id, signal));
        if (!before) throw new ToolRefusal('The exact owned plan was not found.');
        desired = projectNutritionRecord(before, 'plan');
        for (const field of ['revision', 'deleted_at', 'created_at', 'updated_at']) delete desired[field];
        target = `plan:${change.id}`;
        commit = () => store.removePlan(change.id, expected, operationSignal);
        readBack = () => store.planRecord(change.id, operationSignal);
      } else {
        kind = 'feedback';
        const favorite = structuredClone((await store.favoriteRecords([change.favoriteId], signal))[0]);
        if (!favorite || favorite.id !== change.favoriteId) throw new ToolRefusal('The exact owned favourite was not found.');
        before = structuredClone((await store.preferences([change.favoriteId], signal)).find(row => row.meal_key === change.favoriteId) ?? null);
        desired = { meal_key: change.favoriteId, preference: change.preference };
        target = `feedback:${change.favoriteId}`;
        details = { favorite: display(favorite, 'favorite') };
        const fingerprint = favoriteFingerprint(favorite);
        commit = () => store.feedback(change.favoriteId, change.preference, operationSignal, expected, fingerprint);
        readBack = async () => (await store.preferences([change.favoriteId], operationSignal)).find(row => row.meal_key === change.favoriteId) ?? null;
      }
      const matches = (row: Row | null): row is Row => !!row && same(row, desired) &&
        (kind === 'feedback' || !before || row.id === before.id) &&
        (change.operation === 'delete_plan' ? typeof row.deleted_at === 'string' && Number.isFinite(Date.parse(row.deleted_at)) : kind !== 'plan' || row.deleted_at === null);
      const receipt = (row: Row, replay: boolean) => {
        const revision = foodRecordRevision(row);
        if (!matches(row) || revision !== expected && revision !== expected + 1n ||
            kind !== 'feedback' && (typeof row.id !== 'string' || !row.id) ||
            change.operation === 'delete_plan' && revision !== expected + 1n) {
          throw new ToolFailure('The saved-food change may have committed, but its exact receipt is unavailable. Read the saved record; do not retry with a new source or revision.');
        }
        return { status: replay ? change.operation === 'delete_plan' ? 'already-deleted' : 'already-applied' : 'committed',
          operation: change.operation, record: kind === 'feedback' ? projectDailyRecord(row, feedbackFields) : projectNutritionRecord(row, kind) };
      };
      if (before && foodRecordRevision(before) === expected + 1n && matches(before)) return receipt(before, true);
      if ((before ? foodRecordRevision(before) : 0n) !== expected || kind === 'plan' && before?.deleted_at !== undefined && before.deleted_at !== null) {
        throw new ToolRefusal('The saved record changed or was deleted. Read its current revision before reviewing it.');
      }
      const summary = `Review this exact saved-food change in Now. Nothing has changed. Definitions and plans are not eaten food. No intake or Apple Health write. Proposed definitions remain estimates.\n${JSON.stringify({
        operation: change.operation, expectedRevision: change.expectedRevision, before: display(before, kind),
        after: change.operation === 'delete_plan' ? { deleted: true } : display({ ...desired, ...(before ? { id: before.id } : {}) }, kind),
        ...details, units: { energy: 'kcal', macros: 'g', unknown: null },
      }, null, 2)}`;
      if (summary.length > 4000) throw new ToolRefusal('This saved-food proposal is too large to review safely. Use a smaller change.');
      const service = request.server.ownerInteractions;
      if (!service) throw new ToolRefusal('Now approval is unavailable. No saved food was changed.');
      const lock = `${owner.toLowerCase()}:${target}`;
      if (pending.has(lock) || pending.size >= 10) throw new ToolRefusal('This saved-food target is already pending, or the review queue is full. Resolve the existing reviews first.');
      pending.add(lock);
      try {
        return await service.runConfirmed(change.operation === 'delete_plan' ? 'delete' : 'other', summary, async () => {
          await requireFoodReviewPresence(request, operationSignal);
          await activeFoodSession(request, source, operationSignal, now());
          operationSignal.throwIfAborted();
          let row: Row;
          try { row = await commit(); }
          catch (error) {
            if (operationSignal.aborted || !(error instanceof ToolRefusal || error instanceof ToolFailure)) throw error;
            const recovered = await readBack();
            if (!matches(recovered) || foodRecordRevision(recovered) !== expected + 1n) throw error;
            row = recovered;
          }
          return receipt(row, false);
        }, operationSignal, { channel: 'browser', lifetimeSeconds: 120 });
      } finally { pending.delete(lock); }
    },
  };
}
