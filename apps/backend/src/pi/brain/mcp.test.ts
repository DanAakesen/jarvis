import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createPiAuth } from '../../auth/pi-credential.js';
import { loadConfig } from '../../config.js';
import { coreModule } from '../../core/index.js';
import type { JarvisTool } from '../../core/tool-registry.js';
import { createPiArea } from '../area.js';
import type { RemoteMcpBridge } from '../remote-mcp.js';
import { createPiRoutes } from '../routes.js';
import type { PiSituationService } from '../situation.js';
import { createPiTurnRegistry } from '../turns.js';
import { memoryConversations, memoryVault } from './brain.testkit.js';
import { BrainCommsRefusal, createBrainComms } from './comms.js';
import { createBrainTools } from './tools.js';
import { createMemoryProactiveStore } from '../../proactive/store.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const secret = 'A'.repeat(43);
const ownerToken = 'owner.token.fixture';
const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
const live = () => new AbortController().signal;

const calls: string[] = [];
const probes: JarvisTool[] = ['list_projects', 'create_issue'].map((name) => ({
  name, description: `Probe ${name}. Keyword: probe.`,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: async (_input, request) => { calls.push(`${name}:${String(request.headers['x-jarvis-message-id'])}:${String(request.jarvisPi)}`); return { ok: true }; },
}));

function setup(...bridges: RemoteMcpBridge[]) {
  calls.length = 0;
  const registry = createPiTurnRegistry();
  const auth = createPiAuth(config.auth.tenantId, secret);
  const vault = memoryVault();
  const conversations = memoryConversations();
  const pushes: unknown[] = [];
  const proactive = createMemoryProactiveStore(config.auth.ownerObjectId);
  const emptySituation = (): Awaited<ReturnType<PiSituationService['read']>> => ({
    state: null,
    revision: 1,
    hash: 'a'.repeat(64),
    policyRevision: 'b'.repeat(64),
    staleSources: [],
    missingSources: [],
    disabledSources: [],
    freshSources: [],
    asOf: null,
    updatedAt: null,
    lastActivation: null,
  });
  let currentSituation = emptySituation();
  let nextSituation: ReturnType<typeof emptySituation> | undefined;
  const situation = {
    async read() {
      const value = currentSituation;
      if (nextSituation) {
        currentSituation = nextSituation;
        nextSituation = undefined;
      }
      return value;
    },
  } as never;
  const comms = createBrainComms({ conversations: conversations.store, ownerObjectId: config.auth.ownerObjectId, push: (m) => pushes.push(m), announce: () => {}, now: () => new Date('2026-11-16T10:00:00Z') });
  const app = buildApp(config, undefined, {
    modules: [coreModule, { id: 'probe', tools: probes, registerRoutes: async () => {} },
      { id: 'pi', tools: createBrainTools({
        registry, comms, proactive, situation,
        area: createPiArea({ vault }), now: () => new Date('2026-11-16T10:00:00Z'),
      }),
        registerRoutes: createPiRoutes({ gateway: { stream: async function* () {} } as never, registry, auth, monthlyCapDkk: 250, bridges }) }],
    auth: async (token) => {
      if (token === 'agent.token.fixture') return { kind: 'jarvis-agent', objectId: '11111111-2222-4333-8444-555555555555', tenantId: config.auth.tenantId };
      if (token !== ownerToken) throw new Error('rejected');
      return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' };
    },
    toolCallStore: { record: async () => {} },
    piAuth: auth,
  });
  apps.push(app);
  let id = 0;
  async function tool(name: string, args: Record<string, unknown>) {
    id += 1;
    const response = await app.inject({
      method: 'POST', url: '/pi/mcp', remoteAddress: '10.0.0.9',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: bearer(`jp.${secret}`) },
      payload: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    });
    const line = response.body.split('\n').find((candidate) => candidate.startsWith('data:'))!;
    const text = JSON.parse(line.slice(5)).result.content[0].text as string;
    return JSON.parse(text) as { outcome: string; result: Record<string, unknown> };
  }
  const wake = () => registry.open({
    ownerObjectId: config.auth.ownerObjectId,
    sessionId: '',
    messageId: '',
    brain: {
      runId: 'run-1',
      sent: [],
      wrote: [],
      looked: [],
      evidence: [
        {
          source: 'factory',
          ref: 'github:workflow_run:42',
          identity: 'github:workflow_run:42',
          label: 'Deploy 42',
          observedAt: '2026-11-16T09:58:00.000Z',
          verifiedAt: '2026-11-16T09:59:00.000Z',
        },
        {
          source: 'mail',
          ref: 'gmail-message:9',
          identity: 'gmail-message:9',
          label: 'Work travel mail',
          observedAt: '2026-11-16T09:00:00.000Z',
          verifiedAt: '2026-11-16T09:01:00.000Z',
        },
      ],
    },
    signal: live(),
  });
  const chat = () => registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '41', signal: live() });
  return {
    app, registry, tool, wake, chat, vault, pushes, conversations, proactive,
    setSituationRefs(
      value: Array<Record<string, unknown>>,
      then: Array<Record<string, unknown>> = value,
    ) {
      const view = (refs: Array<Record<string, unknown>>) => ({
        ...emptySituation(),
        state: refs.length > 0 ? { refs, followUps: [] } : null,
      }) as Awaited<ReturnType<PiSituationService['read']>>;
      currentSituation = view(value);
      nextSituation = view(then);
    },
    currentMaterial: () => currentSituation.state?.refs[0]?.materialHash ?? null,
  };
}

