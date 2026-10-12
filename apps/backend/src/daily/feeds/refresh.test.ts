import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { DailyFeedRefresh } from './refresh.js';
import type { DailyCalendarFeed } from './calendars.js';
import type { DailyGmailFeed } from './gmail.js';
import { boundedSource, type DailyFeedStore, type RefreshRun } from './store.js';
const owner = '11111111-1111-4111-8111-111111111111';
const request = { server: { ownerObjectId: owner },principal: { objectId: owner } } as unknown as FastifyRequest;
const now = '2026-10-12T12:00:00Z'; const signal = () => new AbortController().signal;
const range = { from: '2026-10-12T00:00:00Z',to: '2026-10-13T00:00:00Z' };
describe('owner-bound bounded manual refresh lifecycle', () => {
  it.each(['items','bytes','nodes'])('records oversized calendar %s independently of healthy Gmail', async (limit) => {
    const events = Array.from({ length: limit === 'items' ? 1001 : limit === 'nodes' ? 600 : 100 },(_,i) => ({ calendarId: 'synthetic',id: String(i),title: limit === 'bytes' ? '界'.repeat(2000) : 'Synthetic',start: { date: '2026-10-12' },end: { date: '2026-10-13' } }));
    const ingest = vi.fn(async (run: RefreshRun) => { expect(run.sources.map((source) => boundedSource(source,run.capturedAt))).toEqual(run.sources); });
    const runner = new DailyFeedRefresh({ refresh: async () => ({ status: 'complete',freshness: 'fresh',events,issues: [] }) } as unknown as DailyCalendarFeed,
      { read: async () => ({ status: 'ok',threads: [],orders: [] }) } as unknown as DailyGmailFeed,() => ({ completed: async () => false,ingest }) as unknown as DailyFeedStore,() => Date.parse(now));
    expect(await runner.refresh(request,`oversized-${limit}`,range,true,signal())).toMatchObject({ sources: [{ source: 'Gmail',status: 'ok' },{ source: 'GoogleCalendar',status: 'error',error: 'coverage-limit' }] });
    expect(ingest.mock.calls[0]?.[0].sources).toEqual([{ source: 'Gmail',status: 'ok',errorCode: null,items: [] },{ source: 'GoogleCalendar',status: 'error',errorCode: 'coverage-limit',items: [] }]);
  });
  it('records independent source failures rather than false empty success and preserves source calendar IDs', async () => {
    const completed = vi.fn(async () => false); const ingest = vi.fn(async () => undefined);
    const read = vi.fn(async () => ({ status: 'error',capturedAt: now,error: 'semantic-unavailable',threads: [],orders: [] }));
    const refresh = vi.fn(async () => ({ status: 'complete',freshness: 'fresh',capturedAt: now,checkedAt: now,calendars: [],issues: [],events: [{ calendarId: 'synthetic',id: '01',title: 'Synthetic event',start: { date: '2026-10-12' },end: { date: '2026-10-13' } }] }));
    const runner = new DailyFeedRefresh({ refresh } as unknown as DailyCalendarFeed,{ read } as unknown as DailyGmailFeed,() => ({ completed,ingest }) as unknown as DailyFeedStore,() => Date.parse(now));
    expect(await runner.refresh(request,'run-01',range,true,signal())).toMatchObject({ state: 'completed',sources: [{ source: 'Gmail',status: 'error',error: 'semantic-unavailable' },{ source: 'GoogleCalendar',status: 'ok',error: null }] });
    expect(ingest.mock.calls[0]?.[0]).toMatchObject({ runId: 'run-01',sources: [{ source: 'Gmail',status: 'error',items: [] },{ source: 'GoogleCalendar',items: [{ id: 'synthetic:01' }] }] });
    completed.mockResolvedValue(true); await runner.refresh(request,'run-01',range,true,signal()); expect(read).toHaveBeenCalledTimes(1);
  });
  it('does not promote stale/refresh-limited calendar cache to a new successful capture', async () => {
    const ingest = vi.fn(async () => undefined);
    const runner = new DailyFeedRefresh({ refresh: async () => ({ status: 'complete',freshness: 'stale',events: [],issues: [{ kind: 'scope-denied' }] }) } as unknown as DailyCalendarFeed,
      { read: async () => ({ status: 'ok',threads: [],orders: [] }) } as unknown as DailyGmailFeed,() => ({ completed: async () => false,ingest }) as unknown as DailyFeedStore,() => Date.parse(now));
    await runner.refresh(request,'run',range,true,signal());
    expect(ingest.mock.calls[0]?.[0]).toMatchObject({ sources: [{ source: 'Gmail',status: 'ok' },{ source: 'GoogleCalendar',status: 'error',errorCode: 'scope-denied' }] });
  });
});
