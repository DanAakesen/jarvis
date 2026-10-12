import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { DailyCalendarFeed } from './calendars.js';
import { GoogleApiError, type GoogleApiClient } from '../../google/api-client.js';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const request = (id = owner) => ({ server: { ownerObjectId: id }, principal: { objectId: id } }) as unknown as FastifyRequest;
const range = { from: '2026-10-12T00:00:00Z', to: '2026-10-13T00:00:00Z' };
const signal = () => new AbortController().signal;
const event = (id: string) => ({ id, summary: 'Synthetic event', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } });
describe('inactive owner-bound Daily calendar reads', () => {
  it('enumerates visible/hidden calendars and event pages with calendar-qualified IDs, GET only', async () => {
    const read = vi.fn<GoogleApiClient['request']>(async (_api, path, options) => {
      expect(options.method).toBe('GET'); expect(options.body).toBeUndefined();
      if (path.startsWith('/users/me/calendarList')) return path.includes('pageToken=next') ? { items: [{ id: 'other/calendar', summary: 'Other' }] } : { items: [{ id: 'primary', summary: 'Primary' }], nextPageToken: 'next' };
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
  it('bounds concurrent duplicate refresh and honors cancellation without claiming success', async () => {
    let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    const read = vi.fn<GoogleApiClient['request']>(async (_api, _path, options) => { await wait; options.signal.throwIfAborted(); return { items: [] }; });
    const feed = new DailyCalendarFeed({ request: read }); const controller = new AbortController();
    const first = feed.refresh(request(), range, controller.signal);
    expect(await feed.refresh(request(), range, signal())).toMatchObject({ status: 'unavailable', issues: [{ kind: 'busy' }] });
    controller.abort(); release(); await expect(first).rejects.toThrow(); expect(read).toHaveBeenCalledTimes(1);
  });
});