describe('a brain wake over the Jarvis MCP server', () => {
  it('finds the chat tools and its own tools, and runs one without any owner message', async () => {
    const { tool, wake } = setup();
    const grant = wake();
    const found = await tool('find_tools', { turn: grant.turn, query: 'probe list_projects message note' });
    const names = [...(found.result.tools as Array<{ name: string }>), ...(found.result.otherMatches as Array<{ name: string }>)].map(({ name }) => name);
    expect(names).toContain('list_projects');
    expect(names).toContain('message_dan');
    expect(names).toContain('create_issue');
    const run = await tool('call_tool', { turn: grant.turn, name: 'list_projects', arguments: {} });
    expect(run.outcome).toBe('ok');
    expect(calls).toEqual(['list_projects:undefined:wake']);
  });

  it('runs a write tool in a wake as the PI agent, with no owner message and no approval step', async () => {
    const { tool, wake } = setup();
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'probe create_issue' });
    const done = await tool('call_tool', { turn: grant.turn, name: 'create_issue', arguments: {} });
    expect(done.outcome).toBe('ok');
    expect(calls).toEqual(['create_issue:undefined:wake']);
  });

  it('marks a chat turn as the PI agent\'s own call and keeps its owner message', async () => {
    const { tool, chat } = setup();
    const grant = chat();
    await tool('find_tools', { turn: grant.turn, query: 'probe list_projects' });
    await tool('call_tool', { turn: grant.turn, name: 'list_projects', arguments: {} });
    expect(calls).toEqual(['list_projects:41:turn']);
  });

  it('lets the wake message Dan and keep a note, and records both on the run', async () => {
    const { tool, wake, vault, pushes, conversations } = setup();
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'message note dan' });
    const sent = await tool('call_tool', {
      turn: grant.turn,
      name: 'message_dan',
      arguments: {
        text: 'The deploy failed.',
        category: 'status',
        suggestionScope: 'unknown',
        evidenceSources: ['factory'],
        evidence: [{
          source: 'factory', ref: 'github:workflow_run:42', identity: 'github:workflow_run:42',
          label: 'Deploy 42', observedAt: '2026-11-16T09:58:00.000Z',
          verifiedAt: '2026-11-16T09:59:00.000Z',
        }],
      },
    });
    expect(sent.outcome).toBe('ok');
    expect(pushes).toHaveLength(1);
    expect(conversations.messages.at(-1)).toMatchObject({ role: 'jarvis', model: 'pi' });
    const noted = await tool('call_tool', { turn: grant.turn, name: 'pi_note', arguments: { name: 'Deploys', text: 'Waiting for the next green run.' } });
    expect(noted.outcome).toBe('ok');
    expect(vault.files.get('PI/Notes/Deploys.md')).toContain('Waiting for the next green run.');
    expect(grant.brain!.sent.map(({ text }) => text)).toEqual(['The deploy failed.']);
    expect(grant.brain!.wrote).toEqual(['PI/Notes/Deploys.md']);
  });

  it('refuses a background message that violates disabled categories or scope before pushing', async () => {
    const { tool, wake, proactive, pushes } = setup();
    await proactive.settings.patch({ categories: { travel: false }, suggestionScope: 'personal' });
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'message dan' });
    const refused = await tool('call_tool', {
      turn: grant.turn,
      name: 'message_dan',
      arguments: {
        text: 'The work flight booking changed.',
        category: 'status',
        suggestionScope: 'work',
        evidenceSources: ['mail'],
        evidence: [{
          source: 'mail', ref: 'gmail-message:9', identity: 'gmail-message:9',
          label: 'Work travel mail', observedAt: '2026-11-16T09:00:00.000Z',
          verifiedAt: '2026-11-16T09:01:00.000Z',
        }],
      },
    });
    expect(refused).toMatchObject({ outcome: 'refused' });
    expect(pushes).toEqual([]);
  });

  it('refuses fabricated evidence that is not present in the wake authority', async () => {
    const { tool, wake, pushes } = setup();
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'message dan' });
    const refused = await tool('call_tool', {
      turn: grant.turn,
      name: 'message_dan',
      arguments: {
        text: 'The unrelated deploy failed.',
        category: 'status',
        suggestionScope: 'unknown',
        evidenceSources: ['factory'],
        evidence: [{
          source: 'factory',
          ref: 'github:workflow_run:999',
          identity: 'github:workflow_run:999',
          label: 'Invented deploy',
          observedAt: '2026-11-16T09:58:00.000Z',
          verifiedAt: '2026-11-16T09:59:00.000Z',
        }],
      },
    });
    expect(refused).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('does not match') },
    });
    expect(pushes).toEqual([]);
  });

  it('stores canonical server evidence instead of model-authored labels', async () => {
    const { tool, wake, conversations } = setup();
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'message dan' });
    const sent = await tool('call_tool', {
      turn: grant.turn,
      name: 'message_dan',
      arguments: {
        text: 'The deploy failed.',
        category: 'status',
        suggestionScope: 'unknown',
        evidenceSources: ['factory'],
        evidence: [{
          source: 'factory',
          ref: 'github:workflow_run:42',
          identity: 'github:workflow_run:42',
          label: 'A model-written label with invented detail',
          observedAt: '2026-11-16T09:58:00.000Z',
          verifiedAt: '2026-11-16T09:59:00.000Z',
        }],
      },
    });
    expect(sent.outcome).toBe('ok');
    expect([...conversations.proactiveReceipts.values()][0]?.evidence).toEqual([{
      source: 'factory',
      ref: 'github:workflow_run:42',
      identity: 'github:workflow_run:42',
      label: 'Deploy 42',
      observedAt: '2026-11-16T09:58:00.000Z',
      verifiedAt: '2026-11-16T09:59:00.000Z',
      origin: 'event',
      materialHash: null,
    }]);
  });

  it('refuses wake evidence that predates a source disable epoch even after re-enable', async () => {
    const { tool, wake, proactive, pushes } = setup();
    await proactive.settings.patch({ sources: { factory: false } });
    await proactive.settings.patch({ sources: { factory: true } });
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'message dan' });
    const refused = await tool('call_tool', {
      turn: grant.turn,
      name: 'message_dan',
      arguments: {
        text: 'The old deploy event failed.',
        category: 'status',
        suggestionScope: 'unknown',
        evidenceSources: ['factory'],
        evidence: [{
          source: 'factory',
          ref: 'github:workflow_run:42',
          identity: 'github:workflow_run:42',
          label: 'Deploy 42',
          observedAt: '2026-11-16T09:58:00.000Z',
          verifiedAt: '2026-11-16T09:59:00.000Z',
        }],
      },
    });
    expect(refused).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('The factory evidence was verified before that source was last switched off') },
    });
    expect(pushes).toEqual([]);
    // Only evidence the server really offered gets that explanation; a made-up tuple is still told it does not match.
    const invented = await tool('call_tool', {
      turn: grant.turn,
      name: 'message_dan',
      arguments: {
        text: 'The invented deploy event failed.',
        category: 'status',
        suggestionScope: 'unknown',
        evidenceSources: ['factory'],
        evidence: [{
          source: 'factory',
          ref: 'github:workflow_run:999',
          identity: 'github:workflow_run:999',
          label: 'Invented deploy',
          observedAt: '2026-11-16T09:58:00.000Z',
          verifiedAt: '2026-11-16T09:59:00.000Z',
        }],
      },
    });
    expect(invented).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('does not match') },
    });
    expect(pushes).toEqual([]);
  });

  it('refuses a mid-wake situation generation change at the atomic Chat receipt boundary', async () => {
    const {
      tool,
      wake,
      pushes,
      conversations,
      setSituationRefs,
      currentMaterial,
    } = setup();
    const oldRef = {
      id: 'calendar:flight',
      source: 'calendar',
      identity: 'calendar-event:flight',
      label: 'Flight',
      observedAt: '2026-11-16T09:00:00.000Z',
      verifiedAt: '2026-11-16T09:58:00.000Z',
      materialHash: 'a'.repeat(64),
    };
    const newRef = {
      ...oldRef,
      verifiedAt: '2026-11-16T09:59:00.000Z',
      materialHash: 'b'.repeat(64),
    };
    setSituationRefs([oldRef], [newRef]);
    const store = conversations.store as typeof conversations.store & {
      addProactiveMessage: NonNullable<typeof conversations.store.addProactiveMessage>;
    };
    const addProactiveMessage = store.addProactiveMessage;
    store.addProactiveMessage = async (input) => {
      const situationEvidence = input.evidence.find(({ origin }) => origin === 'situation');
      if (situationEvidence?.materialHash !== currentMaterial()) {
        throw new BrainCommsRefusal(
          'The situation evidence generation changed before delivery. Nothing was sent.',
        );
      }
      return addProactiveMessage(input);
    };
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'message dan' });
    const refused = await tool('call_tool', {
      turn: grant.turn,
      name: 'message_dan',
      arguments: {
        text: 'The old flight generation changed.',
        category: 'status',
        suggestionScope: 'unknown',
        evidenceSources: ['calendar'],
        evidence: [{
          source: 'calendar',
          ref: oldRef.id,
          identity: oldRef.identity,
          label: 'Invented label is canonicalised',
          observedAt: oldRef.observedAt,
          verifiedAt: oldRef.verifiedAt,
        }],
      },
    });
    expect(refused).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('generation changed') },
    });
    expect(pushes).toEqual([]);
    expect(conversations.proactiveReceipts.size).toBe(0);
  });

  it.each([
    { text: 'The deploy job failed on main.', declared: 'unknown', reads: 'work', word: 'job' },
    { text: 'The home page deploy failed on main.', declared: 'work', reads: 'personal', word: 'home' },
  ])('names the scope it read and the word behind it when the declared scope differs: "$word"', async ({ text, declared, reads, word }) => {
    const { tool, wake, pushes } = setup();
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'message dan' });
    const refused = await tool('call_tool', {
      turn: grant.turn,
      name: 'message_dan',
      arguments: {
        text,
        category: 'status',
        suggestionScope: declared,
        evidenceSources: ['factory'],
        evidence: [{
          source: 'factory', ref: 'github:workflow_run:42', identity: 'github:workflow_run:42',
          label: 'Deploy 42', observedAt: '2026-11-16T09:58:00.000Z',
          verifiedAt: '2026-11-16T09:59:00.000Z',
        }],
      },
    });
    expect(refused).toMatchObject({
      outcome: 'refused',
      result: {
        refused: `The message reads as ${reads} because it says "${word}", but its scope was declared ${declared}. Declare ${reads} or reword the message. Nothing was sent.`,
      },
    });
    expect(pushes).toEqual([]);
  });

  it.each([
    { number: 51002, says: 'The evidence behind this message changed just before delivery.' },
    { number: 51001, says: 'Another message to Dan was still being delivered.' },
  ])('tells the brain in words when the chat store throws SQL error $number, not "Tool execution failed"', async ({ number, says }) => {
    const { tool, wake, pushes, conversations } = setup();
    (conversations.store as { addProactiveMessage: unknown }).addProactiveMessage =
      async () => { throw Object.assign(new Error('SQL text that must not reach the brain'), { number }); };
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'message dan' });
    const refused = await tool('call_tool', {
      turn: grant.turn,
      name: 'message_dan',
      arguments: {
        text: 'The deploy failed.',
        category: 'status',
        suggestionScope: 'unknown',
        evidenceSources: ['factory'],
        evidence: [{
          source: 'factory', ref: 'github:workflow_run:42', identity: 'github:workflow_run:42',
          label: 'Deploy 42', observedAt: '2026-11-16T09:58:00.000Z',
          verifiedAt: '2026-11-16T09:59:00.000Z',
        }],
      },
    });
    expect(refused).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining(says) },
    });
    expect(JSON.stringify(refused)).not.toContain('SQL text');
    expect(pushes).toEqual([]);
  });

  it.each([
    {
      ref: 'github:workflow_run:42',
      identity: 'github:workflow_run:999',
    },
    {
      ref: 'github:workflow_run:999',
      identity: 'github:workflow_run:42',
    },
  ])('refuses evidence that combines a known identifier with a fabricated field: $ref / $identity', async ({
    ref,
    identity,
  }) => {
    const { tool, wake, pushes } = setup();
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'message dan' });
    const refused = await tool('call_tool', {
      turn: grant.turn,
      name: 'message_dan',
      arguments: {
        text: 'The unrelated deploy failed.',
        category: 'status',
        suggestionScope: 'unknown',
        evidenceSources: ['factory'],
        evidence: [{
          source: 'factory',
          ref,
          identity,
          label: 'Deploy 42',
          observedAt: '2026-11-16T09:58:00.000Z',
          verifiedAt: '2026-11-16T09:59:00.000Z',
        }],
      },
    });
    expect(refused).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('does not match') },
    });
    expect(pushes).toEqual([]);
  });

  it('never lets a note leave PI\'s corner of the vault or carry a credential', async () => {
    const { tool, wake, vault } = setup();
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'note' });
    for (const name of ['../Inbox/x', 'a/b', '.hidden', 'x#y']) {
      expect((await tool('call_tool', { turn: grant.turn, name: 'pi_note', arguments: { name, text: 'x' } })).outcome).toBe('refused');
    }
    const secretNote = await tool('call_tool', { turn: grant.turn, name: 'pi_note', arguments: { name: 'Keys', text: 'token ghp_' + 'A'.repeat(36) } });
    expect(secretNote.outcome).toBe('refused');
    expect([...vault.files.keys()]).toEqual([]);
  });
});

