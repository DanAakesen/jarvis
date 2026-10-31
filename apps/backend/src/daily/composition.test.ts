import { readFileSync } from 'node:fs';
import { dailyQuerySources } from '@jarvis/contracts';
import type sql from 'mssql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { AuthenticationDenied, type TokenVerifier } from '../auth/verify.js';
import { loadConfig } from '../config.js';
import { ConfigurationError } from '../configuration-error.js';
import { capabilityInstructions } from '../core/capability-instructions.js';
import { coreModule } from '../core/index.js';
import { defaultSettings } from '../core/settings.js';
import type { ToolCallRecord, ToolCallStore } from '../core/tool-calls.js';
import type { JarvisTool } from '../core/tool-registry.js';
import { WorkspaceCommandBroker } from '../core/workspace-commands.js';
import type { BackendModule } from '../modules.js';
import { createRealtimeSessionUpdate } from '../voice/realtime.js';
import { FridaLookupAdapter, fridaReference, type FridaLookup } from './nutrition/frida.js';
import { composeDaily } from './composition.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const owner = config.auth.ownerObjectId;
const agent = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const dailyToolNames = [
  'health_query', 'health_show', 'health_food', 'health_food_review', 'health_saved_food', 'health_nutrition_targets', 'health_nutrition_suggest',
  'health_summary', 'health_nutrition_history', 'health_coach_status',
];
type App = ReturnType<typeof buildApp>;
const apps: App[] = [];
const headers = (kind = 'owner') => ({ authorization: ['Bearer', `${kind}.a.b`].join(' ') });
const toolHeaders = (kind = 'owner') => ({ ...headers(kind), 'x-jarvis-message-id': '42' });
const auth: TokenVerifier = async (token) => {
  const kind = token.split('.')[0];
  if (kind === 'agent') return { kind: 'jarvis-agent', objectId: agent, tenantId: config.auth.tenantId };
  if (kind === 'runner') return { kind: 'jarvis-runner', objectId: other, tenantId: config.auth.tenantId };
  if (kind === 'connector') {
    return { kind: 'jarvis-daily-connector', objectId: owner, tenantId: config.auth.tenantId, clientId: other, scopes: ['Daily.Nutrition.Read'] };
  }
  return { objectId: kind === 'other' ? other : owner.toUpperCase(), tenantId: config.auth.tenantId, displayName: 'Synthetic user' };
};

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

/** A pool that records every property read, so a test can prove Daily never reached for SQL. */
function untouchedPool() {
  const touched: string[] = [];
  const pool = new Proxy({}, {
    get: (target, property) => {
      touched.push(String(property));
      return (target as Record<string | symbol, unknown>)[property];
    },
  }) as unknown as sql.ConnectionPool;
  return { pool, touched };
}

function composed(ownerObjectId = owner) {
  const { pool, touched } = untouchedPool();
  const module = composeDaily({ enabled: true, pool, ownerObjectId });
  if (!module) throw new Error('Daily did not compose');
  return { module, touched };
}

function fixture(daily?: BackendModule, toolCallStore?: ToolCallStore, workspaceCommands?: WorkspaceCommandBroker) {
  const app = buildApp(config, undefined, {
    auth, modules: [coreModule, ...(daily ? [daily] : [])],
    ...(toolCallStore ? { toolCallStore } : {}), ...(workspaceCommands ? { workspaceCommands } : {}),
  });
  apps.push(app);
  return app;
}

/** Records what each tool throws, because the tool route reports every such error as one generic failure. */
function observed(daily: BackendModule, thrown: unknown[]): BackendModule {
  return {
    ...daily,
    tools: daily.tools.map((tool): JarvisTool => ({
      ...tool,
      execute: async (input, request, signal) => {
        try {
          return await tool.execute(input, request, signal);
        } catch (error) {
          thrown.push(error);
          throw error;
        }
      },
    })),
  };
}

