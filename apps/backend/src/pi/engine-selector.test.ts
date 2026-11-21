import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createPiAuth, piMcpPath } from '../auth/pi-credential.js';
import { loadConfig } from '../config.js';
import { createConversationModule } from '../core/conversation.js';
import type { ConversationAgent } from '../core/chat-agent.js';
import { failureCopy } from '@jarvis/contracts';
import type { ConversationMessage, ConversationStore } from '../core/conversation-store.js';
import { PiGatewayError } from './errors.js';
import { createPiGateway, createUnconfiguredPiAgent } from './gateway.js';
import { azureToolPrefix, createRemoteMcpBridge } from './remote-mcp.js';
import { createPiRoutes, type PiModuleOptions } from './routes.js';
import { createMemoryPiStore } from './store.js';
import { createPiTurnRegistry, piTurnPattern } from './turns.js';
import type { PiActivationService } from './activation.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function setup(options: { piAgent?: ConversationAgent; pi?: PiModuleOptions; runtimeTest?: string } = {}) {
  const messages: ConversationMessage[] = [];
  const piAgent = options.pi?.gateway ?? options.piAgent;
  const store = {
    getSession: async (id: string) => ({ id, channel: 'chat', language: 'en', startedAt: new Date(), endedAt: null, ...(options.runtimeTest ? { runtimeTest: options.runtimeTest } : {}) }),
    addMessage: async (input: { sessionId: string; role: 'dan' | 'jarvis'; text: string; model: string | null }) => {
      const message = { id: String(messages.length + 1), sessionId: input.sessionId, role: input.role, text: input.text, model: input.model, at: new Date() };
      messages.push(message);
      return message;
    },
    getDanMessagesAfter: async () => [],
    getDanMessageIdBySourceItemId: async () => null,
    readRecentUserMessages: async () => [],
  } as unknown as ConversationStore;
  const current: ConversationAgent = { stream: async function* () { yield 'from the current engine'; } };
  const app = buildApp(config, undefined, {
    modules: [createConversationModule(), ...(options.pi
      ? [{ id: 'pi', tools: [], registerRoutes: createPiRoutes(options.pi) }] : [])],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' }),
    conversationStore: store, conversationAgent: current,
    ...(piAgent ? { piAgent } : {}),
    ...(options.pi ? { piAuth: options.pi.auth } : {}),
  });
  apps.push(app);
  const turn = async (payload: Record<string, unknown>) => {
    const response = await app.inject({
      method: 'POST', url: '/conversation/sessions/7/turns', payload,
      headers: { authorization: 'Bearer a.b.c', 'content-type': 'application/json' },
    });
    const events = response.statusCode !== 200 ? [] : response.body.split('\n\n').filter(Boolean).map((frame) => ({
      name: /^event: (.*)$/mu.exec(frame)![1]!, data: JSON.parse(/^data: (.*)$/mu.exec(frame)![1]!) as Record<string, unknown>,
    }));
    return { status: response.statusCode, events };
  };
  return { app, turn, messages };
}

