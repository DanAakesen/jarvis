import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import type { SettingsStore } from '../core/settings.js';
import {
  createScreenVisionModule,
  MAX_SCREEN_FRAME_BYTES,
  ScreenVisionService,
  type ScreenFrameUsageStore,
  type ScreenVisionModel,
} from './screen.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const authorization = { authorization: `${['Bear', 'er'].join('')} ${['a', 'b', 'c'].join('.')}` };
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function createFixture(options: {
  reserve?: ScreenFrameUsageStore['reserveFrame'];
  describe?: ScreenVisionModel['describe'];
  principal?: Awaited<ReturnType<TokenVerifier>>;
} = {}) {
  const recorded: unknown[] = [];
  const reservations: unknown[] = [];
  const describe = vi.fn(options.describe ?? (async ({ image }) => {
      expect(image.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      return { description: 'A window with a chart.', inputTokens: 12, outputTokens: 5 };
    }));
  const model: ScreenVisionModel = { describe };
  const usage: ScreenFrameUsageStore = {
    reserveFrame: options.reserve ?? (async (input) => {
      reservations.push(input);
      return 'reserved';
    }),
    recordTokens: async (input) => { recorded.push(input); },
  };
  const settingsStore: SettingsStore = { read: async () => ({}), write: async () => {} };
  const auth: TokenVerifier = async () => options.principal ?? {
    objectId: config.auth.ownerObjectId,
    tenantId: config.auth.tenantId,
    displayName: 'Dan',
  };
  const app = buildApp(config, undefined, {
    auth,
    settingsStore,
    modules: [createScreenVisionModule(new ScreenVisionService(model, usage, () => 1_800_000_000_000))],
  });
  apps.push(app);
  const image = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]).toString('base64');
  return { app, image, model, recorded, reservations };
}

describe('screen vision endpoint', () => {
  it('authenticates, inspects an in-memory JPEG, and records frame and token usage', async () => {
    const { app, image, model, recorded, reservations } = createFixture();

    const response = await app.inject({
      method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '42', frame: image },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      description: 'A window with a chart.', inputTokens: 12, outputTokens: 5,
    });
    expect(model.describe).toHaveBeenCalledOnce();
    expect(reservations).toHaveLength(1);
    expect(recorded).toMatchObject([{ sessionId: '42', inputTokens: 12, outputTokens: 5 }]);
  });

  it('rejects unauthenticated, invalid-session, and non-JPEG frames before inference', async () => {
    const { app, image, model } = createFixture();

    expect((await app.inject({
      method: 'POST', url: '/screen/frames', payload: { sessionId: '42', frame: image },
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '9223372036854775808', frame: image },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '42', frame: Buffer.from('not a jpeg').toString('base64') },
    })).statusCode).toBe(400);
    expect(model.describe).not.toHaveBeenCalled();
  });

  it('enforces the byte limit before calling the model', async () => {
    const { app, model } = createFixture();
    const oversized = Buffer.alloc(MAX_SCREEN_FRAME_BYTES + 1);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[oversized.length - 2] = 0xff;
    oversized[oversized.length - 1] = 0xd9;
    const response = await app.inject({
      method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '42', frame: oversized.toString('base64') },
    });
    expect(response.statusCode).toBe(400);
    expect(model.describe).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', 404],
    ['rate-limited', 429],
    ['limit', 429],
  ] as const)('does not call the model when reservation is %s', async (reservation, statusCode) => {
    const reserve = vi.fn(async () => reservation);
    const { app, image, model } = createFixture({ reserve });
    const response = await app.inject({
      method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '42', frame: image },
    });
    expect(response.statusCode).toBe(statusCode);
    expect(model.describe).not.toHaveBeenCalled();
  });

  it('sanitizes model failures and never returns the provider error', async () => {
    const { app, image } = createFixture({
      describe: async () => { throw new Error('provider-secret and screen data'); },
    });
    const response = await app.inject({
      method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '42', frame: image },
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('provider-secret');
    expect(response.body).not.toContain('screen data');
  });
});
