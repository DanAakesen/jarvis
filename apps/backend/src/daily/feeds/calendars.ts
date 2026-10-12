import type { FastifyRequest } from 'fastify';
import { GoogleApiError, type GoogleApiClient } from '../../google/api-client.js';
import { resolveDailyOwner } from '../owner.js';
import { instant, text } from '../nutrition/model.js';

export interface CalendarRange { from: string; to: string }
export interface CalendarEntry { id: string; title: string; timeZone: string | null }
export interface CalendarEvent {
  calendarId: string; id: string; title: string;
  start: { date: string } | { dateTime: string; timeZone: string | null };
  end: { date: string } | { dateTime: string; timeZone: string | null };
}
type Failure = 'scope-denied' | 'connection-expired' | 'provider-unavailable' | 'invalid-response' | 'coverage-limit' | 'busy' | 'refresh-limited';
export interface CalendarSnapshot {
  status: 'complete' | 'partial' | 'unavailable'; freshness: 'fresh' | 'stale' | 'unknown';
  capturedAt: string | null; checkedAt: string; calendars: CalendarEntry[]; events: CalendarEvent[];
  issues: { kind: Failure; calendarId?: string }[];
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid calendar response');
  return value as Record<string, unknown>;
}
function bounded(value: unknown, max = 1024): string { text(value, max); return value; }
function boundary(value: unknown): CalendarEvent['start'] {
  const row = record(value);
  if (typeof row.date === 'string' && row.dateTime === undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(row.date) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date) throw new Error('Invalid event date');
    return { date: row.date };
  }
  instant(row.dateTime);
  return { dateTime: row.dateTime, timeZone: row.timeZone === undefined ? null : bounded(row.timeZone, 128) };
}
function failure(error: unknown): Failure {
  if (error instanceof GoogleApiError) return error.kind === 'forbidden' ? 'scope-denied' : error.kind === 'credentials-expired' ? 'connection-expired' : 'provider-unavailable';
  return 'invalid-response';
}

/** Inactive read boundary. Existing authenticated owner/client only; no routes/tools/consent. */
export class DailyCalendarFeed {
  private readonly cache = new Map<string, { snapshot: CalendarSnapshot; refreshedAt: number }>();
  private readonly running = new Set<string>();
  private readonly attempts = new Map<string, number>();
  constructor(private readonly api: GoogleApiClient, private readonly now: () => number = Date.now) {}

