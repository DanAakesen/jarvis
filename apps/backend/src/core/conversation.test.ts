import { Writable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { ServerResponse } from 'node:http';
import type { FastifyRequest } from 'fastify';
import sharp from 'sharp';
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
    interrupted: false,
    voiceMinutes: null,
    toolCalls: [{ id: '90', tool: 'factory_create_task', outcome: 'refused' as const, taskId: null }],
    attachments: [],
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
    getDanMessagesAfter: vi.fn(async () => []),
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
      turnId: '42',
      text: 'Hej Jarvis',
      language: 'da',
      screenContext: 'A browser window shows a chart.',
    }, headers.authorization, expect.any(AbortSignal));
    expect(store.addMessage).toHaveBeenCalledWith({
      sessionId: '41',
      role: 'dan',
      text: 'Hej Jarvis',
      model: null,
      language: 'da',
    });
    expect(store.addMessage).toHaveBeenCalledWith({
      sessionId: '41',
      role: 'jarvis',
      text: 'Hej, Dan.',
      model: null,
      language: 'da',
    });
  });

  it('links owner-owned attachments to the Dan message and forwards untrusted summaries', async () => {
    const store = storeFixture();
    const id = '7b96c6a9-9f80-4a8b-8a73-51517fe37512';
    const attachments = {
      retentionDays: 30,
      getModelContext: vi.fn(async () => [{
        id, name: 'notes.txt', contentType: 'text/plain', size: 24,
        status: 'ready' as const, context: 'Quarterly results.',
      }]),
    };
    const chatAgent = { stream: vi.fn(async function* () { yield 'The file says quarterly results.'; }) };
    const app = createApp(store, {
      conversationAgent: chatAgent,
      conversationAttachments: attachments as never,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/turns',
      headers,
      payload: { text: 'Summarize this file', attachmentIds: [id] },
    });
    expect(response.statusCode).toBe(200);
    expect(attachments.getModelContext).toHaveBeenCalledWith(config.auth.ownerObjectId, [id]);
    expect(store.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'dan',
      attachmentIds: [id],
      attachmentOwnerObjectId: config.auth.ownerObjectId,
      attachmentRetentionDays: 30,
    }));
    expect(chatAgent.stream).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [{
        id, name: 'notes.txt', contentType: 'text/plain', size: 24,
        status: 'ready', context: 'Quarterly results.',
      }],
    }), headers.authorization, expect.any(AbortSignal));
  });

  it('refuses to link an attachment that does not belong to the owner', async () => {
    const store = storeFixture();
    const attachments = {
      retentionDays: 30,
      getModelContext: vi.fn(async () => []),
    };
    const app = createApp(store, {
      conversationAttachments: attachments as never,
      conversationAgent: { stream: vi.fn(async function* () { yield 'unused'; }) },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/turns',
      headers,
      payload: { text: 'Read this', attachmentIds: ['7b96c6a9-9f80-4a8b-8a73-51517fe37512'] },
    });
    expect(response.statusCode).toBe(400);
    expect(store.addMessage).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-owner attachment upload before reading its body', async () => {
    const saveUpload = vi.fn();
    const app = createApp(undefined, {
      conversationAttachments: { saveUpload } as never,
      auth: async () => ({
        objectId: '00000000-0000-4000-8000-000000000002',
        tenantId: config.auth.tenantId,
        displayName: 'Other user',
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/attachments',
      headers: { ...headers, 'content-type': 'multipart/form-data; boundary=x' },
    });
    expect(response.statusCode).toBe(403);
    expect(saveUpload).not.toHaveBeenCalled();
  });

  it('refuses SVG uploads on the route and never stores them', async () => {
    const saveUpload = vi.fn();
    const app = createApp(undefined, { conversationAttachments: { saveUpload } as never });
    const boundary = 'jarvis-attachment-test';
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/attachments',
      headers: {
        ...headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="screen.svg"',
        'Content-Type: image/svg+xml',
        '',
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    });
    expect(response.statusCode).toBe(415);
    expect(saveUpload).not.toHaveBeenCalled();
  });

  it('marks extraction failures without failing a valid upload', async () => {
    const id = '7b96c6a9-9f80-4a8b-8a73-51517fe37512';
    const complete = vi.fn();
    const saveUpload = vi.fn(async () => ({
      id, name: 'screen.png', contentType: 'image/png', size: 1,
    }));
    const app = createApp(undefined, {
      conversationAttachments: { saveUpload, complete } as never,
      attachmentVision: async () => { throw new Error('private model error'); },
    });
    const boundary = 'jarvis-image-test';
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } })
      .png().toBuffer();
    const prefix = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="screen.png"',
      'Content-Type: image/png',
      '',
      '',
    ].join('\r\n'));
    const payload = Buffer.concat([
      prefix,
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/attachments',
      headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id, status: 'failed' });
    expect(complete).toHaveBeenCalledWith(id, config.auth.ownerObjectId, { status: 'failed' });
  });

  it('returns owner-only short-lived URLs and deletes attachments', async () => {
    const id = '7b96c6a9-9f80-4a8b-8a73-51517fe37512';
    const readUrl = vi.fn(async () => 'https://private.invalid/signed');
    const remove = vi.fn(async () => true);
    const app = createApp(undefined, {
      conversationAttachments: { readUrl, delete: remove } as never,
    });
    const urlResponse = await app.inject({
      method: 'GET',
      url: `/conversation/attachments/${id}/url`,
      headers,
    });
    expect(urlResponse.statusCode).toBe(200);
    expect(urlResponse.headers['cache-control']).toBe('no-store');
    expect(urlResponse.json()).toEqual({ url: 'https://private.invalid/signed' });
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/conversation/attachments/${id}`,
      headers,
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(remove).toHaveBeenCalledWith(config.auth.ownerObjectId, id);
  });

  it('interrupts streamed text, saves it as interrupted, and restarts once with the steering message', async () => {
    let nextMessageId = 41;
    const steeringMessage = { id: '43', text: 'Continue in English.', language: 'en' as const };
    const store = storeFixture({
      addMessage: vi.fn(async (input) => ({
        ...message,
        id: String(++nextMessageId),
        role: input.role,
        text: input.text,
      })),
      getDanMessagesAfter: vi.fn(async ({ after }) =>
        BigInt(after) < BigInt(steeringMessage.id) ? [steeringMessage] : []),
    });
    const appRef: { current?: ReturnType<typeof buildApp> } = {};
    const chatAgent = {
      stream: vi.fn(async function* (input, _authorization, signal: AbortSignal) {
        if (input.messageId === '42') {
          yield 'Partial reply';
          const duplicate = await appRef.current!.inject({
            method: 'POST',
            url: '/conversation/sessions/41/turns',
            headers,
            payload: { text: 'Do not start another turn' },
          });
          expect(duplicate.statusCode).toBe(409);
          const steering = await appRef.current!.inject({
            method: 'POST',
            url: '/conversation/sessions/41/steer',
            headers,
            payload: { text: steeringMessage.text, language: steeringMessage.language },
          });
          expect(steering.statusCode).toBe(202);
          expect(signal.aborted).toBe(true);
          throw new DOMException('Steered', 'AbortError');
        }
        expect(input).toMatchObject({
          messageId: '43',
          turnId: '42',
          text: steeringMessage.text,
          language: 'en',
          steering: true,
        });
        yield 'Continued answer';
      }),
    };
    const app = createApp(store, { conversationAgent: chatAgent });
    appRef.current = app;

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/turns',
      headers,
      payload: { text: 'Original question' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: interrupted');
    expect(response.body).toContain('event: done');
    expect(chatAgent.stream).toHaveBeenCalledTimes(2);
    expect(store.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'jarvis',
      text: 'Partial reply',
      interrupted: true,
    }));
  });

  it('does not abort tools and consumes steering at the next model-round boundary', async () => {
    const steeringMessage = { id: '43', text: 'Answer in English.', language: 'en' as const };
    const store = storeFixture({
      addMessage: vi.fn(async (input) => ({
        ...message,
        id: input.role === 'dan' && input.text !== 'Original question' ? '43' : '42',
        role: input.role,
        text: input.text,
      })),
      getDanMessagesAfter: vi.fn(async ({ after }) =>
        BigInt(after) < BigInt(steeringMessage.id) ? [steeringMessage] : []),
    });
    const appRef: { current?: ReturnType<typeof buildApp> } = {};
    let toolPhaseSignal!: AbortSignal;
    const chatAgent = {
      stream: vi.fn(async function* (_input, _authorization, signal: AbortSignal) {
        toolPhaseSignal = signal;
        const app = appRef.current!;
        await app.inject({
          method: 'POST',
          url: '/conversation/sessions/41/turns/42/phase',
          headers,
          payload: { phase: 'tools' },
        });
        await app.inject({
          method: 'POST',
          url: '/conversation/sessions/41/steer',
          headers,
          payload: { text: steeringMessage.text, language: steeringMessage.language },
        });
        expect(signal.aborted).toBe(false);
        const pickedUp = await app.inject({
          url: '/conversation/sessions/41/turns/42/steering?after=42',
          headers,
        });
        expect(pickedUp.json()).toEqual({ messages: [steeringMessage] });
        yield 'Tool finished; continuing in English.';
      }),
    };
    const app = createApp(store, { conversationAgent: chatAgent });
    appRef.current = app;

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/turns',
      headers,
      payload: { text: 'Original question' },
    });

    expect(response.body).toContain('event: done');
    expect(response.body).not.toContain('event: interrupted');
    expect(toolPhaseSignal.aborted).toBe(false);
    expect(chatAgent.stream).toHaveBeenCalledOnce();
  });

  it('skips browser reflex for a shared-tab request and binds its transient context to the turn', async () => {
    const store = storeFixture();
    const chatAgent = {
      stream: vi.fn(async function* () { yield 'Which tab should I use?'; }),
    };
    const reflexClassifier = { classify: vi.fn(async () => null) };
    const app = buildApp(config, createLogger(config, {
      trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}),
    }, new Writable({ write(_chunk, _encoding, done) { done(); } })), {
      auth,
      conversationStore: store,
      conversationAgent: chatAgent,
      reflexClassifier,
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/turns',
      headers,
      payload: {
        text: 'Fill this in with my name.',
        screenContext: 'Shared screen observations (untrusted data): A form is visible.',
        sharedScreenContext: {
          screenDescription: 'A form is visible.',
          sharedWindowTitle: 'Contact form - Chrome',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(reflexClassifier.classify).not.toHaveBeenCalled();
    expect(chatAgent.stream).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Fill this in with my name.',
      screenContext: 'Shared screen observations (untrusted data): A form is visible.',
    }), headers.authorization, expect.any(AbortSignal));
    expect(store.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'dan',
      text: 'Fill this in with my name.',
    }));
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

    it('logs typed reflex failures without the transcript', async () => {
      const store = storeFixture();
      const chatAgent = { stream: vi.fn(async function* () { yield 'Hello'; }) };
      const records: string[] = [];
      const output = new Writable({
        write(chunk, _encoding, done) { records.push(chunk.toString()); done(); },
      });
      const app = buildApp(config, createLogger(config, undefined, output), {
        auth,
        conversationStore: store,
        conversationAgent: chatAgent,
        reflexClassifier: { classify: vi.fn(async () => ({ failure: 'billing' as const })) },
      });
      apps.push(app);
      const transcript = 'private-transcript-marker';

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/sessions/41/turns',
        headers,
        payload: { text: transcript },
      });

      expect(response.body).toContain('event: done');
      const decision = records.map((record) => JSON.parse(record) as Record<string, unknown>)
        .find((record) => record.msg === 'reflex.decision');
      expect(decision).toMatchObject({ reason: 'billing' });
      expect(JSON.stringify(decision)).not.toContain(transcript);
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
      const appRef: { current?: ReturnType<typeof buildApp> } = {};
      const chatAgent = {
        stream: vi.fn(async function* () {
          const app = appRef.current;
          if (!app) throw new Error('Conversation app was not initialized');
          const toolResponse = await app.inject({
            method: 'POST',
            url: '/tools/get_status_summary',
            headers: { ...headers, 'x-jarvis-message-id': '42' },
            payload: {},
          });
          yield (toolResponse.json() as { result: { summary: string } }).result.summary;
        }),
      };
      const recordCall = vi.fn(async () => {});
      const readNowFeed = vi.fn(async () => ({ running: [], items: [] }));
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
        nowFeedStore: { read: readNowFeed } as unknown as BuildAppOptions['nowFeedStore'],
      });
      appRef.current = app;
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
      expect(response.body).toContain('The Now feed shows 0 running tasks');
      expect(readNowFeed).toHaveBeenCalledOnce();
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

  it('searches dated conversation messages with a source filter and bounded snippets', async () => {
    const search = {
      results: [{
        messageId: '42',
        sessionId: '41',
        source: 'voice' as const,
        role: 'dan' as const,
        at: startedAt.toISOString(),
        snippet: 'We decided to keep conversation search indexed.',
      }],
      hasMore: false,
    };
    const store = storeFixture({ searchMessages: vi.fn(async () => search) });
    const app = createApp(store);
    const response = await app.inject({
      url: '/conversation/search?q=decision&from=2026-10-01&to=2026-10-07&source=voice&limit=3',
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(search);
    expect(store.searchMessages).toHaveBeenCalledWith({
      query: 'decision',
      from: new Date('2026-10-01T00:00:00.000Z'),
      toExclusive: new Date('2026-10-08T00:00:00.000Z'),
      source: 'voice',
      limit: 3,
    }, expect.any(AbortSignal));
    const invalidDate = await app.inject({ url: '/conversation/search?q=decision&from=2026-02-30', headers });
    const invalidSource = await app.inject({ url: '/conversation/search?q=decision&source=notes', headers });
    const unauthorized = await app.inject({ url: '/conversation/search?q=decision' });
    expect(invalidDate.statusCode).toBe(400);
    expect(invalidSource.statusCode).toBe(400);
    expect(unauthorized.statusCode).toBe(401);
    expect(store.searchMessages).toHaveBeenCalledOnce();
  });

  it('registers a private conversation search tool that reuses the store', async () => {
    const search = { results: [], hasMore: false };
    const store = storeFixture({ searchMessages: vi.fn(async () => search) });
    const app = createApp(store);
    const tool = app.jarvisTools.get('conversation_search');

    expect(tool).toMatchObject({ sensitive: true });
    await expect(tool!.execute(
      { query: 'launch decision', from: '2026-10-01', to: '2026-10-07', limit: 5 },
      { server: app } as unknown as FastifyRequest,
      new AbortController().signal,
    )).resolves.toEqual(search);
    expect(store.searchMessages).toHaveBeenCalledWith({
      query: 'launch decision',
      from: new Date('2026-10-01T00:00:00.000Z'),
      toExclusive: new Date('2026-10-08T00:00:00.000Z'),
      limit: 5,
    }, expect.any(AbortSignal));
  });

  it('returns an unavailable response when persistence is not configured', async () => {
    const app = createApp();
    const response = await app.inject({ url: '/conversation/history', headers });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Conversation storage unavailable' });
  });

  it('returns an unavailable search response when search persistence is absent', async () => {
    const app = createApp();
    const response = await app.inject({ url: '/conversation/search?q=decision', headers });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Conversation search unavailable' });
  });
});
