// Sequential cursor paging for Daily summaries; loaded records never imply source completeness.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyJson, DailyQuery, DailyQueryResult } from '@jarvis/contracts';
import { DailyReadError, queryDaily } from '../client';

export interface DailyPages {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: Record<string, DailyJson>[];
  pages: number;
  hasMore: boolean;
  capped: boolean;
  loadingMore: boolean;
  error: string | null;
  first: DailyQueryResult | null;
  last: DailyQueryResult | null;
  loadMore(): void;
  reload(): void;
}

type PageState = Omit<DailyPages, 'loadMore' | 'reload'>;
const empty: PageState = {
  status: 'idle', items: [], pages: 0, hasMore: false, capped: false,
  loadingMore: false, error: null, first: null, last: null,
};

/** Window focus and tab visibility refetch only when the last first-page read is older than this. Refresh and Retry are immediate. */
export const focusRefreshWindowMs = 60_000;

/**
 * `settle` (with `autoLoad`) publishes once the automatic page chain has finished, so a card renders its start (previous
 * values kept) and its end instead of once per page. Without it every page publishes, as list views expect.
 */
export function useDailyPages(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  query: DailyQuery | null,
  refreshVersion: number,
  options?: { maxPages?: number; autoLoad?: boolean; settle?: boolean },
): DailyPages {
  const queryKey = JSON.stringify(query);
  const key = JSON.stringify([backendUrl, query]);
  const requestedMaxPages = options?.maxPages ?? 10;
  const maxPages = Number.isFinite(requestedMaxPages)
    ? Math.max(1, Math.min(50, Math.floor(requestedMaxPages))) : 10;
  const autoLoad = options?.autoLoad ?? false;
  const settle = autoLoad && (options?.settle ?? false);
  const [result, setResult] = useState<{ key: string; state: PageState }>({ key, state: empty });
  const actions = useRef({ loadMore: () => {}, reload: () => {} });

  useEffect(() => {
    const requested = JSON.parse(queryKey) as DailyQuery | null;
    if (requested === null) return;
    const controller = new AbortController();
    let active = true;
    let running = false;
    let refreshPending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let state: PageState = empty;
    let shown: PageState = empty;
    let readStartedAt: number | null = null;
    const publish = (next: PageState, show = true) => {
      state = next;
      if (!show) return;
      shown = next;
      setResult({ key, state });
    };
    // `auto` marks a page chained by autoLoad, as opposed to a user's Load more.
    const load = async (firstPage: boolean, auto = false) => {
      if (!active || running) return;
      const cursor = state.last?.coverage.next;
      if (!firstPage && (refreshPending || state.capped || !state.hasMore || !cursor)) return;
      running = true;
      if (firstPage) {
        readStartedAt = Date.now();
        // Starts from what the page shows, so a refresh that lands mid-chain never shrinks the visible records.
        publish({ ...shown, status: 'loading', loadingMore: false, error: null });
      } else {
        publish({ ...state, status: 'ready', loadingMore: true, error: null }, !(settle && auto));
      }
      try {
        const data = await queryDaily(backendUrl,
          firstPage ? requested : { ...requested, cursor } as DailyQuery,
          getAccessToken, controller.signal);
        if (!active) return;
        const pages = firstPage ? 1 : state.pages + 1;
        const capped = data.coverage.hasMore && pages >= maxPages;
        const chaining = data.coverage.hasMore && !capped && Boolean(data.coverage.next);
        publish({
          status: 'ready', items: firstPage ? data.items : [...state.items, ...data.items],
          pages, hasMore: data.coverage.hasMore, capped,
          loadingMore: false, error: null, first: firstPage ? data : state.first, last: data,
        }, !(settle && chaining));
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        const message = error instanceof DailyReadError ? error.message : 'Health could not be loaded.';
        const clear = error instanceof DailyReadError && (error.kind === 'auth' || error.kind === 'disabled');
        publish({
          ...(clear ? empty : state), status: firstPage || clear ? 'error' : 'ready',
          loadingMore: false, error: message,
        });
      } finally {
        running = false;
        if (active) {
          if (refreshPending) schedule();
          else if (autoLoad && state.error === null) void load(false, true);
        }
      }
    };
    const schedule = () => {
      refreshPending = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!active || running) return;
        refreshPending = false;
        void load(true);
      }, 200);
    };
    const visible = () => {
      if (document.visibilityState === 'hidden') return;
      const age = readStartedAt === null ? null : Date.now() - readStartedAt;
      if (state.error === null && age !== null && age >= 0 && age < focusRefreshWindowMs) return;
      schedule();
    };
    actions.current = { loadMore: () => { void load(false); }, reload: schedule };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    void load(true);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      actions.current = { loadMore: () => {}, reload: () => {} };
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [backendUrl, getAccessToken, key, queryKey, maxPages, autoLoad, settle]);

  const previousVersion = useRef(refreshVersion);
  useEffect(() => {
    if (previousVersion.current !== refreshVersion) actions.current.reload();
    previousVersion.current = refreshVersion;
  }, [refreshVersion]);
  const loadMore = useCallback(() => actions.current.loadMore(), []);
  const reload = useCallback(() => actions.current.reload(), []);
  const state = query === null ? empty : result.key === key ? result.state : { ...empty, status: 'loading' as const };
  return { ...state, loadMore, reload };
}
