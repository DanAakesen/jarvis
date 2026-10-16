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

const owner = '11111111-1111-4111-8111-111111111111';
const request = (extra = {}) => ({ server: { ownerObjectId: owner }, principal: { objectId: owner }, ...extra }) as FastifyRequest;
const input = { source: sources.metrics, startDate: '2026-10-01', endDate: '2026-10-16' };
const signal = () => new AbortController().signal;
function fixture() {
  let clock = Date.parse('2026-10-16T07:30:00Z');
  const history = vi.fn().mockResolvedValue({ items: [{ metric_name: 'waist_circumference', metric_date: '2026-10-16',
    value: 0.88, unit: 'm', min_value: null, ingestion_id: 'synthetic-ingestion', updated_at: '2026-10-16T07:00:00Z',
    owner_object_id: owner, raw_bytes: 'must-not-escape' }], next: null });
  const sync = vi.fn().mockResolvedValue({
    feeds: [{ feed_kind: 'metrics', accepted_evidence_at: '2026-10-16T07:00:00Z', processed_committed_at: '2026-10-16T07:05:00Z' }],
    heartbeat: { last_received_at: '2026-10-16T07:29:00Z' }, inbox: { pending: 1, quarantined: 0 },
  });
  const workoutDetail = vi.fn().mockResolvedValue({ id: '01', detail: { activity: 'synthetic' } });
  const heartRate = vi.fn().mockResolvedValue({ items: [{ sample_minute: '2026-10-16T07:00:00Z', metric_name: 'heart_rate', unit: 'bpm', avg_value: 90 }], next: null });
  const meals = vi.fn().mockResolvedValue({ rows: [{ id: '01', meal_date: new Date('2026-10-16'), energy_kcal: 123, protein_grams: null,
    components_json: '[]', nutrient_provenance_json: '{"kind":"synthetic-label"}', revision: 2n, deleted_at: null,
    owner_object_id: owner, apple_health_claim_token_hash: 'must-not-escape' }], next: null });
  const readers: DailyReaders = {
    health: vi.fn(() => ({ history, sync, workoutDetail, heartRate })),
    nutrition: vi.fn(() => ({ history: meals })),
  };
  return { service: new DailyQueryService(readers, () => clock), advance: () => { clock += 60000; }, readers, history, sync, workoutDetail, heartRate, meals };
}
describe('one shared Daily read contract', () => {
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
    expect(result.items).toEqual([{ id: '01', detail }]);
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
    expect(exact.items[0]).toEqual({ id: '01', detail: { activity } });
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
  it('keeps sync acceptance/processed/heartbeat evidence separate and returns failures instead of empty-success', async () => {
    const f = fixture();
    const result = await f.service.query({ source: sources.sync }, request(), signal());
    expect(result.items[0]).toHaveProperty('heartbeat');
    f.sync.mockRejectedValue(new Error('synthetic-secret-and-health-record'));
    await expect(f.service.query({ source: sources.sync }, request(), signal())).rejects.toThrow('Daily data is unavailable');
    await expect(f.service.query(input, request(), signal())).rejects.not.toThrow('synthetic-secret');
  });
  it('rejects foreign/service/ambiguous principals and malformed selectors before any read', async () => {
    const f = fixture();
    for (const extra of [
      { principal: undefined }, { principal: { objectId: 'foreign' } }, { runnerPrincipal: {} },
      { nutritionExportPrincipal: {} }, { pcBridgePrincipal: {} }, { deployPrincipal: {} },
      { phoneEventGridPrincipal: {} }, { agentPrincipal: { kind: 'jarvis-agent' } },
    ]) await expect(f.service.query(input, request(extra), signal())).rejects.toThrow();
    await expect(f.service.query({ ...input, owner }, request(), signal())).rejects.toThrow('Invalid Daily query');
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
