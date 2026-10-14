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
    ['chat_identity', 'degraded', 'identity_reply'],
    ['chat_no_timestamp', 'degraded', 'capture_time_invented'],
    ['chat_capabilities', 'down', 'capabilities_discovery_missing'],
    ['chat_capabilities', 'down', 'capabilities_discovery_wrong'],
    ['chat_capabilities', 'down', 'capabilities_discovery_failed'],
    ['chat_capabilities', 'down', 'capabilities_receipt_incomplete'],
    ['chat_capabilities', 'down', 'capabilities_reply_incomplete'],
    ['chat_canary', 'down', 'acceptance_check_failed'],
    ['chat_jobs', 'down', 'jobs_unavailable'],
    ['chat_navigation', 'down', 'navigation_refusal_missing'],
    ['chat_plain_approval', 'down', 'plain_approval_failed'],
    ['agent_contract', 'down', 'Agent settings have an invalid shape.'],
  ])('exports only the safe %s smoke reason %s/%s to stdout and telemetry', (checkId, status, reason) => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output).child({
      token: 'private-token', reply: 'private-reply', err: new Error('private-error'),
    });
    const fields = { checkId, status, reason };
    logger.info({
      ...fields, prompt: 'private-prompt', arguments: { private: 'input' }, result: 'private-result',
    }, 'system.smoke_check');
    expect(JSON.parse(records[0]!)).toEqual({
      level: 30, time: expect.any(Number), service: 'jarvis-backend', msg: 'system.smoke_check', ...fields,
    });
    expect(sink.trackTrace).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'system.smoke_check', properties: { service: 'jarvis-backend', ...fields },
    }));
    expect(records.join('') + JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('private');
  });

  it('drops unknown, cross-check and non-failure smoke reasons at both export boundaries', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    const cases = [
      [{ checkId: 'private-check', status: 'down', reason: 'identity_reply' }, {}],
      [{ checkId: 'chat_identity', status: 'private-status', reason: 'identity_reply' }, { checkId: 'chat_identity' }],
      [{ checkId: 'chat_identity', status: 'degraded', reason: 'capabilities_discovery_missing' },
        { checkId: 'chat_identity', status: 'degraded' }],
      [{ checkId: 'chat_capabilities', status: 'down', reason: 'private-provider-text' },
        { checkId: 'chat_capabilities', status: 'down' }],
      [{ checkId: 'chat_identity', status: 'ok', reason: 'identity_reply' }, { checkId: 'chat_identity', status: 'ok' }],
      [{ checkId: 'chat_identity', status: 'unknown', reason: 'identity_reply' }, { checkId: 'chat_identity', status: 'unknown' }],
      [{ checkId: 'chat_identity', status: 'degraded', reason: { toString: () => 'identity_reply' } },
        { checkId: 'chat_identity', status: 'degraded' }],
      [{ checkId: 'chat_identity', status: 'degraded', reason: 'identity_reply\nprivate' },
        { checkId: 'chat_identity', status: 'degraded' }],
    ];
    for (const [input, expected] of cases) {
      logger.info({ ...input, body: 'private-body', toolCalls: 'private-calls' }, 'system.smoke_check');
      expect(JSON.parse(records.at(-1)!)).toEqual({
        level: 30, time: expect.any(Number), service: 'jarvis-backend', msg: 'system.smoke_check', ...expected,
      });
      expect(sink.trackTrace).toHaveBeenLastCalledWith(expect.objectContaining({
        message: 'system.smoke_check', properties: { service: 'jarvis-backend', ...expected },
      }));
    }
    expect(records.join('') + JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('private');
  });

  it.each(['factory.board_read_failed', 'factory.board_project_lookup_failed'])(
    'exports only allowlisted board diagnostics for %s to stdout and telemetry', (event) => {
      const records: string[] = [];
      const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
      const sink = { ...sdk, trackTrace: vi.fn() };
      const logger = createLogger({ logLevel: 'info' }, sink, output).child({
        token: 'private-token', issueBody: 'private-body', err: new Error('private-error'),
      });
      const reasons = ['request_failed', 'timeout', 'cancelled', 'transport_failed', 'invalid_response',
        'response_too_large', 'result_limit', 'incomplete_response', 'invalid_token_lifetime',
        'invalid_token_permissions', 'unexpected'];
      for (const stage of ['project', 'token', 'source', 'task', 'release', 'response']) {
        for (const reason of reasons) {
          const fields = { stage, reason, status: 403, stale: false };
          logger.warn({ ...fields, body: 'private-response', message: 'private-message', repo: 'private-repo' }, event);
          expect(JSON.parse(records.at(-1)!)).toEqual({
            level: 40, time: expect.any(Number), service: 'jarvis-backend', msg: event, ...fields,
          });
          expect(sink.trackTrace).toHaveBeenLastCalledWith(expect.objectContaining({
            message: event, properties: { service: 'jarvis-backend', ...fields },
          }));
        }
      }
      for (const status of [99, 600, 403.5, '403', null, Infinity, NaN]) {
        logger.warn({ stage: 'private-stage', reason: 'private-reason', status, stale: 'private-stale' }, event);
        expect(JSON.parse(records.at(-1)!)).toEqual({
          level: 40, time: expect.any(Number), service: 'jarvis-backend', msg: event,
        });
        expect(sink.trackTrace).toHaveBeenLastCalledWith(expect.objectContaining({
          properties: { service: 'jarvis-backend' },
        }));
      }
      expect(records.join('') + JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('private');
    },
  );

  it.each(['factory.board_phase', 'factory.board_read_timing', 'factory.board_invalidated'])(
    'exports only allowlisted fields for %s', (event) => {
      const records: string[] = [];
      const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
      const sink = { ...sdk, trackTrace: vi.fn() };
      const logger = createLogger({ logLevel: 'info' }, sink, output);
      const reqId = '00000000-0000-0000-0000-000000000000';
      const fields = event === 'factory.board_phase'
          ? { reqId, route: '/factory/board', stage: 'response', part: 'assemble', durationCensored: true }
        : event === 'factory.board_read_timing'
            ? { reqId, route: '/factory/board', outcome: 'success', cachePath: 'shared_wait',
              stale: false, cacheElapsedMs: 42, statusCode: 200 }
          : { reqId, origin: 'task_event', projectId: '42', version: 3, scope: 'all_projects' };
      logger.info(fields, event);
      expect(JSON.parse(records[0]!)).toEqual({
        level: 30, time: expect.any(Number), service: 'jarvis-backend', ...fields, msg: event,
      });
      logger.info({
        ...fields,
        route: 'https://private.example/path?token=secret',
        stage: 'private-stage',
        durationMs: 60_001,
        cacheElapsedMs: 60_001,
        cacheElapsedCensored: true,
        outcome: 'private-outcome',
        cachePath: 'private-path',
        stale: 'private-stale',
        statusCode: 600,
        origin: 'private-origin',
        projectId: 'private-project',
        version: Number.MAX_SAFE_INTEGER,
        scope: 'private-scope',
        repo: 'private-repo',
        body: 'private-body',
        headers: { authorization: 'private-token' },
      }, event);
      expect(JSON.parse(records[1]!)).toEqual({
        level: 30, time: expect.any(Number), service: 'jarvis-backend', reqId,
        ...(event === 'factory.board_phase'
          ? { part: 'assemble', durationCensored: true }
          : event === 'factory.board_read_timing' ? { cacheElapsedCensored: true } : {}),
        msg: event,
      });
      expect(sink.trackTrace).toHaveBeenCalledTimes(2);
      expect(sink.trackTrace).toHaveBeenLastCalledWith(expect.objectContaining({
        message: event,
        properties: {
          service: 'jarvis-backend', reqId,
          ...(event === 'factory.board_phase'
            ? { part: 'assemble', durationCensored: true }
            : event === 'factory.board_read_timing' ? { cacheElapsedCensored: true } : {}),
        },
      }));
      expect(records.join('') + JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('private');
    },
  );

  it('exports unavailable board duration markers without numeric values', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    logger.info({
      reqId: '00000000-0000-0000-0000-000000000000',
      stage: 'source',
      durationMs: Number.NaN,
      durationUnavailable: true,
    }, 'factory.board_phase');
    logger.info({
      reqId: '00000000-0000-0000-0000-000000000000',
      cacheElapsedMs: Number.NaN,
      cacheElapsedUnavailable: true,
    }, 'factory.board_read_timing');

    expect(JSON.parse(records[0]!)).toEqual({
      level: 30, time: expect.any(Number), service: 'jarvis-backend',
      reqId: '00000000-0000-0000-0000-000000000000',
      stage: 'source',
      durationUnavailable: true,
      msg: 'factory.board_phase',
    });
    expect(JSON.parse(records[1]!)).toEqual({
      level: 30, time: expect.any(Number), service: 'jarvis-backend',
      reqId: '00000000-0000-0000-0000-000000000000',
      cacheElapsedUnavailable: true,
      msg: 'factory.board_read_timing',
    });
    expect(sink.trackTrace).toHaveBeenNthCalledWith(1, expect.objectContaining({
      message: 'factory.board_phase',
      properties: expect.objectContaining({ durationUnavailable: true }),
    }));
    expect(sink.trackTrace).toHaveBeenNthCalledWith(2, expect.objectContaining({
      message: 'factory.board_read_timing',
      properties: expect.objectContaining({ cacheElapsedUnavailable: true }),
    }));
  });

  it('names the WebSocket plugin warning without exporting framework error details', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    logger.warn({
      err: Object.assign(new Error('private-url private-credential'), { code: 'ERR_HTTP_SOCKET_ASSIGNED' }),
      url: 'private-url',
    }, 'websocket upgrade failed');
    expect(JSON.parse(records[0]!)).toEqual({
      level: 40, time: expect.any(Number), service: 'jarvis-backend',
      msg: 'connection.upgrade_failed', kind: 'protocol',
    });
    expect(sink.trackTrace).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      message: 'connection.upgrade_failed', severity: 'Warning',
      properties: { service: 'jarvis-backend', kind: 'protocol' },
    }));
    expect(records.join('') + JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('private');
  });

  it.each(['chat', 'voice-en', 'voice-da'])('exports visual path metadata for %s without identifiers or content', (channel) => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output).child({
      reqId: '00000000-0000-0000-0000-000000000000',
    });
    const fields = { path: 'image', reason: 'image_accepted', channel, latencyMs: 42, captionMs: 20 };
    logger.info({
      ...fields, frameId: 'private-frame', turnId: 'private-turn', sessionId: '41', messageId: '42',
      image: 'private-image', description: 'private-description', question: 'private-question',
      text: 'private-text', url: 'https://example.com/private', method: 'POST', route: '/private',
      responseTime: 42, statusCode: 200, port: 3000, error: new Error('private-error'),
    }, 'visual.path');
    expect(JSON.parse(records[0]!)).toEqual({
      level: 30, time: expect.any(Number), service: 'jarvis-backend', msg: 'visual.path', ...fields,
    });
    expect(sink.trackTrace).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      message: 'visual.path', properties: { service: 'jarvis-backend', ...fields },
    }));
    expect(records.join('') + JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('private');
  });

  it.each([
    'image_attached', 'image_request_accepted', 'image_context_limit',
    'image_accepted', 'image_rejected', 'image_timeout', 'image_unavailable',
    'frame_unavailable', 'frame_missing', 'budget_exhausted', 'budget_unavailable', 'legacy_agent',
    'image_input_unverified', 'timeout', 'daily_limit', 'frame_rate_limited', 'capture_failed',
    'camera_off', 'permission_denied', 'not_supported', 'session_ended', 'vision_failed',
  ])('exports only the explicit visual reason %s', (reason) => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    createLogger({ logLevel: 'info' }, sink, output).info({ path: 'caption', reason }, 'visual.path');
    expect(JSON.parse(records[0]!)).toEqual({
      level: 30, time: expect.any(Number), service: 'jarvis-backend', msg: 'visual.path', path: 'caption', reason,
    });
    expect(sink.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'visual.path', properties: { service: 'jarvis-backend', path: 'caption', reason },
    }));
  });

  it('rejects arbitrary visual metadata and invalid timings at both export boundaries', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    for (const latencyMs of [-1, 600_001, Infinity, -Infinity, NaN, '42', null, undefined]) {
      logger.info({ path: 'private', reason: 'arbitrary_code', channel: 'voice', latencyMs, captionMs: latencyMs }, 'visual.path');
      expect(JSON.parse(records.at(-1)!)).toEqual({
        level: 30, time: expect.any(Number), service: 'jarvis-backend', msg: 'visual.path',
      });
      expect(sink.trackTrace).toHaveBeenLastCalledWith(expect.objectContaining({
        message: 'visual.path', properties: { service: 'jarvis-backend' },
      }));
    }
    for (const latencyMs of [0, 42.5, 600_000]) {
      logger.info({ latencyMs, captionMs: latencyMs }, 'visual.path');
      expect(JSON.parse(records.at(-1)!)).toHaveProperty('latencyMs', latencyMs);
      expect(JSON.parse(records.at(-1)!)).toHaveProperty('captionMs', latencyMs);
      expect(sink.trackTrace).toHaveBeenLastCalledWith(expect.objectContaining({
        properties: { service: 'jarvis-backend', latencyMs, captionMs: latencyMs },
      }));
    }
  });

  it('exports tool argument diagnostics without argument content or unsafe metadata', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    logger.info({
      tool: 'repo_search', keyword: 'additionalProperties', property: 'extra', instancePath: '/view/data/events/0/at',
      arguments: { query: 'private-query' }, body: 'private-body', message: 'private-message',
      route: '/private', statusCode: 400, error: new Error('private-error'),
    }, 'tool.invalid_arguments');
    const fields = { tool: 'repo_search', keyword: 'additionalProperties', property: 'extra', instancePath: '/view/data/events/0/at' };
    expect(JSON.parse(records[0]!)).toEqual({
      level: 30, time: expect.any(Number), service: 'jarvis-backend', msg: 'tool.invalid_arguments', ...fields,
    });
    expect(sink.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'tool.invalid_arguments', properties: { service: 'jarvis-backend', ...fields },
    }));
    logger.info({ tool: 'private/tool', keyword: 'private-keyword', property: 'private\nproperty', instancePath: '/private\npath' }, 'tool.invalid_arguments');
    expect(sink.trackTrace).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'tool.invalid_arguments', properties: { service: 'jarvis-backend' },
    }));
    expect(records.join('') + JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('private');
  });

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

  it('exports only bounded embedding usage and timing metadata', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = { ...sdk, trackTrace: vi.fn() };
    const logger = createLogger({ logLevel: 'info' }, sink, output);
    logger.info({
      outcome: 'ok', durationMs: 20, inputTokens: 35,
      text: 'private-note', embedding: [1, 2, 3],
    }, 'memory.embedding');
    expect(JSON.parse(records[0]!)).toMatchObject({
      msg: 'memory.embedding', outcome: 'ok', durationMs: 20, inputTokens: 35,
    });
    expect(sink.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'memory.embedding',
      properties: { service: 'jarvis-backend', outcome: 'ok', durationMs: 20, inputTokens: 35 },
    }));
    expect(records.join('')).not.toContain('private-note');
    expect(JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('private-note');
  });

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
  it('exports only a known decision provider on reflex decisions and unavailability warnings', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const logger = createLogger({ logLevel: 'info' }, { ...sdk, trackTrace: vi.fn() }, output);
    logger.info({ source: 'chat', provider: 'microsoft', reason: 'http_503' }, 'reflex.decision');
    logger.info({ source: 'chat', provider: 'provider-secret' }, 'reflex.decision');
    logger.warn({ provider: 'jev', token: 'token-secret' }, 'decision.provider_unavailable');
    logger.warn({ provider: 'provider-secret' }, 'decision.provider_unavailable');
    expect(JSON.parse(records[0]!)).toMatchObject({ msg: 'reflex.decision', provider: 'microsoft', reason: 'http_503' });
    expect(JSON.parse(records[1]!)).not.toHaveProperty('provider');
    expect(JSON.parse(records[2]!)).toMatchObject({ msg: 'decision.provider_unavailable', provider: 'jev' });
    expect(JSON.parse(records[3]!)).not.toHaveProperty('provider');
    expect(records.join('')).not.toContain('secret');
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
      outcome: 'ok', added: 3, changed: 1, removed: 2, folders: ['Work', 'Customers', 'Work'],
      path: 'Work/private-note.md', content: 'note-secret',
    }, 'vault.index');
    logger.info({
      outcome: 'ok', folder: 'Customers', path: 'Customers/private-note.md', content: 'note-secret',
    }, 'vault.write');

    expect(JSON.parse(records[0]!)).toMatchObject({
      outcome: 'ok', added: 3, changed: 1, removed: 2, folders: ['Work', 'other'], msg: 'vault.index',
    });
    expect(JSON.parse(records[1]!)).toMatchObject({ outcome: 'ok', folder: 'other', msg: 'vault.write' });
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
    for (const phase of [
      'turn_first_token', 'turn_complete', 'chat_history_verification', 'chat_context',
      'tool_catalogue', 'settings', 'turn_context', 'prompt_build', 'model_first_delta',
      'model_coordination', 'model_request', 'model_to_first_delta', 'agent_pre_model',
      'agent_first_delta', 'agent_auth', 'session_start',
    ]) {
      logger.info({ phase, durationMs: 234.5, text: 'prompt-secret' }, 'chat.latency');
    }

    expect(JSON.parse(records[0]!)).toMatchObject({
      phase: 'jev', durationMs: 123.4, msg: 'chat.latency',
    });
    expect(JSON.parse(records[1]!)).toMatchObject({
      outcome: 'ok', durationMs: 45.6, msg: 'memory.embedding',
    });
    expect(records.slice(2).map((record) => JSON.parse(record).phase)).toEqual([
      'turn_first_token', 'turn_complete', 'chat_history_verification', 'chat_context',
      'tool_catalogue', 'settings', 'turn_context', 'prompt_build', 'model_first_delta',
      'model_coordination', 'model_request', 'model_to_first_delta', 'agent_pre_model',
      'agent_first_delta', 'agent_auth', 'session_start',
    ]);
    expect(records.slice(2).map((record) => JSON.parse(record).durationMs))
      .toEqual(Array(16).fill(234.5));
    expect(records.join('')).not.toContain('secret');
    expect(JSON.stringify(sdk.trackTrace.mock.calls)).not.toContain('secret');
  });
  it('exports only allowlisted hosted-agent session diagnostics', () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const logger = createLogger({ logLevel: 'info' }, sdk, output);
    logger.info({
      sessionIdUsed: true, sessionStartType: 'cold', platformMs: 12.5,
      provisioningMs: 20, containerMs: 300, agentMs: 42.5, fallbackReason: 'http_400',
      owner: 'owner-secret', agentSessionId: 'session-secret', text: 'prompt-secret',
    }, 'chat.agent_session');
    logger.info({
      sessionIdUsed: 'true', sessionStartType: 'unknown', platformMs: 600_001,
      provisioningMs: -1, containerMs: Infinity, agentMs: '3',
      fallbackReason: 'private-reason', owner: 'owner-secret',
    }, 'chat.agent_session');

    expect(JSON.parse(records[0]!)).toMatchObject({
      msg: 'chat.agent_session', sessionIdUsed: true, sessionStartType: 'cold',
      platformMs: 12.5, provisioningMs: 20, containerMs: 300, agentMs: 42.5,
      fallbackReason: 'http_400',
    });
    expect(JSON.parse(records[1]!)).toEqual({
      level: 30, time: expect.any(Number), service: 'jarvis-backend', msg: 'chat.agent_session',
    });
    expect(records.join('') + JSON.stringify(sdk.trackTrace.mock.calls)).not.toContain('secret');
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
