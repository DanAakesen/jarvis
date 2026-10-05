import { Writable } from 'node:stream';
import pino from 'pino';
import type { Contracts } from 'applicationinsights';
import type { BackendConfig } from './config.js';

// This is the external export boundary, replaced by an offline sink in tests.
export interface TelemetrySink {
  trackTrace(trace: Contracts.TraceTelemetry): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export async function createTelemetry(connectionString?: string): Promise<TelemetrySink | undefined> {
  if (connectionString === undefined) return undefined;
  const { TelemetryClient } = await import('applicationinsights');
  const client = new TelemetryClient(connectionString, { useGlobalProviders: false });
  client.config.enableUseDiskRetryCaching = false;
  client.initialize();
  return client;
}

const events = new Set([
  'request.started', 'request.completed', 'request.failed', 'request.origin_denied', 'request.auth_denied',
  'server.listening', 'server.stopping', 'server.stopped', 'server.failed',
  'database.ready', 'database.not_configured',
  'telemetry.stdout_only', 'telemetry.export_failed', 'telemetry.close_failed',
  'sandbox_heartbeat.decision', 'task_reconciliation.decision', 'voice.reflex_metrics',
  'voice.partials_unavailable', 'chat.latency', 'memory.embedding',
  'reflex.decision',
  'conversation.reply_failed', 'voice.connection_failed', 'voice.upstream_closed', 'voice.upstream_error',
]);

// Apply an allowlist before either stdout or Application Insights sees a record.
// Headers, bodies, URLs, query strings, arbitrary messages and errors are discarded.
const authDenialReasons = new Set([
  'missing_token', 'malformed_authorization', 'duplicate_authorization', 'invalid_token', 'principal_not_allowed_on_route',
]);
const heartbeatDecisions = new Set([
  'queued', 'running', 'completed', 'crashed', 'idle_expired', 'needs_attention',
  'paused', 'pause_unchanged', 'cancelled', 'cancelling', 'interrupted', 'unknown',
  'unchanged', 'confirm_failure', 'persistence_failed', 'poll_failed',
]);
const reconciliationStatuses = new Set([
  'queued', 'running', 'completed', 'failed', 'cancelled', 'needs_attention', 'cancelling', 'interrupted',
  'paused', 'unknown', 'unavailable', 'Ready', 'Running', 'PauseRequested', 'Paused', 'NeedsAttention',
  'Done', 'Cancelled', 'task_missing',
]);
const reconciliationDecisions = new Set([
  'reconciliation_failed', 'runner_alive', 'needs_attention', 'unchanged', 'done', 'task_missing',
  'runner_status_unavailable', 'runner_session_mismatch', 'ended_session_still_running',
  'completed_without_verified_delivery', 'foundry_queued', 'foundry_running', 'foundry_completed',
  'foundry_failed', 'foundry_cancelled', 'foundry_needs_attention', 'foundry_cancelling',
  'foundry_interrupted', 'foundry_paused', 'foundry_unknown',
  'Ready', 'Running', 'PauseRequested', 'Paused', 'NeedsAttention', 'Done', 'Cancelled',
]);
const chatLatencyPhases = new Set([
  'reflex_targets', 'jev', 'agent_first_byte', 'turn_first_token', 'turn_complete',
]);
const reflexReasons = new Set([
  'executed', 'unavailable', 'cancelled', 'not_addressed', 'not_action', 'incomplete_command',
  'low_confidence', 'confirmation_required', 'no_target', 'unsafe_target', 'unauthorized',
  'audit_unavailable', 'invalid_arguments', 'execution_failed', 'refused', 'error',
  'already_executed', 'shared_context_required',
]);

function safeFields(input: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (typeof input.reqId === 'string' && /^[\da-f-]{36}$/i.test(input.reqId)) fields.reqId = input.reqId;
  if (typeof input.method === 'string' && /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(input.method)) fields.method = input.method;
  if (typeof input.route === 'string' && /^\/[\w/:-]{0,100}$/.test(input.route)) fields.route = input.route;
  if (typeof input.reason === 'string' && authDenialReasons.has(input.reason)) fields.reason = input.reason;
  if (input.msg === 'reflex.decision') {
    if (['chat', 'voice-partial', 'voice-final'].includes(String(input.source))) fields.source = input.source;
    if (['action', 'question', 'other'].includes(String(input.intent))) fields.intent = input.intent;
    if (['<0.5', '0.5–0.8', '>0.8'].includes(String(input.confidence))) fields.confidence = input.confidence;
    for (const key of ['addressed', 'completeCommand', 'executed']) {
      if (typeof input[key] === 'boolean') fields[key] = input[key];
    }
    if (typeof input.tool === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(input.tool)) fields.tool = input.tool;
    if (typeof input.reason === 'string' && reflexReasons.has(input.reason)) fields.reason = input.reason;
    if (typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs) &&
        input.latencyMs >= 0 && input.latencyMs <= 600_000) fields.latencyMs = input.latencyMs;
  }
  for (const key of ['statusCode', 'responseTime', 'port']) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) fields[key] = input[key];
  }
  if (input.msg === 'chat.latency') {
    if (typeof input.phase === 'string' && chatLatencyPhases.has(input.phase)) fields.phase = input.phase;
    if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) &&
        input.durationMs >= 0 && input.durationMs <= 600_000) {
      fields.durationMs = input.durationMs;
    }
  }
  if (input.msg === 'memory.embedding') {
    if (typeof input.outcome === 'string' && ['ok', 'fallback', 'cancelled'].includes(input.outcome)) {
      fields.outcome = input.outcome;
    }
    if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) &&
        input.durationMs >= 0 && input.durationMs <= 600_000) {
      fields.durationMs = input.durationMs;
    }
  }
  if (input.msg === 'sandbox_heartbeat.decision') {
    if (typeof input.sandboxSessionId === 'string' && /^[1-9]\d{0,18}$/.test(input.sandboxSessionId)) {
      fields.sandboxSessionId = input.sandboxSessionId;
    }
    if (typeof input.invocationId === 'string' && /^[\w.:-]{1,256}$/.test(input.invocationId)) {
      fields.invocationId = input.invocationId;
    }
    if (input.httpStatus === null ||
      (Number.isInteger(input.httpStatus) && Number(input.httpStatus) >= 100 && Number(input.httpStatus) <= 599)) {
      fields.httpStatus = input.httpStatus;
    }
    if (typeof input.decision === 'string' && heartbeatDecisions.has(input.decision)) {
      fields.decision = input.decision;
    }
  }
  if (input.msg === 'task_reconciliation.decision') {
    for (const key of ['taskId', 'sandboxSessionId']) {
      const value = input[key];
      if (typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)) fields[key] = value;
    }
    if (typeof input.invocationId === 'string' && /^[\w.:-]{1,256}$/.test(input.invocationId)) {
      fields.invocationId = input.invocationId;
    }
    if (typeof input.status === 'string' && reconciliationStatuses.has(input.status)) fields.status = input.status;
    if (typeof input.decision === 'string' && reconciliationDecisions.has(input.decision)) {
      fields.decision = input.decision;
    }
  }
  if (input.msg === 'conversation.reply_failed' || input.msg === 'voice.upstream_error' ||
      input.msg === 'voice.upstream_closed' || input.msg === 'voice.connection_failed') {
    // Short, fixed-vocabulary diagnostics only: our own error messages and upstream close reasons.
    if (typeof input.failure === 'string' && /^[A-Za-z0-9 .:,'()_-]{1,120}$/.test(input.failure)) {
      fields.failure = input.failure;
    }
    if (typeof input.closeCode === 'number' && Number.isInteger(input.closeCode) &&
        input.closeCode >= 1000 && input.closeCode <= 4999) {
      fields.closeCode = input.closeCode;
    }
    if (typeof input.httpStatus === 'number' && Number.isInteger(input.httpStatus) &&
        input.httpStatus >= 100 && input.httpStatus <= 599) {
      fields.httpStatus = input.httpStatus;
    }
    if (input.language === 'da' || input.language === 'en') fields.language = input.language;
  }
  if (input.msg === 'voice.reflex_metrics') {
    if (input.language === 'da' || input.language === 'en') fields.language = input.language;
    for (const key of ['partialTranscriptionDeltas', 'speechRecognitionHypotheses', 'stablePartialClauses']) {
      const value = input[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000) {
        fields[key] = value;
      }
    }
    for (const key of ['firstActionLatencyMs', 'speechToFirstWordMs', 'speechToFirstAudioMs']) {
      const value = input[key];
      if (value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
        fields[key] = value;
      }
    }
  }
  return fields;
}

