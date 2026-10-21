import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationStore } from '../core/conversation-store.js';
import { createLogger } from '../logging.js';
import { createVoiceRelayModule } from './relay.js';

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  sent: string[] = [];
  failSend = false;
  close = vi.fn((code: number, reason: string) => {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  });
  terminate = vi.fn(() => this.close(1006, ''));
  send(data: string, options?: unknown, callback?: (error?: Error) => void) {
    this.sent.push(data);
    const done = typeof options === 'function' ? options as typeof callback : callback;
    done?.(this.failSend ? new Error('private send error') : undefined);
  }
  open() { this.readyState = WebSocket.OPEN; this.emit('open'); }
  event(type: string) { this.emit('message', Buffer.from(JSON.stringify({ type })), false); }
}

type Handler = (browser: WebSocket, request: FastifyRequest) => void;
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await Promise.all([...app.shutdownConnections].map((close) => close().catch(() => {})));
    await app.close();
  }
  vi.useRealTimers();
});

async function fixture(overrides: Partial<BuildAppOptions> = {}, language: 'en' | 'da' = 'en') {
  vi.useFakeTimers();
  const records: Record<string, unknown>[] = [];
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) { records.push(JSON.parse(chunk.toString())); done(); },
  });
  const upstream = new FakeSocket();
  const browser = new FakeSocket();
  browser.readyState = WebSocket.OPEN;
  const connect = vi.fn(() => upstream as unknown as WebSocket);
  const store = {
    createSession: vi.fn(async () => ({ id: '41', channel: 'voice', language, startedAt: new Date(), endedAt: null })),
    endSession: vi.fn(async () => true),
  } as unknown as ConversationStore;
  const handlers = new Map<string, Handler>();
  const voice = createVoiceRelayModule({ getToken: async () => 'unused', connect });
  const config = { ...loadConfig({}), logLevel: 'info' as const };
  const app = buildApp(config, createLogger(config, undefined, output), {
    conversationStore: store,
    ...overrides,
    modules: [{
      id: 'voice-startup-test',
      tools: [{
        name: 'startup_probe', description: 'private instructions'.repeat(200),
        inputSchema: { type: 'object', properties: {} }, execute: async () => ({}),
      }],
      async registerRoutes(instance) {
        const get = vi.spyOn(instance, 'get').mockImplementation(((path: string, _options: unknown, handler: Handler) => {
          handlers.set(path, handler);
          return instance;
        }) as typeof instance.get);
        await voice.registerRoutes(instance);
        get.mockRestore();
      },
    }],
  });
  apps.push(app);
  await app.ready();
  handlers.get(language === 'da' ? '/voice/da' : '/voice')!(
    browser as unknown as WebSocket,
    { log: app.log, requestStartedAt: performance.now(), principal: { objectId: config.auth.ownerObjectId } } as FastifyRequest,
  );
  await vi.advanceTimersByTimeAsync(0);
  return {
    app, upstream, browser, connect, store, records,
    summaries: () => records.filter((record) => record.msg === 'voice.session_summary'),
    timeouts: () => records.filter((record) => record.msg === 'voice.stage_timeout'),
  };
}

