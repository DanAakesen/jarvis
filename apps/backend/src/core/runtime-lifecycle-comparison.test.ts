import type { ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logging.js';
import { GMAIL_DIRECT_ACCESS_REASON } from './gmail-access-policy.js';
import { coreModule } from './index.js';
import { createConversationModule } from './conversation.js';
import { createFoundryInvocationConversationAgent, type ConversationAgent } from './chat-agent.js';
import type { ConversationHistoryMessage, ConversationSession, ConversationStore } from './conversation-store.js';
import type { RuntimeTest } from './runtime-session.js';

const config = loadConfig({});
const headers = { authorization: 'Bearer owner.fixture.token' };
const agentHeaders = { authorization: 'Bearer agent.fixture.token' };
const at = new Date('2026-10-29T12:00:00Z');
const apps: ReturnType<typeof buildApp>[] = [];
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const json = (body: string) => JSON.parse(body) as Record<string, unknown>;

afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

function fixture(runtime: RuntimeTest, provider: (request: {
  payload: Record<string, unknown>;
  signal: AbortSignal;
  emit: (event: string, data: unknown) => void;
  finish: () => void;
}) => Promise<void>) {
  let session: ConversationSession | null = null;
  let sequence = 41;
  const messages: ConversationHistoryMessage[] = [];
  const storedReply = Promise.withResolvers<void>();
  const toolExecutions = vi.fn(async () => ({ fixture: 'read-only result' }));
  const noopActions = vi.fn(async () => ({ noop: true }));
  const store: ConversationStore = {
    createSession: async input => (session = { id: '41', channel: input.channel, language: input.language,
      startedAt: at, endedAt: null, ...(input.runtimeTest ? { runtimeTest: input.runtimeTest } : {}) }),
    getSession: async id => session?.id === id ? session : null,
    endSession: async () => true,
    addMessage: async input => {
      const message: ConversationHistoryMessage = { id: String(++sequence), sessionId: input.sessionId,
        role: input.role, text: input.text, model: input.model, at, channel: 'chat',
        language: input.language ?? 'en', interrupted: input.interrupted ?? false,
        voiceMinutes: null, toolCalls: [], attachments: [] };
      messages.push(message);
      if (message.role === 'jarvis' && !message.interrupted) storedReply.resolve();
      return message;
    },
    getMessageSessionId: async id => messages.find(message => message.id === id)?.sessionId ?? null,
    getDanMessageIdBySourceItemId: async () => null,
    readRecentUserMessages: async () => [],
    getHistory: async input => ({ messages: messages.filter(message =>
      (input.sessionId ? message.sessionId === input.sessionId :
        !('excludeRuntimeTests' in input && input.excludeRuntimeTests === true) || session?.runtimeTest === undefined) &&
      (!input.before || BigInt(message.id) < BigInt(input.before))).slice().reverse().slice(0, input.limit), nextCursor: null }),
    getDanMessagesAfter: async input => messages.filter(message => message.role === 'dan' &&
      message.sessionId === input.sessionId && BigInt(message.id) > BigInt(input.after)).slice(0, input.limit)
      .map(message => ({ id: message.id, text: message.text, language: message.language })),
  };
  const invocations: { runtime: RuntimeTest; payload: Record<string, unknown>; signal: AbortSignal }[] = [];
  const agents = Object.fromEntries((['current', 'copilot'] as const).map(selected => [selected,
    createFoundryInvocationConversationAgent('https://fixture.services.ai.azure.com/api/projects/fixture', selected,
      async () => 'synthetic-foundry-token', async (_url, init) => {
        const payload = json(String(init?.body));
        const signal = init!.signal!;
        invocations.push({ runtime: selected, payload, signal });
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            let ended = false;
            const finish = () => { if (!ended) { ended = true; controller.close(); } };
            const abort = () => { if (!ended) { ended = true; controller.error(new DOMException('Steered', 'AbortError')); } };
            signal.addEventListener('abort', abort, { once: true });
            void provider({ payload, signal,
              emit: (event, data) => { if (!ended) controller.enqueue(new TextEncoder().encode(frame(event, data))); },
              finish,
            }).catch(error => { if (!ended) { ended = true; controller.error(error); } })
              .finally(() => signal.removeEventListener('abort', abort));
          },
        }), { headers: { 'content-type': 'text/event-stream' } });
      })]));
  const conversationAgent: ConversationAgent = {
    stream(input, authorization, signal) {
      // Synthetic dispatch uses persisted source/session metadata, never a user turn override.
      const source = messages.find(message => message.id === input.messageId);
      if (!source || source.sessionId !== session?.id || session.runtimeTest !== runtime) throw new Error('Invalid fixture source');
      return agents[session.runtimeTest]!.stream(input, authorization, signal);
    },
  };
  const app = buildApp(config, createLogger(config, undefined, new Writable({ write(_chunk, _encoding, done) { done(); } })), {
    conversationStore: store, conversationAgent,
    conversationRuntimeTests: async () => ({ current: { available: true }, copilot: { available: true } }),
    auth: async token => token === 'agent.fixture.token'
      ? { kind: 'jarvis-agent' as const, objectId: 'fixture-agent', tenantId: config.auth.tenantId }
      : { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Fixture owner' },
    toolCallStore: { record: async () => {} },
    modules: [coreModule, createConversationModule(), { id: 'lifecycle-fixture', registerRoutes: async () => {}, tools: [
      { name: 'lifecycle_read', description: 'Synthetic read only', execution: { defaultEffect: 'read' },
        inputSchema: { type: 'object', additionalProperties: false }, execute: toolExecutions },
      { name: 'pc_open', description: 'Synthetic no-op computer action', execution: { defaultEffect: 'action' },
        inputSchema: { type: 'object', properties: { target: { type: 'string' }, value: { type: 'string' } }, additionalProperties: false }, execute: noopActions },
    ] }],
  });
  apps.push(app);
  const create = async () => {
    const response = await app.inject({ method: 'POST', url: '/conversation/sessions', headers,
      payload: { channel: 'chat', language: 'en', runtimeTest: runtime } });
    expect(response.statusCode).toBe(201);
    expect(response.json().runtimeTest).toBe(runtime);
  };
  return { app, create, messages, invocations, toolExecutions, noopActions, storedReply };
}

