import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationStore } from '../core/conversation-store.js';
import { defaultAwayModeState } from '../core/away-mode.js';
import { createLogger } from '../logging.js';
import type { JarvisTool } from '../core/tool-registry.js';
import { createRealtimeSessionUpdate, TOOLS_UNAVAILABLE_NOTICE } from './realtime.js';
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
  event(type: string, extra: Record<string, unknown> = {}) {
    this.emit('message', Buffer.from(JSON.stringify({ type, ...extra })), false);
  }
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

function probeTool(name: string, size = 0, execute: JarvisTool['execute'] = async () => ({})): JarvisTool {
  return {
    name, description: 'private',
    inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'x'.repeat(size) } } }, execute,
  };
}

async function fixture(
  overrides: Partial<BuildAppOptions> = {}, language: 'en' | 'da' = 'en', extraTools: JarvisTool[] = [],
  probeEnabled = false,
) {
  vi.useFakeTimers();
  const records: Record<string, unknown>[] = [];
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) { records.push(JSON.parse(chunk.toString())); done(); },
  });
  const upstream = new FakeSocket();
  const browser = new FakeSocket();
  browser.readyState = WebSocket.OPEN;
  const sockets = [upstream];
  // Sockets after the first open themselves; `onFrame` plays the upstream's answer to each startup frame.
  const behaviour: { autoOpen: boolean; onFrame?: (socket: FakeSocket) => void } = { autoOpen: true };
  let connections = 0;
  const connect = vi.fn(() => {
    connections += 1;
    if (connections === 1) return upstream as unknown as WebSocket;
    const socket = new FakeSocket();
    sockets.push(socket);
    if (behaviour.autoOpen) {
      void Promise.resolve().then(() => {
        socket.open();
        behaviour.onFrame?.(socket);
      });
    }
    return socket as unknown as WebSocket;
  });
  const store = {
    createSession: vi.fn(async () => ({ id: '41', channel: 'voice', language, startedAt: new Date(), endedAt: null })),
    endSession: vi.fn(async () => true),
  } as unknown as ConversationStore;
  const handlers = new Map<string, Handler>();
  const voice = createVoiceRelayModule({ getToken: async () => 'unused', connect, toolBudgetProbeEnabled: probeEnabled });
  const config = { ...loadConfig({}), logLevel: 'info' as const };
  const app = buildApp(config, createLogger(config, undefined, output), {
    conversationStore: store,
    ...overrides,
    modules: [{
      id: 'voice-startup-test',
      tools: [{
        name: 'startup_probe', description: 'private instructions'.repeat(200),
        inputSchema: { type: 'object', properties: {} }, execute: async () => ({}),
      }, ...extraTools],
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
  const start = async (target: FakeSocket = browser) => {
    handlers.get(language === 'da' ? '/voice/da' : '/voice')!(
      target as unknown as WebSocket,
    {
      log: app.log, requestStartedAt: performance.now(), principal: { objectId: config.auth.ownerObjectId },
      validateInput: () => true,
    } as unknown as FastifyRequest,
    );
    await vi.advanceTimersByTimeAsync(0);
  };
  await start();
  const messages = (msg: string) => records.filter((record) => record.msg === msg);
  return {
    app, upstream, browser, connect, store, records, sockets, behaviour, start,
    summaries: () => messages('voice.session_summary'),
    timeouts: () => messages('voice.stage_timeout'),
    attempts: () => messages('voice.tool_budget_attempt'),
    selected: () => messages('voice.tool_budget_selected'),
    exhausted: () => messages('voice.tool_budget_exhausted'),
    /** Opens the first socket and lets `onFrame` answer its startup frame. */
    openFirst() { upstream.open(); behaviour.onFrame?.(upstream); },
  };
}

const frameOf = (socket: FakeSocket, index = 0) => JSON.parse(socket.sent[index]!) as {
  session: { instructions: string; tools: { name: string }[]; turn_detection: Record<string, unknown> };
};
const toolNames = (socket: FakeSocket) => frameOf(socket).session.tools.map(({ name }) => name);
const frameBytes = (socket: FakeSocket) => Buffer.byteLength(socket.sent[0]!);

describe('voice startup without network', () => {
  it('closes a silent accepted Danish upstream at 15 seconds with exactly one content-free summary', async () => {
    const f = await fixture({}, 'da');
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
      language: 'da', closedBy: 'relay', closeCode: 4010, durationMs: 15_000,
      toolCount: 1, totalBytes: Buffer.byteLength(payload), events: [],
      largestTools: [{ name: 'startup_probe', bytes: expect.any(Number) }],
      stages: expect.arrayContaining([
        { stage: 'session_created', elapsedMs: 0 },
        { stage: 'upstream_open', elapsedMs: 0 },
        { stage: 'session_update_sent', elapsedMs: 0 },
      ]),
    })]);
    expect(JSON.stringify(f.records)).not.toContain('private');
    expect(f.records.some((record) => String(record.msg).startsWith('voice.tool_budget'))).toBe(false);
    expect(f.summaries()[0]).not.toHaveProperty('toolBudgetRung');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.summaries()).toHaveLength(1);
    expect(f.timeouts()).toHaveLength(1);
    expect(f.connect).toHaveBeenCalledOnce();
  });

  it('does not wait for session persistence before closing when every rung has failed', async () => {
    const f = await fixture();
    let saved!: (result: boolean) => void;
    vi.mocked(f.store.endSession).mockImplementation(() => new Promise((resolve) => { saved = resolve; }));
    f.upstream.open();
    await vi.advanceTimersByTimeAsync(32_000);
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

  it('does not treat session.created as English readiness or forward it from an abandoned attempt', async () => {
    const f = await fixture();
    f.upstream.open();
    f.upstream.event('session.created');
    await vi.advanceTimersByTimeAsync(5_999);
    expect(f.connect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.browser.close).not.toHaveBeenCalled();
    expect(f.browser.sent).toEqual([]);
  });

  it('summarizes an early Danish upstream close once with its original code', async () => {
    const f = await fixture({}, 'da');
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

  it('bounds a Danish upstream that never opens', async () => {
    const f = await fixture({}, 'da');
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

  it('retains a presence change during handshake for initial configuration without failing startup', async () => {
    const f = await fixture({
      awayModeStore: { read: async () => ({ ...defaultAwayModeState, mode: 'away' }) } as BuildAppOptions['awayModeStore'],
    });
    f.app.nowEventHub.publish({
      type: 'mode_changed', mode: 'away', away: true, source: 'manual', changedAt: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.browser.close).not.toHaveBeenCalled();
    expect(f.upstream.sent).toEqual([]);
    f.upstream.open();
    const update = JSON.parse(f.upstream.sent[0]!);
    expect(update.session.instructions).toContain('away');
    f.upstream.event('session.updated');
    f.browser.close(1000, '');
    expect(f.summaries()).toHaveLength(1);
    expect(f.timeouts()).toEqual([]);
    expect(f.records.some((record) => record.msg === 'voice.connection_failed')).toBe(false);
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

  it.each(['false', 'rejection'])('reports late session cleanup failure (%s) after browser closure', async (failure) => {
    let created!: (session: { id: string }) => void;
    const endSession = vi.fn(async () => {
      if (failure === 'rejection') throw new Error('private database error');
      return false;
    });
    const f = await fixture({
      conversationStore: {
        createSession: () => new Promise((resolve) => { created = resolve; }), endSession,
      } as unknown as ConversationStore,
    });
    f.browser.close(1000, '');
    await vi.advanceTimersByTimeAsync(0);
    const warningsBefore = f.records.filter((record) => record.msg === 'voice.session_persistence_failed').length;
    created({ id: '42' });
    await vi.advanceTimersByTimeAsync(0);
    expect(endSession).toHaveBeenCalledWith('42');
    expect(f.records.filter((record) => record.msg === 'voice.session_persistence_failed')).toHaveLength(warningsBefore + 1);
    expect(f.summaries()).toHaveLength(1);
    expect(JSON.stringify(f.records)).not.toContain('private');
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

const catalogue = () => [
  probeTool('set_presence_mode', 500), probeTool('set_away_mode', 500), probeTool('daily_show', 6_000),
  probeTool('proactive_recent_items', 1_000), probeTool('proactive_preferences', 1_200),
  probeTool('github_write', 3_000),
  probeTool('workspace_command', 12_000), probeTool('tiny_tool', 100),
];
const names = (socket: FakeSocket) => toolNames(socket).sort();
const rungOf = (record: Record<string, unknown> | undefined) => record?.rung;
const emptyRegistry = { list: () => [], get: () => undefined };
const compactBytes = Buffer.byteLength(JSON.stringify(createRealtimeSessionUpdate(
  emptyRegistry, undefined, undefined, 'en', [], undefined, undefined, undefined, 'compact',
)));

describe('English voice tool-budget fallback', () => {
  it('starts at the known-good reduced frame without an R0 foreground attempt', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    f.upstream.event('session.created');
    f.upstream.event('session.updated');
    expect(names(f.upstream)).toEqual(['github_write', 'set_away_mode', 'set_presence_mode',
      'startup_probe', 'tiny_tool', 'workspace_command'].sort());
    expect(frameOf(f.upstream).session.instructions).toContain(TOOLS_UNAVAILABLE_NOTICE);
    expect(f.attempts()).toEqual([expect.objectContaining({
      rung: 'R2', outcome: 'ready', toolCount: 6, frameBytes: frameBytes(f.upstream),
      toolBytes: expect.any(Number), instructionsBytes: expect.any(Number), elapsedMs: 0,
    })]);
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R2', remembered: false })]);
    expect(f.browser.sent.map((data) => JSON.parse(data).type)).toEqual([
      'session.created', 'jarvis.session.ready', 'session.updated',
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.browser.close).not.toHaveBeenCalled();
    f.browser.close(1000, '');
    expect(f.summaries()).toEqual([expect.objectContaining({ toolBudgetRung: 'R2', toolBudgetAttempts: 1 })]);
    expect(f.connect).toHaveBeenCalledOnce();
  });

  it('starts its independent full probe only after readiness and never forwards probe events', async () => {
    const f = await fixture({}, 'en', catalogue(), true);
    f.behaviour.onFrame = (socket) => {
      socket.event('session.updated');
      socket.event('response.audio.delta');
    };
    f.upstream.open();
    f.upstream.event('session.created');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.records.some((record) => record.msg === 'voice.tool_budget_probe')).toBe(false);
    expect(f.browser.sent).toEqual([]);

    f.upstream.event('session.updated');
    expect(f.browser.sent.map((data) => JSON.parse(data).type)).toEqual([
      'session.created', 'jarvis.session.ready', 'session.updated',
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.attempts().map((record) => record.rung)).toEqual(['R2']);
    expect(f.records).toContainEqual(expect.objectContaining({
      msg: 'voice.tool_budget_probe', probe: 'full', outcome: 'ready',
    }));
    expect(f.browser.sent.map((data) => JSON.parse(data).type)).not.toContain('response.audio.delta');
  });

  it('remembers a full-ready probe so the next live session starts at R0', async () => {
    const f = await fixture({}, 'en', catalogue(), true);
    f.behaviour.onFrame = (socket) => { if (socket !== f.upstream) socket.event('session.updated'); };
    f.upstream.open();
    f.upstream.event('session.updated');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.records).toContainEqual(expect.objectContaining({
      msg: 'voice.tool_budget_probe', probe: 'full', outcome: 'ready',
    }));

    const browser = new FakeSocket();
    browser.readyState = WebSocket.OPEN;
    await f.start(browser);
    expect(names(f.sockets[2]!)).toContain('daily_show');
    expect(names(f.sockets[2]!)).toContain('proactive_recent_items');
    expect(names(f.sockets[2]!)).toContain('proactive_preferences');
    expect(f.attempts().at(-1)).toEqual(expect.objectContaining({ rung: 'R0', outcome: 'ready' }));
  });

  it('promotes a ready no-proactive probe to Health for later sessions, updates, and dispatch', async () => {
    const execute = vi.fn(async () => ({ status: 'available' }));
    const outsideExecute = vi.fn(async () => ({}));
    const f = await fixture({
      awayModeStore: {
        read: async () => ({ ...defaultAwayModeState, mode: 'away' }),
      } as BuildAppOptions['awayModeStore'],
    }, 'en', [
      probeTool('proactive_recent_items', 0, outsideExecute),
      {
        name: 'daily_health_summary',
        description: 'Read a Health summary.',
        inputSchema: {
          type: 'object', properties: { note: { type: 'string', minLength: 1 } },
          required: ['note'], additionalProperties: false,
        },
        execute,
      },
    ], true);
    f.behaviour.onFrame = (socket) => {
      if (socket === f.upstream) {
        socket.event('session.updated');
        return;
      }
      const names = toolNames(socket);
      if (names.includes('daily_health_summary') && !names.includes('proactive_recent_items')) {
        socket.event('session.updated');
      }
    };

    f.openFirst();
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R2' })]);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(f.records).toContainEqual(expect.objectContaining({
      msg: 'voice.tool_budget_probe', probe: 'full', outcome: 'timeout',
    }));
    expect(f.records).toContainEqual(expect.objectContaining({
      msg: 'voice.tool_budget_probe', probe: 'no_proactive', outcome: 'ready',
    }));

    const browser = new FakeSocket();
    browser.readyState = WebSocket.OPEN;
    await f.start(browser);
    const ready = f.sockets.at(-1)!;
    expect(f.selected().at(-1)).toEqual(expect.objectContaining({ rung: 'R1' }));
    expect(toolNames(ready)).toContain('daily_health_summary');
    expect(toolNames(ready)).not.toContain('proactive_recent_items');
    expect(toolNames(ready)).not.toContain('proactive_preferences');
    expect(frameOf(ready).session.instructions).toContain(TOOLS_UNAVAILABLE_NOTICE);

    f.app.nowEventHub.publish({
      type: 'mode_changed', mode: 'away', away: true, source: 'manual', changedAt: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    const update = frameOf(ready, ready.sent.length - 1).session;
    expect(update.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'daily_health_summary' }),
    ]));
    expect(update.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'proactive_recent_items' }),
    ]));
    expect(update.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'proactive_preferences' }),
    ]));
    expect(update.instructions).toContain(TOOLS_UNAVAILABLE_NOTICE);

    const activityEvents: unknown[] = [];
    f.app.jarvisActivityHub.subscribe((event) => activityEvents.push(event));
    ready.event('response.function_call_arguments.done', {
      name: 'daily_health_summary', call_id: 'health_call', arguments: '{"note":"health"}',
    });
    ready.event('response.function_call_arguments.done', {
      name: 'proactive_recent_items', call_id: 'outside_call', arguments: '{}',
    });
    await vi.advanceTimersByTimeAsync(0);
    const outputs = ready.sent.map((data) => JSON.parse(data))
      .filter((message) => message.item?.type === 'function_call_output')
      .map((message) => ({ callId: message.item.call_id, ...JSON.parse(message.item.output) }));
    expect(activityEvents).toContainEqual(expect.objectContaining({
      type: 'tool-call-started', toolName: 'daily_health_summary',
    }));
    expect(outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ callId: 'health_call', tool: 'daily_health_summary', outcome: 'ok' }),
      expect.objectContaining({ callId: 'outside_call', tool: 'proactive_recent_items', outcome: 'refused' }),
    ]));
    expect(execute).toHaveBeenCalledOnce();
    expect(outsideExecute).not.toHaveBeenCalled();

    browser.emit('message', Buffer.from(JSON.stringify({ type: 'response.create' })), false);
    await vi.advanceTimersByTimeAsync(0);
    const responseCreate = JSON.parse(ready.sent.at(-1)!);
    expect(responseCreate.response.instructions).toContain(TOOLS_UNAVAILABLE_NOTICE);
  });

  it.each([
    ['R2', 0], ['R3', 1], ['R4', 2], ['R5', 3],
  ] as const)('selects %s, the first rung below a silent byte threshold', async (rung, index) => {
    const f = await fixture({}, 'en', catalogue());
    // Measure each rung's frame in a throwaway session, then answer only frames that fit.
    const sizes: number[] = [];
    f.behaviour.onFrame = (socket) => { sizes.push(frameBytes(socket)); };
    f.upstream.open();
    f.behaviour.onFrame(f.upstream);
    await vi.advanceTimersByTimeAsync(6_000 * 4);
    expect(sizes).toHaveLength(4);
    expect(sizes.slice(1).every((size, i) => size < sizes[i]!)).toBe(true);

    const g = await fixture({}, 'en', catalogue());
    const threshold = sizes[index]!;
    g.behaviour.onFrame = (socket) => { if (frameBytes(socket) <= threshold) socket.event('session.updated'); };
    g.openFirst();
    await vi.advanceTimersByTimeAsync(6_000 * 4);
    expect(g.attempts().map(rungOf)).toEqual(['R2', 'R3', 'R4', 'R5'].slice(0, index + 1));
    expect(g.attempts().map((record) => record.outcome)).toEqual([
      ...Array(index).fill('timeout'), 'ready',
    ]);
    expect(g.selected()).toEqual([expect.objectContaining({ rung, remembered: false })]);
    const ready = g.sockets[index]!;
    if (rung === 'R2') {
      expect(names(ready)).not.toContain('daily_show');
      expect(names(ready)).not.toContain('proactive_recent_items');
      expect(names(ready)).not.toContain('proactive_preferences');
    }
    if (rung === 'R3') {
      expect(names(ready)).toEqual(expect.arrayContaining(['set_presence_mode', 'set_away_mode']));
      expect(names(ready)).not.toContain('workspace_command');
    }
    if (rung === 'R4' || rung === 'R5') expect(toolNames(ready)).toEqual([]);
    expect(frameOf(ready).session.instructions).toContain(TOOLS_UNAVAILABLE_NOTICE);
    expect(g.browser.close).not.toHaveBeenCalled();
  });

  it('gives each fallback rung six seconds and closes the abandoned socket', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    await vi.advanceTimersByTimeAsync(5_999);
    expect(f.connect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.upstream.close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_999);
    expect(f.connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.connect).toHaveBeenCalledTimes(3);
    expect(f.sockets[1]!.close).toHaveBeenCalled();
    expect(f.attempts()).toEqual([
      expect.objectContaining({ rung: 'R2', outcome: 'timeout', elapsedMs: 6_000 }),
      expect.objectContaining({ rung: 'R3', outcome: 'timeout', elapsedMs: 6_000 }),
    ]);
  });

  it('closes 4010 within 24 seconds and logs exhaustion when no rung ever answers', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    await vi.advanceTimersByTimeAsync(23_999);
    expect(f.browser.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.browser.close).toHaveBeenCalledWith(4010, 'Voice service did not become ready');
    expect(f.attempts().map(rungOf)).toEqual(['R2', 'R3', 'R4', 'R5']);
    expect(f.exhausted()).toEqual([expect.objectContaining({ attempts: 4 })]);
    expect(f.selected()).toEqual([]);
    expect(f.sockets).toHaveLength(4);
    expect(f.sockets.every((socket) => socket.readyState === WebSocket.CLOSED)).toBe(true);
    expect(f.summaries()).toEqual([expect.objectContaining({
      closedBy: 'relay', closeCode: 4010, toolBudgetRung: null, toolBudgetAttempts: 4, durationMs: 24_000,
    })]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.connect).toHaveBeenCalledTimes(4);
    expect(f.summaries()).toHaveLength(1);
  });

  it('steps down when the known-good R2 fails', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    f.upstream.event('session.created');
    f.upstream.event('error', { error: { code: 'private_code', message: 'private message' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.upstream.close).toHaveBeenCalled();
    f.sockets[1]!.event('session.created');
    f.sockets[1]!.event('session.updated');
    expect(f.attempts()).toEqual([
      expect.objectContaining({ rung: 'R2', outcome: 'error' }),
      expect.objectContaining({ rung: 'R3', outcome: 'ready' }),
    ]);
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R3', remembered: false })]);
    expect(f.browser.sent.map((data) => JSON.parse(data).type)).toEqual([
      'session.created', 'jarvis.session.ready', 'session.updated',
    ]);
    expect(f.browser.close).not.toHaveBeenCalled();
  });

  it('steps down when the upstream closes before session.updated', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    f.upstream.close(1013, 'private reason');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.attempts()).toEqual([expect.objectContaining({ rung: 'R2', outcome: 'closed' })]);
    expect(f.browser.close).not.toHaveBeenCalled();
    f.sockets[1]!.event('session.updated');
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R3' })]);
  });

  it('remembers the working rung for the next session and steps down from it, updating the memory', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    f.upstream.event('session.updated');
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R2', remembered: false })]);

    f.behaviour.onFrame = (socket) => socket.event('session.updated');
    const second = new FakeSocket();
    second.readyState = WebSocket.OPEN;
    await f.start(second);
    const next = f.sockets[1]!;
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(toolNames(next)).not.toContain('daily_show');
    expect(frameOf(next).session.instructions).toContain(TOOLS_UNAVAILABLE_NOTICE);
    expect(f.selected().at(-1)).toEqual(expect.objectContaining({ rung: 'R2', remembered: true }));

    // A third session fails at the remembered rung, steps down to R3 and remembers that.
    f.behaviour.onFrame = (socket) => { if (frameBytes(socket) < frameBytes(next)) socket.event('session.updated'); };
    const third = new FakeSocket();
    third.readyState = WebSocket.OPEN;
    await f.start(third);
    expect(f.connect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(f.attempts().slice(-2).map((record) => [record.rung, record.outcome])).toEqual([
      ['R2', 'timeout'], ['R3', 'ready'],
    ]);
    expect(f.selected().at(-1)).toEqual(expect.objectContaining({ rung: 'R3', remembered: false }));

    const fourth = new FakeSocket();
    fourth.readyState = WebSocket.OPEN;
    await f.start(fourth);
    expect(f.attempts().at(-1)).toEqual(expect.objectContaining({ rung: 'R3', outcome: 'ready' }));
    expect(f.selected().at(-1)).toEqual(expect.objectContaining({ rung: 'R3', remembered: true }));
  });

  it('keeps the known-good cold start when no session has ever reached session.updated', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    await vi.advanceTimersByTimeAsync(24_000);
    const second = new FakeSocket();
    second.readyState = WebSocket.OPEN;
    await f.start(second);
    expect(f.sockets).toHaveLength(5);
    expect(names(f.sockets[4]!)).not.toContain('daily_show');
    expect(frameOf(f.sockets[4]!).session.instructions).toContain(TOOLS_UNAVAILABLE_NOTICE);
    expect(f.selected()).toEqual([]);
  });

  it('clears every timer and closes every socket when the browser leaves during fallback', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    f.behaviour.autoOpen = false;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(f.connect).toHaveBeenCalledTimes(2);
    const pending = f.sockets[1]!;
    f.browser.close(1000, '');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.upstream.readyState).toBe(WebSocket.CLOSED);
    expect(pending.terminate).toHaveBeenCalled();
    expect(pending.readyState).toBe(WebSocket.CLOSED);
    expect(f.attempts()).toEqual([expect.objectContaining({ rung: 'R2', outcome: 'timeout' })]);
    expect(f.exhausted()).toEqual([]);
    expect(f.timeouts()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.summaries()).toHaveLength(1);
  });

  it('forwards nothing from an abandoned socket to the browser', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    f.upstream.event('session.created');
    await vi.advanceTimersByTimeAsync(6_000);
    const next = f.sockets[1]!;
    f.upstream.event('session.created');
    f.upstream.event('session.updated');
    f.upstream.event('response.audio.delta');
    f.upstream.emit('close', 1000, Buffer.from(''));
    f.upstream.emit('error', new Error('private late error'));
    expect(f.browser.sent).toEqual([]);
    expect(f.selected()).toEqual([]);
    next.event('session.updated');
    f.upstream.event('response.audio.delta');
    next.event('response.audio.delta');
    expect(f.browser.sent.map((data) => JSON.parse(data).type)).toEqual([
      'jarvis.session.ready', 'session.updated', 'response.audio.delta',
    ]);
    expect(f.browser.close).not.toHaveBeenCalled();
  });

  async function reduced(rung: 'R4' | 'R5', overrides: Partial<BuildAppOptions> = {}) {
    const f = await fixture(overrides, 'en', catalogue());
    const limit = rung === 'R5' ? compactBytes + 200 : 0;
    f.behaviour.onFrame = (socket) => {
      const frame = frameOf(socket).session;
      if (rung === 'R5' ? frameBytes(socket) <= limit : frame.tools.length === 0) socket.event('session.updated');
    };
    f.openFirst();
    await vi.advanceTimersByTimeAsync(8_000 + 6_000 * 4);
    const ready = f.sockets.at(-1)!;
    expect(f.selected()).toEqual([expect.objectContaining({ rung })]);
    return { f, ready };
  }

  it.each(['R4', 'R5'] as const)('sends presence updates, camera updates and response.create at %s without the catalogue', async (rung) => {
    const { f, ready } = await reduced(rung, {
      awayModeStore: { read: async () => ({ ...defaultAwayModeState, mode: 'away' }) } as BuildAppOptions['awayModeStore'],
    });
    const before = ready.sent.length;
    f.app.nowEventHub.publish({
      type: 'mode_changed', mode: 'away', away: true, source: 'manual', changedAt: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready.sent).toHaveLength(before + 1);
    const presence = frameOf(ready, before).session;
    expect(presence.tools).toEqual([]);
    expect(presence.instructions).toContain(TOOLS_UNAVAILABLE_NOTICE);
    expect(presence.instructions.includes('Visual grounding')).toBe(rung === 'R4');

    f.browser.emit('message', Buffer.from(JSON.stringify({ type: 'jarvis.camera.state', on: true })), false);
    await vi.advanceTimersByTimeAsync(0);
    const camera = JSON.parse(ready.sent.at(-1)!) as { type: string; session: Record<string, unknown> };
    expect(camera.type).toBe('session.update');
    expect(Object.keys(camera.session)).toEqual(['turn_detection']);

    f.browser.emit('message', Buffer.from(JSON.stringify({ type: 'jarvis.camera.state', on: false })), false);
    f.browser.emit('message', Buffer.from(JSON.stringify({ type: 'response.create' })), false);
    await vi.advanceTimersByTimeAsync(0);
    const created = JSON.parse(ready.sent.at(-1)!) as { type: string; response: { instructions: string } };
    expect(created.type).toBe('response.create');
    expect(created.response.instructions).toContain(TOOLS_UNAVAILABLE_NOTICE);
    expect(created.response.instructions.includes('Visual grounding')).toBe(rung === 'R4');
  });

  it('refuses a model call to a tool outside the active subset without executing it', async () => {
    const execute = vi.fn(async () => ({}));
    const f = await fixture({}, 'en', [probeTool('daily_show', 100, execute), probeTool('allowed_tool', 100)]);
    f.behaviour.onFrame = (socket) => { if (!toolNames(socket).includes('daily_show')) socket.event('session.updated'); };
    f.openFirst();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    const ready = f.sockets[0]!;
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R2' })]);
    ready.event('response.function_call_arguments.done', { name: 'daily_show', call_id: 'call_1', arguments: '{}' });
    ready.event('response.function_call_arguments.done', { name: 'allowed_tool', call_id: 'call_2', arguments: '{}' });
    await vi.advanceTimersByTimeAsync(0);
    const outputs = ready.sent.map((data) => JSON.parse(data))
      .filter((message) => message.item?.type === 'function_call_output')
      .map((message) => ({ call: message.item.call_id, ...JSON.parse(message.item.output) }));
    expect(outputs).toEqual([
      expect.objectContaining({ call: 'call_1', tool: 'daily_show', outcome: 'refused' }),
      expect.not.objectContaining({ call: 'call_2', outcome: 'refused' }),
    ]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps tool names, descriptions and instruction text out of the new logs', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    f.upstream.event('error', { error: { code: 'private_code', message: 'private message' } });
    f.behaviour.autoOpen = true;
    await vi.advanceTimersByTimeAsync(32_000);
    const budget = f.records.filter((record) => String(record.msg).startsWith('voice.tool_budget'));
    expect(budget.length).toBeGreaterThanOrEqual(5);
    const text = JSON.stringify(budget);
    for (const secret of ['private', 'startup_probe', 'daily_show', 'github_write', 'I am Jarvis', 'Dan', 'unavailable']) {
      expect(text).not.toContain(secret);
    }
    for (const record of budget) {
      expect(Object.keys(record).filter((key) => ![
        'level', 'time', 'service', 'msg', 'reqId', 'language', 'rung', 'toolCount', 'toolBytes',
        'instructionsBytes', 'frameBytes', 'totalBytes', 'largestTools', 'outcome', 'elapsedMs', 'remembered', 'attempts',
      ].includes(key))).toEqual([]);
    }
  });
});
