import { Writable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { ServerResponse } from 'node:http';
import type { FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logging.js';
import { shutdown } from '../shutdown.js';
import { ChatAgentError, createFoundryAgentSessionId } from './chat-agent.js';
import type { ConversationStore } from './conversation-store.js';
import type { ReflexClassifier } from './reflex.js';
import type { ToolCallStore } from './tool-calls.js';
import { createConversationModule } from './conversation.js';
import { FrameStore } from '../vision/frame-store.js';
import { createOwnerInteractionService, type OwnerInteractionService } from './owner-interactions.js';

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
    readRecentUserMessages: vi.fn(async () => []),
    getDanMessagesAfter: vi.fn(async () => []),
    ...overrides,
  } satisfies ConversationStore;
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const headers = { authorization: ['Bearer', 'a.b.c'].join(' ') };

describe('conversation routes', () => {
  it('delivers only food invitations bound to the active source and removes its event subscription', async () => {
    const confirmation = { id: 'a'.repeat(43), actionKind: 'other' as const,
      summary: 'Synthetic estimate: 200 kcal.', expiresAt: new Date(Date.now() + 120_000).toISOString() };
    const app = createApp(storeFixture({
      addMessage: vi.fn(async input => ({ ...message, ...input })),
    }), { conversationAgent: { stream: async function* () {
      app.nowEventHub.publish({ type: 'food_estimate_pending', sessionId: '99', sourceMessageId: '42',
        confirmation: { ...confirmation, summary: 'Other session secret' } });
      app.nowEventHub.publish({ type: 'food_estimate_pending', sessionId: '41', sourceMessageId: '40',
        confirmation: { ...confirmation, summary: 'Earlier source secret' } });
      app.nowEventHub.publish({ type: 'food_estimate_pending', sessionId: '41', sourceMessageId: '42', confirmation });
      yield 'No food has been logged.';
    } } });
    const originalSubscribe = app.nowEventHub.subscribe.bind(app.nowEventHub);
    const unsubscribe = vi.fn();
    vi.spyOn(app.nowEventHub, 'subscribe').mockImplementation(listener => {
      const stop = originalSubscribe(listener);
      return () => { unsubscribe(); stop(); };
    });
    const response = await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns',
      headers, payload: { text: 'Estimate this portion.' } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(`event: food_invitation\ndata: ${JSON.stringify(confirmation)}`);
    expect(response.body).not.toContain('Other session secret');
    expect(response.body).not.toContain('Earlier source secret');
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it.each([
    { outcome: 'image', path: 'image', reason: 'image_accepted' },
    { outcome: 'rejected', path: 'caption', reason: 'image_rejected' },
    { outcome: 'caption', path: 'caption', reason: 'image_unavailable' },
    { outcome: 'legacy', path: 'caption', reason: 'legacy_agent' },
    { outcome: 'unavailable', path: 'caption', reason: 'frame_unavailable' },
    { outcome: 'screen', path: 'caption', reason: 'legacy_agent' },
    { outcome: 'none', path: undefined, reason: undefined },
    { outcome: 'failed', path: undefined, reason: undefined },
  ])('logs the final $outcome chat visual result once before done, without content', async ({ outcome, path, reason }) => {
    const records: string[] = [];
    const ordering: string[] = [];
    const sink = { trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}) };
    const output = new Writable({ write(chunk: Buffer, _encoding, done) {
      const record = JSON.parse(chunk.toString()) as { msg: string };
      if (record.msg === 'visual.path') ordering.push('visual.path');
      records.push(chunk.toString());
      done();
    } });
    const agent = { stream: vi.fn(async function* (input: import('./chat-agent.js').ConversationAgentInput) {
      if (outcome === 'image' || outcome === 'rejected') {
        input.onVisualResult?.({ visualPath: 'caption', visualReason: 'image_unavailable' });
        input.onVisualResult?.(outcome === 'image' ? { visualPath: 'image' } :
          { visualPath: 'caption', visualReason: 'image_rejected' });
      }
      if (outcome === 'caption') input.onVisualResult?.({ visualPath: 'caption' });
      if (outcome === 'failed') throw new Error('Agent failed');
      yield 'private-answer';
    }) };
    const app = buildApp(config, createLogger(config, sink, output), {
      auth, conversationStore: storeFixture(), conversationAgent: agent,
    });
    apps.push(app);
    app.addHook('onRequest', async (_request, reply) => {
      const write = reply.raw.write.bind(reply.raw);
      vi.spyOn(reply.raw, 'write').mockImplementation((...args) => {
        if (String(args[0]).includes('event: done')) ordering.push('done');
        return write(...args);
      });
    });
    const response = await app.inject({
      method: 'POST', url: '/conversation/sessions/41/turns', headers,
      payload: {
        text: 'private-prompt',
        ...(outcome === 'none' ? {} : outcome === 'screen' ? { screenContext: 'private-description' } : {
          visualContext: {
            source: 'camera', capturedAt: '2026-10-11T19:30:00Z', description: 'private-description',
            question: 'private-question', ...(outcome === 'unavailable' ? { frameId: 'private-frame' } : {}),
          },
        }),
      },
    });
    expect(response.statusCode).toBe(200);
    const visualRecords = records.map((record) => JSON.parse(record) as Record<string, unknown>)
      .filter((record) => record.msg === 'visual.path');
    const traces = sink.trackTrace.mock.calls.map(([trace]) => trace)
      .filter((trace) => trace.message === 'visual.path');
    if (path === undefined) {
      expect(visualRecords).toEqual([]);
      expect(traces).toEqual([]);
      expect(ordering).toEqual(outcome === 'failed' ? [] : ['done']);
    } else {
      expect(visualRecords).toEqual([{
        level: 30, time: expect.any(Number), service: 'jarvis-backend',
        msg: 'visual.path', path, reason, channel: 'chat', latencyMs: expect.any(Number),
      }]);
      expect(traces).toEqual([expect.objectContaining({
        message: 'visual.path',
        properties: { service: 'jarvis-backend', path, reason, channel: 'chat', latencyMs: expect.any(Number) },
      })]);
      expect(ordering).toEqual(['visual.path', 'done']);
      expect(JSON.stringify(visualRecords) + JSON.stringify(traces)).not.toContain('private');
      if (outcome === 'caption') {
        const done = response.body.split('event: done\ndata: ')[1]!.split('\n')[0]!;
        expect(JSON.parse(done)).toHaveProperty('visualPath', 'caption');
        expect(JSON.parse(done)).not.toHaveProperty('visualReason');
      }
    }
  });

  it('passes owner-scoped session affinity and logs only allowlisted agent timings', async () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) {
      records.push(chunk.toString());
      done();
    } });
    const seenSessionIds: Array<string | undefined> = [];
    const agent = { stream: vi.fn(async function* (input: import('./chat-agent.js').ConversationAgentInput) {
      seenSessionIds.push(input.agentSessionId);
      input.onAgentPhaseTimings?.({
        chat_context: 12.5, model_request: 1000, model_auth_max: 7000, model_request_max: 20000,
      });
      input.onAgentSessionTelemetry?.({
        sessionIdUsed: true, sessionStartType: 'warm', platformMs: 18, agentMs: 4,
      });
      yield 'answer';
    }) };
    const app = buildApp(config, createLogger(config, undefined, output), {
      auth, conversationStore: storeFixture(), conversationAgent: agent,
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST', url: '/conversation/sessions/41/turns', headers,
      payload: { text: 'private-prompt' },
    });
    const expectedSessionId = createFoundryAgentSessionId(config.auth.ownerObjectId, '41');
    expect(response.statusCode).toBe(200);
    expect(seenSessionIds).toEqual([expectedSessionId]);
    const done = JSON.parse(response.body.split('event: done\ndata: ')[1]!.split('\n')[0]!) as
      Record<string, unknown>;
    expect(done.agentTimings).toEqual({ chat_context: 12.5, model_request: 1000 });
    const events = records.map((record) => JSON.parse(record) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({
      msg: 'chat.agent_session', sessionIdUsed: true, sessionStartType: 'warm',
      platformMs: 18, agentMs: 4,
    }));
    expect(events).toContainEqual(expect.objectContaining({
      msg: 'chat.latency', phase: 'chat_context', durationMs: 12.5,
    }));
    expect(events).toContainEqual(expect.objectContaining({
      msg: 'chat.latency', phase: 'model_auth_max', durationMs: 7000,
    }));
    expect(events).toContainEqual(expect.objectContaining({
      msg: 'chat.latency', phase: 'model_request_max', durationMs: 20000,
    }));
    expect(JSON.stringify(events)).not.toContain('private-prompt');
    expect(JSON.stringify(events)).not.toContain(expectedSessionId);
  });

  it('binds an image to the authorized immutable Dan message and persists no frame handle', async () => {
    const frames = new FrameStore();
    const frameId = await frames.put({ ownerObjectId: config.auth.ownerObjectId,
      sessionId: '41', turnId: 'capture', image: await sharp({
        create: { width: 20, height: 20, channels: 3, background: 'red' },
      }).jpeg().toBuffer() });
    const setVisualContext = vi.fn(async () => true);
    const store = storeFixture({ setVisualContext });
    const visualContext = { source: 'screen' as const, capturedAt: '2026-10-11T19:30:00Z',
      description: 'A red square.', frameId, turnId: 'capture' };
    const agent = { stream: vi.fn(async function* (input: import('./chat-agent.js').ConversationAgentInput) {
      expect(frames.consume(frameId, { ownerObjectId: config.auth.ownerObjectId,
        sessionId: '41', messageId: input.messageId, turnId: 'capture' })).toBeInstanceOf(Buffer);
      input.onVisualResult?.({ visualPath: 'image' });
      yield 'A red square.';
    }) };
    try {
      const app = createApp(store, { modules: [createConversationModule(frames)], conversationAgent: agent });
      const response = await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns',
        headers, payload: { text: 'What is this?', visualContext } });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('"visualPath":"image"');
      const saved = store.addMessage.mock.calls[0]![0]!.visualContext!;
      expect(saved).not.toHaveProperty('frameId');
      expect(setVisualContext).toHaveBeenCalledWith(expect.objectContaining({
        visualContext: expect.objectContaining({ visualPath: 'image' }),
      }));
    } finally { frames.close(); }
  });

  it('persists real deferred-caption evidence for a description-free handle without retaining the handle', async () => {
    const frames = new FrameStore();
    const frameId = await frames.put({ ownerObjectId: config.auth.ownerObjectId,
      sessionId: '41', turnId: 'capture', image: await sharp({
        create: { width: 20, height: 20, channels: 3, background: 'red' },
      }).jpeg().toBuffer() });
    const setVisualContext = vi.fn(async () => true);
    const store = storeFixture({ setVisualContext });
    const visualContext = { source: 'screen' as const, capturedAt: '2026-10-11T19:30:00Z', frameId, turnId: 'capture' };
    const agent = { stream: vi.fn(async function* (input: import('./chat-agent.js').ConversationAgentInput) {
      expect(input.visualContext).toEqual(visualContext);
      input.onVisualResult?.({ visualPath: 'caption', visualReason: 'image_rejected',
        description: 'A real red square.', captionMs: 25 });
      yield 'A red square.';
    }) };
    try {
      const app = createApp(store, { modules: [createConversationModule(frames)], conversationAgent: agent });
      const response = await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns',
        headers, payload: { text: 'What is this?', visualContext } });
      expect(response.statusCode).toBe(200);
      const saved = store.addMessage.mock.calls[0]![0]!.visualContext!;
      expect(saved).not.toHaveProperty('description');
      expect(saved).not.toHaveProperty('frameId');
      expect(setVisualContext).toHaveBeenCalledWith({ sessionId: '41', messageId: '42',
        visualContext: { source: 'screen', capturedAt: visualContext.capturedAt, turnId: 'capture',
          description: 'A real red square.', visualPath: 'caption', visualReason: 'image_rejected' } });
    } finally { frames.close(); }
  });

  it.each(['image', 'failure', 'another-message'] as const)(
    'discards the owned retained frame after %s but never discards a frame bound to another message', async (outcome) => {
      const frames = new FrameStore();
      const identity = { ownerObjectId: config.auth.ownerObjectId, sessionId: '41', turnId: 'capture', messageId: '42' };
      const frameId = await frames.put({ ...identity, image: await sharp({
        create: { width: 20, height: 20, channels: 3, background: 'red' },
      }).jpeg().toBuffer() });
      if (outcome === 'another-message') frames.bind(frameId, { ...identity, messageId: '99' });
      const store = storeFixture();
      const visualContext = { source: 'camera' as const, capturedAt: '2026-10-11T19:30:00Z', frameId, turnId: 'capture' };
      const agent = { stream: vi.fn(async function* (input: import('./chat-agent.js').ConversationAgentInput) {
        if (outcome !== 'another-message') {
          const image = frames.resolve(frameId, identity);
          expect(image).toBeInstanceOf(Buffer);
          image!.fill(0);
          expect(frames.metadata(frameId, identity)).toBeDefined();
          if (outcome === 'failure') throw new Error('Provider unavailable');
          input.onVisualResult?.({ visualPath: 'image' });
        }
        yield 'Image response.';
      }) };
      try {
        const app = createApp(store, { modules: [createConversationModule(frames)], conversationAgent: agent });
        const response = await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns',
          headers, payload: { text: 'What is this?', visualContext } });
        expect(response.statusCode).toBe(200);
        if (outcome === 'failure') expect(response.body).toContain('event: error');
        else expect(response.body).toContain('Image response.');
        if (outcome === 'another-message') expect(frames.metadata(frameId, { ...identity, messageId: '99' })).toBeDefined();
        else expect(frames.consume(frameId, identity)).toBeUndefined();
      } finally { frames.close(); }
    });

  it.each(['a'.repeat(31), 'shortmissing', 'a'.repeat(128)])('continues with caption for unavailable frame %s and rejects caller path metadata', async (frameId) => {
    const store = storeFixture();
    const agent = { stream: vi.fn(async function* () { yield 'Caption answer.'; }) };
    const app = createApp(store, { conversationAgent: agent });
    const visualContext = { source: 'screen' as const, capturedAt: '2026-10-11T19:30:00Z',
      description: 'A chart.', frameId };
    expect((await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns', headers,
      payload: { text: 'What?', visualContext } })).statusCode).toBe(200);
    expect(agent.stream.mock.calls[0]![0]!.visualContext).not.toHaveProperty('frameId');
    expect((await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns', headers,
      payload: { text: 'What?', visualContext: { ...visualContext, visualPath: 'image' } } })).statusCode).toBe(400);
  });

  it.each(['missing', 'expired', 'foreign'] as const)(
    'keeps a description-free %s handle for authenticated resolver failure rather than invalid agent input', async (outcome) => {
      let now = Date.now();
      const frames = new FrameStore(60_000, 128, () => now);
      let frameId = 'missing_frame';
      if (outcome !== 'missing') {
        frameId = await frames.put({ ownerObjectId: outcome === 'foreign' ? 'foreign-owner' : config.auth.ownerObjectId,
          sessionId: '41', turnId: 'capture', image: await sharp({
            create: { width: 20, height: 20, channels: 3, background: 'red' },
          }).jpeg().toBuffer() });
        if (outcome === 'expired') now += 60_000;
      }
      const setVisualContext = vi.fn(async () => true);
      const store = storeFixture({ setVisualContext });
      const visualContext = { source: 'camera' as const, capturedAt: '2026-10-11T19:30:00Z', frameId, turnId: 'capture' };
      const agent = { stream: vi.fn(async function* (input: import('./chat-agent.js').ConversationAgentInput) {
        expect(input.visualContext).toEqual(visualContext);
        expect(frames.resolve(frameId, { ownerObjectId: config.auth.ownerObjectId,
          sessionId: '41', messageId: input.messageId, turnId: 'capture' })).toBeUndefined();
        input.onVisualResult?.({ visualPath: 'caption', visualReason: 'frame_unavailable' });
        yield 'No image or caption is available. Please let me look again.';
      }) };
      try {
        const app = createApp(store, { modules: [createConversationModule(frames)], conversationAgent: agent });
        const response = await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns',
          headers, payload: { text: 'What is this?', visualContext } });
        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('No image or caption is available');
        expect(store.addMessage.mock.calls[0]![0]!.visualContext).not.toHaveProperty('frameId');
        expect(setVisualContext).toHaveBeenCalledWith({ sessionId: '41', messageId: '42',
          visualContext: { source: 'camera', capturedAt: visualContext.capturedAt, turnId: 'capture',
            visualPath: 'caption', visualReason: 'frame_unavailable' } });
      } finally { frames.close(); }
    });

  it('never replies twice to a completed visual turn replay', async () => {
    let sourceItemId: string | undefined;
    const store = storeFixture({
      getDanMessageIdBySourceItemId: vi.fn(async (id) => sourceItemId === id ? '42' : null),
      addMessage: vi.fn(async (input) => {
        if (input.sourceItemId) sourceItemId = input.sourceItemId;
        return message;
      }),
    });

    const agent = { stream: vi.fn(async function* () { yield 'One answer.'; }) };
    const app = createApp(store, { conversationAgent: agent });
    const payload = { text: 'What?', visualContext: { source: 'screen',
      capturedAt: '2026-10-11T19:30:00Z', description: 'A chart.', frameId: 'a'.repeat(32) } };
    expect((await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns', headers, payload })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns', headers, payload })).statusCode).toBe(409);
    expect(agent.stream).toHaveBeenCalledOnce();
  });
  it('streams the acknowledgment before the final reply without persisting it as part of that reply', async () => {
    const stored: { role: string; text: string }[] = [];
    const store = storeFixture({
      addMessage: vi.fn(async (input) => {
        stored.push({ role: input.role, text: input.text });
        return { ...message, role: input.role, text: input.text };
      }),
    });
    const acknowledgment = "I'll check the saved targets.";
    const agent = {
      stream: vi.fn(async function* () {
        yield acknowledgment;
        yield { type: 'acknowledgment' as const, text: acknowledgment };
        yield 'The targets match.';
      }),
    };
    const app = createApp(store, { conversationAgent: agent });

    const response = await app.inject({
      method: 'POST', url: '/conversation/sessions/41/turns', headers,
      payload: { text: 'Compare my saved targets.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.indexOf(`event: delta\ndata: ${JSON.stringify({ text: acknowledgment })}`))
      .toBeLessThan(response.body.indexOf(`event: acknowledgment\ndata: ${JSON.stringify({ text: acknowledgment })}`));
    expect(response.body.indexOf('event: acknowledgment'))
      .toBeLessThan(response.body.indexOf(`event: delta\ndata: {"text":"The targets match."}`));
    expect(stored).toEqual([
      { role: 'dan', text: 'Compare my saved targets.' },
      { role: 'jarvis', text: 'The targets match.' },
    ]);
  });
  it('persists camera provenance, forwards it unchanged, and exposes additive history metadata', async () => {
    const visualContext = {
      source: 'camera' as const, capturedAt: '2026-10-11T19:30:00Z', description: 'A red mug.',
      question: 'What colour?', turnId: 'item_A-1',
    };
    const store = storeFixture({ getHistory: vi.fn(async () => ({
      ...history, messages: [{ ...history.messages[0]!, metadata: { visualContext } }],
    })) });
    const agent = { stream: vi.fn(async function* () { yield 'A red mug.'; }) };
    const app = createApp(store, { conversationAgent: agent });
    const response = await app.inject({
      method: 'POST', url: '/conversation/sessions/41/turns', headers,
      payload: { text: 'What is this?', visualContext },
    });
    expect(response.statusCode).toBe(200);
    expect(store.addMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'dan', visualContext }));
    expect(agent.stream).toHaveBeenCalledWith(expect.objectContaining({ visualContext }), headers.authorization, expect.any(AbortSignal));
    const page = await app.inject({ url: '/conversation/history', headers });
    expect(page.json().messages[0].metadata).toEqual({ visualContext });
    for (const invalid of [
      { visualContext, screenContext: 'legacy' },
      { visualContext: { ...visualContext, capturedAt: 'yesterday' } },
      { visualContext: { ...visualContext, description: 'x'.repeat(5_001) } },
      { visualContext: { ...visualContext, question: 123 } },
      { visualContext: { ...visualContext, question: false } },
      { visualContext: { ...visualContext, question: ['coercion'] } },
      { visualContext: { ...visualContext, question: 'x'.repeat(501) } },
      { visualContext: { ...visualContext, question: '😀'.repeat(501) } },
      { visualContext: { ...visualContext, turnId: 123 } },
      { visualContext: { ...visualContext, turnId: null } },
      { visualContext: { ...visualContext, turnId: 'x'.repeat(129) } },
      { visualContext: { ...visualContext, turnId: 'item.123' } },
    ]) {
      expect((await app.inject({
        method: 'POST', url: '/conversation/sessions/41/turns', headers,
        payload: { text: 'What is this?', ...invalid },
      })).statusCode).toBe(400);
    }
  });
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
    expect(chatAgent.stream).toHaveBeenCalledWith(expect.objectContaining({
      messageId: '42',
      sessionId: '41',
      agentSessionId: createFoundryAgentSessionId(config.auth.ownerObjectId, '41'),
      onAgentPhaseTimings: expect.any(Function),
      onAgentSessionTelemetry: expect.any(Function),
      onVisualResult: expect.any(Function),
      turnId: '42',
      text: 'Hej Jarvis',
      language: 'da',
      visualContext: {
        source: 'screen', capturedAt: expect.any(String), description: 'A browser window shows a chart.',
      },
    }), headers.authorization, expect.any(AbortSignal));
    expect(store.addMessage).toHaveBeenCalledWith({
      sessionId: '41',
      role: 'dan',
      text: 'Hej Jarvis',
      model: null,
      language: 'da',
      visualContext: {
        source: 'screen', capturedAt: expect.any(String), description: 'A browser window shows a chart.',
      },
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

  it('resolves a natural food reply without aborting or replaying the active model/tool round', async () => {
    const service = createOwnerInteractionService({ ownerObjectId: config.auth.ownerObjectId,
      conversationStore: { getDanMessagesAfter: vi.fn(async () => [{ id: '43', text: 'yes, log that', language: 'en' }]) }, store: {
      createConfirmation: vi.fn(async () => {}),
      resolveConfirmation: vi.fn(async () => 'approved'),
      consumeApproval: vi.fn(async () => true),
      cancelConfirmation: vi.fn(async () => {}),
      expireConfirmation: vi.fn(async () => false),
      expirePendingConfirmations: vi.fn(async () => {}),
    } });
    const approval = { id: '43', text: 'yes, log that', language: 'en' as const };
    const store = storeFixture({
      addMessage: vi.fn(async input => ({ ...message, at: new Date(),
        id: input.role === 'dan' && input.text === approval.text ? '43' : '42', role: input.role, text: input.text })),
      getDanMessagesAfter: vi.fn(async ({ after }) => BigInt(after) < 43n ? [approval] : []),
    });
    const action = vi.fn(async () => 'Logged.');
    const appRef: { current?: ReturnType<typeof buildApp> } = {};
    const chatAgent = { stream: vi.fn(async function* (_input, _auth, signal: AbortSignal) {
      const pending = service.runConfirmed('other', 'Log synthetic portion: 200 kcal.', action, signal,
        { channel: 'browser', lifetimeSeconds: 120, foodEstimate: { sessionId: '41', sourceMessageId: '42' } });
      await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
      const response = await appRef.current!.inject({
        method: 'POST', url: '/conversation/sessions/41/steer', headers,
        payload: { text: approval.text, language: 'en' },
      });
      expect(response.statusCode).toBe(202);
      expect(signal.aborted).toBe(false);
      yield await pending;
    }) };
    const app = createApp(store, { ownerInteractions: service, conversationAgent: chatAgent });
    appRef.current = app;
    const response = await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns', headers,
      payload: { text: 'Review synthetic portion.' } });
    expect(response.body).toContain('event: done');
    expect(response.body).toContain('Logged.');
    expect(response.body).not.toContain('event: interrupted');
    expect(chatAgent.stream).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
  });

  it.each(['approve', 'cancel', 'expire', 'disconnect_after_commit'] as const)('recovers a disconnected exact food proposal: %s', async decision => {
    const service = createOwnerInteractionService({ ownerObjectId: config.auth.ownerObjectId,
      onConfirmationPending: (confirmation, foodEstimate) => {
        if (foodEstimate) app.nowEventHub.publish({ type: 'food_estimate_pending', ...foodEstimate, confirmation });
      },
      onConfirmationsChanged: () => app.nowEventHub.publish({ type: 'refresh' }),
      store: {
        createConfirmation: vi.fn(async () => {}), resolveConfirmation: vi.fn(async () => 'approved'),
        consumeApproval: vi.fn(async () => true), cancelConfirmation: vi.fn(async () => {}),
        expireConfirmation: vi.fn(async () => true), expirePendingConfirmations: vi.fn(async () => {}),
      } });
    const committed = Promise.withResolvers<void>();
    const deliver = Promise.withResolvers<void>();
    const approved = decision === 'approve' || decision === 'disconnect_after_commit';
    const action = vi.fn(async () => { committed.resolve(); return 'Synthetic meal saved once.'; });
    const store = storeFixture({ addMessage: vi.fn(async input => ({ ...message, ...input,
      id: input.role === 'dan' ? '42' : '44' })) });
    let agentSignal!: AbortSignal;
    const agent = { stream: vi.fn(async function* (_input, _auth, signal: AbortSignal) {
      agentSignal = signal;
      const result = await service.runConfirmed('other', 'Synthetic portion: 200 kcal.', action, signal,
        { channel: 'browser', lifetimeSeconds: 120, foodEstimate: { sessionId: '41', sourceMessageId: '42' } });
      if (decision === 'disconnect_after_commit') await deliver.promise;
      yield result;
    }) };
    const app = createApp(store, { conversationAgent: agent, ownerInteractions: service });
    // Fetch may retain pooled sockets after abort/replay on Node 22. Dispose this
    // fixture's transports only during teardown, after all recovery assertions.
    app.addHook('preClose', async () => { app.server.closeAllConnections(); });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const transport = new AbortController();
    const response = await fetch(`${address}/conversation/sessions/41/turns`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Estimate synthetic meal' }), signal: transport.signal,
    });
    const reader = response.body!.getReader();
    let wire = '';
    while (!wire.includes('food_invitation')) wire += new TextDecoder().decode((await reader.read()).value);
    const invitation = service.pendingBrowserConfirmations()[0]!;
    for (const suffix of ['events', 'cancel']) {
      const wrongSession = await app.inject({ method: suffix === 'events' ? 'GET' : 'POST',
        url: `/conversation/sessions/99/turns/42/${suffix}`, headers });
      expect(wrongSession.statusCode).toBe(404);
    }
    expect(agentSignal.aborted).toBe(false);
    expect(action).not.toHaveBeenCalled();
    if (decision === 'disconnect_after_commit') {
      await service.resolveBrowserConfirmation(invitation.id, 'approve');
      await committed.promise; // Side effect committed, final response deliberately not emitted yet.
      expect(action).toHaveBeenCalledOnce();
    }
    transport.abort();
    await reader.cancel().catch(() => {});
    expect(agentSignal.aborted).toBe(false);
    expect(invitation.summary).toBe('Synthetic portion: 200 kcal.');
    const replay = fetch(`${address}/conversation/sessions/41/turns/42/events`, { headers });
    if (decision === 'approve') await service.resolveBrowserConfirmation(invitation.id, 'approve');
    else if (decision === 'cancel') await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns/42/cancel', headers });
    else if (decision === 'disconnect_after_commit') deliver.resolve();
    else {
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 121_000);
      await service.expirePendingConfirmations();
      expect(await service.resolveBrowserConfirmation(invitation.id, 'approve')).toBe(false);
      vi.restoreAllMocks();
    }
    const recovered = await (await replay).text();
    expect(recovered).toContain(approved ? 'event: done' : 'event: error');
    expect(action).toHaveBeenCalledTimes(approved ? 1 : 0);
    // A second attachment after the write/response cannot execute the meal again.
    const again = await app.inject({ method: 'GET', url: '/conversation/sessions/41/turns/42/events', headers });
    expect(again.body).toBe(recovered);
    expect(agent.stream).toHaveBeenCalledOnce();
    expect(agent.stream).toHaveBeenCalledWith(expect.objectContaining({ messageId: '42', turnId: '42' }),
      headers.authorization, expect.any(AbortSignal));
    expect(service.pendingBrowserConfirmations()).toHaveLength(0);
  });

  it('does not let an older approval interrupt the response to a newer cancellation', async () => {
    const olderReply = Promise.withResolvers<boolean>();
    const resolveFoodEstimateReply = vi.fn(async (reply: { id: string }) => reply.id === '43' ? olderReply.promise : true);
    const store = storeFixture({
      addMessage: vi.fn(async input => ({ ...message, role: input.role, text: input.text,
        id: input.text === 'yes, log that' ? '43' : input.text === 'cancel' ? '44' : '42' })),
    });
    const appRef: { current?: ReturnType<typeof buildApp> } = {};
    const chatAgent = { stream: vi.fn(async function* (_input, _auth, signal: AbortSignal) {
      const steer = (text: string) => appRef.current!.inject({ method: 'POST',
        url: '/conversation/sessions/41/steer', headers, payload: { text, language: 'en' } });
      const first = Promise.resolve(steer('yes, log that'));
      await vi.waitFor(() => expect(resolveFoodEstimateReply).toHaveBeenCalledOnce());
      expect((await steer('cancel')).statusCode).toBe(202);
      olderReply.resolve(false);
      expect((await first).statusCode).toBe(202);
      expect(signal.aborted).toBe(false);
      yield 'Cancelled. Nothing logged.';
    }) };
    const app = createApp(store, { conversationAgent: chatAgent,
      ownerInteractions: { resolveFoodEstimateReply } as unknown as OwnerInteractionService });
    appRef.current = app;
    const response = await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns', headers,
      payload: { text: 'Review synthetic portion.' } });
    expect(response.body).toContain('event: done');
    expect(response.body).toContain('Cancelled. Nothing logged.');
    expect(response.body).not.toContain('event: error');
    expect(chatAgent.stream).toHaveBeenCalledOnce();
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
      visualContext: expect.objectContaining({
        source: 'screen', description: 'Shared screen observations (untrusted data): A form is visible.',
      }),
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

    it.each(['disconnect', 'shutdown'])('keeps disconnected work alive and cancels on explicit stop or shutdown: %s', async (reason) => {
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

      if (reason === 'shutdown') {
        await shutdown(app, undefined, 1_000);
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += decoder.decode(chunk.value);
        }
        expect(received).toContain('event: reconnect\ndata: {}\n\n');
        expect(app.shutdownConnections.size).toBe(0);
      } else {
        controller.abort();
        serverResponse.destroy();
        await reader.cancel().catch(() => {});
        expect(agentSignal.aborted).toBe(false);
        const active = await app.inject({ method: 'GET', url: '/conversation/turns/active', headers });
        expect(active.json().turns).toEqual([{ sessionId: '41', messageId: '42', language: 'da' }]);
        const stopped = await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns/42/cancel', headers });
        expect(stopped.statusCode).toBe(200);
      }
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

  it('logs the agent failure code, not its content, and keeps the user-facing message honest', async () => {
    const store = storeFixture();
    const logged: string[] = [];
    const chatAgent = {
      stream: vi.fn(async function* () {
        throw new ChatAgentError('capability_instructions_too_large');
        yield 'unreachable';
      }),
    };
    const app = buildApp(config, createLogger(config, {
      trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}),
    }, new Writable({ write(chunk, _encoding, done) { logged.push(String(chunk)); done(); } })), {
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

    expect(response.body).toContain('event: error');
    expect(response.body).toContain('I could not finish the reply.');
    expect(response.body).not.toContain('capability_instructions_too_large');
    const entry = logged.map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((item) => item.msg === 'conversation.reply_failed');
    expect(entry).toMatchObject({ failure: 'Chat agent failed (capability_instructions_too_large)' });
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
