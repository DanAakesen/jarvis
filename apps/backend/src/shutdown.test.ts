import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logging.js';
import { shutdown } from './shutdown.js';

afterEach(() => { vi.useRealTimers(); });
const config = loadConfig({});
function fixture() {
  const records: string[] = [];
  const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
  return { app: buildApp(config, createLogger(config, undefined, output)), records };
}

describe('graceful shutdown', () => {
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
    const { app } = fixture();
    app.addHook('onClose', async () => { throw new Error('close failed'); });
    await app.ready();
    await expect(shutdown(app)).rejects.toThrow('close failed');
  });
});