export function createLogger(
  config: Pick<BackendConfig, 'logLevel'>,
  telemetry?: TelemetrySink,
  output: NodeJS.WritableStream = process.stdout,
) {
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      const record = JSON.parse(chunk.toString()) as Record<string, unknown>;
      const event = typeof record.msg === 'string' && events.has(record.msg) ? record.msg : 'backend.event';
      const level = [10, 20, 30, 40, 50, 60].includes(Number(record.level)) ? Number(record.level) : 30;
      const time = typeof record.time === 'number' && Number.isFinite(record.time) ? record.time : Date.now();
      const sanitized = { level, time, service: 'jarvis-backend', ...safeFields(record), msg: event };
      output.write(JSON.stringify(sanitized) + '\n');
      try {
        const severity = level >= 60 ? 'Critical' : level >= 50 ? 'Error' : level >= 40 ? 'Warning' : level >= 30 ? 'Information' : 'Verbose';
        telemetry?.trackTrace({
          message: event, severity,
          properties: { service: 'jarvis-backend', ...safeFields(record) },
        });
      } catch {
        // A telemetry outage must not break requests or recursively export itself.
        output.write(JSON.stringify({ level: 40, time: Date.now(), service: 'jarvis-backend', msg: 'telemetry.export_failed' }) + '\n');
      }
      done();
    },
  });
  return pino({
    level: config.logLevel,
    base: { service: 'jarvis-backend' },
  }, stream);
}
