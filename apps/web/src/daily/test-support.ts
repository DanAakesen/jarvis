import { dailyQuerySources } from '@jarvis/contracts';
import type { DailyCursor, DailyJson, DailyQuery, DailyQueryResult } from '@jarvis/contracts';
import { trainingTargetKeys, trainingTargetsFailureMessage, type TrainingTargetValues } from './training-targets';
import type { TrainingTargetsShared } from './training-targets-context';

export function dailyFixture(query: DailyQuery, items: Record<string, DailyJson>[] = [], next: DailyCursor | null = null): DailyQueryResult {
  return {
    source: query.source,
    period: 'startDate' in query ? { startDate: query.startDate, endDate: query.endDate, timeZone: 'Europe/Copenhagen' } : null,
    items, status: next ? 'partial' : items.length ? 'available' : 'empty',
    units: query.source.startsWith('daily.nutrition.') ? { energy_kcal: 'kcal', '*_grams': 'g' } :
      query.source === 'daily.health.sleep' ? { '*_hours': 'h' } :
        query.source === 'daily.health.workouts' ? { duration_seconds: 's', '*_unit': 'retained per-record unit', '*_heart_rate': 'bpm' } :
          query.source === dailyQuerySources.lifts ? { weightKg: 'kg', reps: 'reps', sets: 'sets' } :
            { unit: 'retained per-record unit' },
    provenance: { store: 'daily-sql', detail: 'retained-record', calculations: query.source === dailyQuerySources.days ? 'derived-from-retained-meals' : 'existing-read-model', consistency: 'independent-committed-reads' },
    freshness: { observedAt: '2026-10-17T07:00:00Z', sourceProcessedCommittedAt: null, latestReturnedRecordUpdatedAt: null, staleness: 'unknown' },
    coverage: { returned: items.length, hasMore: next !== null, next, sourceCompleteness: 'unknown' },
    revision: 'a'.repeat(64),
  };
}
export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

const targetBounds = {
  gymSessionsPerWeek: { label: 'Gym sessions', unit: 'sessions/week', min: 0, max: 21 },
  runSessionsPerWeek: { label: 'Run sessions', unit: 'sessions/week', min: 0, max: 21 },
  dailySteps: { label: 'Steps per day', unit: 'steps/day', min: 0, max: 100_000 },
};

/** The shared training targets a view sees, for tests: values the owner set (null for none), or a loading, failed or unserved read. */
export function trainingTargetsFixture(
  read: Partial<TrainingTargetValues> | 'loading' | 'failed' | 'unavailable' = {},
  actions: Partial<Pick<TrainingTargetsShared, 'retry' | 'apply'>> = {},
): TrainingTargetsShared {
  const noop = () => {};
  const base = { retry: actions.retry ?? noop, apply: actions.apply ?? noop, want: noop };
  if (read === 'loading') return { ...base, view: { status: 'loading' } };
  if (read === 'failed' || read === 'unavailable') {
    const kind = read === 'failed' ? 'failed' : 'unavailable';
    return { ...base, view: { status: 'error', kind, message: trainingTargetsFailureMessage(kind, 'load') } };
  }
  const targets: TrainingTargetValues = { gymSessionsPerWeek: null, runSessionsPerWeek: null, dailySteps: null, ...read };
  const missing = trainingTargetKeys.filter(key => targets[key] === null);
  return { ...base, view: { status: 'settled', state: { targets, bounds: targetBounds, missing, updatedAt: null } } };
}
