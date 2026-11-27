import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createPiAuth } from '../auth/pi-credential.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from '../core/tool-registry.js';
import { createLogger } from '../logging.js';
import { repositoryTools } from '../factory/repository-tools.js';
import { createVaultModule } from '../vault/index.js';
import { requestIdentity } from './mcp.js';
import { createPiRoutes } from './routes.js';
import { createPiTurnRegistry } from './turns.js';
import { createRemoteMcpBridge, type RemoteMcpBridge } from './remote-mcp.js';
import type { PiSituationService } from './situation.js';
import { brainOnlyTools } from './brain/policy.js';
import { createBrainTools } from './brain/tools.js';
import { createSituationTools } from './situation-tools.js';
import { createWatchTools } from './watch/tools.js';

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
  options: { tools?: JarvisTool[]; situation?: PiSituationService; smokeBudgetExhausted?: boolean; rawLog?: boolean; auditDown?: boolean } = {},
) {
  const registry = createPiTurnRegistry();
  const auth = createPiAuth(config.auth.tenantId, secret);
  const recorded: Array<{ messageId: string; tool: string }> = [];
  // The real logger, so the lines the tests read are exactly what would be exported. `rawLog` skips the allow-list to show
  // what the door itself hands to the logger.
  const written: string[] = [];
  const sink = new Writable({ write(chunk: Buffer, _encoding, done) { written.push(chunk.toString()); done(); } });
  const logger = options.rawLog === true ? pino({ level: 'info' }, sink) : createLogger(config, undefined, sink);
  const app = buildApp(config, logger, {
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
    toolCallStore: { record: async (call) => {
      if (options.auditDown === true) throw new Error('audit store is down');
      recorded.push({ messageId: call.messageId, tool: call.tool });
    } },
    piAuth: auth,
  });
  apps.push(app);
  let id = 0;
  /** `requestId` replays an earlier JSON-RPC id; without it each request gets the next number. */
  async function rpc(token: string | undefined, method: string, params: Record<string, unknown> = {}, url = '/pi/mcp', requestId?: number | string) {
    const sent = requestId ?? (id += 1);
    const response = await app.inject({
      method: 'POST', url, remoteAddress: '10.0.0.9',
      headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
        ...(token ? { authorization: bearer(token) } : {}),
      },
      payload: { jsonrpc: '2.0', id: sent, method, params },
    });
    const body = response.body.includes('data:')
      ? response.body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : response.body;
    return { status: response.statusCode, json: body ? JSON.parse(body) as Json : undefined };
  }
  const tool = async (name: string, args: Record<string, unknown>, extra: { id?: number | string; meta?: Record<string, unknown> } = {}) => {
    const result = await rpc(`jp.${secret}`, 'tools/call', { name, arguments: args, ...(extra.meta ? { _meta: extra.meta } : {}) }, '/pi/mcp', extra.id);
    const text = result.json?.result?.content?.[0]?.text as string | undefined;
    const body = text?.startsWith('{') ? JSON.parse(text) as Json : undefined;
    return { isError: result.json?.result?.isError === true, body, text, status: result.status, raw: result.json };
  };
  /** The `pi.mcp_tool` lines the door wrote, as exported; `logged` is everything the app wrote. */
  const ledger = () => written.map((line) => JSON.parse(line) as Json).filter((line) => line.msg === 'pi.mcp_tool');
  return { app, registry, rpc, tool, recorded, ledger, logged: () => written.join('') };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const initialize = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } };
const live = () => new AbortController().signal;

