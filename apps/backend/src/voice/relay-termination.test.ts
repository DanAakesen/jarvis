import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationAgentInput } from '../core/chat-agent.js';
import type { ConversationMessage, ConversationStore } from '../core/conversation-store.js';
import { createLogger } from '../logging.js';
import type { PiVoiceAgent } from './pi-voice.js';
import { createVoiceRelayModule, VOICE_SUBPROTOCOL } from './relay.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const cleanups: Array<() => Promise<void>> = [];
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

async function until(check: () => boolean, label: string, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) return;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe('GPT-Live graceful termination', () => {
  it('refreshes proactive receipt context at the native delegated turn boundary', async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const sockets: WebSocket[] = [];
    upstream.on('connection', (socket) => {
      sockets.push(socket);
      socket.send(JSON.stringify({
        type: 'session.started',
        session: { id: 'live-session', audio: { format: { type: 'audio/pcm', rate: 24_000 } } },
      }));
    });
    await new Promise<void>(resolve => upstream.once('listening', resolve));
    const upstreamUrl = `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const inputs: ConversationAgentInput[] = [];
    let reads = 0;
    const store = {
      createSession: async () => ({
        id: '7', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async () => true,
      addMessage: async (input: { sessionId: string; role: string; text: string; model: string | null }) => ({
        id: '1',
        sessionId: input.sessionId,
        role: input.role,
        text: input.text,
        model: input.model,
        at: new Date(),
      } as ConversationMessage),
    } as unknown as ConversationStore;
    const app = buildApp(
      config,
      createLogger({ ...config, logLevel: 'silent' } as typeof config),
      {
        auth: async () => ({
          objectId: config.auth.ownerObjectId,
          tenantId: config.auth.tenantId,
          displayName: 'Dan',
        }),
        conversationStore: store,
        proactiveConversationContext: {
          async read() {
            reads += 1;
            return reads === 1 ? 'Earlier suggestion.' : 'Latest suggestion and evidence.';
          },
          async select() { return true; },
          subscribe() { return () => {}; },
        },
        piAgent: {
          warm: async () => undefined,
          async *stream(input) {
            inputs.push(input);
            yield 'Noted.';
          },
        },
        modules: [createVoiceRelayModule({
          getToken: async () => 'token',
          connect: () => new WebSocket(upstreamUrl),
        })],
      },
    );
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const browser = new WebSocket(
      `ws://127.0.0.1:${port}/voice`,
      [VOICE_SUBPROTOCOL, 'jarvis.auth.aaa.bbb.ccc'],
    );
    const received: Record<string, unknown>[] = [];
    browser.on('message', data => received.push(JSON.parse(data.toString()) as Record<string, unknown>));
    cleanups.push(async () => {
      browser.terminate();
      await app.close();
      for (const socket of sockets) socket.terminate();
      upstream.close();
    });
    await until(
      () => received.some(event => event.type === 'jarvis.session.ready') &&
        reads >= 1 && sockets.length === 1,
      'voice ready and initial proactive read',
    );
    sockets[0]!.send(JSON.stringify({
      type: 'session.input_transcript.delta',
      event_id: 'input-1',
      delta: 'Do that',
      start_ms: 0,
      end_ms: 100,
    }));
    sockets[0]!.send(JSON.stringify({
      type: 'session.delegation.created',
      event_id: 'delegation-1',
      offset_ms: 100,
      delegation: { id: 'delegate-1', target: 'client' },
    }));
    // The delegated turn is sent after 1.5 s without new transcript, so it needs more than the default second.
    await until(() => inputs.length === 1, 'native delegated PI turn', 600);
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(inputs[0]).toMatchObject({
      text: 'Do that',
      channel: 'voice',
      proactiveContext: 'Latest suggestion and evidence.',
    });
  });

  it('waits for session.closed usage before reporting a clean client end', async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const upstreamEvents: Record<string, unknown>[] = [];
    const sockets: WebSocket[] = [];
    upstream.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('message', (data) => upstreamEvents.push(JSON.parse(data.toString()) as Record<string, unknown>));
      socket.send(JSON.stringify({
        type: 'session.started',
        session: { id: 'live-session', audio: { format: { type: 'audio/pcm', rate: 24_000 } } },
      }));
    });
    await new Promise<void>(resolve => upstream.once('listening', resolve));
    const upstreamUrl = `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    let endedUsage: { providerVoiceSeconds?: number; allowWallClockFallback: boolean } | undefined;
    const store = {
      createSession: async () => ({
        id: '7', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async (
        _sessionId: string,
        usage?: { providerVoiceSeconds?: number; allowWallClockFallback: boolean },
      ) => {
        endedUsage = usage;
        return true;
      },
    } as unknown as ConversationStore;
    const agent: PiVoiceAgent = {
      warm: async () => undefined,
      async *stream() { yield 'unused'; },
    };
    const app = buildApp(
      config,
      createLogger({ ...config, logLevel: 'silent' } as typeof config),
      {
        auth: async () => ({
          objectId: config.auth.ownerObjectId,
          tenantId: config.auth.tenantId,
          displayName: 'Dan',
        }),
        conversationStore: store,
        piAgent: agent,
        modules: [createVoiceRelayModule({
          getToken: async () => 'token',
          connect: () => new WebSocket(upstreamUrl),
        })],
      },
    );
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const browser = new WebSocket(
      `ws://127.0.0.1:${port}/voice`,
      [VOICE_SUBPROTOCOL, 'jarvis.auth.aaa.bbb.ccc'],
    );
    const received: Record<string, unknown>[] = [];
    browser.on('message', data => received.push(JSON.parse(data.toString()) as Record<string, unknown>));
    cleanups.push(async () => {
      browser.terminate();
      await app.close();
      for (const socket of sockets) socket.terminate();
      upstream.close();
    });

    await until(
      () => received.some(event => event.type === 'jarvis.session.ready') && sockets.length === 1,
      'voice readiness',
    );
    browser.send(JSON.stringify({ type: 'jarvis.session.end' }));
    await until(
      () => upstreamEvents.some(event => event.type === 'session.close'),
      'native session close',
    );
    expect(received.some(event => event.type === 'jarvis.session.ended')).toBe(false);

    sockets[0]!.send(JSON.stringify({
      type: 'session.usage.updated',
      event_id: 'usage-1',
      usage: { seconds: 7 },
    }));
    sockets[0]!.send(JSON.stringify({
      type: 'session.closed',
      event_id: 'closed-1',
      usage: { seconds: 9.5 },
    }));
    await until(
      () => received.some(event => event.type === 'jarvis.session.ended') && endedUsage !== undefined,
      'persisted final termination',
    );
    expect(endedUsage).toEqual({ providerVoiceSeconds: 9.5, allowWallClockFallback: true });
  });

  it('retries and does not invent wall-clock success when the provider closes before session.closed', async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const upstreamEvents: Record<string, unknown>[] = [];
    const sockets: WebSocket[] = [];
    upstream.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('message', (data) => upstreamEvents.push(JSON.parse(data.toString()) as Record<string, unknown>));
      socket.send(JSON.stringify({
        type: 'session.started',
        session: { id: 'live-session' },
      }));
    });
    await new Promise<void>(resolve => upstream.once('listening', resolve));
    const upstreamUrl = `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    let endedUsage: { providerVoiceSeconds?: number; allowWallClockFallback: boolean } | undefined;
    const store = {
      createSession: async () => ({
        id: '8', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async (
        _sessionId: string,
        usage?: { providerVoiceSeconds?: number; allowWallClockFallback: boolean },
      ) => {
        endedUsage = usage;
        return true;
      },
    } as unknown as ConversationStore;
    const app = buildApp(
      config,
      createLogger({ ...config, logLevel: 'silent' } as typeof config),
      {
        auth: async () => ({
          objectId: config.auth.ownerObjectId,
          tenantId: config.auth.tenantId,
          displayName: 'Dan',
        }),
        conversationStore: store,
        piAgent: { warm: async () => undefined, async *stream() { yield 'unused'; } },
        modules: [createVoiceRelayModule({
          getToken: async () => 'token',
          connect: () => new WebSocket(upstreamUrl),
          drainTimeoutMs: 20,
        })],
      },
    );
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const browser = new WebSocket(
      `ws://127.0.0.1:${port}/voice`,
      [VOICE_SUBPROTOCOL, 'jarvis.auth.aaa.bbb.ccc'],
    );
    const received: Record<string, unknown>[] = [];
    browser.on('message', data => received.push(JSON.parse(data.toString()) as Record<string, unknown>));
    cleanups.push(async () => {
      browser.terminate();
      await app.close();
      for (const socket of sockets) socket.terminate();
      upstream.close();
    });
    await until(
      () => received.some(event => event.type === 'jarvis.session.ready') && sockets.length === 1,
      'voice readiness',
    );
    browser.send(JSON.stringify({ type: 'jarvis.session.end' }));
    await until(
      () => upstreamEvents.some(event => event.type === 'session.close'),
      'native session close',
    );
    sockets[0]!.close(1011, 'lost before terminal');
    await until(
      () => endedUsage !== undefined &&
        received.some(event => event.type === 'jarvis.session.failed' && event.retryable === true),
      'retryable close without a terminal event',
    );
    expect(received.some(event => event.type === 'jarvis.session.ended')).toBe(false);
    expect(received).toContainEqual(expect.objectContaining({
      type: 'jarvis.voice.activity',
      state: 'reconnecting',
    }));
    expect(endedUsage).toEqual({ allowWallClockFallback: false });
  });

  it('fails a connecting End without enqueueing native session.close', async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const upstreamEvents: Record<string, unknown>[] = [];
    const sockets: WebSocket[] = [];
    upstream.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('message', data => upstreamEvents.push(JSON.parse(data.toString()) as Record<string, unknown>));
    });
    await new Promise<void>(resolve => upstream.once('listening', resolve));
    const upstreamUrl = `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    let endedUsage: { providerVoiceSeconds?: number; allowWallClockFallback: boolean } | undefined;
    const store = {
      createSession: async () => ({
        id: '8a', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async (
        _sessionId: string,
        usage?: { providerVoiceSeconds?: number; allowWallClockFallback: boolean },
      ) => {
        endedUsage = usage;
        return true;
      },
    } as unknown as ConversationStore;
    const app = buildApp(
      config,
      createLogger({ ...config, logLevel: 'silent' } as typeof config),
      {
        auth: async () => ({
          objectId: config.auth.ownerObjectId,
          tenantId: config.auth.tenantId,
          displayName: 'Dan',
        }),
        conversationStore: store,
        piAgent: { warm: async () => undefined, async *stream() { yield 'unused'; } },
        modules: [createVoiceRelayModule({
          getToken: async () => 'token',
          connect: () => new WebSocket(upstreamUrl),
          drainTimeoutMs: 20,
        })],
      },
    );
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const browser = new WebSocket(
      `ws://127.0.0.1:${port}/voice`,
      [VOICE_SUBPROTOCOL, 'jarvis.auth.aaa.bbb.ccc'],
    );
    const received: Record<string, unknown>[] = [];
    browser.on('message', data => received.push(JSON.parse(data.toString()) as Record<string, unknown>));
    cleanups.push(async () => {
      browser.terminate();
      await app.close();
      for (const socket of sockets) socket.terminate();
      upstream.close();
    });
    await until(
      () => browser.readyState === WebSocket.OPEN && sockets.length === 1,
      'connecting provider socket',
    );
    browser.send(JSON.stringify({ type: 'jarvis.session.end' }));
    await until(
      () => endedUsage !== undefined &&
        received.some(event => event.type === 'jarvis.session.failed' &&
          event.closeCode === 1011 && event.retryable === true),
      'connecting End failure',
    );
    expect(upstreamEvents.some(event => event.type === 'session.close')).toBe(false);
    expect(received.some(event => event.type === 'jarvis.session.ended')).toBe(false);
    expect(endedUsage).toEqual({ allowWallClockFallback: false });
  });

  it('turns cleanup failure after provider close into 1011 without an Ended acknowledgement', async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const upstreamEvents: Record<string, unknown>[] = [];
    const sockets: WebSocket[] = [];
    upstream.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('message', (data) => upstreamEvents.push(JSON.parse(data.toString()) as Record<string, unknown>));
      socket.send(JSON.stringify({
        type: 'session.started',
        session: { id: 'live-session', audio: { format: { type: 'audio/pcm', rate: 24_000 } } },
      }));
    });
    await new Promise<void>(resolve => upstream.once('listening', resolve));
    const upstreamUrl = `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    let cleanupUsage: { providerVoiceSeconds?: number; allowWallClockFallback: boolean } | undefined;
    const store = {
      createSession: async () => ({
        id: '8b', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async (
        _sessionId: string,
        usage?: { providerVoiceSeconds?: number; allowWallClockFallback: boolean },
      ) => {
        cleanupUsage = usage;
        return false;
      },
    } as unknown as ConversationStore;
    const app = buildApp(
      config,
      createLogger({ ...config, logLevel: 'silent' } as typeof config),
      {
        auth: async () => ({
          objectId: config.auth.ownerObjectId,
          tenantId: config.auth.tenantId,
          displayName: 'Dan',
        }),
        conversationStore: store,
        piAgent: { warm: async () => undefined, async *stream() { yield 'unused'; } },
        modules: [createVoiceRelayModule({
          getToken: async () => 'token',
          connect: () => new WebSocket(upstreamUrl),
          drainTimeoutMs: 50,
        })],
      },
    );
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const browser = new WebSocket(
      `ws://127.0.0.1:${port}/voice`,
      [VOICE_SUBPROTOCOL, 'jarvis.auth.aaa.bbb.ccc'],
    );
    const received: Record<string, unknown>[] = [];
    browser.on('message', data => received.push(JSON.parse(data.toString()) as Record<string, unknown>));
    cleanups.push(async () => {
      browser.terminate();
      await app.close();
      for (const socket of sockets) socket.terminate();
      upstream.close();
    });
    await until(
      () => received.some(event => event.type === 'jarvis.session.ready') && sockets.length === 1,
      'voice readiness',
    );
    browser.send(JSON.stringify({ type: 'jarvis.session.end' }));
    await until(
      () => upstreamEvents.some(event => event.type === 'session.close'),
      'native close before cleanup failure',
    );
    sockets[0]!.send(JSON.stringify({
      type: 'session.closed',
      event_id: 'closed-cleanup-failure',
      usage: { seconds: 4 },
    }));
    await until(
      () => cleanupUsage !== undefined &&
        received.some(event => event.type === 'jarvis.session.failed' &&
          event.closeCode === 1011 && event.retryable === true),
      'cleanup failure acknowledgement',
    );
    expect(received.some(event => event.type === 'jarvis.session.ended')).toBe(false);
    expect(cleanupUsage).toEqual({ providerVoiceSeconds: 4, allowWallClockFallback: true });
  });

  it('fails pre-connect End when session.close cannot be enqueued', async () => {
    let endedUsage: { providerVoiceSeconds?: number; allowWallClockFallback: boolean } | undefined;
    const store = {
      createSession: async () => ({
        id: '9', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async (
        _sessionId: string,
        usage?: { providerVoiceSeconds?: number; allowWallClockFallback: boolean },
      ) => {
        endedUsage = usage;
        return true;
      },
    } as unknown as ConversationStore;
    const app = buildApp(
      config,
      createLogger({ ...config, logLevel: 'silent' } as typeof config),
      {
        auth: async () => ({
          objectId: config.auth.ownerObjectId,
          tenantId: config.auth.tenantId,
          displayName: 'Dan',
        }),
        conversationStore: store,
        piAgent: { warm: async () => undefined, async *stream() { yield 'unused'; } },
        modules: [createVoiceRelayModule({
          getToken: () => new Promise<string>(() => undefined),
          connect: () => new WebSocket('ws://127.0.0.1:1'),
          drainTimeoutMs: 20,
        })],
      },
    );
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const browser = new WebSocket(
      `ws://127.0.0.1:${port}/voice`,
      [VOICE_SUBPROTOCOL, 'jarvis.auth.aaa.bbb.ccc'],
    );
    const received: Record<string, unknown>[] = [];
    browser.on('message', data => received.push(JSON.parse(data.toString()) as Record<string, unknown>));
    cleanups.push(async () => {
      browser.terminate();
      await app.close();
    });
    await new Promise<void>(resolve => browser.once('open', resolve));
    browser.send(JSON.stringify({ type: 'jarvis.session.end' }));
    await until(
      () => endedUsage !== undefined &&
        received.some(event => event.type === 'jarvis.session.failed' && event.retryable === true),
      'pre-connect retryable failure',
    );
    expect(received.some(event => event.type === 'jarvis.session.ended')).toBe(false);
    expect(endedUsage).toEqual({ allowWallClockFallback: false });
  });

  it('ends an abandoned late session without wall-clock voice usage', async () => {
    let resolveSession!: (session: {
      id: string;
      channel: 'voice';
      language: 'en';
      startedAt: Date;
      endedAt: null;
    }) => void;
    const creation = new Promise<{
      id: string;
      channel: 'voice';
      language: 'en';
      startedAt: Date;
      endedAt: null;
    }>(resolve => { resolveSession = resolve; });
    let cleanupUsage: { providerVoiceSeconds?: number; allowWallClockFallback: boolean } | undefined;
    const store = {
      createSession: async () => await creation,
      endSession: async (
        _sessionId: string,
        usage?: { providerVoiceSeconds?: number; allowWallClockFallback: boolean },
      ) => {
        cleanupUsage = usage;
        return true;
      },
    } as unknown as ConversationStore;
    const app = buildApp(
      config,
      createLogger({ ...config, logLevel: 'silent' } as typeof config),
      {
        auth: async () => ({
          objectId: config.auth.ownerObjectId,
          tenantId: config.auth.tenantId,
          displayName: 'Dan',
        }),
        conversationStore: store,
        piAgent: { warm: async () => undefined, async *stream() { yield 'unused'; } },
        modules: [createVoiceRelayModule({
          getToken: () => new Promise<string>(() => undefined),
          connect: () => new WebSocket('ws://127.0.0.1:1'),
          drainTimeoutMs: 20,
        })],
      },
    );
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const browser = new WebSocket(
      `ws://127.0.0.1:${port}/voice`,
      [VOICE_SUBPROTOCOL, 'jarvis.auth.aaa.bbb.ccc'],
    );
    const received: Record<string, unknown>[] = [];
    browser.on('message', data => received.push(JSON.parse(data.toString()) as Record<string, unknown>));
    cleanups.push(async () => {
      browser.terminate();
      await app.close();
    });
    await new Promise<void>(resolve => browser.once('open', resolve));
    browser.send(JSON.stringify({ type: 'jarvis.session.end' }));
    await sleep(20);
    resolveSession({
      id: 'late-10',
      channel: 'voice',
      language: 'en',
      startedAt: new Date(),
      endedAt: null,
    });
    await until(
      () => cleanupUsage !== undefined &&
        received.some(event => event.type === 'jarvis.session.failed' && event.retryable === true),
      'late session cleanup failure',
    );
    expect(cleanupUsage).toEqual({ allowWallClockFallback: false });
    expect(received.some(event => event.type === 'jarvis.session.ended')).toBe(false);
  });
});