  async refresh(request: FastifyRequest, range: CalendarRange, signal: AbortSignal): Promise<CalendarSnapshot> {
    const owner = resolveDailyOwner(request); signal.throwIfAborted();
    if (!range || Object.keys(range).some((key) => !['from', 'to'].includes(key))) throw new TypeError('Invalid calendar range');
    instant(range.from); instant(range.to);
    const from = Date.parse(range.from); const to = Date.parse(range.to);
    if (to <= from || to - from > 62 * 86400_000) throw new TypeError('Calendar range exceeds limits');
    const key = `${owner}:${new Date(from).toISOString()}:${new Date(to).toISOString()}`;
    const checked = this.now(); const checkedAt = new Date(checked).toISOString(); const cached = this.cache.get(key);
    const fallback = (kind: Failure): CalendarSnapshot => cached
      ? { ...structuredClone(cached.snapshot), freshness: 'stale', checkedAt, issues: [{ kind }] }
      : { status: 'unavailable', freshness: 'unknown', capturedAt: null, checkedAt, calendars: [], events: [], issues: [{ kind }] };
    if (this.running.has(key) || this.running.size >= 4) return fallback('busy');
    const lastAttempt = this.attempts.get(owner);
    if (lastAttempt !== undefined && checked - lastAttempt < 30_000) return cached
      ? { ...structuredClone(cached.snapshot), freshness: checked - cached.refreshedAt < 30_000 ? 'fresh' : 'stale', checkedAt, issues: [{ kind: 'refresh-limited' }] }
      : fallback('refresh-limited');
    if (!this.attempts.has(owner) && this.attempts.size >= 4) this.attempts.delete(this.attempts.keys().next().value!);
    this.attempts.set(owner, checked);
    // Bound cache/range growth; do not reuse another owner's snapshot.
    if (!cached && this.cache.size >= 4) this.cache.delete(this.cache.keys().next().value!);
    this.running.add(key);
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    const result: CalendarSnapshot = { status: 'complete', freshness: 'fresh', capturedAt: checkedAt, checkedAt, calendars: [], events: [], issues: [] };
    try {
      const calendars = new Set<string>(); let pageToken: string | undefined; const tokens = new Set<string>();
      for (let page = 0; ; page++) {
        if (page >= 10) { result.issues.push({ kind: 'coverage-limit' }); break; }
        const query = new URLSearchParams({ maxResults: '100', showHidden: 'true' }); if (pageToken) query.set('pageToken', pageToken);
        const response = await this.api.request('calendar', `/users/me/calendarList?${query}`, { method: 'GET', signal: deadline });
        deadline.throwIfAborted();
        const items = response.items ?? []; if (!Array.isArray(items) || items.length > 100) throw new Error('Invalid calendar list');
        for (const item of items) {
          const row = record(item); const id = bounded(row.id);
          if (calendars.has(id)) throw new Error('Duplicate calendar'); calendars.add(id);
          result.calendars.push({ id, title: row.summary === undefined ? '' : bounded(row.summary), timeZone: row.timeZone === undefined ? null : bounded(row.timeZone, 128) });
        }
        if (response.nextPageToken === undefined) break;
        pageToken = bounded(response.nextPageToken, 4096); if (tokens.has(pageToken)) throw new Error('Repeated calendar page'); tokens.add(pageToken);
      }
      if (result.calendars.length > 32) { result.calendars = result.calendars.slice(0, 32); result.issues.push({ kind: 'coverage-limit' }); }
      for (const calendar of result.calendars) {
        let token: string | undefined; const seenTokens = new Set<string>(); const events = new Set<string>();
        try {
          for (let page = 0; ; page++) {
            if (page >= 10 || result.events.length >= 2000) { result.issues.push({ kind: 'coverage-limit', calendarId: calendar.id }); break; }
            const query = new URLSearchParams({ timeMin: range.from, timeMax: range.to, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' }); if (token) query.set('pageToken', token);
            const response = await this.api.request('calendar', `/calendars/${encodeURIComponent(calendar.id)}/events?${query}`, { method: 'GET', signal: deadline });
            deadline.throwIfAborted();
            const items = response.items ?? []; if (!Array.isArray(items) || items.length > 250) throw new Error('Invalid events');
            for (const item of items) {
              const row = record(item); const id = bounded(row.id);
              if (events.has(id)) throw new Error('Duplicate event'); events.add(id);
              if (row.status === 'cancelled') continue;
              if (result.events.length >= 2000) { result.issues.push({ kind: 'coverage-limit', calendarId: calendar.id }); break; }
              result.events.push({ calendarId: calendar.id, id, title: row.summary === undefined ? '' : bounded(row.summary, 2000), start: boundary(row.start), end: boundary(row.end) });
            }
            if (response.nextPageToken === undefined) break;
            token = bounded(response.nextPageToken, 4096); if (seenTokens.has(token)) throw new Error('Repeated event page'); seenTokens.add(token);
          }
        } catch (error) { if (signal.aborted) throw signal.reason; result.issues.push({ kind: deadline.aborted ? 'provider-unavailable' : failure(error), calendarId: calendar.id }); }
        if (deadline.aborted) break;
      }
      if (result.issues.length) result.status = 'partial';
      signal.throwIfAborted();
      if (result.status === 'complete') {
        if (!this.cache.has(key) && this.cache.size >= 4) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { snapshot: structuredClone(result), refreshedAt: checked });
      }
      return result;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      return fallback(deadline.aborted ? 'provider-unavailable' : failure(error));
    } finally { this.running.delete(key); }
  }
}
