import { Writable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logging.js';
import type { ConversationStore } from './conversation-store.js';
import type { ReflexClassifier } from './reflex.js';
import type { ToolCallStore } from './tool-calls.js';

const config = loadConfig({});
const apps: ReturnType<typeof buildApp>[] = [];
const startedAt = new Date('2026-10-03T12:00:00Z');
const message = {
  id: '42',
  sessionId: '41',
  role: 'dan' as const,
  text: 'Hello Jarvis',
  model: null,
  at: startedAt,
};
const history = {
  messages: [{
    ...message,
    channel: 'chat' as const,
    language: 'da' as const,
    voiceMinutes: null,
    toolCalls: [{ id: '90', tool: 'factory_create_task', outcome: 'refused' as const, taskId: null }],
  }],
  nextCursor: null,
};
const auth = async () => ({
  objectId: config.auth.ownerObjectId,
  tenantId: config.auth.tenantId,
  displayName: 'Dan Aakesen',
});

function createApp(store?: ConversationStore, options: Partial<BuildAppOptions> = {}) {
  const sink = { trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}) };
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const app = buildApp(config, createLogger(config, sink, output), {
    auth,
    ...(store ? { conversationStore: store } : {}),
    ...options,
  });
  apps.push(app);
  return app;
}

function storeFixture(overrides: Partial<ConversationStore> = {}) {
  return {
    createSession: vi.fn(async () => ({
      id: '41',
      channel: 'chat' as const,
      language: 'da' as const,
      startedAt,
      endedAt: null,
    })),
    endSession: vi.fn(async () => true),
    getDanMessageIdBySourceItemId: vi.fn(async () => null),
    getSession: vi.fn(async () => ({
      id: '41',
      channel: 'chat' as const,
      language: 'da' as const,
      startedAt,
      endedAt: null,
    })),
    addMessage: vi.fn<ConversationStore['addMessage']>(async () => message),
    getHistory: vi.fn(async () => history),
    ...overrides,
  } satisfies ConversationStore;
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const headers = { authorization: ['Bearer', 'a.b.c'].join(' ') };

describe('conversation routes', () => {
  it('creates chat or voice sessions with a validated language', async () => {
    const store = storeFixture();
    const app = createApp(store);
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/sessions',
      headers,
      payload: { channel: 'voice', language: 'en' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: '41', channel: 'chat', language: 'da' });
    expect(store.createSession).toHaveBeenCalledWith({ channel: 'voice', language: 'en' });
  });

  it('stores a user turn and streams and persists the assistant response', async () => {
    const store = storeFixture();
    const chatAgent = {
      stream: vi.fn(async function* () {
        yield 'Hej';
        yield ', Dan.';
      }),
    };
    const app = buildApp(config, createLogger(config, {
      trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}),
    }, new Writable({ write(_chunk, _encoding, done) { done(); } })), {
      auth,
      conversationStore: store,
      conversationAgent: chatAgent,
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/turns',
      headers,
      payload: { text: 'Hej Jarvis', screenContext: 'A browser window shows a chart.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('event: user');
    expect(response.body).toContain('event: delta');
    expect(response.body).toContain('event: done');
    expect(chatAgent.stream).toHaveBeenCalledWith({
      messageId: '42',
      text: 'Hej Jarvis',
      language: 'da',
      screenContext: 'A browser window shows a chart.',
    }, headers.authorization, expect.any(AbortSignal));
    expect(store.addMessage).toHaveBeenCalledWith({
      sessionId: '41',
      role: 'dan',
      text: 'Hej Jarvis',
      model: null,
    });
    expect(store.addMessage).toHaveBeenCalledWith({
      sessionId: '41',
      role: 'jarvis',
      text: 'Hej, Dan.',
      model: null,
    });
  });

    it('streams the agent reply while a slow reflex is cut off at its budget', async () => {
      const store = storeFixture();
      const chatAgent = { stream: vi.fn(async function* () { yield 'Hello'; }) };
      let classifierSignal: AbortSignal | undefined;
      let onAbort!: () => void;
      const reflexAborted = new Promise<void>((resolve) => { onAbort = resolve; });
      const reflexClassifier: ReflexClassifier = {
        classify: vi.fn((_text, _language, _targets, signal) => {
          classifierSignal = signal;
          signal.addEventListener('abort', onAbort, { once: true });
          return new Promise<null>(() => {});
        }),
      };
      const app = createApp(store, { conversationAgent: chatAgent, reflexClassifier });

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/sessions/41/turns',
        headers,
        payload: { text: 'Hello' },
      });

      expect(response.body).toContain('event: delta');
      expect(chatAgent.stream).toHaveBeenCalledOnce();
      expect(reflexClassifier.classify).toHaveBeenCalledOnce();
      await reflexAborted;
      expect(classifierSignal?.aborted).toBe(true);
    });

    it('keeps the agent reply when reflex classification fails', async () => {
      const store = storeFixture();
      const chatAgent = { stream: vi.fn(async function* () { yield 'Hello'; }) };
      const reflexClassifier: ReflexClassifier = {
        classify: vi.fn(async () => { throw new Error('provider detail'); }),
      };
      const app = createApp(store, { conversationAgent: chatAgent, reflexClassifier });

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/sessions/41/turns',
        headers,
        payload: { text: 'Hello' },
      });

      expect(response.body).toContain('event: delta');
      expect(response.body).toContain('event: done');
      expect(response.body).not.toContain('provider detail');
    });

    it('cancels both the agent and reflex when the chat client disconnects', async () => {
      const store = storeFixture();
      let agentSignal!: AbortSignal;
      let resolveAgentAbort!: () => void;
      const agentAborted = new Promise<void>((resolve) => { resolveAgentAbort = resolve; });
      const chatAgent = {
        stream: vi.fn(async function* (_input, _authorization, signal: AbortSignal) {
          agentSignal = signal;
          signal.addEventListener('abort', resolveAgentAbort, { once: true });
          yield 'Hello';
          await new Promise<void>((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        }),
      };
      let resolveReflexAbort!: () => void;
      const reflexAborted = new Promise<void>((resolve) => { resolveReflexAbort = resolve; });
      const reflexClassifier: ReflexClassifier = {
        classify: vi.fn((_text, _language, _targets, signal) =>
          new Promise<null>((resolve) => signal.addEventListener('abort', () => {
            resolveReflexAbort();
            resolve(null);
          }, { once: true }))),
      };
      const app = createApp(store, { conversationAgent: chatAgent, reflexClassifier });
      let serverResponse!: ServerResponse;
      app.addHook('onRequest', async (_request, reply) => { serverResponse = reply.raw; });
      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      const port = (app.server.address() as AddressInfo).port;
      const controller = new AbortController();
      const response = await fetch(`${address}/conversation/sessions/41/turns`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
        signal: controller.signal,
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let received = '';
      while (!received.includes('event: delta')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Chat stream ended before its first delta');
        received += decoder.decode(chunk.value);
      }

      controller.abort();
      serverResponse.destroy();
      await reader.cancel().catch(() => {});
      await Promise.all([agentAborted, reflexAborted]);

      expect(port).toBeGreaterThan(0);
      expect(agentSignal.aborted).toBe(true);
    });

    it('reports a concurrent reflex action as tool activity and still streams the agent reply', async () => {
      const store = storeFixture();
      const chatAgent = { stream: vi.fn(async function* () { yield 'There are no active updates.'; }) };
      const recordCall = vi.fn(async () => {});
      const toolCallStore = {
        record: recordCall,
        listCodexToolCalls: vi.fn(async () => []),
      } as unknown as ToolCallStore;
      const reflexClassifier: ReflexClassifier = {
        classify: vi.fn(async (_text, _language, targets) => {
          const target = targets.find(({ tool }) => tool.name === 'get_status_summary');
          return target ? {
            addressed: true,
            intent: 'action',
            confidence: 1,
            needsConfirmation: false,
            target,
          } : null;
        }),
      };
      const app = createApp(store, {
        conversationAgent: chatAgent,
        reflexClassifier,
        toolCallStore,
        nowFeedStore: { read: vi.fn(async () => ({ running: [], items: [] })) } as unknown as BuildAppOptions['nowFeedStore'],
      });
      const activities: unknown[] = [];
      app.jarvisActivityHub.subscribe((event) => activities.push(event));

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/sessions/41/turns',
        headers,
        payload: { text: 'What is happening?' },
      });

      await vi.waitFor(() => expect(recordCall).toHaveBeenCalledOnce());
      expect(response.body).toContain('event: delta');
      expect(response.body).toContain('event: done');
      expect(recordCall).toHaveBeenCalledWith(expect.objectContaining({
        messageId: '42',
        tool: 'get_status_summary',
        outcome: 'ok',
      }));
      expect(activities).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool-call-started', source: 'chat', toolName: 'get_status_summary' }),
        expect.objectContaining({ type: 'tool-call-finished', source: 'chat', toolName: 'get_status_summary', outcome: 'ok' }),
      ]));
    });

  it('rejects voice sessions and explains agent unavailability before saving a message', async () => {
    const store = storeFixture({
      getSession: vi.fn(async () => ({
        id: '41',
        channel: 'voice',
        language: 'da',
        startedAt,
        endedAt: null,
      })),
    });
    const chatAgent = { stream: vi.fn(async function* () { yield 'Hello'; }) };
    const app = buildApp(config, createLogger(config, {
      trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}),
    }, new Writable({ write(_chunk, _encoding, done) { done(); } })), {
      auth,
      conversationStore: store,
      conversationAgent: chatAgent,
    });
    apps.push(app);
    const voice = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/turns',
      headers,
      payload: { text: 'Hello' },
    });
    const unavailable = await createApp(store).inject({
      method: 'POST',
      url: '/conversation/sessions/41/turns',
      headers,
      payload: { text: 'Hello' },
    });

    expect(voice.statusCode).toBe(400);
    expect(voice.json().error).toContain('not a chat session');
    expect(unavailable.statusCode).toBe(503);
    expect(store.addMessage).not.toHaveBeenCalled();
  });

  it('does not persist a chat response after an agent stream fails', async () => {
    const store = storeFixture();
    const chatAgent = {
      stream: vi.fn(async function* () {
        yield 'Partial';
        throw new Error('provider detail');
      }),
    };
    const app = buildApp(config, createLogger(config, {
      trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}),
    }, new Writable({ write(_chunk, _encoding, done) { done(); } })), {
      auth,
      conversationStore: store,
      conversationAgent: chatAgent,
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/turns',
      headers,
      payload: { text: 'Hello' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: error');
    expect(response.body).not.toContain('provider detail');
    expect(store.addMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid session fields and unauthenticated callers', async () => {
    const store = storeFixture();
    const app = createApp(store);
    const invalid = await app.inject({
      method: 'POST',
      url: '/conversation/sessions',
      headers,
      payload: { channel: 'email', language: 'da' },
    });
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/conversation/sessions',
      payload: { channel: 'chat', language: 'da' },
    });

    expect(invalid.statusCode).toBe(400);
    expect(unauthorized.statusCode).toBe(401);
    expect(store.createSession).not.toHaveBeenCalled();
  });

  it('persists messages for an active session and rejects blank content', async () => {
    const store = storeFixture();
    const app = createApp(store);
    store.addMessage.mockResolvedValueOnce(message).mockResolvedValueOnce(null);
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/messages',
      headers,
      payload: { role: 'dan', text: 'Hello Jarvis' },
    });
    const blank = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/messages',
      headers,
      payload: { role: 'dan', text: '   ' },
    });
    const ended = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/messages',
      headers,
      payload: { role: 'dan', text: 'Too late' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: '42', sessionId: '41', text: 'Hello Jarvis' });
    expect(blank.statusCode).toBe(400);
    expect(store.addMessage).toHaveBeenCalledTimes(2);
    expect(store.addMessage).toHaveBeenCalledWith({
      sessionId: '41',
      role: 'dan',
      text: 'Too late',
      model: null,
    });
    expect(ended.statusCode).toBe(404);
  });

  it('reads a bounded history page with tool-call metadata and ends sessions', async () => {
    const store = storeFixture({
      getHistory: vi.fn(async () => history),
      endSession: vi.fn(async () => false),
    });
    const app = createApp(store);
    const response = await app.inject({ url: '/conversation/history?limit=25&before=50', headers });
    const invalidCursor = await app.inject({ url: '/conversation/history?before=9223372036854775808', headers });
    const invalidSession = await app.inject({ method: 'POST', url: '/conversation/sessions/9223372036854775808/end', headers });
    const ended = await app.inject({ method: 'POST', url: '/conversation/sessions/41/end', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      messages: [{ id: '42', toolCalls: [{ id: '90', outcome: 'refused' }] }],
      nextCursor: null,
    });
    expect(store.getHistory).toHaveBeenCalledWith({ limit: 25, before: '50' });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidSession.statusCode).toBe(400);
    expect(store.getHistory).toHaveBeenCalledOnce();
    expect(ended.statusCode).toBe(404);
    expect(store.endSession).toHaveBeenCalledWith('41');
  });

  it('returns an unavailable response when persistence is not configured', async () => {
    const app = createApp();
    const response = await app.inject({ url: '/conversation/history', headers });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Conversation storage unavailable' });
  });
});
