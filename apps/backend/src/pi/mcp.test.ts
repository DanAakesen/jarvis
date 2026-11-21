import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createPiAuth } from '../auth/pi-credential.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { ToolRefusal, type JarvisTool } from '../core/tool-registry.js';
import { createLogger } from '../logging.js';
import { createPiRoutes } from './routes.js';
import { createPiTurnRegistry } from './turns.js';
import type { RemoteMcpBridge } from './remote-mcp.js';
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
  options: { tools?: JarvisTool[]; situation?: PiSituationService; smokeBudgetExhausted?: boolean; rawLog?: boolean } = {},
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

describe('PI MCP door: repeated actions and the call ledger', () => {
  const open = (registry: ReturnType<typeof createPiTurnRegistry>, extra: Partial<Parameters<ReturnType<typeof createPiTurnRegistry>['open']>[0]> = {}) =>
    registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live(), ...extra });
  const call = (turn: string, name: string, args: Record<string, unknown>) => ({ turn, name, arguments: args });

  it('runs an action once, and answers an identical repeat in the same turn with the first result and duplicate: true', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool, recorded } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    const first = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a', note: 'b' }));
    // The same arguments in another key order are the same call.
    const repeat = await tool('call_tool', call(grant.turn, 'probe_write', { note: 'b', text: 'a' }));
    expect(first.body).toMatchObject({ tool: 'probe_write', outcome: 'ok', result: { run: 1 } });
    expect(first.body).not.toHaveProperty('duplicate');
    expect(repeat.isError).toBe(false);
    expect(repeat.body).toEqual({ ...first.body, duplicate: true });
    expect(write.runs.count).toBe(1);
    expect(recorded).toHaveLength(1);
    expect(grant.results).toEqual([{ tool: 'probe_write', outcome: 'ok' }]);
    expect(grant.actions.count).toBe(1);
    expect(grant.requests.count).toBe(2);

    // Different arguments are a different call, and so is the same call in another turn.
    const other = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'c' }));
    expect(other.body).toMatchObject({ outcome: 'ok', result: { run: 2 } });
    expect(other.body).not.toHaveProperty('duplicate');
    const later = open(registry);
    later.discovered.add('probe_write');
    const again = await tool('call_tool', call(later.turn, 'probe_write', { text: 'a', note: 'b' }));
    expect(again.body).toMatchObject({ outcome: 'ok', result: { run: 3 } });
    expect(again.body).not.toHaveProperty('duplicate');
    expect(write.runs.count).toBe(3);
  });

  it('runs a read, a tool with no classification and an operation classified as a read every time', async () => {
    const read = counting('probe_read', { defaultEffect: 'read' });
    const unclassified = counting('probe_plain', undefined);
    const operations = counting('probe_ops', { defaultEffect: 'action', operation: { field: 'operation', effects: { list: 'read', create: 'action' } } });
    const { registry, tool } = setup([], { tools: [read.tool, unclassified.tool, operations.tool] });
    const grant = open(registry);
    for (const name of ['probe_read', 'probe_plain', 'probe_ops']) grant.discovered.add(name);
    for (const name of ['probe_read', 'probe_plain']) {
      await tool('call_tool', call(grant.turn, name, { text: 'same' }));
      expect((await tool('call_tool', call(grant.turn, name, { text: 'same' }))).body).not.toHaveProperty('duplicate');
    }
    expect([read.runs.count, unclassified.runs.count]).toEqual([2, 2]);
    await tool('call_tool', call(grant.turn, 'probe_ops', { operation: 'list' }));
    await tool('call_tool', call(grant.turn, 'probe_ops', { operation: 'list' }));
    expect(operations.runs.count).toBe(2);
    await tool('call_tool', call(grant.turn, 'probe_ops', { operation: 'create' }));
    expect((await tool('call_tool', call(grant.turn, 'probe_ops', { operation: 'create' }))).body).toMatchObject({ duplicate: true });
    expect(operations.runs.count).toBe(3);
    // An operation the tool does not classify, or none at all, is not an action either.
    for (const args of [{ operation: 'constructor' }, { text: 'no operation' }]) {
      await tool('call_tool', call(grant.turn, 'probe_ops', args));
      await tool('call_tool', call(grant.turn, 'probe_ops', args));
    }
    expect(operations.runs.count).toBe(7);
  });

  it('does not remember an action that failed or was refused: nothing is refused, so asking again runs it again', async () => {
    const steps = [
      () => { throw new Error('flaky'); },
      () => { throw new ToolRefusal('not now'); },
      () => ({ saved: true }),
    ];
    const write = counting('probe_write', { defaultEffect: 'action' }, (run) => steps[run - 1]!());
    const { registry, tool } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    const answers = [];
    for (let index = 0; index < 4; index += 1) answers.push(await tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' })));
    expect(answers.map(({ body }) => body?.outcome)).toEqual(['error', 'refused', 'ok', 'ok']);
    expect(answers.map(({ body }) => body?.duplicate === true)).toEqual([false, false, false, true]);
    expect(write.runs.count).toBe(3);
    expect(grant.results.map(({ outcome }) => outcome)).toEqual(['error', 'refused', 'ok']);
    expect(grant.actions.count).toBe(1);
  });

  it('runs an action once when an identical call arrives while the first is still running', async () => {
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
    const first = tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }));
    await started;
    const second = tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }));
    await vi.waitFor(() => expect(grant.requests.count).toBe(2));
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(write.runs.count).toBe(1);
    expect(one.body).toMatchObject({ outcome: 'ok', result: { saved: true } });
    expect(one.body).not.toHaveProperty('duplicate');
    expect(two.body).toEqual({ ...one.body, duplicate: true });
    expect(grant.results).toHaveLength(1);
  });

  it('lets a repeat that waited on a first run which failed run the call itself', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const write = counting('probe_write', { defaultEffect: 'action' }, async (run) => {
      if (run > 1) return { saved: true };
      entered();
      await new Promise<void>((resolve) => { release = resolve; });
      throw new Error('first run failed');
    });
    const { registry, tool } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    const first = tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }));
    await started;
    const second = tool('call_tool', call(grant.turn, 'probe_write', { text: 'a' }));
    await vi.waitFor(() => expect(grant.requests.count).toBe(2));
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(one.body).toMatchObject({ outcome: 'error' });
    expect(two.body).toMatchObject({ outcome: 'ok', result: { saved: true } });
    expect(two.body).not.toHaveProperty('duplicate');
    expect(write.runs.count).toBe(2);
  });

  it('writes one ledger line per call with its name, outcome, size, channel, provider and a hash of the turn, and no argument, result or reference', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool, ledger, logged } = setup([], { tools: [write.tool] });
    const grant = open(registry);
    const found = await tool('find_tools', { turn: grant.turn, query: 'probewrite' });
    const first = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'argument-secret-7f3a' }));
    const repeat = await tool('call_tool', call(grant.turn, 'probe_write', { text: 'argument-secret-7f3a' }));
    const missing = await tool('call_tool', call(grant.turn, 'probe_missing', { text: 'argument-secret-7f3a' }));
    const hash = createHash('sha256').update(grant.turn).digest('hex').slice(0, 8);
    const line = (name: string, reply: { text?: string | undefined }, fields: Record<string, unknown>) => ({
      level: 30, time: expect.any(Number), service: 'jarvis-backend', msg: 'pi.mcp_tool', tool: name, elapsedMs: expect.any(Number),
      resultBytes: Buffer.byteLength(reply.text!), truncated: false, turnHash: hash, channel: 'chat', provider: 'local', ...fields,
    });
    expect(ledger()).toEqual([
      line('find_tools', found, { outcome: 'ok', duplicate: false }),
      line('probe_write', first, { outcome: 'ok', duplicate: false }),
      line('probe_write', repeat, { outcome: 'ok', duplicate: true }),
      line('probe_missing', missing, { outcome: 'refused', duplicate: false }),
    ]);
    expect(ledger().every(({ elapsedMs }) => elapsedMs >= 0)).toBe(true);
    const everything = logged();
    for (const private_ of ['argument-secret-7f3a', 'result-secret-91bc', grant.turn]) expect(everything).not.toContain(private_);
    expect(hash).toMatch(/^[0-9a-f]{8}$/u);
  });

  it('hands the logger nothing but the ledger fields, before the allow-list sees them', async () => {
    const write = counting('probe_write', { defaultEffect: 'action' });
    const { registry, tool, ledger, logged } = setup([], { tools: [write.tool], rawLog: true });
    const grant = open(registry);
    grant.discovered.add('probe_write');
    await tool('call_tool', call(grant.turn, 'probe_write', { text: 'argument-secret-7f3a' }));
    const [line] = ledger();
    const base = ['level', 'time', 'pid', 'hostname', 'reqId', 'msg'];
    expect(Object.keys(line!).filter((key) => !base.includes(key)).sort()).toEqual([
      'channel', 'duplicate', 'elapsedMs', 'outcome', 'provider', 'resultBytes', 'tool', 'truncated', 'turnHash',
    ]);
    for (const private_ of ['argument-secret-7f3a', 'result-secret-91bc', grant.turn]) expect(logged()).not.toContain(private_);
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

  it('marks a result that was cut short, and counts the bytes the model was given', async () => {
    const large = counting('probe_large', { defaultEffect: 'read' }, () => 'x'.repeat(250_000));
    const { registry, tool, ledger } = setup([], { tools: [large.tool] });
    const grant = open(registry);
    grant.discovered.add('probe_large');
    const cut = await tool('call_tool', call(grant.turn, 'probe_large', {}));
    expect(cut.body).toMatchObject({ outcome: 'ok', truncated: true });
    expect(ledger()).toEqual([expect.objectContaining({
      tool: 'probe_large', outcome: 'ok', truncated: true, resultBytes: Buffer.byteLength(cut.text!),
    })]);
    expect(Buffer.byteLength(cut.text!)).toBeLessThan(250_000);
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
