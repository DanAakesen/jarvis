import { Writable } from 'node:stream';
import { once } from 'node:events';
import { get } from 'node:http';
import { connect } from 'node:net';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logging.js';
import { shutdown } from './shutdown.js';
import { coreModule } from './core/index.js';
import { factoryModule } from './factory/index.js';
import type { TaskStore } from './factory/task-store.js';
import { createVoiceRelayModule } from './voice/relay.js';

afterEach(() => { vi.useRealTimers(); });
const config = loadConfig({});
function fixture() {
  const records: string[] = [];
  const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
  return { app: buildApp(config, createLogger(config, undefined, output)), records };
}

describe('graceful shutdown', () => {
  it('names the framework warning for a pipelined upgrade on a new revision', async () => {
    const records: string[] = [];
    let warningLogged!: () => void;
    const warning = new Promise<void>((resolve) => { warningLogged = resolve; });
    const output = new Writable({ write(chunk: Buffer, _encoding, done) {
      const record = chunk.toString();
      records.push(record);
      if (JSON.parse(record).msg === 'connection.upgrade_failed') warningLogged();
      done();
    } });
    const app = buildApp(config, createLogger(config, undefined, output), {
      modules: [coreModule, createVoiceRelayModule({
        getToken: async () => '',
        connect: () => { throw new Error('Unexpected upstream connection'); },
      })],
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const socket = connect((app.server.address() as import('node:net').AddressInfo).port, '127.0.0.1');
    try {
      await once(socket, 'connect');
      socket.write([
        'GET /health HTTP/1.1', 'Host: localhost', '', '',
        'GET /voice?private-url HTTP/1.1', 'Host: localhost',
        'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: Zml4dHVyZS1vZmZsaW5lMQ==', '', '',
      ].join('\r\n'));
      await warning;
      expect(records.map((record) => JSON.parse(record)).filter((record) => record.level >= 40))
        .toEqual([expect.objectContaining({
          msg: 'connection.upgrade_failed', level: 40, kind: 'protocol',
        })]);
      expect(records.join('')).not.toContain('private-url');
    } finally {
      socket.destroy();
      await shutdown(app);
    }
  });

  it('ends a task stream whose in-flight lookup completes after shutdown starts', async () => {
    let lookupStarted!: () => void;
    let finishLookup!: () => void;
    let draining!: () => void;
    const started = new Promise<void>((resolve) => { lookupStarted = resolve; });
    const lookup = new Promise<void>((resolve) => { finishLookup = resolve; });
    const drainStarted = new Promise<void>((resolve) => { draining = resolve; });
    const app = buildApp({ ...config, logLevel: 'silent' }, undefined, {
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
      taskStore: {
        get: async () => { lookupStarted(); await lookup; return { id: '1' }; },
        getEventsAfter: async () => [],
      } as unknown as TaskStore,
    });
    app.addHook('preClose', async () => { draining(); });
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const response = fetch(address + '/factory/tasks/1/events', {
        headers: { authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' ') },
      });
      await started;
      const close = shutdown(app, undefined, 1_000);
      await drainStarted;
      finishLookup();
      expect(await (await response).text()).toBe('retry: 1000\nevent: reconnect\ndata: {}\n\n');
      await close;
      expect(app.shutdownConnections.size).toBe(0);
    } finally {
      finishLookup();
      await app.close();
    }
  });

  it('drains live SSE streams and WebSockets with reconnect signals while finishing an in-flight request', async () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    let finishRequest!: () => void;
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    const finished = new Promise<void>((resolve) => { finishRequest = resolve; });
    const app = buildApp(config, createLogger(config, undefined, output), {
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
      taskStore: {
        get: async () => ({ id: '1' }),
        getEventsAfter: async () => [],
      } as unknown as TaskStore,
      modules: [coreModule, factoryModule, createVoiceRelayModule({
        getToken: async () => '',
        registerPhoneMediaRoute: (app) => {
          app.get('/test/socket', { websocket: true }, () => {});
          app.get('/test/in-flight', async () => {
            requestStarted();
            await finished;
            return { completed: true };
          });
        },
      })],
    });
    const headers = { authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' ') };
    let socket: WebSocket | undefined;
    const responses: import('node:http').IncomingMessage[] = [];
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const streams = await Promise.all(['/now/events', '/factory/tasks/1/events'].map(async (path) => {
        const request = get(address + path, { headers });
        const [response] = await once(request, 'response') as [import('node:http').IncomingMessage];
        responses.push(response);
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { text += chunk; });
        const ended = once(response, 'end');
        return { text: () => text, ended };
      }));
      socket = new WebSocket(address.replace('http:', 'ws:') + '/test/socket', { headers });
      await once(socket, 'open');
      const socketClosed = once(socket, 'close');
      const inFlight = fetch(address + '/test/in-flight', { headers });
      await started;
      const close = shutdown(app, undefined, 1_000);
      await Promise.all(streams.map((stream) => stream.ended));
      expect(app.server.listening).toBe(false);
      for (const stream of streams) {
        expect(stream.text()).toContain('retry: 1000\nevent: reconnect\ndata: {}\n\n');
      }
      const [code, reason] = await socketClosed;
      expect(code).toBe(1012);
      expect(reason.toString()).toBe('Service restarting; reconnect');
      finishRequest();
      expect(await (await inFlight).json()).toEqual({ completed: true });
      await close;
      expect(app.shutdownConnections.size).toBe(0);
      const logs = records.map((record) => JSON.parse(record));
      expect(logs.filter((record) => record.msg.startsWith('server.')).map((record) => [record.msg, record.level]))
        .toEqual([['server.stopping', 30], ['server.stopped', 30]]);
      expect(logs.filter((record) => record.level >= 40)).toEqual([]);
    } finally {
      finishRequest();
      socket?.terminate();
      for (const response of responses) response.destroy();
      await app.close();
    }
  });

  it('closes the server before flushing and disposing telemetry', async () => {
    const { app } = fixture();
    const events: string[] = [];
    app.addHook('onClose', async () => { events.push('closed'); });
    await app.ready();
    const sink = { trackTrace: vi.fn(), flush: vi.fn(async () => { events.push('flushed'); }), shutdown: vi.fn(async () => { events.push('disposed'); }) };
    await shutdown(app, sink);
    expect(events).toEqual(['closed', 'flushed', 'disposed']);
    await expect(app.inject('/health')).rejects.toThrow();
  });
  it('warns if telemetry flush rejects and still attempts disposal', async () => {
    const { app, records } = fixture();
    const sink = { trackTrace: vi.fn(), flush: vi.fn(async () => { throw new Error('Flush failed'); }), shutdown: vi.fn(async () => {}) };
    await shutdown(app, sink);
    expect(sink.shutdown).toHaveBeenCalledOnce();
    expect(records.map((record) => JSON.parse(record))).toContainEqual(expect.objectContaining({
      msg: 'telemetry.close_failed', level: 40, kind: 'internal',
    }));
  });
  it('bounds a hanging telemetry flush', async () => {
    vi.useFakeTimers();
    const { app, records } = fixture();
    const sink = { trackTrace: vi.fn(), flush: vi.fn(() => new Promise<void>(() => {})), shutdown: vi.fn(async () => {}) };
    const result = shutdown(app, sink, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBeUndefined();
    expect(records.map((record) => JSON.parse(record))).toContainEqual(expect.objectContaining({
      msg: 'telemetry.close_failed', level: 40, kind: 'timeout',
    }));
  });
  it('surfaces a real server close failure', async () => {
    const { app, records } = fixture();
    app.addHook('onClose', async () => { throw new Error('close failed'); });
    await app.ready();
    await expect(shutdown(app)).rejects.toThrow('close failed');
    expect(records.map((record) => JSON.parse(record))).toContainEqual(expect.objectContaining({
      msg: 'server.shutdown_failed', level: 50, kind: 'internal',
    }));
    expect(records.map((record) => JSON.parse(record).msg)).not.toContain('server.stopped');
  });
  it('drains every connection and disposes resources before reporting a drain failure', async () => {
    const { app, records } = fixture();
    const otherConnection = vi.fn();
    const resourcesClosed = vi.fn();
    app.shutdownConnections.add(async () => { throw new Error('persistence failed'); });
    app.shutdownConnections.add(otherConnection);
    app.addHook('onClose', async () => { resourcesClosed(); });
    await app.ready();
    await expect(shutdown(app)).rejects.toThrow('persistence failed');
    expect(otherConnection).toHaveBeenCalledOnce();
    expect(resourcesClosed).toHaveBeenCalledOnce();
    expect(records.map((record) => JSON.parse(record))).toContainEqual(expect.objectContaining({
      msg: 'server.shutdown_failed', level: 50, kind: 'internal',
    }));
    expect(records.map((record) => JSON.parse(record).msg)).not.toContain('server.stopped');
  });
  it('rejects a server shutdown timeout instead of reporting a clean stop', async () => {
    vi.useFakeTimers();
    const { app, records } = fixture();
    app.addHook('onClose', async () => new Promise<void>(() => {}));
    await app.ready();
    const result = expect(shutdown(app, undefined, 100)).rejects.toThrow('Backend shutdown timed out');
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(records.map((record) => JSON.parse(record))).toContainEqual(expect.objectContaining({
      msg: 'server.shutdown_failed', level: 50, kind: 'timeout',
    }));
    expect(records.map((record) => JSON.parse(record).msg)).not.toContain('server.stopped');
  });
});
