import { dailyCapabilitiesAccept, dailyCapabilitiesVersion, dailyQuerySources, dailyQuerySourcesV1, dailyQuerySourcesV2, dailyQuerySourcesV3, dailyQuerySourcesV4, isDailyQuery, type DailyJson, type DailyQuery, type DailyQueryResult, type DailySourceId } from '@jarvis/contracts';
import { awaitWithSignal, backendFetch } from '../backend-request';

const responseLimit = 1024 * 1024;
const concurrentReads = 2;
let activeReads = 0;
type ReadWaiter = {
  signal: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  abort: () => void;
};
const readQueue: ReadWaiter[] = [];

function releaseRead(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    while (readQueue.length) {
      const waiter = readQueue.shift()!;
      waiter.signal.removeEventListener('abort', waiter.abort);
      if (waiter.signal.aborted) {
        waiter.reject(waiter.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        continue;
      }
      waiter.resolve(releaseRead());
      return;
    }
    activeReads -= 1;
  };
}

function acquireRead(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  if (activeReads < concurrentReads) {
    activeReads += 1;
    return Promise.resolve(releaseRead());
  }
  return new Promise((resolve, reject) => {
    const waiter: ReadWaiter = {
      signal, resolve, reject,
      abort: () => {
        const index = readQueue.indexOf(waiter);
        if (index !== -1) readQueue.splice(index, 1);
        signal.removeEventListener('abort', waiter.abort);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
    };
    readQueue.push(waiter);
    signal.addEventListener('abort', waiter.abort, { once: true });
    if (signal.aborted) waiter.abort();
  });
}

export async function runDailyRead<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  const release = await acquireRead(signal);
  try { return await read(); }
  finally { release(); }
}

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
function date(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !value.startsWith('0000-') &&
    Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function json(value: unknown, depth = 0): value is DailyJson {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => json(item, depth + 1));
  return object(value) && Object.values(value).every(item => json(item, depth + 1));
}
export function isDailyResult(value: unknown, query: DailyQuery): value is DailyQueryResult {
  const limit = query.source === dailyQuerySources.sync || query.source === dailyQuerySources.workout || query.source === dailyQuerySources.brief ? 1
    : query.source === dailyQuerySources.metricCatalog ? query.limit ?? 100 : 'limit' in query ? query.limit ?? 50 : 50;
  if (!object(value) || value.source !== query.source || !Array.isArray(value.items) ||
      value.items.length > limit ||
      !value.items.every(item => object(item) && json(item)) ||
      !object(value.units) || !Object.values(value.units).every(unit => typeof unit === 'string') ||
      !object(value.provenance) || value.provenance.store !== 'daily-sql' ||
      value.provenance.detail !== 'retained-record' ||
      value.provenance.calculations !== (query.source === dailyQuerySources.days ? 'derived-from-retained-meals' : 'existing-read-model') ||
      value.provenance.consistency !== 'independent-committed-reads' ||
      !object(value.freshness) || !time(value.freshness.observedAt) ||
      !nullableTime(value.freshness.sourceProcessedCommittedAt) ||
      !nullableTime(value.freshness.latestReturnedRecordUpdatedAt) || value.freshness.staleness !== 'unknown' ||
      !object(value.coverage) || value.coverage.returned !== value.items.length ||
      typeof value.coverage.hasMore !== 'boolean' || value.coverage.sourceCompleteness !== 'unknown' ||
      typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.revision)) return false;
  const items = value.items as Record<string, unknown>[];
  if ('startDate' in query) {
    if (!object(value.period) || value.period.startDate !== query.startDate ||
        value.period.endDate !== query.endDate || value.period.timeZone !== 'Europe/Copenhagen') return false;
  } else if (value.period !== null) return false;
  if (query.source.startsWith('daily.nutrition.') && value.units.energy_kcal !== 'kcal') return false;
  if (query.source === dailyQuerySources.brief && value.items.length) {
    const first: unknown = value.items[0];
    if (!object(first) || first.id !== query.briefId) return false;
  }
  if (query.source === dailyQuerySources.metrics && query.metric !== undefined &&
      items.some(item => item.metric_name !== query.metric)) return false;
  if (query.source === dailyQuerySources.metricCatalog && !items.every((item, index) =>
    typeof item.metric_name === 'string' && item.metric_name.length > 0 && item.metric_name.length <= 256 &&
    (!query.cursor || item.metric_name > query.cursor.key) &&
    (index === 0 || (items[index - 1]!.metric_name as string) < item.metric_name) &&
    Array.isArray(item.units) && item.units.length <= 5 && item.units.every(unit => typeof unit === 'string') &&
    item.units.every((unit, unitIndex, units) => unitIndex === 0 || units[unitIndex - 1]! < unit) &&
    date(item.first_date) && date(item.last_date) && item.first_date <= item.last_date &&
    item.first_date >= query.startDate && item.last_date <= query.endDate &&
    Number.isInteger(item.day_count) && Number(item.day_count) > 0 && time(item.latest_updated_at))) return false;
  if (query.source === dailyQuerySources.days && !items.every((item, index) => {
    const nutrients = ['energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams'];
    const unknown = item.unknown_nutrients;
    const partial = item.partial_nutrients;
    return date(item.meal_date) && item.meal_date >= query.startDate && item.meal_date <= query.endDate &&
      (!query.cursor || item.meal_date > query.cursor.date) &&
      (index === 0 || (items[index - 1]!.meal_date as string) < item.meal_date) &&
      Number.isInteger(item.meal_count) && Number(item.meal_count) > 0 &&
      nutrients.every(nutrient => item[nutrient] === null || typeof item[nutrient] === 'number' && Number.isFinite(item[nutrient])) &&
      Array.isArray(unknown) && unknown.every(nutrient => typeof nutrient === 'string' && nutrients.includes(nutrient)) &&
      new Set(unknown).size === unknown.length &&
      Array.isArray(partial) && partial.every(nutrient => typeof nutrient === 'string' && nutrients.includes(nutrient)) &&
      new Set(partial).size === partial.length && !partial.some(nutrient => unknown.includes(nutrient)) &&
      nutrients.every(nutrient => unknown.includes(nutrient) === (item[nutrient] === null)) &&
      time(item.latest_updated_at);
  })) return false;
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
    throw new DailyReadError('Health returned an invalid or oversized response.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: string[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > responseLimit) throw new DailyReadError('Health returned too much data. Narrow the period.');
      parts.push(decoder.decode(part.value, { stream: true }));
    }
    parts.push(decoder.decode());
    const value: unknown = JSON.parse(parts.join(''));
    return value;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
