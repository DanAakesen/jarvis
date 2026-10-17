import Fastify from 'fastify';
import { Client, isInputRequiredResult, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyQueryResult } from '@jarvis/contracts';
import { installAuthentication } from '../../auth/hook.js';
import { AuthenticationDenied, dailyNutritionScopes } from '../../auth/verify.js';
import { loadConfig } from '../../config.js';
import type { ToolCallRecord, ToolCallStore } from '../../core/tool-calls.js';
import { ToolRefusal } from '../../core/tool-registry.js';
import { createDailyModules } from '../index.js';
import { fridaReference, type FridaLookup } from '../nutrition/frida.js';
import type { createNutritionHandlers } from '../nutrition/handlers.js';
import { canonicalJson, prepareMeal, type MealInput } from '../nutrition/model.js';
import type { DailyQueryService } from '../query.js';
import { dailyMcpMetadataPath, dailyMcpPath } from './paths.js';
import { dailyMcpRoutes } from './routes.js';

const base = loadConfig({});
const clientId = '44444444-4444-4444-8444-444444444444';
const resource = 'https://nutrition.example.test/daily/mcp';
const config = { ...base, auth: { ...base.auth, dailyConnectorClientId: clientId } };
const apps: ReturnType<typeof Fastify>[] = [];
const clients: Client[] = [];
type Handlers = ReturnType<typeof createNutritionHandlers>;
const empty: DailyQueryResult = {
  source: 'daily.nutrition.favorites', period: null, items: [], status: 'empty', units: {},
  provenance: { store: 'daily-sql', detail: 'retained-record', calculations: 'existing-read-model', consistency: 'independent-committed-reads' },
  freshness: { observedAt: '2026-10-16T12:00:00Z', sourceProcessedCommittedAt: null, latestReturnedRecordUpdatedAt: null, staleness: 'unknown' },
  coverage: { returned: 0, hasMore: false, next: null, sourceCompleteness: 'unknown' }, revision: 'synthetic-query-revision',
};
const unknowns = { energyKcal: null, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null };
const frida: FridaLookup = {
  status: 'partial', confirmationRequired: true, reference: fridaReference,
  components: [], totals: unknowns, matchedSubtotals: unknowns, unknowns: ['synthetic missing quantity'],
};
const food = {
  operationId: 'synthetic-operation', mealName: 'Synthetic meal', energyKcal: 200,
  captureMethod: 'photo', confidence: 'accurate',
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
  await Promise.all(apps.splice(0).map(app => app.close()));
});

