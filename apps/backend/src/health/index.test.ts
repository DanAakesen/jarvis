import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIMEType } from 'node:util';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import type { TokenVerifier } from '../auth/verify.js';
import { createHealthModules } from './index.js';
import { HealthQueryService } from './query.js';
import { resolveHealthOwner } from './owner.js';
import { createHealthChanges } from './revisions.js';
import type { HealthData, HealthFoodLookup } from './query.js';
import type { InternalSavedNutrition } from './tools/saved-food.js';
import { suggest, type BudgetContext, type Suggestion } from './nutrition/model.js';
import type { NutritionSuggestionSources } from './nutrition/suggestion-adapter.js';
import { healthCapabilitiesAccept, healthQuerySources, healthQuerySourcesV1, healthQuerySourcesV2, healthQuerySourcesV3, healthQuerySourcesV6WithoutTrainingTargets, healthViewIds } from '@jarvis/contracts';
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
  const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createHealthModules(enabled)] });
  apps.push(app);
  return app;
}
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('Health integration contract', () => {
  it('defaults off and preserves the existing health route and tool catalogue', async () => {
    const baseline = buildApp(config, undefined, { auth, modules: [coreModule] });
    apps.push(baseline);
    for (const app of [fixture(), fixture(false)]) {
      expect((await app.inject('/health')).json()).toEqual((await baseline.inject('/health')).json());
      expect((await app.inject({ url: '/tools', headers: headers() })).json()).toEqual(
        (await baseline.inject({ url: '/tools', headers: headers() })).json(),
      );
      expect((await app.inject({ url: '/health/capabilities', headers: headers() })).statusCode).toBe(404);
    }
    expect(createHealthModules()).toEqual([]);
    expect(createHealthModules(false)).toEqual([]);
  });

  it('serves the temporary /daily alias for build 67 and earlier with the legacy module id', async () => {
    const app = fixture(true);
    const legacy = await app.inject({ url: '/daily/capabilities', headers: headers() });
    const current = await app.inject({ url: '/health/capabilities', headers: headers() });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().module).toBe('daily');
    expect(current.json().module).toBe('health');
    expect({ ...legacy.json(), module: 'health' }).toEqual(current.json());
    expect((await app.inject({ url: '/daily/capabilities' })).statusCode).toBe(401);
    expect((await fixture(false).inject({ url: '/daily/capabilities', headers: headers() })).statusCode).toBe(404);
  });

  it('maps the existing authenticated user and distinct hosted-agent identity to one server owner', async () => {
    const app = fixture(true);
    // Synthetic test route exercises the helper used by future Health data services.
    app.get('/synthetic-health-owner', { config: { jarvisAgent: true } }, async (request) => ({ owner: resolveHealthOwner(request) }));
    for (const kind of ['owner', 'agent']) {
      expect((await app.inject({ url: '/synthetic-health-owner', headers: headers(kind) })).json()).toEqual({ owner });
      const response = await app.inject({ url: '/health/capabilities', headers: headers(kind) });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({ stage: 'contract-only', pages: [], tools: [], reservedViewIds: { status: 'health-status' } });
      expect(JSON.stringify(response.json())).not.toContain(owner);
      expect(JSON.stringify(response.json())).not.toContain(agent);
    }
  });

  it('rejects unauthenticated, non-owner and coding-runner access', async () => {
    const app = fixture(true);
    expect((await app.inject('/health/capabilities')).statusCode).toBe(401);
    for (const kind of ['other', 'runner']) {
      expect((await app.inject({ url: '/health/capabilities', headers: headers(kind) })).statusCode).toBe(403);
    }
  });

  it('never accepts a caller-supplied owner or source owner', async () => {
    const app = fixture(true);
    for (const field of ['owner', 'ownerId', 'sourceOwnerId']) {
      expect((await app.inject({ url: `/health/capabilities?${field}=${other}`, headers: headers() })).statusCode).toBe(400);
    }
  });
  it('preserves v1-v5 capabilities and advertises only configured v6 lift sources', async () => {
    const query = vi.fn();
    const data: HealthData = { query: { query }, changes: createHealthChanges() };
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createHealthModules(true, data)] });
    apps.push(app);
    const responseBody = (version: number, sources: readonly string[]) => JSON.stringify({
      module: 'health', version, stage: 'read-only', reservedViewIds: healthViewIds,
      pages: [], tools: ['health_query', 'health_show'], sources,
      refresh: { event: 'now', refetchOn: ['connect', 'reconnect', 'refocus'], revision: 'query-content-sha256' },
    });
    for (const accept of [undefined, 'application/json', 'application/json;version=99']) {
      const response = await app.inject({ url: '/health/capabilities', headers: { ...headers(), ...(accept ? { accept } : {}) } });
      expect(response.body).toBe(responseBody(1, healthQuerySourcesV1));
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.vary).toContain('Accept');
    }
    const v2 = await app.inject({ url: '/health/capabilities', headers: { ...headers(), accept: 'application/json; version="2", application/json' } });
    expect(v2.statusCode).toBe(200);
    expect(v2.body).toBe(responseBody(2, healthQuerySourcesV2));
    expect(new MIMEType(String(v2.headers['content-type'])).params.get('version')).toBe('2');
    expect(healthQuerySourcesV2).not.toContain(healthQuerySources.metricCatalog);
    expect(healthQuerySourcesV2).not.toContain(healthQuerySources.days);
    const v3 = await app.inject({ url: '/health/capabilities', headers: { ...headers(), accept: 'application/json;version="3", application/json' } });
    expect(v3.statusCode).toBe(200);
    expect(v3.json()).toMatchObject({ version: 3, sources: healthQuerySourcesV3 });
    for (const accept of ['application/json;version="4", application/json']) {
      const modern = await app.inject({ url: '/health/capabilities', headers: { ...headers(), accept } });
      expect(modern.statusCode).toBe(200);
      const type = new MIMEType(String(modern.headers['content-type']));
      expect(type.essence).toBe('application/json');
      expect(type.params.get('version')).toBe('4');
      expect(modern.json()).toMatchObject({ version: 4, sources: healthQuerySourcesV3 });
      expect(modern.json().sources).not.toContain(healthQuerySources.attention);
      expect(modern.json().sources).not.toContain(healthQuerySources.calendar);
    }
    const latest = await app.inject({ url: '/health/capabilities', headers: { ...headers(), accept: healthCapabilitiesAccept } });
    expect(latest.json()).toMatchObject({ version: 6, sources: healthQuerySourcesV3 });
    expect(latest.json().sources).not.toContain(healthQuerySources.trainingTargets);
    expect(query).not.toHaveBeenCalled();
  });
  it('registers owner-only lift reads and writes and omits the lift source for the agent', async () => {
    const lift = {
      id: '33333333-3333-4333-8333-333333333333', exerciseName: 'Bench press', weightKg: 80,
      reps: 4, sets: 3, performedAt: '2026-10-30T12:00:00.000Z', deletedAt: null,
      updatedAt: '2026-10-30T12:00:00.000Z', revision: 1,
    };
    const history = vi.fn(async () => ({ items: [lift], next: null }));
    const entries = {
      history, create: vi.fn(async () => ({ entry: lift, replayed: false })),
      update: vi.fn(async () => lift), delete: vi.fn(async () => lift),
    };
    const data: HealthData = {
      changes: createHealthChanges(),
      query: new HealthQueryService({
        health: () => ({ history: vi.fn(), metricCatalog: vi.fn(), sync: vi.fn(), workoutDetail: vi.fn(), workoutMetrics: vi.fn(), heartRate: vi.fn() }),
        nutrition: () => ({ history: vi.fn(), days: vi.fn(), favorites: vi.fn(), plans: vi.fn() }),
        briefs: () => ({ history: vi.fn(), detail: vi.fn() }),
        lifts: () => entries,
      }),
      lifts: () => entries,
    };
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createHealthModules(true, data)] });
    apps.push(app);
    const capability = await app.inject({ url: '/health/capabilities', headers: { ...headers(), accept: healthCapabilitiesAccept } });
    expect(capability.json()).toMatchObject({ version: 6, sources: healthQuerySourcesV6WithoutTrainingTargets });
    const agentCapability = await app.inject({ url: '/health/capabilities', headers: { ...headers('agent'), accept: healthCapabilitiesAccept } });
    expect(agentCapability.json().sources).not.toContain(healthQuerySources.lifts);
    expect((await app.inject({ method: 'POST', url: '/health/query', headers: headers(),
      payload: { source: healthQuerySources.lifts, lastPerExercise: true } })).json().items).toEqual([lift]);
    expect((await app.inject({ method: 'POST', url: '/health/query', headers: headers('agent'),
      payload: { source: healthQuerySources.lifts } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/health/lifts', headers: headers(),
      payload: { idempotencyKey: '44444444-4444-4444-8444-444444444444', exerciseName: 'Bench press', weightKg: 80, reps: 4, sets: 3 } })).statusCode)
      .toBe(201);
    expect((await app.inject({ method: 'POST', url: '/health/lifts', headers: headers('agent'),
      payload: { idempotencyKey: '44444444-4444-4444-8444-444444444444', exerciseName: 'Bench press', weightKg: 80, reps: 4, sets: 3 } })).statusCode)
      .toBe(403);
    expect(entries.create).toHaveBeenCalledOnce();
    expect(history).toHaveBeenCalledOnce();
  });
  it('has no Health feed routes, tool or query sources', async () => {
    const data: HealthData = { query: { query: vi.fn() }, changes: createHealthChanges() };
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createHealthModules(true, data)] });
    apps.push(app);
    for (const path of ['/health/feeds/refresh', '/health/feeds/hide', '/health/feeds/receive', '/health/feeds/restore']) {
      expect((await app.inject({ method: 'POST', url: path, headers: headers(), payload: {} })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'POST', url: '/tools/health_feed', headers: headers(), payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/health/query', headers: headers(), payload: { source: 'daily.attention' } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/health/capabilities', headers: { ...headers(), accept: healthCapabilitiesAccept } })).json().sources)
      .not.toContain('daily.calendar');
  });
  it('requires an explicit internal store factory rather than enabling writes with read-only data', async () => {
    const data: HealthData = { query: { query: vi.fn() }, changes: createHealthChanges() };
    const internal = vi.fn(() => ({ intake: vi.fn(), lookupSaved: vi.fn(), log: vi.fn(), correct: vi.fn(), remove: vi.fn() }));
    expect(createHealthModules(false, data, undefined, internal)).toEqual([]);
    expect(createHealthModules(true, data)[0]!.tools.map(tool => tool.name)).toEqual(['health_query', 'health_show']);
    expect(() => createHealthModules(true, undefined, undefined, internal)).toThrow('shared Health data');
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createHealthModules(true, data, undefined, internal)] });
    apps.push(app);
    const response = await app.inject({ url: '/health/capabilities', headers: headers() });
    expect(response.json()).toMatchObject({ stage: 'internal-nutrition-rehearsal', pages: [], tools: ['health_query', 'health_show', 'health_food', 'health_food_review'] });
    expect(internal).not.toHaveBeenCalled();
    const catalogue = (await app.inject({ url: '/tools', headers: headers() })).json();
    expect(JSON.stringify(catalogue)).toContain('health_food');
    expect(JSON.stringify(catalogue)).toContain('health_food_review');
    expect(catalogue.some((tool: { name: string }) => tool.name.startsWith('daily_'))).toBe(false);
    // Legacy routes keep the same validation and permission boundary without being advertised.
    for (const name of ['health_food_review', 'daily_food_review']) {
      const response = await app.inject({ method: 'POST', url: `/tools/${name}`, headers: headers(), payload: {} });
      expect(response.json()).toMatchObject({ tool: 'health_food_review', outcome: 'refused' });
    }
  });
  it('adds saved-food workflows only with the separate additive factory, preserving existing compositions', async () => {
    const data: HealthData = { query: { query: vi.fn() }, changes: createHealthChanges() };
    const saved = vi.fn<InternalSavedNutrition>();
    expect(createHealthModules(false, data, undefined, undefined, saved)).toEqual([]);
    expect(() => createHealthModules(true, undefined, undefined, undefined, saved)).toThrow('shared Health data');
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createHealthModules(true, data, undefined, undefined, saved)] });
    apps.push(app);
    const response = await app.inject({ url: '/health/capabilities', headers: headers() });
    expect(response.json()).toMatchObject({ stage: 'internal-nutrition-rehearsal', tools: ['health_query', 'health_show', 'health_saved_food'], pages: [] });
    expect(saved).not.toHaveBeenCalled();
  });
  it('adds owner nutrition targets only with the separate accessor, behind the same Health gate, and keeps writes behind approval', async () => {
    const data: HealthData = { query: { query: vi.fn() }, changes: createHealthChanges() };
    const read = vi.fn(async () => ({ targets: { restingKcal: null, deficitKcal: null, proteinGrams: null }, updatedAt: null }));
    const write = vi.fn();
    const targets = vi.fn(() => ({ read, write }));
    expect(createHealthModules(false, data, undefined, undefined, undefined, targets)).toEqual([]);
    expect(createHealthModules(true, data)[0]!.tools.map(tool => tool.name)).toEqual(['health_query', 'health_show']);
    expect(() => createHealthModules(true, undefined, undefined, undefined, undefined, targets)).toThrow('shared Health data');
    const calls: ToolCallRecord[] = [];
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createHealthModules(true, data, undefined, undefined, undefined, targets)],
      toolCallStore: { record: async call => { calls.push(call); } } });
    apps.push(app);
    expect((await app.inject({ url: '/health/capabilities', headers: headers() })).json()).toMatchObject({
      stage: 'internal-nutrition-rehearsal', tools: ['health_query', 'health_show', 'health_nutrition_targets'], pages: [],
    });
    expect(targets).not.toHaveBeenCalled();
    for (const kind of ['owner', 'agent']) {
      const response = await app.inject({ method: 'POST', url: '/tools/health_nutrition_targets',
        headers: { ...headers(kind), 'x-jarvis-message-id': '42' }, payload: { operation: 'read' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ outcome: 'ok', result: { status: 'needs-configuration', missing: ['restingKcal', 'deficitKcal', 'proteinGrams'] } });
    }
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({
      tool: 'health_nutrition_targets', outcome: 'ok', arguments: { redacted: true }, result: { redacted: true },
    })]));
    // A change is refused, not silently applied, when native approval is not available.
    const change = await app.inject({ method: 'POST', url: '/tools/health_nutrition_targets',
      headers: { ...headers('agent'), 'x-jarvis-message-id': '42' }, payload: { operation: 'set_targets', targets: { restingKcal: 1750 } } });
    expect(change.json()).toMatchObject({ outcome: 'refused' });
    expect(write).not.toHaveBeenCalled();
    // The model cannot choose another owner or an extra field.
    const owned = await app.inject({ method: 'POST', url: '/tools/health_nutrition_targets',
      headers: { ...headers('agent'), 'x-jarvis-message-id': '42' }, payload: { operation: 'read', owner: other } });
    expect(owned.json()).toMatchObject({ outcome: 'refused' });
    const deniedOwner = await app.inject({ method: 'POST', url: '/tools/health_nutrition_targets',
      headers: { ...headers('other'), 'x-jarvis-message-id': '42' }, payload: { operation: 'read' } });
    expect(deniedOwner.json()).toMatchObject({ outcome: 'error', result: { error: 'Tool execution failed' } });
    for (const kind of ['runner', 'connector']) {
      expect((await app.inject({ method: 'POST', url: '/tools/health_nutrition_targets',
        headers: { ...headers(kind), 'x-jarvis-message-id': '42' }, payload: { operation: 'read' } })).statusCode).toBe(403);
    }
    expect(read).toHaveBeenCalledTimes(3);
    // The nutrition Settings route serves the signed-in owner only; the agent uses the approved nutrition tool.
    const settings = await app.inject({ url: '/health/nutrition-targets', headers: headers() });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({ missing: ['restingKcal', 'deficitKcal', 'proteinGrams'], updatedAt: null });
    expect((await app.inject({ url: '/health/nutrition-targets', headers: headers('agent') })).statusCode).toBe(403);
    expect((await app.inject({ url: '/health/nutrition-targets', headers: headers('other') })).statusCode).toBe(403);
  });
  it('leaves Jarvis unchanged when Health is off, even if the nutrition targets accessor is supplied', async () => {
    const data: HealthData = { query: { query: vi.fn() }, changes: createHealthChanges() };
    const targets = vi.fn();
    const baseline = buildApp(config, undefined, { auth, modules: [coreModule] });
    const off = buildApp(config, undefined, { auth, modules: [coreModule, ...createHealthModules(false, data, undefined, undefined, undefined, targets)] });
    apps.push(baseline, off);
    expect((await off.inject('/health')).json()).toEqual((await baseline.inject('/health')).json());
    expect((await off.inject({ url: '/tools', headers: headers() })).json()).toEqual((await baseline.inject({ url: '/tools', headers: headers() })).json());
    for (const url of ['/health/capabilities', '/health/nutrition-targets']) {
      expect((await off.inject({ url, headers: headers() })).statusCode).toBe(404);
    }
    expect((await off.inject({ method: 'PATCH', url: '/health/nutrition-targets', headers: headers(), payload: { restingKcal: 1750 } })).statusCode).toBe(404);
    expect(targets).not.toHaveBeenCalled();
  });
  it('adds the read-only suggestion tool only with the targets accessor and its own sources, behind the same Health gate', async () => {
    const data: HealthData = { query: { query: vi.fn() }, changes: createHealthChanges() };
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
    expect(createHealthModules(false, data, undefined, undefined, undefined, targets, sources)).toEqual([]);
    expect(() => createHealthModules(true, undefined, undefined, undefined, undefined, targets, sources)).toThrow('shared Health data');
    expect(() => createHealthModules(true, data, undefined, undefined, undefined, undefined, sources)).toThrow('require nutrition targets');
    expect(createHealthModules(true, data, undefined, undefined, undefined, targets)[0]!.tools.map(tool => tool.name)).toEqual(['health_query', 'health_show', 'health_nutrition_targets']);
    const calls: ToolCallRecord[] = [];
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createHealthModules(true, data, undefined, undefined, undefined, targets, sources)],
      toolCallStore: { record: async call => { calls.push(call); } } });
    apps.push(app);
    expect((await app.inject({ url: '/health/capabilities', headers: headers() })).json()).toMatchObject({
      stage: 'internal-nutrition-rehearsal', tools: ['health_query', 'health_show', 'health_nutrition_targets', 'health_nutrition_suggest'], pages: [],
    });
    for (const access of [targets, nutrition, health]) expect(access).not.toHaveBeenCalled();
    for (const kind of ['owner', 'agent']) {
      const response = await app.inject({ method: 'POST', url: '/tools/health_nutrition_suggest',
        headers: { ...headers(kind), 'x-jarvis-message-id': '42' }, payload: { limit: 3 } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ outcome: 'ok', result: {
        status: 'ready', localDate: '2026-10-17', kcal: { state: 'ready', remainingKcal: 1700 },
        suggestions: [{ favoriteId: 'a', name: 'Synthetic favourite' }],
      } });
    }
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({
      tool: 'health_nutrition_suggest', outcome: 'ok', arguments: { redacted: true }, result: { redacted: true },
    })]));
    expect(JSON.stringify(calls)).not.toContain('Synthetic favourite');
    // The model cannot choose another owner, date or budget.
    const owned = await app.inject({ method: 'POST', url: '/tools/health_nutrition_suggest',
      headers: { ...headers('agent'), 'x-jarvis-message-id': '42' }, payload: { owner: other } });
    expect(owned.json()).toMatchObject({ outcome: 'refused' });
    const deniedOwner = await app.inject({ method: 'POST', url: '/tools/health_nutrition_suggest',
      headers: { ...headers('other'), 'x-jarvis-message-id': '42' }, payload: {} });
    expect(deniedOwner.json()).toMatchObject({ outcome: 'error', result: { error: 'Tool execution failed' } });
    for (const kind of ['runner', 'connector']) {
      expect((await app.inject({ method: 'POST', url: '/tools/health_nutrition_suggest',
        headers: { ...headers(kind), 'x-jarvis-message-id': '42' }, payload: {} })).statusCode).toBe(403);
    }
    expect(read).toHaveBeenCalledTimes(2);
    expect(healthHistory).toHaveBeenCalledTimes(2);
    expect(matches).toHaveBeenCalledTimes(2);
  });
  it('leaves Jarvis unchanged when Health is off, even if the suggestion sources are supplied', async () => {
    const data: HealthData = { query: { query: vi.fn() }, changes: createHealthChanges() };
    const targets = vi.fn();
    const nutrition = vi.fn();
    const health = vi.fn();
    const sources = { nutrition, health } as unknown as NutritionSuggestionSources;
    const baseline = buildApp(config, undefined, { auth, modules: [coreModule] });
    const off = buildApp(config, undefined, { auth, modules: [coreModule, ...createHealthModules(false, data, undefined, undefined, undefined, targets, sources)] });
    apps.push(baseline, off);
    expect((await off.inject('/health')).json()).toEqual((await baseline.inject('/health')).json());
    expect((await off.inject({ url: '/tools', headers: headers() })).json()).toEqual((await baseline.inject({ url: '/tools', headers: headers() })).json());
    expect((await off.inject({ url: '/health/capabilities', headers: headers() })).statusCode).toBe(404);
    expect((await off.inject({ method: 'POST', url: '/tools/health_nutrition_suggest',
      headers: { ...headers(), 'x-jarvis-message-id': '42' }, payload: {} })).statusCode).toBe(404);
    for (const access of [targets, nutrition, health]) expect(access).not.toHaveBeenCalled();
  });
  it('registers Frida lookup through food review and never calls it during composition', async () => {
    const foodLookup = vi.fn<HealthFoodLookup>();
    const data: HealthData = { query: { query: vi.fn() }, changes: createHealthChanges(), foodLookup };
    const internal = vi.fn(() => ({
      intake: vi.fn(), lookupSaved: vi.fn(), log: vi.fn(), correct: vi.fn(), remove: vi.fn(),
    }));
    expect(createHealthModules(false, data)).toEqual([]);
    const modules = createHealthModules(true, data, undefined, internal);
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...modules] });
    apps.push(app);
    expect((await app.inject({ url: '/health/capabilities', headers: headers() })).json()).toMatchObject({
      stage: 'internal-nutrition-rehearsal', tools: ['health_query', 'health_show', 'health_food', 'health_food_review'], pages: [],
    });
    const review = modules[0]!.tools.find(({ name }) => name === 'health_food_review');
    expect(review?.description).toContain('lookup_components');
    expect(modules[0]!.tools.map(({ name }) => name)).not.toContain('health_food_lookup');
    expect(internal).not.toHaveBeenCalled();
    expect(foodLookup).not.toHaveBeenCalled();
  });
  it('bridges owner commits to the Now refresh event until shutdown', async () => {
    const changes = createHealthChanges();
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createHealthModules(true, { query: { query: vi.fn() }, changes })] });
    apps.push(app);
    await app.ready();
    const publish = vi.spyOn(app.nowEventHub, 'publish');
    changes.publish({ owner: other, sources: ['daily.health'] }); expect(publish).not.toHaveBeenCalled();
    changes.publish({ owner, sources: ['daily.health'] }); expect(publish).toHaveBeenCalledWith({ type: 'refresh' });
    await app.close(); publish.mockClear();
    changes.publish({ owner, sources: ['daily.health'] }); expect(publish).not.toHaveBeenCalled();
  });
});
