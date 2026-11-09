import sql from 'mssql';
import type { MemoryStore } from '../../database/memory-store.js';
import { databaseReadRequest } from '../../database/wake-retry.js';
import { HealthReadModel } from '../../health/health/read-model.js';
import { TrainingTargetsStore } from '../../health/training/targets-store.js';
import type { StoredTrainingTargets } from '../../health/training/targets.js';
import { NutritionStore } from '../../health/nutrition/store.js';
import type { StoredNutritionTargets } from '../../health/nutrition/targets.js';
import { NutritionTargetsStore } from '../../health/nutrition/targets-store.js';
import { WorkoutEntriesStore } from '../../health/gym/workouts-store.js';
import { LiftEntriesStore } from '../../health/lifts/lifts-store.js';
import { createHealthChanges } from '../../health/revisions.js';
import type { createGitHubVaultClient } from '../../vault/github-client.js';
import { dayKey } from '../time.js';
import type { ProactiveSource, SourceFact, SourceId } from '../types.js';

type Row = Record<string, unknown>;
export interface ContextDependencies {
  pool?: sql.ConnectionPool;
  ownerObjectId?: string;
  healthEnabled?: boolean;
  memoryStore?: Pick<MemoryStore, 'list'>;
  vaultClient?: Pick<ReturnType<typeof createGitHubVaultClient>, 'read'>;
}
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const stamp = (value: unknown): string | null => value instanceof Date ? value.toISOString()
  : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const date = (value: unknown): string | null => stamp(value)?.slice(0, 10) ?? null;
