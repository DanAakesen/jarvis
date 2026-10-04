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
]);

// Apply an allowlist before either stdout or Application Insights sees a record.
// Headers, bodies, URLs, query strings, arbitrary messages and errors are discarded.
const authDenialReasons = new Set([
  'missing_token', 'malformed_authorization', 'duplicate_authorization', 'invalid_token', 'principal_not_allowed_on_route',
]);

function safeFields(input: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (typeof input.reqId === 'string' && /^[\da-f-]{36}$/i.test(input.reqId)) fields.reqId = input.reqId;
  if (typeof input.method === 'string' && /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(input.method)) fields.method = input.method;
  if (typeof input.route === 'string' && /^\/[\w/:-]{0,100}$/.test(input.route)) fields.route = input.route;
  if (typeof input.reason === 'string' && authDenialReasons.has(input.reason)) fields.reason = input.reason;
  for (const key of ['statusCode', 'responseTime', 'port']) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) fields[key] = input[key];
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