async function routeTable(app: App) {
  const urls = new Set<string>();
  app.addHook('onRoute', (route) => { urls.add(route.url); });
  await app.ready();
  return urls;
}

async function toolNames(app: App) {
  const response = await app.inject({ url: '/tools', headers: headers() });
  expect(response.statusCode).toBe(200);
  return (response.json() as { name: string }[]).map(({ name }) => name);
}

interface Probe { readonly method: 'GET' | 'POST' | 'PATCH'; readonly url: string; readonly payload?: object }
const dailyRoutes: readonly Probe[] = [
  { method: 'GET', url: '/daily/capabilities' },
  { method: 'POST', url: '/daily/query', payload: { source: dailyQuerySources.metrics, startDate: '2026-10-01', endDate: '2026-10-16' } },
  { method: 'GET', url: '/daily/nutrition-targets' },
  { method: 'PATCH', url: '/daily/nutrition-targets', payload: { restingKcal: 1750 } },
  { method: 'GET', url: '/daily/training-targets' },
  { method: 'PATCH', url: '/daily/training-targets', payload: { gymSessionsPerWeek: 3 } },
];
const send = (app: App, { method, url, payload }: Probe, kind?: string) => app.inject({
  method, url, ...(kind ? { headers: headers(kind) } : {}), ...(payload ? { payload } : {}),
});

