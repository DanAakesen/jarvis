import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIMEType } from 'node:util';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import type { TokenVerifier } from '../auth/verify.js';
import { createDailyModules } from './index.js';
import { DailyQueryService } from './query.js';
import { resolveDailyOwner } from './owner.js';
import { createDailyChanges } from './revisions.js';
import type { DailyData, DailyFoodLookup } from './query.js';
import type { InternalSavedNutrition } from './tools/saved-food.js';
import { suggest, type BudgetContext, type Suggestion } from './nutrition/model.js';
import type { NutritionSuggestionSources } from './nutrition/suggestion-adapter.js';
import { dailyCapabilitiesAccept, dailyQuerySources, dailyQuerySourcesV1, dailyQuerySourcesV2, dailyQuerySourcesV3, dailyQuerySourcesV4, dailyViewIds } from '@jarvis/contracts';
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
  it('pins byte-identical v1/v2/v3 capability bodies and withholds feed sources until enabled', async () => {
    const query = vi.fn();
    const data: DailyData = { query: { query }, changes: createDailyChanges() };
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data)] });
    apps.push(app);
    const responseBody = (version: number, sources: readonly string[]) => JSON.stringify({
      module: 'daily', version, stage: 'read-only', reservedViewIds: dailyViewIds,
      pages: [], tools: ['daily_query', 'daily_show'], sources,
      refresh: { event: 'now', refetchOn: ['connect', 'reconnect', 'refocus'], revision: 'query-content-sha256' },
    });
    for (const accept of [undefined, 'application/json', 'application/json;version=99']) {
      const response = await app.inject({ url: '/daily/capabilities', headers: { ...headers(), ...(accept ? { accept } : {}) } });
      expect(response.body).toBe(responseBody(1, dailyQuerySourcesV1));
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.vary).toContain('Accept');
    }
    const v2 = await app.inject({ url: '/daily/capabilities', headers: { ...headers(), accept: 'application/json; version="2", application/json' } });
    expect(v2.statusCode).toBe(200);
    expect(v2.body).toBe(responseBody(2, dailyQuerySourcesV2));
    expect(new MIMEType(String(v2.headers['content-type'])).params.get('version')).toBe('2');
    expect(dailyQuerySourcesV2).not.toContain(dailyQuerySources.metricCatalog);
    expect(dailyQuerySourcesV2).not.toContain(dailyQuerySources.days);
    const v3 = await app.inject({ url: '/daily/capabilities', headers: { ...headers(), accept: 'application/json;version="3", application/json' } });
    expect(v3.statusCode).toBe(200);
    expect(v3.json()).toMatchObject({ version: 3, sources: dailyQuerySourcesV3 });
    for (const accept of [dailyCapabilitiesAccept, 'application/json;version="4", application/json']) {
      const modern = await app.inject({ url: '/daily/capabilities', headers: { ...headers(), accept } });
      expect(modern.statusCode).toBe(200);
      const type = new MIMEType(String(modern.headers['content-type']));
      expect(type.essence).toBe('application/json');
      expect(type.params.get('version')).toBe('4');
      expect(modern.json()).toMatchObject({ version: 4, sources: dailyQuerySourcesV3 });
      expect(modern.json().sources).not.toContain(dailyQuerySources.attention);
      expect(modern.json().sources).not.toContain(dailyQuerySources.calendar);
    }
    expect(query).not.toHaveBeenCalled();
  });
  it('registers owner-only browser feed routes and v4 query sources only when feeds are composed', async () => {
    const feedReads = {
      queryAttention: vi.fn(async () => ({
        items: [{ type: 'thread', id: 'synthetic-thread', bucket: 'waiting_for_you', ageBusinessDays: 1, hidden: false }],
        feedSources: [{ source: 'Gmail' as const, status: 'Current' as const, capturedAt: '2026-10-16T10:00:00Z',
          attemptedAt: '2026-10-16T10:00:00Z', error: null }],
      })),
      queryCalendar: vi.fn(async () => ({
        items: [{ id: 'synthetic-calendar:event-01', title: 'Synthetic event' }],
        calendarRange: { from: '2026-10-16T00:00:00Z', to: '2026-10-17T00:00:00Z' },
        feedSources: [{ source: 'GoogleCalendar' as const, status: 'Current' as const,
          capturedAt: '2026-10-16T10:00:00Z', attemptedAt: '2026-10-16T10:00:00Z', error: null,
          range: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' } }],
        rangeCovered: true,
      })),
    };
    const query = new DailyQueryService({
      health: () => ({ history: vi.fn(), metricCatalog: vi.fn(), sync: vi.fn(), workoutDetail: vi.fn(), heartRate: vi.fn() }),
      nutrition: () => ({ history: vi.fn(), days: vi.fn(), favorites: vi.fn(), plans: vi.fn() }),
      briefs: () => ({ history: vi.fn(), detail: vi.fn() }),
    }, () => Date.parse('2026-10-16T12:00:00Z'), feedReads);
    const actions = {
      execute: vi.fn(),
      refreshFromBrowser: vi.fn(async () => ({ runId: 'synthetic-run', state: 'completed' })),
      hideThread: vi.fn(async () => true),
      receiveOrder: vi.fn(async () => true),
      restore: vi.fn(async () => true),
    };
    const data: DailyData = { query, changes: createDailyChanges(), feeds: actions };
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data)] });
    const unconfigured = buildApp(config, undefined, { auth, modules: [
      coreModule, ...createDailyModules(true, { query: { query: vi.fn() }, changes: createDailyChanges() }),
    ] });
    apps.push(app, unconfigured);
    const range = { from: '2026-10-16T00:00:00Z', to: '2026-10-17T00:00:00Z' };
    const capability = await app.inject({ url: '/daily/capabilities', headers: { ...headers(), accept: 'application/json;version=4' } });
    expect(capability.statusCode).toBe(200);
    expect(capability.json().sources).toEqual(dailyQuerySourcesV4);
    expect((await unconfigured.inject({ url: '/daily/capabilities', headers: { ...headers(), accept: 'application/json;version=4' } })).json().sources)
      .toEqual(dailyQuerySourcesV3);
    for (const path of ['/daily/feeds/refresh', '/daily/feeds/hide', '/daily/feeds/receive', '/daily/feeds/restore']) {
      expect((await unconfigured.inject({ method: 'POST', url: path, headers: headers(), payload: {} })).statusCode).toBe(404);
    }

    const attention = await app.inject({ method: 'POST', url: '/daily/query', headers: headers(), payload: { source: dailyQuerySources.attention } });
    expect(attention.statusCode).toBe(200);
    expect(attention.json()).toMatchObject({ status: 'available', items: [{ ageBusinessDays: 1, hidden: false }] });
    const calendar = await app.inject({ method: 'POST', url: '/daily/query', headers: headers(), payload: { source: dailyQuerySources.calendar, ...range } });
    expect(calendar.statusCode).toBe(200);
    expect(calendar.json()).toMatchObject({ status: 'available', rangeCovered: true, calendarRange: range });
    expect((await app.inject({ method: 'POST', url: '/daily/query', headers: headers('agent'), payload: { source: dailyQuerySources.attention } })).statusCode)
      .toBe(403);

    const actionsToCall = [
      { path: '/daily/feeds/refresh', payload: range, expected: { runId: 'synthetic-run', state: 'completed' } },
      { path: '/daily/feeds/hide', payload: { id: 'synthetic-thread' }, expected: { status: 'hidden' } },
      { path: '/daily/feeds/receive', payload: { id: 'synthetic-order' }, expected: { status: 'received' } },
      { path: '/daily/feeds/restore', payload: { type: 'thread', key: 'synthetic-thread' }, expected: { status: 'restored' } },
    ];
    for (const action of actionsToCall) {
      const response = await app.inject({ method: 'POST', url: action.path, headers: headers(), payload: action.payload });
      expect(response.statusCode, action.path).toBe(200);
      expect(response.json()).toMatchObject(action.expected);
      for (const kind of ['agent', 'runner', 'other', 'connector']) {
        expect((await app.inject({ method: 'POST', url: action.path, headers: headers(kind), payload: action.payload })).statusCode)
          .toBe(403);
      }
    }
    expect(actions.refreshFromBrowser).toHaveBeenCalledWith(expect.anything(), range, expect.any(AbortSignal));
    expect(actions.hideThread).toHaveBeenCalledOnce();
    expect(actions.receiveOrder).toHaveBeenCalledOnce();
    expect(actions.restore).toHaveBeenCalledOnce();
    const invalid = await app.inject({ method: 'POST', url: '/daily/feeds/refresh', headers: headers(),
      payload: { ...range, confirmed: true } });
    expect(invalid.statusCode).toBe(400);
    expect(actions.refreshFromBrowser).toHaveBeenCalledOnce();
  });
  it('requires an explicit internal store factory rather than enabling writes with read-only data', async () => {
    const data: DailyData = { query: { query: vi.fn() }, changes: createDailyChanges() };
    const internal = vi.fn(() => ({ intake: vi.fn(), lookupSaved: vi.fn(), log: vi.fn(), correct: vi.fn(), remove: vi.fn() }));
    expect(createDailyModules(false, data, undefined, internal)).toEqual([]);
    expect(createDailyModules(true, data)[0]!.tools.map(tool => tool.name)).toEqual(['daily_query', 'daily_show']);
    expect(() => createDailyModules(true, undefined, undefined, internal)).toThrow('shared Daily data');
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data, undefined, internal)] });
    apps.push(app);
    const response = await app.inject({ url: '/daily/capabilities', headers: headers() });
    expect(response.json()).toMatchObject({ stage: 'internal-nutrition-rehearsal', pages: [], tools: ['daily_query', 'daily_show', 'daily_food', 'daily_food_review'] });
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
    expect(response.json()).toMatchObject({ stage: 'internal-nutrition-rehearsal', tools: ['daily_query', 'daily_show', 'daily_saved_food'], pages: [] });
    expect(saved).not.toHaveBeenCalled();
  });
  it('adds owner nutrition targets only with the separate accessor, behind the same Daily gate, and keeps writes behind approval', async () => {
    const data: DailyData = { query: { query: vi.fn() }, changes: createDailyChanges() };
    const read = vi.fn(async () => ({ targets: { restingKcal: null, deficitKcal: null, proteinGrams: null }, updatedAt: null }));
    const write = vi.fn();
    const targets = vi.fn(() => ({ read, write }));
    expect(createDailyModules(false, data, undefined, undefined, undefined, targets)).toEqual([]);
    expect(createDailyModules(true, data)[0]!.tools.map(tool => tool.name)).toEqual(['daily_query', 'daily_show']);
    expect(() => createDailyModules(true, undefined, undefined, undefined, undefined, targets)).toThrow('shared Daily data');
    const calls: ToolCallRecord[] = [];
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data, undefined, undefined, undefined, targets)],
      toolCallStore: { record: async call => { calls.push(call); } } });
    apps.push(app);
    expect((await app.inject({ url: '/daily/capabilities', headers: headers() })).json()).toMatchObject({
      stage: 'internal-nutrition-rehearsal', tools: ['daily_query', 'daily_show', 'daily_nutrition_targets'], pages: [],
    });
    expect(targets).not.toHaveBeenCalled();
    for (const kind of ['owner', 'agent']) {
      const response = await app.inject({ method: 'POST', url: '/tools/daily_nutrition_targets',
        headers: { ...headers(kind), 'x-jarvis-message-id': '42' }, payload: { operation: 'read' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ outcome: 'ok', result: { status: 'needs-configuration', missing: ['restingKcal', 'deficitKcal', 'proteinGrams'] } });
    }
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({
      tool: 'daily_nutrition_targets', outcome: 'ok', arguments: { redacted: true }, result: { redacted: true },
    })]));
    // A change is refused, not silently applied, when native approval is not available.
    const change = await app.inject({ method: 'POST', url: '/tools/daily_nutrition_targets',
      headers: { ...headers('agent'), 'x-jarvis-message-id': '42' }, payload: { operation: 'set_targets', targets: { restingKcal: 1750 } } });
    expect(change.json()).toMatchObject({ outcome: 'refused' });
    expect(write).not.toHaveBeenCalled();
    // The model cannot choose another owner or an extra field.
    const owned = await app.inject({ method: 'POST', url: '/tools/daily_nutrition_targets',
      headers: { ...headers('agent'), 'x-jarvis-message-id': '42' }, payload: { operation: 'read', owner: other } });
    expect(owned.json()).toMatchObject({ outcome: 'refused' });
    const deniedOwner = await app.inject({ method: 'POST', url: '/tools/daily_nutrition_targets',
      headers: { ...headers('other'), 'x-jarvis-message-id': '42' }, payload: { operation: 'read' } });
    expect(deniedOwner.json()).toMatchObject({ outcome: 'error', result: { error: 'Tool execution failed' } });
    for (const kind of ['runner', 'connector']) {
      expect((await app.inject({ method: 'POST', url: '/tools/daily_nutrition_targets',
        headers: { ...headers(kind), 'x-jarvis-message-id': '42' }, payload: { operation: 'read' } })).statusCode).toBe(403);
    }
    expect(read).toHaveBeenCalledTimes(3);
    // The nutrition Settings route serves the signed-in owner only; the agent uses the approved nutrition tool.
    const settings = await app.inject({ url: '/daily/nutrition-targets', headers: headers() });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({ missing: ['restingKcal', 'deficitKcal', 'proteinGrams'], updatedAt: null });
    expect((await app.inject({ url: '/daily/nutrition-targets', headers: headers('agent') })).statusCode).toBe(403);
    expect((await app.inject({ url: '/daily/nutrition-targets', headers: headers('other') })).statusCode).toBe(403);
  });
  it('leaves Jarvis unchanged when Daily is off, even if the nutrition targets accessor is supplied', async () => {
    const data: DailyData = { query: { query: vi.fn() }, changes: createDailyChanges() };
    const targets = vi.fn();
    const baseline = buildApp(config, undefined, { auth, modules: [coreModule] });
    const off = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(false, data, undefined, undefined, undefined, targets)] });
    apps.push(baseline, off);
    expect((await off.inject('/health')).json()).toEqual((await baseline.inject('/health')).json());
    expect((await off.inject({ url: '/tools', headers: headers() })).json()).toEqual((await baseline.inject({ url: '/tools', headers: headers() })).json());
    for (const url of ['/daily/capabilities', '/daily/nutrition-targets']) {
      expect((await off.inject({ url, headers: headers() })).statusCode).toBe(404);
    }
    expect((await off.inject({ method: 'PATCH', url: '/daily/nutrition-targets', headers: headers(), payload: { restingKcal: 1750 } })).statusCode).toBe(404);
    expect(targets).not.toHaveBeenCalled();
  });
  it('adds the read-only suggestion tool only with the targets accessor and its own sources, behind the same Daily gate', async () => {
    const data: DailyData = { query: { query: vi.fn() }, changes: createDailyChanges() };
    // Synthetic placeholders. They are not anyone's real figures.
    const read = vi.fn(async () => ({ targets: { restingKcal: 1750, deficitKcal: 350, proteinGrams: 110 }, updatedAt: '2026-10-10T08:00:00.000Z' }));
    const targets = vi.fn(() => ({ read, write: vi.fn() }));
    const history = vi.fn(async () => ({ rows: [], next: null }));
    const favorites = vi.fn(async () => ({ rows: [{ id: 'a', favorite_name: 'Synthetic favourite', energy_kcal: 300, protein_grams: 30,
      carbohydrates_grams: null, fat_grams: null, fiber_grams: null }], nextId: null }));
    const matches = vi.fn(async (candidates: readonly Suggestion[], context: BudgetContext) => suggest(candidates, new Set(), context));
    const healthHistory = vi.fn(async () => ({ items: [{ metric_name: 'active_energy', metric_date: '2026-10-17', unit: 'kcal', value: 300,
      sample_count: 8, start_at: null, end_at: null, updated_at: '2026-10-17T10:00:00.000Z' }], truncated: false, next: null }));
    const nutrition = vi.fn(() => ({ history, favorites, suggestions: matches }));
    const health = vi.fn(() => ({ history: healthHistory }));
    const sources = { nutrition, health, now: () => '2026-10-17T10:30:00.000Z' } as unknown as NutritionSuggestionSources;
    expect(createDailyModules(false, data, undefined, undefined, undefined, targets, sources)).toEqual([]);
    expect(() => createDailyModules(true, undefined, undefined, undefined, undefined, targets, sources)).toThrow('shared Daily data');
    expect(() => createDailyModules(true, data, undefined, undefined, undefined, undefined, sources)).toThrow('require nutrition targets');
    expect(createDailyModules(true, data, undefined, undefined, undefined, targets)[0]!.tools.map(tool => tool.name)).toEqual(['daily_query', 'daily_show', 'daily_nutrition_targets']);
    const calls: ToolCallRecord[] = [];
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data, undefined, undefined, undefined, targets, sources)],
      toolCallStore: { record: async call => { calls.push(call); } } });
    apps.push(app);
    expect((await app.inject({ url: '/daily/capabilities', headers: headers() })).json()).toMatchObject({
      stage: 'internal-nutrition-rehearsal', tools: ['daily_query', 'daily_show', 'daily_nutrition_targets', 'daily_nutrition_suggest'], pages: [],
    });
    for (const access of [targets, nutrition, health]) expect(access).not.toHaveBeenCalled();
    for (const kind of ['owner', 'agent']) {
      const response = await app.inject({ method: 'POST', url: '/tools/daily_nutrition_suggest',
        headers: { ...headers(kind), 'x-jarvis-message-id': '42' }, payload: { limit: 3 } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ outcome: 'ok', result: {
        status: 'ready', localDate: '2026-10-17', kcal: { state: 'ready', remainingKcal: 1700 },
        suggestions: [{ favoriteId: 'a', name: 'Synthetic favourite' }],
      } });
    }
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({
      tool: 'daily_nutrition_suggest', outcome: 'ok', arguments: { redacted: true }, result: { redacted: true },
    })]));
    expect(JSON.stringify(calls)).not.toContain('Synthetic favourite');
    // The model cannot choose another owner, date or budget.
    const owned = await app.inject({ method: 'POST', url: '/tools/daily_nutrition_suggest',
      headers: { ...headers('agent'), 'x-jarvis-message-id': '42' }, payload: { owner: other } });
    expect(owned.json()).toMatchObject({ outcome: 'refused' });
    const deniedOwner = await app.inject({ method: 'POST', url: '/tools/daily_nutrition_suggest',
      headers: { ...headers('other'), 'x-jarvis-message-id': '42' }, payload: {} });
    expect(deniedOwner.json()).toMatchObject({ outcome: 'error', result: { error: 'Tool execution failed' } });
    for (const kind of ['runner', 'connector']) {
      expect((await app.inject({ method: 'POST', url: '/tools/daily_nutrition_suggest',
        headers: { ...headers(kind), 'x-jarvis-message-id': '42' }, payload: {} })).statusCode).toBe(403);
    }
    expect(read).toHaveBeenCalledTimes(2);
    expect(healthHistory).toHaveBeenCalledTimes(2);
    expect(matches).toHaveBeenCalledTimes(2);
  });
  it('leaves Jarvis unchanged when Daily is off, even if the suggestion sources are supplied', async () => {
    const data: DailyData = { query: { query: vi.fn() }, changes: createDailyChanges() };
    const targets = vi.fn();
    const nutrition = vi.fn();
    const health = vi.fn();
    const sources = { nutrition, health } as unknown as NutritionSuggestionSources;
    const baseline = buildApp(config, undefined, { auth, modules: [coreModule] });
    const off = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(false, data, undefined, undefined, undefined, targets, sources)] });
    apps.push(baseline, off);
    expect((await off.inject('/health')).json()).toEqual((await baseline.inject('/health')).json());
    expect((await off.inject({ url: '/tools', headers: headers() })).json()).toEqual((await baseline.inject({ url: '/tools', headers: headers() })).json());
    expect((await off.inject({ url: '/daily/capabilities', headers: headers() })).statusCode).toBe(404);
    expect((await off.inject({ method: 'POST', url: '/tools/daily_nutrition_suggest',
      headers: { ...headers(), 'x-jarvis-message-id': '42' }, payload: {} })).statusCode).toBe(404);
    for (const access of [targets, nutrition, health]) expect(access).not.toHaveBeenCalled();
  });
  it('registers Frida lookup through food review and never calls it during composition', async () => {
    const foodLookup = vi.fn<DailyFoodLookup>();
    const data: DailyData = { query: { query: vi.fn() }, changes: createDailyChanges(), foodLookup };
    const internal = vi.fn(() => ({
      intake: vi.fn(), lookupSaved: vi.fn(), log: vi.fn(), correct: vi.fn(), remove: vi.fn(),
    }));
    expect(createDailyModules(false, data)).toEqual([]);
    const modules = createDailyModules(true, data, undefined, internal);
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...modules] });
    apps.push(app);
    expect((await app.inject({ url: '/daily/capabilities', headers: headers() })).json()).toMatchObject({
      stage: 'internal-nutrition-rehearsal', tools: ['daily_query', 'daily_show', 'daily_food', 'daily_food_review'], pages: [],
    });
    const review = modules[0]!.tools.find(({ name }) => name === 'daily_food_review');
    expect(review?.description).toContain('lookup_components');
    expect(modules[0]!.tools.map(({ name }) => name)).not.toContain('daily_food_lookup');
    expect(internal).not.toHaveBeenCalled();
    expect(foodLookup).not.toHaveBeenCalled();
  });
  it('adds only the explicit feed capability, uses the existing dispatcher/audit and bridges owner commits until shutdown', async () => {
    const execute = vi.fn(async () => ({ operation: 'read_attention', sources: [], waiting: [{ private: 'synthetic private mail' }] }));
    const changes = createDailyChanges();
    const data: DailyData = { query: { query: vi.fn() }, changes, feeds: {
      execute, refreshFromBrowser: vi.fn(), hideThread: vi.fn(), receiveOrder: vi.fn(), restore: vi.fn(),
    } };
    expect(createDailyModules(false, data)).toEqual([]);
    expect(createDailyModules(true, { query: data.query, changes })[0]!.tools.map(tool => tool.name)).toEqual(['daily_query', 'daily_show']);
    const calls: ToolCallRecord[] = [];
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data)],
      toolCallStore: { record: async call => { calls.push(call); } } });
    apps.push(app);
    expect((await app.inject({ url: '/daily/capabilities', headers: headers() })).json()).toMatchObject({
      stage: 'feed-rehearsal', tools: ['daily_query', 'daily_show', 'daily_feed'], pages: [], sources: dailyQuerySourcesV1,
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
