import { afterEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import { buildApp } from '../app.js';
import { createLogger } from '../logging.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import type { SettingsStore } from '../core/settings.js';
import {
  createScreenVisionModule,
  MAX_SCREEN_FRAME_BYTES,
  SCREEN_QUESTION_FRAME_BODY_LIMIT,
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
  logs?: string[];
} = {}) {
  const recorded: unknown[] = [];
  const reservations: unknown[] = [];
  const describe = vi.fn(options.describe ?? (async ({ image }) => {
      expect(image.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      return {
        description: 'A window with a chart.', inputTokens: 12, outputTokens: 5,
        costDkk: 0.0001, costUsd: 0.0000152,
      };
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
  const logger = options.logs ? createLogger({ logLevel: 'info' }, undefined, new Writable({
    write(chunk: Buffer, _encoding, done) {
      options.logs?.push(chunk.toString());
      done();
    },
  })) : undefined;
  const app = buildApp(config, logger, {
    auth,
    settingsStore,
    modules: [createScreenVisionModule(new ScreenVisionService(model, usage, () => 1_800_000_000_000))],
  });
  apps.push(app);
  const image = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]).toString('base64');
  return { app, image, model, recorded, reservations };
}

describe('screen vision endpoint', () => {
  it('timestamps frame acceptance rather than inference completion', async () => {
    let now = 1_800_000_000_000;
    const reserveFrame = vi.fn(async () => 'reserved' as const);
    const recordTokens = vi.fn(async () => {});
    const service = new ScreenVisionService({
      describe: async () => {
        now += 30_000;
        return { description: 'A chart.', inputTokens: 12, outputTokens: 5 };
      },
    }, { reserveFrame, recordTokens }, () => now);
    const result = await service.describe({
      sessionId: '42', image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      model: 'gpt-6-luna', dailyCap: 50, signal: new AbortController().signal,
    });
    expect(result.capturedAt).toBe(new Date(1_800_000_000_000).toISOString());
    expect(reserveFrame).toHaveBeenCalledWith(expect.objectContaining({ at: new Date(result.capturedAt) }));
    expect(recordTokens).toHaveBeenCalledWith(expect.objectContaining({ at: new Date(result.capturedAt) }));
  });

  it.each([12, null, [], {}, ' '.repeat(501)])('validates service questions before reserving usage (%j)', async (question) => {
    const reserveFrame = vi.fn(async () => 'reserved' as const);
    const model = { describe: vi.fn() };
    const service = new ScreenVisionService(model, { reserveFrame, recordTokens: vi.fn() });
    await expect(service.describe({
      sessionId: '42', image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      model: 'gpt-6-luna', dailyCap: 50, signal: new AbortController().signal,
      question: question as string,
    })).rejects.toThrow('at most 500 characters');
    expect(reserveFrame).not.toHaveBeenCalled();
    expect(model.describe).not.toHaveBeenCalled();
  });

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
      capturedAt: new Date(1_800_000_000_000).toISOString(),
    });
    expect(model.describe).toHaveBeenCalledOnce();
    expect(vi.mocked(model.describe).mock.calls[0]?.[0]).not.toHaveProperty('question');
    expect(reservations).toHaveLength(1);
    expect(recorded).toMatchObject([{
      sessionId: '42', inputTokens: 12, outputTokens: 5, costDkk: 0.0001,
      costUsd: 0.0000152, costStatus: 'estimated', model: 'gpt-6-luna',
    }]);
  });

  it.each([12, true, null, ['private-question'], [], { question: 'private-question' }])(
    'rejects original non-string questions (%j) without inference or usage',
    async (question) => {
      const { app, image, model, reservations } = createFixture();
      const response = await app.inject({
        method: 'POST', url: '/screen/frames', headers: authorization,
        payload: { sessionId: '42', frame: image, question },
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('private-question');
      expect(model.describe).not.toHaveBeenCalled();
      expect(reservations).toHaveLength(0);
    },
  );

  it.each(['q'.repeat(501), ' '.repeat(501), ` ${'q'.repeat(499)} `])(
    'bounds the raw question before trimming',
    async (question) => {
      const { app, image, model } = createFixture();
      const response = await app.inject({
        method: 'POST', url: '/screen/frames', headers: authorization,
        payload: { sessionId: '42', frame: image, question },
      });
      expect(response.statusCode).toBe(400);
      expect(model.describe).not.toHaveBeenCalled();
    },
  );

  it.each(['', ' \n\t '])('treats blank questions as absent (%j)', async (question) => {
    const { app, image, model } = createFixture();
    const response = await app.inject({
      method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '42', frame: image, question },
    });
    expect(response.statusCode).toBe(200);
    expect(vi.mocked(model.describe).mock.calls[0]?.[0]).not.toHaveProperty('question');
  });

  it('passes the trimmed question, returns its answer, and scrubs the request body', async () => {
    const { app, image, model, reservations } = createFixture({
      describe: async ({ question }) => ({
        description: question === 'What is the total?' ? 'The total is 42.' : 'A chart.',
        inputTokens: 12, outputTokens: 5,
      }),
    });
    const bodies: unknown[] = [];
    app.addHook('onResponse', async (request) => { bodies.push(request.body); });
    const response = await app.inject({
      method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '42', frame: image, question: '  What is the total?  ' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      description: 'The total is 42.',
      capturedAt: new Date(1_800_000_000_000).toISOString(),
    });
    expect(vi.mocked(model.describe).mock.calls[0]?.[0].question).toBe('What is the total?');
    expect(reservations).toMatchObject([{ at: new Date(response.json().capturedAt) }]);
    expect(bodies).toEqual([{ sessionId: '42', frame: '' }]);
  });

  it('accepts a maximum JPEG and 500 escaped Unicode question characters within the body limit', async () => {
    const { app, model } = createFixture();
    const image = Buffer.alloc(MAX_SCREEN_FRAME_BYTES);
    image[0] = 0xff;
    image[1] = 0xd8;
    image[image.length - 2] = 0xff;
    image[image.length - 1] = 0xd9;
    const response = await app.inject({
      method: 'POST', url: '/screen/frames',
      headers: { ...authorization, 'content-type': 'application/json' },
      payload: `{"sessionId":"42","frame":"${image.toString('base64')}","question":"${'\\u0061'.repeat(500)}"}`,
    });
    expect(response.statusCode).toBe(200);
    expect(vi.mocked(model.describe).mock.calls[0]?.[0].question).toBe('a'.repeat(500));
  });

  it('retains a finite request body limit before inference', async () => {
    const { app, model } = createFixture();
    const response = await app.inject({
      method: 'POST', url: '/screen/frames',
      headers: { ...authorization, 'content-type': 'application/json' },
      payload: ' '.repeat(SCREEN_QUESTION_FRAME_BODY_LIMIT + 1),
    });
    expect(response.statusCode).toBe(413);
    expect(model.describe).not.toHaveBeenCalled();
  });

  it.each([false, true])('excludes questions from actual logs on model failure=%s', async (fail) => {
    const logs: string[] = [];
    const { app, image } = createFixture({
      logs,
      describe: async ({ question }) => {
        if (fail) throw new Error(`provider-secret ${question}`);
        return { description: 'A chart.', inputTokens: 12, outputTokens: 5 };
      },
    });
    const bodies: unknown[] = [];
    app.addHook('onResponse', async (request) => { bodies.push(request.body); });
    const response = await app.inject({
      method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '42', frame: image, question: 'private-question-marker' },
    });
    expect(response.statusCode).toBe(fail ? 503 : 200);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('')).toContain('request.completed');
    expect(logs.join('')).not.toContain('private-question-marker');
    expect(logs.join('')).not.toContain('provider-secret');
    expect(response.body).not.toContain('private-question-marker');
    expect(bodies).toEqual([{ sessionId: '42', frame: '' }]);
  });

  it('scrubs invalid questions before validation failure and never logs their values', async () => {
    const logs: string[] = [];
    const { app, image, model } = createFixture({ logs });
    const bodies: unknown[] = [];
    app.addHook('onResponse', async (request) => { bodies.push(request.body); });
    for (const question of [{ private: 'private-question-marker' }, 'private-question-marker'.repeat(30)]) {
      const response = await app.inject({
        method: 'POST', url: '/screen/frames', headers: authorization,
        payload: { sessionId: '42', frame: image, question },
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('private-question-marker');
    }
    expect(model.describe).not.toHaveBeenCalled();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('')).not.toContain('private-question-marker');
    expect(bodies.every((body) => !Object.hasOwn(body as object, 'question'))).toBe(true);
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
