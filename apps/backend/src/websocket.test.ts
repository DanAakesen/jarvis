import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPcBridgeModule } from './pc-bridge/bridge.js';
import { createVoiceRelayModule } from './voice/relay.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

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
});