async function fixture(writesEnabled = true) {
  let time = '2026-10-16T21:59:00Z';
  let commits = 0;
  const rows = new Map<string, { input: MealInput; row: Record<string, unknown> }>();
  const audit = vi.fn<ToolCallStore['record']>().mockResolvedValue(undefined);
  const query = { query: vi.fn<DailyQueryService['query']>().mockResolvedValue(empty) };
  const nutrition: Handlers = {
    lookup: vi.fn<Handlers['lookup']>().mockResolvedValue(frida),
    lookupSaved: vi.fn<Handlers['lookupSaved']>().mockResolvedValue(null),
    intake: vi.fn<Handlers['intake']>(async key => rows.get(key)?.row ?? null),
    log: vi.fn<Handlers['log']>(async (input, context) => {
      const prepared = prepareMeal(input, context.requestTime);
      const saved = rows.get(prepared.idempotencyKey);
      if (saved) {
        if (canonicalJson(saved.input) !== canonicalJson(prepared)) throw new ToolRefusal('Synthetic conflicting operation key.');
        return saved.row;
      }
      commits++;
      const row = {
        id: prepared.id, idempotency_key: prepared.idempotencyKey, revision: 1n, deleted_at: null,
        meal_name: prepared.mealName, occurred_at: prepared.occurredAt,
        energy_kcal: prepared.energyKcal, protein_grams: prepared.proteinGrams, carbohydrates_grams: prepared.carbohydratesGrams,
        fat_grams: prepared.fatGrams, fiber_grams: prepared.fiberGrams,
        owner_object_id: config.auth.ownerObjectId, private_synthetic_marker: 'never-expose-this',
      };
      rows.set(prepared.idempotencyKey, { input: prepared, row });
      return row;
    }),
    correct: vi.fn<Handlers['correct']>().mockResolvedValue({ id: 'synthetic', idempotency_key: 'synthetic-key', revision: 2n }),
    remove: vi.fn<Handlers['remove']>().mockResolvedValue({ id: 'synthetic', idempotency_key: 'synthetic-key', revision: 2n }),
    favorite: vi.fn<Handlers['favorite']>().mockResolvedValue(undefined),
    plan: vi.fn<Handlers['plan']>().mockResolvedValue({}),
  };
  const app = Fastify({ logger: false });
  apps.push(app);
  app.decorate('ownerObjectId', config.auth.ownerObjectId);
  app.decorate('toolCallStore', { record: audit });
  installAuthentication(app, config, async token => {
    const kind = token.split('.')[0];
    if (kind === 'owner') return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Synthetic' };
    return {
      kind: 'jarvis-daily-connector', objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, clientId,
      scopes: kind === 'write' ? [dailyNutritionScopes.read, dailyNutritionScopes.write] : [dailyNutritionScopes.read],
    };
  });
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof AuthenticationDenied ? error.statusCode : 500).send({ error: 'Denied or unavailable' });
  });
  const options = { auth: config.auth, resource, nutrition, writesEnabled, now: () => time };
  await app.register(dailyMcpRoutes(query, options));
  await app.ready();
  async function connect(kind = 'write', answer: 'accept' | 'decline' | 'cancel' = 'accept', elicitation = true, manual = false) {
    const messages: string[] = [];
    const client = new Client({ name: 'synthetic-nutrition-client', version: '1.0.0' }, {
      capabilities: elicitation ? { elicitation: { form: {} } } : {},
      inputRequired: { autoFulfill: !manual },
    });
    clients.push(client);
    if (elicitation) client.setRequestHandler('elicitation/create', async request => {
      messages.push(request.params.message);
      return { action: answer, content: { confirm: answer === 'accept' } };
    });
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const method = request.method;
      if (url.origin !== new URL(resource).origin || !['GET', 'POST', 'DELETE'].includes(method)) throw new Error('Unexpected synthetic transport request');
      if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') throw new Error('Unsupported synthetic method');
      const response = await app.inject({
        method, url: url.pathname + url.search,
        headers: { ...Object.fromEntries(request.headers), host: url.host },
        ...(method === 'POST' ? { payload: await request.text() } : {}),
      });
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, String(value));
      return new Response(response.statusCode === 204 || response.statusCode === 304 ? null : response.body, { status: response.statusCode, headers });
    };
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
      fetch: fetcher, requestInit: { headers: { authorization: `Bearer ${kind}.token.value` } },
    }));
    return { client, messages };
  }
  return { app, options, nutrition, query, audit, connect, commits: () => commits, setTime: (value: string) => { time = value; } };
}

