import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLogger, createTelemetry } from './logging.js';

const sdk = vi.hoisted(() => ({
  config: { enableUseDiskRetryCaching: true }, initialize: vi.fn(),
  trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}),
}));
const construct = vi.hoisted(() => vi.fn());
vi.mock('applicationinsights', () => ({
  TelemetryClient: class { constructor(...args: unknown[]) { construct(...args); return sdk; } },
}));

describe('structured log export', () => {
  it('stays offline without configuration', async () => {
    expect(await createTelemetry()).toBeUndefined();
    expect(construct).not.toHaveBeenCalled();
  });
  it('uses an isolated manual SDK client, disables disk persistence and initializes it', async () => {
    const client = await createTelemetry('offline-test-string');
    expect(client).toBe(sdk);
    expect(construct).toHaveBeenCalledWith('offline-test-string', { useGlobalProviders: false });
    expect(sdk.config.enableUseDiskRetryCaching).toBe(false);
    expect(sdk.initialize).toHaveBeenCalledOnce();
  });
  it('filters arbitrary log arguments and child bindings before stdout and telemetry', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const logger = createLogger({ logLevel: 'debug' }, sdk, output);
    logger.child({ authorization: 'binding-secret', reqId: 'request-secret' }).info({ level: 'level-secret', time: 'time-secret', headers: { cookie: 'cookie-secret' }, token: 'token-secret', err: new Error('error-secret'), method: 'method-secret', route: '/health?token=query-secret' }, 'message-secret');
    logger.debug({ statusCode: 200 }, 'request.completed');
    expect(records).toHaveLength(2);
    expect(records.join('')).not.toContain('secret');
    expect(JSON.stringify(sdk.trackTrace.mock.calls)).not.toContain('secret');
    expect(sdk.trackTrace).toHaveBeenCalledWith(expect.objectContaining({ message: 'request.completed', severity: 'Verbose' }));
  });
  it('keeps serving and reports export failure to stdout without recursion', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn(() => { throw new Error('export-secret'); }) };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    expect(() => logger.info('request.started')).not.toThrow();
    expect(sink.trackTrace).toHaveBeenCalledOnce();
    expect(records.join('')).toContain('telemetry.export_failed');
    expect(records.join('')).not.toContain('export-secret');
  });
});
