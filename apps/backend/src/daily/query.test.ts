import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { dailyQuerySources as sources, type DailyJson } from '@jarvis/contracts';
import { DailyQueryService, dailyResultByteLimit, type DailyReaders } from './query.js';
import { dailyQueryTool } from './tools/query.js';
import { createToolRegistry } from '../core/tool-registry.js';
import Fastify from 'fastify';
import { createDailyModules } from './index.js';
import { createDailyChanges } from './revisions.js';
import { createEventHub } from '../core/event-hub.js';
import type { NowFeedUpdate } from '../core/now.js';
import { canonicalJson } from './nutrition/model.js';
import { healthInboxByteLimit, healthInboxRowLimit } from './health-upload/sql-buffer.js';

const owner = '11111111-1111-4111-8111-111111111111';
const request = (extra = {}) => ({ server: { ownerObjectId: owner }, principal: { objectId: owner }, ...extra }) as FastifyRequest;
const input = { source: sources.metrics, startDate: '2026-10-01', endDate: '2026-10-16' };
const signal = () => new AbortController().signal;
function fixture() {
  let clock = Date.parse('2026-10-16T07:30:00Z');
  const history = vi.fn().mockResolvedValue({ items: [{ metric_name: 'waist_circumference', metric_date: '2026-10-16',
    value: 0.88, unit: 'm', min_value: null, ingestion_id: 'synthetic-ingestion', updated_at: '2026-10-16T07:00:00Z',
    owner_object_id: owner, raw_bytes: 'must-not-escape' }], next: null });
  const metricCatalog = vi.fn().mockResolvedValue({ items: [{
    metric_name: 'weight', units: ['kg', 'lb'], first_date: '2026-10-01', last_date: '2026-10-16',
    day_count: 2, latest_updated_at: '2026-10-16T07:00:00Z',
  }], next: null });
  const sync = vi.fn().mockResolvedValue({
    feeds: [{ feed_kind: 'metrics', accepted_evidence_at: '2026-10-16T07:00:00Z', processed_committed_at: '2026-10-16T07:05:00Z' }],
    heartbeat: { last_received_at: '2026-10-16T07:29:00Z' }, inbox: { pending: 1, quarantined: 0 },
  });
  const workoutDetail = vi.fn().mockResolvedValue({ id: '01', detail: { activity: 'synthetic' } });
  const workoutMetrics = vi.fn().mockResolvedValue({ items: [], truncated: false });
  const heartRate = vi.fn().mockResolvedValue({ items: [{ sample_minute: '2026-10-16T07:00:00Z', metric_name: 'heart_rate', unit: 'bpm', avg_value: 90 }], next: null });
  const targetRead = vi.fn().mockResolvedValue({
    targets: { gymSessionsPerWeek: 0, runSessionsPerWeek: null, dailySteps: null },
    updatedAt: '2026-10-16T07:00:00.000Z',
  });
  const meals = vi.fn().mockResolvedValue({ rows: [{ id: '01', meal_date: new Date('2026-10-16'), energy_kcal: 123, protein_grams: null,
    components_json: '[]', nutrient_provenance_json: '{"kind":"synthetic-label"}', revision: 2n, deleted_at: null,
    owner_object_id: owner, apple_health_claim_token_hash: 'must-not-escape' }], next: null });
  const days = vi.fn().mockResolvedValue({ rows: [{
    meal_date: new Date('2026-10-16'), meal_count: 2, energy_kcal: 123, protein_grams: null,
    carbohydrates_grams: 20, fat_grams: 3, fiber_grams: null, unknown_nutrients: ['protein_grams'],
    partial_nutrients: ['energy_kcal', 'carbohydrates_grams'], latest_updated_at: '2026-10-16T07:00:00Z',
    owner_object_id: owner, internal_metadata: 'must-not-escape',
  }], next: null });
  const favorites = vi.fn().mockResolvedValue({ rows: [{ id: '001', favorite_name: 'Synthetic favourite',
    aliases_json: '["Raw Alias"]', energy_kcal: 123, protein_grams: null, components_json: '[]',
    nutrient_provenance_json: '{"kind":"synthetic-label"}', owner_object_id: owner,
    updated_at: '2026-10-16T07:00:00Z', internal_metadata: 'must-not-escape' }], nextId: null });
  const plans = vi.fn().mockResolvedValue({ rows: [{ id: 'plan-01', plan_name: 'Synthetic plan',
    items_json: '[{"favoriteId":"001","nutrients":{"energyKcal":123,"proteinGrams":null}}]',
    energy_kcal: 369, protein_grams: null, revision: 2n, deleted_at: '2026-10-16T07:20:00Z',
    owner_object_id: owner, updated_at: '2026-10-16T07:20:00Z', internal_metadata: 'must-not-escape' }], nextId: null });
  const briefHistory = vi.fn().mockResolvedValue({ items: [{ id: ' synthetic-brief ', trigger: 'manual',
    started_at: '2026-10-16T07:00:00', status: 'completed', delivery_status: 'not_requested',
    updated_at: 'legacy-unverified-time', owner_object_id: owner, body_json: '"not-a-list-field"',
    source_snapshots_json: '{"credential":"must-not-escape"}' }], next: null });
  const briefDetail = vi.fn().mockResolvedValue({ id: ' synthetic-brief ', trigger: 'manual',
    started_at: '2026-10-16T07:00:00', status: 'completed', delivery_status: 'not_requested',
    preview_text: 'Synthetic historic brief', body_json: '{"sections":[{"text":"Synthetic stored body"}]}',
    updated_at: 'legacy-unverified-time', owner_object_id: owner,
    source_snapshots_json: '{"credential":"must-not-escape"}', delivery_evidence_json: '{"token":"must-not-escape"}' });
  const readers: DailyReaders = {
    health: vi.fn(() => ({ history, metricCatalog, sync, workoutDetail, workoutMetrics, heartRate })),
    nutrition: vi.fn(() => ({ history: meals, days, favorites, plans })),
    briefs: vi.fn(() => ({ history: briefHistory, detail: briefDetail })),
    trainingTargets: vi.fn(() => ({ read: targetRead })),
  };
  return { service: new DailyQueryService(readers, () => clock), advance: () => { clock += 60000; }, readers, history, metricCatalog, sync, workoutDetail, workoutMetrics, heartRate, targetRead, meals, days, favorites, plans, briefHistory, briefDetail };
}
describe('one shared Daily read contract', () => {
  it('shares historical brief metadata/body through HTTP and the same sensitive tool, without interpreting time or delivering', async () => {
    const f = fixture();
    const query = { source: sources.briefs, limit: 1, cursor: { startedAt: 'raw stored time', id: ' previous ' } };
    const tool = dailyQueryTool(f.service);
    const result = await f.service.query(query, request(), signal());
    expect(await tool.execute(query, request(), signal())).toEqual(result);
    expect(tool.sensitive).toBe(true);
    expect(result).toMatchObject({ period: null, units: {}, status: 'available',
      freshness: { sourceProcessedCommittedAt: null, latestReturnedRecordUpdatedAt: null, staleness: 'unknown' } });
    expect(result.items[0]).toMatchObject({ id: ' synthetic-brief ', started_at: '2026-10-16T07:00:00', updated_at: 'legacy-unverified-time' });
    expect(result.items[0]).not.toHaveProperty('body_json');
    expect(f.briefHistory).toHaveBeenLastCalledWith({ limit: 1, after: query.cursor }, expect.any(AbortSignal));
    const detailQuery = { source: sources.brief, briefId: ' synthetic-brief ' };
    const detail = await f.service.query(detailQuery, request(), signal());
    expect(detail.items[0]).toMatchObject({ preview_text: 'Synthetic historic brief', body_json: { sections: [{ text: 'Synthetic stored body' }] } });
    expect(f.briefDetail).toHaveBeenLastCalledWith(' synthetic-brief ', expect.any(AbortSignal));
    expect(JSON.stringify(detail)).not.toContain('must-not-escape');
    expect(JSON.stringify(detail)).not.toContain(owner);
    expect(f.readers.health).not.toHaveBeenCalled();
    expect(f.readers.nutrition).not.toHaveBeenCalled();
    const app = Fastify();
    app.decorate('ownerObjectId', owner);
    app.decorateRequest('principal', null);
    app.addHook('onRequest', async req => { req.principal = { objectId: owner, tenantId: owner, displayName: 'Synthetic' }; });
    for (const module of createDailyModules(true, { query: f.service, changes: createDailyChanges() })) app.register(module.registerRoutes);
    try {
      for (const input of [query, detailQuery]) {
        const response = await app.inject({ method: 'POST', url: '/daily/query', payload: input });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(await tool.execute(input, request(), signal()));
      }
      for (const input of [{ ...detailQuery, briefId: null }, { ...detailQuery, owner },
        { ...query, startDate: '2026-10-01' }, { ...query, cursor: { ...query.cursor, owner } }]) {
        expect((await app.inject({ method: 'POST', url: '/daily/query', payload: input })).statusCode).toBe(400);
      }
    } finally { await app.close(); }
  });
  it('keeps brief paging/revisions and missing or failed detail honest', async () => {
    const f = fixture();
    const first = await f.briefHistory();
    f.briefHistory.mockResolvedValue({ ...first, next: { startedAt: '2026-10-16T07:00:00', id: ' synthetic-brief ' } });
    const result = await f.service.query({ source: sources.briefs }, request(), signal());
    expect(result).toMatchObject({ status: 'partial', coverage: { hasMore: true, next: { startedAt: '2026-10-16T07:00:00', id: ' synthetic-brief ' } } });
    f.advance();
    expect((await f.service.query({ source: sources.briefs }, request(), signal())).revision).toBe(result.revision);
    f.briefDetail.mockResolvedValue(null);
    expect(await f.service.query({ source: sources.brief, briefId: 'missing' }, request(), signal())).toMatchObject({ status: 'empty', items: [] });
    f.briefDetail.mockRejectedValue(new Error('synthetic-private'));
    await expect(f.service.query({ source: sources.brief, briefId: 'missing' }, request(), signal())).rejects.toThrow('Health data is unavailable');
  });
  it('rejects the nutrition-only connector at the shared brief boundary before any reader is invoked', async () => {
    const f = fixture();
    const connector = request({ principal: undefined, dailyConnectorPrincipal: { kind: 'jarvis-daily-connector', objectId: owner } });
    for (const query of [{ source: sources.briefs }, { source: sources.brief, briefId: 'id' }]) {
      await expect(f.service.query(query, connector, signal())).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(f.readers.briefs).not.toHaveBeenCalled();
    expect(f.readers.health).not.toHaveBeenCalled();
    expect(f.readers.nutrition).not.toHaveBeenCalled();
  });
  it('round-trips the real HTTP/module contract with a synthetic principal (not root-token acceptance)', async () => {
    const f = fixture(); const changes = createDailyChanges(); const hub = createEventHub<NowFeedUpdate>();
    const app = Fastify();
    app.decorate('ownerObjectId', owner);
    app.decorate('nowEventHub', hub);
    app.decorateRequest('principal', null);
    app.addHook('onRequest', async req => { req.principal = { objectId: owner, tenantId: owner, displayName: 'Synthetic' }; });
    for (const module of createDailyModules(true, { query: f.service, changes })) app.register(module.registerRoutes);
    const publish = vi.spyOn(hub, 'publish');
    try {
      const response = await app.inject({ method: 'POST', url: '/daily/query', payload: input });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual(await f.service.query(input, request(), signal()));
      for (const source of [sources.favorites, sources.plans]) {
        const query = { source, limit: 1, cursor: { id: '000' } };
        const collection = await app.inject({ method: 'POST', url: '/daily/query', payload: query });
        expect(collection.statusCode).toBe(200);
        expect(collection.json()).toEqual(await f.service.query(query, request(), signal()));
        expect((await app.inject({ method: 'POST', url: '/daily/query',
          payload: { ...query, cursor: { id: '000', createdAt: '2026-10-15T00:00:00Z' } } })).statusCode).toBe(400);
      }
      for (const payload of [{ ...input, owner }, { ...input, cursor: { date: '2026-10-15', key: 'weight', owner } }]) {
        expect((await app.inject({ method: 'POST', url: '/daily/query', payload })).statusCode).toBe(400);
      }
      changes.publish({ owner, sources: [sources.metrics] });
      expect(publish).toHaveBeenCalledExactlyOnceWith({ type: 'refresh' });
      f.sync.mockRejectedValue(new Error('synthetic-private'));
      const failed = await app.inject({ method: 'POST', url: '/daily/query', payload: input });
      expect(failed.statusCode).toBe(503); expect(failed.body).not.toContain('synthetic-private');
    } finally { await app.close(); }
    changes.publish({ owner, sources: [sources.metrics] });
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it('preserves recorded waist, canonical units, lineage, nulls and committed rather than heartbeat freshness', async () => {
    const f = fixture();
    const result = await f.service.query(input, request(), signal());
    expect(result.source).toBe(sources.metrics);
    expect(result.period).toEqual({ startDate: input.startDate, endDate: input.endDate, timeZone: 'Europe/Copenhagen' });
    expect(result.items[0]).toMatchObject({ value: 0.88, unit: 'm', min_value: null, ingestion_id: 'synthetic-ingestion' });
    expect(result.freshness).toMatchObject({ sourceProcessedCommittedAt: '2026-10-16T07:05:00.000Z', staleness: 'unknown' });
    expect(result.coverage.sourceCompleteness).toBe('unknown');
    expect(result.provenance).toMatchObject({ calculations: 'existing-read-model', consistency: 'independent-committed-reads' });
    expect(JSON.stringify(result)).not.toContain('must-not-escape');
    expect(JSON.stringify(result)).not.toContain(owner);
    f.advance();
    expect((await f.service.query(input, request(), signal())).revision).toBe(result.revision);
    f.sync.mockResolvedValue({ feeds: [{ feed_kind: 'metrics', processed_committed_at: '2026-10-16T07:05:00Z' }],
      heartbeat: { last_received_at: '2026-10-16T07:31:00Z' }, inbox: {} });
    expect((await f.service.query(input, request(), signal())).revision).toBe(result.revision);
    f.sync.mockResolvedValue({ feeds: [], heartbeat: { last_received_at: '2026-10-16T07:31:00Z' }, inbox: {} });
    expect((await f.service.query(input, request(), signal())).freshness.sourceProcessedCommittedAt).toBeNull();
  });
  it('reads explicit owner training targets through the registered daily_query handler', async () => {
    const f = fixture();
    const data = { query: f.service, changes: createDailyChanges(),
      trainingTargets: () => ({ read: f.targetRead, write: vi.fn() }) };
    const module = createDailyModules(true, data)[0]!;
    const tool = createToolRegistry([module]).get('daily_query')!;
    expect(tool.description).toMatch(/intent in Danish or English/iu);
    expect(tool.description).toMatch(/measurement history for the requested period and trainingTargets/iu);
    const query = { source: sources.trainingTargets };
    const result = await tool.execute(query, request(), signal());
    expect(result).toMatchObject({
      source: sources.trainingTargets, period: null, status: 'available',
      items: [{ targets: { gymSessionsPerWeek: 0, runSessionsPerWeek: null, dailySteps: null },
        missing: ['runSessionsPerWeek', 'dailySteps'], updatedAt: '2026-10-16T07:00:00.000Z' }],
      units: { gymSessionsPerWeek: 'sessions/week', runSessionsPerWeek: 'sessions/week', dailySteps: 'steps/day' },
      freshness: { latestReturnedRecordUpdatedAt: '2026-10-16T07:00:00.000Z', staleness: 'unknown' },
      coverage: { sourceCompleteness: 'unknown' },
    });
    await expect(tool.execute(query, request({ principal: { objectId: '22222222-2222-4222-8222-222222222222' } }), signal()))
      .rejects.toThrow();
    expect(f.targetRead).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(owner);
    expect(createDailyModules(false, data)).toEqual([]);

    f.targetRead.mockResolvedValueOnce({
      targets: { gymSessionsPerWeek: null, runSessionsPerWeek: null, dailySteps: 8_500 },
      updatedAt: '2026-10-17T07:00:00.000Z',
    });
    const configured = await tool.execute(query, request(), signal());
    expect(configured).toMatchObject({
      items: [{ targets: { dailySteps: 8_500 }, missing: ['gymSessionsPerWeek', 'runSessionsPerWeek'] }],
    });
    expect(f.targetRead).toHaveBeenCalledTimes(2);

    f.history.mockResolvedValueOnce({ items: [{
      metric_name: 'step_count', metric_date: '2026-10-17', value: 7_200, unit: 'count',
      avg_value: null, updated_at: '2026-10-17T07:00:00Z',
    }], next: null });
    const steps = await tool.execute({
      source: sources.metrics, startDate: '2026-10-17', endDate: '2026-10-17', metric: 'step_count',
    }, request(), signal());
    expect(steps).toMatchObject({
      period: { startDate: '2026-10-17', endDate: '2026-10-17', timeZone: 'Europe/Copenhagen' },
      items: [{ metric_name: 'step_count', metric_date: '2026-10-17', value: 7_200, unit: 'count' }],
    });
    expect(f.history).toHaveBeenLastCalledWith('metrics', {
      startDate: '2026-10-17', endDate: '2026-10-17', metric: 'step_count', limit: 50,
    }, expect.any(AbortSignal));
  });
  it('filters one exact measurement and exposes a paged metric catalogue with sorted mixed units', async () => {
    const f = fixture();
    const filtered = await f.service.query({ ...input, metric: 'waist_circumference', limit: 1,
      cursor: { date: '2026-10-15', key: 'waist_circumference' } }, request(), signal());
    expect(f.history).toHaveBeenCalledWith('metrics', {
      startDate: input.startDate, endDate: input.endDate, limit: 1, metric: 'waist_circumference',
      after: { date: '2026-10-15', key: 'waist_circumference' },
    }, expect.any(AbortSignal));
    expect(filtered.items[0]).toHaveProperty('metric_name', 'waist_circumference');
    const catalogQuery = { source: sources.metricCatalog, startDate: input.startDate, endDate: input.endDate, limit: 1, cursor: { key: 'steps' } } as const;
    f.metricCatalog.mockResolvedValue({ items: [{ metric_name: 'weight', units: ['kg', 'lb'], first_date: '2026-10-01',
      last_date: '2026-10-16', day_count: 2, latest_updated_at: '2026-10-16T07:00:00Z' }], next: { key: 'weight' } });
    const catalog = await f.service.query(catalogQuery, request(), signal());
    expect(f.metricCatalog).toHaveBeenCalledWith({
      startDate: input.startDate, endDate: input.endDate, limit: 1, after: { key: 'steps' },
    }, expect.any(AbortSignal));
    expect(catalog.items[0]).toMatchObject({ metric_name: 'weight', units: ['kg', 'lb'], day_count: 2 });
    expect(catalog).toMatchObject({ coverage: { hasMore: true, next: { key: 'weight' } },
      freshness: { latestReturnedRecordUpdatedAt: '2026-10-16T07:00:00.000Z' },
      provenance: { calculations: 'existing-read-model' } });
  });
  it('applies readable measurement filters to heart-rate pages before their limit', async () => {
    const f = fixture();
    const query = { source: sources.heartRate, workoutId: 'workout-synthetic', metric: 'Heart rate', limit: 1 } as const;
    const result = await f.service.query(query, request(), signal());
    expect(f.heartRate).toHaveBeenCalledWith('workout-synthetic', {
      limit: 1, metric: 'Heart rate',
    }, expect.any(AbortSignal));
    expect(result.items).toMatchObject([{ metric_name: 'heart_rate', avg_value: 90 }]);
    expect(result.coverage).toMatchObject({ returned: 1, hasMore: false, next: null });
  });
  it('returns retained-meal day totals with null, partial and complete nutrients and derived provenance', async () => {
    const f = fixture();
    const query = { source: sources.days, startDate: input.startDate, endDate: input.endDate, limit: 50 } as const;
    const result = await f.service.query(query, request(), signal());
    expect(f.days).toHaveBeenCalledWith({ from: input.startDate, to: input.endDate, limit: 50 }, expect.any(AbortSignal));
    expect(result.items[0]).toMatchObject({
      meal_date: '2026-10-16', meal_count: 2, energy_kcal: 123, protein_grams: null,
      unknown_nutrients: ['protein_grams'], partial_nutrients: ['energy_kcal', 'carbohydrates_grams'],
      latest_updated_at: '2026-10-16T07:00:00Z',
    });
    expect(result).toMatchObject({
      provenance: { calculations: 'derived-from-retained-meals' },
      freshness: { latestReturnedRecordUpdatedAt: '2026-10-16T07:00:00.000Z', staleness: 'unknown' },
      coverage: { sourceCompleteness: 'unknown', hasMore: false, next: null },
    });
    expect(JSON.stringify(result)).not.toContain(owner);
    expect(JSON.stringify(result)).not.toContain('internal_metadata');
  });
  it('preserves meal tombstones, unknown macros and revisions without exposing device metadata or inventing totals', async () => {
    const f = fixture();
    const result = await f.service.query({ ...input, source: sources.meals }, request(), signal());
    expect(result.items[0]).toMatchObject({ id: '01', meal_date: '2026-10-16', energy_kcal: 123, protein_grams: null, revision: '2', components_json: [] });
    expect(result.units.energy_kcal).toBe('kcal');
    expect(result.freshness.sourceProcessedCommittedAt).toBeNull();
    expect(JSON.stringify(result)).not.toContain('claim_token');
    expect(f.readers.health).not.toHaveBeenCalled();
    f.meals.mockResolvedValue({ rows: [{ id: '01', revision: 3n, energy_kcal: 123, protein_grams: null,
      deleted_at: '2026-10-16T07:20:00Z' }], next: null });
    const deleted = await f.service.query({ ...input, source: sources.meals }, request(), signal());
    expect(deleted.items[0]).toMatchObject({ id: '01', revision: '3', deleted_at: '2026-10-16T07:20:00Z', energy_kcal: 123, protein_grams: null });
    expect(deleted.revision).not.toBe(result.revision);
  });
  it('pages retained favourites by exact ID while preserving aliases, unknowns and provenance', async () => {
    const f = fixture();
    const page = await f.favorites();
    f.favorites.mockResolvedValue({ ...page, nextId: '001' });
    const result = await f.service.query({ source: sources.favorites, limit: 1 }, request(), signal());
    expect(result.items[0]).toMatchObject({ id: '001', aliases_json: ['Raw Alias'], components_json: [],
      nutrient_provenance_json: { kind: 'synthetic-label' }, energy_kcal: 123, protein_grams: null });
    expect(result).toMatchObject({ period: null, status: 'partial', units: { energy_kcal: 'kcal', '*_grams': 'g' },
      freshness: { sourceProcessedCommittedAt: null, latestReturnedRecordUpdatedAt: '2026-10-16T07:00:00.000Z', staleness: 'unknown' },
      coverage: { hasMore: true, next: { id: '001' }, sourceCompleteness: 'unknown' } });
    expect(JSON.stringify(result)).not.toContain(owner);
    expect(JSON.stringify(result)).not.toContain('must-not-escape');
    await f.service.query({ source: sources.favorites, cursor: { id: '001' } }, request(), signal());
    expect(f.favorites).toHaveBeenLastCalledWith({ limit: 50, afterId: '001' }, expect.any(AbortSignal));
    expect(f.readers.health).not.toHaveBeenCalled();
    expect(f.meals).not.toHaveBeenCalled();
  });
  it('reads retained plan snapshots and tombstones without treating plans as consumed meals', async () => {
    const f = fixture();
    const result = await f.service.query({ source: sources.plans }, request(), signal());
    expect(result.items[0]).toMatchObject({ id: 'plan-01', revision: '2', energy_kcal: 369, protein_grams: null,
      items_json: [{ favoriteId: '001', nutrients: { energyKcal: 123, proteinGrams: null } }],
      deleted_at: '2026-10-16T07:20:00Z' });
    expect(result).toMatchObject({ period: null, status: 'available', coverage: { hasMore: false, next: null, sourceCompleteness: 'unknown' } });
    expect(JSON.stringify(result)).not.toContain(owner);
    expect(JSON.stringify(result)).not.toContain('must-not-escape');
    expect(f.plans).toHaveBeenCalledExactlyOnceWith({ limit: 50 }, expect.any(AbortSignal));
    expect(f.readers.health).not.toHaveBeenCalled();
    expect(f.meals).not.toHaveBeenCalled();
  });
  it('fingerprints the maximum 500-row/19-field workout page without importing nutrition write complexity limits', async () => {
    const f = fixture();
    const rows = Array.from({ length: 500 }, (_, index) => ({
      id: `synthetic-${index}`, workout_type: 'walking', activity_identifier: 'walking', workout_date: '2026-10-16',
      start_at: '2026-10-16T06:00:00Z', end_at: '2026-10-16T06:30:00Z', duration_seconds: 1800,
      source_name: 'Synthetic', is_indoor: false, active_energy_value: 100, active_energy_unit: 'kcal',
      total_energy_value: null, total_energy_unit: null, distance_value: 2000, distance_unit: 'm',
      avg_heart_rate: 90, max_heart_rate: 120, ingestion_id: 'synthetic-ingestion', updated_at: '2026-10-16T07:00:00Z',
    }));
    expect(Object.keys(rows[0]!)).toHaveLength(19);
    expect(() => canonicalJson(rows)).toThrow('limits');
    f.history.mockResolvedValue({ items: rows, next: null });
    const query = { ...input, source: sources.workouts, limit: 500 };
    const result = await f.service.query(query, request(), signal());
    expect(result.coverage).toMatchObject({ returned: 500, hasMore: false });
    expect(result.items).toEqual(rows);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/u);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(dailyResultByteLimit);
    f.advance();
    f.history.mockResolvedValue({ items: rows.map(row => Object.fromEntries(Object.entries(row).reverse())), next: null });
    expect((await f.service.query(query, request(), signal())).revision).toBe(result.revision);
    f.history.mockResolvedValue({ items: rows.map((row, index) => index ? row : { ...row, avg_heart_rate: 91 }), next: null });
    expect((await f.service.query(query, request(), signal())).revision).not.toBe(result.revision);
  });
  it('fingerprints retained nested workout detail independently of write depth and object/query key order', async () => {
    const f = fixture(); let detail: DailyJson = { b: 2, a: 1 };
    for (let depth = 0; depth < 20; depth++) detail = { nested: detail };
    expect(() => canonicalJson(detail)).toThrow('limits');
    f.workoutDetail.mockResolvedValue({ id: '01', detail });
    const result = await f.service.query({ source: sources.workout, workoutId: '01' }, request(), signal());
    expect(result.items).toEqual([{ id: '01', detail, additionalMetrics: [], metricsTruncated: false }]);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/u);
    let reordered: DailyJson = { a: 1, b: 2 };
    for (let depth = 0; depth < 20; depth++) reordered = { nested: reordered };
    f.workoutDetail.mockResolvedValue({ id: '01', detail: reordered }); f.advance();
    expect((await f.service.query({ workoutId: '01', source: sources.workout }, request(), signal())).revision).toBe(result.revision);
  });
  it('retains per-write-valid meal provenance when the read envelope adds nesting depth', async () => {
    const f = fixture(); let provenance: DailyJson = { b: 2, a: 1 };
    for (let depth = 0; depth < 15; depth++) provenance = { nested: provenance };
    expect(() => canonicalJson(provenance)).not.toThrow();
    f.meals.mockResolvedValue({ rows: [{ id: '01', nutrient_provenance_json: JSON.stringify(provenance) }], next: null });
    const result = await f.service.query({ ...input, source: sources.meals }, request(), signal());
    expect(result.items[0]).toEqual({ id: '01', nutrient_provenance_json: provenance });
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/u);
  });
  it('accepts exactly the UTF-8 response budget including the 64-byte revision and refuses one extra byte', async () => {
    const f = fixture(); const query = { source: sources.workout, workoutId: '01' };
    f.workoutDetail.mockResolvedValue({ id: '01', detail: { activity: '' } });
    const empty = await f.service.query(query, request(), signal());
    const remaining = dailyResultByteLimit - Buffer.byteLength(JSON.stringify(empty));
    const activity = '\u00f8'.repeat(Math.floor(remaining / 2)) + 'x'.repeat(remaining % 2);
    f.workoutDetail.mockResolvedValue({ id: '01', detail: { activity } });
    const exact = await f.service.query(query, request(), signal());
    expect(Buffer.byteLength(JSON.stringify(exact))).toBe(dailyResultByteLimit);
    expect(exact.items[0]).toEqual({ id: '01', detail: { activity }, additionalMetrics: [], metricsTruncated: false });
    f.workoutDetail.mockResolvedValue({ id: '01', detail: { activity: `${activity}x` } });
    await expect(f.service.query(query, request(), signal())).rejects.toThrow('shared response limit');
  });
  it('paginates rather than declaring a partial source complete, and retains the exact next cursor', async () => {
    const f = fixture(); const cursor = { date: '2026-10-10', key: 'weight_body_mass' };
    f.history.mockResolvedValue({ items: [], next: cursor });
    const result = await f.service.query(input, request(), signal());
    expect(result.status).toBe('partial');
    expect(result.coverage).toMatchObject({ hasMore: true, next: cursor, sourceCompleteness: 'unknown' });
    await f.service.query({ ...input, cursor }, request(), signal());
    expect(f.history).toHaveBeenLastCalledWith('metrics', expect.objectContaining({ after: cursor }), expect.any(AbortSignal));
  });
  it('uses accepted sleep/workout/detail/minute-HR paths and reports absent detail explicitly', async () => {
    const f = fixture();
    for (const source of [sources.sleep, sources.workouts]) await f.service.query({ ...input, source }, request(), signal());
    expect(f.history.mock.calls.map(call => call[0])).toEqual(['sleep', 'workouts']);
    await f.service.query({ source: sources.heartRate, workoutId: '01', cursor: { minute: '2026-10-16T07:00:00Z', metric: 'heart_rate' } }, request(), signal());
    expect(f.heartRate).toHaveBeenCalledWith('01', expect.objectContaining({ after: { minute: '2026-10-16T07:00:00Z', metric: 'heart_rate' } }), expect.any(AbortSignal));
    f.workoutDetail.mockResolvedValue(null);
    expect(await f.service.query({ source: sources.workout, workoutId: '01' }, request(), signal())).toMatchObject({ status: 'empty', items: [] });
  });
  it('adds only normalized workout metrics not already represented by detail and labels the bounded remainder partial', async () => {
    const f = fixture();
    f.workoutDetail.mockResolvedValue({ id: '01', detail: {
      heartRateData: { value: 90, unit: 'bpm', min_value: 80, avg_value: 90, max_value: 100, samples: 2 },
      runningPower: { qty: 250, units: 'W' },
    } });
    f.workoutMetrics.mockResolvedValue({
      items: [
        { metric_name: 'heart_rate_data', unit: 'bpm', value: 90, min_value: 80, avg_value: 90, max_value: 100,
          sample_count: 2, fields: { latestSample: { value: 100, sourceUnit: 'bpm' } } },
        { metric_name: 'running_power', unit: 'W', value: 250, min_value: 250, avg_value: 250, max_value: 250,
          sample_count: 1, fields: { latestSample: { value: 250, sourceUnit: 'W' } } },
      ],
      truncated: true,
    });
    const result = await f.service.query({ source: sources.workout, workoutId: '01' }, request(), signal());
    expect(result).toMatchObject({
      status: 'partial', coverage: { hasMore: false, next: null, detailMetricsTruncated: true },
      items: [{ additionalMetrics: [{ metric_name: 'running_power', unit: 'W', value: 250,
        fields: { latestSample: { value: 250, sourceUnit: 'W' } } }], metricsTruncated: true }],
    });
    expect(JSON.stringify(result)).not.toContain('heart_rate_data');
  });
  it('keeps sync acceptance/processed/heartbeat evidence separate and returns failures instead of empty-success', async () => {
    const f = fixture();
    const result = await f.service.query({ source: sources.sync }, request(), signal());
    expect(result.items[0]).toHaveProperty('heartbeat');
    f.sync.mockRejectedValue(new Error('synthetic-secret-and-health-record'));
    await expect(f.service.query({ source: sources.sync }, request(), signal())).rejects.toThrow('Health data is unavailable');
    await expect(f.service.query(input, request(), signal())).rejects.not.toThrow('synthetic-secret');
  });
  it.each([0, 1234])('projects numeric sync inbox usage of %i bytes without exposing payloads', async retainedBytes => {
    const f = fixture();
    const inbox = { retained: retainedBytes ? 2 : 0, retained_bytes: retainedBytes,
      byte_limit: healthInboxByteLimit, row_limit: healthInboxRowLimit, pending: retainedBytes ? 1 : 0,
      processing: retainedBytes ? 1 : 0, quarantined: 0, last_accepted_at: null, last_processed_upload_at: null };
    f.sync.mockResolvedValue({ feeds: [], heartbeat: null, inbox: { ...inbox, raw_bytes: 'synthetic-payload', owner_object_id: owner } });
    const query = { source: sources.sync };
    const result = await f.service.query(query, request(), signal());
    expect(result.items).toEqual([{ feeds: [], heartbeat: null, inbox }]);
    expect(await dailyQueryTool(f.service).execute(query, request(), signal())).toEqual(result);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(dailyResultByteLimit);
  });
  it('keeps feed queries owner-browser-only and reports missing or uncovered snapshots as partial', async () => {
    const f = fixture();
    const feeds = {
      queryAttention: vi.fn(async () => ({
        items: [],
        feedSources: [{ source: 'Gmail' as const, status: 'Missing' as const, capturedAt: null,
          attemptedAt: null, error: 'not-configured' }],
      })),
      queryCalendar: vi.fn(async () => ({
        items: [],
        calendarRange: { from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z' },
        feedSources: [{ source: 'GoogleCalendar' as const, status: 'Stale' as const, capturedAt: null,
          attemptedAt: '2026-10-16T07:00:00Z', error: 'scope-denied',
          range: null }],
        rangeCovered: false,
      })),
    };
    const service = new DailyQueryService(f.readers, () => Date.parse('2026-10-16T07:30:00Z'), feeds);
    const attention = await service.query({ source: sources.attention }, request(), signal());
    expect(attention).toMatchObject({ status: 'partial', items: [], feedSources: [{ error: 'not-configured' }] });
    const calendar = await service.query({ source: sources.calendar, from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z' }, request(), signal());
    expect(calendar).toMatchObject({ status: 'partial', items: [], rangeCovered: false, feedSources: [{ error: 'scope-denied' }] });
    for (const identity of [
      { principal: undefined, agentPrincipal: { kind: 'jarvis-agent' } },
      { principal: undefined, dailyConnectorPrincipal: { kind: 'jarvis-daily-connector' } },
    ]) {
      await expect(service.query({ source: sources.attention }, request(identity), signal())).rejects.toThrow();
    }
    expect(feeds.queryAttention).toHaveBeenCalledTimes(1);
    await expect(new DailyQueryService(f.readers).query({ source: sources.attention }, request(), signal()))
      .rejects.toThrow('Health attention source is not configured');
  });
  it('rejects foreign/service/ambiguous principals and malformed selectors before any read', async () => {
    const f = fixture();
    for (const extra of [
      { principal: undefined }, { principal: { objectId: 'foreign' } }, { runnerPrincipal: {} },
      { nutritionExportPrincipal: {} }, { pcBridgePrincipal: {} }, { deployPrincipal: {} },
      { phoneEventGridPrincipal: {} }, { agentPrincipal: { kind: 'jarvis-agent' } },
    ]) await expect(f.service.query(input, request(extra), signal())).rejects.toThrow();
    await expect(f.service.query({ ...input, owner }, request(), signal())).rejects.toThrow('Invalid Health query');
    expect(f.readers.health).not.toHaveBeenCalled();
    await f.service.query(input, request({ principal: undefined, agentPrincipal: { kind: 'jarvis-agent' } }), signal());
  });
  it('shares the exact query and redacted registry metadata for tools, propagates cancellation and rejects oversized detail', async () => {
    const f = fixture(); const tool = createToolRegistry([{ id: 'daily', tools: [dailyQueryTool(f.service)] }]).get('daily_query')!;
    expect(tool.sensitive).toBe(true);
    expect(await tool.execute(input, request(), signal())).toEqual(await f.service.query(input, request(), signal()));
    const controller = new AbortController(); controller.abort();
    await expect(f.service.query(input, request(), controller.signal)).rejects.toThrow();
    f.workoutDetail.mockResolvedValue({ id: '01', detail: { activity: 'x'.repeat(dailyResultByteLimit) } });
    await expect(f.service.query({ source: sources.workout, workoutId: '01' }, request(), signal())).rejects.toThrow('shared response limit');
  });
});
