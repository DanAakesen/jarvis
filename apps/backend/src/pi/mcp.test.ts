import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createPiAuth } from '../auth/pi-credential.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { createMemoryModule, retrievePersonalMemory } from '../core/personal-memory.js';
import type { JarvisTool } from '../core/tool-registry.js';
import type { MemoryRecord, MemoryStore } from '../database/memory-store.js';
import { createPiRoutes } from './routes.js';
import { createPiTurnRegistry } from './turns.js';
import type { RemoteMcpBridge } from './remote-mcp.js';
import type { PiSituationService } from './situation.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const secret = 'A'.repeat(43);
const ownerToken = 'owner.token.fixture';
const deployToken = 'deploy.token.fixture';
const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const probe: JarvisTool = {
  name: 'probe_echo',
  description: 'Echo the text and the owner message the call was attributed to. Keyword: probe.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  execute: async (input, request) => ({
    echoed: (input as { text: string }).text,
    messageId: request.headers['x-jarvis-message-id'],
    asAgent: request.agentPrincipal !== null,
  }),
};

function setup(
  bridges: RemoteMcpBridge[] = [],
  options: { tools?: JarvisTool[]; situation?: PiSituationService; smokeBudgetExhausted?: boolean } = {},
) {
  const registry = createPiTurnRegistry();
  const auth = createPiAuth(config.auth.tenantId, secret);
  const recorded: Array<{ messageId: string; tool: string }> = [];
  const app = buildApp(config, undefined, {
    modules: [coreModule, { id: 'probe', tools: [probe, ...(options.tools ?? [])], registerRoutes: async () => {} },
      { id: 'pi', tools: [], registerRoutes: createPiRoutes({
        gateway: {
          stream: async function* () {},
          status: async () => ({ enabled: options.smokeBudgetExhausted !== true }),
        } as never,
        registry,
        auth,
        monthlyCapDkk: 250,
        bridges,
        ...(options.situation ? { situation: options.situation } : {}),
      }) }],
    auth: async (token) => {
      if (token === deployToken) return { kind: 'jarvis-deploy', objectId: config.auth.deployObjectId, tenantId: config.auth.tenantId };
      if (token !== ownerToken) throw new Error('rejected');
      return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' };
    },
    toolCallStore: { record: async (call) => { recorded.push({ messageId: call.messageId, tool: call.tool }); } },
    piAuth: auth,
  });
  apps.push(app);
  let id = 0;
  async function rpc(token: string | undefined, method: string, params: Record<string, unknown> = {}, url = '/pi/mcp') {
    id += 1;
    const response = await app.inject({
      method: 'POST', url, remoteAddress: '10.0.0.9',
      headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
        ...(token ? { authorization: bearer(token) } : {}),
      },
      payload: { jsonrpc: '2.0', id, method, params },
    });
    const body = response.body.includes('data:')
      ? response.body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : response.body;
    return { status: response.statusCode, json: body ? JSON.parse(body) as Json : undefined };
  }
  const tool = async (name: string, args: Record<string, unknown>) => {
    const result = await rpc(`jp.${secret}`, 'tools/call', { name, arguments: args });
    const text = result.json?.result?.content?.[0]?.text as string | undefined;
    const body = text?.startsWith('{') ? JSON.parse(text) as Json : undefined;
    return { isError: result.json?.result?.isError === true, body, status: result.status, raw: result.json };
  };
  return { app, registry, rpc, tool, recorded };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const initialize = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } };
const live = () => new AbortController().signal;