describe('voice startup without network', () => {
  it('closes a silent accepted upstream at 15 seconds with exactly one content-free summary', async () => {
    const f = await fixture();
    f.upstream.open();
    const payload = f.upstream.sent[0]!;
    await vi.advanceTimersByTimeAsync(14_999);
    expect(f.browser.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.browser.close).toHaveBeenCalledWith(4010, 'Voice service did not become ready');
    expect(f.timeouts()).toEqual([expect.objectContaining({
      stage: 'upstream_ready', lastStage: 'session_update_sent', timeoutMs: 15_000, elapsedMs: 15_000,
    })]);
    expect(f.summaries()).toEqual([expect.objectContaining({
      language: 'en', closedBy: 'relay', closeCode: 4010, durationMs: 15_000,
      toolCount: 1, totalBytes: Buffer.byteLength(payload), events: [],
      largestTools: [{ name: 'startup_probe', bytes: expect.any(Number) }],
      stages: expect.arrayContaining([
        { stage: 'session_created', elapsedMs: 0 },
        { stage: 'upstream_open', elapsedMs: 0 },
        { stage: 'session_update_sent', elapsedMs: 0 },
      ]),
    })]);
    expect(JSON.stringify(f.records)).not.toContain('private');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.summaries()).toHaveLength(1);
    expect(f.timeouts()).toHaveLength(1);
  });

  it('does not wait for session persistence before closing on the watchdog deadline', async () => {
    const f = await fixture();
    let saved!: (result: boolean) => void;
    vi.mocked(f.store.endSession).mockImplementation(() => new Promise((resolve) => { saved = resolve; }));
    f.upstream.open();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.browser.close).toHaveBeenCalledWith(4010, 'Voice service did not become ready');
    expect(f.summaries()).toHaveLength(1);
    saved(true);
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each(['en', 'da'] as const)('records readiness and cancels the watchdog for %s', async (language) => {
    const f = await fixture({}, language);
    f.upstream.open();
    f.upstream.event('session.created');
    if (language === 'en') f.upstream.event('session.updated');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.browser.close).not.toHaveBeenCalled();
    f.browser.close(1000, 'private browser reason');
    expect(f.summaries()).toEqual([expect.objectContaining({
      closedBy: 'browser', closeCode: 1000,
      events: language === 'en' ? ['session.created', 'session.updated'] : ['session.created'],
      stages: expect.arrayContaining([expect.objectContaining({
        stage: language === 'en' ? 'session_updated' : 'session_created_received',
      })]),
    })]);
    expect(f.timeouts()).toEqual([]);
    expect(JSON.stringify(f.summaries())).not.toContain('private');
  });

  it('does not treat session.created as English readiness', async () => {
    const f = await fixture();
    f.upstream.open();
    f.upstream.event('session.created');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.browser.close).toHaveBeenCalledWith(4010, 'Voice service did not become ready');
  });

  it('summarizes an early upstream close once with its original code', async () => {
    const f = await fixture();
    f.upstream.open();
    f.upstream.close(1013, 'private upstream reason');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.summaries()).toEqual([expect.objectContaining({
      closedBy: 'upstream', closeCode: 1013, events: [], toolCount: 1,
    })]);
    expect(f.browser.close).toHaveBeenCalledWith(1011, 'Voice connection ended');
    expect(f.timeouts()).toEqual([]);
    expect(JSON.stringify(f.summaries())).not.toContain('private');
  });

  it('bounds an upstream that never opens', async () => {
    const f = await fixture();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.upstream.terminate).toHaveBeenCalledOnce();
    expect(f.browser.close).toHaveBeenCalledWith(4010, 'Voice service did not become ready');
    expect(f.timeouts()).toEqual([expect.objectContaining({
      stage: 'upstream_connecting', lastStage: 'upstream_connecting',
    })]);
    expect(f.summaries()).toHaveLength(1);
  });

  it('logs a send callback failure instead of silently closing', async () => {
    const f = await fixture();
    f.upstream.failSend = true;
    f.upstream.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.records).toContainEqual(expect.objectContaining({
      msg: 'voice.connection_failed', failure: 'upstream_send_failed',
    }));
    expect(f.summaries()).toHaveLength(1);
    expect(f.browser.close).toHaveBeenCalledWith(1011, 'Voice connection failed');
  });

  it('reports a not-open send instead of silently discarding session.update', async () => {
    const f = await fixture();
    f.upstream.emit('open');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.records).toContainEqual(expect.objectContaining({
      msg: 'voice.connection_failed', failure: 'upstream_not_open',
    }));
    expect(f.summaries()).toEqual([expect.objectContaining({
      toolCount: 1, totalBytes: expect.any(Number), closedBy: 'relay',
    })]);
    expect(f.browser.close).toHaveBeenCalledWith(1011, 'Voice connection failed');
  });

  it('summarizes shutdown once and cancels its startup deadline', async () => {
    const f = await fixture();
    f.upstream.open();
    await Promise.all([...f.app.shutdownConnections].map((close) => close()));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.summaries()).toEqual([expect.objectContaining({ closedBy: 'shutdown', closeCode: 1012 })]);
    expect(f.timeouts()).toEqual([]);
  });

  it('cancels pre-connect deadlines when the browser leaves', async () => {
    const f = await fixture({
      settingsStore: { read: () => new Promise<never>(() => {}) } as unknown as BuildAppOptions['settingsStore'],
    });
    f.browser.close(1000, '');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.timeouts()).toEqual([]);
    expect(f.summaries()).toHaveLength(1);
  });

  it('bounds session creation, does not connect, and cleans up a late-created session', async () => {
    let created!: (session: { id: string }) => void;
    const f = await fixture({
      conversationStore: {
        createSession: vi.fn(() => new Promise((resolve) => { created = resolve; })),
        endSession: vi.fn(async () => true),
      } as unknown as ConversationStore,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.browser.close).toHaveBeenCalledWith(1011, 'Voice session could not be saved');
    expect(f.records).toContainEqual(expect.objectContaining({ msg: 'voice.connection_failed' }));
    expect(f.timeouts()).toEqual([expect.objectContaining({ stage: 'session_creation' })]);
    created({ id: '42' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.app.conversationStore!.endSession).toHaveBeenCalledWith('42');
    expect(f.summaries()).toHaveLength(1);
  });

  it.each(['settings', 'catalogue', 'away_mode', 'project_context'] as const)(
    'falls back after a stalled %s read and ignores late work', async (stage) => {
      const pending = () => new Promise<never>(() => {});
      const f = await fixture({
        ...(stage === 'settings' || stage === 'catalogue' ? {
          settingsStore: { read: stage === 'settings' ? pending : async () => [] } as unknown as BuildAppOptions['settingsStore'],
        } : {}),
        ...(stage === 'catalogue' ? { modelCatalogue: { read: pending } } : {}),
        ...(stage === 'away_mode' ? {
          awayModeStore: { read: pending } as unknown as BuildAppOptions['awayModeStore'],
        } : {}),
        ...(stage === 'project_context' ? {
          projectStore: { list: pending } as unknown as BuildAppOptions['projectStore'],
        } : {}),
      });
      expect(f.connect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(f.connect).toHaveBeenCalledOnce();
      expect(f.timeouts()).toEqual([expect.objectContaining({
        stage: stage === 'catalogue' ? 'settings' : stage, timeoutMs: 5_000,
      })]);
      f.upstream.open();
      f.upstream.event('session.updated');
      f.browser.close(1000, '');
    },
  );
});
