import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationStore } from '../core/conversation-store.js';
import { createLogger } from '../logging.js';
import type { PiVoiceAgent } from './pi-voice.js';
import { createVoiceRelayModule, VOICE_SUBPROTOCOL } from './relay.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const cleanups: Array<() => Promise<void>> = [];
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

async function until(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe('GPT-Live graceful termination', () => {
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
    expect(endedUsage).toEqual({ allowWallClockFallback: false });
  });
});
