import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { AuthenticationDenied } from '../auth/verify.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logging.js';
import { coreModule } from '../core/index.js';
import { factoryModule } from '../factory/index.js';
import { createVoiceLiveConnector, createVoiceRelayModule, VOICE_LIVE_SCOPE, VOICE_SUBPROTOCOL } from './relay.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const browserToken = 'header.payload.signature';
const voiceToken = 'provider.token.value';
const apps: ReturnType<typeof buildApp>[] = [];
const servers: WebSocketServer[] = [];
const browsers: WebSocket[] = [];
const appSockets: Socket[] = [];

afterEach(async () => {
  for (const browser of browsers.splice(0)) browser.terminate();
  for (const socket of appSockets.splice(0)) socket.destroy();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(servers.splice(0).map(async (server) => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

async function echoServer(onConnection: (socket: WebSocket, request: IncomingMessage) => void) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  server.on('connection', onConnection);
  return `ws://127.0.0.1:${address.port}`;
}

function appFor(connect: (token: string, signal: AbortSignal) => WebSocket, getToken = vi.fn(async () => voiceToken), records: string[] = []) {
  const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
  const app = buildApp(config, createLogger(config, undefined, output), {
    modules: [coreModule, factoryModule, createVoiceRelayModule({ getToken, connect })],
    auth: async (token) => {
      if (token !== browserToken) throw new AuthenticationDenied(401);
      return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId };
    },
  });
  app.server.on('connection', (socket) => appSockets.push(socket));
  apps.push(app);
  return { app, getToken };
}

async function openBrowser(url: string, protocols = [VOICE_SUBPROTOCOL, `jarvis.auth.${browserToken}`]) {
  const browser = new WebSocket(url, protocols, { headers: { origin: 'http://localhost:5173' } });
  browsers.push(browser);
  await new Promise<void>((resolve, reject) => {
    browser.once('open', resolve);
    browser.once('error', reject);
  });
  return browser;
}

describe('backend-relayed Voice Live WebSocket', () => {
  it('authenticates the browser and relays messages with only the backend Voice Live credential', async () => {
    const authorization = vi.fn();
    const upstreamUrl = await echoServer((socket, request) => {
      authorization(request.headers.authorization);
      socket.on('message', (data, binary) => socket.send(data, { binary }));
    });
    const records: string[] = [];
    const { app, getToken } = appFor((token, signal) => new WebSocket(upstreamUrl, {
      headers: { Authorization: ['Bearer', token].join(' ') }, signal,
    }), vi.fn(async (scope: string) => {
      expect(scope).toBe(VOICE_LIVE_SCOPE);
      return voiceToken;
    }), records);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const browser = await openBrowser(`ws://127.0.0.1:${address.port}/voice`);
    const reply = new Promise<string>((resolve) => browser.once('message', (data) => resolve(data.toString())));
    browser.send('audio-event');

    await expect(reply).resolves.toBe('audio-event');
    expect(browser.protocol).toBe(VOICE_SUBPROTOCOL);
    expect(new URL(browser.url).search).toBe('');
    expect(authorization).toHaveBeenCalledWith(['Bearer', voiceToken].join(' '));
    expect(getToken).toHaveBeenCalledOnce();
    expect(records.join('')).not.toContain(browserToken);
    expect(records.join('')).not.toContain(voiceToken);
  });

  it('rejects invalid browser credentials before requesting the upstream token', async () => {
    const connect = vi.fn(() => { throw new Error('Must not connect upstream'); });
    const getToken = vi.fn(async () => voiceToken);
    const { app } = appFor(connect, getToken);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const browser = new WebSocket(`ws://127.0.0.1:${address.port}/voice`, [
      VOICE_SUBPROTOCOL, 'jarvis.auth.bad.token.value',
    ]);
    browsers.push(browser);
    const rejection = await new Promise<string>((resolve, reject) => {
      browser.once('unexpected-response', (_request, response) => {
        response.resume();
        browser.terminate();
        resolve(`http:${response.statusCode}`);
      });
      browser.once('close', (code) => resolve(`close:${code}`));
      browser.once('error', reject);
    });

    expect(['http:401', 'close:1008']).toContain(rejection);
    expect(getToken).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    'ws://resource.services.ai.azure.com/voice-live/realtime',
    'wss://resource.example/voice-live/realtime',
    'wss://resource.services.ai.azure.com/other',
    'wss://resource.services.ai.azure.com/voice-live/realtime?api-key=secret',
  ])('rejects an unsafe or non-Voice Live endpoint: %s', (endpoint) => {
    expect(() => createVoiceLiveConnector(endpoint)).toThrow(TypeError);
  });

  it('accepts a secure Voice Live endpoint without embedding credentials in its URL', () => {
    expect(() => createVoiceLiveConnector('wss://resource.services.ai.azure.com/voice-live/realtime?api-version=2026-07-15&model=gpt-realtime')).not.toThrow();
  });
});
