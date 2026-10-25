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
import {
  VOICE_CAPABILITY_DISCOVERY_TOOL,
  VOICE_CAPABILITY_EXECUTION_TOOL,
} from './realtime.js';
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
  it('closes a silent Danish Voice Live upstream after two capability-preserving attempts', async () => {
    const f = await fixture({}, 'da');
    f.upstream.open();
    await vi.advanceTimersByTimeAsync(11_999);
    expect(f.browser.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.browser.close).toHaveBeenCalledWith(4010, 'Voice service did not become ready');
    expect(f.attempts().map((record) => [record.rung, record.outcome])).toEqual([
      ['R1', 'timeout'], ['R2', 'timeout'],
    ]);
    expect(f.summaries()).toEqual([expect.objectContaining({
      language: 'da', closedBy: 'relay', closeCode: 4010, durationMs: 12_000,
      events: [],
      toolCount: 2,
      stages: expect.arrayContaining([
        { stage: 'session_created', elapsedMs: 0 },
        { stage: 'upstream_open', elapsedMs: 0 },
        { stage: 'session_update_sent', elapsedMs: 0 },
      ]),
    })]);
    expect(JSON.stringify(f.records)).not.toContain('private');
    expect(f.summaries()[0]!.totalBytes).toEqual(expect.any(Number));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.summaries()).toHaveLength(1);
    expect(f.timeouts()).toHaveLength(0);
    expect(f.connect).toHaveBeenCalledTimes(2);
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
    f.upstream.event('session.updated');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.browser.close).not.toHaveBeenCalled();
    f.browser.close(1000, 'private browser reason');
    expect(f.summaries()).toEqual([expect.objectContaining({
      closedBy: 'browser', closeCode: 1000,
      events: ['session.created', 'session.updated'],
      stages: expect.arrayContaining([expect.objectContaining({
        stage: 'session_updated',
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

  it('falls back after an early Danish Voice Live close without exposing its private reason', async () => {
    const f = await fixture({}, 'da');
    f.upstream.open();
    f.upstream.close(1013, 'private upstream reason');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.attempts()).toEqual([expect.objectContaining({ rung: 'R1', outcome: 'closed' })]);
    f.sockets[1]!.event('session.updated');
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R2' })]);
    expect(f.browser.close).not.toHaveBeenCalled();
    expect(f.timeouts()).toEqual([]);
    expect(JSON.stringify(f.records)).not.toContain('private');
  });

  it('bounds Danish Voice Live startup across both attempts when upstream never opens', async () => {
    const f = await fixture({}, 'da');
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.upstream.terminate).toHaveBeenCalledOnce();
    expect(f.browser.close).toHaveBeenCalledWith(4010, 'Voice service did not become ready');
    expect(f.attempts().map((record) => record.outcome)).toEqual(['timeout', 'timeout']);
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
  probeTool('daily_query', 1_000), probeTool('daily_food', 2_000), probeTool('daily_food_review', 3_000),
  probeTool('proactive_recent_items', 1_000), probeTool('proactive_preferences', 1_200),
  probeTool('github_write', 3_000),
  probeTool('workspace_command', 12_000), probeTool('tiny_tool', 100),
];
const names = (socket: FakeSocket) => toolNames(socket).sort();
const rungOf = (record: Record<string, unknown> | undefined) => record?.rung;

describe('Voice Live capability-preserving fallback', () => {
  it('starts with direct canonical schemas while retaining the full registry', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    f.upstream.event('session.created');
    f.upstream.event('session.updated');
    expect(names(f.upstream)).toEqual(f.app.jarvisTools.list().map(({ name }) => name).sort());
    expect(frameOf(f.upstream).session.instructions).not.toContain(VOICE_CAPABILITY_DISCOVERY_TOOL);
    expect(f.attempts()).toEqual([expect.objectContaining({
      rung: 'R1', outcome: 'ready', toolCount: f.app.jarvisTools.list().length, frameBytes: frameBytes(f.upstream),
      toolBytes: expect.any(Number), instructionsBytes: expect.any(Number), elapsedMs: 0,
    })]);
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R1', remembered: false })]);
    expect(f.browser.sent.map((data) => JSON.parse(data).type)).toEqual([
      'session.created', 'jarvis.session.ready', 'session.updated',
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.browser.close).not.toHaveBeenCalled();
    f.browser.close(1000, '');
    expect(f.summaries()).toEqual([expect.objectContaining({ toolBudgetRung: 'R1', toolBudgetAttempts: 1 })]);
    expect(f.connect).toHaveBeenCalledOnce();
  });

  it('discovers bounded pages from the real compact fallback selected by the relay', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    f.upstream.event('error', { error: { code: 'schema_constraint' } });
    await vi.advanceTimersByTimeAsync(0);
    const active = f.sockets[1]!;
    active.event('session.updated');
    const discovered: string[] = [];
    const toolOutput = (callId: string) => active.sent.map((data) => JSON.parse(data))
      .find((message) => message.item?.call_id === callId)?.item.output;
    let offset: number | null = 0;
    let page = 0;
    do {
      const callId = `discover_${page++}`;
      const responseId = `discover_response_${page}`;
      active.event('response.created', { response: { id: responseId } });
      active.event('response.function_call_arguments.done', {
        name: VOICE_CAPABILITY_DISCOVERY_TOOL, call_id: callId, arguments: JSON.stringify({ offset }),
      });
      active.event('response.done', { response: { id: responseId } });
      await vi.advanceTimersByTimeAsync(0);
      const output = JSON.parse(toolOutput(callId) as string) as {
        outcome: string; result: { capabilities: { name: string }[]; nextOffset: number | null };
      };
      expect(output.outcome).toBe('ok');
      expect(output.result.capabilities.length).toBeLessThanOrEqual(8);
      discovered.push(...output.result.capabilities.map(({ name }) => name));
      offset = output.result.nextOffset;
    } while (offset !== null);
    expect(discovered.sort()).toEqual(f.app.jarvisTools.list().map(({ name }) => name).sort());
    expect(names(active)).toEqual([VOICE_CAPABILITY_DISCOVERY_TOOL, VOICE_CAPABILITY_EXECUTION_TOOL].sort());
  });

  it('dispatches Daily and proactive tools from the full real relay catalogue', async () => {
    const foodExecute = vi.fn(async () => ({ status: 'committed' }));
    const proactiveExecute = vi.fn(async () => ({ status: 'available' }));
    const f = await fixture({}, 'en', [
      probeTool('daily_food', 100, foodExecute),
      probeTool('proactive_recent_items', 100, proactiveExecute),
      probeTool('vault_search'),
      probeTool('calendar_get_pending_change'),
    ]);
    f.upstream.open();
    f.upstream.event('session.updated');
    const active = f.upstream;
    const toolOutput = (callId: string) => active.sent.map((data) => JSON.parse(data))
      .find((message) => message.item?.call_id === callId)?.item.output;
    expect(names(active)).toEqual(f.app.jarvisTools.list().map(({ name }) => name).sort());

    active.event('response.created', { response: { id: 'full_catalogue_response' } });
    active.event('response.function_call_arguments.done', {
      name: 'daily_food',
      call_id: 'food',
      arguments: JSON.stringify({ note: 'synthetic exact meal' }),
    });
    active.event('response.function_call_arguments.done', {
      name: 'proactive_recent_items',
      call_id: 'proactive',
      arguments: '{}',
    });
    active.event('response.function_call_arguments.done', {
      name: 'unregistered_tool', call_id: 'unadvertised', arguments: '{"note":"synthetic exact meal"}',
    });
    active.event('response.done', { response: { id: 'full_catalogue_response' } });
    await vi.advanceTimersByTimeAsync(0);

    expect(JSON.parse(toolOutput('food') as string)).toMatchObject({ tool: 'daily_food', outcome: 'ok' });
    expect(JSON.parse(toolOutput('proactive') as string)).toMatchObject({
      tool: 'proactive_recent_items', outcome: 'ok',
    });
    expect(JSON.parse(toolOutput('unadvertised') as string)).toMatchObject({ outcome: 'error' });
    expect(foodExecute).toHaveBeenCalledOnce();
    expect(proactiveExecute).toHaveBeenCalledOnce();
  });

  it('preserves discovery, execution, and reconnect behavior after the compact fallback is selected', async () => {
    const execute = vi.fn(async () => ({ status: 'available' }));
    const f = await fixture({}, 'en', [probeTool('daily_food', 100, execute)]);
    f.upstream.open();
    f.upstream.event('error', { error: { code: 'private_code' } });
    await vi.advanceTimersByTimeAsync(0);
    const fallback = f.sockets[1]!;
    expect(names(fallback)).toEqual([VOICE_CAPABILITY_DISCOVERY_TOOL, VOICE_CAPABILITY_EXECUTION_TOOL].sort());
    fallback.event('session.updated');
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R2', remembered: false })]);

    fallback.event('response.created', { response: { id: 'food_discovery_response' } });
    fallback.event('response.function_call_arguments.done', {
      name: VOICE_CAPABILITY_DISCOVERY_TOOL, call_id: 'food_discovery', arguments: '{}',
    });
    fallback.event('response.done', { response: { id: 'food_discovery_response' } });
    await vi.advanceTimersByTimeAsync(0);
    fallback.event('response.created', { response: { id: 'food_execution_response' } });
    fallback.event('response.function_call_arguments.done', {
      name: VOICE_CAPABILITY_EXECUTION_TOOL,
      call_id: 'food_call',
      arguments: JSON.stringify({ capability: 'daily_food', arguments: { note: 'synthetic' } }),
    });
    fallback.event('response.done', { response: { id: 'food_execution_response' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(fallback.sent.map((data) => JSON.parse(data))
      .find((message) => message.item?.call_id === 'food_call')!.item.output))
      .toMatchObject({ tool: 'daily_food', outcome: 'ok' });
    expect(execute).toHaveBeenCalledOnce();

    f.browser.close(1000, 'Reconnect');
    await vi.advanceTimersByTimeAsync(0);
    const reconnectBrowser = new FakeSocket();
    reconnectBrowser.readyState = WebSocket.OPEN;
    f.behaviour.onFrame = (socket) => socket.event('session.updated');
    await f.start(reconnectBrowser);
    const reconnected = f.sockets[2]!;
    expect(names(reconnected)).toEqual([VOICE_CAPABILITY_DISCOVERY_TOOL, VOICE_CAPABILITY_EXECUTION_TOOL].sort());
    expect(f.selected().at(-1)).toEqual(expect.objectContaining({ rung: 'R2', remembered: true }));
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each(['en', 'da'] as const)('keeps the complete registry discoverable on cold start and compact fallback (%s)', async (language) => {
    const f = await fixture({}, language, catalogue());
    f.openFirst();
    const initialDefinitions = frameOf(f.upstream).session.tools;
    expect(names(f.upstream)).toEqual(f.app.jarvisTools.list().map(({ name }) => name).sort());

    f.upstream.event('error', { error: { code: 'schema_constraint' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.connect).toHaveBeenCalledTimes(2);
    const fallback = f.sockets[1]!;
    expect(names(fallback)).toEqual([VOICE_CAPABILITY_DISCOVERY_TOOL, VOICE_CAPABILITY_EXECUTION_TOOL].sort());
    expect(frameOf(fallback).session.tools).not.toEqual(initialDefinitions);
    fallback.event('session.updated');
    fallback.event('response.created', { response: { id: 'discover_fallback_response' } });
    fallback.event('response.function_call_arguments.done', {
      name: VOICE_CAPABILITY_DISCOVERY_TOOL, call_id: 'discover_fallback', arguments: '{}',
    });
    fallback.event('response.done', { response: { id: 'discover_fallback_response' } });
    await vi.advanceTimersByTimeAsync(0);
    const output = JSON.parse(fallback.sent.map((data) => JSON.parse(data))
      .find((message) => message.item?.call_id === 'discover_fallback')!.item.output);
    expect(output.result.capabilities.map(({ name }: { name: string }) => name))
      .toEqual(expect.arrayContaining(['daily_food', 'proactive_recent_items']));
    expect(f.selected().at(-1)).toEqual(expect.objectContaining({ rung: 'R2' }));
    expect(f.browser.close).not.toHaveBeenCalled();
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
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.sockets[1]!.close).toHaveBeenCalled();
    expect(f.attempts()).toEqual([
      expect.objectContaining({ rung: 'R1', outcome: 'timeout', elapsedMs: 6_000 }),
      expect.objectContaining({ rung: 'R2', outcome: 'timeout', elapsedMs: 6_000 }),
    ]);
    expect(f.browser.close).toHaveBeenCalledWith(4010, 'Voice service did not become ready');
  });

  it('closes 4010 after both capability-preserving startup attempts fail', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    await vi.advanceTimersByTimeAsync(11_999);
    expect(f.browser.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.browser.close).toHaveBeenCalledWith(4010, 'Voice service did not become ready');
    expect(f.attempts().map(rungOf)).toEqual(['R1', 'R2']);
    expect(f.exhausted()).toEqual([expect.objectContaining({ attempts: 2 })]);
    expect(f.selected()).toEqual([]);
    expect(f.sockets).toHaveLength(2);
    expect(f.sockets.every((socket) => socket.readyState === WebSocket.CLOSED)).toBe(true);
    expect(f.summaries()).toEqual([expect.objectContaining({
      closedBy: 'relay', closeCode: 4010, toolBudgetRung: null, toolBudgetAttempts: 2, durationMs: 12_000,
    })]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.summaries()).toHaveLength(1);
  });

  it('steps down when the Daily-capable R1 fails', async () => {
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
      expect.objectContaining({ rung: 'R1', outcome: 'error' }),
      expect.objectContaining({ rung: 'R2', outcome: 'ready' }),
    ]);
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R2', remembered: false })]);
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
    expect(f.attempts()).toEqual([expect.objectContaining({ rung: 'R1', outcome: 'closed' })]);
    expect(f.browser.close).not.toHaveBeenCalled();
    f.sockets[1]!.event('session.updated');
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R2' })]);
  });

  it('remembers the compact prompt fallback without changing advertised capabilities', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    f.upstream.event('session.updated');
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R1', remembered: false })]);

    f.behaviour.onFrame = (socket) => socket.event('session.updated');
    const second = new FakeSocket();
    second.readyState = WebSocket.OPEN;
    await f.start(second);
    const next = f.sockets[1]!;
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(names(next)).toEqual(f.app.jarvisTools.list().map(({ name }) => name).sort());
    expect(f.selected().at(-1)).toEqual(expect.objectContaining({ rung: 'R1', remembered: true }));

    let firstAttempt = true;
    f.behaviour.onFrame = (socket) => {
      if (firstAttempt) {
        firstAttempt = false;
        socket.event('error', { error: { code: 'schema_constraint' } });
      } else socket.event('session.updated');
    };
    const third = new FakeSocket();
    third.readyState = WebSocket.OPEN;
    await f.start(third);
    expect(f.connect).toHaveBeenCalledTimes(4);
    expect(f.attempts().slice(-2).map((record) => [record.rung, record.outcome])).toEqual([
      ['R1', 'error'], ['R2', 'ready'],
    ]);
    expect(f.selected().at(-1)).toEqual(expect.objectContaining({ rung: 'R2', remembered: false }));

    const fourth = new FakeSocket();
    fourth.readyState = WebSocket.OPEN;
    await f.start(fourth);
    expect(names(f.sockets.at(-1)!)).toEqual([VOICE_CAPABILITY_DISCOVERY_TOOL, VOICE_CAPABILITY_EXECUTION_TOOL].sort());
    expect(f.attempts().at(-1)).toEqual(expect.objectContaining({ rung: 'R2', outcome: 'ready' }));
    expect(f.selected().at(-1)).toEqual(expect.objectContaining({ rung: 'R2', remembered: true }));
  });

  it('keeps the known-good cold start when no session has ever reached session.updated', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    await vi.advanceTimersByTimeAsync(12_000);
    const second = new FakeSocket();
    second.readyState = WebSocket.OPEN;
    await f.start(second);
    expect(f.sockets).toHaveLength(3);
    expect(names(f.sockets[2]!)).toEqual(f.app.jarvisTools.list().map(({ name }) => name).sort());
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
    expect(f.attempts()).toEqual([expect.objectContaining({ rung: 'R1', outcome: 'timeout' })]);
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

  it('keeps shared capability discovery through settings and camera session updates', async () => {
    const presenceReads = vi.fn()
      .mockResolvedValueOnce({ ...defaultAwayModeState, mode: 'present' })
      .mockResolvedValue({ ...defaultAwayModeState, mode: 'away' });
    const f = await fixture({
      awayModeStore: { read: presenceReads } as unknown as BuildAppOptions['awayModeStore'],
    }, 'en', catalogue());
    f.upstream.open();
    f.upstream.event('session.updated');
    const ready = f.upstream;
    const before = ready.sent.length;
    f.app.nowEventHub.publish({
      type: 'mode_changed', mode: 'away', away: true, source: 'manual', changedAt: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready.sent).toHaveLength(before + 1);
    const presence = frameOf(ready, before).session;
    expect(presence.tools.map(({ name }) => name).sort())
      .toEqual(f.app.jarvisTools.list().map(({ name }) => name).sort());
    expect(presence.instructions).toContain('I am Jarvis');
    ready.event('session.updated');

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
    expect(created.response.instructions).toContain('I am Jarvis');
  });

  it('rejects direct calls on the compact fallback without executing canonical tools', async () => {
    const execute = vi.fn(async () => ({}));
    const f = await fixture({}, 'en', [
      probeTool('daily_show', 100), probeTool('proactive_recent_items', 100, execute), probeTool('allowed_tool', 100),
    ]);
    f.upstream.open();
    f.upstream.event('error', { error: { code: 'schema_constraint' } });
    await vi.advanceTimersByTimeAsync(0);
    const ready = f.sockets[1]!;
    ready.event('session.updated');
    expect(f.selected()).toEqual([expect.objectContaining({ rung: 'R2' })]);
    ready.event('response.created', { response: { id: 'outside_subset_response' } });
    ready.event('response.function_call_arguments.done', { name: 'proactive_recent_items', call_id: 'call_1', arguments: '{}' });
    ready.event('response.function_call_arguments.done', { name: 'allowed_tool', call_id: 'call_2', arguments: '{}' });
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).not.toHaveBeenCalled();
    expect(ready.sent.map((data) => JSON.parse(data))
      .filter((message) => message.item?.type === 'function_call_output')).toEqual([]);

    ready.event('response.done', { response: { id: 'outside_subset_response' } });
    await vi.advanceTimersByTimeAsync(0);
    const outputs = ready.sent.map((data) => JSON.parse(data))
      .filter((message) => message.item?.type === 'function_call_output')
      .map((message) => ({ call: message.item.call_id, ...JSON.parse(message.item.output) }));
    expect(f.browser.sent.map((data) => JSON.parse(data).type)).toContain('response.done');
    expect(outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ call: 'call_1', outcome: 'refused' }),
      expect.objectContaining({ call: 'call_2', outcome: 'refused' }),
    ]));
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps tool names, descriptions and instruction text out of the new logs', async () => {
    const f = await fixture({}, 'en', catalogue());
    f.upstream.open();
    f.upstream.event('error', { error: { code: 'private_code', message: 'private message' } });
    f.behaviour.autoOpen = true;
    await vi.advanceTimersByTimeAsync(12_000);
    const budget = f.records.filter((record) => String(record.msg).startsWith('voice.tool_budget'));
    expect(budget.length).toBeGreaterThanOrEqual(3);
    const text = JSON.stringify(budget);
    for (const secret of ['private', 'startup_probe', 'daily_show', 'github_write', 'I am Jarvis', 'Dan']) {
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
