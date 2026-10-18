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

export function useDailyPages(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  query: DailyQuery | null,
  refreshVersion: number,
  options?: { maxPages?: number; autoLoad?: boolean },
): DailyPages {
  const queryKey = JSON.stringify(query);
  const key = JSON.stringify([backendUrl, query]);
  const requestedMaxPages = options?.maxPages ?? 10;
  const maxPages = Number.isFinite(requestedMaxPages)
    ? Math.max(1, Math.min(50, Math.floor(requestedMaxPages))) : 10;
  const autoLoad = options?.autoLoad ?? false;
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
    const publish = (next: PageState) => {
      state = next;
      setResult({ key, state });
    };
    const load = async (firstPage: boolean) => {
      if (!active || running) return;
      const cursor = state.last?.coverage.next;
      if (!firstPage && (refreshPending || state.capped || !state.hasMore || !cursor)) return;
      running = true;
      publish({ ...state, status: firstPage ? 'loading' : 'ready', loadingMore: !firstPage, error: null });
      try {
        const data = await queryDaily(backendUrl,
          firstPage ? requested : { ...requested, cursor } as DailyQuery,
          getAccessToken, controller.signal);
        if (!active) return;
        const pages = firstPage ? 1 : state.pages + 1;
        publish({
          status: 'ready', items: firstPage ? data.items : [...state.items, ...data.items],
          pages, hasMore: data.coverage.hasMore, capped: data.coverage.hasMore && pages >= maxPages,
          loadingMore: false, error: null, first: firstPage ? data : state.first, last: data,
        });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        const message = error instanceof DailyReadError ? error.message : 'Daily could not be loaded. Retry to recover the recorded data.';
        const clear = error instanceof DailyReadError && (error.kind === 'auth' || error.kind === 'disabled');
        publish({
          ...(clear ? empty : state), status: firstPage || clear ? 'error' : 'ready',
          loadingMore: false, error: message,
        });
      } finally {
        running = false;
        if (active) {
          if (refreshPending) schedule();
          else if (autoLoad && state.error === null) void load(false);
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
    const visible = () => { if (document.visibilityState !== 'hidden') schedule(); };
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
  }, [backendUrl, getAccessToken, key, queryKey, maxPages, autoLoad]);

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
