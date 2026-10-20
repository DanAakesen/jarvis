import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources } from '@jarvis/contracts';
import { loadConfig } from '../../config.js';
import { installAuthentication } from '../../auth/hook.js';
import { AuthenticationDenied } from '../../auth/verify.js';
import { createEventHub } from '../../core/event-hub.js';
import type { NowFeedUpdate } from '../../core/now.js';
import { createDailyModules } from '../index.js';
import { createDailyChanges } from '../revisions.js';
import { DailyQueryService } from '../query.js';
import { healthInboxByteLimit, healthInboxRowLimit } from '../health-upload/sql-buffer.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const owner = config.auth.ownerObjectId;
const foreign = '22222222-2222-4222-8222-222222222222';
const apps: ReturnType<typeof Fastify>[] = [];
const headers = (kind = 'owner') => ({ authorization: `Bearer ${kind}.synthetic.signature` });
const input = { source: dailyQuerySources.metrics, startDate: '2026-10-01', endDate: '2026-10-16' };
function fixture(enabled = true) {
  const app = Fastify(); apps.push(app);
  app.decorate('ownerObjectId', owner);
  const hub = createEventHub<NowFeedUpdate>();
  app.decorate('nowEventHub', hub);
  installAuthentication(app, config, async token => {
    if (token.startsWith('agent.')) return { kind: 'jarvis-agent', objectId: foreign, tenantId: config.auth.tenantId };
    if (token.startsWith('runner.')) return { kind: 'jarvis-runner', objectId: foreign, tenantId: config.auth.tenantId };
    return { objectId: token.startsWith('other.') ? foreign : owner, tenantId: config.auth.tenantId, displayName: 'Synthetic' };
  });
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof AuthenticationDenied ? error.statusCode : 500).send({ error: 'Denied or unavailable' });
  });
  const history = vi.fn().mockResolvedValue({ items: [{ metric_name: 'body_mass', metric_date: '2026-10-16', value: 80, unit: 'kg' }], next: null });
  const sync = vi.fn().mockResolvedValue({ feeds: [], heartbeat: null, inbox: {} });
  const service = new DailyQueryService({
    health: () => ({ history, sync, workoutDetail: vi.fn(), heartRate: vi.fn() }),
    nutrition: () => ({ history: vi.fn(), favorites: vi.fn(), plans: vi.fn() }),
    briefs: () => ({ history: vi.fn(), detail: vi.fn() }),
  }, () => Date.parse('2026-10-16T08:00:00Z'));
  const changes = createDailyChanges();
  for (const module of createDailyModules(enabled, { query: service, changes })) app.register(module.registerRoutes);
  return { app, changes, hub, service, history, sync };
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
describe('inactive Daily HTTP/module integration', () => {
  it('keeps data routes, tools and event subscription absent when disabled', async () => {
    const f = fixture(false);
    expect(createDailyModules(false, { query: f.service, changes: f.changes })).toEqual([]);
    expect((await f.app.inject({ method: 'POST', url: '/daily/query', headers: headers(), payload: input })).statusCode).toBe(404);
    expect(f.history).not.toHaveBeenCalled();
    const publish = vi.spyOn(f.hub, 'publish');
    f.changes.publish({ owner, sources: [dailyQuerySources.metrics] });
    expect(publish).not.toHaveBeenCalled();
  });
  it('reuses the real root auth hook for owner/hosted-agent reads and denies anonymous/foreign/runner callers', async () => {
    const f = fixture();
    for (const kind of ['owner', 'agent']) {
      const response = await f.app.inject({ method: 'POST', url: '/daily/query', headers: headers(kind), payload: input });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual(await f.service.query(input, {
        server: f.app, principal: { objectId: owner },
      } as Parameters<DailyQueryService['query']>[1], new AbortController().signal));
    }
    expect((await f.app.inject({ method: 'POST', url: '/daily/query', payload: input })).statusCode).toBe(401);
    for (const kind of ['other', 'runner']) expect((await f.app.inject({ method: 'POST', url: '/daily/query', headers: headers(kind), payload: input })).statusCode).toBe(403);
  });
  it('rejects raw owner/cursor selectors before Ajv strips them and never offers a write route', async () => {
    const f = fixture();
    for (const payload of [{ ...input, owner }, { ...input, cursor: { date: '2026-10-15', key: 'weight', owner } }]) {
      expect((await f.app.inject({ method: 'POST', url: '/daily/query', headers: headers(), payload })).statusCode).toBe(400);
    }
    expect((await f.app.inject({ method: 'POST', url: '/daily/query?owner=foreign', headers: headers(), payload: input })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'POST', url: '/daily/query', headers: headers(), payload: { operation: 'log-intake' } })).statusCode).toBe(400);
    expect(f.history).not.toHaveBeenCalled();
    expect((await f.app.inject({ method: 'POST', url: '/daily/nutrition/log', headers: headers(), payload: {} })).statusCode).toBe(404);
  });
  it('returns additive numeric inbox usage through the authenticated sync contract', async () => {
    const f = fixture();
    const inbox = { retained: 2, pending: 1, processing: 1, quarantined: 0, retained_bytes: 1234,
      byte_limit: healthInboxByteLimit, row_limit: healthInboxRowLimit };
    f.sync.mockResolvedValue({ feeds: [], heartbeat: null, inbox: { ...inbox, raw_bytes: 'synthetic-payload' } });
    for (const kind of ['owner', 'agent']) {
      const response = await f.app.inject({ method: 'POST', url: '/daily/query', headers: headers(kind),
        payload: { source: dailyQuerySources.sync } });
      expect(response.statusCode).toBe(200);
      expect(response.json().items[0].inbox).toEqual(inbox);
    }
  });
  it('reports unavailable rather than fabricated empty history', async () => {
    const f = fixture(); f.sync.mockRejectedValue(new Error('synthetic-private-record'));
    const result = await f.app.inject({ method: 'POST', url: '/daily/query', headers: headers(), payload: input });
    expect(result.statusCode).toBe(503);
    expect(result.body).not.toContain('synthetic-private');
    expect(result.body).not.toContain('"items"');
  });
  it('bridges only the configured owner to the unchanged refresh event and unsubscribes at shutdown', async () => {
    const f = fixture(); await f.app.ready();
    const publish = vi.spyOn(f.hub, 'publish');
    f.changes.publish({ owner: foreign, sources: [dailyQuerySources.metrics] });
    expect(publish).not.toHaveBeenCalled();
    f.changes.publish({ owner: owner.toUpperCase(), sources: [dailyQuerySources.metrics] });
    expect(publish).toHaveBeenCalledExactlyOnceWith({ type: 'refresh' });
    const capabilities = await f.app.inject({ url: '/daily/capabilities', headers: headers() });
    expect(capabilities.json()).toMatchObject({ stage: 'read-only', tools: ['daily_query', 'daily_show'],
      refresh: { event: 'now', refetchOn: ['connect', 'reconnect', 'refocus'] } });
    await f.app.close();
    f.changes.publish({ owner, sources: [dailyQuerySources.metrics] });
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