describe('inactive hosted nutrition MCP adapter', () => {
  it('keeps both composition gates off by default and exposes no general Jarvis tools', async () => {
    const f = await fixture(false);
    expect(createDailyModules(false, undefined, f.options)).toEqual([]);
    const { client } = await f.connect();
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(['lookup_food', 'read_nutrition']);
    expect(f.nutrition.log).not.toHaveBeenCalled();
    const metadata = await f.app.inject(dailyMcpMetadataPath);
    expect(metadata.json().scopes_supported).toEqual([`api://${config.auth.apiClientId}/${dailyNutritionScopes.read}`]);
    expect((await f.app.inject({ method: 'POST', url: dailyMcpPath, headers: { host: 'nutrition.example.test', authorization: 'Bearer owner.token.value' }, payload: {} })).statusCode).toBe(403);
  });

  it('reuses the shared bounded nutrition query and read-only provider service without leaking raw records', async () => {
    const f = await fixture();
    const { client } = await f.connect('read');
    const result = await client.callTool({ name: 'read_nutrition', arguments: { source: 'daily.nutrition.favorites' } });
    expect(result.structuredContent).toEqual(empty);
    expect(f.query.query).toHaveBeenCalledOnce();
    await client.callTool({ name: 'lookup_food', arguments: { components: [{ name: 'Synthetic food', grams: null, preparationMethod: null }] } });
    expect(f.nutrition.lookup).toHaveBeenCalledOnce();
    const refused = await client.callTool({ name: 'read_nutrition', arguments: { source: 'daily.health.metrics', owner: 'foreign' } });
    expect(refused.isError).toBe(true);
    expect(f.query.query).toHaveBeenCalledOnce();
  });

  it('requires native review even when a photo claims accurate confidence, freezes the Copenhagen occurrence and returns a committed receipt', async () => {
    const f = await fixture();
    const { client, messages } = await f.connect();
    client.setRequestHandler('elicitation/create', async request => {
      messages.push(request.params.message);
      expect(f.commits()).toBe(0);
      f.setTime('2026-10-16T22:01:00Z');
      return { action: 'accept', content: { confirm: true } };
    });
    const result = await client.callTool({ name: 'log_food', arguments: food });
    expect(result.isError).not.toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Synthetic meal');
    expect(messages[0]).toContain('"captureMethod": "photo"');
    expect(f.commits()).toBe(1);
    expect(f.nutrition.log).toHaveBeenCalledWith(expect.objectContaining({
      occurredAt: '2026-10-16T21:59:00Z', mealDate: '2026-10-16', proteinGrams: null,
      provenance: { source: 'chatgpt-supplied', independentlyVerified: false },
    }), expect.objectContaining({ intent: 'log-intake', proposalRequired: true, proposalAccepted: true }));
    expect(result.structuredContent).toMatchObject({ status: 'committed', revision: '1', energyKcal: 200, proteinGrams: null });
    expect(result.content?.[0]).toMatchObject({ type: 'text', text: expect.stringContaining('"status":"committed"') });
    expect(JSON.stringify(result)).not.toContain('never-expose-this');
    expect(JSON.stringify(result)).not.toContain(config.auth.ownerObjectId);
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain('Synthetic meal');
    expect(f.audit.mock.calls.map(([call]) => call.result)).toContainEqual({ redacted: true, phase: 'awaiting_confirmation' });
  });

  it.each(['decline', 'cancel'] as const)('does not persist or repeatedly request approval after %s', async action => {
    const f = await fixture();
    const { client, messages } = await f.connect('write', action);
    const result = await client.callTool({ name: 'log_food', arguments: food });
    expect(result.isError).toBe(true);
    expect(messages).toHaveLength(1);
    expect(f.commits()).toBe(0);
    expect(f.nutrition.log).not.toHaveBeenCalled();
  });

  it('does not deserialize a model confirmation, owner or caller-selected meal ID', async () => {
    const f = await fixture();
    const { client, messages } = await f.connect();
    for (const extra of [{ userConfirmed: true }, { proposalAccepted: true }, { owner: 'foreign' }, { id: 'caller-selected' }]) {
      const result = await client.callTool({ name: 'log_food', arguments: { ...food, ...extra } });
      expect(result.isError).toBe(true);
    }
    expect(messages).toHaveLength(0);
    expect(f.commits()).toBe(0);
  });

  it('refuses write-scope escalation and an absent audit store before executing the domain operation', async () => {
    const f = await fixture();
    const { client } = await f.connect('read');
    const refused = await client.callTool({ name: 'log_food', arguments: food });
    expect(refused.isError).toBe(true);
    expect(refused._meta).toMatchObject({ 'mcp/www_authenticate': [expect.stringContaining('Daily.Nutrition.Write')] });
    expect(f.nutrition.intake).not.toHaveBeenCalled();
    f.app.toolCallStore = null;
    expect((await client.callTool({ name: 'read_nutrition', arguments: { source: 'daily.nutrition.favorites' } })).isError).toBe(true);
    expect(f.query.query).not.toHaveBeenCalled();
  });

  it('refuses unsupported native review and unchecked acceptance without executing a write', async () => {
    const f = await fixture();
    const unsupported = await f.connect('write', 'accept', false);
    await expect(unsupported.client.callTool({ name: 'log_food', arguments: food })).rejects.toThrow();
    const { client } = await f.connect();
    client.setRequestHandler('elicitation/create', async () => ({ action: 'accept', content: { confirm: false } }));
    expect((await client.callTool({ name: 'log_food', arguments: food })).isError).toBe(true);
    expect(f.nutrition.log).not.toHaveBeenCalled();
  });

  it('requires signed review state, refuses changed payload/purpose and rejects tampered or expired state', async () => {
    const f = await fixture();
    const { client } = await f.connect('write', 'accept', true, true);
    const inputResponses = { confirm: { action: 'accept', content: { confirm: true } } };
    const first = await client.request({
      method: 'tools/call', params: { name: 'log_food', arguments: food, inputResponses },
    }, { allowInputRequired: true });
    expect(isInputRequiredResult(first)).toBe(true);
    if (!isInputRequiredResult(first) || !first.requestState) throw new Error('Synthetic review state missing');
    const changed = await client.request({
      method: 'tools/call', params: { name: 'log_food', arguments: { ...food, energyKcal: 201 }, requestState: first.requestState, inputResponses },
    }, { allowInputRequired: true });
    expect(changed).toMatchObject({ isError: true });
    const repurposed = await client.request({
      method: 'tools/call',
      params: { name: 'delete_food', arguments: { idempotencyKey: 'synthetic-key', expectedRevision: '1' }, requestState: first.requestState, inputResponses },
    }, { allowInputRequired: true });
    expect(repurposed).toMatchObject({ isError: true });
    await expect(client.request({
      method: 'tools/call', params: { name: 'log_food', arguments: food, requestState: first.requestState + 'tampered', inputResponses },
    }, { allowInputRequired: true })).rejects.toThrow('requestState');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601_000);
    try {
      await expect(client.request({
        method: 'tools/call', params: { name: 'log_food', arguments: food, requestState: first.requestState, inputResponses },
      }, { allowInputRequired: true })).rejects.toThrow('requestState');
    } finally { clock.mockRestore(); }
    expect(f.nutrition.log).not.toHaveBeenCalled();
    expect(f.nutrition.remove).not.toHaveBeenCalled();
  });

  it('replays the same committed intake after the clock changes without creating another meal', async () => {
    const f = await fixture();
    const { client } = await f.connect();
    const first = await client.callTool({ name: 'log_food', arguments: food });
    f.setTime('2026-10-17T08:00:00Z');
    const second = await client.callTool({ name: 'log_food', arguments: food });
    expect(second.isError).not.toBe(true);
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(f.commits()).toBe(1);
  });

  it('does not silently clear unspecified nutrients in a correction and uses decimal-string revisions', async () => {
    const f = await fixture();
    const { client } = await f.connect();
    const result = await client.callTool({
      name: 'correct_food', arguments: { idempotencyKey: 'synthetic-key', expectedRevision: '1', changes: { mealName: 'Renamed synthetic meal' } },
    });
    expect(result.isError).not.toBe(true);
    expect(f.nutrition.correct).toHaveBeenCalledWith({
      idempotencyKey: 'synthetic-key', expectedRevision: 1n, changes: { mealName: 'Renamed synthetic meal' },
    }, expect.objectContaining({ intent: 'correct-intake' }));
    expect((await client.callTool({
      name: 'delete_food', arguments: { idempotencyKey: 'synthetic-key', expectedRevision: '2' },
    })).structuredContent).toMatchObject({ status: 'committed', operation: 'delete', revision: '2' });
    expect(f.nutrition.remove).toHaveBeenCalledWith('synthetic-key', 2n, expect.objectContaining({ intent: 'delete-intake' }));
  });

  it('reports a possibly committed write when audit fails and keeps the retry operation stable', async () => {
    const f = await fixture();
    const { client } = await f.connect();
    const records: ToolCallRecord[] = [];
    f.audit.mockImplementation(async call => {
      records.push(call);
      if (f.commits()) throw new Error('synthetic private audit failure');
    });
    const result = await client.callTool({ name: 'log_food', arguments: food });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('may have committed');
    expect(JSON.stringify(result)).not.toContain('synthetic private');
    expect(f.commits()).toBe(1);
    expect(records.every(call => canonicalJson(call.arguments) === '{"redacted":true}')).toBe(true);
  });
});