it('answers the iPhone Azure question through PI MCP in a reused owner conversation when its context changes', async () => {
  const registry = createPiTurnRegistry();
  const store = createMemoryPiStore();
  let activationSequence = 0;
  const activations: PiActivationService = {
    situation: {} as never,
    async begin(input) {
      activationSequence += 1;
      const id = `00000000-0000-4000-8000-${String(activationSequence).padStart(12, '0')}`;
      const grant = registry.open({
        ownerObjectId: input.ownerObjectId, sessionId: input.sessionId, messageId: input.messageId,
        ...(input.brain ? { brain: input.brain } : {}), signal: input.signal,
        activation: {
          id, type: input.type, source: input.source, slotKey: input.slotKey ?? null,
          stateRevision: 0, stateHash: null, policyRevision: 'a'.repeat(64), staleSources: 0, disabledSources: [],
        },
      });
      return {
        grant, context: '', situation: {
          state: null, revision: 0, hash: null, policyRevision: 'a'.repeat(64),
          staleSources: [], missingSources: [], disabledSources: [], freshSources: [], asOf: null, updatedAt: null, lastActivation: null,
        },
      };
    },
    async failed() {},
  };
  const owner = config.auth.ownerObjectId;
  await store.bindConversation(owner, 'jarvis-pi', 'existing-pi-conversation', AbortSignal.timeout(1_000));
  const secret = 'A'.repeat(43);
  const auth = createPiAuth(config.auth.tenantId, secret);
  const catalogue = { name: 'group_resource_list', description: 'List resources in an Azure resource group', inputSchema: { type: 'object' } };
  const remoteCalls: unknown[] = [];
  const bridge = createRemoteMcpBridge({
    url: 'https://azure.example/mcp', prefix: azureToolPrefix, label: 'Azure', token: async () => 'fixture',
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string; params?: unknown };
      if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (request.method === 'tools/call') remoteCalls.push(request.params);
      const result = request.method === 'tools/list' ? { tools: [catalogue] }
        : request.method === 'tools/call' ? { content: [{ type: 'text', text: 'fixture-storage, fixture-app' }] }
          : { protocolVersion: '2025-06-18', capabilities: {} };
      return Response.json({ jsonrpc: '2.0', id: request.id, result });
    },
  });
  let context = 'Old environment context';
  const logs: Array<Record<string, unknown>> = [];
  const sse = (delta: string) => new Response(
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta })}\n\ndata: {"type":"response.completed","response":{}}\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );
  const gateway = createPiGateway({
    agentName: 'jarvis-pi', projectEndpoint: 'https://foundry.example/api/projects/jarvis',
    owner, store, registry, activations, monthlyCapDkk: 250, timeZone: 'Europe/Copenhagen',
    getToken: async () => 'fixture', context: async () => context,
    log: (event, fields) => { if (event === 'pi.turn') logs.push(fields); },
    fetcher: async (url, init) => {
      expect(String(url)).toContain('/agents/jarvis-pi/endpoint/protocols/openai/responses');
      const request = JSON.parse(String(init?.body)) as { conversation: string; input: Array<{ content: string }> };
      expect(request.conversation).toBe('existing-pi-conversation');
      const text = request.input[0]!.content;
      if (text.endsWith('\nhello')) return sse('Hello.');
      expect(text).toContain(context);
      expect(text).toMatch(/\nwhat's in my Jarvis resource group\?$/u);
      // The managed instructions take the reference from the first line, not from context or the history.
      const turn = /^\[Turn (\S+) \| /u.exec(text)?.[1];
      if (!turn || !piTurnPattern.test(turn)) return sse('I do not have a valid tool reference.');
      expect(registry.resolve(turn)).toMatchObject({ messageId: '3', sessionId: '7' });
      expect(registry.resolve(turn)?.smoke).toBeUndefined();
      const find = await mcp('find_tools', { turn, query: 'azure resource group' });
      expect(find.result.tools).toContainEqual(expect.objectContaining({ name: 'az_group_resource_list' }));
      const call = await mcp('call_tool', {
        turn, name: 'az_group_resource_list', arguments: { subscription: 'fixture-subscription', resource_group: 'fixture-rg' },
      });
      expect(call.outcome).toBe('ok');
      return sse(call.result);
    },
  });
  const { app, messages, turn } = setup({ pi: { gateway, registry, auth, monthlyCapDkk: 250, bridges: [bridge] } });
  async function mcp(name: string, args: Record<string, unknown>) {
    const response = await app.inject({
      method: 'POST', url: piMcpPath,
      headers: { authorization: `Bearer jp.${secret}`, accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
    expect(response.statusCode).toBe(200);
    const body = response.body.split('\n').find(line => line.startsWith('data:'))?.slice(5) ?? response.body;
    return JSON.parse(JSON.parse(body).result.content[0].text);
  }
  await turn({ engine: 'pi', text: 'hello' });
  context = 'Updated environment note: subscription fixture-subscription, resource group fixture-rg';
  const answer = await turn({ engine: 'pi', text: "what's in my Jarvis resource group?" });
  expect(answer.events.map(event => event.name)).toEqual(['user', 'delta', 'done']);
  expect(answer.events[1]?.data.text).toBe('fixture-storage, fixture-app');
  expect(messages.at(-1)).toMatchObject({ role: 'jarvis', model: 'pi', text: 'fixture-storage, fixture-app' });
  expect(remoteCalls).toEqual([{ name: 'group_resource_list', arguments: { subscription: 'fixture-subscription', resource_group: 'fixture-rg' } }]);
  expect(logs[0]).toMatchObject({ azureCatalogue: 'not_searched', azureToolsOffered: 0, azureCalls: { attempts: 0, ok: 0, refused: 0, error: 0 } });
  expect(logs[1]).toMatchObject({ azureCatalogue: 'ready', azureToolsOffered: 1, azureCalls: { attempts: 1, ok: 1, refused: 0, error: 0 } });
  expect(JSON.stringify(logs)).not.toMatch(/jt-|fixture-|resource group/iu);
});

describe('PI is the default engine on the chat turn', () => {
  it('runs a turn without an engine on PI', async () => {
    const { turn, messages } = setup({ piAgent: { stream: async function* () { yield 'from PI'; } } });
    const result = await turn({ text: 'hi' });
    expect(result.events.map((event) => event.name)).toEqual(['user', 'delta', 'done']);
    expect(result.events[1]!.data.text).toBe('from PI');
    expect(messages.at(-1)).toMatchObject({ role: 'jarvis', model: 'pi' });
  });

  it('refuses the obsolete Current engine selection', async () => {
    const { turn, messages } = setup({ piAgent: { stream: async function* () { yield 'from PI'; } } });
    const result = await turn({ text: 'hi', engine: 'current' });
    expect(result.status).toBe(400);
    expect(messages).toEqual([]);
  });

  it('keeps an isolated runtime-test session on its selected runtime and rejects explicit PI', async () => {
    let piCalls = 0;
    const { turn } = setup({ piAgent: { stream: async function* () { piCalls += 1; yield 'from PI'; } }, runtimeTest: 'current' });
    const result = await turn({ text: 'hi' });
    expect(result.status).toBe(200);
    expect(result.events[1]!.data.text).toBe('from the current engine');
    expect((await turn({ text: 'hi', engine: 'pi' })).status).toBe(400);
    expect(piCalls).toBe(0);
  });

  it('accepts an older client that explicitly names PI and labels the saved reply', async () => {
    const seen: Array<{ messageId: string; sessionId?: string }> = [];
    const { turn, messages } = setup({
      piAgent: { stream: async function* (input) { seen.push({ messageId: input.messageId, ...(input.sessionId ? { sessionId: input.sessionId } : {}) }); yield 'from PI'; } },
    });
    const result = await turn({ text: 'hi', engine: 'pi' });
    expect(result.events.map((event) => event.name)).toEqual(['user', 'delta', 'done']);
    expect(result.events[1]!.data.text).toBe('from PI');
    expect(seen).toEqual([{ messageId: '1', sessionId: '7' }]);
    expect(messages.at(-1)).toMatchObject({ role: 'jarvis', text: 'from PI', model: 'pi' });
  });

  it('does not fall back when PI is the default and is not set up', async () => {
    const { turn, messages } = setup();
    const result = await turn({ text: 'hi' });
    expect(result.events.map((event) => event.name)).toEqual(['user', 'error']);
    expect(result.events[1]!.data).toMatchObject({ code: 'pi_not_configured', error: failureCopy.not_set_up.chat });
    expect(messages.filter((message) => message.role === 'jarvis')).toEqual([]);
  });

  it('passes a PI budget stop to the app as a coded, plain error', async () => {
    const { turn } = setup({
      // eslint-disable-next-line require-yield
      piAgent: { stream: async function* () { throw new PiGatewayError('pi_budget_exhausted', 'allowance_used', { detail: 'spent_250.00_of_250_dkk' }); } },
    });
    const result = await turn({ text: 'hi', engine: 'pi' });
    expect(result.events.at(-1)).toEqual({ name: 'error', data: { error: failureCopy.allowance_used.chat, code: 'pi_budget_exhausted' } });
  });

  it('rejects Current and every engine other than PI', async () => {
    const { turn } = setup();
    expect((await turn({ text: 'hi', engine: 'copilot' })).status).toBe(400);
    expect((await turn({ text: 'hi', engine: 'current' })).status).toBe(400);
  });

  it('ends an unexpected failure with one plain sentence and no technical text or code', async () => {
    const { turn, messages } = setup({
      // eslint-disable-next-line require-yield
      piAgent: { stream: async function* () { throw new Error('select * from secrets where token = abc'); } },
    });
    const result = await turn({ text: 'hi' });
    expect(result.events.map((event) => event.name)).toEqual(['user', 'error']);
    expect(result.events[1]!.data).toEqual({ error: failureCopy.cut_off.chat });
    expect(messages.filter((message) => message.role === 'jarvis')).toEqual([]);
  });

  it('says plainly that no answer came back instead of a technical message', async () => {
    const { turn, messages } = setup({ piAgent: { stream: async function* () { yield '   '; } } });
    const result = await turn({ text: 'hi' });
    expect(result.events.at(-1)).toEqual({ name: 'error', data: { error: failureCopy.no_reply.chat } });
    expect(messages.filter((message) => message.role === 'jarvis')).toEqual([]);
  });

  it('sends the plain sentence of every kind of PI failure with its stable code and nothing technical', async () => {
    for (const [code, kind] of [
      ['pi_unavailable', 'unreachable'], ['pi_timeout', 'took_too_long_clean'], ['pi_failed', 'cut_off'], ['pi_unsupported', 'cannot_see_frame'],
    ] as const) {
      const { turn } = setup({
        // eslint-disable-next-line require-yield
        piAgent: { stream: async function* () { throw new PiGatewayError(code, kind, { detail: 'http_503' }); } },
      });
      const result = await turn({ text: 'hi' });
      expect(result.events.at(-1)).toEqual({ name: 'error', data: { error: failureCopy[kind].chat, code } });
    }
  });

  it('exposes the unconfigured agent as an error, not as a reply', async () => {
    await expect(createUnconfiguredPiAgent().stream({ messageId: '1', text: 'x' }, 'a', new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toMatchObject({ code: 'pi_not_configured' });
  });
});
