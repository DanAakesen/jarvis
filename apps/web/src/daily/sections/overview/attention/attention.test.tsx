import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { dailyQuerySources as sources, type DailyJson, type DailyQuery, type DailyQueryResult, type DailySourceId } from '@jarvis/contracts';
import { awaitWithSignal } from '../../../../backend-request';
import { dailyFixture, jsonResponse } from '../../../test-support';
import { TopCards } from '../TopCards';
import { AttentionOverview } from './AttentionOverview';
import { WaitingLists } from './WaitingLists';
import { CalendarAgenda } from './CalendarAgenda';
import { FeedRefresh } from './FeedRefresh';
import { calendarRange } from './data';

const token = async () => 'synthetic-fixture';
const period = { startDate: '2026-10-20', endDate: '2026-10-20' };
const props = { backendUrl: 'http://localhost:3999', getAccessToken: token, sources: [sources.attention, sources.calendar], refreshVersion: 0 };
type Row = Record<string, DailyJson>;
const thread = (id: string, bucket = 'waiting_for_you', hidden = false): Row => ({
  type: 'thread', id, suppressionKey: `synthetic-key-${id}`, bucket, hidden, ageBusinessDays: 3,
  thread: { title: `Synthetic thread ${id}`, snippet: `Synthetic detail ${id}`, senderName: 'Synthetic sender' },
});
const event = (id: string, start = '09:00', end = '10:00'): Row => ({
  id, title: `Synthetic event ${id}`, startsAt: `2026-10-20T${start}:00Z`, endsAt: `2026-10-20T${end}:00Z`,
  allDay: false, calendarName: 'Synthetic calendar', location: 'Synthetic room', status: 'confirmed',
});
const allDay: Row = {
  ...event('all-day'), allDay: true, startsAt: '2026-10-19T00:00:00Z', endsAt: '2026-10-21T00:00:00Z',
  start: { date: '2026-10-19' }, end: { date: '2026-10-21' },
};

function result(query: DailyQuery, rows: Row[] = [], status: 'Missing' | 'Current' | 'Stale' = 'Current', partial = false): DailyQueryResult {
  return {
    ...dailyFixture(query, rows),
    status: status !== 'Current' || partial ? 'partial' : rows.length ? 'available' : 'empty',
    ...(query.source === sources.calendar && 'from' in query ? { calendarRange: { from: query.from, to: query.to }, rangeCovered: !partial } : {}),
    feedSources: [{
      source: query.source === sources.attention ? 'Gmail' : 'GoogleCalendar', status,
      capturedAt: status === 'Missing' ? null : '2026-10-20T06:00:00Z',
      attemptedAt: status === 'Missing' ? null : '2026-10-20T06:00:00Z',
      error: status === 'Stale' ? 'provider-unavailable' : status === 'Missing' ? 'not-configured' : null,
    }],
  };
}

