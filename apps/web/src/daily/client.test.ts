import { afterEach, describe, expect, it, vi } from 'vitest';
import { dailyCapabilitiesAccept, dailyCapabilitiesVersion, dailyQuerySources as sources, dailyQuerySourcesV1, dailyQuerySourcesV2, dailyQuerySourcesV3, dailyQuerySourcesV4, dailyQuerySourcesV5, dailyQuerySourcesV5WithoutFeeds, dailyQuerySourcesV6, dailyQuerySourcesV6WithoutFeeds, dailyQuerySourcesV6WithoutTrainingTargets, dailyQuerySourcesV6WithoutFeedsOrTrainingTargets, type DailyQuery } from '@jarvis/contracts';
import { DailyReadError, isDailyResult, loadDailySources, queryDaily } from './client';
import { dailyFixture, jsonResponse } from './test-support';

const query: DailyQuery = { source: sources.metrics, startDate: '2026-10-01', endDate: '2026-10-07', limit: 50 };
const token = async () => 'synthetic-fixture';
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

describe('owner-authenticated Daily query client', () => {
  it('validates source, period, coverage, finite values, unknown metadata and the exact cursor shape', () => {
    const value = dailyFixture(query, [{ value: 0, unit: 'm' }, { value: null, unit: 'm' }]);
    expect(isDailyResult(value, query)).toBe(true);
    expect(isDailyResult(value, { source: sources.metrics, startDate: query.startDate, endDate: query.endDate })).toBe(true);
    for (const invalid of [
      { ...value, source: sources.meals }, { ...value, period: null },
      { ...value, coverage: { ...value.coverage, returned: 3 } },
      { ...value, items: [{ value: Infinity }, { value: null }] },
      { ...value, freshness: { ...value.freshness, observedAt: 'not-a-time' } },
      { ...value, status: 'partial', coverage: { ...value.coverage, hasMore: true, next: { id: 'wrong-source-cursor' } } },
    ]) expect(isDailyResult(invalid, query)).toBe(false);
    expect(isDailyResult(dailyFixture(query, [], { date: query.startDate, key: 'weight' }), query)).toBe(true);
  });
  it('validates metric filtering, catalogue rows and per-day derived nutrient evidence', () => {
    const filtered: DailyQuery = { ...query, source: sources.metrics, metric: 'weight' };
    expect(isDailyResult(dailyFixture(filtered, [{ metric_name: 'weight' }]), filtered)).toBe(true);
    expect(isDailyResult(dailyFixture(filtered, [{ metric_name: 'steps' }]), filtered)).toBe(false);
    const catalog: DailyQuery = { source: sources.metricCatalog, startDate: query.startDate, endDate: query.endDate };
    const metric = { metric_name: 'weight', units: ['kg', 'lb'], first_date: query.startDate,
      last_date: query.endDate, day_count: 2, latest_updated_at: '2026-10-17T06:00:00Z' };
    expect(isDailyResult(dailyFixture(catalog, [metric], { key: 'weight' }), catalog)).toBe(true);
    expect(isDailyResult(dailyFixture(catalog, [{ ...metric, units: ['lb', 'kg'] }]), catalog)).toBe(false);
    expect(isDailyResult(dailyFixture(catalog, [{ ...metric, units: ['kg', 'lb', 'oz', 'g', 'st', 'm'] }]), catalog)).toBe(false);
    const days: DailyQuery = { source: sources.days, startDate: query.startDate, endDate: query.endDate };
    const total = { meal_date: query.startDate, meal_count: 2, energy_kcal: 240, protein_grams: null,
      carbohydrates_grams: 30, fat_grams: 8, fiber_grams: null, unknown_nutrients: ['protein_grams', 'fiber_grams'],
      partial_nutrients: ['carbohydrates_grams'], latest_updated_at: '2026-10-17T06:00:00Z' };
    expect(isDailyResult(dailyFixture(days, [total], { date: query.startDate }), days)).toBe(true);
    expect(isDailyResult(dailyFixture(days, [{ ...total, unknown_nutrients: ['protein_grams'], partial_nutrients: ['protein_grams'] }]), days)).toBe(false);
    expect(isDailyResult(dailyFixture(days, [{ ...total, meal_count: 0 }]), days)).toBe(false);
  });
  it('validates paginated lift entries, kg units and last-per-exercise results', () => {
    const lifts: DailyQuery = { source: sources.lifts, limit: 10, lastPerExercise: true };
    const entry = {
      id: '33333333-3333-4333-8333-333333333333', exerciseName: 'Bench press', weightKg: 80.29,
      reps: 4, sets: 3, performedAt: '2026-10-17T06:00:00.000Z', deletedAt: null,
      updatedAt: '2026-10-17T06:01:00.000Z', revision: 1,
    };
    const value = dailyFixture(lifts, [entry], { performedAt: entry.performedAt, id: entry.id });
    value.units = { weightKg: 'kg', reps: 'reps', sets: 'sets' };
    expect(isDailyResult(value, lifts)).toBe(true);
    expect(isDailyResult({ ...value, units: { ...value.units, weightKg: 'lb' } }, lifts)).toBe(false);
    expect(isDailyResult({ ...value, items: [{ ...entry, weightKg: 80.123 }] }, lifts)).toBe(false);
    expect(isDailyResult({ ...value, items: [{ ...entry, deletedAt: entry.performedAt }] }, lifts)).toBe(false);
  });
  it('uses the existing token supplier, read-only POST, no-store and an abort signal', async () => {
    const value = dailyFixture(query, [{ value: 0, unit: 'm' }]);
    const fetch = vi.fn().mockResolvedValue(jsonResponse(value)); vi.stubGlobal('fetch', fetch);
    expect(await queryDaily('http://localhost:3999/', query, token, signal())).toEqual(value);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://localhost:3999/daily/query');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', body: JSON.stringify(query), headers: { Authorization: ['Bearer', 'synthetic-fixture'].join(' ') } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('limits overview and section reads to two and removes an aborted queued request', async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const twoStarted = new Promise<void>(resolve => { started = resolve; });
    const fetch = vi.fn(async () => {
      if (fetch.mock.calls.length === 2) started();
      await gate;
      return jsonResponse(dailyFixture(query));
    });
    vi.stubGlobal('fetch', fetch);
    const first = queryDaily('http://localhost:3999', query, token, signal());
    const second = queryDaily('http://localhost:3999', query, token, signal());
    const controller = new AbortController();
    const third = queryDaily('http://localhost:3999', query, token, controller.signal);
    await twoStarted;
    expect(fetch).toHaveBeenCalledTimes(2);
    controller.abort();
    release();
    await Promise.all([first, second]);
    await expect(third).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('bounds brief detail to one row and validates the exact history cursor without reinterpreting source time', () => {
    const detail: DailyQuery = { source: sources.brief, briefId: ' padded ' };
    expect(isDailyResult(dailyFixture(detail, [{ id: ' padded ', started_at: 'unknown timezone', body_json: null }]), detail)).toBe(true);
    expect(isDailyResult(dailyFixture(detail, [{ id: 'padded' }]), detail)).toBe(false);
    expect(isDailyResult(dailyFixture(detail, [{ id: 'a' }, { id: 'b' }]), detail)).toBe(false);
    const history: DailyQuery = { source: sources.briefs, limit: 1 };
    expect(isDailyResult(dailyFixture(history, [{ id: ' padded ' }], { startedAt: 'raw', id: ' padded ' }), history)).toBe(true);
    expect(isDailyResult(dailyFixture(history, [{ id: ' padded ' }], { id: 'wrong-family' }), history)).toBe(false);
  });
  it('accepts a bounded workout-detail metric truncation only when it is marked partial', () => {
    const detail: DailyQuery = { source: sources.workout, workoutId: 'synthetic-workout' };
    const partial = dailyFixture(detail, [{ id: 'synthetic-workout', detail: {}, additionalMetrics: [], metricsTruncated: true }]);
    partial.status = 'partial';
    partial.coverage.detailMetricsTruncated = true;
    expect(isDailyResult(partial, detail)).toBe(true);
    expect(isDailyResult({ ...partial, status: 'available' }, detail)).toBe(false);
    expect(isDailyResult({ ...partial, coverage: { ...partial.coverage, detailMetricsTruncated: false } }, detail)).toBe(false);
  });
  it.each([401, 403, 404, 503])('surfaces HTTP %s without parsing or displaying provider diagnostics', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ private_detail: 'must-not-escape' }, status)));
    try { await queryDaily('http://localhost:3999', query, token, signal()); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(DailyReadError);
      expect((error as Error).message).not.toContain('must-not-escape');
      if (error instanceof DailyReadError) expect(error.kind).toBe(status === 404 ? 'disabled' : status === 401 || status === 403 ? 'auth' : 'unavailable');
    }
  });
  it('keeps disabled/unavailable capabilities distinct and accepts only known unique source IDs', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: dailyCapabilitiesVersion, sources: dailyQuerySourcesV4 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 1, sources: [sources.metrics, sources.metrics] }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 1, sources: ['arbitrary-provider'] }));
    vi.stubGlobal('fetch', fetch);
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV4);
    await expect(loadDailySources('http://localhost:3999', token, signal())).rejects.toThrow('not available');
    await expect(loadDailySources('http://localhost:3999', token, signal())).rejects.toThrow('not available');
    await expect(queryDaily(null, query, token, signal())).rejects.toMatchObject({ kind: 'disabled' });
  });
  it('requests v6 first and accepts each earlier version only with its own unchanged source list', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 1, sources: dailyQuerySourcesV1 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 2, sources: dailyQuerySourcesV2 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 2, sources: dailyQuerySourcesV3 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 3, sources: dailyQuerySourcesV3 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 3, sources: dailyQuerySourcesV4 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 4, sources: dailyQuerySourcesV3 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 4, sources: dailyQuerySourcesV4 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 6, sources: dailyQuerySourcesV6WithoutFeedsOrTrainingTargets }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 6, sources: dailyQuerySourcesV6WithoutTrainingTargets }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 6, sources: dailyQuerySourcesV6WithoutFeeds }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 6, sources: dailyQuerySourcesV6 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 5, sources: dailyQuerySourcesV5WithoutFeeds }))
      .mockResolvedValueOnce(jsonResponse({ module: 'daily', version: 5, sources: dailyQuerySourcesV5 }));
    vi.stubGlobal('fetch', fetch);
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { Accept: dailyCapabilitiesAccept } });
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV2);
    await expect(loadDailySources('http://localhost:3999', token, signal())).rejects.toMatchObject({ kind: 'invalid' });
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV3);
    await expect(loadDailySources('http://localhost:3999', token, signal())).rejects.toMatchObject({ kind: 'invalid' });
    // A v4 answer without the feed sources is what the backend sends while the feeds are off.
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV3);
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV4);
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV6WithoutFeedsOrTrainingTargets);
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV6WithoutTrainingTargets);
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV6WithoutFeeds);
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV6);
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV5WithoutFeeds);
    expect(await loadDailySources('http://localhost:3999', token, signal())).toEqual(dailyQuerySourcesV5);
    expect(fetch).toHaveBeenCalledTimes(13);
  });
  it('does not claim success for oversized or mismatched responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(1024 * 1024 + 1) } }))
      .mockResolvedValueOnce(jsonResponse({ ...dailyFixture(query), revision: 'invalid' }))
      .mockResolvedValueOnce(jsonResponse(dailyFixture(query, [{ note: 'x'.repeat(1024 * 1024) }])));
    vi.stubGlobal('fetch', fetch);
    await expect(queryDaily('http://localhost:3999', query, token, signal())).rejects.toThrow('oversized');
    await expect(queryDaily('http://localhost:3999', query, token, signal())).rejects.toThrow('mismatched');
    await expect(queryDaily('http://localhost:3999', query, token, signal())).rejects.toThrow('too much data');
  });
});
