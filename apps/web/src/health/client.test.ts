import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthCapabilitiesAccept, healthCapabilitiesVersion, healthQuerySources as sources, healthQuerySourcesV1, healthQuerySourcesV2, healthQuerySourcesV3, healthQuerySourcesV5, healthQuerySourcesV6, healthQuerySourcesV6WithoutTrainingTargets, type HealthQuery } from '@jarvis/contracts';
import { HealthReadError, isHealthResult, loadHealthSources, queryHealth } from './client';
import { healthFixture, jsonResponse } from './test-support';

const query: HealthQuery = { source: sources.metrics, startDate: '2026-10-01', endDate: '2026-10-07', limit: 50 };
const token = async () => 'synthetic-fixture';
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

describe('owner-authenticated Health query client', () => {
  it('validates source, period, coverage, finite values, unknown metadata and the exact cursor shape', () => {
    const value = healthFixture(query, [{ value: 0, unit: 'm' }, { value: null, unit: 'm' }]);
    expect(isHealthResult(value, query)).toBe(true);
    expect(isHealthResult(value, { source: sources.metrics, startDate: query.startDate, endDate: query.endDate })).toBe(true);
    for (const invalid of [
      { ...value, source: sources.meals }, { ...value, period: null },
      { ...value, coverage: { ...value.coverage, returned: 3 } },
      { ...value, items: [{ value: Infinity }, { value: null }] },
      { ...value, freshness: { ...value.freshness, observedAt: 'not-a-time' } },
      { ...value, status: 'partial', coverage: { ...value.coverage, hasMore: true, next: { id: 'wrong-source-cursor' } } },
    ]) expect(isHealthResult(invalid, query)).toBe(false);
    expect(isHealthResult(healthFixture(query, [], { date: query.startDate, key: 'weight' }), query)).toBe(true);
  });
  it('validates metric filtering, catalogue rows and per-day derived nutrient evidence', () => {
    const filtered: HealthQuery = { ...query, source: sources.metrics, metric: 'weight' };
    expect(isHealthResult(healthFixture(filtered, [{ metric_name: 'weight' }]), filtered)).toBe(true);
    expect(isHealthResult(healthFixture(filtered, [{ metric_name: 'steps' }]), filtered)).toBe(false);
    const catalog: HealthQuery = { source: sources.metricCatalog, startDate: query.startDate, endDate: query.endDate };
    const metric = { metric_name: 'weight', units: ['kg', 'lb'], first_date: query.startDate,
      last_date: query.endDate, day_count: 2, latest_updated_at: '2026-10-17T06:00:00Z' };
    expect(isHealthResult(healthFixture(catalog, [metric], { key: 'weight' }), catalog)).toBe(true);
    expect(isHealthResult(healthFixture(catalog, [{ ...metric, units: ['lb', 'kg'] }]), catalog)).toBe(false);
    expect(isHealthResult(healthFixture(catalog, [{ ...metric, units: ['kg', 'lb', 'oz', 'g', 'st', 'm'] }]), catalog)).toBe(false);
    const days: HealthQuery = { source: sources.days, startDate: query.startDate, endDate: query.endDate };
    const total = { meal_date: query.startDate, meal_count: 2, energy_kcal: 240, protein_grams: null,
      carbohydrates_grams: 30, fat_grams: 8, fiber_grams: null, unknown_nutrients: ['protein_grams', 'fiber_grams'],
      partial_nutrients: ['carbohydrates_grams'], latest_updated_at: '2026-10-17T06:00:00Z' };
    expect(isHealthResult(healthFixture(days, [total], { date: query.startDate }), days)).toBe(true);
    expect(isHealthResult(healthFixture(days, [{ ...total, unknown_nutrients: ['protein_grams'], partial_nutrients: ['protein_grams'] }]), days)).toBe(false);
    expect(isHealthResult(healthFixture(days, [{ ...total, meal_count: 0 }]), days)).toBe(false);
  });
  it('validates paginated lift entries, kg units and last-per-exercise results', () => {
    const lifts: HealthQuery = { source: sources.lifts, limit: 10, lastPerExercise: true };
    const entry = {
      id: '33333333-3333-4333-8333-333333333333', exerciseName: 'Bench press', weightKg: 80.29,
      reps: 4, sets: 3, performedAt: '2026-10-17T06:00:00.000Z', deletedAt: null,
      updatedAt: '2026-10-17T06:01:00.000Z', revision: 1,
    };
    const value = healthFixture(lifts, [entry], { performedAt: entry.performedAt, id: entry.id });
    value.units = { weightKg: 'kg', reps: 'reps', sets: 'sets' };
    expect(isHealthResult(value, lifts)).toBe(true);
    expect(isHealthResult({ ...value, units: { ...value.units, weightKg: 'lb' } }, lifts)).toBe(false);
    expect(isHealthResult({ ...value, items: [{ ...entry, weightKg: 80.123 }] }, lifts)).toBe(false);
    expect(isHealthResult({ ...value, items: [{ ...entry, deletedAt: entry.performedAt }] }, lifts)).toBe(false);
  });
  it('uses the existing token supplier, read-only POST, no-store and an abort signal', async () => {
    const value = healthFixture(query, [{ value: 0, unit: 'm' }]);
    const fetch = vi.fn().mockResolvedValue(jsonResponse(value)); vi.stubGlobal('fetch', fetch);
    expect(await queryHealth('http://localhost:3999/', query, token, signal())).toEqual(value);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://localhost:3999/health/query');
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
      return jsonResponse(healthFixture(query));
    });
    vi.stubGlobal('fetch', fetch);
    const first = queryHealth('http://localhost:3999', query, token, signal());
    const second = queryHealth('http://localhost:3999', query, token, signal());
    const controller = new AbortController();
    const third = queryHealth('http://localhost:3999', query, token, controller.signal);
    await twoStarted;
    expect(fetch).toHaveBeenCalledTimes(2);
    controller.abort();
    release();
    await Promise.all([first, second]);
    await expect(third).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('bounds brief detail to one row and validates the exact history cursor without reinterpreting source time', () => {
    const detail: HealthQuery = { source: sources.brief, briefId: ' padded ' };
    expect(isHealthResult(healthFixture(detail, [{ id: ' padded ', started_at: 'unknown timezone', body_json: null }]), detail)).toBe(true);
    expect(isHealthResult(healthFixture(detail, [{ id: 'padded' }]), detail)).toBe(false);
    expect(isHealthResult(healthFixture(detail, [{ id: 'a' }, { id: 'b' }]), detail)).toBe(false);
    const history: HealthQuery = { source: sources.briefs, limit: 1 };
    expect(isHealthResult(healthFixture(history, [{ id: ' padded ' }], { startedAt: 'raw', id: ' padded ' }), history)).toBe(true);
    expect(isHealthResult(healthFixture(history, [{ id: ' padded ' }], { id: 'wrong-family' }), history)).toBe(false);
  });
  it('accepts a bounded workout-detail metric truncation only when it is marked partial', () => {
    const detail: HealthQuery = { source: sources.workout, workoutId: 'synthetic-workout' };
    const partial = healthFixture(detail, [{ id: 'synthetic-workout', detail: {}, additionalMetrics: [], metricsTruncated: true }]);
    partial.status = 'partial';
    partial.coverage.detailMetricsTruncated = true;
    expect(isHealthResult(partial, detail)).toBe(true);
    expect(isHealthResult({ ...partial, status: 'available' }, detail)).toBe(false);
    expect(isHealthResult({ ...partial, coverage: { ...partial.coverage, detailMetricsTruncated: false } }, detail)).toBe(false);
  });
  it.each([401, 403, 404, 503])('surfaces HTTP %s without parsing or displaying provider diagnostics', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ private_detail: 'must-not-escape' }, status)));
    try { await queryHealth('http://localhost:3999', query, token, signal()); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(HealthReadError);
      expect((error as Error).message).not.toContain('must-not-escape');
      if (error instanceof HealthReadError) expect(error.kind).toBe(status === 404 ? 'disabled' : status === 401 || status === 403 ? 'auth' : 'unavailable');
    }
  });
  it('keeps disabled/unavailable capabilities distinct and accepts only known unique source IDs', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ module: 'health', version: healthCapabilitiesVersion, sources: healthQuerySourcesV3 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'health', version: 1, sources: [sources.metrics, sources.metrics] }))
      .mockResolvedValueOnce(jsonResponse({ module: 'health', version: 1, sources: ['arbitrary-provider'] }));
    vi.stubGlobal('fetch', fetch);
    expect(await loadHealthSources('http://localhost:3999', token, signal())).toEqual(healthQuerySourcesV3);
    await expect(loadHealthSources('http://localhost:3999', token, signal())).rejects.toThrow('not available');
    await expect(loadHealthSources('http://localhost:3999', token, signal())).rejects.toThrow('not available');
    await expect(queryHealth(null, query, token, signal())).rejects.toMatchObject({ kind: 'disabled' });
  });
  it('requests v6 first and accepts each earlier version only with its own unchanged source list', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ module: 'health', version: 1, sources: healthQuerySourcesV1 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'health', version: 2, sources: healthQuerySourcesV2 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'health', version: 2, sources: healthQuerySourcesV3 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'health', version: 3, sources: healthQuerySourcesV3 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'health', version: 4, sources: healthQuerySourcesV3 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'health', version: 6, sources: healthQuerySourcesV6WithoutTrainingTargets }))
      .mockResolvedValueOnce(jsonResponse({ module: 'health', version: 6, sources: healthQuerySourcesV6 }))
      .mockResolvedValueOnce(jsonResponse({ module: 'health', version: 5, sources: healthQuerySourcesV5 }));
    vi.stubGlobal('fetch', fetch);
    expect(await loadHealthSources('http://localhost:3999', token, signal())).toEqual(healthQuerySourcesV1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { Accept: healthCapabilitiesAccept } });
    expect(await loadHealthSources('http://localhost:3999', token, signal())).toEqual(healthQuerySourcesV2);
    await expect(loadHealthSources('http://localhost:3999', token, signal())).rejects.toMatchObject({ kind: 'invalid' });
    expect(await loadHealthSources('http://localhost:3999', token, signal())).toEqual(healthQuerySourcesV3);
    expect(await loadHealthSources('http://localhost:3999', token, signal())).toEqual(healthQuerySourcesV3);
    expect(await loadHealthSources('http://localhost:3999', token, signal())).toEqual(healthQuerySourcesV6WithoutTrainingTargets);
    expect(await loadHealthSources('http://localhost:3999', token, signal())).toEqual(healthQuerySourcesV6);
    expect(await loadHealthSources('http://localhost:3999', token, signal())).toEqual(healthQuerySourcesV5);
    expect(fetch).toHaveBeenCalledTimes(8);
  });
  it('does not claim success for oversized or mismatched responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(1024 * 1024 + 1) } }))
      .mockResolvedValueOnce(jsonResponse({ ...healthFixture(query), revision: 'invalid' }))
      .mockResolvedValueOnce(jsonResponse(healthFixture(query, [{ note: 'x'.repeat(1024 * 1024) }])));
    vi.stubGlobal('fetch', fetch);
    await expect(queryHealth('http://localhost:3999', query, token, signal())).rejects.toThrow('oversized');
    await expect(queryHealth('http://localhost:3999', query, token, signal())).rejects.toThrow('mismatched');
    await expect(queryHealth('http://localhost:3999', query, token, signal())).rejects.toThrow('too much data');
  });
});