describe('GitHub through the Jarvis door', () => {
  const ghTool = { name: 'gh_issue_write', description: 'GitHub: Create or update an issue', inputSchema: { type: 'object' }, moduleId: 'github', execute: async () => ({}) };
  const bridge = () => {
    const called: string[] = [];
    const github: RemoteMcpBridge = {
      prefix: 'gh_', label: 'GitHub', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [ghTool],
      call: async (name, args) => { called.push(`${name}:${JSON.stringify(args)}`); return { outcome: 'ok', result: { number: 7 } }; },
    };
    return { github, called };
  };

  it('finds a GitHub tool next to the Jarvis ones and runs it for a chat turn and a wake, with no owner message', async () => {
    const { github, called } = bridge();
    const { tool, chat, wake } = setup(github);
    for (const grant of [chat(), wake()]) {
      const found = await tool('find_tools', { turn: grant.turn, query: 'github issue write' });
      expect((found.result.tools as Array<{ name: string }>).map(({ name }) => name)).toContain('gh_issue_write');
      const done = await tool('call_tool', { turn: grant.turn, name: 'gh_issue_write', arguments: { title: 'x' } });
      expect(done).toMatchObject({ outcome: 'ok', result: { number: 7 } });
      expect(grant.results).toEqual([{ tool: 'gh_issue_write', outcome: 'ok' }]);
    }
    expect(called).toEqual(['gh_issue_write:{"title":"x"}', 'gh_issue_write:{"title":"x"}']);
  });

  it('routes each remote tool to its own server by prefix', async () => {
    const calls: string[] = [];
    const make = (prefix: string, name: string): RemoteMcpBridge => ({
      prefix, label: prefix, status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [{ name: `${prefix}${name}`, description: `${prefix} tool ${name}`, inputSchema: { type: 'object' }, moduleId: 'remote', execute: async () => ({}) }],
      call: async (called) => { calls.push(called); return { outcome: 'ok', result: { from: prefix } }; },
    });
    const { tool, wake } = setup(make('gh_', 'issue_write'), make('az_', 'group_list'));
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'gh_issue_write az_group_list' });
    expect(await tool('call_tool', { turn: grant.turn, name: 'az_group_list', arguments: {} })).toMatchObject({ outcome: 'ok', result: { from: 'az_' } });
    expect(await tool('call_tool', { turn: grant.turn, name: 'gh_issue_write', arguments: {} })).toMatchObject({ result: { from: 'gh_' } });
    expect(calls).toEqual(['az_group_list', 'gh_issue_write']);
  });

  it('refuses a GitHub tool that was not looked up first, and is absent without a token', async () => {
    const { github, called } = bridge();
    const { tool, chat } = setup(github);
    const grant = chat();
    expect((await tool('call_tool', { turn: grant.turn, name: 'gh_issue_write', arguments: {} })).outcome).toBe('refused');
    expect(called).toEqual([]);
    const without = setup();
    const other = without.chat();
    const found = await without.tool('find_tools', { turn: other.turn, query: 'github issue write' });
    expect(JSON.stringify(found.result)).not.toContain('gh_issue_write');
  });
});

