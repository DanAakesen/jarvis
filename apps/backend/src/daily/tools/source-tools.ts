import type { FastifyRequest } from 'fastify';
import { dailyQuerySources, isDailyQuery } from '@jarvis/contracts';
import type { HealthCursor } from '../health/read-model.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import { dateOnly } from '../health/value.js';
import { activeEnergyMetric } from '../nutrition/budget.js';
import type { NutritionStore } from '../nutrition/store.js';
import { instant as nutritionInstant, text as nutritionText } from '../nutrition/model.js';
import { projectNutritionRecord, dailyResultByteLimit } from '../query.js';
import type { DailyCoachStore } from '../coach-store.js';
import type { DailyData } from '../query.js';
import { profilePatch } from '../coach-store.js';
import { resolveDailyOwner } from '../owner.js';
import { presentTrainingTargets } from '../training/targets.js';

type Input = Record<string, unknown>;
type CoachAccess = (request: FastifyRequest) => DailyCoachStore;
type NutritionAccess = (request: FastifyRequest) => Pick<NutritionStore, 'history' | 'days' | 'feedback' | 'preferences'>;

const schema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const dateSchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const rangeProperties = { startDate: dateSchema, endDate: dateSchema };
const historyKinds = ['metrics', 'sleep', 'workouts'] as const;
type HistoryKind = typeof historyKinds[number];
type HistoryContinuation = {
  source: 'health' | 'nutrition'; startDate: string; endDate: string; windowStartDate: string;
  cursors: Record<string, unknown> | null;
};
const continuationSchema = {
  ...schema({
    source: { type: 'string', enum: ['health', 'nutrition'] },
    ...rangeProperties, windowStartDate: dateSchema,
    cursors: { type: ['object', 'null'], additionalProperties: true },
  }, ['source', 'startDate', 'endDate', 'windowStartDate', 'cursors']),
  description: 'Replay the exact returned continuation with the same explicit startDate/endDate. Null category cursors are exhausted, not restart instructions.',
};
const shiftDate = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
function historyScope(input: Input, now: number, source: HistoryContinuation['source']) {
  const requestedPeriod = range(input, now, 3_652_059);
  let continuation: HistoryContinuation | undefined;
  if (input.continuation !== undefined) {
    const value = toolInput(input.continuation, ['source', 'startDate', 'endDate', 'windowStartDate', 'cursors']);
    if (input.startDate === undefined || input.endDate === undefined || value.source !== source ||
        value.startDate !== requestedPeriod.startDate || value.endDate !== requestedPeriod.endDate ||
        typeof value.windowStartDate !== 'string' || inputDate(value.windowStartDate) < requestedPeriod.startDate ||
        value.windowStartDate > requestedPeriod.endDate ||
        source === 'nutrition' && value.windowStartDate !== requestedPeriod.startDate ||
        (Date.parse(value.windowStartDate) - Date.parse(requestedPeriod.startDate)) % (93 * 86_400_000) !== 0 ||
        value.cursors !== null && (!value.cursors || typeof value.cursors !== 'object' || Array.isArray(value.cursors))) {
      throw new ToolRefusal('Replay the exact history continuation with its original source and explicit date range.');
    }
    continuation = value as HistoryContinuation;
  }
  const startDate = continuation?.windowStartDate ?? requestedPeriod.startDate;
  const endDate = source === 'nutrition' ? Date.parse(requestedPeriod.endDate)
    : Math.min(Date.parse(requestedPeriod.endDate), Date.parse(startDate) + 92 * 86_400_000);
  const period = { ...requestedPeriod, startDate, endDate: new Date(endDate).toISOString().slice(0, 10) };
  const cursors = continuation?.cursors ?? null;
  const kinds = source === 'health' ? historyKinds : ['meals'] as const;
  if (cursors !== null && (Object.keys(cursors).length !== kinds.length ||
      kinds.some(kind => !Object.hasOwn(cursors, kind)) || kinds.every(kind => cursors[kind] === null))) {
    throw new ToolRefusal('Replay all returned category cursors, including null exhausted categories.');
  }
  for (const kind of kinds) {
    const cursor = cursors?.[kind];
    if (!cursors || cursor === null) continue;
    if (kind === 'meals') {
      const mealCursor = toolInput(cursor, ['createdAt', 'id']);
      try {
        nutritionInstant(mealCursor.createdAt);
        nutritionText(mealCursor.id);
      } catch { throw new ToolRefusal('Use the exact meal creation-time/ID cursor.'); }
    } else if (!isDailyQuery({
      source: dailyQuerySources[kind], startDate: period.startDate, endDate: period.endDate, cursor,
    })) throw new ToolRefusal('Use the exact source-specific history cursor within its original window.');
  }
  return { requestedPeriod, period, cursors };
}
function historyCoverage(source: HistoryContinuation['source'], requestedPeriod: ReturnType<typeof range>,
  period: ReturnType<typeof range>, cursors: Record<string, unknown>, returned: number) {
  const hasMoreInWindow = Object.values(cursors).some(cursor => cursor !== null);
  const hasMore = hasMoreInWindow || period.endDate < requestedPeriod.endDate;
  const continuation: HistoryContinuation | null = !hasMore ? null : {
    source, startDate: requestedPeriod.startDate, endDate: requestedPeriod.endDate,
    windowStartDate: hasMoreInWindow ? period.startDate : shiftDate(period.endDate, 1),
    cursors: hasMoreInWindow ? cursors : null,
  };
  return {
    returned, hasMore, retainedWindowExhausted: !hasMoreInWindow, sourceCompleteness: 'unknown',
    consistency: 'independent-committed-reads', continuation,
    nextStep: hasMore
      ? 'Fetch the next continuation if the answer requires the requested retained history; otherwise disclose the loaded windows/records and remaining pages. Never call one page the full history/year. Stop at the assistant tool/time budget and label interrupted, failed or budget-limited traversal partial.'
      : 'This window is exhausted in retained storage, not proof of complete device/source ingestion. Only a traversal of every preceding page/window establishes requested retained-range exhaustion.',
  };
}
const toolInput = (input: unknown, allowed: readonly string[]): Input => {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !allowed.includes(key))) throw new ToolRefusal('Use only the documented fields for this Health operation.');
  return input as Input;
};
const inputDate = (value: unknown) => {
  if (typeof value !== 'string') throw new ToolRefusal('Dates must use YYYY-MM-DD.');
  return dateOnly(value);
};
const copenhagenToday = (now: number) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(now));
function range(input: Input, now: number, maximumDays: number) {
  const today = copenhagenToday(now);
  const startDate = input.startDate === undefined ? new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10) : inputDate(input.startDate);
  const endDate = input.endDate === undefined ? today : inputDate(input.endDate);
  if ((input.startDate === undefined) !== (input.endDate === undefined) || startDate > endDate || endDate > today ||
      Date.parse(endDate) - Date.parse(startDate) > (maximumDays - 1) * 86_400_000) {
    throw new ToolRefusal(`Use a valid inclusive Europe/Copenhagen range of at most ${maximumDays} days, ending no later than today.`);
  }
  return { startDate, endDate, timeZone: 'Europe/Copenhagen' as const };
}
function bound<T>(result: T): T {
  if (Buffer.byteLength(JSON.stringify(result)) > dailyResultByteLimit) throw new ToolRefusal('Health result exceeds the shared response limit. Request a smaller date range.');
  return result;
}
function rows<T extends Record<string, unknown>>(page: { items?: T[]; rows?: T[] }) { return page.items ?? page.rows ?? []; }
async function healthSummary(data: DailyData, request: FastifyRequest, signal: AbortSignal, now: number) {
  if (!data.health) throw new ToolFailure('Health reads are unavailable.');
  const health = data.health(request);
  const today = copenhagenToday(now);
  const weekStart = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const [metrics, sleep, workouts, weeklyWorkouts, sync] = await Promise.all([
    health.history('metrics', { startDate: today, endDate: today, limit: 200 }, signal),
    health.history('sleep', { startDate: today, endDate: today, limit: 100 }, signal),
    health.history('workouts', { startDate: today, endDate: today, limit: 100 }, signal),
    health.history('workouts', { startDate: weekStart, endDate: today, limit: 100 }, signal),
    health.sync(signal),
  ]);
  const metricRows = rows(metrics);
  const sleepRows = rows(sleep);
  const workoutRows = rows(workouts);
  const weeklyRows = rows(weeklyWorkouts);
  return {
    status: metricRows.length || sleepRows.length || workoutRows.length ? 'available' : 'empty',
    timeZone: 'Europe/Copenhagen',
    today: { date: today, metrics: metricRows, sleep: sleepRows, workouts: workoutRows },
    rolling7: { startDate: weekStart, endDate: today, workouts: weeklyRows, workoutCount: weeklyWorkouts.truncated ? null : weeklyRows.length },
    sync: { feeds: sync.feeds, heartbeat: sync.heartbeat, inbox: sync.inbox },
    targets: data.trainingTargets
      ? presentTrainingTargets(await data.trainingTargets(request).read(signal))
      : { status: 'unavailable' },
    coverage: {
      sourceCompleteness: 'unknown',
      limited: metrics.truncated || sleep.truncated || workouts.truncated || weeklyWorkouts.truncated,
      consistency: 'independent-committed-reads',
    },
    units: { sleep: 'hours as retained by the source processor', heartRate: 'retained per-record unit', metrics: 'retained per-record unit' },
  };
}

