import type { DailyCursor, DailyJson, DailyQuery, DailyQueryResult } from '@jarvis/contracts';

export function dailyFixture(query: DailyQuery, items: Record<string, DailyJson>[] = [], next: DailyCursor | null = null): DailyQueryResult {
  return {
    source: query.source,
    period: 'startDate' in query ? { startDate: query.startDate, endDate: query.endDate, timeZone: 'Europe/Copenhagen' } : null,
    items, status: next ? 'partial' : items.length ? 'available' : 'empty',
    units: query.source.startsWith('daily.nutrition.') ? { energy_kcal: 'kcal', '*_grams': 'g' } :
      query.source === 'daily.health.sleep' ? { '*_hours': 'h' } :
        query.source === 'daily.health.workouts' ? { duration_seconds: 's', '*_unit': 'retained per-record unit', '*_heart_rate': 'bpm' } :
          { unit: 'retained per-record unit' },
    provenance: { store: 'daily-sql', detail: 'retained-record', calculations: 'existing-read-model', consistency: 'independent-committed-reads' },
    freshness: { observedAt: '2026-10-17T07:00:00Z', sourceProcessedCommittedAt: null, latestReturnedRecordUpdatedAt: null, staleness: 'unknown' },
    coverage: { returned: items.length, hasMore: next !== null, next, sourceCompleteness: 'unknown' },
    revision: 'a'.repeat(64),
  };
}
export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
