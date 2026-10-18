import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { Client, isInputRequiredResult, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyQueryResult } from '@jarvis/contracts';
import { installAuthentication } from '../../auth/hook.js';
import { AuthenticationDenied, dailyNutritionScopes } from '../../auth/verify.js';
import { loadConfig } from '../../config.js';
import type { DailyMcpAuditRecord, ToolCallStore } from '../../core/tool-calls.js';
import { ToolRefusal } from '../../core/tool-registry.js';
import { createDailyModules } from '../index.js';
import { fridaReference, type FridaLookup } from '../nutrition/frida.js';
import type { createNutritionHandlers } from '../nutrition/handlers.js';
import { canonicalJson, prepareMeal, type MealInput } from '../nutrition/model.js';
import { dailyResultByteLimit, type DailyQueryService } from '../query.js';
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
const savedFavorite = {
  id: 'synthetic-favorite', favorite_name: 'Synthetic favourite', normalized_name: 'synthetic favourite',
  meal_name: 'Synthetic meal', meal_type: null, aliases_json: '[]', components_json: '[]', nutrient_provenance_json: '{}',
  energy_kcal: 200, protein_grams: null, carbohydrates_grams: null, fat_grams: null, fiber_grams: null, confidence: 'accurate',
  revision: 1n, created_at: '2026-10-16T00:00:00Z', updated_at: '2026-10-16T00:00:00Z',
  owner_object_id: 'never-expose-owner', private_marker: 'never-expose-marker',
};
const savedPlan = { id: 'synthetic-plan', plan_name: 'Synthetic plan', items_json: '[]', revision: 1n, deleted_at: null };

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
  await Promise.all(apps.splice(0).map(app => app.close()));
});