export function dailySourceTools(data: DailyData, nutrition: NutritionAccess, coach: CoachAccess, now: () => number = Date.now): JarvisTool[] {
  const readTool = (name: string, description: string, inputSchema: Record<string, unknown>, execute: JarvisTool['execute']): JarvisTool => ({
    name, description, inputSchema, sensitive: true, denyOnPhone: true,
    execute: async (input, request, signal) => {
      resolveDailyOwner(request);
      if (request.dailyConnectorPrincipal) throw new ToolRefusal('Use the separate nutrition connector boundary for external clients.');
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      bounded.throwIfAborted();
      const result = await execute(input, request, bounded);
      bounded.throwIfAborted();
      return bound(result);
    },
  });
  const healthSummaryTool = readTool('health_summary',
    'Read today’s retained Health metrics, sleep, workouts and upload freshness, plus seven-day workout rows and the owner’s configured training targets. Unset targets remain null and are listed as missing; no defaults are inferred. Unknown or absent data stays explicit; freshness is processing evidence, not proof of source completeness. No fixed renderer, estimate, or live-device claim.',
    schema(), async (_input, request, signal) => healthSummary(data, request, signal, now()));
  const healthHistoryTool = readTool('health_history',
    'Read retained health metrics, sleep and workouts in at most one 93-date Europe/Copenhagen window per call. Replay coverage.continuation with the same explicit requested dates; exhausted categories are not replayed. Defaults to the latest 30 days. Future dates are refused.',
    schema({ ...rangeProperties, limit: { type: 'integer', minimum: 1, maximum: 100 }, continuation: continuationSchema }), async (raw, request, signal) => {
      const input = toolInput(raw, ['startDate', 'endDate', 'limit', 'continuation']);
      const { requestedPeriod, period, cursors } = historyScope(input, now(), 'health');
      const limit = input.limit === undefined ? 50 : input.limit;
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ToolRefusal('Limit must be from 1 to 100 per category.');
      const health = data.health?.(request);
      if (!health) throw new ToolFailure('Health reads are unavailable.');
      const page = (kind: HistoryKind) => cursors && cursors[kind] === null
        ? Promise.resolve({ items: [], next: null, truncated: false })
        : health.history(kind, { ...period, limit, ...(cursors ? { after: cursors[kind] as HealthCursor } : {}) }, signal);
      const [metrics, sleep, workouts, sync] = await Promise.all([
        page('metrics'), page('sleep'), page('workouts'),
        health.sync(signal),
      ]);
      const coverage = historyCoverage('health', requestedPeriod, period,
        { metrics: metrics.next, sleep: sleep.next, workouts: workouts.next }, metrics.items.length + sleep.items.length + workouts.items.length);
      return {
        status: coverage.hasMore ? 'partial' : coverage.returned ? 'available' : 'empty',
        period, requestedPeriod, timezone: period.timeZone, coverage,
        metrics: { items: metrics.items, next: metrics.next, hasMore: metrics.truncated, units: 'retained per-record unit' },
        sleep: { items: sleep.items, next: sleep.next, hasMore: sleep.truncated, units: 'hours as retained by the source processor' },
        workouts: { items: workouts.items, next: workouts.next, hasMore: workouts.truncated, units: 'retained per-record unit' },
        sourceProcessedCommittedAt: sync.feeds,
        sourceCompleteness: 'unknown',
      };
    });
  const nutritionHistoryTool = readTool('health_nutrition_history',
    'Read canonical named meals, exact occurrence/date, nutrients, provenance, revision and deletion state from the owner-scoped nutrition store. Traverse any valid non-future range in bounded keyset pages using coverage.continuation and the same explicit dates. Meal creation order and date filters remain unchanged. Health nutrient observations are not named meals.',
    schema({ ...rangeProperties, limit: { type: 'integer', minimum: 1, maximum: 100 }, continuation: continuationSchema }), async (raw, request, signal) => {
      const input = toolInput(raw, ['startDate', 'endDate', 'limit', 'continuation']);
      const { requestedPeriod, period, cursors } = historyScope(input, now(), 'nutrition');
      const limit = input.limit === undefined ? 50 : input.limit;
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ToolRefusal('Limit must be from 1 to 100 meals.');
      const page = await nutrition(request).history({ from: period.startDate, to: period.endDate, limit,
        ...(cursors ? { after: cursors.meals as { createdAt: string; id: string } } : {}) }, signal);
      const coverage = historyCoverage('nutrition', requestedPeriod, period, { meals: page.next }, page.rows.length);
      return {
        status: coverage.hasMore ? 'partial' : page.rows.length ? 'available' : 'empty', period, requestedPeriod, timeZone: period.timeZone, coverage,
        source: 'daily.nutrition_meals', meals: page.rows.map(row => projectNutritionRecord(row, 'history')),
        next: page.next, hasMore: page.next !== null,
        units: { energy_kcal: 'kcal', '*_grams': 'g', meal_date: 'Europe/Copenhagen calendar date' },
        sourceCompleteness: 'unknown',
      };
    });
  const nutritionAnalyzeTool = readTool('health_nutrition_analyze',
    'Analyze retained named-meal totals over at most 366 Europe/Copenhagen dates. Per-day, weekly and monthly series report only known nutrient values; unknown values stay null and partial totals are labelled lower bounds. Recovery dates are excluded. Not an estimate or a complete-source claim.',
    schema({ ...rangeProperties, granularity: { type: 'string', enum: ['auto', 'day', 'week', 'month'] } }), async (raw, request, signal) => {
      const input = toolInput(raw, ['startDate', 'endDate', 'granularity']);
      const period = range(input, now(), 366);
      const granularity = input.granularity ?? 'auto';
      if (!['auto', 'day', 'week', 'month'].includes(String(granularity))) throw new ToolRefusal('Choose auto, day, week or month granularity.');
      const store = nutrition(request);
      const page = await store.days({ from: period.startDate, to: period.endDate, limit: 400 }, signal);
      const recovery = await coach(request).recovery(period.startDate, period.endDate, signal);
      const recoveryDates = new Set(recovery.map(row => row.recovery_date instanceof Date ? row.recovery_date.toISOString().slice(0, 10) : String(row.recovery_date).slice(0, 10)));
      const selected = String(granularity) === 'auto'
        ? (Date.parse(period.endDate) - Date.parse(period.startDate) > 120 * 86_400_000 ? 'month' : Date.parse(period.endDate) - Date.parse(period.startDate) > 35 * 86_400_000 ? 'week' : 'day')
        : String(granularity);
      const bucketKey = (date: string) => {
        if (selected === 'month') return date.slice(0, 7);
        if (selected === 'week') {
          const day = new Date(`${date}T00:00:00Z`);
          day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
          return day.toISOString().slice(0, 10);
        }
        return date;
      };
      const nutrients = ['energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams'] as const;
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const row of page.rows) {
        const date = row.meal_date instanceof Date ? row.meal_date.toISOString().slice(0, 10) : String(row.meal_date).slice(0, 10);
        if (recoveryDates.has(date)) continue;
        const key = bucketKey(date);
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      const series = [...groups.entries()].map(([bucket, values]) => {
        const totals = Object.fromEntries(nutrients.map(nutrient => {
          const known = values.map(row => row[nutrient]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
          const unknown = values.some(row => Array.isArray(row.unknown_nutrients) &&
            (row.unknown_nutrients as unknown[]).includes(nutrient));
          return [nutrient, { total: known.length && !unknown ? known.reduce((sum, value) => sum + value, 0) : null,
            knownDays: known.length, partial: values.some(row => (row.partial_nutrients as string[] | undefined)?.includes(nutrient)) }];
        }));
        return { bucket, daysWithMeals: values.length, totals };
      });
      return { status: series.length ? page.next ? 'partial' : 'available' : 'empty', period, timeZone: period.timeZone,
        granularity: selected, source: 'daily.nutrition_meals', series, excludedRecoveryDays: recoveryDates.size,
        coverage: { hasMore: page.next !== null, next: page.next, sourceCompleteness: 'unknown', denominator: 'days with retained meals and known nutrients' },
        units: { energy_kcal: 'kcal', '*_grams': 'g' } };
    });
  const calorieBalanceTool = readTool('health_calorie_balance',
    'Compare canonical named-meal intake with retained active and resting Health energy in an inclusive date range of at most 366 days. Energy is converted only for recognized kcal/kJ units; unknown components remain null. Recovery dates are excluded from totals. Never infer expenditure, maintenance or calories remaining.',
    schema(rangeProperties), async (raw, request, signal) => {
      const input = toolInput(raw, ['startDate', 'endDate']);
      const period = range(input, now(), 366);
      const health = data.health?.(request);
      if (!health) throw new ToolFailure('Health reads are unavailable.');
      const [mealDays, metricsPage, recovery] = await Promise.all([
        nutrition(request).days({ from: period.startDate, to: period.endDate, limit: 400 }, signal),
        health.history('metrics', { ...period, limit: 500 }, signal),
        coach(request).recovery(period.startDate, period.endDate, signal),
      ]);
      const recoveryDates = new Set(recovery.map(row => row.recovery_date instanceof Date ? row.recovery_date.toISOString().slice(0, 10) : String(row.recovery_date).slice(0, 10)));
      const metricRows = metricsPage.items;
      const metricKcal = (date: string, names: readonly string[]) => {
        const matches = metricRows.filter(row => {
          const rowDate = row.metric_date instanceof Date ? row.metric_date.toISOString().slice(0, 10) : String(row.metric_date).slice(0, 10);
          return rowDate === date && names.includes(String(row.metric_name));
        });
        if (matches.length !== 1) return null;
        const row = matches[0]!;
        if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0) return null;
        if (row.unit === 'kcal') return row.value;
        if (row.unit === 'kJ' || row.unit === 'kj') return row.value / 4.184;
        return null;
      };
      const dates = new Set([...mealDays.rows.map(row => row.meal_date instanceof Date ? row.meal_date.toISOString().slice(0, 10) : String(row.meal_date).slice(0, 10)),
        ...metricRows.map(row => row.metric_date instanceof Date ? row.metric_date.toISOString().slice(0, 10) : String(row.metric_date).slice(0, 10))]);
      const daily = [...dates].sort().map(date => {
        const meals = mealDays.rows.find(row => (row.meal_date instanceof Date ? row.meal_date.toISOString().slice(0, 10) : String(row.meal_date).slice(0, 10)) === date);
        const activeKcal = metricKcal(date, [activeEnergyMetric, 'active_energy_burned']);
        const restingKcal = metricKcal(date, ['resting_energy', 'basal_energy_burned', 'basal_energy']);
        return { date, recovery: recoveryDates.has(date), intakeKcal: meals?.energy_kcal ?? null, activeKcal, restingKcal,
          netKcal: typeof meals?.energy_kcal === 'number' && activeKcal !== null && restingKcal !== null
            ? meals.energy_kcal - activeKcal - restingKcal : null,
          knownness: { intake: !meals || !Array.isArray(meals.unknown_nutrients) ||
              (meals.unknown_nutrients as unknown[]).includes('energy_kcal') || meals.energy_kcal === null ? 'unknown' : 'recorded',
            expenditure: activeKcal !== null && restingKcal !== null ? 'recorded' : 'unknown' } };
      });
      const included = daily.filter(row => !row.recovery);
      return { status: metricsPage.truncated || mealDays.next ? 'partial' : daily.length ? 'available' : 'empty',
        period, timeZone: period.timeZone, definition: 'intake minus active and resting energy; negative is deficit',
        daily, totals: {
          intakeKcal: included.length && included.every(row => typeof row.intakeKcal === 'number') ? included.reduce((sum, row) => sum + (row.intakeKcal as number), 0) : null,
          expenditureKcal: included.length && included.every(row => row.activeKcal !== null && row.restingKcal !== null)
            ? included.reduce((sum, row) => sum + row.activeKcal! + row.restingKcal!, 0) : null,
          netKcal: included.length && included.every(row => row.netKcal !== null) ? included.reduce((sum, row) => sum + row.netKcal!, 0) : null,
        },
        coverage: { recoveryDatesExcluded: recoveryDates.size, metricsHasMore: metricsPage.truncated, nutritionNext: mealDays.next,
          sourceCompleteness: 'unknown' },
        units: { energy: 'kcal' } };
    });
  const coachStatusTool = readTool('health_coach_status',
    'Read a conversational Status snapshot from retained health, canonical food, the saved owner profile and recovery markers. This is data for ordinary language-model reasoning, not a fixed renderer, score, judgment, order or commitment. Unknowns remain explicit; no Ready/Recomp/Review workflow is called.',
    schema(), async (_input, request, signal) => {
      const summary = await healthSummary(data, request, signal, now());
      const today = copenhagenToday(now());
      const weekStart = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
      const [mealDays, profile, recovery] = await Promise.all([
        nutrition(request).days({ from: weekStart, to: today, limit: 20 }, signal),
        coach(request).profile(signal),
        coach(request).recovery(weekStart, today, signal),
      ]);
      return { generatedAt: new Date(now()).toISOString(), timeZone: 'Europe/Copenhagen', health: summary,
        nutrition: { period: { startDate: weekStart, endDate: today }, days: mealDays.rows, source: 'daily.nutrition_meals',
          sourceCompleteness: 'unknown' },
        profile, recoveryDays: recovery.map(row => row.recovery_date instanceof Date ? row.recovery_date.toISOString().slice(0, 10) : String(row.recovery_date).slice(0, 10)),
        coachingJudgment: null, fixedRenderer: false, commitments: null };
    });
  const coachProfileTool: JarvisTool = {
    name: 'health_coach_profile',
    description: 'Read the saved coach profile, or update only fields explicitly requested in ordinary conversation. Every update requires exact browser Now approval before persistence; caller-supplied confirmation flags are not accepted. An unconfigured profile stays unconfigured and is not filled with invented defaults.',
    inputSchema: schema({
      operation: { type: 'string', enum: ['read', 'update'] },
      patch: { type: 'object', additionalProperties: true },
    }, ['operation']), sensitive: true, denyOnPhone: true, bodyLimit: 16 * 1024,
    execute: async (raw, request, signal) => {
      resolveDailyOwner(request);
      if (request.dailyConnectorPrincipal) throw new ToolRefusal('Use the separate nutrition connector boundary for external clients.');
      const input = toolInput(raw, ['operation', 'patch']);
      const store = coach(request);
      if (input.operation === 'read') {
        if ('patch' in input) throw new ToolRefusal('Profile reads do not accept a patch.');
        return store.profile(signal);
      }
      if (input.operation !== 'update' || !input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) throw new ToolRefusal('Choose read or update with a profile patch.');
      const patch = profilePatch(input.patch);
      const current = await store.profile(signal);
      if (current.status !== 'available') throw new ToolRefusal('The coach profile is not configured; no defaults are invented.');
      const revision = BigInt(String(current.profile.revision));
      const summary = `Review this exact coach profile update in Now. Nothing has changed yet.\n${JSON.stringify({ before: current.profile, patch })}`;
      if (summary.length > 8_000) throw new ToolRefusal('The profile change is too large to review safely.');
      const interactions = request.server.ownerInteractions;
      if (!interactions) throw new ToolRefusal('Now approval is unavailable. No profile field was changed.');
      return interactions.runConfirmed('other', summary, async () => {
        const latest = await store.profile(signal);
        if (latest.status !== 'available' || BigInt(String(latest.profile.revision)) !== revision) throw new ToolRefusal('The coach profile changed. Read it and review the update again.');
        return { status: 'committed', profile: await store.updateProfile(patch, revision, signal) };
      }, signal, { channel: 'browser', lifetimeSeconds: 120 });
    },
  };
  const mealPreferenceTool: JarvisTool = {
    name: 'health_meal_preference',
    description: 'Set or clear the owner’s like/dislike for one exact favorite or meal key. This changes feedback only, never intake or Health. Every change requires exact browser Now approval; null clears the preference. No caller-supplied confirmation or owner fields.',
    inputSchema: schema({ mealKey: { type: 'string', minLength: 3, maxLength: 200 }, preference: { type: ['string', 'null'], enum: ['like', 'dislike', null] } }, ['mealKey', 'preference']),
    sensitive: true, denyOnPhone: true, bodyLimit: 2 * 1024,
    execute: async (raw, request, signal) => {
      resolveDailyOwner(request);
      if (request.dailyConnectorPrincipal) throw new ToolRefusal('Use the separate nutrition connector boundary for external clients.');
      const input = toolInput(raw, ['mealKey', 'preference']);
      if (typeof input.mealKey !== 'string' || !/^(?:favorite|meal):[a-z0-9_-]{1,194}$/u.test(input.mealKey) ||
          ![null, 'like', 'dislike'].includes(input.preference as string | null)) throw new ToolRefusal('Use one exact favorite:/meal: key and like, dislike or null.');
      const store = nutrition(request);
      const current = (await store.preferences([input.mealKey], signal))[0] ?? null;
      if ((current?.preference ?? null) === input.preference) return { status: 'unchanged', mealKey: input.mealKey, preference: input.preference };
      const interactions = request.server.ownerInteractions;
      if (!interactions) throw new ToolRefusal('Now approval is unavailable. No meal preference was changed.');
      const revision = current ? BigInt(String(current.revision)) : 0n;
      return interactions.runConfirmed('other', `Review this exact meal preference in Now. No food or Health row changes.\n${JSON.stringify({
        mealKey: input.mealKey, before: current?.preference ?? null, after: input.preference,
      })}`, async () => {
        const latest = (await store.preferences([input.mealKey as string], signal))[0] ?? null;
        if ((latest ? BigInt(String(latest.revision)) : 0n) !== revision) throw new ToolRefusal('The meal preference changed. Read the latest value and review the change again.');
        const saved = await store.feedback(input.mealKey as string, input.preference as 'like' | 'dislike' | null, signal, revision);
        return { status: 'committed', mealKey: input.mealKey, preference: saved.preference ?? null, revision: String(saved.revision),
          source: 'daily.nutrition_recommendation_feedback' };
      }, signal, { channel: 'browser', lifetimeSeconds: 120 });
    },
  };
  const recoveryTool: JarvisTool = {
    name: 'health_recovery_period',
    description: 'Mark or clear one to 365 past or current dates as recovery days, without modifying measured health, sleep, workout or food data. Recovery markers are excluded from selected analytical totals. Every write requires exact browser Now approval; clear cannot include context. No caller-supplied confirmation or owner fields.',
    inputSchema: schema({ startDate: dateSchema, endDate: dateSchema, state: { type: 'string', enum: ['sick', 'clear'] }, context: { type: 'string', minLength: 1, maxLength: 280 } }, ['startDate', 'endDate']),
    sensitive: true, denyOnPhone: true, bodyLimit: 2 * 1024,
    execute: async (raw, request, signal) => {
      resolveDailyOwner(request);
      if (request.dailyConnectorPrincipal) throw new ToolRefusal('Use the separate nutrition connector boundary for external clients.');
      const input = toolInput(raw, ['startDate', 'endDate', 'state', 'context']);
      const period = range({ startDate: input.startDate, endDate: input.endDate }, now(), 365);
      const state = input.state ?? 'sick';
      if (!['sick', 'clear'].includes(String(state)) || state === 'clear' && input.context !== undefined ||
          input.context !== undefined && (typeof input.context !== 'string' || !input.context.trim() || input.context.trim() !== input.context || input.context.length > 280)) {
        throw new ToolRefusal('Use sick or clear for at most 365 past/current dates; clear cannot include context.');
      }
      const store = coach(request);
      const before = await store.recovery(period.startDate, period.endDate, signal);
      const interactions = request.server.ownerInteractions;
      if (!interactions) throw new ToolRefusal('Now approval is unavailable. No recovery marker was changed.');
      return interactions.runConfirmed('other', `Review this exact recovery-period change in Now. Measured records remain untouched.\n${JSON.stringify({
        ...period, state, context: input.context ?? null, before: before.map(row => ({
          date: row.recovery_date instanceof Date ? row.recovery_date.toISOString().slice(0, 10) : String(row.recovery_date).slice(0, 10),
          context: row.context_text ?? null,
        })),
      })}`, async () => {
        const latest = await store.recovery(period.startDate, period.endDate, signal);
        if (JSON.stringify(latest) !== JSON.stringify(before)) throw new ToolRefusal('Recovery markers changed. Read the current period and review the change again.');
        const result = await store.setRecovery(period.startDate, period.endDate, state as 'sick' | 'clear', input.context as string | undefined ?? null, signal);
        return { status: 'committed', ...period, ...result, source: 'daily.recovery_days', measurementsPreserved: true };
      }, signal, { channel: 'browser', lifetimeSeconds: 120 });
    },
  };
  const grouped = (name: string, description: string, routes: readonly {
    operation: string; tool: JarvisTool; required?: readonly string[]; injected?: Record<string, unknown>; exclude?: readonly string[];
  }[]): JarvisTool => {
    const variants = routes.map(route => {
      const properties = route.tool.inputSchema.properties as Record<string, unknown>;
      const routeProperties = Object.fromEntries(Object.entries(properties).filter(([key]) => key !== 'operation' && !route.exclude?.includes(key)));
      const required = [...(route.required ?? (route.tool.inputSchema.required as string[] | undefined ?? []).filter(key => key !== 'operation'))];
      return {
        type: 'object', properties: { operation: { type: 'string', const: route.operation }, ...routeProperties },
        required: ['operation', ...required], additionalProperties: false,
      };
    });
    const routeByOperation = new Map(routes.map(route => [route.operation, route]));
    return {
      name, description, inputSchema: { type: 'object', oneOf: variants }, sensitive: true, denyOnPhone: true, bodyLimit: 16 * 1024,
      execute: async (raw, request, signal) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof (raw as Input).operation !== 'string') {
          throw new ToolRefusal('Choose one supported Health capability operation.');
        }
        const input = raw as Input;
        const route = routeByOperation.get(input.operation as string);
        if (!route) throw new ToolRefusal('Choose one supported Health capability operation.');
        const allowed = new Set(['operation', ...Object.keys(route.tool.inputSchema.properties as Record<string, unknown>)
          .filter(key => key !== 'operation' && !route.exclude?.includes(key))]);
        if (Object.keys(input).some(key => !allowed.has(key))) throw new ToolRefusal('Use only fields supported by the selected Health operation.');
        return route.tool.execute({ ...route.injected, ...Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'operation')) }, request, signal);
      },
    };
  };
  return [
    grouped('health_summary',
      'Read source-compatible health summary or historical health. Set operation to get_health_summary or get_health_history. Each history call reads one window of at most 93 dates/100 rows per category. For wider periods or more rows, replay coverage.continuation with the original explicit startDate/endDate until exhausted or the assistant tool/time budget is reached. Null category cursors mean exhausted, not restart. Fetch subsequent pages when the answer requires them; otherwise disclose actual loaded windows/records and remaining limits. A first page is not the full year/history; failed, interrupted or budget-limited traversal is partial. Source completeness stays unknown even after retained exhaustion.',
      [{ operation: 'get_health_summary', tool: healthSummaryTool },
        { operation: 'get_health_history', tool: healthHistoryTool }]),
    grouped('health_nutrition_history',
      'Read canonical named-meal history, analyze nutrition totals/trends, calculate known calorie balance, or set one meal preference. Use operation get_nutrition_history, analyze_nutrition, get_calorie_balance, or set_meal_preference. History reads one bounded window/page per call; replay coverage.continuation with the original explicit startDate/endDate when the requested answer needs more. Never call a first page the full year/history. Disclose actual loaded windows/records and remaining limits; stop at the assistant tool/time budget and label failed, interrupted or budget-limited traversal partial. Retained exhaustion is not source completeness, which stays unknown. Writes require exact browser Now approval. Health nutrient observations are not named meals; unknown values remain null.',
      [{ operation: 'get_nutrition_history', tool: nutritionHistoryTool },
        { operation: 'analyze_nutrition', tool: nutritionAnalyzeTool },
        { operation: 'get_calorie_balance', tool: calorieBalanceTool },
        { operation: 'set_meal_preference', tool: mealPreferenceTool }]),
    grouped('health_coach_status',
      'Read conversational Status, read or update the saved coach profile, or mark/clear recovery dates. Use get_coach_status, get_coach_profile, update_coach_profile, or set_recovery_period. Every write uses exact browser Now approval; no fixed Status renderer, commitments, defaults or measured-data changes.',
      [{ operation: 'get_coach_status', tool: coachStatusTool },
        { operation: 'get_coach_profile', tool: coachProfileTool, injected: { operation: 'read' }, exclude: ['patch'] },
        { operation: 'update_coach_profile', tool: coachProfileTool, required: ['patch'], injected: { operation: 'update' } },
        { operation: 'set_recovery_period', tool: recoveryTool }]),
  ];
}