describe('Daily composition', () => {
  it('returns nothing, validates nothing and touches no pool unless the switch is exactly true', () => {
    const { pool, touched } = untouchedPool();
    expect(composeDaily({ enabled: false, pool, ownerObjectId: owner })).toBeUndefined();
    expect(composeDaily({ enabled: false, pool: undefined, ownerObjectId: 'not a UUID' })).toBeUndefined();
    expect(composeDaily({ enabled: 'true' as never, pool, ownerObjectId: owner })).toBeUndefined();
    expect(touched).toEqual([]);
  });

  it('refuses to compose without SQL or with a non-UUID owner', () => {
    const { pool } = untouchedPool();
    expect(() => composeDaily({ enabled: true, pool: undefined, ownerObjectId: owner })).toThrow(ConfigurationError);
    expect(() => composeDaily({ enabled: true, pool: undefined, ownerObjectId: owner })).toThrow('SQL is required for Daily');
    for (const ownerObjectId of ['', 'not a UUID', owner.slice(1)]) {
      expect(() => composeDaily({ enabled: true, pool, ownerObjectId })).toThrow('The Daily owner must be a UUID');
    }
  });

  it('starts no timer or loop when composed, on or off', () => {
    vi.useFakeTimers();
    try {
      const { pool } = untouchedPool();
      composeDaily({ enabled: false, pool, ownerObjectId: owner });
      expect(composeDaily({ enabled: true, pool, ownerObjectId: owner })).toBeDefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the route table, tool catalogue, voice session, health and startup unchanged when Daily is off', async () => {
    const baseline = fixture();
    const off = fixture(composeDaily({ enabled: false, pool: untouchedPool().pool, ownerObjectId: owner }));
    const baselineRoutes = await routeTable(baseline);
    const offRoutes = await routeTable(off);
    expect(baselineRoutes.has('/tools')).toBe(true);
    expect([...offRoutes].sort()).toEqual([...baselineRoutes].sort());
    expect([...offRoutes].filter((url) => url.startsWith('/daily'))).toEqual([]);

    expect((await off.inject('/health')).json()).toEqual((await baseline.inject('/health')).json());
    const names = await toolNames(off);
    expect(names).toEqual(await toolNames(baseline));
    for (const name of dailyToolNames) expect(names).not.toContain(name);
    expect(createRealtimeSessionUpdate(off.jarvisTools).session.tools.map(({ name }) => name))
      .toEqual(createRealtimeSessionUpdate(baseline.jarvisTools).session.tools.map(({ name }) => name));
    expect(capabilityInstructions(defaultSettings.memory)).not.toMatch(/\bdaily_[a-z0-9_]+\b/u);

    for (const probe of dailyRoutes) expect((await send(off, probe, 'owner')).statusCode, `${probe.method} ${probe.url}`).toBe(404);
    expect((await off.inject({ url: '/daily/mcp', headers: headers() })).statusCode).toBe(404);
    expect((await off.inject({ method: 'POST', url: '/tools/health_nutrition_suggest', headers: toolHeaders(), payload: {} })).statusCode).toBe(404);
    expect(await off.backgroundJobs.list()).toEqual([]);
  });

  it('adds only the owner-bound Daily routes and tools when Daily is on', async () => {
    const { module, touched } = composed();
    expect(Object.keys(module).sort()).toEqual(['id', 'registerRoutes', 'tools']);
    expect(module.id).toBe('daily');
    expect(module.tools.map(({ name }) => name)).toEqual(dailyToolNames);
    expect(module.tools.map(({ name }) => name)).not.toContain('health_food_lookup');
    expect(module.tools.find(({ name }) => name === 'health_food_review')?.description).toContain('lookup_components');
    expect(module.tools.find(({ name }) => name === 'health_saved_food')?.execution).toEqual({
      defaultEffect: 'unclassified',
      operation: {
        field: 'operation',
        effects: {
          lookup_saved: 'read', read_preferences: 'read', save_favorite: 'action',
          save_plan: 'action', delete_plan: 'action', set_feedback: 'action',
        },
      },
    });

    const baseline = fixture();
    const on = fixture(module);
    const baselineRoutes = await routeTable(baseline);
    const onRoutes = await routeTable(on);
    expect([...onRoutes].filter((url) => !baselineRoutes.has(url)).sort()).toEqual([
      '/daily/capabilities', '/daily/lifts', '/daily/lifts/:id', '/daily/nutrition-targets', '/daily/training-targets', '/daily/query',
      ...dailyToolNames.flatMap((name) => [`/tools/${name}`, `/tools/${name === 'health_summary' ? 'daily_health_summary' : name === 'health_history' ? 'daily_health_history' : name.replace(/^health_/u, 'daily_')}`]),
    ].sort());
    expect([...baselineRoutes].filter((url) => !onRoutes.has(url))).toEqual([]);

    const capabilities = await on.inject({ url: '/daily/capabilities', headers: headers() });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toMatchObject({ module: 'daily', stage: 'internal-nutrition-rehearsal', pages: [], tools: dailyToolNames });
    expect(capabilities.json()).not.toHaveProperty('connector');
    expect((await on.inject({ url: '/daily/mcp', headers: headers() })).statusCode).toBe(404);

    const names = await toolNames(on);
    expect(names).toEqual([...await toolNames(baseline), ...dailyToolNames]);
    expect(createRealtimeSessionUpdate(on.jarvisTools).session.tools.map(({ name }) => name)).toEqual(names);
    expect(await on.backgroundJobs.list()).toEqual([]);
    expect(touched).toEqual([]);
  });

  it('injects Frida lazily into the existing review tool without registering another catalogue name', async () => {
    const { module } = composed();
    const review = module.tools.find(({ name }) => name === 'health_food_review')!;
    const lookup = vi.spyOn(FridaLookupAdapter.prototype, 'lookup').mockResolvedValue({
      status: 'complete', confirmationRequired: true, reference: fridaReference, components: [],
      totals: { energyKcal: null, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null },
      matchedSubtotals: { energyKcal: null, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null },
      unknowns: [],
    } satisfies FridaLookup);
    const session = { id: 'synthetic-session', channel: 'chat', language: 'en', startedAt: new Date(), endedAt: null };
    const source = { id: '42', sessionId: session.id, role: 'dan', text: 'Look up synthetic food', at: new Date(), model: null };
    const request = {
      server: { ownerObjectId: owner, conversationStore: { getSession: vi.fn(async () => session) } },
      principal: { objectId: owner }, headers: {}, jarvisConversationMessage: source,
    } as unknown as FastifyRequest;
    try {
      const result = await review.execute({ change: { operation: 'lookup_components',
        components: [{ name: 'Synthetic food', grams: 100, preparationMethod: null }] } }, request, new AbortController().signal);
      expect(result).toMatchObject({ status: 'complete', intakeLogged: false });
      expect(lookup).toHaveBeenCalledOnce();
      const other = { ...request, principal: { objectId: '22222222-2222-4222-8222-222222222222' } } as FastifyRequest;
      await expect(review.execute({ change: { operation: 'lookup_components',
        components: [{ name: 'Synthetic food', grams: 100, preparationMethod: null }] } }, other, new AbortController().signal)).rejects.toThrow();
      expect(lookup).toHaveBeenCalledOnce();
      expect(module.tools.map(({ name }) => name)).not.toContain('health_food_lookup');
    } finally { lookup.mockRestore(); }
  });

  it('fails closed before any SQL for unauthenticated, non-owner, runner and connector callers', async () => {
    const { module, touched } = composed();
    const app = fixture(module);
    for (const probe of dailyRoutes) {
      expect((await send(app, probe)).statusCode, `${probe.method} ${probe.url} without credentials`).toBe(401);
      for (const kind of ['other', 'runner', 'connector']) {
        expect((await send(app, probe, kind)).statusCode, `${probe.method} ${probe.url} as ${kind}`).toBe(403);
      }
    }
    // Training-target Settings routes are restricted to the signed-in owner.
    for (const probe of dailyRoutes.filter(({ url }) => url.endsWith('-targets'))) {
      expect((await send(app, probe, 'agent')).statusCode, `${probe.method} ${probe.url} as agent`).toBe(403);
    }
    expect(touched).toEqual([]);
  });

  it('denies even the real owner, on routes and tools, when the composed owner differs', async () => {
    const { module, touched } = composed(other);
    const thrown: unknown[] = [];
    const calls: ToolCallRecord[] = [];
    // A tool route answers 503 before it runs the tool when the app has no call store, so this app gets a minimal one.
    // health_show refuses to read at all without an open workspace tab, so the app also gets one connected tab.
    const broker = new WorkspaceCommandBroker();
    broker.connect(owner, () => true);
    const app = fixture(observed(module, thrown), { record: async (call) => { calls.push(call); } }, broker);
    for (const probe of dailyRoutes.filter(({ url }) => url !== '/daily/capabilities')) {
      expect((await send(app, probe, 'owner')).statusCode, `${probe.method} ${probe.url}`).toBe(403);
    }
    const toolCalls: readonly (readonly [string, object])[] = [
      ['health_nutrition_suggest', {}],
      ['health_nutrition_targets', { operation: 'read' }],
      ['health_show', { source: dailyQuerySources.metrics, startDate: '2026-10-01', endDate: '2026-10-16' }],
    ];
    for (const [name, payload] of toolCalls) {
      const response = await app.inject({ method: 'POST', url: `/tools/${name}`, headers: toolHeaders(), payload });
      expect(response.statusCode, name).toBe(200);
      expect(response.json(), name).toMatchObject({ tool: name, outcome: 'error', result: { error: 'Tool execution failed' } });
    }
    // Each tool ran and was denied by the Daily owner check itself, not by some other fault.
    expect(thrown).toHaveLength(toolCalls.length);
    for (const error of thrown) {
      expect(error).toBeInstanceOf(AuthenticationDenied);
      expect((error as AuthenticationDenied).statusCode).toBe(403);
    }
    expect(calls).toMatchObject(toolCalls.map(([tool]) => ({
      messageId: '42', tool, outcome: 'error', arguments: { redacted: true }, result: { redacted: true },
    })));
    expect(touched).toEqual([]);
  });

  it('is wired into startup once, from the strict config switch only', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(source.match(/composeDaily\(/gu)).toHaveLength(1);
    expect(source).toContain('enabled: config.dailyEnabled === true');
  });
});
