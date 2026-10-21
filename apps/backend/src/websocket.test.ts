import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPcBridgeModule } from './pc-bridge/bridge.js';
import { createVoiceRelayModule } from './voice/relay.js';
import { PC_BRIDGE_SUBPROTOCOL, VOICE_SUBPROTOCOL } from './websocket.js';

const apps: ReturnType<typeof buildApp>[] = [];
const clients: WebSocket[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => {
    if (client.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => {
        client.once('close', () => resolve());
        client.close();
      });
    }
  }));
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function listenWithWebSocketRoutes(): Promise<string> {
  const config = loadConfig({});
  const app = buildApp({ ...config, logLevel: 'silent' }, undefined, {
    auth: async (token) => {
      return token === 'pc-bridge.payload.signature'
        ? { kind: 'jarvis-pc-bridge', objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }
        : { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' };
    },
    modules: [
      createVoiceRelayModule({
        getToken: async () => '',
        connect: () => { throw new Error('Unexpected connection'); },
        registerPhoneMediaRoute: (instance) => {
          instance.get('/phone/media', { websocket: true, config: { jarvisPhoneMedia: true } }, () => {});
        },
      }),
      createPcBridgeModule(),
    ],
  });
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('No test listener');
  return `ws://127.0.0.1:${address.port}`;
}

async function connect(url: string, path: string, protocols?: string[]): Promise<WebSocket> {
  const token = path === '/pc-bridge/connect' ? 'pc-bridge.payload.signature' : 'user.payload.signature';
  const options = { headers: { authorization: ['Bearer', token].join(' ') } };
  const client = protocols?.length
    ? new WebSocket(`${url}${path}`, protocols, options)
    : new WebSocket(`${url}${path}`, options);
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });
  return client;
}

describe('application WebSocket plugin', () => {
  it('registers once before voice and PC bridge routes', async () => {
    const app = buildApp({ ...loadConfig({}), logLevel: 'silent' }, undefined, {
      modules: [
        createVoiceRelayModule({ getToken: async () => '', connect: () => { throw new Error('Unexpected connection'); } }),
        createPcBridgeModule(),
      ],
    });
    apps.push(app);
    await app.ready();

    expect(app.printPlugins().match(/@fastify\/websocket/gu)).toHaveLength(1);
    expect(app.hasRoute({ method: 'GET', url: '/voice' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/pc-bridge/connect' })).toBe(true);
  });

  it.each(['/voice', '/voice/da'])('accepts only the voice subprotocol on %s', async (path) => {
    const url = await listenWithWebSocketRoutes();

    expect((await connect(url, path, [VOICE_SUBPROTOCOL])).protocol).toBe(VOICE_SUBPROTOCOL);
    await expect(connect(url, path, [PC_BRIDGE_SUBPROTOCOL]))
      .rejects.toThrow('Server sent no subprotocol');
    expect((await connect(url, path)).protocol).toBe('');
  });

  it('accepts only the PC bridge subprotocol on the PC bridge route', async () => {
    const url = await listenWithWebSocketRoutes();

    expect((await connect(url, '/pc-bridge/connect', [PC_BRIDGE_SUBPROTOCOL])).protocol)
      .toBe(PC_BRIDGE_SUBPROTOCOL);
    await expect(connect(url, '/pc-bridge/connect', [VOICE_SUBPROTOCOL]))
      .rejects.toThrow('Server sent no subprotocol');
    expect((await connect(url, '/pc-bridge/connect')).protocol).toBe('');
  });

  it('keeps phone media usable without a subprotocol', async () => {
    const url = await listenWithWebSocketRoutes();

    expect((await connect(url, '/phone/media')).protocol).toBe('');
  });
});