async function readThroughDelta(response: Response) {
  const reader = response.body!.getReader();
  let body = '';
  while (!body.includes('event: delta')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('Ended before the controlled execution barrier');
    body += new TextDecoder().decode(chunk.value);
  }
  return reader;
}

describe.each(['current', 'copilot'] as const)('%s identical application lifecycle scenarios (synthetic provider)', runtime => {
  it('detaches a live HTTP subscriber, completes one read, and reattaches the retained result without rerunning it', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const detached = Promise.withResolvers<void>();
    const f = fixture(runtime, async ({ payload, signal, emit, finish }) => {
      emit('delta', { text: 'Reading synthetic fixture. ' });
      started.resolve();
      await release.promise;
      expect(signal.aborted).toBe(false);
      const tool = await f.app.inject({ method: 'POST', url: '/tools/lifecycle_read',
        headers: { ...agentHeaders, 'x-jarvis-message-id': String(payload.messageId) }, payload: {} });
      expect(tool.json().outcome).toBe('ok');
      emit('delta', { text: 'Read complete.' }); emit('done', {}); finish();
    });
    let originalResponse: ServerResponse | undefined;
    f.app.addHook('onRequest', async (request, reply) => {
      if (request.method === 'POST' && request.url.endsWith('/turns')) {
        originalResponse = reply.raw;
        reply.raw.once('close', () => detached.resolve());
      }
    });
    await f.create();
    const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
    const connection = new AbortController();
    const response = await fetch(`${address}/conversation/sessions/41/turns`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Read the synthetic fixture.' }), signal: connection.signal,
    });
    expect(response.status).toBe(200);
    const reader = await readThroughDelta(response);
    await started.promise;
    connection.abort(); originalResponse!.destroy(); await reader.cancel().catch(() => {});
    await detached.promise;
    expect(f.invocations[0]!.signal.aborted).toBe(false);
    release.resolve(); await f.storedReply.promise;
    for (let replay = 0; replay < 2; replay++) {
      const reattached = await f.app.inject({ url: '/conversation/sessions/41/turns/42/events', headers });
      expect(reattached.statusCode).toBe(200);
      expect(reattached.body).toContain('event: done');
      expect(reattached.body).toContain('Read complete.');
    }
    expect(f.toolExecutions).toHaveBeenCalledTimes(1);
    expect(f.invocations.map(invocation => invocation.runtime)).toEqual([runtime]);
    expect(f.messages.filter(message => message.role === 'jarvis')).toHaveLength(1);
    const normalRecovery = await f.app.inject({ url: '/conversation/turns/active', headers });
    expect(normalRecovery.json()).toEqual({ turns: [] });
  });

  it('interrupts a live model stream and binds its replacement to the newly stored steering source', async () => {
    const started = Promise.withResolvers<void>();
    const oldRoundStopped = Promise.withResolvers<void>();
    const f = fixture(runtime, async ({ payload, signal, emit, finish }) => {
      if (payload.messageId === '42') {
        emit('delta', { text: 'Old partial reply.' });
        started.resolve();
        await new Promise<void>(resolve => signal.addEventListener('abort', () => { oldRoundStopped.resolve(); resolve(); }, { once: true }));
        return;
      }
      expect(payload).toMatchObject({ messageId: '43', turnId: '42', text: 'Read Gmail only; do not open any app.', steering: true });
      // Actual tool authorization sees the later stored source; neither source may acquire permission by replay.
      for (const source of ['42', '43']) {
        const action = await f.app.inject({ method: 'POST', url: '/tools/pc_open',
          headers: { ...agentHeaders, 'x-jarvis-message-id': source }, payload: { target: 'app', value: 'Spotify' } });
        expect(action.statusCode).toBe(200);
        expect(action.json()).toMatchObject({ outcome: 'refused', result: { refused: source === '42'
          ? 'The current Dan message could not be verified for computer use.' : GMAIL_DIRECT_ACCESS_REASON } });
      }
      emit('delta', { text: 'New source acknowledged; no app opened.' }); emit('done', {}); finish();
    });
    await f.create();
    const turn = f.app.inject({ method: 'POST', url: '/conversation/sessions/41/turns', headers,
      payload: { text: 'Read the fixture before deciding whether to open Spotify.' } });
    // light-my-request starts when its thenable is consumed.
    const completion = Promise.resolve(turn);
    await started.promise;
    const steering = await f.app.inject({ method: 'POST', url: '/conversation/sessions/41/steer', headers,
      payload: { text: 'Read Gmail only; do not open any app.', language: 'en' } });
    expect(steering.statusCode).toBe(202);
    await oldRoundStopped.promise;
    const response = await completion;
    expect(response.body).toContain('event: interrupted');
    expect(response.body).toContain('event: done');
    expect(f.messages.find(message => message.text === 'Old partial reply.')).toMatchObject({ role: 'jarvis', interrupted: true });
    expect(f.messages.find(message => message.id === '43')).toMatchObject({ role: 'dan', text: 'Read Gmail only; do not open any app.' });
    expect(f.invocations.map(invocation => invocation.runtime)).toEqual([runtime, runtime]);
    expect(f.invocations[0]!.signal.aborted).toBe(true);
    expect(f.invocations[1]!.signal.aborted).toBe(false);
    expect(f.noopActions).not.toHaveBeenCalled();
  });
});
