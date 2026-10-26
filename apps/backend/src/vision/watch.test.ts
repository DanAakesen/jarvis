import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { conversationModule } from '../core/conversation.js';
import type { ConversationStore } from '../core/conversation-store.js';
import type { TokenVerifier } from '../auth/verify.js';
import { executeRealtimeToolCall } from '../voice/realtime.js';
import { DKK_PER_USD } from '../core/usage-pricing.js';
import type { ScreenVisionModel } from './screen.js';
import { createVisionWatchModule, VisionWatchService, type VisionWatchUsageStore } from './watch.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: `${['Bear', 'er'].join('')} a.b.c` };
const image = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]).toString('base64');
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture(options: {
  voiceNarration?: boolean;
  observation?: unknown;
  describe?: ScreenVisionModel['describe'];
  reserve?: VisionWatchUsageStore['reserveWatchFrame'];
  cost?: number;
  principal?: Awaited<ReturnType<TokenVerifier>>;
} = {}) {
  let now = Date.parse('2026-10-06T12:00:00Z');
  let usedDkk = 0;
  const session = { id: '42', channel: 'chat' as const, language: 'en' as const,
    startedAt: new Date(now), endedAt: null as Date | null };
  const addMessage = vi.fn(async (input: Parameters<ConversationStore['addMessage']>[0]) =>
    ({ ...input, id: '99', at: new Date(now) }));
  const conversations: ConversationStore = {
    createSession: async () => session, getSession: vi.fn(async () => session),
    endSession: async () => true, addMessage,
    getDanMessageIdBySourceItemId: async () => '7',
    getMessageSessionId: async () => '42',
    getLatestDanMessageText: async () => 'Did the build finish?',
    readRecentUserMessages: async () => [],
    getHistory: async () => ({ messages: [], nextCursor: null }),
    getDanMessagesAfter: async () => [],
  };
  const reserve = vi.fn(options.reserve ?? (async ({ limitDkk }) => ({
    outcome: usedDkk >= limitDkk ? 'limit' as const : 'reserved' as const, usedDkk,
  })));
  const record = vi.fn(async (input: Parameters<VisionWatchUsageStore['recordTokens']>[0]) => {
    usedDkk += input.costDkk ?? 0;
  });
  const usage: VisionWatchUsageStore = { reserveWatchFrame: reserve, recordTokens: record,
    readWatchBudget: async () => usedDkk };
  const model: ScreenVisionModel = {
    describe: vi.fn(options.describe ?? (async () => ({
      description: JSON.stringify(options.observation ?? { summary: 'Build failed.', noteworthy: true, speak: 'The build failed.' }),
      inputTokens: 100, outputTokens: 20, costDkk: options.cost ?? 0.0009,
      costUsd: (options.cost ?? 0.0009) / DKK_PER_USD,
    }))),
  };
  const service = new VisionWatchService(model, usage, conversations, () => now);
  const recordedTools: unknown[] = [];
  const app = buildApp(config, undefined, {
    auth: async () => options.principal ?? { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' },
    settingsStore: { read: async () => ({}), write: async () => {} },
    conversationStore: conversations,
    onConversationSessionEnded: (sessionId) => service.forgetSession(sessionId),
    toolCallStore: { record: async (input) => { recordedTools.push(input); } },
    modules: [coreModule, conversationModule, createVisionWatchModule(service), {
      id: 'voice-tool-test', tools: [],
      registerRoutes: async (app) => {
        app.post('/test/voice/watch-tool', async (request) => {
          request.jarvisConversationMessage = {
            id: '7', sessionId: '42', role: 'dan', text: 'Tell me when the build finishes', model: null, at: new Date(now),
          };
          return JSON.parse(await executeRealtimeToolCall({
            call_id: 'voice-watch-call', name: 'watch_for',
            arguments: JSON.stringify(options.voiceNarration
              ? { source: 'camera', what: 'Keep describing what you see', continuousDescription: true }
              : { source: 'screen', what: 'Tell me when the build finishes' }),
          }, app.jarvisTools, request, new AbortController().signal));
        });
      },
    }],
  });
  apps.push(app);
  const watch = (source: 'screen' | 'camera' = 'screen', sessionId = '42') => app.inject({
    method: 'POST', url: '/vision/watch', headers, payload: { sessionId, source, frame: image },
  });
  return { app, service, model, usage, conversations, addMessage, reserve, record, recordedTools, watch,
    advance: (ms: number) => { now += ms; }, setUsed: (value: number) => { usedDkk = value; } };
}

describe('continuous vision watching', () => {
  it('uses the same standing narration instruction for spoken requests and drops busy voice observations', async () => {
    const f = fixture({ voiceNarration: true });
    const response = await f.app.inject({ method: 'POST', url: '/test/voice/watch-tool', headers });
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { cameraFeed: 'unconfirmed' } });
    const speak = vi.fn(() => false);
    f.service.registerVoice('42', speak);
    await f.watch('camera');
    expect(speak).toHaveBeenCalledOnce();
    expect(f.addMessage).not.toHaveBeenCalled();
    speak.mockReturnValue(true);
    f.advance(2_600);
    await f.watch('camera');
    expect(speak).toHaveBeenCalledTimes(2);
    expect(vi.mocked(f.model.describe).mock.lastCall![0].watch).toMatchObject({ continuousDescription: true });
  });

  it('clears only the matching delivery generation on camera off and rejects unauthenticated stops', async () => {
    const f = fixture();
    const feedId = 'a1b2c3d4-1234-4123-8123-123456789012';
    await f.app.inject({ method: 'POST', url: '/vision/watch', headers,
      payload: { sessionId: '42', source: 'camera', frame: image, feedId } });
    const payload = { sessionId: '42', source: 'camera', feedId };
    expect((await f.app.inject({ method: 'DELETE', url: '/vision/watch', payload })).statusCode).toBe(401);
    f.service.stopFeed('42', 'camera', 'older-feed');
    expect(f.service.feedStatus('42', 'camera')).toBe('receiving');
    expect((await f.app.inject({ method: 'DELETE', url: '/vision/watch', headers, payload })).statusCode).toBe(204);
    expect(f.service.feedStatus('42', 'camera')).toBe('unconfirmed');
  });

  it('reports delivery truthfully and narrates repeated unchanged frames only on explicit standing instruction', async () => {
    const f = fixture();
    expect(f.service.feedStatus('42', 'camera')).toBe('unconfirmed');
    await f.service.setInstruction('42', 'camera', 'Keep describing what you see until I stop', true);
    await f.watch('camera');
    expect(f.service.feedStatus('42', 'camera')).toBe('receiving');
    f.advance(2_600);
    await f.watch('camera');
    expect(f.addMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(f.model.describe).mock.lastCall![0].watch).toMatchObject({ continuousDescription: true });
    await f.service.setInstruction('42', 'camera', null);
    f.advance(2_600);
    await f.watch('camera');
    expect(f.addMessage).toHaveBeenCalledTimes(2);
    f.advance(15_000);
    expect(f.service.feedStatus('42', 'camera')).toBe('unconfirmed');
  });

  it('accepts typed keep-describing instructions without claiming capture started', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/tools/watch_for',
      headers: { ...headers, 'x-jarvis-message-id': '7' },
      payload: { source: 'camera', what: 'Keep describing what you see', continuousDescription: true } });
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { instructionsSaved: true, cameraFeed: 'unconfirmed' } });
    await f.watch('camera');
    expect(vi.mocked(f.model.describe).mock.lastCall![0].watch).toMatchObject({ continuousDescription: true });
  });

  it('releases in-memory watch state through the successful conversation-end lifecycle, across sibling plugins', async () => {
    const f = fixture({ observation: { summary: 'Editor', noteworthy: false, speak: null } });
    await f.service.setInstruction('42', 'screen', 'Tell me when the build finishes');
    await f.watch();
    const forget = vi.spyOn(f.service, 'forgetSession');
    const response = await f.app.inject({
      method: 'POST', url: '/conversation/sessions/42/end', headers,
    });
    expect(response.statusCode).toBe(204);
    expect(forget).toHaveBeenCalledWith('42');
    f.advance(2_500);
    await f.watch();
    expect(vi.mocked(f.model.describe).mock.lastCall![0].watch).toMatchObject({
      previousSummary: '', instructions: [],
    });
  });

  it('returns the contract, posts noteworthy comments as Jarvis chat, and clears image bytes', async () => {
    const f = fixture();
    const response = await f.watch();
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      summary: 'Build failed.', speak: 'The build failed.', budget: { usedUsd: 0.0009 / DKK_PER_USD, limitUsd: 1 },
    });
    expect(f.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: '42', role: 'jarvis', text: 'The build failed.', model: 'gpt-6-luna',
    }));
    const call = vi.mocked(f.model.describe).mock.calls[0]![0];
    expect(call.image.every((byte) => byte === 0)).toBe(true);
    expect(call.watch).toMatchObject({ source: 'screen', previousSummary: '', latestQuestion: 'Did the build finish?' });
    expect(f.record).toHaveBeenCalledOnce();
  });

  it('keeps quiet frames silent and carries per-source summaries and instructions only in memory', async () => {
    const f = fixture({ observation: { summary: 'An editor.', noteworthy: false, speak: null } });
    await f.service.setInstruction('42', 'screen', 'Tell me when the build finishes');
    await f.watch();
    f.advance(2_500);
    await f.watch('camera');
    f.advance(2_500);
    await f.watch();
    expect(f.addMessage).not.toHaveBeenCalled();
    const calls = vi.mocked(f.model.describe).mock.calls;
    expect(calls[0]![0].watch?.instructions).toEqual(['Tell me when the build finishes']);
    expect(calls[1]![0].watch).toMatchObject({ source: 'camera', previousSummary: '', instructions: [] });
    expect(calls[2]![0].watch?.previousSummary).toBe('An editor.');
    await f.service.setInstruction('42', 'screen', null);
    f.advance(2_500);
    await f.watch();
    expect(vi.mocked(f.model.describe).mock.lastCall![0].watch?.instructions).toEqual([]);
  });

  it('discards narration computed before the camera feed was stopped', async () => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => { finish = resolve; });
    const f = fixture({ describe: async () => {
      await held;
      return { description: JSON.stringify({ summary: 'A room.', noteworthy: true, speak: 'I see a room.' }),
        inputTokens: 100, outputTokens: 20, costDkk: 0.001 };
    } });
    await f.service.setInstruction('42', 'camera', 'Keep describing', true);
    const feedId = 'a1b2c3d4-1234-4123-8123-123456789012';
    const response = f.app.inject({ method: 'POST', url: '/vision/watch', headers,
      payload: { sessionId: '42', source: 'camera', frame: image, feedId } });
    await vi.waitFor(() => expect(f.model.describe).toHaveBeenCalledOnce());
    f.service.stopFeed('42', 'camera', feedId);
    finish();
    expect((await response).json().speak).toBeNull();
    expect(f.addMessage).not.toHaveBeenCalled();
    expect(f.record).toHaveBeenCalledOnce();
  });

  it('cancels a comment write already awaiting persistence when its feed stops', async () => {
    const f = fixture();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => { finish = resolve; });
    f.addMessage.mockImplementationOnce(async (input) => {
      await held;
      return { ...input, id: '99', at: new Date() };
    });
    const feedId = 'a1b2c3d4-1234-4123-8123-123456789012';
    const response = f.app.inject({ method: 'POST', url: '/vision/watch', headers,
      payload: { sessionId: '42', source: 'camera', frame: image, feedId } });
    await vi.waitFor(() => expect(f.addMessage).toHaveBeenCalledOnce());
    const signal = f.addMessage.mock.calls[0]![0].signal;
    f.service.stopFeed('42', 'camera', feedId);
    expect(signal?.aborted).toBe(true);
    finish();
    expect((await response).json().speak).toBeNull();
  });

  it('ignores an old DELETE after a replacement feed has delivered', async () => {
    const f = fixture();
    const oldFeed = 'a1b2c3d4-1234-4123-8123-123456789012';
    const newFeed = 'a1b2c3d4-1234-4123-8123-123456789013';
    for (const feedId of [oldFeed, newFeed]) {
      await f.app.inject({ method: 'POST', url: '/vision/watch', headers,
        payload: { sessionId: '42', source: 'camera', frame: image, feedId } });
      f.advance(2_600);
    }
    await f.app.inject({ method: 'DELETE', url: '/vision/watch', headers,
      payload: { sessionId: '42', source: 'camera', feedId: oldFeed } });
    expect(f.service.feedStatus('42', 'camera')).toBe('receiving');
    f.service.stopFeed('42', 'camera', newFeed);
    expect(f.service.feedStatus('42', 'camera')).toBe('unconfirmed');
  });

  it('does not revive receiving status when a cancelled frame finishes session lookup', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(f.service.watch({ sessionId: '42', source: 'camera', image: Buffer.from('fixture'),
      limitUsd: 1, signal: controller.signal, log: () => {} })).rejects.toThrow();
    expect(f.model.describe).not.toHaveBeenCalled();
    expect(f.service.feedStatus('42', 'camera')).toBe('unconfirmed');
  });

  it('dedupes normalized repeated issues across sources for two minutes', async () => {
    const f = fixture();
    expect((await f.watch()).json().speak).toBe('The build failed.');
    f.advance(2_500);
    expect((await f.watch('camera')).json().speak).toBeNull();
    f.advance(120_000);
    expect((await f.watch()).json().speak).toBe('The build failed.');
    expect(f.addMessage).toHaveBeenCalledTimes(2);
  });

  it('dedupes simultaneous screen and camera comments while delivery is pending', async () => {
    const f = fixture();
    let finish!: () => void;
    const delivered = new Promise<void>((resolve) => { finish = resolve; });
    f.addMessage.mockImplementationOnce(async (input) => {
      await delivered;
      return { ...input, id: '99', at: new Date() };
    });
    const screen = f.watch();
    await vi.waitFor(() => expect(f.addMessage).toHaveBeenCalledOnce());
    const camera = await f.watch('camera');
    expect(camera.json().speak).toBeNull();
    finish();
    await screen;
    expect(f.addMessage).toHaveBeenCalledOnce();
  });

  it('delivers through an active voice and falls back to chat when speaking is unavailable or disconnected', async () => {
    const f = fixture();
    const speak = vi.fn(() => true);
    const unregister = f.service.registerVoice('42', speak);
    await f.watch();
    expect(speak).toHaveBeenCalledWith('The build failed.');
    expect(f.addMessage).not.toHaveBeenCalled();
    f.advance(120_000);
    speak.mockReturnValue(false);
    await f.watch();
    expect(f.addMessage).toHaveBeenCalledOnce();
    unregister();
    f.advance(120_000);
    await f.watch();
    expect(speak).toHaveBeenCalledTimes(2);
    expect(f.addMessage).toHaveBeenCalledTimes(2);
  });

  it('refuses the shared daily budget before model work and resumes on the next UTC day', async () => {
    const f = fixture();
    f.setUsed(DKK_PER_USD);
    const response = await f.watch('camera');
    expect(response.statusCode).toBe(429);
    expect(response.json().error).toContain('next UTC day');
    expect(f.model.describe).not.toHaveBeenCalled();
    expect(f.addMessage).not.toHaveBeenCalled();
    f.advance(24 * 60 * 60_000);
    f.setUsed(0);
    expect((await f.watch()).statusCode).toBe(200);
  });

  it('does not announce the frame that reaches the budget', async () => {
    const f = fixture({ cost: DKK_PER_USD });
    expect((await f.watch()).json()).toMatchObject({ speak: null, budget: { usedUsd: 1, limitUsd: 1 } });
    expect(f.addMessage).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'rate-limited'] as const)('handles %s reservations before inference', async (outcome) => {
    const f = fixture({ reserve: async () => ({ outcome, usedDkk: 0 }) });
    expect((await f.watch()).statusCode).toBe(outcome === 'inactive' ? 404 : 429);
    expect(f.model.describe).not.toHaveBeenCalled();
  });

  it.each([
    { summary: 'Editor', noteworthy: false, speak: 'Unwanted comment' },
    { summary: '', noteworthy: true, speak: 'Error' },
    { summary: 'Editor', noteworthy: true, speak: 'Error', extra: 'unexpected' },
  ])('charges malformed responses without delivering them', async (observation) => {
    const f = fixture({ observation });
    expect((await f.watch()).statusCode).toBe(503);
    expect(f.record).toHaveBeenCalledOnce();
    expect(f.addMessage).not.toHaveBeenCalled();
  });

  it('clears frames and reports sanitized model errors', async () => {
    let frame: Buffer | undefined;
    const f = fixture({ describe: async ({ image }) => { frame = image; throw new Error('provider-private'); } });
    const response = await f.watch();
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('provider-private');
    expect(frame?.every((byte) => byte === 0)).toBe(true);
  });

  it('rejects unauthenticated requests, invalid IDs, sources, and JPEGs before model work', async () => {
    const f = fixture();
    expect((await f.app.inject({ method: 'POST', url: '/vision/watch', payload: { sessionId: '42', source: 'screen', frame: image } })).statusCode).toBe(401);
    expect((await f.watch('screen', '9223372036854775808')).statusCode).toBe(400);
    for (const payload of [
      { sessionId: '42', source: 'other', frame: image },
      { sessionId: '42', source: 'camera', frame: Buffer.from('invalid').toString('base64') },
    ]) expect((await f.app.inject({ method: 'POST', url: '/vision/watch', headers, payload })).statusCode).toBe(400);
    expect(f.model.describe).not.toHaveBeenCalled();
  });

  it('refuses agent identity on the Dan-only watch endpoint', async () => {
    const f = fixture({ principal: { kind: 'jarvis-agent', objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId } });
    expect((await f.watch()).statusCode).toBe(403);
    expect(f.model.describe).not.toHaveBeenCalled();
  });

  it('accepts direct realtime voice tools through their trusted conversation context without HTTP message headers', async () => {
    const f = fixture({ observation: { summary: 'Build running.', noteworthy: false, speak: null } });
    const tool = await f.app.inject({ method: 'POST', url: '/test/voice/watch-tool', headers, payload: {} });
    expect(tool.statusCode).toBe(200);
    expect(tool.json()).toMatchObject({ outcome: 'ok', result: { instructionsSaved: true, source: 'screen', cameraFeed: 'unconfirmed' } });
    await f.watch();
    expect(vi.mocked(f.model.describe).mock.lastCall![0].watch?.instructions).toEqual(['Tell me when the build finishes']);
  });

  it('makes watch and stop tools available for chat and voice with redacted audits', async () => {
    const f = fixture({ observation: { summary: 'Editor', noteworthy: false, speak: null } });
    const tool = await f.app.inject({
      method: 'POST', url: '/tools/watch_for', headers: { ...headers, 'x-jarvis-message-id': '7' },
      payload: { what: 'Tell me when the build finishes' },
    });

    expect(tool.json()).toMatchObject({ outcome: 'ok', result: { instructionsSaved: true, source: 'both' } });
    await f.watch('camera');
    expect(vi.mocked(f.model.describe).mock.lastCall![0].watch?.instructions).toEqual(['Tell me when the build finishes']);
    const stop = await f.app.inject({
      method: 'POST', url: '/tools/stop_watching_for', headers: { ...headers, 'x-jarvis-voice-item-id': 'item-1' },
      payload: { source: 'camera' },
    });
    expect(stop.json()).toMatchObject({ outcome: 'ok', result: { stopped: 'camera' } });
    f.advance(2_500);
    await f.watch('camera');
    expect(vi.mocked(f.model.describe).mock.lastCall![0].watch?.instructions).toEqual([]);
    expect(f.recordedTools).toMatchObject([
      { arguments: { redacted: true }, result: { redacted: true } },
      { arguments: { redacted: true }, result: { redacted: true } },
    ]);
    const invalid = await f.app.inject({
      method: 'POST', url: '/tools/watch_for', headers: { ...headers, 'x-jarvis-message-id': '7' },
      payload: { what: 'x'.repeat(301) },
    });
    expect(invalid.statusCode).toBe(200);
    expect(invalid.json()).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('Invalid arguments:') } });
    expect(f.recordedTools).toHaveLength(2);
  });
});