function stub({ threads = [thread('a'), thread('b', 'waiting_on_others')], events = [event('a'), event('b', '09:30', '11:00'), allDay],
  sourceStatus = 'Current', partial = false, fail = false, gate = Promise.resolve() }: {
    threads?: Row[]; events?: Row[]; sourceStatus?: 'Missing' | 'Current' | 'Stale'; partial?: boolean; fail?: boolean; gate?: Promise<void>;
  } = {}) {
  let hidden = false;
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (init?.signal) await awaitWithSignal(() => gate, init.signal);
    else await gate;
    if (fail) return jsonResponse({ error: 'Synthetic error' }, 500);
    const body = JSON.parse(String(init?.body)) as DailyQuery;
    if (String(url).endsWith('/daily/feeds/hide')) { hidden = true; return jsonResponse({ status: 'hidden' }); }
    if (String(url).endsWith('/daily/feeds/restore')) { hidden = false; return jsonResponse({ status: 'restored' }); }
    const items = body.source === sources.attention ? threads.map(row => row.id === 'a' ? { ...row, hidden } : row) : events;
    return jsonResponse(result(body, items, sourceStatus, partial));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Waiting lists', () => {
  it('shows both buckets, service ages, expandable detail, hides and restores with the exact suppression key', async () => {
    const fetch = stub();
    render(<WaitingLists {...props} />);
    const expand = await screen.findByRole('button', { name: 'Synthetic thread a' });
    expect(screen.queryByText('Synthetic detail a')).toBeNull();
    fireEvent.click(expand);
    expect(expand.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Synthetic detail a')).toBeTruthy();
    expect(screen.getAllByText('3 business days')).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: 'Waiting on others threads' })).getByText('Synthetic thread b')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Synthetic thread a' }));
    const undo = await screen.findByRole('button', { name: 'Undo hide Synthetic thread a' });
    expect(document.activeElement).toBe(undo);
    fireEvent.click(undo);
    await screen.findByRole('button', { name: 'Hide Synthetic thread a' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Synthetic thread a' }));
    const posts = fetch.mock.calls.filter(([url]) => String(url).includes('/daily/feeds/'));
    expect(posts.map(([url, init]) => [String(url).split('/').pop(), JSON.parse(String(init?.body))])).toEqual([
      ['hide', { id: 'a' }], ['restore', { type: 'thread', key: 'synthetic-key-a' }],
    ]);
    expect(posts.every(([, init]) => init?.cache === 'no-store' && new Headers(init.headers).has('Authorization'))).toBe(true);
  });

  it('uses the same sized list shells while loading, empty and failed', async () => {
    stub({ gate: new Promise(() => {}) });
    const view = render(<WaitingLists {...props} />);
    expect(screen.getAllByText('Loading Gmail…')).toHaveLength(2);
    expect(view.container.querySelectorAll('.attention-list')).toHaveLength(2);
    expect(view.container.querySelectorAll('.attention-list[aria-busy="true"]')).toHaveLength(2);
    view.unmount();
    stub({ threads: [] });
    const empty = render(<WaitingLists {...props} />);
    expect(await screen.findAllByText('Nothing waiting here.')).toHaveLength(2);
    expect(empty.container.querySelectorAll('.attention-list')).toHaveLength(2);
    empty.unmount();
    stub({ fail: true });
    const failed = render(<WaitingLists {...props} />);
    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Retry Gmail' })).toHaveLength(2);
    expect(failed.container.querySelectorAll('.attention-list')).toHaveLength(2);
  });

  it('distinguishes a disconnected feed from empty and suppresses reads for absent capabilities', async () => {
    const fetch = stub({ sourceStatus: 'Missing', threads: [] });
    const view = render(<WaitingLists {...props} />);
    expect(await screen.findAllByText('Gmail feed not connected.')).toHaveLength(2);
    expect(screen.queryByText('Nothing waiting here.')).toBeNull();
    view.unmount(); fetch.mockClear();
    render(<WaitingLists {...props} sources={[]} />);
    expect(screen.getByText(/Gmail waiting lists unavailable/u)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps stale evidence visible, and a failed hide never removes the thread', async () => {
    const fetch = stub({ sourceStatus: 'Stale' });
    render(<WaitingLists {...props} />);
    await screen.findByText('Synthetic thread a');
    expect(screen.getByText(/Stale retained data/u)).toBeTruthy();
    fetch.mockImplementationOnce(async () => jsonResponse({ error: 'Synthetic refusal' }, 400));
    fireEvent.click(screen.getByRole('button', { name: 'Hide Synthetic thread a' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Hide Synthetic thread a' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo hide Synthetic thread a' })).toBeNull();
  });

  it('keeps the undo recovery when restore fails', async () => {
    const fetch = stub();
    render(<WaitingLists {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hide Synthetic thread a' }));
    const undo = await screen.findByRole('button', { name: 'Undo hide Synthetic thread a' });
    fetch.mockImplementationOnce(async () => jsonResponse({}, 500));
    fireEvent.click(undo);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Undo hide Synthetic thread a' })).toBeTruthy();
  });

  it('retains rows with visible recovery after a later read fails', async () => {
    const fetch = stub();
    const view = render(<WaitingLists {...props} />);
    await screen.findByText('Synthetic thread a');
    fetch.mockImplementation(async () => jsonResponse({}, 500));
    view.rerender(<WaitingLists {...props} refreshVersion={1} />);
    await screen.findAllByRole('button', { name: 'Retry Gmail' });
    expect(screen.getByText('Synthetic thread a')).toBeTruthy();
    expect(screen.queryByText('Nothing waiting here.')).toBeNull();
  });

  it('does not call absent capture evidence an empty successful feed', async () => {
    const fetch = stub({ threads: [] });
    fetch.mockImplementation(async (_url, init) => {
      const query = JSON.parse(String(init?.body)) as DailyQuery;
      return jsonResponse({ ...result(query), feedSources: [] });
    });
    render(<WaitingLists {...props} />);
    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(screen.queryByText('Nothing waiting here.')).toBeNull();
  });
});

describe('Calendar agenda', () => {
  it('renders the date rail, all-day and timed events with only timed overlaps marked', async () => {
    stub();
    render(<CalendarAgenda {...props} period={period} />);
    await screen.findByText('Synthetic event a');
    expect(screen.getByText('All day')).toBeTruthy();
    expect(screen.getByText('11:00 – 12:00')).toBeTruthy();
    expect(screen.getAllByText('Time conflict')).toHaveLength(2);
    expect(screen.getByLabelText('3 events')).toBeTruthy();
    expect(screen.getByText('Tue').closest('time')?.getAttribute('dateTime')).toBe('2026-10-20');
    expect(screen.queryByRole('button', { name: /Priority/u })).toBeNull();
  });

  it('shows partial coverage rather than claiming an empty complete period', async () => {
    stub({ partial: true, events: [] });
    render(<CalendarAgenda {...props} period={period} />);
    expect(await screen.findByText(/Partial coverage:/u)).toBeTruthy();
    expect(screen.getByText('No events in the available coverage.')).toBeTruthy();
    expect(screen.queryByText('No events in this period.')).toBeNull();
  });

  it('uses one agenda shell for loading, empty, error and disconnected states', async () => {
    stub({ gate: new Promise(() => {}) });
    const loading = render(<CalendarAgenda {...props} period={period} />);
    expect(screen.getByText('Loading Calendar…')).toBeTruthy();
    expect(loading.container.querySelector('.attention-agenda')).toBeTruthy();
    loading.unmount();
    for (const options of [{ events: [] }, { fail: true }, { sourceStatus: 'Missing' as const }]) {
      stub(options);
      const view = render(<CalendarAgenda {...props} period={period} />);
      const expected = 'fail' in options ? /Could not load Calendar/u : 'sourceStatus' in options ? 'Calendar feed not connected.' : 'No events in this period.';
      await screen.findByText(expected);
      expect(view.container.querySelector('.attention-agenda')).toBeTruthy();
      view.unmount();
    }
  });

  it('does not request an unadvertised calendar or call it empty', () => {
    const fetch = stub();
    render(<CalendarAgenda {...props} sources={[]} period={period} />);
    expect(screen.getByText(/Calendar agenda unavailable/u)).toBeTruthy();
    expect(screen.queryByText('No events in this period.')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a mismatched range and ignores all-day events outside the selected calendar dates', async () => {
    const fetch = stub({ events: [{ ...allDay, end: { date: '2026-10-20' } }] });
    const view = render(<CalendarAgenda {...props} period={period} />);
    await screen.findByText('No events in this period.');
    view.unmount();
    fetch.mockImplementation(async () => jsonResponse(result({ source: sources.calendar, from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' })));
    render(<CalendarAgenda {...props} period={period} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('Manual feed refresh', () => {
  it.each(['completed', 'running', 'limited'] as const)('reports the service %s state and enforces the cooldown', async state => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => jsonResponse({ runId: 'synthetic-run', state }));
    vi.stubGlobal('fetch', fetch);
    const completed = vi.fn();
    render(<FeedRefresh {...props} range={calendarRange(period)} onCompleted={completed} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh feeds' })); });
    const message = state === 'completed' ? 'Refresh completed.' : state === 'running' ? /already running/u : /Refresh limited/u;
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByText(/Wait 30s/u)).toBeTruthy();
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
    expect(completed).toHaveBeenCalledTimes(state === 'completed' ? 1 : 0);
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate requests while pending and does not turn source errors into success', async () => {
    let finish!: (value: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const completed = vi.fn();
    render(<FeedRefresh {...props} range={calendarRange(period)} onCompleted={completed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh feeds' }));
    expect(screen.getByRole('button', { name: 'Refreshing…' }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => finish(jsonResponse({ runId: 'synthetic-run', state: 'completed', sources: [{ source: 'Gmail', status: 'error', error: 'synthetic-error' }] })));
    expect(screen.getByText(/completed with source errors/u)).toBeTruthy();
    expect(completed).toHaveBeenCalledOnce();
  });

  it('reports an action error without claiming completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 403)));
    const completed = vi.fn();
    render(<FeedRefresh {...props} range={calendarRange(period)} onCompleted={completed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh feeds' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(completed).not.toHaveBeenCalled();
  });
});

describe('Overview integration', () => {
  it('renders nonpaginated snapshots with more than the ordinary 50-row page size', async () => {
    stub({
      threads: Array.from({ length: 51 }, (_, index) => thread(`synthetic-${index}`)),
      events: Array.from({ length: 51 }, (_, index) => event(`synthetic-${index}`)),
    });
    render(<AttentionOverview {...props}><p>Synthetic cards</p></AttentionOverview>);
    expect(await screen.findByLabelText('51 events')).toBeTruthy();
    expect(await screen.findByLabelText('51 threads')).toBeTruthy();
    expect(screen.getByText('Synthetic thread synthetic-50')).toBeTruthy();
  });

  it('has one explicit unavailable state, no empty lists or provider actions without feed capabilities', () => {
    const fetch = stub();
    render(<AttentionOverview {...props} sources={[]}><p>Synthetic cards</p></AttentionOverview>);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText(/Waiting lists and calendar agenda unavailable/u)).toBeTruthy();
    expect(screen.queryByText('Nothing waiting here.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh feeds' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shares the existing card period selection with agenda reads', async () => {
    const fetch = stub({ events: [], threads: [] });
    const available: DailySourceId[] = [sources.calendar];
    render(<MemoryRouter><AttentionOverview {...props} sources={available}>
      <TopCards backendUrl={props.backendUrl} getAccessToken={token} refreshVersion={0} available={[]} />
    </AttentionOverview></MemoryRouter>);
    await screen.findByText('No events in this period.');
    fireEvent.click(screen.getByRole('button', { name: '1 week' }));
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => {
      const query = JSON.parse(String(init?.body)) as { from?: string; to?: string };
      return query.from && query.to && Date.parse(query.to) - Date.parse(query.from) >= 7 * 86_400_000;
    })).toBe(true));
  });

  it('re-reads both retained feeds after a completed manual refresh', async () => {
    const fetch = stub();
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, init) => String(url).endsWith('/daily/feeds/refresh')
      ? jsonResponse({ runId: 'synthetic-run', state: 'completed' }) : original(url, init));
    render(<AttentionOverview {...props}><p>Synthetic cards</p></AttentionOverview>);
    await screen.findByText('Synthetic thread a');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh feeds' }));
    await screen.findByText('Refresh completed.');
    await waitFor(() => {
      const queries = fetch.mock.calls.filter(([url]) => String(url).endsWith('/daily/query'))
        .map(([, init]) => (JSON.parse(String(init?.body)) as DailyQuery).source);
      expect(queries.filter(source => source === sources.attention)).toHaveLength(2);
      expect(queries.filter(source => source === sources.calendar)).toHaveLength(2);
    });
  });
});
