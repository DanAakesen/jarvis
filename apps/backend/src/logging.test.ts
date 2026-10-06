import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLogger, createTelemetry, safeErrorFields } from './logging.js';

const sdk = vi.hoisted(() => ({
  config: { enableUseDiskRetryCaching: true }, initialize: vi.fn(),
  trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}),
}));
const construct = vi.hoisted(() => vi.fn());
vi.mock('applicationinsights', () => ({
  TelemetryClient: class { constructor(...args: unknown[]) { construct(...args); return sdk; } },
}));

describe('structured log export', () => {
  it.each([
    'sandbox_heartbeat.poll_failed', 'sandbox_heartbeat.configuration_missing',
    'budget_alert.check_failed', 'task_event_archive.failed', 'project_policy.confirmation_failed',
    'dispatcher.operation_failed', 'github.checks_loop_recovery_failed', 'pc_bridge.status_update_failed',
    'google.refresh_token_expired_alert_unavailable', 'google.refresh_token_expired_alert_persistence_failed',
    'telemetry.close_failed',
  ])('exports %s with only bounded failure diagnostics', (event) => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    logger.warn({
      kind: 'http', statusCode: 403, body: 'body-secret', token: 'token-secret',
      url: 'https://example.com/url-secret', err: new Error('error-secret'),
      operation: 'operation-secret', method: 'GET', port: 3000, responseTime: 42,
    }, event);
    expect(JSON.parse(records[0]!)).toEqual({
      level: 40, time: expect.any(Number), service: 'jarvis-backend', msg: event, kind: 'http', statusCode: 403,
    });
    expect(sink.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: event, properties: { service: 'jarvis-backend', kind: 'http', statusCode: 403 },
    }));
    for (const statusCode of [99, 600, 403.5, '403', null, Infinity, NaN]) {
      logger.warn({ kind: 'kind-secret', statusCode }, event);
      expect(JSON.parse(records.at(-1)!)).toEqual({
        level: 40, time: expect.any(Number), service: 'jarvis-backend', msg: event,
      });
      expect(sink.trackTrace).toHaveBeenLastCalledWith(expect.objectContaining({
        message: event, properties: { service: 'jarvis-backend' },
      }));
    }
    expect(records.join('')).not.toContain('secret');
    expect(JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('secret');
  });

  it.each(['http', 'auth', 'timeout', 'aborted', 'transport', 'protocol', 'internal'])(
    'retains the safe error kind %s and HTTP status boundaries', (kind) => {
      expect(safeErrorFields({ kind, statusCode: 100, message: 'message-secret' })).toEqual({ kind, statusCode: 100 });
      expect(safeErrorFields({ kind, status: 599, body: 'body-secret' })).toEqual({ kind, statusCode: 599 });
    },
  );

  it('classifies unknown errors without exporting their names, messages or invalid status codes', () => {
    for (const error of [null, undefined, 'secret', new Error('secret'),
      { kind: 'secret', name: 'secret', statusCode: 999 }, { statusCode: '403' }, { statusCode: 403.5 }]) {
      expect(safeErrorFields(error)).toEqual({ kind: 'internal' });
    }
    expect(safeErrorFields(new DOMException('secret', 'TimeoutError'))).toEqual({ kind: 'timeout' });
    expect(safeErrorFields(new DOMException('secret', 'AbortError'))).toEqual({ kind: 'aborted' });
  });

  it.each(['skipped', 'fresh', 'renewed', 'failed', 'uncertain'])(
    'exports the %s renewal outcome and bounded diagnostics without provider details',
    (outcome) => {
      const records: string[] = [];
      const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
      const sink = { ...sdk, trackTrace: vi.fn() };
      const logger = createLogger({ logLevel: 'info' }, sink, output);
      const details = { outcome, kind: 'http', statusCode: 404 };
      logger.info({
        ...details, body: 'body-secret', token: 'token-secret', err: new Error('error-secret'),
      }, 'credentials.codex_renewal');
      logger.info({ outcome: 'outcome-secret', kind: 'kind-secret', statusCode: 999 }, 'credentials.codex_renewal');
      expect(JSON.parse(records[0]!)).toMatchObject({ ...details, msg: 'credentials.codex_renewal' });
      expect(sink.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
        message: 'credentials.codex_renewal', properties: { service: 'jarvis-backend', ...details },
      }));
      expect(sink.trackTrace).toHaveBeenLastCalledWith(expect.objectContaining({
        properties: { service: 'jarvis-backend' },
      }));
      expect(records.join('')).not.toContain('secret');
      expect(JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('secret');
    },
  );

  it.each(['credential_unavailable', 'session_persistence_failed', 'foundry_start_rejected',
    'foundry_start_failed', 'recovery_start_failed'])('exports the dispatcher start failure reason %s', (reason) => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    logger.warn({ taskId: '7', reason, request: 'prompt-secret', error: 'error-secret' }, 'dispatcher.start_failed');
    logger.warn({ taskId: 'task-secret', reason: 'reason-secret' }, 'dispatcher.start_failed');
    expect(JSON.parse(records[0]!)).toMatchObject({ msg: 'dispatcher.start_failed', taskId: '7', reason });
    expect(sink.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'dispatcher.start_failed', properties: { service: 'jarvis-backend', taskId: '7', reason },
    }));
    expect(records.join('')).not.toContain('secret');
    expect(JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('secret');
  });

  it('exports watch metadata without images, summaries, comments, or watch instructions', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    const fields = { source: 'camera', noteworthy: true, spoke: false, latencyMs: 42, cost: 0.0009 };
    logger.info({ ...fields, image: 'private-image', summary: 'private-summary', speak: 'private-comment',
      instructions: 'private-instructions' }, 'vision.watch');
    logger.info({ source: 'private-source', noteworthy: 'private-value', cost: -1, latencyMs: Infinity }, 'vision.watch');
    expect(JSON.parse(records[0]!)).toMatchObject({ ...fields, msg: 'vision.watch' });
    expect(JSON.parse(records[1]!)).not.toHaveProperty('cost');
    expect(JSON.parse(records[1]!)).not.toHaveProperty('source');
    expect(sink.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'vision.watch', properties: { service: 'jarvis-backend', ...fields },
    }));
    expect(records.join('')).not.toContain('private');
    expect(JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('private');
  });
  it.each(['chat', 'voice-partial', 'voice-final'])('exports bounded %s reflex decisions without transcripts or arguments', (source) => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    const decision = {
      source, addressed: true, intent: 'action', tool: 'workspace_command', confidence: '>0.8',
      completeCommand: true, executed: true, reason: 'http_503', latencyMs: 42,
    };
    logger.info({ ...decision, transcript: 'transcript-secret', arguments: { title: 'title-secret' } }, 'reflex.decision');
    expect(JSON.parse(records[0]!)).toMatchObject({ ...decision, msg: 'reflex.decision' });
    expect(sink.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'reflex.decision', properties: { service: 'jarvis-backend', ...decision },
    }));
    logger.info({
      source: 'source-secret', intent: 'intent-secret', tool: 'tool-secret', confidence: 'confidence-secret',
      addressed: 'addressed-secret', completeCommand: 1, executed: 'executed-secret',
      reason: 'http_999', latencyMs: 600_001,
    }, 'reflex.decision');
    expect(JSON.parse(records[1]!)).not.toHaveProperty('latencyMs');
    expect(JSON.parse(records[1]!)).not.toHaveProperty('reason');
    logger.info({ reason: 'billing' }, 'reflex.decision');
    expect(JSON.parse(records[2]!)).toHaveProperty('reason', 'billing');
    expect(records.join('')).not.toContain('secret');
    expect(JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('secret');
  });

  it('stays offline without configuration', async () => {
    expect(await createTelemetry()).toBeUndefined();
    expect(construct).not.toHaveBeenCalled();
  });
  it('exports only bounded pc_act step metadata', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    const step = { step: 4, action: 'type', outcome: 'completed' };
    logger.info({
      ...step,
      goal: 'goal-secret',
      target: 'target-secret',
      text: 'typed-secret',
      screenshot: 'image-secret',
    }, 'pc_act.step');
    logger.info({ step: 21, action: 'unknown-secret', outcome: 'unknown-secret' }, 'pc_act.step');

    expect(JSON.parse(records[0]!)).toMatchObject({ ...step, msg: 'pc_act.step' });
    expect(JSON.parse(records[1]!)).toMatchObject({ msg: 'pc_act.step' });
    expect(sink.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'pc_act.step', properties: { service: 'jarvis-backend', ...step },
    }));
    expect(records.join('')).not.toContain('secret');
    expect(JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('secret');
  });
  it('exports vault counts and top-level folders without paths or note content', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    logger.info({
      outcome: 'ok', added: 3, changed: 1, removed: 2, folders: ['Work', 'People', 'Work'],
      path: 'Work/private-note.md', content: 'note-secret',
    }, 'vault.index');
    logger.info({
      outcome: 'ok', folder: 'People', path: 'People/private-note.md', content: 'note-secret',
    }, 'vault.write');

    expect(JSON.parse(records[0]!)).toMatchObject({
      outcome: 'ok', added: 3, changed: 1, removed: 2, folders: ['Work', 'People'], msg: 'vault.index',
    });
    expect(JSON.parse(records[1]!)).toMatchObject({ outcome: 'ok', folder: 'People', msg: 'vault.write' });
    expect(records.join('')).not.toContain('private-note');
    expect(records.join('')).not.toContain('note-secret');
    expect(JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('note-secret');
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
  it('exports only bounded task-reconciliation decisions', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const logger = createLogger({ logLevel: 'info' }, sdk, output);
    const decision = {
      taskId: '42', sandboxSessionId: '7', invocationId: 'invocation-1',
      status: 'completed', decision: 'needs_attention',
    };
    logger.info({ ...decision, reason: 'provider-secret', prompt: 'prompt-secret' }, 'task_reconciliation.decision');
    expect(JSON.parse(records[0]!)).toMatchObject({ ...decision, msg: 'task_reconciliation.decision' });
    expect(sdk.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'task_reconciliation.decision',
      properties: { service: 'jarvis-backend', ...decision },
    }));
    expect(records.join('')).not.toContain('secret');
    expect(JSON.stringify(sdk.trackTrace.mock.calls)).not.toContain('secret');
  });
  it('rejects arbitrary task-reconciliation identifiers and decision text', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const logger = createLogger({ logLevel: 'info' }, sdk, output);
    logger.info({
      taskId: 'task-secret', sandboxSessionId: 'session-secret', invocationId: 'invocation\nsecret',
      status: 'status-secret', decision: 'decision-secret',
    }, 'task_reconciliation.decision');
    expect(records.join('')).not.toContain('secret');
    expect(sdk.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'task_reconciliation.decision', properties: { service: 'jarvis-backend' },
    }));
  });
  it('exports only allowlisted chat and memory timing fields', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const logger = createLogger({ logLevel: 'info' }, sdk, output);
    logger.info({
      phase: 'jev', durationMs: 123.4, text: 'prompt-secret',
    }, 'chat.latency');
    logger.info({
      outcome: 'ok', durationMs: 45.6, query: 'memory-secret',
    }, 'memory.embedding');
    for (const phase of ['turn_first_token', 'turn_complete']) {
      logger.info({ phase, durationMs: 234.5, text: 'prompt-secret' }, 'chat.latency');
    }

    expect(JSON.parse(records[0]!)).toMatchObject({
      phase: 'jev', durationMs: 123.4, msg: 'chat.latency',
    });
    expect(JSON.parse(records[1]!)).toMatchObject({
      outcome: 'ok', durationMs: 45.6, msg: 'memory.embedding',
    });
    expect(records.slice(2).map((record) => JSON.parse(record))).toEqual([
      expect.objectContaining({ phase: 'turn_first_token', durationMs: 234.5 }),
      expect.objectContaining({ phase: 'turn_complete', durationMs: 234.5 }),
    ]);
    expect(records.join('')).not.toContain('secret');
    expect(JSON.stringify(sdk.trackTrace.mock.calls)).not.toContain('secret');
  });
  it('exports recipe timing through P5-14 without recipe content', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const logger = createLogger({ logLevel: 'info' }, sdk, output);
    const phases = ['recipe_select', 'recipe_verify', 'recipe_plan', 'recipe_run'];
    for (const phase of phases) {
      logger.info({ phase, durationMs: 12.5, goal: 'private-content', target: 'private-content', text: 'private-content' }, 'chat.latency');
    }
    expect(records.map(record => JSON.parse(record).phase)).toEqual(phases);
    expect(records.map(record => JSON.parse(record).durationMs)).toEqual(phases.map(() => 12.5));
    expect(records.join('')).not.toContain('private-content');
    expect(JSON.stringify(sdk.trackTrace.mock.calls)).not.toContain('private-content');
  });
  it('exports bounded chat and voice failure diagnostics', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const logger = createLogger({ logLevel: 'info' }, sdk, output);
    logger.warn({ failure: 'Chat agent unavailable (HTTP 400)', prompt: 'prompt-secret' }, 'conversation.reply_failed');
    logger.warn({ closeCode: 1008, failure: 'Policy violation', language: 'da', token: 'token-secret' }, 'voice.upstream_closed');
    logger.warn({ failure: 'bad\nsecret', httpStatus: 401, language: 'en' }, 'voice.upstream_error');

    expect(JSON.parse(records[0]!)).toMatchObject({ msg: 'conversation.reply_failed', failure: 'Chat agent unavailable (HTTP 400)' });
    expect(JSON.parse(records[1]!)).toMatchObject({ msg: 'voice.upstream_closed', closeCode: 1008, failure: 'Policy violation', language: 'da' });
    expect(JSON.parse(records[2]!)).toMatchObject({ msg: 'voice.upstream_error', httpStatus: 401, language: 'en' });
    expect(JSON.parse(records[2]!).failure).toBeUndefined();
    expect(records.join('')).not.toContain('secret');
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
  it('exports only allowlisted voice-turn and PC-bridge timing metadata', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    const turn = {
      turnId: 'd96ed776-15d3-4b3a-ae7b-69c6289cce58',
      transcriptCompletedMs: 12.5,
      jevDecisionMs: 35,
      tools: [{ name: 'pc_open', startedMs: 36, finishedMs: 52, outcome: 'ok', arguments: 'arguments-secret' }],
      firstAudioDeltaMs: 53,
      responseDoneMs: 61,
    };
    logger.info({ ...turn, transcript: 'transcript-secret', toolArguments: 'arguments-secret' }, 'voice.turn_timing');
    logger.info({
      command: 'browser_act', outcome: 'refused', roundTripMs: 42,
      arguments: 'arguments-secret', url: 'url-secret',
    }, 'pc_bridge.command_timing');

    expect(JSON.parse(records[0]!)).toMatchObject({
      ...turn,
      tools: [{ name: 'pc_open', startedMs: 36, finishedMs: 52, outcome: 'ok' }],
      msg: 'voice.turn_timing',
    });
    expect(JSON.parse(records[0]!).tools).toEqual([
      { name: 'pc_open', startedMs: 36, finishedMs: 52, outcome: 'ok' },
    ]);
    expect(JSON.parse(records[1]!)).toMatchObject({
      command: 'browser_act', outcome: 'refused', roundTripMs: 42, msg: 'pc_bridge.command_timing',
    });
    expect(sink.trackTrace.mock.calls.map(([trace]) => trace.message))
      .toEqual(['voice.turn_timing', 'pc_bridge.command_timing']);
    expect(records.join('')).not.toContain('secret');
    expect(JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('secret');
  });
});