describe('chat and the brain stay apart', () => {
  it('hides the brain tools from a chat turn and refuses them if named anyway', async () => {
    const { tool, chat } = setup();
    const grant = chat();
    const found = await tool('find_tools', { turn: grant.turn, query: 'message note dan' });
    expect((found.result.tools as Array<{ name: string }> | undefined ?? []).map(({ name }) => name)).not.toContain('message_dan');
    grant.discovered.add('message_dan');
    expect((await tool('call_tool', { turn: grant.turn, name: 'message_dan', arguments: { text: 'hi' } })).outcome).toBe('refused');
  });

  it('refuses the brain and PI headers on the tool route for anyone but the PI agent, and brain tools outside a live wake', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'POST', url: '/tools/list_projects', payload: {},
      headers: { authorization: bearer(ownerToken), 'content-type': 'application/json', 'x-jarvis-brain': 'run-1' },
    });
    expect(response.statusCode).toBe(403);
    const message = await app.inject({
      method: 'POST', url: '/tools/message_dan',
      payload: {
        text: 'hi',
        category: 'status',
        suggestionScope: 'unknown',
        evidenceSources: ['factory'],
        evidence: [{
          source: 'factory', ref: 'factory:test', identity: 'factory:test',
          label: 'Factory event', observedAt: '2026-11-16T10:00:00.000Z',
          verifiedAt: '2026-11-16T10:00:00.000Z',
        }],
      },
      headers: { authorization: bearer(ownerToken), 'content-type': 'application/json', 'x-jarvis-brain': 'run-1' },
    });
    expect(message.statusCode).toBe(403);
    const pi = await app.inject({
      method: 'POST', url: '/tools/list_projects', payload: {},
      headers: { authorization: bearer(ownerToken), 'content-type': 'application/json', 'x-jarvis-pi': 'wake' },
    });
    expect(pi.statusCode).toBe(403);
    // Another agent identity is not the PI door: it cannot claim a wake either.
    const other = await app.inject({
      method: 'POST', url: '/tools/list_projects', payload: {},
      headers: { authorization: bearer('agent.token.fixture'), 'content-type': 'application/json', 'x-jarvis-pi': 'wake', 'x-jarvis-brain': 'run-1' },
    });
    expect(other.statusCode).toBe(403);
  });
});
