import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources, type DailyQuery, type DailyQueryResult } from '@jarvis/contracts';
import { DailyReadError, queryDaily } from '../client';
import { dailyFixture } from '../test-support';
import { useDailyPages } from './useDailyPages';

vi.mock('../client', async importOriginal => ({
  ...await importOriginal<typeof import('../client')>(),
  queryDaily: vi.fn(),
}));

const read = vi.mocked(queryDaily);
const backendUrl = 'http://localhost:3999';
const token = async () => 'synthetic-fixture';
const query: DailyQuery = {
  source: dailyQuerySources.workouts, startDate: '2026-01-01', endDate: '2026-10-17', limit: 50,
};
const cursor1 = { date: '2026-10-16', key: 'synthetic-1' };
const cursor2 = { date: '2026-10-15', key: 'synthetic-2' };
const first = dailyFixture(query, [{ id: 'first' }], cursor1);
const second = dailyFixture(query, [{ id: 'second' }], cursor2);
const third = dailyFixture(query, [{ id: 'third' }]);
function deferred() {
  let resolve!: (value: DailyQueryResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<DailyQueryResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { await act(async () => { await Promise.resolve(); }); }
async function tick(ms = 200) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function hook(options?: { maxPages?: number; autoLoad?: boolean }) {
  return renderHook(() => useDailyPages(backendUrl, token, query, 0, options));
}

beforeEach(() => { vi.useFakeTimers(); read.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('useDailyPages', () => {
  it('loads one page by default and chains exact cursors in server order', async () => {
    read.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(third);
    const { result } = hook();
    expect(result.current).toMatchObject({ status: 'loading', pages: 0, loadingMore: false });
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ status: 'ready', pages: 1, items: first.items, hasMore: true });
    await act(async () => { result.current.loadMore(); });
    await act(async () => { result.current.loadMore(); });
    expect(read.mock.calls.map(call => call[1])).toEqual([
      query, { ...query, cursor: cursor1 }, { ...query, cursor: cursor2 },
    ]);
    expect(read.mock.calls.every(call => call[0] === backendUrl && call[2] === token)).toBe(true);
    expect(result.current).toMatchObject({
      status: 'ready', items: [...first.items, ...second.items, ...third.items],
      pages: 3, hasMore: false, capped: false, first, last: third, error: null,
    });
    expect(result.current.first?.coverage.sourceCompleteness).toBe('unknown');
    expect(result.current.last?.coverage.sourceCompleteness).toBe('unknown');
  });

  it('sends the initial query as given, including its cursor', async () => {
    const requested = { ...query, cursor: cursor2 };
    read.mockResolvedValue(third);
    renderHook(() => useDailyPages(backendUrl, token, requested, 0));
    await settle();
    expect(read.mock.calls[0]?.[1]).toEqual(requested);
  });

  it('auto-loads sequentially and stops when the server reports no more', async () => {
    const pending = deferred();
    read.mockResolvedValueOnce(first).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(third);
    const { result } = hook({ autoLoad: true });
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ status: 'ready', pages: 1, loadingMore: true });
    act(() => { result.current.loadMore(); result.current.loadMore(); });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => { pending.resolve(second); });
    expect(read).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ pages: 3, hasMore: false, capped: false, loadingMore: false });
  });

  it.each([
    [undefined, 10], [2, 2], [100, 50], [0, 1], [-1, 1], [2.8, 2], [NaN, 10], [Infinity, 10],
  ])('bounds maxPages %s to %s and keeps hasMore honest at the cap', async (maxPages, pages) => {
    read.mockResolvedValue(first);
    const { result } = hook({ autoLoad: true, ...(maxPages === undefined ? {} : { maxPages }) });
    await settle();
    expect(read).toHaveBeenCalledTimes(pages);
    expect(result.current).toMatchObject({ pages, hasMore: true, capped: true });
    act(() => result.current.loadMore());
    expect(read).toHaveBeenCalledTimes(pages);
  });

  it('does not mark a complete last page as capped', async () => {
    read.mockResolvedValue(third);
    const { result } = hook({ autoLoad: true, maxPages: 1 });
    await settle();
    expect(result.current).toMatchObject({ hasMore: false, capped: false });
  });

  it('ignores loadMore during the first request and without a next page', async () => {
    const pending = deferred();
    read.mockReturnValueOnce(pending.promise);
    const { result } = hook();
    act(() => { result.current.loadMore(); result.current.loadMore(); });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(third); });
    act(() => result.current.loadMore());
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('requires both hasMore and a next cursor before chaining', async () => {
    read.mockResolvedValue({ ...first, coverage: { ...first.coverage, next: null } });
    const { result } = hook({ autoLoad: true });
    await settle();
    act(() => result.current.loadMore());
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.hasMore).toBe(true);
  });

  it.each(['query', 'backend'] as const)('aborts and resets on a changed %s, ignoring late responses', async change => {
    const pending = deferred();
    const replacement = deferred();
    read.mockResolvedValueOnce(first).mockReturnValueOnce(pending.promise).mockReturnValueOnce(replacement.promise);
    const { result, rerender } = renderHook(
      ({ url, input }) => useDailyPages(url, token, input, 0),
      { initialProps: { url: backendUrl, input: query } },
    );
    await settle();
    act(() => result.current.loadMore());
    const oldSignal = read.mock.calls[1]?.[3];
    rerender({
      url: change === 'backend' ? 'http://localhost:4000' : backendUrl,
      input: change === 'query' ? { ...query, startDate: '2026-10-01' } : query,
    });
    expect(oldSignal?.aborted).toBe(true);
    expect(result.current).toMatchObject({ status: 'loading', items: [], pages: 0, first: null, last: null });
    await act(async () => { pending.resolve(second); });
    expect(result.current.items).toEqual([]);
    await act(async () => { replacement.resolve(third); });
    expect(result.current).toMatchObject({ pages: 1, items: third.items });
  });

  it('does not restart for an equivalent query object', async () => {
    read.mockResolvedValue(first);
    const { rerender } = renderHook(({ input }) => useDailyPages(backendUrl, token, input, 0),
      { initialProps: { input: query } });
    await settle();
    rerender({ input: { ...query } });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('debounces reload and keeps all old pages until the new first page arrives', async () => {
    const pending = deferred();
    read.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockReturnValueOnce(pending.promise);
    const { result } = hook();
    await settle();
    await act(async () => { result.current.loadMore(); });
    act(() => result.current.reload());
    await tick(100);
    act(() => result.current.reload());
    await tick(199);
    expect(read).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(result.current).toMatchObject({ status: 'loading', pages: 2, items: [...first.items, ...second.items] });
    expect(read.mock.calls[2]?.[1]).toEqual(query);
    await act(async () => { pending.resolve(third); });
    expect(result.current).toMatchObject({ status: 'ready', pages: 1, items: third.items, first: third, last: third });
  });

  it('keeps old records when a reload fails', async () => {
    read.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('private detail'));
    const { result } = hook();
    await settle();
    act(() => result.current.reload());
    await tick();
    expect(result.current).toMatchObject({
      status: 'error', items: first.items, pages: 1, first, last: first,
      error: 'Daily could not be loaded. Retry to recover the recorded data.',
    });
  });

  it('coalesces reloads during an in-flight read without overlapping requests', async () => {
    const pending = deferred();
    read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(third);
    const { result } = hook({ autoLoad: true });
    act(() => result.current.reload());
    await tick();
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(first); });
    expect(read).toHaveBeenCalledTimes(1);
    await tick();
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]?.[1]).toEqual(query);
    expect(result.current.items).toEqual(third.items);
  });

  it('refreshes on changed refreshVersion, window focus and visible tabs', async () => {
    read.mockResolvedValue(third);
    const { rerender } = renderHook(({ version }) => useDailyPages(backendUrl, token, query, version),
      { initialProps: { version: 0 } });
    await settle();
    rerender({ version: 1 });
    await tick();
    expect(read).toHaveBeenCalledTimes(2);
    rerender({ version: 1 });
    await tick();
    expect(read).toHaveBeenCalledTimes(2);
    act(() => window.dispatchEvent(new Event('focus')));
    await tick();
    expect(read).toHaveBeenCalledTimes(3);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    await tick();
    expect(read).toHaveBeenCalledTimes(3);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await tick();
    expect(read).toHaveBeenCalledTimes(4);
    vi.restoreAllMocks();
  });

  it.each([
    [new DailyReadError('Synthetic unavailable'), 'Synthetic unavailable'],
    [new Error('private detail'), 'Daily could not be loaded. Retry to recover the recorded data.'],
  ])('reports a first-page failure with the shared recovery message', async (error, message) => {
    read.mockRejectedValueOnce(error);
    const { result } = hook();
    await settle();
    expect(result.current).toMatchObject({ status: 'error', items: [], pages: 0, error: message });
  });

  it('keeps later-page failures ready and retries exactly the failed cursor', async () => {
    read.mockResolvedValueOnce(first).mockRejectedValueOnce(new DailyReadError('Synthetic unavailable'))
      .mockResolvedValueOnce(third);
    const { result } = hook({ autoLoad: true });
    await settle();
    expect(result.current).toMatchObject({
      status: 'ready', pages: 1, items: first.items, hasMore: true, loadingMore: false, error: 'Synthetic unavailable',
    });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => { result.current.loadMore(); });
    expect(read.mock.calls[1]?.[1]).toEqual({ ...query, cursor: cursor1 });
    expect(read.mock.calls[2]?.[1]).toEqual(read.mock.calls[1]?.[1]);
    expect(result.current).toMatchObject({ pages: 2, items: [...first.items, ...third.items], error: null });
  });

  it.each(['auth', 'disabled'] as const)('clears loaded records for a later %s failure', async kind => {
    read.mockResolvedValueOnce(first).mockRejectedValueOnce(new DailyReadError('Synthetic access failure', kind));
    const { result } = hook();
    await settle();
    await act(async () => { result.current.loadMore(); });
    expect(result.current).toMatchObject({
      status: 'error', items: [], pages: 0, first: null, last: null, hasMore: false, error: 'Synthetic access failure',
    });
  });

  it('stays idle with a null query and clears previous records and scheduled work', async () => {
    read.mockResolvedValue(first);
    const { result, rerender } = renderHook(
      ({ input }: { input: DailyQuery | null }) => useDailyPages(backendUrl, token, input, 0),
      { initialProps: { input: null as DailyQuery | null } },
    );
    act(() => { result.current.loadMore(); result.current.reload(); });
    await tick();
    expect(read).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ status: 'idle', items: [], pages: 0 });
    rerender({ input: query });
    await settle();
    act(() => result.current.reload());
    rerender({ input: null });
    act(() => { result.current.loadMore(); result.current.reload(); });
    await tick();
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ status: 'idle', items: [], pages: 0, first: null, last: null });
  });

  it('aborts on unmount, ignores late failures and removes refresh listeners and timers', async () => {
    const pending = deferred();
    const consoleError = vi.spyOn(console, 'error');
    read.mockReturnValueOnce(pending.promise);
    const { result, unmount } = hook({ autoLoad: true });
    const signal = read.mock.calls[0]?.[3];
    act(() => result.current.reload());
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.reject(new Error('late failure')); });
    act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await tick();
    expect(read).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
