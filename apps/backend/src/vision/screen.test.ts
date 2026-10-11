import { afterEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import sharp from 'sharp';
import { FrameStore } from './frame-store.js';
import type { ConversationStore } from '../core/conversation-store.js';
import type { VisionWatchUsageStore } from './watch.js';
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
  imageUsageEventId,
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
  readSettings?: SettingsStore['read'];
  now?: () => number;
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
  const settingsStore: SettingsStore = { read: options.readSettings ?? (async () => ({})), write: async () => {} };
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
    modules: [createScreenVisionModule(new ScreenVisionService(model, usage, options.now ?? (() => 1_800_000_000_000)))],
  });
  apps.push(app);
  const image = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]).toString('base64');
  return { app, image, model, recorded, reservations };
}

describe('screen vision endpoint', () => {
  it('returns a distinct budget denial with turn correlation before inference', async () => {
    const { app, image, model } = createFixture({ reserve: async () => 'budget-exhausted' });
    const response = await app.inject({ method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '41', frame: image, turnId: 'camera-turn' } });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: 'The daily vision budget has been exhausted.',
      code: 'budget_exhausted', turnId: 'camera-turn' });
    expect(model.describe).not.toHaveBeenCalled();
  });

  it('keys image admission and reconciliation to one session/item without another frame reservation', async () => {
    const reserveImage = vi.fn(async () => 'reserved' as const);
    const reserveFrame = vi.fn();
    const recordImageTokens = vi.fn(async () => {});
    const service = new ScreenVisionService({ describe: vi.fn() }, {
      reserveImage, reserveFrame, recordImageTokens, recordTokens: vi.fn(),
    });
    const input = { sessionId: '41', itemId: 'frame_item', model: 'gpt-6-luna', limitUsd: 1 };
    expect(await service.reserveImage(input)).toBe(true);
    expect(await service.reserveImage(input)).toBe(true);
    expect(reserveImage).toHaveBeenCalledWith(expect.objectContaining({
      eventId: imageUsageEventId('41', 'frame_item'), model: 'gpt-6-luna', limitDkk: 6.5785,
    }));
    expect(reserveFrame).not.toHaveBeenCalled();
    await service.recordImageUsage({ ...input, inputTokens: 100, outputTokens: 20 });
    expect(recordImageTokens).toHaveBeenCalledWith({
      sessionId: '41', eventId: imageUsageEventId('41', 'frame_item'),
      model: 'gpt-6-luna', inputTokens: 100, outputTokens: 20, role: 'voice',
    });
    expect(imageUsageEventId('42', 'frame_item')).not.toBe(imageUsageEventId('41', 'frame_item'));
    await service.recordImageUsage({ ...input, inputTokens: 100 });
    await service.recordImageUsage({ ...input, inputTokens: NaN, outputTokens: 20 });
    expect(recordImageTokens).toHaveBeenCalledOnce();
  });

  it('fails image admission closed for unknown prices, zero budgets, cancellation and persistence failure', async () => {
    const reserveImage = vi.fn(async () => 'reserved' as const);
    const service = new ScreenVisionService({ describe: vi.fn() }, {
      reserveImage, reserveFrame: vi.fn(), recordTokens: vi.fn(),
    });
    const input = { sessionId: '41', itemId: 'frame_item', model: 'gpt-6-luna', limitUsd: 1 };
    await expect(service.reserveImage({ ...input, model: 'unknown-model' })).rejects.toThrow('pricing');
    expect(await service.reserveImage({ ...input, limitUsd: 0 })).toBe(false);
    await expect(service.reserveImage({ ...input, signal: AbortSignal.abort() })).rejects.toThrow('cancelled');
    expect(reserveImage).not.toHaveBeenCalled();
    reserveImage.mockRejectedValueOnce(new Error('SQL unavailable'));
    await expect(service.reserveImage(input)).rejects.toThrow('unavailable');
  });

  it('distinguishes known image budget exhaustion from an unavailable active session', async () => {
    let outcome: 'limit' | 'inactive' = 'limit';
    const service = new ScreenVisionService({ describe: vi.fn() }, {
      reserveImage: async () => outcome, reserveFrame: vi.fn(), recordTokens: vi.fn(),
    });
    const input = { sessionId: '41', itemId: 'frame_item', model: 'gpt-6-luna', limitUsd: 1 };
    expect(await service.reserveImage(input)).toBe(false);
    outcome = 'inactive';
    await expect(service.reserveImage(input)).rejects.toThrow('unavailable');
  });
  it('reconciles a confirmed no-inference zero release even when model pricing is unknown', async () => {
    const recordImageTokens = vi.fn(async () => {});
    const service = new ScreenVisionService({ describe: vi.fn() }, {
      reserveFrame: vi.fn(), recordTokens: vi.fn(), recordImageTokens,
    });
    await service.recordImageUsage({ sessionId: '41', itemId: 'frame_item',
      model: 'gpt-realtime-2.1-mini', inputTokens: 0, outputTokens: 0, imageTokens: 0 });
    expect(recordImageTokens).toHaveBeenCalledWith({
      sessionId: '41', eventId: imageUsageEventId('41', 'frame_item'),
      model: 'gpt-realtime-2.1-mini', inputTokens: 0, outputTokens: 0, role: 'voice', imageOnly: true,
    });
    await service.recordImageUsage({ sessionId: '41', itemId: 'frame_item',
      model: 'gpt-realtime-2.1-mini', inputTokens: 1, outputTokens: 0, imageTokens: 1 });
    expect(recordImageTokens).toHaveBeenCalledTimes(2);
    expect(recordImageTokens).toHaveBeenLastCalledWith(expect.objectContaining({
      inputTokens: 1, outputTokens: 0, imageOnly: true,
    }));
  });
  it.each(['gpt-realtime-2.1', 'gpt-realtime-2.1-mini'])(
    'admits the actual production voice model %s against an unverified conservative hold', async (model) => {
      const reserveImage = vi.fn(async () => 'reserved' as const);
      const service = new ScreenVisionService({ describe: vi.fn() }, {
        reserveImage, reserveFrame: vi.fn(), recordTokens: vi.fn(),
      });
      expect(await service.reserveImage({ sessionId: '41', itemId: 'voice_item', model,
        limitUsd: 1, signal: new AbortController().signal })).toBe(true);
      expect(reserveImage).toHaveBeenCalledWith(expect.objectContaining({ model, limitDkk: 6.5785 }));
    },
  );
  it('prices only reported realtime image tokens, never whole audio/output totals', async () => {
    const recordImageTokens = vi.fn(async () => {});
    const service = new ScreenVisionService({ describe: vi.fn() }, {
      reserveFrame: vi.fn(), recordTokens: vi.fn(), recordImageTokens,
    });
    const input = { sessionId: '41', itemId: 'voice_item', model: 'gpt-realtime-2.1',
      inputTokens: 10_000, outputTokens: 1_000 };
    await service.recordImageUsage(input);
    expect(recordImageTokens).not.toHaveBeenCalled();
    await service.recordImageUsage({ ...input, imageTokens: 100 });
    expect(recordImageTokens).toHaveBeenCalledWith({
      sessionId: '41', eventId: imageUsageEventId('41', 'voice_item'), model: input.model,
      inputTokens: 100, outputTokens: 0, role: 'voice', imageOnly: true,
    });
    await service.recordImageUsage({ ...input, model: 'gpt-realtime-2.1-mini', imageTokens: 100 });
    expect(recordImageTokens).toHaveBeenCalledTimes(2);
    expect(recordImageTokens).toHaveBeenLastCalledWith(expect.objectContaining({
      model: 'gpt-realtime-2.1-mini', inputTokens: 100, outputTokens: 0, imageOnly: true,
    }));
    await service.recordImageUsage({ ...input, imageTokens: 0 });
    expect(recordImageTokens).toHaveBeenLastCalledWith(expect.objectContaining({
      inputTokens: 0, outputTokens: 0, imageOnly: true,
    }));
  });

  it('returns a server handle and serves JPEG only to the bound authenticated Dan message', async () => {
    const frames = new FrameStore();
    const image = await sharp({ create: { width: 1024, height: 900, channels: 3, background: 'red' } }).jpeg().toBuffer();
    const captured: Buffer[] = [];
    const model: ScreenVisionModel = { describe: async ({ image }) => {
      captured.push(image);
      return { description: 'A red square.', inputTokens: 1, outputTokens: 1 };
    } };
    const reserveFrame = vi.fn(async () => 'reserved' as const);
    const reserveImage = vi.fn(async () => 'reserved' as const);
    const usage: ScreenFrameUsageStore = { reserveFrame,
      reserveImage, recordTokens: async () => {} };
    const session = { id: '41', channel: 'chat' as const, language: 'en' as const,
      startedAt: new Date(), endedAt: null };
    const conversations = { getSession: async () => session,
      getMessageSessionId: async (messageId: string) => messageId === '42' ? '41' : '99' } as ConversationStore;
    const app = buildApp(config, undefined, { auth: async () => ({
      objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan',
    }), settingsStore: { read: async () => ({}), write: async () => {} }, conversationStore: conversations,
      modules: [createScreenVisionModule(new ScreenVisionService(model, usage), frames)] });
    apps.push(app);
    const result = await app.inject({ method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '41', frame: image.toString('base64'), turnId: 'capture' } });
    expect(result.statusCode).toBe(200);
    const frameId = result.json().frameId as string;
    expect(frameId).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(reserveFrame).toHaveBeenCalledOnce();
    expect(reserveImage).not.toHaveBeenCalled();
    expect(captured[0]!.every((byte) => byte === 0)).toBe(true);
    frames.bind(frameId, { ownerObjectId: config.auth.ownerObjectId,
      sessionId: '41', turnId: 'capture', messageId: '42' });
    const resolve = (messageId: string, sessionId = '41') => app.inject({
      method: 'POST', url: '/screen/frames/resolve', headers: authorization,
      payload: { frameId, sessionId, messageId, turnId: 'capture' },
    });
    expect((await resolve('99')).statusCode).toBe(404);
    expect((await resolve('42', '99')).statusCode).toBe(404);
    const response = await resolve('42');
    expect(response.statusCode).toBe(200);
    expect(reserveFrame).toHaveBeenCalledOnce();
    expect(reserveImage).toHaveBeenCalledOnce();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-type']).toBe('image/jpeg');
    const metadata = await sharp(response.rawPayload).metadata();
    expect(metadata.width).toBe(768);
    expect((await resolve('42')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/screen/frames/resolve', headers: authorization,
      payload: { frameId: 'shortmissing', sessionId: '41', messageId: '42' } })).statusCode).toBe(404);
    image.fill(0);
  });

  it('denies resolving a bound image when its budget is exhausted and does not increment the frame cap', async () => {
    const frames = new FrameStore();
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).jpeg().toBuffer();
    const frameId = await frames.put({ ownerObjectId: config.auth.ownerObjectId,
      sessionId: '41', turnId: 'capture', image });
    frames.bind(frameId, { ownerObjectId: config.auth.ownerObjectId,
      sessionId: '41', turnId: 'capture', messageId: '42' });
    const reserveFrame = vi.fn();
    const reserveImage = vi.fn(async () => 'limit' as const);
    const conversations = { getSession: async () => ({ endedAt: null }),
      getMessageSessionId: async () => '41' } as unknown as ConversationStore;
    const app = buildApp(config, undefined, { auth: async () => ({
      objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan',
    }), settingsStore: { read: async () => ({}), write: async () => {} }, conversationStore: conversations,
      modules: [createScreenVisionModule(new ScreenVisionService({ describe: vi.fn() },
        { reserveFrame, reserveImage, recordTokens: vi.fn() }), frames)] });
    apps.push(app);
    const response = await app.inject({ method: 'POST', url: '/screen/frames/resolve', headers: authorization,
      payload: { sessionId: '41', messageId: '42', frameId, turnId: 'capture' } });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'budget_exhausted', turnId: 'capture' });
    expect(reserveImage).toHaveBeenCalledOnce();
    expect(reserveFrame).not.toHaveBeenCalled();
    image.fill(0);
  });

  it.each(['limit', 'rate-limited', 'inactive'] as const)('blocks caption/image inference on budget %s', async (outcome) => {
    const describe = vi.fn();
    const reserveFrame = vi.fn(async () => outcome);
    const budget: VisionWatchUsageStore = { reserveWatchFrame: async () => ({ outcome, usedDkk: 0 }),
      readWatchBudget: async () => 0, recordTokens: async () => {} };
    const service = new ScreenVisionService({ describe }, { reserveFrame, recordTokens: async () => {} }, Date.now, budget);
    await expect(service.describe({ sessionId: '41', image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      model: 'gpt-6-luna', dailyCap: 300, limitUsd: 1, signal: new AbortController().signal })).rejects.toThrow();
    expect(reserveFrame).toHaveBeenCalledWith(expect.objectContaining({ limitDkk: 6.5785 }));
    expect(describe).not.toHaveBeenCalled();
  });

  it('fails unknown-price or missing-budget calls before reserving or inferring', async () => {
    const describe = vi.fn();
    const reserveFrame = vi.fn();
    const budget: VisionWatchUsageStore = { reserveWatchFrame: vi.fn(), readWatchBudget: async () => 0,
      recordTokens: async () => {} };
    const service = new ScreenVisionService({ describe }, { reserveFrame, recordTokens: async () => {} }, Date.now, budget);
    await expect(service.describe({ sessionId: '41', image: Buffer.alloc(1), model: 'unknown',
      dailyCap: 300, limitUsd: 1, signal: new AbortController().signal })).rejects.toThrow('pricing');
    expect(reserveFrame).not.toHaveBeenCalled();
    expect(describe).not.toHaveBeenCalled();
  });
  it('records request receipt before delayed settings and inference', async () => {
    const receipt = 1_800_000_000_000;
    let now = receipt;
    const { app, image } = createFixture({
      now: () => now,
      readSettings: async () => { now += 20_000; return {}; },
      describe: async () => { now += 30_000; return { description: 'A mug.', inputTokens: 1, outputTokens: 1 }; },
    });
    app.addHook('preParsing', async (_request, _reply, payload) => {
      now += 10_000;
      return payload;
    });
    const response = await app.inject({
      method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '42', frame: image },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().capturedAt).toBe(new Date(receipt).toISOString());
    expect(now).toBeGreaterThan(receipt);
  });

  it.each(['item_A-1', 'x'.repeat(128)])('echoes arbitrary safe client turn correlation %s', async (turnId) => {
    const { app, image } = createFixture();
    const response = await app.inject({
      method: 'POST', url: '/screen/frames', headers: authorization,
      payload: { sessionId: '42', frame: image, turnId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ question: null, turnId });
  });

  it.each([12, false, null, [], {}, '', 'x'.repeat(129), 'item.1', 'ø', 'item\n1'])(
    'rejects original invalid turn correlations (%j)', async (turnId) => {
      const { app, image, model, reservations } = createFixture();
      const response = await app.inject({
        method: 'POST', url: '/screen/frames', headers: authorization,
        payload: { sessionId: '42', frame: image, turnId },
      });
      expect(response.statusCode).toBe(400);
      expect(model.describe).not.toHaveBeenCalled();
      expect(reservations).toHaveLength(0);
    },
  );
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

  it('accepts an internal receipt timestamp independent of reservation time', async () => {
    const service = new ScreenVisionService({
      describe: async () => ({ description: 'A chart.', inputTokens: 1, outputTokens: 1 }),
    }, { reserveFrame: async () => 'reserved', recordTokens: async () => {} }, () => 1_800_000_030_000);
    const result = await service.describe({
      sessionId: '42', image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      model: 'gpt-6-luna', dailyCap: 50, signal: new AbortController().signal,
      capturedAt: new Date(1_800_000_000_000), question: '  What colour?  ', turnId: 'item_A-1',
    });
    expect(result).toMatchObject({
      capturedAt: new Date(1_800_000_000_000).toISOString(), question: 'What colour?', turnId: 'item_A-1',
    });
  });

  it.each([12, null, '', 'x'.repeat(129), 'item.1'])('validates service correlation before usage (%j)', async (turnId) => {
    const reserveFrame = vi.fn(async () => 'reserved' as const);
    const model = { describe: vi.fn() };
    const service = new ScreenVisionService(model, { reserveFrame, recordTokens: vi.fn() });
    await expect(service.describe({
      sessionId: '42', image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      model: 'gpt-6-luna', dailyCap: 50, signal: new AbortController().signal,
      turnId: turnId as string,
    })).rejects.toThrow('screen turn ID');
    expect(reserveFrame).not.toHaveBeenCalled();
    expect(model.describe).not.toHaveBeenCalled();
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
      question: null,
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

  it.each(['q'.repeat(501), ' '.repeat(501), ` ${'q'.repeat(499)} `, '😀'.repeat(501)])(
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
    expect(response.json().question).toBeNull();
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
      question: 'What is the total?',
    });
    expect(vi.mocked(model.describe).mock.calls[0]?.[0].question).toBe('What is the total?');
    expect(reservations).toMatchObject([{ at: new Date(response.json().capturedAt) }]);
    expect(bodies).toEqual([{ sessionId: '42', frame: '' }]);
  });

  it.each(['\\u0061', '\\ud83d\\ude00'])('accepts a maximum JPEG and 500 escaped Unicode code points (%s)', async (escaped) => {
    const { app, model } = createFixture();
    const image = Buffer.alloc(MAX_SCREEN_FRAME_BYTES);
    image[0] = 0xff;
    image[1] = 0xd8;
    image[image.length - 2] = 0xff;
    image[image.length - 1] = 0xd9;
    const response = await app.inject({
      method: 'POST', url: '/screen/frames',
      headers: { ...authorization, 'content-type': 'application/json' },
      payload: `{"sessionId":"42","frame":"${image.toString('base64')}","question":"${escaped.repeat(500)}"}`,
    });
    expect(response.statusCode).toBe(200);
    expect(vi.mocked(model.describe).mock.calls[0]?.[0].question).toBe(JSON.parse(`"${escaped.repeat(500)}"`));
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
    if (fail) expect(response.body).not.toContain('private-question-marker');
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
    if (reservation === 'rate-limited') {
      expect(response.json()).toEqual({
        error: 'Please wait before inspecting another screen frame.',
        code: 'frame_rate_limited', retryAfterMs: 3_000,
      });
    }
    if (reservation === 'limit') {
      expect(response.json()).toEqual({
        error: 'The daily screen-inspection limit has been reached.', code: 'daily_limit',
      });
    }
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
