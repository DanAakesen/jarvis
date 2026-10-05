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
  it.each([200, 404, null])('exports safe heartbeat decisions with HTTP status %s', (httpStatus) => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const logger = createLogger({ logLevel: 'info' }, sdk, output);
    const decision = { sandboxSessionId: '7', invocationId: 'invocation-1', httpStatus, decision: 'idle_expired' };
    logger.info({
      ...decision, token: 'token-secret', error: 'provider-secret', question: 'question-secret',
    }, 'sandbox_heartbeat.decision');
    expect(JSON.parse(records[0]!)).toMatchObject({ ...decision, msg: 'sandbox_heartbeat.decision' });
    expect(sdk.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'sandbox_heartbeat.decision', properties: { service: 'jarvis-backend', ...decision },
    }));
    expect(records.join('')).not.toContain('secret');
    expect(JSON.stringify(sdk.trackTrace.mock.calls)).not.toContain('secret');
  });
  it('rejects arbitrary heartbeat fields and decision text', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const logger = createLogger({ logLevel: 'info' }, sdk, output);
    logger.info({
      sandboxSessionId: 'session-secret', invocationId: 'invocation\nsecret',
      httpStatus: 'status-secret', decision: 'decision-secret',
    }, 'sandbox_heartbeat.decision');
    expect(records.join('')).not.toContain('secret');
    expect(sdk.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'sandbox_heartbeat.decision', properties: { service: 'jarvis-backend' },
    }));
  });
  it('exports only bounded voice reflex metrics and never transcript content', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const logger = createLogger({ logLevel: 'info' }, sdk, output);
    logger.info({
      language: 'en',
      partialTranscriptionDeltas: 2,
      speechRecognitionHypotheses: 3,
      stablePartialClauses: 1,
      firstActionLatencyMs: 12.34,
      speechToFirstWordMs: null,
      speechToFirstAudioMs: 13.56,
      transcript: 'transcript-secret',
      userMessage: 'message-secret',
    }, 'voice.reflex_metrics');
    const metric = {
      language: 'en',
      partialTranscriptionDeltas: 2,
      speechRecognitionHypotheses: 3,
      stablePartialClauses: 1,
      firstActionLatencyMs: 12.34,
      speechToFirstWordMs: null,
      speechToFirstAudioMs: 13.56,
      msg: 'voice.reflex_metrics',
    };
    expect(JSON.parse(records[0]!)).toMatchObject(metric);
    expect(sdk.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'voice.reflex_metrics',
      properties: {
        service: 'jarvis-backend',
        language: 'en',
        partialTranscriptionDeltas: 2,
        speechRecognitionHypotheses: 3,
        stablePartialClauses: 1,
        firstActionLatencyMs: 12.34,
        speechToFirstWordMs: null,
        speechToFirstAudioMs: 13.56,
      },
    }));
    expect(records.join('')).not.toContain('secret');
    expect(JSON.stringify(sdk.trackTrace.mock.calls)).not.toContain('secret');
  });
});
