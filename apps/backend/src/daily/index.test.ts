import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIMEType } from 'node:util';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import type { TokenVerifier } from '../auth/verify.js';
import { createDailyModules } from './index.js';
import { resolveDailyOwner } from './owner.js';
import { createDailyChanges } from './revisions.js';
import type { DailyData, DailyFoodLookup } from './query.js';
import type { InternalSavedNutrition } from './tools/saved-food.js';
import { dailyCapabilitiesAccept, dailyQuerySources, dailyQuerySourcesV1 } from '@jarvis/contracts';
import type { ToolCallRecord } from '../core/tool-calls.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const owner = config.auth.ownerObjectId;
const agent = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const apps: ReturnType<typeof buildApp>[] = [];
const headers = (kind = 'owner') => ({ authorization: `Bearer ${kind}.e30.sig` });
const auth: TokenVerifier = async (token) => {
  const kind = token.split('.')[0];
  if (kind === 'agent') return { kind: 'jarvis-agent', objectId: agent, tenantId: config.auth.tenantId };
  if (kind === 'runner') return { kind: 'jarvis-runner', objectId: other, tenantId: config.auth.tenantId };
  if (kind === 'connector') return { kind: 'jarvis-daily-connector', objectId: owner, tenantId: config.auth.tenantId,
    clientId: other, scopes: ['Daily.Nutrition.Read'] };
  return { objectId: kind === 'other' ? other : owner.toUpperCase(), tenantId: config.auth.tenantId, displayName: 'Synthetic user' };
};
function fixture(enabled?: boolean) {
  const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(enabled)] });
  apps.push(app);
  return app;
}
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('Daily integration contract', () => {
  it('defaults off and preserves the existing health route and tool catalogue', async () => {
    const baseline = buildApp(config, undefined, { auth, modules: [coreModule] });
    apps.push(baseline);
    for (const app of [fixture(), fixture(false)]) {
      expect((await app.inject('/health')).json()).toEqual((await baseline.inject('/health')).json());
      expect((await app.inject({ url: '/tools', headers: headers() })).json()).toEqual(
        (await baseline.inject({ url: '/tools', headers: headers() })).json(),
      );
      expect((await app.inject({ url: '/daily/capabilities', headers: headers() })).statusCode).toBe(404);
    }
    expect(createDailyModules()).toEqual([]);
    expect(createDailyModules(false)).toEqual([]);
  });

  it('maps the existing authenticated user and distinct hosted-agent identity to one server owner', async () => {
    const app = fixture(true);
    // Synthetic test route exercises the helper used by future Daily data services.
    app.get('/synthetic-daily-owner', { config: { jarvisAgent: true } }, async (request) => ({ owner: resolveDailyOwner(request) }));
    for (const kind of ['owner', 'agent']) {
      expect((await app.inject({ url: '/synthetic-daily-owner', headers: headers(kind) })).json()).toEqual({ owner });
      const response = await app.inject({ url: '/daily/capabilities', headers: headers(kind) });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({ stage: 'contract-only', pages: [], tools: [], reservedViewIds: { status: 'daily-status' } });
      expect(JSON.stringify(response.json())).not.toContain(owner);
      expect(JSON.stringify(response.json())).not.toContain(agent);
    }
  });

  it('rejects unauthenticated, non-owner and coding-runner access', async () => {
    const app = fixture(true);
    expect((await app.inject('/daily/capabilities')).statusCode).toBe(401);
    for (const kind of ['other', 'runner']) {
      expect((await app.inject({ url: '/daily/capabilities', headers: headers(kind) })).statusCode).toBe(403);
    }
  });

  it('never accepts a caller-supplied owner or source owner', async () => {
    const app = fixture(true);
    for (const field of ['owner', 'ownerId', 'sourceOwnerId']) {
      expect((await app.inject({ url: `/daily/capabilities?${field}=${other}`, headers: headers() })).statusCode).toBe(400);
    }
  });
  it('keeps legacy capability consumers on the exact v1 set and advertises briefs only on explicit v2 negotiation', async () => {
    const query = vi.fn();
    const data: DailyData = { query: { query }, changes: createDailyChanges() };
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data)] });
    apps.push(app);
    for (const accept of [undefined, 'application/json']) {
      const response = await app.inject({ url: '/daily/capabilities', headers: { ...headers(), ...(accept ? { accept } : {}) } });
      expect(response.json()).toMatchObject({ version: 1, sources: dailyQuerySourcesV1 });
      expect(response.json().sources).not.toContain(dailyQuerySources.briefs);
      expect(response.json().sources).not.toContain(dailyQuerySources.brief);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.vary).toContain('Accept');
    }
    for (const accept of [dailyCapabilitiesAccept, 'application/json; version="2", application/json']) {
      const modern = await app.inject({ url: '/daily/capabilities', headers: { ...headers(), accept } });
      expect(modern.statusCode).toBe(200);
      const type = new MIMEType(String(modern.headers['content-type']));
      expect(type.essence).toBe('application/json');
      expect(type.params.get('version')).toBe('2');
      expect(modern.json()).toMatchObject({ version: 2, sources: Object.values(dailyQuerySources) });
    }
    expect(query).not.toHaveBeenCalled();
  });
  it('requires an explicit internal store factory rather than enabling writes with read-only data', async () => {
    const data: DailyData = { query: { query: vi.fn() }, changes: createDailyChanges() };
    const internal = vi.fn(() => ({ intake: vi.fn(), lookupSaved: vi.fn(), log: vi.fn(), correct: vi.fn(), remove: vi.fn() }));
    expect(createDailyModules(false, data, undefined, internal)).toEqual([]);
    expect(createDailyModules(true, data)[0]!.tools.map(tool => tool.name)).toEqual(['daily_query']);
    expect(() => createDailyModules(true, undefined, undefined, internal)).toThrow('shared Daily data');
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data, undefined, internal)] });
    apps.push(app);
    const response = await app.inject({ url: '/daily/capabilities', headers: headers() });
    expect(response.json()).toMatchObject({ stage: 'internal-nutrition-rehearsal', pages: [], tools: ['daily_query', 'daily_food', 'daily_food_review'] });
    expect(internal).not.toHaveBeenCalled();
    const catalogue = (await app.inject({ url: '/tools', headers: headers() })).json();
    expect(JSON.stringify(catalogue)).toContain('daily_food');
    expect(JSON.stringify(catalogue)).toContain('daily_food_review');
  });
  it('adds saved-food workflows only with the separate additive factory, preserving existing compositions', async () => {
    const data: DailyData = { query: { query: vi.fn() }, changes: createDailyChanges() };
    const saved = vi.fn<InternalSavedNutrition>();
    expect(createDailyModules(false, data, undefined, undefined, saved)).toEqual([]);
    expect(() => createDailyModules(true, undefined, undefined, undefined, saved)).toThrow('shared Daily data');
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data, undefined, undefined, saved)] });
    apps.push(app);
    const response = await app.inject({ url: '/daily/capabilities', headers: headers() });
    expect(response.json()).toMatchObject({ stage: 'internal-nutrition-rehearsal', tools: ['daily_query', 'daily_saved_food'], pages: [] });
    expect(saved).not.toHaveBeenCalled();
  });
  it('exposes public reference lookup only with an explicit provider capability and never calls it during composition', async () => {
    const foodLookup = vi.fn<DailyFoodLookup>();
    const data: DailyData = { query: { query: vi.fn() }, changes: createDailyChanges(), foodLookup };
    expect(createDailyModules(false, data)).toEqual([]);
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data)] });
    apps.push(app);
    expect((await app.inject({ url: '/daily/capabilities', headers: headers() })).json()).toMatchObject({
      stage: 'read-only', tools: ['daily_query', 'daily_food_lookup'], pages: [],
    });
    expect(foodLookup).not.toHaveBeenCalled();
  });
  it('adds only the explicit feed capability, uses the existing dispatcher/audit and bridges owner commits until shutdown', async () => {
    const execute = vi.fn(async () => ({ operation: 'read_attention', sources: [], waiting: [{ private: 'synthetic private mail' }] }));
    const changes = createDailyChanges();
    const data: DailyData = { query: { query: vi.fn() }, changes, feeds: { execute } };
    expect(createDailyModules(false, data)).toEqual([]);
    expect(createDailyModules(true, { query: data.query, changes })[0]!.tools.map(tool => tool.name)).toEqual(['daily_query']);
    const calls: ToolCallRecord[] = [];
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data)],
      toolCallStore: { record: async call => { calls.push(call); } } });
    apps.push(app);
    expect((await app.inject({ url: '/daily/capabilities', headers: headers() })).json()).toMatchObject({
      stage: 'feed-rehearsal', tools: ['daily_query', 'daily_feed'], pages: [], sources: dailyQuerySourcesV1,
    });
    expect(execute).not.toHaveBeenCalled();
    const publish = vi.spyOn(app.nowEventHub, 'publish');
    for (const kind of ['owner', 'agent']) {
      const response = await app.inject({ method: 'POST', url: '/tools/daily_feed',
        headers: { ...headers(kind), 'x-jarvis-message-id': '42' }, payload: { operation: 'read_attention' } });
      expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ outcome: 'ok', result: { operation: 'read_attention' } });
    }
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({
      tool: 'daily_feed', outcome: 'ok', arguments: { redacted: true }, result: { redacted: true },
    })]));
    expect(JSON.stringify(calls)).not.toContain('synthetic private mail');
    expect((await app.inject({ method: 'POST', url: '/tools/daily_feed',
      headers: { ...headers(), 'x-jarvis-message-id': '42' }, payload: { operation: 'read_attention', confirmed: true } })).json().outcome).toBe('refused');
    const deniedOwner = await app.inject({ method: 'POST', url: '/tools/daily_feed',
      headers: { ...headers('other'), 'x-jarvis-message-id': '42' }, payload: { operation: 'read_attention' } });
    // Root auth admits verified human identities; the tool owns resource authorisation.
    expect(deniedOwner.statusCode).toBe(200);
    expect(deniedOwner.json()).toMatchObject({ outcome: 'error', result: { error: 'Tool execution failed' } });
    expect(calls.at(-1)).toMatchObject({ tool: 'daily_feed', outcome: 'error', arguments: { redacted: true }, result: { redacted: true } });
    for (const kind of ['runner', 'connector']) {
      expect((await app.inject({ method: 'POST', url: '/tools/daily_feed',
        headers: { ...headers(kind), 'x-jarvis-message-id': '42' }, payload: { operation: 'read_attention' } })).statusCode).toBe(403);
    }
    expect(execute).toHaveBeenCalledTimes(2);
    changes.publish({ owner: other, sources: ['daily.feed'] }); expect(publish).not.toHaveBeenCalled();
    changes.publish({ owner, sources: ['daily.feed'] }); expect(publish).toHaveBeenCalledWith({ type: 'refresh' });
    await app.close(); publish.mockClear();
    changes.publish({ owner, sources: ['daily.feed'] }); expect(publish).not.toHaveBeenCalled();
  });
});
