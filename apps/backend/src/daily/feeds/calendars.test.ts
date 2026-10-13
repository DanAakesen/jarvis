import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { DailyCalendarFeed, timedConflicts, weekCalendar, weekEvent } from './calendars.js';
import { GoogleApiError, type GoogleApiClient } from '../../google/api-client.js';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const request = (id = owner) => ({ server: { ownerObjectId: id }, principal: { objectId: id } }) as unknown as FastifyRequest;
const range = { from: '2026-10-12T00:00:00Z', to: '2026-10-13T00:00:00Z' };
const signal = () => new AbortController().signal;
const event = (id: string) => ({ id, summary: 'Synthetic event', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } });
describe('inactive owner-bound Daily calendar reads', () => {
  it('excludes source week-number entries and counts only timed overlaps', () => {
    for (const title of ['Week numbers','Week calendar','Uge kalender','Uge numre','ugenummer']) expect(weekCalendar(title)).toBe(true);
    expect(weekEvent('Uge 42 af 2026')).toBe(true); expect(weekEvent('Week 42 of 2026')).toBe(true); expect(weekEvent('Week planning meeting')).toBe(false);
    const timed = (id: string,start: string,end: string) => ({ calendarId: 'synthetic',id,title: 'Synthetic',start: { dateTime: start,timeZone: null },end: { dateTime: end,timeZone: null } });
    const first = timed('01','2026-10-12T10:00:00Z','2026-10-12T11:00:00Z');
    const second = timed('02','2026-10-12T10:30:00Z','2026-10-12T11:30:00Z');
    const adjacent = timed('03','2026-10-12T11:30:00Z','2026-10-12T12:00:00Z');
    expect(timedConflicts([first,second,adjacent,{ calendarId: 'synthetic',id: 'all-day',title: 'Synthetic',start: { date: '2026-10-12' },end: { date: '2026-10-13' } }])).toEqual({ pairs: [[first,second]],truncated: false });
  });
  it('enumerates visible/hidden calendars and event pages with calendar-qualified IDs, GET only', async () => {
    const read = vi.fn<GoogleApiClient['request']>(async (_api, path, options) => {
      expect(options.method).toBe('GET'); expect(options.body).toBeUndefined();
      if (path.startsWith('/users/me/calendarList')) {
        expect(new URL(`https://synthetic.invalid${path}`).searchParams.get('maxResults')).toBe('100');
        return path.includes('pageToken=next') ? { items: [{ id: 'other/calendar', summary: 'Other' }], nextSyncToken: 'synthetic-unused-sync' } : { items: [{ id: 'primary', summary: 'Primary' }], nextPageToken: 'next' };
      }
      if (path.includes('primary')) return path.includes('pageToken=events') ? { items: [event('02')] } : { items: [event('01')], nextPageToken: 'events' };
      expect(path).toContain('other%2Fcalendar'); return { items: [event('01')] };
    });
    const result = await new DailyCalendarFeed({ request: read }).refresh(request(), range, signal());
    expect(result.status).toBe('complete'); expect(result.events.map((row) => [row.calendarId, row.id])).toEqual([['primary', '01'], ['primary', '02'], ['other/calendar', '01']]);
    expect(result.events[0]?.start).toEqual({ date: '2026-10-12' }); expect(read).toHaveBeenCalledTimes(5);
  });
  it.each([['forbidden', 'scope-denied'], ['credentials-expired', 'connection-expired']] as const)('reports %s without primary-only fallback or credential diagnostics', async (kind, expected) => {
    const read = vi.fn<GoogleApiClient['request']>(async () => { throw new GoogleApiError(kind); });
    const result = await new DailyCalendarFeed({ request: read }).refresh(request(), range, signal());
    expect(result).toMatchObject({ status: 'unavailable', freshness: 'unknown', capturedAt: null, issues: [{ kind: expected }], events: [] });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('rejects a null calendar collection rather than claiming successful empty coverage', async () => {
    const read = vi.fn<GoogleApiClient['request']>(async () => ({ items: null }));
    expect(await new DailyCalendarFeed({ request: read }).refresh(request(),range,signal())).toMatchObject({ status: 'unavailable',issues: [{ kind: 'invalid-response' }] });
  });
  it('retains prior complete cache as stale on failure, copies outputs and isolates owners', async () => {
    let clock = Date.parse('2026-10-12T10:00:00Z');
    const read = vi.fn<GoogleApiClient['request']>(async (_api, path) => path.startsWith('/users/me') ? { items: [{ id: 'primary' }] } : { items: [event('01')] });
    const feed = new DailyCalendarFeed({ request: read }, () => clock);
    const first = await feed.refresh(request(), range, signal()); first.events.length = 0;
    expect((await feed.refresh(request(), range, signal())).issues).toEqual([{ kind: 'refresh-limited' }]);
    expect(read).toHaveBeenCalledTimes(2); clock += 60_000;
    read.mockRejectedValue(new GoogleApiError('forbidden'));
    expect(await feed.refresh(request(), range, signal())).toMatchObject({ status: 'complete', freshness: 'stale', events: [{ id: '01' }], issues: [{ kind: 'scope-denied' }] });
    expect(await feed.refresh(request(other), range, signal())).toMatchObject({ status: 'unavailable', events: [] });
  });
  it.each(['repeat-page', 'duplicate', 'invalid-date', 'missing-boundary', 'too-many-calendars', 'calendar-denied'])('never claims complete coverage for %s', async (kind) => {
    const read = vi.fn<GoogleApiClient['request']>(async (_api, path) => {
      if (path.startsWith('/users/me')) return { items: Array.from({ length: kind === 'too-many-calendars' ? 33 : 1 }, (_, id) => ({ id: `calendar-${id}` })), ...(kind === 'repeat-page' ? { nextPageToken: 'repeated' } : {}) };
      if (kind === 'calendar-denied') throw new GoogleApiError('forbidden');
      const row = event('01'); if (kind === 'invalid-date') row.start.date = '2026-02-30';
      return { items: kind === 'duplicate' ? [row, row] : kind === 'missing-boundary' ? [{ id: '01' }] : [row] };
    });
    expect((await new DailyCalendarFeed({ request: read }).refresh(request(), range, signal())).status).not.toBe('complete');
  });
  it('denies non-owner/runner and invalid ranges before provider calls', async () => {
    const read = vi.fn<GoogleApiClient['request']>(); const feed = new DailyCalendarFeed({ request: read });
    await expect(feed.refresh({ ...request(), principal: { objectId: other } } as FastifyRequest, range, signal())).rejects.toThrow();
    await expect(feed.refresh({ ...request(), runnerPrincipal: { kind: 'jarvis-runner' } } as unknown as FastifyRequest, range, signal())).rejects.toThrow();
    await expect(feed.refresh(request(), { ...range, to: '2027-01-01T00:00:00Z' }, signal())).rejects.toThrow('limits');
    expect(read).not.toHaveBeenCalled();
  });
  it('rate-limits failed/manual refresh across changing ranges rather than hammering denied scopes', async () => {
    const read = vi.fn<GoogleApiClient['request']>(async () => { throw new GoogleApiError('forbidden'); });
    const feed = new DailyCalendarFeed({ request: read });
    await feed.refresh(request(), range, signal());
    expect(await feed.refresh(request(), { ...range, from: '2026-10-12T01:00:00Z' }, signal())).toMatchObject({ status: 'unavailable', issues: [{ kind: 'refresh-limited' }] });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('marks continuation bounds partial and never caches truncated coverage as complete', async () => {
    let pages = 0;
    const read = vi.fn<GoogleApiClient['request']>(async (_api, path) => path.startsWith('/users/me')
      ? { items: [{ id: `calendar-${++pages}` }], nextPageToken: `page-${pages}` }
      : { items: [] });
    const result = await new DailyCalendarFeed({ request: read }).refresh(request(), range, signal());
    expect(pages).toBe(10); expect(result.status).toBe('partial');
    expect(result.issues).toContainEqual({ kind: 'coverage-limit' });
    expect(result.calendars).toHaveLength(10);
  });
  it('keeps the previous complete cache when a later refresh has partial calendar access', async () => {
    let clock = Date.parse('2026-10-12T10:00:00Z'); let mode = 'complete';
    const read = vi.fn<GoogleApiClient['request']>(async (_api, path) => {
      if (mode === 'denied') throw new GoogleApiError('forbidden');
      if (path.startsWith('/users/me')) return { items: [{ id: 'primary' }, { id: 'other' }] };
      if (mode === 'partial' && path.includes('/other/')) throw new GoogleApiError('forbidden');
      return { items: [event('01')] };
    });
    const feed = new DailyCalendarFeed({ request: read }, () => clock);
    const first = await feed.refresh(request(), range, signal()); clock += 60_000; mode = 'partial';
    expect(await feed.refresh(request(), range, signal())).toMatchObject({ status: 'partial', issues: [{ kind: 'scope-denied', calendarId: 'other' }] });
    clock += 60_000; mode = 'denied';
    expect(await feed.refresh(request(), range, signal())).toMatchObject({ status: 'complete', freshness: 'stale', capturedAt: first.capturedAt, events: first.events });
  });
  it('bounds concurrent duplicate refresh and honors cancellation without claiming success', async () => {
    let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    // Even a provider returning after cancellation must not populate a successful cache.
    const read = vi.fn<GoogleApiClient['request']>(async () => { await wait; return { items: [] }; });
    const feed = new DailyCalendarFeed({ request: read }); const controller = new AbortController();
    const first = feed.refresh(request(), range, controller.signal);
    expect(await feed.refresh(request(), range, signal())).toMatchObject({ status: 'unavailable', issues: [{ kind: 'busy' }] });
    controller.abort(); release(); await expect(first).rejects.toThrow(); expect(read).toHaveBeenCalledTimes(1);
  });
});