async function fixture(writesEnabled = true) {
  let time = '2026-10-16T21:59:00Z';
  let commits = 0;
  const rows = new Map<string, { input: MealInput; row: Record<string, unknown> }>();
  const audit = vi.fn<NonNullable<ToolCallStore['recordDailyMcp']>>().mockResolvedValue(undefined);
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
    favoriteRecords: vi.fn<Handlers['favoriteRecords']>(async ids => ids.map(id => ({ ...savedFavorite, id }))),
    preferences: vi.fn<Handlers['preferences']>().mockResolvedValue([]),
    planRecord: vi.fn<Handlers['planRecord']>().mockResolvedValue(savedPlan),
    favorite: vi.fn<Handlers['favorite']>().mockResolvedValue(savedFavorite),
    plan: vi.fn<Handlers['plan']>().mockResolvedValue(savedPlan),
    removePlan: vi.fn<Handlers['removePlan']>().mockResolvedValue({ ...savedPlan, revision: 2n, deleted_at: '2026-10-16T21:59:00Z' }),
    feedback: vi.fn<Handlers['feedback']>().mockResolvedValue({ meal_key: savedFavorite.id, preference: 'dislike', revision: 1n }),
  };
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  apps.push(app);
  app.decorate('ownerObjectId', config.auth.ownerObjectId);
  app.decorate('toolCallStore', {
    record: vi.fn<ToolCallStore['record']>().mockRejectedValue(new Error('Conversation audit must not receive connector requests')),
    recordDailyMcp: audit,
  });
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
      versionNegotiation: { mode: 'auto' },
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
  it('reads real preference revisions, distinguishing absent and cleared records without private columns', async () => {
    const f = await fixture();
    vi.mocked(f.nutrition.preferences).mockResolvedValue([
      { meal_key: 'liked', preference: 'like', revision: 2n, private_marker: 'never-expose-marker' },
      { meal_key: 'cleared', preference: null, revision: '3' },
    ]);
    const { client } = await f.connect('read');
    const result = await client.callTool({ name: 'read_food_preferences', arguments: { favoriteIds: ['liked', 'missing', 'cleared', 'liked'] } });
    expect(result.structuredContent).toMatchObject({ records: [
      { favoriteId: 'liked', status: 'available', revision: '2', preference: 'like' },
      { favoriteId: 'missing', status: 'not-set', revision: '0', preference: null },
      { favoriteId: 'cleared', status: 'cleared', revision: '3', preference: null },
    ] });
    expect(JSON.stringify(result)).not.toContain('never-expose');
    expect(f.nutrition.feedback).not.toHaveBeenCalled();
  });

  const savedChanges = [
    { handler: 'favorite', change: { operation: 'save_favorite', operationId: 'favorite-operation', expectedRevision: '0',
      name: 'Synthetic favourite', aliases: ['Synthetic alias'],
      definition: { mealName: 'Synthetic meal', energyKcal: 200, confidence: 'accurate' } } },
    { handler: 'plan', change: { operation: 'save_plan', operationId: 'plan-operation', expectedRevision: '0', name: 'Synthetic plan',
      entries: (['breakfast', 'lunch', 'dinner'] as const).map(slot => ({ slot, favoriteId: savedFavorite.id })) } },
    { handler: 'removePlan', change: { operation: 'delete_plan', id: savedPlan.id, expectedRevision: '1' } },
    { handler: 'feedback', change: { operation: 'set_feedback', favoriteId: savedFavorite.id, expectedRevision: '0', preference: 'dislike' } },
  ] as const;
  it.each(savedChanges)('native-reviews $change.operation and returns only the actual committed safe receipt', async ({ handler, change }) => {
    const f = await fixture();
    const { client, messages } = await f.connect();
    const result = await client.callTool({ name: 'manage_saved_food', arguments: { change } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: 'committed', operation: change.operation });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Synthetic');
    expect(f.nutrition[handler]).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('never-expose');
    expect(f.nutrition.log).not.toHaveBeenCalled();
    expect(f.audit).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'manage_saved_food', phase: 'ok', outcome: 'ok' }));
  });
  it.each(savedChanges)('does not execute declined $change.operation or a read-only caller', async ({ handler, change }) => {
    const f = await fixture();
    const declined = await f.connect('write', 'decline');
    expect((await declined.client.callTool({ name: 'manage_saved_food', arguments: { change } })).isError).toBe(true);
    const read = await f.connect('read');
    expect((await read.client.callTool({ name: 'manage_saved_food', arguments: { change } })).isError).toBe(true);
    expect(f.nutrition[handler]).not.toHaveBeenCalled();
  });
  it('binds an owned intake source revision and does not trust model provenance or confirmation', async () => {
    const f = await fixture();
    vi.mocked(f.nutrition.intake).mockResolvedValue({ id: 'source', idempotency_key: 'source-key', meal_name: 'Synthetic source',
      revision: 4n, deleted_at: null, owner_object_id: 'never-expose-owner' });
    const { client, messages } = await f.connect();
    const change = { operation: 'save_favorite', operationId: 'source-operation', expectedRevision: '0', name: 'Synthetic source favourite', sourceIdempotencyKey: 'source-key' };
    expect((await client.callTool({ name: 'manage_saved_food', arguments: { change, userConfirmed: true } })).isError).toBe(true);
    expect(f.nutrition.favorite).not.toHaveBeenCalled();
    expect((await client.callTool({ name: 'manage_saved_food', arguments: { change } })).isError).not.toBe(true);
    expect(f.nutrition.favorite).toHaveBeenCalledWith(expect.objectContaining({ sourceIdempotencyKey: 'source-key' }),
      expect.objectContaining({ intent: 'save-favorite', expectedRevision: 0n, sourceRevision: 4n, proposalAccepted: true }));
    expect(messages[0]).toContain('Synthetic source');
    expect(messages[0]).not.toContain('never-expose');
  });
  it('returns a persisted initial clear revision and refuses missing preference receipts', async () => {
    const f = await fixture();
    const { client, messages } = await f.connect();
    const change = { ...savedChanges[3].change, preference: null };
    vi.mocked(f.nutrition.feedback).mockResolvedValue({ meal_key: savedFavorite.id, preference: null, revision: 1n });
    const result = await client.callTool({ name: 'manage_saved_food', arguments: { change } });
    expect(result.structuredContent).toMatchObject({ status: 'committed', record: { preference: null, revision: '1' } });
    expect(messages).toHaveLength(1);
    expect(f.nutrition.feedback).toHaveBeenCalledWith(savedFavorite.id, null, 0n, expect.objectContaining({ intent: 'set-feedback' }));
    vi.mocked(f.nutrition.feedback).mockResolvedValue({});
    const missing = await client.callTool({ name: 'manage_saved_food', arguments: { change } });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing)).toContain('may have committed');
  });
  it('refuses a changed plan source between native display and acceptance instead of saving new undisplayed totals', async () => {
    const f = await fixture();
    const { client, messages } = await f.connect();
    client.setRequestHandler('elicitation/create', async request => {
      messages.push(request.params.message);
      vi.mocked(f.nutrition.favoriteRecords).mockResolvedValue([{ ...savedFavorite, energy_kcal: 999, revision: 2n }]);
      return { action: 'accept', content: { confirm: true } };
    });
    const result = await client.callTool({ name: 'manage_saved_food', arguments: { change: savedChanges[1].change } });
    expect(result.isError).toBe(true);
    expect(messages[0]).toContain('"energyKcal": 600');
    expect(f.nutrition.plan).not.toHaveBeenCalled();
  });
  it('replays plan deletion using unchanged semantic content, not the deletion timestamp', async () => {
    const f = await fixture();
    const { client } = await f.connect();
    client.setRequestHandler('elicitation/create', async () => {
      vi.mocked(f.nutrition.planRecord).mockResolvedValue({ ...savedPlan, revision: 2n, deleted_at: '2026-10-16T21:59:00Z' });
      return { action: 'accept', content: { confirm: true } };
    });
    expect((await client.callTool({ name: 'manage_saved_food', arguments: { change: savedChanges[2].change } })).isError).not.toBe(true);
    expect(f.nutrition.removePlan).toHaveBeenCalledWith(savedPlan.id, 1n, expect.objectContaining({ intent: 'delete-plan' }));
  });
  it('refuses invented plan totals, extra authority, unknown sources and missing committed receipts', async () => {
    const f = await fixture();
    const { client } = await f.connect();
    expect((await client.callTool({ name: 'manage_saved_food', arguments: { change: { ...savedChanges[1].change, energyKcal: 1 } } })).isError).toBe(true);
    vi.mocked(f.nutrition.favoriteRecords).mockRejectedValueOnce(new ToolRefusal('Every saved-food reference must be an owned favourite.'));
    expect((await client.callTool({ name: 'manage_saved_food', arguments: { change: savedChanges[1].change } })).isError).toBe(true);
    expect(f.nutrition.plan).not.toHaveBeenCalled();
    vi.mocked(f.nutrition.favorite).mockResolvedValue({});
    const result = await client.callTool({ name: 'manage_saved_food', arguments: { change: savedChanges[0].change } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('may have committed');
  });
  it('keeps both composition gates off by default and exposes no general Jarvis tools', async () => {
    const f = await fixture(false);
    expect(createDailyModules(false, undefined, f.options)).toEqual([]);
    const { client } = await f.connect();
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(['lookup_food', 'read_food_preferences', 'read_nutrition']);
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
    for (const source of ['daily.health.metrics', 'daily.briefs.history', 'daily.briefs.detail']) {
      const refused = await client.callTool({ name: 'read_nutrition', arguments: { source, owner: 'foreign' } });
      expect(refused.isError).toBe(true);
    }
    expect(f.query.query).toHaveBeenCalledOnce();
  });

  it('exposes the shared per-day totals through the nutrition-only connector read schema', async () => {
    const f = await fixture();
    const { client } = await f.connect('read');
    const query = {
      source: 'daily.nutrition.days', startDate: '2026-10-01', endDate: '2026-10-07',
      limit: 400, cursor: { date: '2026-10-03' },
    } as const;
    const result: DailyQueryResult = {
      ...empty, source: 'daily.nutrition.days', period: {
        startDate: query.startDate, endDate: query.endDate, timeZone: 'Europe/Copenhagen' as const,
      },
      items: [{ meal_date: '2026-10-04', meal_count: 2, energy_kcal: 240, protein_grams: null,
        carbohydrates_grams: 30, fat_grams: 8, fiber_grams: null,
        unknown_nutrients: ['protein_grams', 'fiber_grams'], partial_nutrients: ['carbohydrates_grams'],
        latest_updated_at: '2026-10-04T12:00:00Z' }],
      provenance: { ...empty.provenance, calculations: 'derived-from-retained-meals' as const },
      units: { energy_kcal: 'kcal', '*_grams': 'g' }, status: 'available',
      freshness: { ...empty.freshness, latestReturnedRecordUpdatedAt: '2026-10-04T12:00:00Z' },
      coverage: { returned: 1, hasMore: false, next: null, sourceCompleteness: 'unknown' },
      revision: 'b'.repeat(64),
    };
    vi.mocked(f.query.query).mockResolvedValueOnce(result);
    const response = await client.callTool({ name: 'read_nutrition', arguments: query });
    expect(response.structuredContent).toEqual(result);
    expect(f.query.query).toHaveBeenCalledWith(query, expect.anything(), expect.any(AbortSignal));
  });

  it.each(['favorite', 'history'] as const)('returns the shared safe %s DTO for an owner-bound saved name without a provider call or write', async source => {
    const f = await fixture();
    vi.mocked(f.nutrition.lookupSaved).mockResolvedValue({
      source, row: {
        id: 'synthetic-saved-food', meal_name: 'Synthetic saved meal', energy_kcal: 240, protein_grams: null,
        aliases_json: '["Synthetic alias"]', components_json: '[{"name":"Synthetic component"}]',
        nutrient_provenance_json: '{"source":"synthetic-retained"}', revision: 3n,
        meal_date: new Date('2026-10-15T00:00:00Z'),
        owner_object_id: config.auth.ownerObjectId, private_synthetic_marker: 'never-expose-this',
      },
    });
    const { client, messages } = await f.connect('read');
    const result = await client.callTool({ name: 'lookup_food', arguments: { savedName: 'Synthetic alias' } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: 'available', period: null,
      match: { source, record: {
        id: 'synthetic-saved-food', meal_name: 'Synthetic saved meal', energy_kcal: 240, protein_grams: null,
        components_json: [{ name: 'Synthetic component' }], nutrient_provenance_json: { source: 'synthetic-retained' },
        ...(source === 'favorite' ? { aliases_json: ['Synthetic alias'] } : { revision: '3', meal_date: '2026-10-15' }),
      } },
      units: { energy_kcal: 'kcal', '*_grams': 'g' },
      freshness: { observedAt: '2026-10-16T21:59:00.000Z', staleness: 'unknown' },
    });
    expect(f.nutrition.lookupSaved).toHaveBeenCalledWith('Synthetic alias', expect.objectContaining({ intent: 'lookup' }));
    expect(f.nutrition.lookup).not.toHaveBeenCalled();
    for (const name of ['log', 'correct', 'remove', 'favorite', 'plan'] as const) expect(f.nutrition[name]).not.toHaveBeenCalled();
    expect(messages).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('never-expose-this');
    expect(JSON.stringify(result)).not.toContain(config.auth.ownerObjectId);
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain('Synthetic alias');
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'lookup_food', phase: 'ok', outcome: 'ok' }));
  });

  it('keeps missing and ambiguous saved food explicit without guessing or falling back to Frida', async () => {
    const f = await fixture();
    const { client } = await f.connect('read');
    const missing = await client.callTool({ name: 'lookup_food', arguments: { savedName: 'Synthetic missing meal' } });
    expect(missing.structuredContent).toMatchObject({ status: 'empty', match: null });
    vi.mocked(f.nutrition.lookupSaved).mockRejectedValueOnce(new ToolRefusal('Favourite alias is ambiguous.'));
    const ambiguous = await client.callTool({ name: 'lookup_food', arguments: { savedName: 'Synthetic ambiguous alias' } });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content).toEqual([{ type: 'text', text: 'Favourite alias is ambiguous.' }]);
    expect(f.nutrition.lookup).not.toHaveBeenCalled();
    expect(f.nutrition.log).not.toHaveBeenCalled();
  });

  it.each([257, 2000])('preserves a %i-character historical name through the actual protocol', async length => {
    const f = await fixture();
    const name = 'x'.repeat(length);
    vi.mocked(f.nutrition.lookupSaved).mockResolvedValue({ source: 'history', row: { id: 'synthetic-long-name', meal_name: name } });
    const { client } = await f.connect('read');
    const result = await client.callTool({ name: 'lookup_food', arguments: { savedName: name } });
    expect(result.structuredContent).toMatchObject({ match: { source: 'history', record: { meal_name: name } } });
    expect(f.nutrition.lookupSaved).toHaveBeenCalledWith(name, expect.objectContaining({ intent: 'lookup' }));
    expect(f.nutrition.lookup).not.toHaveBeenCalled();
  });

  it('requires exactly one lookup mode and rejects owner selectors before reading saved food', async () => {
    const f = await fixture();
    const { client } = await f.connect('read');
    for (const input of [
      {}, { savedName: ' ' }, { savedName: 'Synthetic meal', owner: 'foreign' },
      { savedName: 'Synthetic meal', components: [{ name: 'Synthetic food', grams: null, preparationMethod: null }] },
    ]) {
      expect((await client.callTool({ name: 'lookup_food', arguments: input })).isError).toBe(true);
    }
    expect(f.nutrition.lookupSaved).not.toHaveBeenCalled();
    expect(f.nutrition.lookup).not.toHaveBeenCalled();
  });

  it('refuses an oversized saved record without exposing it or substituting a provider result', async () => {
    const f = await fixture();
    vi.mocked(f.nutrition.lookupSaved).mockResolvedValue({
      source: 'favorite', row: { id: 'synthetic-oversized', meal_name: 'x'.repeat(dailyResultByteLimit) },
    });
    const { client } = await f.connect('read');
    const result = await client.callTool({ name: 'lookup_food', arguments: { savedName: 'Synthetic oversized meal' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Saved food exceeds the shared Daily response limit. No complete result is available.' }]);
    expect(f.nutrition.lookup).not.toHaveBeenCalled();
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
    expect(f.audit.mock.calls.map(([call]) => call.phase)).toContain('awaiting_confirmation');
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

  it('refuses browser Origin requests and a legacy-only audit sink rather than pretending either is supported', async () => {
    const f = await fixture();
    const denied = await f.app.inject({
      method: 'POST', url: dailyMcpPath,
      headers: { host: 'nutrition.example.test', origin: 'https://chatgpt.com', authorization: 'Bearer write.token.value' }, payload: {},
    });
    expect(denied.statusCode).toBe(400);
    f.app.toolCallStore = { record: vi.fn<ToolCallStore['record']>().mockResolvedValue(undefined) };
    const { client } = await f.connect();
    expect((await client.callTool({ name: 'log_food', arguments: food })).isError).toBe(true);
    expect(f.nutrition.log).not.toHaveBeenCalled();
    expect(f.nutrition.intake).not.toHaveBeenCalled();
  });

  it('refuses unsupported native review, unchecked acceptance and extra confirmation fields without executing a write', async () => {
    const f = await fixture();
    const unsupported = await f.connect('write', 'accept', false);
    await expect(unsupported.client.callTool({ name: 'log_food', arguments: food })).rejects.toThrow();
    const { client } = await f.connect();
    client.setRequestHandler('elicitation/create', async () => ({ action: 'accept', content: { confirm: false } }));
    expect((await client.callTool({ name: 'log_food', arguments: food })).isError).toBe(true);
    client.setRequestHandler('elicitation/create', async () => ({ action: 'accept', content: { confirm: true, userConfirmed: true } }));
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
    const records: DailyMcpAuditRecord[] = [];
    f.audit.mockImplementation(async call => {
      records.push(call);
      if (f.commits()) throw new Error('synthetic private audit failure');
    });
    const result = await client.callTool({ name: 'log_food', arguments: food });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('may have committed');
    expect(JSON.stringify(result)).not.toContain('synthetic private');
    expect(f.commits()).toBe(1);
    expect(records.every(call => Object.keys(call).sort().join(',') === 'outcome,phase,requestId,tool')).toBe(true);
  });
});