describe('PI MCP server', () => {
  it('opens only to the static PI credential, and only on its own route', async () => {
    const { rpc, app } = setup();
    expect((await rpc(undefined, 'initialize', initialize)).status).toBe(401);
    expect((await rpc(`jp.${'B'.repeat(43)}`, 'initialize', initialize)).status).toBe(401);
    expect((await rpc(`jp.${secret}`, 'initialize', initialize)).json?.result?.serverInfo?.name).toBe('jarvis');
    const elsewhere = await app.inject({ method: 'GET', url: '/tools', headers: { authorization: bearer(`jp.${secret}`) } });
    expect(elsewhere.statusCode).toBe(403);
  });

  it('keeps the two MCP names available to existing conversations even with weather, calendar and reminders registered', async () => {
    const tools = ['weather', 'calendar_list_events', 'owner_reminders'].map(name => ({ ...probe, name }));
    const { rpc } = setup([], { tools });
    const names = ((await rpc(`jp.${secret}`, 'tools/list')).json?.result?.tools as Array<{ name: string }>).map((tool) => tool.name).sort();
    expect(names).toEqual(['call_tool', 'find_tools']);
  });

  it('calls calendar through the existing door with a discovered tool and a live turn', async () => {
    const calendar: JarvisTool = { ...probe, name: 'calendar_list_events', execution: { defaultEffect: 'read' } };
    const { registry, tool, recorded, ledger } = setup([], { tools: [calendar] });
    const grant = registry.open({
      ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live(),
      activation: {
        id: '00000000-0000-4000-8000-000000000001', type: 'voice', source: 'voice', slotKey: null,
        stateRevision: 0, stateHash: null, policyRevision: 'a'.repeat(64), staleSources: 0, disabledSources: [],
      },
    });
    const args = { text: 'hej' };
    const payload = { name: calendar.name, arguments: args };
    const missing = await tool('call_tool', payload);
    expect(missing.isError).toBe(true);
    expect(recorded).toEqual([]);
    const forged = await tool('call_tool', { ...payload, turn: `jt-${'a'.repeat(22)}` });
    expect(forged.body).toMatchObject({ outcome: 'refused' });
    const request = { ...payload, turn: grant.turn };
    expect((await tool('call_tool', request)).body).toMatchObject({ outcome: 'refused' });
    const found = await tool('find_tools', { turn: grant.turn, query: calendar.name });
    expect(found.body?.result.tools[0].name).toBe(calendar.name);
    expect((await tool('call_tool', request)).body).toMatchObject({
      tool: calendar.name, outcome: 'ok', result: { echoed: 'hej', messageId: '42', asAgent: true },
    });
    registry.close(grant.turn);
    const closed = await tool('call_tool', request);
    expect(closed.body).toMatchObject({ outcome: 'refused' });
    expect(recorded).toEqual([{ messageId: '42', tool: calendar.name }]);
    expect(ledger().map(({ tool, outcome, channel, provider }) => [tool, outcome, channel, provider])).toEqual([
      [calendar.name, 'refused', undefined, 'local'],
      [calendar.name, 'refused', 'voice', 'local'],
      ['find_tools', 'ok', 'voice', 'local'],
      [calendar.name, 'ok', 'voice', 'local'],
      [calendar.name, 'refused', undefined, 'local'],
    ]);
  });

  it('refuses a live forecast to a background turn even if weather is enabled', async () => {
    const { registry, tool, recorded } = setup([], { tools: [{ ...probe, name: 'weather' }] });
    const grant = registry.open({
      ownerObjectId: config.auth.ownerObjectId, sessionId: '', messageId: '', signal: live(),
      brain: { runId: '00000000-0000-4000-8000-000000000002', sent: [], wrote: [], looked: [] },
    });
    const result = await tool('call_tool', { turn: grant.turn, name: 'weather', arguments: { text: 'forecast' } });
    expect(result.body).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('stored') } });
    expect(recorded).toEqual([]);
  });

  it('does not let a wake read a disabled source by naming its tool', async () => {
    const calendar: JarvisTool = { ...probe, name: 'calendar_list_events', execution: { defaultEffect: 'read' } };
    const { registry, tool, recorded } = setup([], { tools: [calendar] });
    const grant = registry.open({
      ownerObjectId: config.auth.ownerObjectId, sessionId: '', messageId: '', signal: live(),
      brain: { runId: '00000000-0000-4000-8000-000000000002', sent: [], wrote: [], looked: [] },
      activation: {
        id: '00000000-0000-4000-8000-000000000002', type: 'event', source: 'timer', slotKey: null,
        stateRevision: 0, stateHash: null, policyRevision: 'a'.repeat(64), staleSources: 0, disabledSources: ['calendar'],
      },
    });
    const result = await tool('call_tool', { turn: grant.turn, name: calendar.name, arguments: { text: 'hej' } });
    expect(result.body).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('disabled') } });
    expect(grant.results).toEqual([{ tool: calendar.name, outcome: 'refused' }]);
    expect(recorded).toEqual([]);
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

  it('labels the tool activity of a spoken turn voice and that of a typed turn chat', async () => {
    const { app, registry, tool } = setup();
    const activity: Array<{ type: string; source: unknown; messageId: unknown }> = [];
    app.jarvisActivityHub.subscribe((event) => {
      if ('toolName' in event && event.toolName === 'probe_echo') activity.push({ type: event.type, source: event.source, messageId: event.messageId });
    });
    const activation = (type: 'chat' | 'voice') => ({
      id: '00000000-0000-4000-8000-000000000001', type, source: type, slotKey: null, stateRevision: 0, stateHash: null,
      policyRevision: 'a'.repeat(64), staleSources: 0, disabledSources: [],
    });
    for (const [messageId, type] of [['42', 'chat'], ['43', 'voice']] as const) {
      const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId, signal: live(), activation: activation(type) });
      await tool('find_tools', { turn: grant.turn, query: 'probe echo' });
      await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'hej' } });
    }
    expect(activity).toEqual([
      { type: 'tool-call-started', source: 'chat', messageId: '42' }, { type: 'tool-call-finished', source: 'chat', messageId: '42' },
      { type: 'tool-call-started', source: 'voice', messageId: '43' }, { type: 'tool-call-finished', source: 'voice', messageId: '43' },
    ]);
  });

  it('counts a tool request when it enters the server, before the tool has returned', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const slow: JarvisTool = {
      name: 'probe_slow', description: 'A slow probe. Keyword: slowprobe.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => { entered(); await new Promise<void>((resolve) => { release = resolve; }); return { ok: true }; },
    };
    const { registry, tool } = setup([], { tools: [slow] });
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    expect(grant.requests.count).toBe(0);
    await tool('find_tools', { turn: grant.turn, query: 'slowprobe' });
    expect(grant.requests.count).toBe(1);
    const pending = tool('call_tool', { turn: grant.turn, name: 'probe_slow', arguments: {} });
    await started;
    expect(grant.requests.count).toBe(2);
    expect(grant.results).toEqual([]);
    release();
    await pending;
    expect(grant.results).toEqual([{ tool: 'probe_slow', outcome: 'ok' }]);
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

  it('searches local tools without touching a stalled GitHub or Azure bridge', async () => {
    const stalled = (prefix: string, label: string): RemoteMcpBridge => ({
      prefix, label, status: () => ({ state: 'idle' }), warm: vi.fn(),
      tools: vi.fn(() => new Promise<never>(() => {})), call: async () => ({ outcome: 'ok', result: {} }),
    });
    const github = stalled('gh_', 'GitHub');
    const azure = stalled('az_', 'Azure');
    const { registry, tool } = setup([github, azure]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'probe echo' });
    expect(found.body?.result.tools.map((entry: { name: string }) => entry.name)).toContain('probe_echo');
    expect(github.tools).not.toHaveBeenCalled();
    expect(azure.tools).not.toHaveBeenCalled();
    const nothing = await tool('find_tools', { turn: grant.turn, query: 'zzzz qqqq' });
    expect(nothing.body?.result.note).toMatch(/GitHub and Azure tools load only when the search names them/u);
  });

  it.each([
    ['github-issues', 'gh_'], ['pull-request', 'gh_'], ['pullrequest', 'gh_'], ['PR list', 'gh_'], ['my PRs', 'gh_'],
    ['list commits', 'gh_'], ['commits in jarvis', 'gh_'], ['åbne pull requests', 'gh_'],
    ['azure-resources', 'az_'], ['container-app', 'az_'], ['resource-group list', 'az_'], ['ressourcegruppe', 'az_'],
  ])('wakes the bridge a query like "%s" names, even when a local tool also matches', async (query, prefix) => {
    const make = (p: string, label: string): RemoteMcpBridge => ({
      prefix: p, label, status: () => ({ state: 'ready' }), warm: vi.fn(), tools: vi.fn(async () => []),
      call: async () => ({ outcome: 'ok', result: {} }),
    });
    const github = make('gh_', 'GitHub');
    const azure = make('az_', 'Azure');
    const { registry, tool } = setup([github, azure], { tools: [{ ...probe, name: 'probe_list', description: 'List things. Keyword: list.' }] });
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    await tool('find_tools', { turn: grant.turn, query: `${query} list` });
    expect(github.tools).toHaveBeenCalledTimes(prefix === 'gh_' ? 1 : 0);
    expect(azure.tools).toHaveBeenCalledTimes(prefix === 'az_' ? 1 : 0);
  });

  it.each(['what is on my calendar list', 'remind me in 5 minutes list', 'hvad er i min kalender', 'påmind mig om fem minutter'])(
    'does not wake any bridge for the local query "%s"', async (query) => {
      const make = (p: string, label: string): RemoteMcpBridge => ({
        prefix: p, label, status: () => ({ state: 'idle' }), warm: vi.fn(), tools: vi.fn(async () => []),
        call: async () => ({ outcome: 'ok', result: {} }),
      });
      const github = make('gh_', 'GitHub');
      const azure = make('az_', 'Azure');
      const { registry, tool } = setup([github, azure]);
      const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
      await tool('find_tools', { turn: grant.turn, query });
      expect(github.tools).not.toHaveBeenCalled();
      expect(azure.tools).not.toHaveBeenCalled();
    });

  it('returns a local repository reader while the named GitHub catalogue is blocked', async () => {
    let finish!: (response: Response) => void;
    const blocked = new Promise<Response>(resolve => { finish = resolve; });
    const github = createRemoteMcpBridge({ prefix: 'gh_', label: 'GitHub', url: 'https://fixture.invalid/mcp',
      token: async () => 'test', fetch: async () => blocked, searchWaitMs: 100 });
    const tools = vi.spyOn(github, 'tools');
    const { registry, tool } = setup([github], { tools: repositoryTools.filter(tool => tool.name === 'repo_read') });
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'read this GitHub repository file' });
    expect(found.body?.result.tools.map((match: Json) => match.name)).toContain('repo_read');
    expect(found.body?.result.note).toContain('GitHub tools are still loading');
    expect(tools).toHaveBeenCalledWith(expect.any(AbortSignal), 0);
    finish(new Response(null, { status: 503 }));
    await tool('find_tools', { turn: grant.turn, query: 'gh_get_file_contents read file' });
    expect(tools).toHaveBeenLastCalledWith(expect.any(AbortSignal), undefined);
  });

  it('gives a provider the search names one bounded wait and then says to keep going and try again shortly', async () => {
    let state: ReturnType<RemoteMcpBridge['status']> = { state: 'idle' };
    const tools = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      state = { state: 'starting' };
      return [];
    });
    const azure: RemoteMcpBridge = { prefix: 'az_', label: 'Azure', status: () => state, warm: vi.fn(), tools, call: async () => ({ outcome: 'ok', result: {} }) };
    const { registry, tool } = setup([azure]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'ressourcer i azure' });
    expect(tools).toHaveBeenCalledTimes(1);
    expect(found.body?.result.note).toMatch(/Azure tools are still loading.*Keep going.*search again shortly/u);
    expect(grant.azure.catalogue).toBe('starting');
  });

  it('can call a tool that was only listed in otherMatches, by its exact name, without another search', async () => {
    const zebras: JarvisTool[] = Array.from({ length: 6 }, (_, index) => ({
      name: `zebra_tool_${index}`, description: 'Zebra keyword tool.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ({ ran: index }),
    }));
    const { registry, tool } = setup([], { tools: zebras });
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'zebra' });
    expect(found.body?.result.tools).toHaveLength(3);
    const others = found.body?.result.otherMatches.map((entry: { name: string }) => entry.name) as string[];
    expect(others).toEqual(['zebra_tool_3', 'zebra_tool_4', 'zebra_tool_5']);
    const called = await tool('call_tool', { turn: grant.turn, name: 'zebra_tool_5', arguments: {} });
    expect(called.body).toMatchObject({ tool: 'zebra_tool_5', outcome: 'ok', result: { ran: 5 } });
    // Only names that a search showed are callable.
    const unseen = await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'x' } });
    expect(unseen.body).toMatchObject({ outcome: 'refused' });
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

  it('finds through find_tools what chat finds, plus exactly the tools only a wake has', async () => {
    // The tools are only listed in this test, never run: the stores behind them stay empty and any turn registry will do.
    const empty = {} as never;
    const turns = createPiTurnRegistry();
    const now = () => new Date('2026-11-21T12:00:00Z');
    const brainTools = createBrainTools({ registry: turns, comms: empty, proactive: empty, area: empty, inbox: empty, now });
    const standIn = (name: string): JarvisTool => ({ ...probe, name });
    const remote = (prefix: string, label: string, name: string): RemoteMcpBridge => ({
      prefix, label, status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [{ name: `${prefix}${name}`, description: `${label} tool ${name}`, inputSchema: { type: 'object' }, moduleId: 'remote', execute: async () => ({}) }],
      call: async () => ({ outcome: 'ok', result: {} }),
    });
    const { app, registry, tool } = setup([remote('gh_', 'GitHub', 'issue_write'), remote('az_', 'Azure', 'group_list')], { tools: [
      ...brainTools,
      ...createWatchTools({ watches: empty, registry: turns, memoryStore: empty }),
      ...createSituationTools({ registry: turns, service: empty, now }),
      // The older approval flow: registered, but no turn may find it.
      ...['get_pending_issue', 'confirm_create_issue', 'confirm_project_archive', 'calendar_get_pending_change', 'calendar_confirm_change', 'mail_confirm_action'].map(standIn),
    ] });
    const chat = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const wake = registry.open({
      ownerObjectId: config.auth.ownerObjectId, sessionId: '', messageId: '', signal: live(),
      brain: { runId: '00000000-0000-4000-8000-000000000003', sent: [], wrote: [], looked: [] },
    });
    // A tool is discoverable when a search for its exact name returns it: an exact name always ranks first.
    const candidates = [...app.jarvisTools.list().map(({ name }) => name), 'gh_issue_write', 'az_group_list'];
    const discoverable = async (turn: string) => {
      const found: string[] = [];
      for (const name of candidates) {
        const { result } = (await tool('find_tools', { turn, query: name })).body!;
        const listed: Array<{ name: string }> = [...result.tools, ...result.otherMatches];
        if (listed.some((entry) => entry.name === name)) found.push(name);
      }
      return found.sort();
    };
    const inChat = await discoverable(chat.turn);
    const inWake = await discoverable(wake.turn);
    const missingFrom = (names: string[], others: string[]) => names.filter((name) => !others.includes(name));
    // Only a wake has: what the brain registers, the watch tool that records a look, and anything else brainOnlyTools lists.
    const wakeOnly = [...new Set([...brainTools.map(({ name }) => name), 'watch_look', ...brainOnlyTools])].sort();
    // A failure lists the tools that differ. The Proactive source switches are the one thing that narrows a wake, and none is off here.
    expect({ 'only in a wake': missingFrom(inWake, inChat), 'only in chat': missingFrom(inChat, inWake) })
      .toEqual({ 'only in a wake': wakeOnly, 'only in chat': [] });
    // The catalogue is real: chat finds ordinary, situation and remote tools.
    expect(inChat).toEqual(expect.arrayContaining(['get_settings', 'probe_echo', 'situation_read', 'gh_issue_write', 'az_group_list']));
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

/** A probe whose runs are counted, so a test can tell a call that ran from one answered with the first result. */
function counting(
  name: string,
  execution: JarvisTool['execution'],
  work: (run: number) => unknown = (run) => ({ run, marker: 'result-secret-91bc' }),
) {
  const runs = { count: 0 };
  const probeTool: JarvisTool = {
    name,
    description: `Counting probe ${name}. Keyword: ${name.replace(/_/gu, '')}.`,
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { text: { type: 'string' }, note: { type: 'string' }, operation: { type: 'string' } },
    },
    ...(execution ? { execution } : {}),
    execute: async () => { runs.count += 1; return work(runs.count); },
  };
  return { tool: probeTool, runs };
}

describe('PI MCP door: replayed requests, repeated actions and the call ledger', () => {
  const open = (registry: ReturnType<typeof createPiTurnRegistry>, extra: Partial<Parameters<ReturnType<typeof createPiTurnRegistry>['open']>[0]> = {}) =>
    registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live(), ...extra });
  const call = (turn: string, name: string, args: Record<string, unknown>) => ({ turn, name, arguments: args });
  /** A request that carries the harness's own call id in its `_meta`, as a replay of that request would carry it again. */
  const as = (callId: string) => ({ meta: { tool_call_id: callId } });

  it('runs identical actions under different call ids every time, and says on the ledger that they repeat', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool, recorded, ledger } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    // Three sets of the same lift: the same arguments, three requests with three call ids, and key order does not matter.
    const sets = [];
    for (const [index, args] of [{ text: 'a', note: 'b' }, { note: 'b', text: 'a' }, { text: 'a', note: 'b' }].entries()) {
      sets.push(await tool('call_tool', call(grant.turn, 'probe_write', args), as(`call-${index + 1}`)));
    }
    expect(sets.map(({ body }) => body?.result.run)).toEqual([1, 2, 3]);
    for (const { body } of sets) expect(body).not.toHaveProperty('duplicate');
    expect(write.runs.count).toBe(3);
    expect(recorded).toHaveLength(3);
    expect(grant.results).toHaveLength(3);
    expect(grant.actions.count).toBe(3);
    expect(ledger().map(({ duplicate, sameArgsRepeat, replayCheck }) => [duplicate, sameArgsRepeat, replayCheck])).toEqual([
      [false, false, 'on'], [false, true, 'on'], [false, true, 'on'],
    ]);

    // Other arguments are another call, not a repeat; neither is the same call in another turn.
    await tool('call_tool', call(grant.turn, 'probe_write', { text: 'c' }), as('call-4'));
    const later = open(registry);
    later.discovered.add('probe_write');
    await tool('call_tool', call(later.turn, 'probe_write', { text: 'a', note: 'b' }), as('call-5'));
    expect(ledger().slice(3).map(({ sameArgsRepeat }) => sameArgsRepeat)).toEqual([false, false]);
    expect(write.runs.count).toBe(5);
  });

  it('answers a replayed request with the first result and duplicate: true, and does not run it again', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool, recorded, ledger } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    const first = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a', note: 'b' }), as('call-1'));
    // The same call id asking for the same thing, with the keys in another order, is the same request delivered again.
    const replay = await tool('call_tool', call(grant.turn, 'probe_write', { note: 'b', text: 'a' }), as('call-1'));
    expect(first.body).toMatchObject({ tool: 'probe_write', outcome: 'ok', result: { run: 1 } });
    expect(first.body).not.toHaveProperty('duplicate');
    expect(replay.isError).toBe(false);
    expect(replay.body).toEqual({ ...first.body, duplicate: true });
    expect(write.runs.count).toBe(1);
    expect(recorded).toHaveLength(1);
    expect(grant.results).toEqual([{ tool: 'probe_write', outcome: 'ok' }]);
    expect(grant.actions.count).toBe(1);
    expect(grant.requests.count).toBe(2);
    expect(ledger().map(({ duplicate, sameArgsRepeat, replayCheck }) => [duplicate, sameArgsRepeat, replayCheck])).toEqual([
      [false, false, 'on'], [true, false, 'on'],
    ]);

    // A new call id with the same arguments is another request: it runs, and the ledger says it repeats.
    const again = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a', note: 'b' }), as('call-2'));
    expect(again.body).toMatchObject({ outcome: 'ok', result: { run: 2 } });
    expect(again.body).not.toHaveProperty('duplicate');
    expect(ledger().at(-1)).toMatchObject({ duplicate: false, sameArgsRepeat: true });
    // The first call id stays the first's; the new one answers its own replay.
    expect((await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a', note: 'b' }), as('call-2'))).body).toEqual({ ...again.body, duplicate: true });
    expect(write.runs.count).toBe(2);
  });

  it('never keeps a read, a tool with no classification or an operation classified as a read, whatever the call id', async () => {
    const read = counting('probe_read', { defaultEffect: 'read' });
    const unclassified = counting('probe_plain', undefined);
    const operations = counting('probe_ops', { defaultEffect: 'action', operation: { field: 'operation', effects: { list: 'read', create: 'action' } } });
    const { registry, tool, ledger } = setup([], { tools: [read.tool, unclassified.tool, operations.tool] });
    const grant = open(registry);
    for (const name of ['probe_read', 'probe_plain', 'probe_ops']) grant.discovered.add(name);
    let callId = 0;
    const sameId = async (name: string, args: Record<string, unknown>) => {
      callId += 1;
      await tool('call_tool', call(grant.turn, name, args), as(`call-${callId}`));
      return tool('call_tool', call(grant.turn, name, args), as(`call-${callId}`));
    };
    for (const name of ['probe_read', 'probe_plain']) expect((await sameId(name, { text: 'same' })).body).not.toHaveProperty('duplicate');
    expect([read.runs.count, unclassified.runs.count]).toEqual([2, 2]);
    expect((await sameId('probe_ops', { operation: 'list' })).body).not.toHaveProperty('duplicate');
    expect(operations.runs.count).toBe(2);
    // An operation the tool does not classify, or none at all, is not an action either.
    for (const args of [{ operation: 'constructor' }, { text: 'no operation' }]) {
      expect((await sameId('probe_ops', args)).body).not.toHaveProperty('duplicate');
    }
    expect(operations.runs.count).toBe(6);
    // Only the create operation is an action, so only its replay is recognised.
    expect((await sameId('probe_ops', { operation: 'create' })).body).toMatchObject({ duplicate: true });
    expect(operations.runs.count).toBe(7);
    expect(ledger().some(({ sameArgsRepeat }) => sameArgsRepeat === true)).toBe(false);
  });

  it('does not keep an action that failed or was refused: a replay of it runs again, and nothing is refused', async () => {
    const steps = [
      () => { throw new ToolFailure('Nothing was saved.'); },
      () => { throw new ToolRefusal('not now'); },
      () => ({ saved: true }),
    ];
    const write = counting('probe_write', { defaultEffect: 'action' }, (run) => steps[run - 1]!());
    const { registry, tool, ledger } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    const answers = [];
    for (let index = 0; index < 4; index += 1) answers.push(await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-1')));
    expect(answers.map(({ body }) => body?.outcome)).toEqual(['error', 'refused', 'ok', 'ok']);
    expect(answers.map(({ body }) => body?.duplicate === true)).toEqual([false, false, false, true]);
    expect(write.runs.count).toBe(3);
    expect(grant.results.map(({ outcome }) => outcome)).toEqual(['error', 'refused', 'ok']);
    expect(grant.actions.count).toBe(1);
    // A refusal declined the action and an error reported no success, so running either again is no repeat.
    expect(ledger().map(({ sameArgsRepeat }) => sameArgsRepeat)).toEqual([false, false, false, false]);
  });

  it('answers a replay that arrives while the first request is still running with that request\'s result', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const write = counting('probe_write', { defaultEffect: 'action' }, async () => {
      entered();
      await new Promise<void>((resolve) => { release = resolve; });
      return { saved: true };
    });
    const { registry, tool } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    const first = tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-1'));
    await started;
    const replay = tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-1'));
    await vi.waitFor(() => expect(grant.requests.count).toBe(2));
    release();
    const [one, two] = await Promise.all([first, replay]);
    expect(write.runs.count).toBe(1);
    expect(one.body).toMatchObject({ outcome: 'ok', result: { saved: true } });
    expect(one.body).not.toHaveProperty('duplicate');
    expect(two.body).toEqual({ ...one.body, duplicate: true });
    expect(grant.results).toHaveLength(1);
  });

  it('runs a request that arrives under another call id while the first is still running, and calls it a repeat', async () => {
    let bothStarted!: () => void;
    const started = new Promise<void>(resolve => { bothStarted = resolve; });
    const releases: Array<() => void> = [];
    const write = counting('probe_write', { defaultEffect: 'action' }, async () => {
      await new Promise<void>(resolve => {
        releases.push(resolve);
        if (releases.length === 2) bothStarted();
      });
      return { saved: true };
    });
    const { registry, tool, ledger } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    // The model emits the same call twice, in parallel, on purpose.
    const both = ['call-1', 'call-2'].map((callId) => tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as(callId)));
    await started;
    for (const release of releases) release();
    const answers = await Promise.all(both);
    expect(write.runs.count).toBe(2);
    for (const { body } of answers) expect(body).not.toHaveProperty('duplicate');
    // The one that went to the tool second is the repeat, whichever finished first.
    expect(ledger().map(({ duplicate }) => duplicate)).toEqual([false, false]);
    expect(ledger().filter(({ sameArgsRepeat }) => sameArgsRepeat === true)).toHaveLength(1);
  });

  it('lets a replay that waited on a first request which failed run the call itself', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const write = counting('probe_write', { defaultEffect: 'action' }, async (run) => {
      if (run > 1) return { saved: true };
      entered();
      await new Promise<void>((resolve) => { release = resolve; });
      throw new ToolFailure('Nothing was saved.');
    });
    const { registry, tool, ledger } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    const first = tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-1'));
    await started;
    const replay = tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-1'));
    await vi.waitFor(() => expect(grant.requests.count).toBe(2));
    release();
    const [one, two] = await Promise.all([first, replay]);
    expect(one.body).toMatchObject({ outcome: 'error' });
    expect(two.body).toMatchObject({ outcome: 'ok', result: { saved: true } });
    expect(two.body).not.toHaveProperty('duplicate');
    expect(write.runs.count).toBe(2);
    expect(ledger().map(({ duplicate, sameArgsRepeat }) => [duplicate, sameArgsRepeat])).toEqual([[false, false], [false, false]]);
  });

  it('recognises no replay in a turn where one call id has asked for different things', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool, ledger } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    // A harness that gives every request the same call id asks for a search, then for the same action three times.
    await tool('find_tools', { turn: grant.turn, query: 'probewrite' }, as('call-7'));
    const sets = [];
    for (let index = 0; index < 3; index += 1) sets.push(await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-7')));
    expect(sets.map(({ body }) => body?.result.run)).toEqual([1, 2, 3]);
    for (const { body } of sets) expect(body).not.toHaveProperty('duplicate');
    expect(write.runs.count).toBe(3);
    expect(grant.identities.reused).toBe(true);
    expect(ledger().map(({ replayCheck, duplicate, sameArgsRepeat }) => [replayCheck, duplicate, sameArgsRepeat])).toEqual([
      ['on', false, false], ['id_reused', false, false], ['id_reused', false, true], ['id_reused', false, true],
    ]);
    // Another turn judges its own call ids again.
    const next = open(registry);
    next.discovered.add('probe_write');
    await tool('call_tool', call(next.turn, 'probe_write', { text: 'a' }), as('call-9'));
    await tool('call_tool', call(next.turn, 'probe_write', { text: 'a' }), as('call-9'));
    expect(ledger().slice(4).map(({ replayCheck, duplicate }) => [replayCheck, duplicate])).toEqual([['on', false], ['on', true]]);
    expect(write.runs.count).toBe(4);
  });

  it('runs a deliberate repeat when each model round opens a new connection and so numbers its requests 1 and 2 again', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool, ledger } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    // The door is stateless, so a client that opens a connection per round starts again at id 1 every time. An identical search and an
    // identical action are then byte-identical to a retried POST; only a call id in the meta could tell them apart, and there is none.
    const rounds = [];
    for (let round = 0; round < 3; round += 1) {
      await tool('find_tools', { turn: grant.turn, query: 'probewrite' }, { id: 1 });
      rounds.push(await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), { id: 2 }));
    }
    expect(rounds.map(({ body }) => body?.result.run)).toEqual([1, 2, 3]);
    for (const { body } of rounds) expect(body).not.toHaveProperty('duplicate');
    expect(write.runs.count).toBe(3);
    expect(grant.results).toHaveLength(3);
    expect(grant.identities.asked.size).toBe(0);
    expect(ledger().every(({ replayCheck, duplicate }) => replayCheck === 'no_id' && duplicate === false)).toBe(true);
    expect(ledger().filter(({ tool: name }) => name === 'probe_write').map(({ sameArgsRepeat }) => sameArgsRepeat)).toEqual([false, true, true]);
  });

  it('recognises a replay by a call id in the request meta and ignores the JSON-RPC id, whatever it is', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    const first = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), { id: 9001, ...as('call-1') });
    // Another JSON-RPC id, the same call id: the same request delivered again.
    const replay = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), { id: 9002, ...as('call-1') });
    expect(replay.body).toEqual({ ...first.body, duplicate: true });
    // The first JSON-RPC id again, another call id: another request.
    const other = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), { id: 9001, ...as('call-2') });
    expect(other.body).toMatchObject({ outcome: 'ok', result: { run: 2 } });
    expect(other.body).not.toHaveProperty('duplicate');
    expect(write.runs.count).toBe(2);
  });

  it('counts an action by what the call did: the operation it named, and a writer that declares nothing, but not a list or a read', async () => {
    const operations = counting('probe_ops', { defaultEffect: 'action', operation: { field: 'operation', effects: { list: 'read', create: 'action' } } });
    // A writer with no declaration of its own: tool-effects.ts says issue_comment writes.
    const writer = counting('issue_comment', undefined);
    const reader = counting('probe_plain', undefined);
    const { registry, tool } = setup([], { tools: [operations.tool, writer.tool, reader.tool] });
    const grant = open(registry);
    for (const name of ['probe_ops', 'issue_comment', 'probe_plain']) grant.discovered.add(name);
    await tool('call_tool', call(grant.turn, 'probe_ops', { operation: 'list' }));
    await tool('call_tool', call(grant.turn, 'probe_plain', { text: 'x' }));
    expect(grant.actions.count).toBe(0);
    await tool('call_tool', call(grant.turn, 'probe_ops', { operation: 'create' }));
    await tool('call_tool', call(grant.turn, 'issue_comment', { text: 'x' }));
    expect(grant.actions.count).toBe(2);
    expect(grant.results).toHaveLength(4);
  });

  it('does not run again a replay of an action that may have gone through, and runs one that says nothing happened', async () => {
    const unknown = counting('probe_write', { defaultEffect: 'action' }, () => {
      throw new ToolFailure('The save may or may not have gone through.', { outcomeUnknown: true });
    });
    const nothing = counting('probe_other', { defaultEffect: 'action' }, () => { throw new ToolFailure('Nothing was saved.'); });
    const crashing = counting('probe_boom', { defaultEffect: 'action' }, () => { throw new Error('connection reset by peer'); });
    const { registry, tool } = setup([], { tools: [unknown.tool, nothing.tool, crashing.tool] });
    const grant = open(registry);
    for (const name of ['probe_write', 'probe_other', 'probe_boom']) grant.discovered.add(name);
    const first = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-1'));
    const replay = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-1'));
    expect(first.body).toMatchObject({ outcome: 'error', result: { outcomeUnknown: true } });
    expect(replay.body).toEqual({ ...first.body, duplicate: true });
    expect(unknown.runs.count).toBe(1);
    // An error nobody expected, from a tool that writes, may have done its work as well: its replay is not run again either.
    const crashed = await tool('call_tool', call(grant.turn, 'probe_boom', { text: 'a' }), as('call-4'));
    expect(crashed.body).toMatchObject({ outcome: 'error', result: { outcomeUnknown: true } });
    expect((await tool('call_tool', call(grant.turn, 'probe_boom', { text: 'a' }), as('call-4'))).body).toEqual({ ...crashed.body, duplicate: true });
    expect(crashing.runs.count).toBe(1);
    // A failure that claims nothing happened is run again, as before; and so is a deliberate new call of the first. Nothing is refused.
    await tool('call_tool', call(grant.turn, 'probe_other', { text: 'a' }), as('call-2'));
    expect((await tool('call_tool', call(grant.turn, 'probe_other', { text: 'a' }), as('call-2'))).body).not.toHaveProperty('duplicate');
    expect(nothing.runs.count).toBe(2);
    await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-3'));
    expect(unknown.runs.count).toBe(2);
    expect(grant.actions.count).toBe(0);
  });

  it('does not append to a note a second time when the first append could not be confirmed (the real vault_write)', async () => {
    const write = vi.fn(async () => { throw new Error('socket hang up'); });
    const vault = createVaultModule({
      client: { read: async () => null, write, tree: async () => [] } as never,
      indexStore: { supportsVectorSearch: () => false } as never,
      memoryStore: { getSourceMessage: async (messageId: string) => ({ messageId, text: 'Add to my pergola note.' }) } as never,
    });
    const { registry, tool } = setup([], { tools: vault.tools.filter(({ name }) => name === 'vault_write') });
    const grant = open(registry);
    grant.discovered.add('vault_write');
    const append = { path: 'Personal/Pergola.md', append: 'Build the pergola.', reason: 'Dan asked for it', automaticCapture: false };

    const first = await tool('call_tool', call(grant.turn, 'vault_write', append), as('call-1'));
    const replay = await tool('call_tool', call(grant.turn, 'vault_write', append), as('call-1'));

    expect(first.body).toMatchObject({ outcome: 'error', result: { outcomeUnknown: true } });
    expect(replay.body).toEqual({ ...first.body, duplicate: true });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('says an action may have gone through when the route fails after the tool could have run, and not when it was rejected before', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const read = counting('probe_read', { defaultEffect: 'read' });
    const { app, registry, tool } = setup([], { tools: [write.tool, read.tool] });
    let status = 500;
    app.addHook('onSend', async (request, reply, payload) => {
      if (request.url.startsWith('/tools/probe_')) void reply.code(status);
      return payload;
    });
    const grant = open(registry);
    for (const name of ['probe_write', 'probe_read']) grant.discovered.add(name);
    const lost = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-1'));
    expect(lost.isError).toBe(true);
    expect(lost.body).toMatchObject({ outcome: 'error', result: { outcomeUnknown: true } });
    expect(lost.body?.result.error).toMatch(/may or may not have gone through/u);
    // The write ran once; its replay is answered with that and does not run it again.
    expect((await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-1'))).body).toEqual({ ...lost.body, duplicate: true });
    expect(write.runs.count).toBe(1);
    // A read cannot have changed anything; and a route that said no before the tool started changed nothing either.
    expect((await tool('call_tool', call(grant.turn, 'probe_read', { text: 'a' }))).body?.result)
      .toEqual({ error: 'The tool could not run. Nothing is confirmed as done.' });
    status = 503;
    expect((await tool('call_tool', call(grant.turn, 'probe_write', { text: 'b' }), as('call-2'))).body?.result)
      .toEqual({ error: 'The tool could not run. Nothing is confirmed as done.' });
  });

  it('reports a write as written when only its audit row was lost, and does not write it again on the replay', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool } = setup([], { tools: [write.tool], auditDown: true });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    const first = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-1'));
    expect(first.isError).toBe(false);
    expect(first.body).toMatchObject({ outcome: 'ok', result: { run: 1 } });
    expect((await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }), as('call-1'))).body).toEqual({ ...first.body, duplicate: true });
    expect(write.runs.count).toBe(1);
    expect(grant.actions.count).toBe(1);
  });

  it('finds the identity of a request in its meta only: a string call id under a key ending in call_id or callId', () => {
    expect(requestIdentity({ progressToken: 'p', toolCallId: 'abc-1' })).toBe('call:abc-1');
    expect(requestIdentity({ call_id: 'c.2:x-3' })).toBe('call:c.2:x-3');
    expect(requestIdentity({ 'x-ms-call-id': 'c4' })).toBe('call:c4');
    // A value that is not a short token, a key that is not a call id and a missing meta give no identity. The JSON-RPC id is never one.
    expect(requestIdentity({ call_id: 'not a call id!', progressToken: 'p' })).toBeUndefined();
    expect(requestIdentity({ call_id: 7 })).toBeUndefined();
    expect(requestIdentity({ callIdentifier: 'x', session: 'y' })).toBeUndefined();
    expect(requestIdentity({ progressToken: 'p' })).toBeUndefined();
    expect(requestIdentity(undefined)).toBeUndefined();
    expect(requestIdentity(null)).toBeUndefined();
  });

  it('writes one ledger line per call with its name, outcome, size, channel, provider, replay state and a hash of the turn, and no argument, result or reference', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool, ledger, logged } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    const found = await tool('find_tools', { turn: grant.turn, query: 'probewrite' });
    const first = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'argument-secret-7f3a' }), as('call-1'));
    const replay = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'argument-secret-7f3a' }), as('call-1'));
    const repeat = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'argument-secret-7f3a' }), as('call-2'));
    const missing = await tool('call_tool', call(grant.turn, 'probe_missing', { text: 'argument-secret-7f3a' }));
    const hash = createHash('sha256').update(grant.turn).digest('hex').slice(0, 8);
    const line = (name: string, reply: { text?: string | undefined }, fields: Record<string, unknown>) => ({
      level: 30, time: expect.any(Number), service: 'jarvis-backend', msg: 'pi.mcp_tool', tool: name, elapsedMs: expect.any(Number),
      resultBytes: Buffer.byteLength(reply.text!), truncated: false, duplicate: false, sameArgsRepeat: false, replayCheck: 'no_id',
      turnHash: hash, channel: 'chat', provider: 'local', ...fields,
    });
    // A request without a call id has nothing to be recognised by; the ones that carry one list their meta key names.
    const withCallId = { replayCheck: 'on', metaKeys: ['tool_call_id'] };
    expect(ledger()).toEqual([
      line('find_tools', found, { outcome: 'ok' }),
      line('probe_write', first, { outcome: 'ok', ...withCallId }),
      line('probe_write', replay, { outcome: 'ok', duplicate: true, ...withCallId }),
      line('probe_write', repeat, { outcome: 'ok', sameArgsRepeat: true, ...withCallId }),
      line('probe_missing', missing, { outcome: 'refused' }),
    ]);
    expect(ledger().every(({ elapsedMs }) => elapsedMs >= 0)).toBe(true);
    const everything = logged();
    for (const private_ of ['argument-secret-7f3a', 'result-secret-91bc', grant.turn, 'call-1', 'call-2']) expect(everything).not.toContain(private_);
    expect(hash).toMatch(/^[0-9a-f]{8}$/u);
  });

  it('hands the logger nothing but the ledger fields, before the allow-list sees them', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool, ledger, logged } = setup([], { tools: [write.tool], rawLog: true });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    await tool('call_tool', call(grant.turn, 'probe_write', { text: 'argument-secret-7f3a' }));
    await tool('call_tool', call(grant.turn, 'probe_write', { text: 'argument-secret-7f3a' }), { meta: { tool_call_id: 'call-secret-3c', progressToken: 'p-secret-5d' } });
    const [plain, withMeta] = ledger();
    const base = ['level', 'time', 'pid', 'hostname', 'reqId', 'msg'];
    const fieldsOf = (line: Json | undefined) => Object.keys(line!).filter((key) => !base.includes(key)).sort();
    const ledgerFields = ['channel', 'duplicate', 'elapsedMs', 'outcome', 'provider', 'replayCheck', 'resultBytes', 'sameArgsRepeat', 'tool', 'truncated', 'turnHash'];
    expect(fieldsOf(plain)).toEqual(ledgerFields);
    // The meta key names are the only thing the door takes from the meta; the values never reach the logger.
    expect(fieldsOf(withMeta)).toEqual([...ledgerFields, 'metaKeys'].sort());
    expect(withMeta!.metaKeys).toEqual(['progressToken', 'tool_call_id']);
    for (const private_ of ['argument-secret-7f3a', 'result-secret-91bc', grant.turn, 'call-secret-3c', 'p-secret-5d']) expect(logged()).not.toContain(private_);
  });

  it('lists the names of the request meta keys on the ledger line, bounded and never their values, so the harness\'s real call-id key can be read from live lines', async () => {
    const { registry, tool, ledger, logged } = setup();
    const grant = open(registry);
    const keys = Array.from({ length: 20 }, (_, index) => `x-key-${String(index).padStart(2, '0')}`);
    await tool('find_tools', { turn: grant.turn, query: 'probe' }, { meta: { 'x-ms-call-id': 'call-secret-3c', 'bad key!': 'v-secret-1', progressToken: 'p-secret-5d' } });
    await tool('find_tools', { turn: grant.turn, query: 'probe' }, { meta: Object.fromEntries(keys.map((key) => [key, 'v-secret-2'])) });
    await tool('find_tools', { turn: grant.turn, query: 'probe' });
    const [named, many, none] = ledger();
    // Sorted; a key with a space or a symbol is dropped by the allow-list.
    expect(named!.metaKeys).toEqual(['progressToken', 'x-ms-call-id']);
    expect(many!.metaKeys).toEqual(keys.slice(0, 12));
    expect(none).not.toHaveProperty('metaKeys');
    for (const private_ of ['call-secret-3c', 'v-secret-1', 'v-secret-2', 'p-secret-5d']) expect(logged()).not.toContain(private_);
  });

  it('writes a ledger line for a forged or closed turn reference without a channel, and still refuses it as before', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool, ledger } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    const forgedTurn = 'jt-AAAAAAAAAAAAAAAAAAAAAA';
    const forged = await tool('call_tool', call(forgedTurn, 'probe_write', { text: 'x' }));
    const search = await tool('find_tools', { turn: forgedTurn, query: 'probewrite' });
    registry.close(grant.turn);
    const late = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'x' }));
    for (const reply of [forged, search, late]) expect(reply).toMatchObject({ isError: true, body: { outcome: 'refused' } });
    expect(write.runs.count).toBe(0);
    expect(ledger().map(({ tool: name, outcome, channel, turnHash }) => ({ name, outcome, channel, turnHash }))).toEqual([
      { name: 'probe_write', outcome: 'refused', channel: undefined, turnHash: createHash('sha256').update(forgedTurn).digest('hex').slice(0, 8) },
      { name: 'find_tools', outcome: 'refused', channel: undefined, turnHash: createHash('sha256').update(forgedTurn).digest('hex').slice(0, 8) },
      { name: 'probe_write', outcome: 'refused', channel: undefined, turnHash: createHash('sha256').update(grant.turn).digest('hex').slice(0, 8) },
    ]);
  });

  it('names the channel of the turn: chat, voice, wake or smoke', async () => {
    const { registry, tool, ledger } = setup();
    const activation = (type: 'voice') => ({
      id: '00000000-0000-4000-8000-000000000003', type, source: type, slotKey: null, stateRevision: 0, stateHash: null,
      policyRevision: 'a'.repeat(64), staleSources: 0, disabledSources: [],
    });
    const grants = [
      ['chat', open(registry)],
      ['voice', open(registry, { activation: activation('voice') })],
      ['wake', open(registry, { sessionId: '', messageId: '', brain: { runId: '00000000-0000-4000-8000-000000000004', sent: [], wrote: [], looked: [] } })],
      ['smoke', open(registry, { sessionId: '', messageId: '', smoke: true })],
    ] as const;
    for (const [, grant] of grants) await tool('find_tools', { turn: grant.turn, query: 'probe' });
    expect(ledger().map(({ channel }) => channel)).toEqual(['chat', 'voice', 'wake', 'smoke']);
  });

  it('leaves a read at the cap unchanged and keeps the next result’s array preview valid', async () => {
    const atCap = 'x'.repeat(23_998);
    const rows = [{ text: '"'.repeat(5_000) }, { text: 'y'.repeat(15_000) }];
    const large = counting('probe_large', { defaultEffect: 'read' }, (run) => run === 1 ? atCap : rows);
    const { registry, tool, ledger } = setup([], { tools: [large.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_large');
    const full = await tool('call_tool', call(grant.turn, 'probe_large', {}));
    expect(full.body?.result).toBe(atCap);
    const cut = await tool('call_tool', call(grant.turn, 'probe_large', {}));
    const result = cut.body?.result;
    expect(result).toMatchObject({
      truncated: true, totalCharacters: JSON.stringify(rows).length,
      note: 'Result shortened; narrow the query by limit, date range or path and call again.',
    });
    expect(JSON.parse(result.preview)).toEqual(rows.slice(0, 1));
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
    expect(ledger().at(-1)).toMatchObject({
      tool: 'probe_large', outcome: 'ok', truncated: true, resultBytes: Buffer.byteLength(cut.text!),
    });
  });

  it('shortens a calendar read without splitting emoji or cutting its receipt or confirmation', async () => {
    const value = { rows: '😀"\n\\'.repeat(6_000), receipt: { id: 'receipt-42', status: 'delivered' }, confirmation: 'The read finished.' };
    const read = counting('calendar_list_events', { defaultEffect: 'read' }, () => value);
    const { registry, tool, ledger } = setup([], { tools: [read.tool] });
    const grant = open(registry);
    await tool('find_tools', { turn: grant.turn, query: 'calendar_list_events' });
    const readback = await tool('call_tool', call(grant.turn, 'calendar_list_events', {}));
    expect(readback.body).toMatchObject({
      outcome: 'ok', confirmation: 'Done: calendar_list_events succeeded. Result shortened.',
      result: { truncated: true, totalCharacters: JSON.stringify(value).length, receipt: value.receipt, confirmation: value.confirmation },
    });
    const result = readback.body?.result;
    const rows: string = JSON.parse(result.preview).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(value.rows.length);
    expect(rows).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(value.rows.startsWith(rows)).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
    expect(ledger().at(-1)).toMatchObject({ tool: 'calendar_list_events', truncated: true });
  });

  it('keeps a cursor and status fields at the tail of an oversized object result', async () => {
    const rows = [{ text: 'a'.repeat(12_000) }, { text: 'b'.repeat(13_000) }];
    const paging = {
      next: { date: '2026-11-22', key: 'b' },
      hasMore: true,
      pageInfo: { endCursor: 'cursor-2', hasNextPage: true },
      coverage: { continuation: { rows: 'cursor-2' } },
      warning: 'These are retained records, not live data.',
      status: 'available',
    };
    const value = { rows, ...paging, truncated: false };
    const read = counting('probe_paged_read', { defaultEffect: 'read' }, () => value);
    const { registry, tool } = setup([], { tools: [read.tool] });
    const grant = open(registry);
    grant.discovered.add(read.tool.name);
    const cut = await tool('call_tool', call(grant.turn, read.tool.name, {}));
    const result = cut.body?.result;
    expect(result).toMatchObject({ ...paging, sourceTruncated: false, truncated: true, totalCharacters: JSON.stringify(value).length });
    expect(JSON.parse(result.preview)).toEqual({ rows: rows.slice(0, 1) });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
  });

  it('says when the first item is too large rather than returning an apparently empty array', async () => {
    const value = [{ text: 'x'.repeat(25_000) }, { text: 'second row' }];
    const read = counting('probe_large_item', { defaultEffect: 'read' }, () => value);
    const { registry, tool } = setup([], { tools: [read.tool] });
    const grant = open(registry);
    grant.discovered.add(read.tool.name);
    const cut = await tool('call_tool', call(grant.turn, read.tool.name, {}));
    expect(cut.body?.result).toMatchObject({
      preview: '', truncated: true, totalCharacters: JSON.stringify(value).length,
      note: 'Result shortened; the first array item did not fit, so narrow the query.',
    });
  });

  it('returns a large write and its receipt in full, including on replay', async () => {
    const value = { rows: 'x'.repeat(30_000), receipt: { id: 'committed-42' }, confirmation: 'The write was saved.' };
    const write = counting('probe_large_write', { defaultEffect: 'action' }, () => value);
    const { registry, tool, ledger } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add(write.tool.name);
    const args = call(grant.turn, write.tool.name, {});
    const original = await tool('call_tool', args, as('call-1'));
    const replay = await tool('call_tool', args, as('call-1'));
    expect(original.body?.result).toEqual(value);
    expect(replay.body).toEqual({ ...original.body, duplicate: true });
    expect(write.runs.count).toBe(1);
    expect(ledger().map(({ truncated }) => truncated)).toEqual([false, false]);
  });

  it('records the provider of a remote tool, still runs a remote repeat each time, and writes a line when the call throws', async () => {
    const remoteCalls: string[] = [];
    let failing = false;
    const github: RemoteMcpBridge = {
      prefix: 'gh_', label: 'GitHub', status: () => ({ state: 'ready' }), warm: vi.fn(),
      tools: async () => [{
        name: 'gh_issue_read', description: 'GitHub: read an issue', inputSchema: { type: 'object' }, moduleId: 'github',
        execute: async () => { throw new Error('Remote tools run through the bridge'); },
      }],
      call: async (name) => {
        if (failing) throw new Error('bridge-secret-5d1e');
        remoteCalls.push(name);
        return { outcome: 'ok', result: { title: 'remote' } };
      },
    };
    const { registry, tool, ledger, logged } = setup([github]);
    const grant = open(registry);
    await tool('find_tools', { turn: grant.turn, query: 'github issue read' });
    expect(grant.discovered.has('gh_issue_read')).toBe(true);
    const first = await tool('call_tool', call(grant.turn, 'gh_issue_read', { issue_number: 1 }));
    const repeat = await tool('call_tool', call(grant.turn, 'gh_issue_read', { issue_number: 1 }));
    expect(remoteCalls).toEqual(['gh_issue_read', 'gh_issue_read']);
    expect(first.body).not.toHaveProperty('duplicate');
    expect(repeat.body).not.toHaveProperty('duplicate');
    failing = true;
    await tool('call_tool', call(grant.turn, 'gh_issue_read', { issue_number: 2 }));
    expect(ledger().map(({ tool: name, provider, outcome, duplicate }) => [name, provider, outcome, duplicate])).toEqual([
      ['find_tools', 'gh_', 'ok', false], ['gh_issue_read', 'gh_', 'ok', false], ['gh_issue_read', 'gh_', 'ok', false],
      ['gh_issue_read', 'gh_', 'error', false],
    ]);
    const thrown = ledger().at(-1)!;
    expect(thrown).not.toHaveProperty('resultBytes');
    expect(thrown.channel).toBe('chat');
    expect(logged()).not.toContain('bridge-secret-5d1e');
  });
});