async function requestJson(backendUrl: string | null, path: string, getAccessToken: () => Promise<string>, signal: AbortSignal, body?: DailyQuery, accept = 'application/json'): Promise<unknown> {
  if (!backendUrl) throw new DailyReadError('The Health backend is not configured.', 'disabled');
  signal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  let token: string;
  try { token = await awaitWithSignal(getAccessToken, signal); }
  catch { signal.throwIfAborted(); throw new DailyReadError('Sign in again to read your Health records.', 'auth'); }
  const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
    method: body ? 'POST' : 'GET', signal, cache: 'no-store',
    headers: { Authorization: ['Bearer', token].join(' '), Accept: accept, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) throw new DailyReadError('Health is not enabled on this backend.', 'disabled');
    if (response.status === 401 || response.status === 403) throw new DailyReadError('Health access could not be verified. Sign in as the configured owner.', 'auth');
    throw new DailyReadError(`Health is unavailable (HTTP ${response.status}).`);
  }
  return readJson(response);
}
export async function loadDailySources(backendUrl: string | null, getAccessToken: () => Promise<string>, signal: AbortSignal): Promise<DailySourceId[]> {
  return runDailyRead(signal, async () => {
    const value = await requestJson(backendUrl, '/daily/capabilities', getAccessToken, signal, undefined, dailyCapabilitiesAccept);
    const source = (input: unknown): input is DailySourceId => typeof input === 'string' &&
      Object.values(dailyQuerySources).some(known => known === input);
    if (!object(value) || value.module !== 'daily' ||
        (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== dailyCapabilitiesVersion) ||
        !Array.isArray(value.sources) || value.sources.length === 0 || !value.sources.every(source) ||
        new Set(value.sources).size !== value.sources.length) throw new DailyReadError('Health data services are not available yet.', 'disabled');
    const allowed = value.version === 1 ? dailyQuerySourcesV1 : value.version === 2 ? dailyQuerySourcesV2
      : value.version === 3 ? dailyQuerySourcesV3 : dailyQuerySourcesV4;
    if (value.sources.some(id => !allowed.some(known => known === id))) {
      throw new DailyReadError(`Health returned incompatible version ${value.version} capabilities. No collections were claimed.`, 'invalid');
    }
    return value.sources;
  });
}
export async function queryDaily(backendUrl: string | null, query: DailyQuery, getAccessToken: () => Promise<string>, signal: AbortSignal): Promise<DailyQueryResult> {
  if (!isDailyQuery(query)) throw new DailyReadError('Choose a valid period and source before loading Health.', 'invalid');
  return runDailyRead(signal, async () => {
    const value = await requestJson(backendUrl, '/daily/query', getAccessToken, signal, query);
    if (!isDailyResult(value, query)) throw new DailyReadError('Health returned mismatched or incomplete evidence. No complete result is claimed.');
    return value;
  });
}
