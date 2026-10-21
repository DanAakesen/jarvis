import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import { createLogger } from '../logging.js';
import type { ToolRegistry } from '../core/tool-registry.js';
import { createRealtimeSessionUpdate } from './realtime.js';
import { createVoiceToolBudgetProbe, TOOL_BUDGET_PROBE_INTERVAL_MS } from './tool-budget-probe.js';
import {
  createToolBudgetMemory, createToolBudgetProbeTools, TOOL_BUDGET_PROBE_NAMES, type ToolBudgetProbeName,
} from './tool-budget.js';
import type { VoiceConnectionFactory } from './relay.js';

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  sent: string[] = [];
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', 1000, Buffer.alloc(0));
  });
  terminate = vi.fn(() => this.close());

  open() {
    this.readyState = WebSocket.OPEN;
    this.emit('open');
  }

  send(data: string, callback?: (error?: Error) => void) {
    this.sent.push(data);
    callback?.();
  }

  event(type: string) {
    this.emit('message', Buffer.from(JSON.stringify({ type })), false);
  }
}

afterEach(() => vi.useRealTimers());

function setup(enabled = true, now: () => number = () => performance.now()) {
  vi.useFakeTimers();
  const records: Record<string, unknown>[] = [];
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) { records.push(JSON.parse(chunk.toString())); done(); },
  });
  const log = createLogger({ logLevel: 'info' }, undefined, output);
  const sockets: FakeSocket[] = [];
  let openSockets = 0;
  let maximumOpenSockets = 0;
  const connect: VoiceConnectionFactory = vi.fn(() => {
    openSockets += 1;
    maximumOpenSockets = Math.max(maximumOpenSockets, openSockets);
    const socket = new FakeSocket();
    sockets.push(socket);
    socket.once('close', () => { openSockets -= 1; });
    return socket as unknown as WebSocket;
  });
  const memory = createToolBudgetMemory();
  const probe = createVoiceToolBudgetProbe(connect, enabled, now);
  const context = {
    buildFrame: (name: ToolBudgetProbeName) => ({
      type: 'session.update',
      session: { tools: [{ name: `private_${name}` }], instructions: 'private instructions' },
    }),
    acquireToken: async () => 'unused',
    voiceModel: 'gpt-realtime-2.1',
    memory,
    log: log as FastifyBaseLogger,
  };
  return { probe, connect, context, memory, records, sockets, get maximumOpenSockets() { return maximumOpenSockets; } };
}