const shift = (key: string, days: number) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function contextWindow(now: Date) {
  const today = dayKey(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return { today, from: shift(today, -27), weekStart: shift(today, -((weekday + 6) % 7)) };
}
function fact(source: SourceId, identity: string, value: unknown, at: string, personal = true): SourceFact {
  return { ref: identity, identity, kind: source === 'notes' ? 'note' : source as 'health' | 'nutrition' | 'memory',
    label: identity.replaceAll(':', ' · ').replaceAll('_', ' ').slice(0, 160), text: JSON.stringify(value).slice(0, 3500), observedAt: at,
    ...(personal ? { taskScope: 'personal' as const } : {}) };
}

/** Keep distinct HealthKit IDs; reconcile manual gym sessions using the app's two-hour match. */
export function trainingProgress(now: Date, targets: StoredTrainingTargets, workouts: Row[], manual: Row[], steps: Row[], complete: boolean) {
  const { today, weekStart } = contextWindow(now);
  const category = (value: unknown): 'gym' | 'run' | null => {
    const text = String(value).toLowerCase();
    return /running|\brun\b/.test(text) ? 'run' : /strength|gym|chest|back_biceps|arms_shoulders|legs_core/.test(text) ? 'gym' : null;
  };
  const entries = [...new Map(workouts.map(row => [String(row.id), row])).values()]
    .flatMap(row => {
      const start = stamp(row.start_at); const kind = category(row.workout_type ?? row.activity_identifier);
      return start && kind ? [{ start, kind }] : [];
    });
  const manualOnly = manual.flatMap(row => {
    const start = stamp(row.startedAt); const kind = category(row.sessionType);
    if (!start || !kind || entries.some(entry => entry.kind === kind && Math.abs(Date.parse(entry.start) - Date.parse(start)) <= 2 * 3600000)) return [];
    return [{ start, kind }];
  });
  const current = [...entries, ...manualOnly].filter(row => dayKey(new Date(row.start)) >= weekStart && Date.parse(row.start) <= now.getTime());
  const latestSteps = steps.find(row => date(row.metric_date) === today && number(row.value) !== null);
  const progress = (actual: number | null, target: number | null) => ({ actual, target,
    percent: actual !== null && target !== null && target > 0 ? Math.round(actual / target * 1000) / 10 : null,
    remaining: actual !== null && target !== null ? Math.max(0, target - actual) : null });
  return { period: { today, weekStart, weekEnd: shift(weekStart, 6), timeZone: 'Europe/Copenhagen' },
    targetUpdatedAt: targets.updatedAt, coverage: complete ? 'observed_records' : 'partial',
    // Even a fresh upload cannot establish permission/completeness for an empty HealthKit query.
    gym: progress(current.some(row => row.kind === 'gym') ? current.filter(row => row.kind === 'gym').length : null, targets.targets.gymSessionsPerWeek),
    run: progress(current.some(row => row.kind === 'run') ? current.filter(row => row.kind === 'run').length : null, targets.targets.runSessionsPerWeek),
    steps: progress(number(latestSteps?.value), targets.targets.dailySteps),
    note: 'Counts are recorded sessions, not proof of all activity. Missing means unknown, never zero. No streak is inferred.' };
}

export function metricTrend(rows: Row[]) {
  const observations = rows.flatMap(row => {
    const value = number(row.value); const on = date(row.metric_date);
    return value === null || on === null ? [] : [{ date: on, value, unit: row.unit ?? null }];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const units = new Set(observations.map(row => row.unit));
  return { observations: observations.slice(-7), observationCount: observations.length, loggedDays: new Set(observations.map(row => row.date)).size,
    mean: observations.length && units.size === 1 ? observations.reduce((sum, row) => sum + row.value, 0) / observations.length : null,
    change: observations.length >= 2 && units.size === 1 ? observations.at(-1)!.value - observations[0]!.value : null,
    note: 'Statistics describe available observations only; unlogged days are not zero. Units are not interchangeable.' };
}

export function nutritionProgress(days: Row[], targets: StoredNutritionTargets) {
  return days.map(row => {
    const protein = number(row.protein_grams); const target = targets.targets.proteinGrams;
    return { date: date(row.meal_date), loggedMeals: number(row.meal_count), loggedKcal: number(row.energy_kcal),
      loggedProteinGrams: protein, proteinTargetGrams: target,
      proteinTargetPercent: protein !== null && target !== null && target > 0 ? Math.round(protein / target * 1000) / 10 : null };
  });
}

export function createContextSources(dependencies: ContextDependencies): ProactiveSource[] {
  const { pool, ownerObjectId: owner } = dependencies;
  const source = (id: SourceId, label: string, ready: boolean, read: (now: Date, signal: AbortSignal) => Promise<SourceFact[]>): ProactiveSource => ({
    id, label,
    async read({ now, signal }) {
      const observedAt = now.toISOString();
      if (!ready) return { source: id, state: 'unavailable', reason: 'not_connected', facts: [], observedAt };
      try { return { source: id, state: 'ok', reason: null, facts: await read(now, signal), observedAt }; }
      catch { return { source: id, state: 'unavailable', reason: signal.aborted ? 'timeout' : 'read_failed', facts: [], observedAt }; }
    },
  });
  const healthReady = Boolean(pool && owner && dependencies.healthEnabled);
  return [
    source('health', 'Health and training', healthReady, async (now, signal) => {
      const reader = HealthReadModel.forOwner(pool!, owner!);
      const { today, from } = contextWindow(now);
      const range = { startDate: from, endDate: today, limit: 500 };
      const changes = createHealthChanges();
      const [metrics, sleep, workouts, targets, manual, lifts, sync, stepPage] = await Promise.all([
        reader.history('metrics', range, signal), reader.history('sleep', range, signal), reader.history('workouts', range, signal),
        TrainingTargetsStore.forOwner(pool!, owner!).read(signal),
        WorkoutEntriesStore.forOwner(pool!, owner!, changes).history({ limit: 100, days: 28 }, signal),
        LiftEntriesStore.forOwner(pool!, owner!, changes).history({ limit: 30, lastPerExercise: true }, signal), reader.sync(signal), reader.history('metrics', { ...range, metric: 'step_count', limit: 28 }, signal),
      ]);
      const at = now.toISOString();
      const steps = stepPage.items;
      const grouped = new Map<string, Row[]>();
      for (const row of metrics.items) {
        const key = String(row.metric_name); const values = grouped.get(key) ?? []; values.push(row); grouped.set(key, values);
      }
      return [fact('health', 'training:progress', trainingProgress(now, targets, workouts.items, manual.items, steps,
        !workouts.truncated && manual.items.length < 100 && !metrics.truncated), at),
        fact('health', 'health:coverage', { sync, partial: metrics.truncated || sleep.truncated || workouts.truncated,
          note: 'Sync receipt is not permission or proof of complete data. No claims about absent activity or unlogged days.' }, at),
        ...[...grouped].slice(0, 16).map(([key, rows]) => fact('health', `metric:${key}`, metricTrend(rows), at)),
        ...sleep.items.slice(-7).map(row => fact('health', `sleep:${date(row.sleep_date ?? row.night_date)}`, row, at)),
        fact('health', 'lifts:recent', { entries: lifts.items, truncated: lifts.items.length >= 30 }, at)];
    }),
    source('nutrition', 'Nutrition', healthReady, async (now, signal) => {
      const { today, from } = contextWindow(now);
      const [days, targets, meals, plans] = await Promise.all([
        NutritionStore.forOwner(pool!, owner!).days({ from, to: today, limit: 28 }, signal),
        NutritionTargetsStore.forOwner(pool!, owner!).read(signal),
        NutritionStore.forOwner(pool!, owner!).history({ from: today, to: today, limit: 30 }, signal),
        NutritionStore.forOwner(pool!, owner!).plans({ limit: 5 }, signal),
      ]);
      const at = now.toISOString();
      return [fact('nutrition', 'nutrition:targets', targets, at),
        fact('nutrition', 'nutrition:coverage', { from, to: today, loggedDays: days.rows.length, partial: days.next !== null,
          note: 'Logged meals only. Missing meals/days do not establish low intake or a calorie deficit.' }, at),
        ...nutritionProgress(days.rows, targets).map(row => fact('nutrition', `nutrition:day:${row.date}`, row, at)),
        fact('nutrition', 'nutrition:today', { meals: meals.rows.map(row => ({ name: row.meal_name, time: row.occurred_at, kcal: row.energy_kcal, proteinGrams: row.protein_grams })), partial: meals.next !== null }, at),
        fact('nutrition', 'nutrition:plans', { plans: plans.rows, partial: plans.nextId !== null }, at)];
    }),
    source('notes', 'Notes', Boolean(pool && dependencies.vaultClient), async (now, signal) => {
      // Same single-owner vault index as Notes; read the current blob so deleted notes do not reappear.
      const request = databaseReadRequest(pool!).input('take', sql.Int, 12);
      const cancel = () => request.cancel(); signal.addEventListener('abort', cancel, { once: true });
      let paths: { path: string }[];
      try {
        signal.throwIfAborted();
        paths = (await request.query<{ path: string }>(`SELECT TOP(@take) path FROM dbo.vault_chunks GROUP BY path ORDER BY MAX(indexed_at) DESC,path;`)).recordset;
      } finally { signal.removeEventListener('abort', cancel); }
      const notes = await Promise.all(paths.map(async ({ path }) => {
        const note = await dependencies.vaultClient!.read(path, signal);
        return note ? fact('notes', `note:${path}`, { path, sha: note.sha, excerpt: note.content.slice(0, 700),
          partial: note.content.length > 700, note: 'Recent indexed notes, not the complete vault.' }, now.toISOString(), false) : null;
      }));
      return notes.filter((value): value is SourceFact => value !== null);
    }),
    source('memory', 'Memory', Boolean(dependencies.memoryStore), async (now, signal) => {
      const page = await dependencies.memoryStore!.list(25, signal);
      return page.memories.map(row => fact('memory', `memory:${row.id}`, { category: row.category, key: row.key,
        content: row.content, revision: row.revision, updatedAt: stamp(row.updatedAt), partial: page.hasMore }, now.toISOString(), false));
    }),
  ];
}
