import { dailyQuerySources, isDailyQuery, type DailyJson, type DailyQuery, type DailyQueryResult, type DailySourceId } from '@jarvis/contracts';
import { awaitWithSignal, backendFetch } from '../backend-request';

const responseLimit = 1024 * 1024;
export class DailyReadError extends Error {
  constructor(message: string, readonly kind: 'disabled' | 'auth' | 'unavailable' | 'invalid' = 'unavailable') {
    super(message);
    this.name = 'DailyReadError';
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function time(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));
}
function nullableTime(value: unknown): boolean { return value === null || time(value); }
function json(value: unknown, depth = 0): value is DailyJson {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => json(item, depth + 1));
  return object(value) && Object.values(value).every(item => json(item, depth + 1));
}
export function isDailyResult(value: unknown, query: DailyQuery): value is DailyQueryResult {
  const limit = query.source === dailyQuerySources.sync || query.source === dailyQuerySources.workout || query.source === dailyQuerySources.brief ? 1 : 'limit' in query ? query.limit ?? 50 : 50;
  if (!object(value) || value.source !== query.source || !Array.isArray(value.items) ||
      value.items.length > limit ||
      !value.items.every(item => object(item) && json(item)) ||
      !object(value.units) || !Object.values(value.units).every(unit => typeof unit === 'string') ||
      !object(value.provenance) || value.provenance.store !== 'daily-sql' ||
      value.provenance.detail !== 'retained-record' || value.provenance.calculations !== 'existing-read-model' ||
      value.provenance.consistency !== 'independent-committed-reads' ||
      !object(value.freshness) || !time(value.freshness.observedAt) ||
      !nullableTime(value.freshness.sourceProcessedCommittedAt) ||
      !nullableTime(value.freshness.latestReturnedRecordUpdatedAt) || value.freshness.staleness !== 'unknown' ||
      !object(value.coverage) || value.coverage.returned !== value.items.length ||
      typeof value.coverage.hasMore !== 'boolean' || value.coverage.sourceCompleteness !== 'unknown' ||
      typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.revision)) return false;
  if ('startDate' in query) {
    if (!object(value.period) || value.period.startDate !== query.startDate ||
        value.period.endDate !== query.endDate || value.period.timeZone !== 'Europe/Copenhagen') return false;
  } else if (value.period !== null) return false;
  if (query.source.startsWith('daily.nutrition.') && value.units.energy_kcal !== 'kcal') return false;
  if (query.source === dailyQuerySources.brief && value.items.length) {
    const first: unknown = value.items[0];
    if (!object(first) || first.id !== query.briefId) return false;
  }
  if (query.source === dailyQuerySources.sleep && value.units['*_hours'] !== 'h') return false;
  if (value.coverage.hasMore) {
    if (!object(value.coverage.next) || !isDailyQuery({ ...query, cursor: value.coverage.next }) || value.status !== 'partial') return false;
  } else if (value.coverage.next !== null || value.status !== (value.items.length ? 'available' : 'empty')) return false;
  return true;
}

async function readJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('application/json') ||
      declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > responseLimit)) {
    await response.body?.cancel();
    throw new DailyReadError('Daily returned an invalid or oversized response.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: string[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > responseLimit) throw new DailyReadError('Daily returned too much data. Narrow the period.');
      parts.push(decoder.decode(part.value, { stream: true }));
    }
    parts.push(decoder.decode());
    const value: unknown = JSON.parse(parts.join(''));
    return value;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
async function requestJson(backendUrl: string | null, path: string, getAccessToken: () => Promise<string>, signal: AbortSignal, body?: DailyQuery): Promise<unknown> {
  if (!backendUrl) throw new DailyReadError('The Daily backend is not configured.', 'disabled');
  signal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  let token: string;
  try { token = await awaitWithSignal(getAccessToken, signal); }
  catch { signal.throwIfAborted(); throw new DailyReadError('Sign in again to read your Daily records.', 'auth'); }
  const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
    method: body ? 'POST' : 'GET', signal, cache: 'no-store',
    headers: { Authorization: ['Bearer', token].join(' '), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) throw new DailyReadError('Daily is not enabled on this backend. Your original Daily remains in use.', 'disabled');
    if (response.status === 401 || response.status === 403) throw new DailyReadError('Daily access could not be verified. Sign in as the configured owner.', 'auth');
    throw new DailyReadError(`Daily is unavailable (HTTP ${response.status}). Retry without changing your records.`);
  }
  return readJson(response);
}
export async function loadDailySources(backendUrl: string | null, getAccessToken: () => Promise<string>, signal: AbortSignal): Promise<DailySourceId[]> {
  const value = await requestJson(backendUrl, '/daily/capabilities', getAccessToken, signal);
  const source = (input: unknown): input is DailySourceId => typeof input === 'string' &&
    Object.values(dailyQuerySources).some(known => known === input);
  if (!object(value) || value.module !== 'daily' || value.version !== 1 ||
      !Array.isArray(value.sources) || value.sources.length === 0 || !value.sources.every(source) ||
      new Set(value.sources).size !== value.sources.length) throw new DailyReadError('Daily data services are not available yet.', 'disabled');
  return value.sources;
}
export async function queryDaily(backendUrl: string | null, query: DailyQuery, getAccessToken: () => Promise<string>, signal: AbortSignal): Promise<DailyQueryResult> {
  if (!isDailyQuery(query)) throw new DailyReadError('Choose a valid period and source before loading Daily.', 'invalid');
  const value = await requestJson(backendUrl, '/daily/query', getAccessToken, signal, query);
  if (!isDailyResult(value, query)) throw new DailyReadError('Daily returned mismatched or incomplete evidence. No complete result is claimed.');
  return value;
}