describe('voice tool-budget background probes', () => {
  it('probes in fixed order and stops at the first ready frame without changing memory', async () => {
    const f = setup();
    expect(f.probe.start(f.context)).toBe(true);
    expect(f.connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.probe.start(f.context)).toBe(false);

    f.sockets[0]!.open();
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.records).toContainEqual(expect.objectContaining({
      msg: 'voice.tool_budget_probe', probe: 'full', outcome: 'timeout', elapsedMs: 8_000,
    }));
    expect(f.sockets[0]!.close).toHaveBeenCalledOnce();
    expect(f.connect).toHaveBeenCalledTimes(2);

    f.sockets[1]!.open();
    f.sockets[1]!.event('session.updated');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.records.filter((record) => record.msg === 'voice.tool_budget_probe').map((record) => [
      record.probe, record.outcome,
    ])).toEqual([['full', 'timeout'], ['no_proactive', 'ready']]);
    expect(f.memory.get()).toBeUndefined();
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.maximumOpenSockets).toBe(1);
    expect(f.sockets.every((socket) => socket.sent.every((data) =>
      JSON.parse(data).type === 'session.update'))).toBe(true);
    expect(JSON.stringify(f.records)).not.toContain('private');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues through all four independent measurements when none becomes ready', async () => {
    const f = setup();
    f.probe.start(f.context);
    await vi.advanceTimersByTimeAsync(32_000);
    expect(f.records.filter((record) => record.msg === 'voice.tool_budget_probe').map((record) => [
      record.probe, record.outcome,
    ])).toEqual(TOOL_BUDGET_PROBE_NAMES.map((name) => [name, 'timeout']));
    expect(f.memory.get()).toBeUndefined();
    expect(f.connect).toHaveBeenCalledTimes(4);
    expect(f.maximumOpenSockets).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    await f.probe.close();
  });

  it('raises memory only when the full probe reaches session.updated', async () => {
    const f = setup();
    f.probe.start(f.context);
    await vi.advanceTimersByTimeAsync(0);
    f.sockets[0]!.open();
    f.sockets[0]!.event('session.updated');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.memory.get()).toBe(0);
    expect(f.records.filter((record) => record.msg === 'voice.tool_budget_probe'))
      .toEqual([expect.objectContaining({ probe: 'full', outcome: 'ready' })]);
    expect(f.connect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honours the process cooldown and starts no overlapping probe socket', async () => {
    let clock = 0;
    const f = setup(true, () => clock);
    f.probe.start(f.context);
    await vi.advanceTimersByTimeAsync(0);
    f.sockets[0]!.open();
    f.sockets[0]!.event('session.updated');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.probe.start(f.context)).toBe(false);
    clock += TOOL_BUDGET_PROBE_INTERVAL_MS - 1;
    expect(f.probe.start(f.context)).toBe(false);
    clock += 1;
    expect(f.probe.start(f.context)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    f.sockets[1]!.open();
    expect(f.maximumOpenSockets).toBe(1);
    await f.probe.close();
  });

  it('closes active sockets and clears timers on shutdown; the kill switch prevents a run', async () => {
    const f = setup();
    f.probe.start(f.context);
    await vi.advanceTimersByTimeAsync(0);
    f.sockets[0]!.open();
    await f.probe.close();
    expect(f.sockets[0]!.close).toHaveBeenCalledOnce();
    expect(f.records).toContainEqual(expect.objectContaining({
      msg: 'voice.tool_budget_probe', probe: 'full', outcome: 'closed',
    }));
    expect(vi.getTimerCount()).toBe(0);
    expect(f.probe.start(f.context)).toBe(false);

    const disabled = setup(false);
    expect(disabled.probe.start(disabled.context)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(disabled.connect).not.toHaveBeenCalled();
  });

  it('builds the four named frames with deterministic copies matching R0 tool bytes', () => {
    const tools = Array.from({ length: 111 }, (_, index) => {
      const name = `tool_${String(index).padStart(3, '0')}`;
      return {
        name, description: 'description',
        inputSchema: { type: 'object', properties: { value: { type: 'string', description: 'x'.repeat(index < 11 ? 1_800 : 700) } } },
        execute: async () => ({}), moduleId: 'test',
      };
    });
    tools.push(...Array.from({ length: 11 }, (_, index) => ({
      name: index === 0 ? 'proactive_recent_items' : `daily_tool_${index}`,
      description: 'description',
      inputSchema: { type: 'object', properties: { value: { type: 'string', description: 'x'.repeat(1_800) } } },
      execute: async () => ({}), moduleId: 'test',
    })));
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const registry: ToolRegistry = { list: () => tools, get: (name) => byName.get(name) };
    expect(TOOL_BUDGET_PROBE_NAMES).toEqual(['full', 'no_proactive', 'no_daily', 'reduced_plus_copies']);

    const full = createRealtimeSessionUpdate(registry).session.tools;
    expect(createToolBudgetProbeTools('no_proactive', registry).list()).toHaveLength(121);
    expect(createToolBudgetProbeTools('no_daily', registry).list()).toHaveLength(112);
    const copies = createToolBudgetProbeTools('reduced_plus_copies', registry).list();
    const copyFrame = createRealtimeSessionUpdate(
      createToolBudgetProbeTools('reduced_plus_copies', registry), undefined, undefined, 'en', [], undefined,
      undefined, undefined, 'notice',
    ).session.tools;
    expect(copies).toHaveLength(122);
    expect(copies.slice(-11).map(({ name }) => name)).toEqual(
      Array.from({ length: 11 }, (_, index) => `probe_copy_${String(index + 1).padStart(2, '0')}`),
    );
    expect(Math.abs(Buffer.byteLength(JSON.stringify(copyFrame)) - Buffer.byteLength(JSON.stringify(full))) /
      Buffer.byteLength(JSON.stringify(full))).toBeLessThan(0.02);
  });
});