describe('PI MCP server', () => {
  it('uses the live Memory tool catalogue, exact owner source and committed results', async () => {
    const updatedAt = new Date('2026-11-20T08:00:00Z');
    let memory: MemoryRecord = {
      id: '90', key: 'appointment-time', category: 'preference', content: 'Afternoon appointments',
      sourceMessageId: '42', sourceText: 'Remember that I prefer afternoon appointments.',
      sourceTextTruncated: false, revision: 1, updatedAt,
    };
    const getSourceMessage = vi.fn(async (id: string) => ({ messageId: id, text: memory.sourceText }));
    const save = vi.fn<MemoryStore['save']>().mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue({ memory, created: true, changed: true });
    const correct = vi.fn<MemoryStore['correct']>().mockImplementation(async (_id, input) => {
      memory = { ...memory, content: input.content, revision: 2, sourceMessageId: input.sourceMessageId };
      return { memory, created: false, changed: true };
    });
    const forget = vi.fn<MemoryStore['forget']>().mockResolvedValue(memory);
    const store = {
      getSourceMessage, save, correct, forget,
      supportsVectorSearch: () => false,
      history: async () => [{ ...memory, changedAt: updatedAt }],
      searchByFullText: async () => ({ method: 'fulltext', memories: [memory] }),
    } as MemoryStore;
    const { app, registry, tool } = setup([], { tools: [...createMemoryModule({ store, automaticCapture: async () => false }).tools] });
    const catalogue = await app.inject({ method: 'GET', url: '/tools', headers: { authorization: bearer(ownerToken) } });
    expect(catalogue.statusCode).toBe(200);
    for (const suffix of ['remember', 'search', 'list', 'history', 'correct', 'forget']) expect(catalogue.body).toContain(`memory_${suffix}`);

    const first = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const execute = async (turn: string, name: string, args: Record<string, unknown>) => {
      const found = await tool('find_tools', { turn, query: name });
      expect(found.body?.result.tools.map((entry: { name: string }) => entry.name)).toContain(name);
      return (await tool('call_tool', { turn, name, arguments: args })).body;
    };
    const args = { category: memory.category, key: memory.key, content: memory.content };
    expect(await execute(first.turn, 'memory_remember', { ...args, sourceIntent: 'automatic' })).toMatchObject({ outcome: 'refused' });
    expect(save).not.toHaveBeenCalled();
    expect(await execute(first.turn, 'memory_remember', { ...args, sourceIntent: 'requested' })).toMatchObject({ outcome: 'error' });
    expect(await execute(first.turn, 'memory_remember', { ...args, sourceIntent: 'requested' })).toMatchObject({ outcome: 'ok', result: { id: '90', revision: 1 } });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ sourceMessageId: '42', createOnly: true }), expect.anything());
    registry.close(first.turn);

    const fresh = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '8', messageId: '43', signal: live() });
    expect(await execute(fresh.turn, 'memory_search', { query: 'appointments' })).toMatchObject({
      outcome: 'ok', result: { memories: [{ source: { messageId: '42' } }] },
    });
    const correction = { memoryId: '90', revision: 1, content: 'Morning appointments', sourceIntent: 'requested' };
    expect(await execute(fresh.turn, 'memory_correct', correction)).toMatchObject({ outcome: 'ok', result: { id: '90', revision: 2 } });
    expect(correct).toHaveBeenCalledWith('90', expect.objectContaining({ sourceMessageId: '43', expectedRevision: 1 }), expect.anything());
    expect(await execute(fresh.turn, 'memory_correct', correction)).toMatchObject({ outcome: 'refused' });
    expect(await retrievePersonalMemory(store, 'When should we schedule appointments?', live())).toContain('"sourceMessageId":"43"');
    expect(await execute(fresh.turn, 'memory_forget', { memoryId: '90' })).toMatchObject({ outcome: 'ok', result: { id: '90' } });
    expect(forget).toHaveBeenCalledWith('90', '43', expect.anything());
  });

  it('opens only to the static PI credential, and only on its own route', async () => {
    const { rpc, app } = setup();
    expect((await rpc(undefined, 'initialize', initialize)).status).toBe(401);
    expect((await rpc(`jp.${'B'.repeat(43)}`, 'initialize', initialize)).status).toBe(401);
    expect((await rpc(`jp.${secret}`, 'initialize', initialize)).json?.result?.serverInfo?.name).toBe('jarvis');
    const elsewhere = await app.inject({ method: 'GET', url: '/tools', headers: { authorization: bearer(`jp.${secret}`) } });
    expect(elsewhere.statusCode).toBe(403);
  });

  it('advertises find_tools and call_tool, not the catalogue', async () => {
    const { rpc } = setup();
    const names = ((await rpc(`jp.${secret}`, 'tools/list')).json?.result?.tools as Array<{ name: string }>).map((tool) => tool.name).sort();
    expect(names).toEqual(['call_tool', 'find_tools']);
  });

  it('runs a looked-up tool through the normal route, attributed to the stored owner message and never to the model', async () => {
    const { registry, tool, recorded } = setup();
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'probe echo' });
    expect(found.body?.result.tools.map((entry: { name: string }) => entry.name)).toContain('probe_echo');
    const called = await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'hej' } });
    expect(called.isError).toBe(false);
    expect(called.body).toMatchObject({ tool: 'probe_echo', outcome: 'ok', result: { echoed: 'hej', messageId: '42', asAgent: true } });
    expect(recorded).toEqual([{ messageId: '42', tool: 'probe_echo' }]);
    expect(grant.results).toEqual([{ tool: 'probe_echo', outcome: 'ok' }]);
    // Smuggling an identity through the arguments is refused by the tool's own schema, as for any caller.
    const smuggled = await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'x', messageId: '99' } });
    expect(smuggled.body?.outcome).toBe('refused');
    expect(grant.results.at(-1)).toEqual({ tool: 'probe_echo', outcome: 'refused' });
    expect(recorded).toHaveLength(1);
  });

  it('says a remote server is still loading, or could not be reached, instead of leaving the model to call it not attached', async () => {
    let status: ReturnType<RemoteMcpBridge['status']> = { state: 'starting' };
    const azure: RemoteMcpBridge = { prefix: 'az_', label: 'Azure', status: () => status, warm: () => {}, tools: async () => [], call: async () => ({ outcome: 'ok', result: {} }) };
    const { registry, tool } = setup([azure]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const loading = await tool('find_tools', { turn: grant.turn, query: 'azure resource group' });
    expect(loading.body?.result.note).toMatch(/Azure tools are still loading.*attached, just not loaded yet/u);
    expect(grant.azure.catalogue).toBe('starting');
    status = { state: 'unreachable', reason: 'no answer within 200 seconds' };
    const down = await tool('find_tools', { turn: grant.turn, query: 'azure resource group' });
    expect(down.body?.result.note).toMatch(/Azure could not be reached \(no answer within 200 seconds\)/u);
    expect(grant.azure.catalogue).toBe('unreachable');
    status = { state: 'ready' };
    const ready = await tool('find_tools', { turn: grant.turn, query: 'azure resource group' });
    expect(ready.body?.result.note).toBeUndefined();
    expect(grant.azure.catalogue).toBe('empty');
    const undiscovered = await tool('call_tool', { turn: grant.turn, name: 'az_group_resource_list', arguments: {} });
    expect(undiscovered.body?.outcome).toBe('refused');
    expect(grant.azure).toMatchObject({ attempts: 1, undiscoveredRefusals: 1 });
    expect(grant.results).toEqual([]);
  });

  it('hides and refuses automatic mail tools when Mail is disabled', async () => {
    const mail: JarvisTool = {
      name: 'mail_search',
      description: 'Search owner mail. Keyword: inbox.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execution: { defaultEffect: 'read' },
      execute: async () => ({ found: 1 }),
    };
    const situation = {
      async read() {
        return {
          state: null, revision: 0, hash: null, policyRevision: 'a'.repeat(64),
          staleSources: [], missingSources: [], disabledSources: ['mail'], freshSources: [],
          asOf: null, updatedAt: null, lastActivation: null,
        };
      },
    } as PiSituationService;
    const { registry, tool } = setup([], { tools: [mail], situation });
    const grant = registry.open({
      ownerObjectId: config.auth.ownerObjectId, sessionId: '', messageId: '',
      brain: { runId: '00000000-0000-4000-8000-000000000001', sent: [], wrote: [], looked: [] },
      signal: live(),
      activation: {
        id: '00000000-0000-4000-8000-000000000001', type: 'event', source: 'timer', slotKey: null,
        stateRevision: 0, stateHash: null, policyRevision: 'a'.repeat(64), staleSources: 0, disabledSources: ['mail'],
      },
    });
    const found = await tool('find_tools', { turn: grant.turn, query: 'mail inbox' });
    expect(found.body?.result.tools.map((entry: { name: string }) => entry.name)).not.toContain('mail_search');
    grant.discovered.add('mail_search');
    const called = await tool('call_tool', { turn: grant.turn, name: 'mail_search', arguments: {} });
    expect(called.body).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('disabled') } });
  });

  it('uses the selected Health source rather than allowing Nutrition through Health', async () => {
    const health: JarvisTool = {
      name: 'health_show',
      description: 'Show retained health and nutrition records.',
      inputSchema: { type: 'object', properties: { source: { type: 'string' } }, additionalProperties: false },
      execution: { defaultEffect: 'read' },
      execute: async () => ({ shown: true }),
    };
    const situation = {
      async read() {
        return {
          state: null, revision: 0, hash: null, policyRevision: 'a'.repeat(64),
          staleSources: [], missingSources: [], disabledSources: ['nutrition'], freshSources: ['health'],
          asOf: null, updatedAt: null, lastActivation: null,
        };
      },
    } as PiSituationService;
    const { registry, tool } = setup([], { tools: [health], situation });
    const grant = registry.open({
      ownerObjectId: config.auth.ownerObjectId, sessionId: '', messageId: '',
      brain: { runId: '00000000-0000-4000-8000-000000000002', sent: [], wrote: [], looked: [] },
      signal: live(),
      activation: {
        id: '00000000-0000-4000-8000-000000000002', type: 'event', source: 'timer', slotKey: null,
        stateRevision: 0, stateHash: null, policyRevision: 'a'.repeat(64), staleSources: 0,
        disabledSources: ['nutrition'],
      },
    });
    await tool('find_tools', { turn: grant.turn, query: 'health nutrition show' });
    const blocked = await tool('call_tool', {
      turn: grant.turn,
      name: 'health_show',
      arguments: { source: 'daily.nutrition.meals' },
    });
    expect(blocked.body).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('disabled') } });
  });

  it('shows chat the system-health tool without its smoke-only operation selector', async () => {
    const { registry, tool } = setup();
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'system health' });
    const health = found.body?.result.tools.find((entry: { name: string }) => entry.name === 'get_system_health');
    expect(health).toBeDefined();
    expect(Object.keys(health.parameters.properties ?? {})).not.toContain('operation');
  });

  it('refuses a tool that was not looked up in this turn, and a forged, closed or foreign turn reference', async () => {
    const { registry, tool, recorded } = setup();
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const early = await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'x' } });
    expect(early.body).toMatchObject({ outcome: 'refused' });
    const forged = await tool('call_tool', { turn: 'jt-AAAAAAAAAAAAAAAAAAAAAA', name: 'probe_echo', arguments: { text: 'x' } });
    expect(forged).toMatchObject({ isError: true, body: { outcome: 'refused' } });
    const malformed = await tool('call_tool', { turn: '42', name: 'probe_echo', arguments: { text: 'x' } });
    expect(malformed.isError).toBe(true);
    await tool('find_tools', { turn: grant.turn, query: 'probe' });
    registry.close(grant.turn);
    const late = await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'x' } });
    expect(late).toMatchObject({ isError: true, body: { outcome: 'refused' } });
    expect(recorded).toEqual([]);
  });

  it('keeps a smoke grant on the read-only smoke role', async () => {
    const { registry, tool, recorded } = setup();
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '', messageId: '', smoke: true, signal: live() });
    await tool('find_tools', { turn: grant.turn, query: 'probe' });
    const called = await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'x' } });
    expect(called.body?.outcome).toBe('error');
    expect(recorded).toEqual([]);
  });

  it('does not accept a guessed in-process dispatch token on the tool routes', async () => {
    const { app } = setup();
    const response = await app.inject({ method: 'POST', url: '/tools/probe_echo', payload: { text: 'x' },
      headers: { authorization: bearer('aaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaa.' + 'a'.repeat(43)), 'x-jarvis-message-id': '42' } });
    expect(response.statusCode).toBe(401);
  });

  it('lets only the deployment identity start the live smoke, and only on its own route', async () => {
    const { app } = setup();
    const call = (token: string, method: 'GET' | 'POST', url: string) => app.inject({
      method, url, payload: method === 'POST' ? { part: 'voice' } : undefined, headers: { authorization: bearer(token) },
    });
    expect((await call(ownerToken, 'POST', '/pi/smoke')).statusCode).toBe(403);
    expect((await call(deployToken, 'POST', '/pi/smoke')).statusCode).not.toBe(403);
    const noPart = await app.inject({ method: 'POST', url: '/pi/smoke', payload: {}, headers: { authorization: bearer(deployToken) } });
    expect(noPart.statusCode).toBe(400);
    expect((await call(deployToken, 'GET', '/pi/status')).statusCode).toBe(403);
    expect((await call(deployToken, 'POST', '/pi/warm')).statusCode).toBe(403);
  });

  it('records degraded smoke evidence for each capability refused by the budget preflight', async () => {
    const { app } = setup([], { smokeBudgetExhausted: true });
    const call = (part: 'core' | 'voice') => app.inject({
      method: 'POST',
      url: '/pi/smoke',
      payload: { part },
      headers: { authorization: bearer(deployToken) },
    });

    const core = await call('core');
    expect(core.statusCode).toBe(409);
    expect(core.json()).toMatchObject({ code: 'pi_budget_exhausted' });
    expect((await app.systemStatusReader.read()).entries.find(entry => entry.id === 'foundry.chat'))
      .toMatchObject({
        status: 'degraded',
        details: {
          configured: true,
          engine: 'pi',
          evidence: 'deploy-smoke',
          smokePart: 'core',
          reason: 'budget_exhausted',
        },
      });

    const voice = await call('voice');
    expect(voice.statusCode).toBe(409);
    expect(voice.json()).toMatchObject({ code: 'pi_budget_exhausted' });
    expect((await app.systemStatusReader.read()).entries.find(entry => entry.id === 'foundry.voice'))
      .toMatchObject({
        status: 'degraded',
        details: {
          configured: true,
          engine: 'pi',
          evidence: 'deploy-smoke',
          smokePart: 'voice',
          reason: 'budget_exhausted',
        },
      });
  });
});
