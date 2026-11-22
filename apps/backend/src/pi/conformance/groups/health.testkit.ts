import { expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { healthQuerySources as sources } from '@jarvis/contracts';
import type { ConversationStore } from '../../../core/conversation-store.js';
import { AuthenticationDenied } from '../../../auth/verify.js';
import { createHealthModules } from '../../../health/index.js';
import { FridaLookupAdapter } from '../../../health/nutrition/frida.js';
import type { NutritionSuggestionSources } from '../../../health/nutrition/suggestion-adapter.js';
import type { NutritionTargetsAccess } from '../../../health/nutrition/targets-store.js';
import { resolveHealthBrowserOwner, resolveHealthConversationOwner, resolveHealthOwner } from '../../../health/owner.js';
import { HealthQueryService, type HealthData, type HealthFoodLookup, type HealthReaders } from '../../../health/query.js';
import { createHealthChanges } from '../../../health/revisions.js';
import type { TrainingTargetsAccess } from '../../../health/training/targets-store.js';
import type { BackendModule } from '../../../modules.js';
import type { ConformanceGroup, GroupFactory, Scenario, ToolCase } from '../types.testkit.js';
import { FakeBriefs, FakeCoach, FakeHealthReadModel, FakeLifts, FakeTrainingTargets, FakeWorkouts, localTime, seededIds, shiftDay, today } from './health-data.testkit.js';
import { FakeNutrition, FakeNutritionTargets, fridaStubFetch } from './health-nutrition.testkit.js';

/** Exact intake keys the cases address (corrections, deletions, favourites made from an intake). */
const seedKeys = {
  lunch: 'jarvis-message:seed-lunch-correct',
  snack: 'jarvis-message:seed-snack-delete',
  dinner: 'jarvis-message:seed-dinner-favorite',
} as const;

/**
 * A stored Dan message keeps the time it was stored at. The shared conversation fake stamps "now" on every read, which would make a
 * repeated message look like a different one to the intake receipt (its fingerprint covers the text and the time), so the Health
 * tools see each message at the first time it was read. (`ownerInteractions` and `workspaceCommands` come from the core group.)
 */
function withStoredMessageTimes(module: BackendModule): BackendModule {
  const storedAt = new Map<string, Date>();
  const stableTimes = (store: ConversationStore): ConversationStore => new Proxy(store, {
    get: (target, property) => property !== 'getHistory' ? Reflect.get(target, property, target) : async (...args: Parameters<ConversationStore['getHistory']>) => {
      const page = await target.getHistory(...args);
      return { ...page, messages: page.messages.map((message) => {
        if (!storedAt.has(message.id)) storedAt.set(message.id, message.at);
        return { ...message, at: storedAt.get(message.id)! };
      }) };
    },
  });
  const seenThroughStore = (request: FastifyRequest): FastifyRequest => {
    const store = request.server.conversationStore;
    if (!store) return request;
    const server = new Proxy(request.server, { get: (target, property) => property === 'conversationStore' ? stableTimes(store) : Reflect.get(target, property, target) });
    return new Proxy(request, { get: (target, property) => property === 'server' ? server : Reflect.get(target, property, target) });
  };
  return { ...module, tools: module.tools.map((tool) => ({ ...tool, execute: (input, request, signal) => tool.execute(input, seenThroughStore(request), signal) })) };
}

/** Health as production composes it (`composeHealth`), over in-memory stores and a stubbed Frida service. */
function composeHealthModule(context: Parameters<GroupFactory>[0]) {
  const owner = context.owner;
  const changes = createHealthChanges();
  const owned = (request: FastifyRequest) => {
    if (resolveHealthOwner(request).toLowerCase() !== owner.toLowerCase()) throw new AuthenticationDenied(403);
  };
  const day = today();
  const at = (ago: number, time: string) => localTime(shiftDay(day, -ago), time);

  const readModel = new FakeHealthReadModel();
  const nutritionStore = new FakeNutrition(context, changes);
  const workoutStore = new FakeWorkouts(context, changes);
  const liftStore = new FakeLifts(context, changes, workoutStore);
  const trainingTargetStore = new FakeTrainingTargets({ gymSessionsPerWeek: 3, runSessionsPerWeek: 2, dailySteps: 10_000 });
  const nutritionTargetStore = new FakeNutritionTargets({ restingKcal: 2700, deficitKcal: 300, proteinGrams: 150 });
  const coachStore = new FakeCoach();
  const briefStore = new FakeBriefs();

  // Dan's saved food, what he ate today and yesterday, and the intakes the cases correct, delete and save as favourites.
  nutritionStore.seedFavorite({ id: 'fav-protein-shake', name: 'Protein shake', aliases: ['proteinshake'], meal: 'Protein shake', type: 'snack', energyKcal: 260, proteinGrams: 38, carbohydratesGrams: 18, fatGrams: 4, fiberGrams: 1,
    components: [{ name: 'whey protein', grams: 30 }, { name: 'milk', grams: 300 }] });
  nutritionStore.seedFavorite({ id: 'fav-oatmeal', name: 'Oatmeal with berries', aliases: ['oatmeal'], meal: 'Oatmeal with berries', type: 'breakfast', energyKcal: 420, proteinGrams: 22, carbohydratesGrams: 58, fatGrams: 9, fiberGrams: 9 });
  nutritionStore.seedFavorite({ id: 'fav-chicken-rice', name: 'Chicken and rice', aliases: ['chicken rice bowl'], meal: 'Chicken and rice', type: 'lunch', energyKcal: 640, proteinGrams: 48, carbohydratesGrams: 70, fatGrams: 14, fiberGrams: 4 });
  nutritionStore.seedFavorite({ id: 'fav-salmon', name: 'Salmon with potatoes', aliases: [], meal: 'Salmon with potatoes', type: 'dinner', energyKcal: 710, proteinGrams: 42, carbohydratesGrams: 55, fatGrams: 32, fiberGrams: 6 });
  nutritionStore.seedPlan({ id: 'plan-rest-day', name: 'Rest day', description: 'A lighter day without training.', entries: [
    { slot: 'breakfast', favoriteId: 'fav-oatmeal' }, { slot: 'lunch', favoriteId: 'fav-chicken-rice' }, { slot: 'dinner', favoriteId: 'fav-salmon' }] });
  nutritionStore.seedMeal({ key: 'jarvis-message:seed-breakfast-today', name: 'Oatmeal with berries', type: 'breakfast', occurredAt: localTime(day, '07:40'), energyKcal: 420, proteinGrams: 22, carbohydratesGrams: 58, fatGrams: 9, fiberGrams: 9 });
  nutritionStore.seedMeal({ key: 'jarvis-message:seed-skyr-today', name: 'Skyr with banana', type: 'snack', occurredAt: localTime(day, '10:15'), energyKcal: 190, proteinGrams: 24, carbohydratesGrams: 22, fatGrams: 1, fiberGrams: 2 });
  nutritionStore.seedMeal({ key: seedKeys.lunch, name: 'Chicken and rice', type: 'lunch', occurredAt: at(1, '12:30'), energyKcal: 640, proteinGrams: 48, carbohydratesGrams: 70, fatGrams: 14, fiberGrams: 4 });
  nutritionStore.seedMeal({ key: seedKeys.snack, name: 'Handful of almonds', type: 'snack', occurredAt: at(1, '15:45'), energyKcal: 170, proteinGrams: 6, carbohydratesGrams: 6, fatGrams: 15, fiberGrams: 3 });
  nutritionStore.seedMeal({ key: seedKeys.dinner, name: 'Salmon, potatoes and broccoli', type: 'dinner', occurredAt: at(1, '18:40'), energyKcal: 710, proteinGrams: 42, carbohydratesGrams: 55, fatGrams: 32, fiberGrams: 6,
    components: [{ name: 'salmon', grams: 150 }, { name: 'potatoes', grams: 250 }] });

  // Dan's lifts and sessions in the app's own log: a week of training.
  workoutStore.seed({ id: seededIds.chestSession, type: 'chest_triceps_core', startedAt: at(2, '17:30'), durationMinutes: 62, note: 'Chest day' });
  workoutStore.seed({ id: seededIds.cardioSession, type: 'cardio', startedAt: at(1, '17:30'), durationMinutes: 45, note: 'Easy run' });
  workoutStore.seed({ id: seededIds.sessionToEdit, type: 'legs_core', startedAt: at(4, '17:30'), durationMinutes: 55 });
  workoutStore.seed({ id: seededIds.sessionToDelete, type: 'other', title: 'Football', startedAt: at(5, '19:00'), durationMinutes: 60 });
  liftStore.seed({ id: seededIds.benchPress, name: 'Bench press', weightKg: 80, reps: 5, sets: 3, performedAt: at(2, '17:50'), workoutId: seededIds.chestSession });
  liftStore.seed({ name: 'Overhead press', weightKg: 45, reps: 8, sets: 3, performedAt: at(2, '18:15'), workoutId: seededIds.chestSession });
  liftStore.seed({ name: 'Squat', weightKg: 100, reps: 5, sets: 5, performedAt: at(4, '17:50') });
  liftStore.seed({ name: 'Deadlift', weightKg: 120, reps: 3, sets: 3, performedAt: at(6, '17:50') });
  liftStore.seed({ id: seededIds.lateralRaise, name: 'Lateral raise', weightKg: 10, reps: 12, sets: 3, performedAt: at(5, '18:20') });
  liftStore.seed({ id: seededIds.cableCurl, name: 'Cable curl', weightKg: 25, reps: 10, sets: 3, performedAt: at(5, '18:30') });

  const nutrition = (request: FastifyRequest) => { owned(request); return nutritionStore; };
  const targets: NutritionTargetsAccess = (request) => { owned(request); return nutritionTargetStore; };
  const trainingTargets: TrainingTargetsAccess = (request) => { owned(request); return trainingTargetStore; };
  const health = (request: FastifyRequest) => { owned(request); return readModel; };
  const frida = new FridaLookupAdapter(fridaStubFetch(context));
  const foodLookup: HealthFoodLookup = async (input, request, signal) => { owned(request); return frida.lookup(input, signal); };
  const suggestions: NutritionSuggestionSources = { nutrition: nutrition as never, health: health as never };

  // The accessors `createHealthData` builds: lift history for the browser only, the chat tools for the owner conversation.
  const readers = {
    health, nutrition, briefs: (request: FastifyRequest) => { owned(request); return briefStore; }, trainingTargets,
    lifts: (request: FastifyRequest) => { owned(request); resolveHealthBrowserOwner(request); return liftStore; },
  } as unknown as HealthReaders;
  const data: HealthData = {
    query: new HealthQueryService(readers), changes, trainingTargets,
    lifts: readers.lifts as never,
    workouts: ((request: FastifyRequest) => { owned(request); resolveHealthBrowserOwner(request); return workoutStore; }) as never,
    gymTools: {
      lifts: ((request: FastifyRequest) => { owned(request); resolveHealthConversationOwner(request); return liftStore; }) as never,
      workouts: ((request: FastifyRequest) => { owned(request); resolveHealthConversationOwner(request); return workoutStore; }) as never,
    },
    health: health as never, nutrition: nutrition as never, coach: ((request: FastifyRequest) => { owned(request); return coachStore; }) as never,
    foodLookup,
  };
  const module = createHealthModules(true, data, undefined, nutrition as never, nutrition as never, targets, suggestions, trainingTargets)[0]!;
  return { module: withStoredMessageTimes(module), day };
}

const record = (value: unknown) => value as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Health query and show, workouts (lifts and sessions), nutrition (food, saved food, targets, suggestions) and the Health summaries:
 * golden scenarios 'workouts' and 'nutrition'. Needs the core group's `ownerInteractions` and `workspaceCommands` (a connected tab).
 */
export const healthGroup: GroupFactory = (context): ConformanceGroup => {
  const { module, day } = composeHealthModule(context);
  const weekAgo = shiftDay(day, -6);
  const fortnightAgo = shiftDay(day, -13);

  const query = (label: string, args: Record<string, unknown>, check?: (result: Record<string, any>) => void): ToolCase => // eslint-disable-line @typescript-eslint/no-explicit-any
    ({ label, arguments: args, ...(check ? { check: (result) => check(record(result)) } : {}) });
  const available = (count: number) => (result: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(result.status).toBe('available');
    expect(result.items).toHaveLength(count);
  };
  /** For records another tool's case also adds or removes (saved plans): there is at least this many, whichever case ran first. */
  const availableAtLeast = (count: number) => (result: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(result.status).toBe('available');
    expect(result.items.length).toBeGreaterThanOrEqual(count);
  };

  // One intake written twice by the same message must be one intake (the first write's id is what the replay returns).
  let firstExactId: unknown;

  const cases: Record<string, readonly ToolCase[]> = {
    health_query: [
      query('sleep over the last week', { source: sources.sleep, startDate: weekAgo, endDate: day }, available(7)),
      query('steps over the last week', { source: sources.metrics, startDate: weekAgo, endDate: day, metric: 'step_count' }, (result) => {
        available(7)(result);
        expect(result.items.every((item: Record<string, unknown>) => item.metric_name === 'step_count')).toBe(true);
      }),
      query('workouts over two weeks', { source: sources.workouts, startDate: fortnightAgo, endDate: day }, available(4)),
      query('one workout in detail', { source: sources.workout, workoutId: seededIds.appleWorkout }, (result) => expect(result.items[0]).toMatchObject({ id: seededIds.appleWorkout })),
      query('heart rate during a workout', { source: sources.heartRate, workoutId: seededIds.appleWorkout, limit: 5 }, (result) => { expect(result.items).toHaveLength(5); expect(result.status).toBe('partial'); }),
      query('the measurements Health holds', { source: sources.metricCatalog, startDate: weekAgo, endDate: day }, (result) => expect(result.items.map((item: Record<string, unknown>) => item.metric_name)).toContain('step_count')),
      query('what was eaten today', { source: sources.meals, startDate: day, endDate: day }, (result) => expect(result.items.length).toBeGreaterThanOrEqual(2)),
      query('nutrition totals per day', { source: sources.days, startDate: weekAgo, endDate: day }, (result) => expect(result.items.length).toBeGreaterThanOrEqual(2)),
      query('saved favourites', { source: sources.favorites }, (result) => expect(result.items.length).toBeGreaterThanOrEqual(4)),
      query('saved meal plans', { source: sources.plans }, availableAtLeast(1)),
      query('owner training targets', { source: sources.trainingTargets }, (result) => expect(result.items[0]).toMatchObject({ targets: { dailySteps: 10_000 } })),
      query('upload and processing evidence', { source: sources.sync }, available(1)),
      query('brief history', { source: sources.briefs }, available(1)),
      query('one stored brief', { source: sources.brief, briefId: seededIds.brief }, available(1)),
      { label: 'lift history is read with gym_lifts for the agent', arguments: { source: sources.lifts }, expect: 'refused', check: (result) => expect(record(result).refused).toMatch(/gym_lifts/u) },
    ],
    health_show: [
      query('sleep as a table', { source: sources.sleep, startDate: weekAgo, endDate: day }, (result) => expect(result.view).toMatchObject({ renderer: 'table' })),
      query('sleep as a chart', { source: sources.sleep, startDate: weekAgo, endDate: day, display: 'chart' }, (result) => expect(result.view).toMatchObject({ renderer: 'chart' })),
      query('the same sleep chart again refreshes the view', { source: sources.sleep, startDate: weekAgo, endDate: day, display: 'chart' }, (result) => expect(result.view).toMatchObject({ operation: 'refreshed' })),
      query('steps as a chart', { source: sources.metrics, startDate: weekAgo, endDate: day, metric: 'step_count', display: 'chart' }, (result) => expect(result.view).toMatchObject({ renderer: 'chart' })),
      query('workouts as a table', { source: sources.workouts, startDate: fortnightAgo, endDate: day }, (result) => expect(result.view).toMatchObject({ renderer: 'table' })),
      query('daily calories as a chart', { source: sources.days, startDate: weekAgo, endDate: day, metric: 'energy_kcal', display: 'chart' }, (result) => expect(result.view).toMatchObject({ renderer: 'chart' })),
      query('heart rate during a workout', { source: sources.heartRate, workoutId: seededIds.appleWorkout, display: 'chart' }, (result) => expect(result.view).toMatchObject({ renderer: 'chart' })),
      query('saved favourites', { source: sources.favorites }, (result) => expect(result.view).toMatchObject({ renderer: 'table' })),
      query('sync evidence', { source: sources.sync }, (result) => expect(result.view).toBeDefined()),
      { label: 'heart rate needs the id of one workout', arguments: { source: sources.heartRate }, expect: 'refused' },
    ],
    gym_lifts: [
      query('what Dan lifted lately', { operation: 'list' }, (result) => {
        expect(result.items.map((item: Record<string, unknown>) => item.exerciseName)).toEqual(expect.arrayContaining(['Bench press', 'Squat', 'Deadlift']));
        expect(result.next).toBeNull();
      }),
      query('the newest two lifts, with a cursor to the rest', { operation: 'list', limit: 2 }, (result) => { expect(result.items).toHaveLength(2); expect(result.next).not.toBeNull(); }),
      query('log a lift', { operation: 'create', values: { exerciseName: 'Bench press', weightKg: 82.5, reps: 5 } }, (result) => {
        expect(result).toMatchObject({ replayed: false, entry: { exerciseName: 'Bench press', weightKg: 82.5, reps: 5, sets: 1, vault: 'synced' } });
      }),
      { label: 'the same message again returns the first lift', arguments: { operation: 'create', values: { exerciseName: 'Bench press', weightKg: 99, reps: 1 } }, sameMessageAsPrevious: true,
        check: (result) => expect(result).toMatchObject({ replayed: true, entry: { exerciseName: 'Bench press', weightKg: 82.5, reps: 5 } }) },
      query('log a lift inside a session', { operation: 'create', entryIndex: 1, values: { exerciseName: 'Incline press', weightKg: 60, reps: 8, sets: 3, workoutId: seededIds.chestSession } }, (result) => expect(result.entry).toMatchObject({ workoutId: seededIds.chestSession })),
      query('edit a lift', { operation: 'update', id: seededIds.lateralRaise, values: { weightKg: 12.5, reps: 12 } }, (result) => expect(result.entry).toMatchObject({ id: seededIds.lateralRaise, weightKg: 12.5, revision: 2 })),
      query('delete a lift', { operation: 'delete', id: seededIds.cableCurl }, (result) => expect(result.entry.deletedAt).not.toBeNull()),
      { label: 'a lift that does not exist', arguments: { operation: 'update', id: '00000000-0000-4000-8000-0000000000ff', values: { reps: 6 } }, expect: 'refused' },
      { label: 'a lift needs its values', arguments: { operation: 'create' }, expect: 'refused' },
      { label: 'a lift in a session that does not exist', arguments: { operation: 'create', entryIndex: 2, values: { exerciseName: 'Curl', weightKg: 20, reps: 10, workoutId: '00000000-0000-4000-8000-0000000000fe' } }, expect: 'refused' },
    ],
    gym_sessions: [
      query('the latest sessions', { operation: 'list' }, (result) => { expect(result.items.length).toBeGreaterThanOrEqual(4); expect(result.limited).toBe(false); }),
      query('log a session', { operation: 'create', values: { sessionType: 'cardio', durationMinutes: 45, note: 'Running' } }, (result) => expect(result).toMatchObject({ replayed: false, entry: { sessionType: 'cardio', durationMinutes: 45, vault: 'synced' } })),
      { label: 'the same message again returns the first session', arguments: { operation: 'create', values: { sessionType: 'other', title: 'Padel', durationMinutes: 30 } }, sameMessageAsPrevious: true,
        check: (result) => expect(result).toMatchObject({ replayed: true, entry: { sessionType: 'cardio', durationMinutes: 45 } }) },
      query('log a session of another kind', { operation: 'create', entryIndex: 1, values: { sessionType: 'other', title: 'Football', durationMinutes: 90 } }, (result) => expect(result.entry).toMatchObject({ sessionType: 'other', title: 'Football' })),
      query('edit a session', { operation: 'update', id: seededIds.sessionToEdit, values: { durationMinutes: 50, note: 'Longer than planned' } }, (result) => expect(result.entry).toMatchObject({ durationMinutes: 50, revision: 2 })),
      query('delete a session', { operation: 'delete', id: seededIds.sessionToDelete }, (result) => expect(result.entry.deletedAt).not.toBeNull()),
      { label: 'a session that does not exist', arguments: { operation: 'update', id: '00000000-0000-4000-8000-0000000000ff', values: { note: 'x' } }, expect: 'refused' },
      { label: 'a title belongs to the other session type only', arguments: { operation: 'create', entryIndex: 2, values: { sessionType: 'cardio', title: 'Run' } }, expect: 'refused' },
    ],
    health_food: [
      { label: 'log an exact label', arguments: { operation: 'log_exact' }, ownerMessage: 'Log yoghurt: 200 kcal, protein 10 g, carbs 20 g',
        check: (result) => { expect(result).toMatchObject({ status: 'committed', record: { meal_name: 'yoghurt', energy_kcal: 200, protein_grams: 10, carbohydrates_grams: 20 } }); firstExactId = record(result).record.id; } },
      { label: 'the same message again is the same intake', arguments: { operation: 'log_exact' }, ownerMessage: 'Log yoghurt: 200 kcal, protein 10 g, carbs 20 g', sameMessageAsPrevious: true,
        check: (result) => expect(record(result).record.id).toBe(firstExactId) },
      { label: 'log a saved favourite by its alias', arguments: { operation: 'log_favorite' }, ownerMessage: 'Log my favourite oatmeal', check: (result) => expect(result).toMatchObject({ status: 'committed', record: { meal_name: 'Oatmeal with berries', energy_kcal: 420 } }) },
      { label: 'a message that is not a food-log request', arguments: { operation: 'log_exact' }, expect: 'refused' },
      { label: 'a food that is not a saved favourite', arguments: { operation: 'log_favorite' }, ownerMessage: 'Log my unicorn smoothie', expect: 'refused' },
      { label: 'an estimate is not an exact label', arguments: { operation: 'log_exact' }, ownerMessage: 'Log about 300 kcal of pasta', expect: 'refused' },
      { label: 'a plain meal has no label to log exactly', arguments: { operation: 'log_exact' }, ownerMessage: 'log two eggs and toast for breakfast', expect: 'refused' },
      { label: 'a plain meal is no saved favourite', arguments: { operation: 'log_favorite' }, ownerMessage: 'log two eggs and toast for breakfast', expect: 'refused' },
      { label: 'a request about another day is not logged directly', arguments: { operation: 'log_exact' }, ownerMessage: 'Log yoghurt: 200 kcal, protein 10 g, carbs 20 g yesterday', expect: 'refused' },
    ],
    health_food_review: [
      { label: 'look up the nutrients of a banana', arguments: { change: { operation: 'lookup_components', components: [{ name: 'banana', grams: 120, preparationMethod: null }] } },
        check: (result) => { expect(result).toMatchObject({ status: 'complete', intakeLogged: false }); expect(record(result).presentation).toMatch(/Calories: 107 kcal/u); } },
      { label: 'a food the reference does not know stays partial', arguments: { change: { operation: 'lookup_components', components: [{ name: 'dragon fruit smoothie', grams: 200, preparationMethod: null }] } },
        check: (result) => expect(result).toMatchObject({ status: 'partial', intakeLogged: false }) },
      { label: 'log an estimated meal from reference components', ownerMessage: 'log two eggs and toast for breakfast',
        arguments: { change: { operation: 'log_estimate', food: { mealName: 'Two eggs and toast', mealType: 'breakfast', referenceComponents: [{ name: 'egg', grams: 120, preparationMethod: null }, { name: 'toast', grams: 60, preparationMethod: null }] } } },
        check: (result) => expect(result).toMatchObject({ status: 'committed', record: { meal_name: 'Two eggs and toast', capture_method: 'text', confidence: 'estimate' } }) },
      { label: 'log an estimated meal said in Danish', ownerMessage: 'log to æg og toast til morgenmad',
        arguments: { change: { operation: 'log_estimate', food: { mealName: 'To æg og toast', mealType: 'breakfast', referenceComponents: [{ name: 'æg', grams: 120, preparationMethod: null }, { name: 'toast', grams: 60, preparationMethod: null }] } } },
        check: (result) => expect(result).toMatchObject({ status: 'committed', record: { meal_name: 'To æg og toast' } }) },
      { label: 'log an estimated meal with calories Dan gave', ownerMessage: 'log my restaurant pasta for dinner, roughly 780 calories',
        arguments: { change: { operation: 'log_estimate', food: { mealName: 'Restaurant pasta', mealType: 'dinner', energyKcal: 780, proteinGrams: 28, components: [{ name: 'pasta', grams: 250, cooked: true }, { name: 'sauce', grams: 120 }] } } },
        // The components arrive as sent: numbers stay numbers (an Ajv coercion once turned grams 250 into "250").
        check: (result) => expect(result).toMatchObject({ status: 'committed', record: { energy_kcal: 780, components_json: [{ name: 'pasta', grams: 250, cooked: true }, { name: 'sauce', grams: 120 }] } }) },
      { label: 'correct an intake', arguments: { change: { operation: 'correct', idempotencyKey: seedKeys.lunch, expectedRevision: '1', changes: { mealName: 'Chicken and rice bowl', energyKcal: 600 } } },
        check: (result) => expect(result).toMatchObject({ status: 'committed', operation: 'correct', record: { meal_name: 'Chicken and rice bowl', revision: '2' } }) },
      { label: 'delete an intake', arguments: { change: { operation: 'delete', idempotencyKey: seedKeys.snack, expectedRevision: '1' } },
        check: (result) => expect(result).toMatchObject({ status: 'committed', operation: 'delete' }) },
      { label: 'a correction to an intake that has changed since', arguments: { change: { operation: 'correct', idempotencyKey: seedKeys.lunch, expectedRevision: '1', changes: { mealName: 'Something else' } } }, expect: 'refused' },
      { label: 'an exact label belongs to health_food', ownerMessage: 'Log yoghurt: 200 kcal, protein 10 g',
        arguments: { change: { operation: 'log_estimate', food: { mealName: 'Yoghurt', energyKcal: 200 } } }, expect: 'refused' },
    ],
    health_saved_food: [
      { label: 'look up a favourite by name', arguments: { operation: 'lookup_saved', name: 'Protein shake' }, check: (result) => expect(result).toMatchObject({ status: 'available', source: 'favorite', intakeLogged: false, record: { id: 'fav-protein-shake' } }) },
      { label: 'look up a favourite by alias', arguments: { operation: 'lookup_saved', name: 'oatmeal' }, check: (result) => expect(result).toMatchObject({ status: 'available', record: { id: 'fav-oatmeal' } }) },
      { label: 'a name nothing is saved under', arguments: { operation: 'lookup_saved', name: 'Unicorn smoothie' }, check: (result) => expect(result).toMatchObject({ status: 'empty' }) },
      { label: 'read the like and dislike of favourites', arguments: { operation: 'read_preferences', favoriteIds: ['fav-protein-shake', 'fav-oatmeal'] }, check: (result) => expect(record(result).records).toHaveLength(2) },
      { label: 'save a favourite from a definition', arguments: { operation: 'save_favorite', name: 'Overnight oats', expectedRevision: '0', aliases: ['oats jar'],
        definition: { mealName: 'Overnight oats', mealType: 'breakfast', energyKcal: 380, proteinGrams: 18, carbohydratesGrams: 52, fatGrams: 10, fiberGrams: 8, components: [{ name: 'oats', grams: 50 }, { name: 'milk', grams: 200 }] } },
      check: (result) => expect(result).toMatchObject({ status: 'committed', operation: 'save_favorite', record: { favorite_name: 'Overnight oats', components_json: [{ name: 'oats', grams: 50 }, { name: 'milk', grams: 200 }] } }) },
      { label: 'save a favourite from an intake already logged', arguments: { operation: 'save_favorite', name: 'Salmon dinner', expectedRevision: '0', sourceIdempotencyKey: seedKeys.dinner },
        check: (result) => expect(result).toMatchObject({ status: 'committed', record: { favorite_name: 'Salmon dinner', energy_kcal: 710 } }) },
      { label: 'like a favourite', arguments: { operation: 'set_feedback', favoriteId: 'fav-oatmeal', expectedRevision: '0', preference: 'like' }, check: (result) => expect(result).toMatchObject({ status: 'committed', record: { meal_key: 'fav-oatmeal', preference: 'like' } }) },
      { label: 'save a meal plan', arguments: { operation: 'save_plan', name: 'Training day', expectedRevision: '0', description: 'A heavier day with training.',
        entries: [{ slot: 'breakfast', favoriteId: 'fav-oatmeal' }, { slot: 'lunch', favoriteId: 'fav-chicken-rice' }, { slot: 'dinner', favoriteId: 'fav-salmon' }, { slot: 'snack', favoriteId: 'fav-protein-shake' }] },
      check: (result) => expect(result).toMatchObject({ status: 'committed', record: { plan_name: 'Training day' } }) },
      { label: 'delete a meal plan', arguments: { operation: 'delete_plan', id: 'plan-rest-day', expectedRevision: '1' }, check: (result) => expect(result).toMatchObject({ status: 'committed', operation: 'delete_plan' }) },
      { label: 'a plan needs a breakfast, a lunch and a dinner', arguments: { operation: 'save_plan', name: 'Too short', expectedRevision: '0', entries: [{ slot: 'breakfast', favoriteId: 'fav-oatmeal' }, { slot: 'lunch', favoriteId: 'fav-chicken-rice' }, { slot: 'snack', favoriteId: 'fav-protein-shake' }] }, expect: 'refused' },
      { label: 'a favourite name that is already used', arguments: { operation: 'save_favorite', name: 'Protein shake duplicate', expectedRevision: '0', aliases: ['proteinshake'],
        definition: { mealName: 'Shake', energyKcal: 200 } }, expect: 'refused' },
    ],
    health_nutrition_targets: [
      // The golden scenario sets the protein target to 160 g, so these cases do not depend on whether it ran first: the protein
      // target is only required to be a number, and the write below uses a value the scenario never sets.
      { label: 'read the targets', arguments: { operation: 'read' }, check: (result) => expect(result).toMatchObject({ status: 'configured', targets: { restingKcal: 2700, deficitKcal: 300, proteinGrams: expect.any(Number) }, missing: [] }) },
      { label: 'set the protein target', arguments: { operation: 'set_targets', targets: { proteinGrams: 170 } }, check: (result) => expect(result).toMatchObject({ status: 'committed', changed: ['proteinGrams'], targets: { proteinGrams: 170 } }) },
      { label: 'the same target again changes nothing', arguments: { operation: 'set_targets', targets: { proteinGrams: 170 } }, check: (result) => expect(result).toMatchObject({ status: 'unchanged' }) },
      { label: 'a target outside its range', arguments: { operation: 'set_targets', targets: { proteinGrams: 5 } }, expect: 'refused' },
    ],
    health_nutrition_suggest: [
      query('what is left of today', {}, (result) => {
        expect(result).toMatchObject({ kcal: { state: 'ready' }, burn: { state: 'known', kcal: 420.5 }, protein: { state: 'ready' } });
        expect(result.kcal.remainingKcal).toBeCloseTo(result.kcal.allowanceKcal - result.kcal.eatenKcal, 1);
        expect(typeof result.eaten.meals).toBe('number');
        expect(Array.isArray(result.suggestions)).toBe(true);
      }),
      query('three suggestions', { limit: 3 }, (result) => expect(result.suggestions.length).toBeLessThanOrEqual(3)),
    ],
    health_summary: [
      query('today and the week', { operation: 'get_health_summary' }, (result) => {
        expect(result.status).toBe('available');
        expect(result.rolling7.workoutCount).toBe(3);
        expect(result.targets.targets).toMatchObject({ gymSessionsPerWeek: 3 });
      }),
      query('history for the last week', { operation: 'get_health_history', startDate: weekAgo, endDate: day, limit: 50 }, (result) => {
        expect(result.status).toBe('available');
        expect(result.period).toMatchObject({ startDate: weekAgo, endDate: day });
        expect(result.sleep.items).toHaveLength(7);
      }),
      query('history without dates is the latest 30 days', { operation: 'get_health_history', limit: 7 }, (result) => {
        expect(result.period).toMatchObject({ startDate: shiftDay(day, -29), endDate: day });
        expect(result.sleep.items).toHaveLength(7);
      }),
    ],
    health_nutrition_history: [
      query('meals over the last week', { operation: 'get_nutrition_history', startDate: weekAgo, endDate: day }, (result) => { expect(result.status).toBe('available'); expect(result.meals.length).toBeGreaterThanOrEqual(2); }),
      query('nutrition per day', { operation: 'analyze_nutrition', startDate: weekAgo, endDate: day, granularity: 'day' }, (result) => expect(result.series.length).toBeGreaterThanOrEqual(1)),
      query('calorie balance', { operation: 'get_calorie_balance', startDate: weekAgo, endDate: day }, (result) => expect(result.daily.length).toBeGreaterThanOrEqual(7)),
      query('like a favourite meal', { operation: 'set_meal_preference', mealKey: 'favorite:fav-protein-shake', preference: 'like' }, (result) => expect(result).toMatchObject({ status: 'committed', preference: 'like' })),
      { label: 'a meal key that is not a key', arguments: { operation: 'set_meal_preference', mealKey: 'protein shake', preference: 'like' }, expect: 'refused' },
    ],
    health_coach_status: [
      query('the coaching snapshot', { operation: 'get_coach_status' }, (result) => { expect(result.coachingJudgment).toBeNull(); expect(result.health.status).toBe('available'); }),
      query('the coach profile', { operation: 'get_coach_profile' }, (result) => expect(result).toMatchObject({ status: 'available', profile: { stepsTarget: 10_000 } })),
      query('update the coach profile', { operation: 'update_coach_profile', patch: { stepsTarget: 11_000 } }, (result) => expect(result).toMatchObject({ status: 'committed', profile: { stepsTarget: 11_000, revision: '2' } })),
      query('mark yesterday as a sick day', { operation: 'set_recovery_period', startDate: shiftDay(day, -1), endDate: shiftDay(day, -1), state: 'sick', context: 'A cold' }, (result) => expect(result).toMatchObject({ status: 'committed', affectedDays: 1 })),
      query('clear the recovery day again', { operation: 'set_recovery_period', startDate: shiftDay(day, -1), endDate: shiftDay(day, -1), state: 'clear' }, (result) => expect(result).toMatchObject({ status: 'committed', affectedDays: 1 })),
      { label: 'a profile field that does not exist', arguments: { operation: 'update_coach_profile', patch: { shoeSize: 44 } }, expect: 'refused' },
    ],
  };

  const scenarios: Scenario[] = [
    {
      id: 'workouts', title: 'Workouts: log a lift, log a session, what did I lift last week',
      steps: [
        { say: { en: 'log a bench press of 80 kg for 5 reps', da: 'log en bænkpres på 80 kg i 5 gentagelser' }, tool: 'gym_lifts',
          call: { label: 'log a lift', arguments: { operation: 'create', values: { exerciseName: 'Bench press', weightKg: 80, reps: 5 } },
            check: (result) => expect(result).toMatchObject({ replayed: false, entry: { exerciseName: 'Bench press', weightKg: 80, reps: 5, sets: 1 } }) } },
        { say: { en: 'log a 45 minute running workout', da: 'log en løbetur på 45 minutter' }, tool: 'gym_sessions',
          call: { label: 'log a session', arguments: { operation: 'create', values: { sessionType: 'cardio', durationMinutes: 45, note: 'Running' } },
            check: (result) => expect(result).toMatchObject({ replayed: false, entry: { sessionType: 'cardio', durationMinutes: 45 } }) } },
        { say: { en: 'what did I lift last week', da: 'hvad løftede jeg i sidste uge' }, tool: 'gym_lifts',
          call: { label: 'what was lifted', arguments: { operation: 'list' },
            check: (result) => expect(record(result).items.map((item: Record<string, unknown>) => item.exerciseName)).toEqual(expect.arrayContaining(['Bench press', 'Squat', 'Deadlift'])) } },
      ],
    },
    {
      id: 'nutrition', title: 'Nutrition: log food, calories and protein left, saved food, a food lookup',
      steps: [
        { say: { en: 'log skyr: 130 kcal, protein 17 g, carbs 6 g', da: 'log skyr: 130 kalorier, protein 17 g, kulhydrater 6 g' }, tool: 'health_food',
          call: { label: 'log an exact label', arguments: { operation: 'log_exact' }, check: (result) => expect(result).toMatchObject({ status: 'committed', record: { meal_name: 'skyr', energy_kcal: 130, protein_grams: 17 } }) } },
        { say: { en: 'log my protein shake', da: 'log min proteinshake' }, tool: 'health_food',
          call: { label: 'log a saved favourite', arguments: { operation: 'log_favorite' }, check: (result) => expect(result).toMatchObject({ status: 'committed', record: { meal_name: 'Protein shake', energy_kcal: 260 } }) } },
        { say: { en: 'how many calories do I have left today', da: 'hvor mange kalorier har jeg tilbage i dag' }, tool: 'health_nutrition_suggest',
          call: { label: 'calories logged and left', arguments: {}, check: (result) => { expect(record(result).kcal.state).toBe('ready'); expect(typeof record(result).kcal.remainingKcal).toBe('number'); expect(typeof record(result).kcal.eatenKcal).toBe('number'); } } },
        { say: { en: 'how much protein do I still need today', da: 'hvor meget protein mangler jeg i dag' }, tool: 'health_nutrition_suggest',
          call: { label: 'protein still needed', arguments: {}, check: (result) => { expect(typeof record(result).protein.remainingGrams).toBe('number'); expect(typeof record(result).protein.targetGrams).toBe('number'); } } },
        { say: { en: 'save this as a favourite meal', da: 'gem det som et favoritmåltid' }, tool: 'health_saved_food',
          call: { label: 'save a favourite from the meal just eaten', arguments: { operation: 'save_favorite', name: 'Last night’s salmon', expectedRevision: '0', sourceIdempotencyKey: seedKeys.dinner },
            check: (result) => expect(record(result).record.favorite_name).toBe('Last night’s salmon') } },
        { say: { en: 'how many calories are in a banana', da: 'hvor mange kalorier er der i en banan' }, tool: 'health_food_review',
          call: { label: 'look up a banana', arguments: { change: { operation: 'lookup_components', components: [{ name: 'banana', grams: 120, preparationMethod: null }] } },
            check: (result) => expect(result).toMatchObject({ intakeLogged: false, totals: { energyKcal: expect.closeTo(106.8, 1) } }) } },
        { say: { en: 'set my protein target to 160 grams', da: 'sæt mit proteinmål til 160 gram' }, tool: 'health_nutrition_targets',
          call: { label: 'set the protein target', arguments: { operation: 'set_targets', targets: { proteinGrams: 160 } }, check: (result) => expect(record(result).targets.proteinGrams).toBe(160) } },
      ],
    },
  ];

  return { id: 'health', covers: ['health'], modules: [module], cases, scenarios };
};
