import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logging.js';
import { shutdown } from './shutdown.js';

afterEach(() => { vi.useRealTimers(); });
const config = loadConfig({});
function fixture() {
  return buildApp(config, createLogger(config, undefined, new Writable({ write(_chunk, _encoding, done) { done(); } })));
}

describe('graceful shutdown', () => {
  it('closes the server before flushing and disposing telemetry', async () => {
    const app = fixture();
    await app.ready();
    const events: string[] = [];
    app.addHook('onClose', async () => { events.push('closed'); });
    const sink = { trackTrace: vi.fn(), flush: vi.fn(async () => { events.push('flushed'); }), shutdown: vi.fn(async () => { events.push('disposed'); }) };
    await shutdown(app, sink);
    expect(events).toEqual(['closed', 'flushed', 'disposed']);
    await expect(app.inject('/health')).rejects.toThrow();
  });
  it('attempts disposal if the exporter flush rejects and surfaces failure', async () => {
    const app = fixture();
    const sink = { trackTrace: vi.fn(), flush: vi.fn(async () => { throw new Error('Flush failed'); }), shutdown: vi.fn(async () => {}) };
    await expect(shutdown(app, sink)).rejects.toThrow('Flush failed');
    expect(sink.shutdown).toHaveBeenCalledOnce();
  });
  it('bounds a hanging telemetry flush', async () => {
    vi.useFakeTimers();
    const app = fixture();
    const sink = { trackTrace: vi.fn(), flush: vi.fn(() => new Promise<void>(() => {})), shutdown: vi.fn(async () => {}) };
    const result = expect(shutdown(app, sink, 100)).rejects.toThrow('Backend shutdown timed out');
    await vi.advanceTimersByTimeAsync(100);
    await result;
    await app.close();
  });
});
