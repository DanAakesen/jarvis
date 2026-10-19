import { useCallback, useEffect, useRef, useState } from 'react';
import { isDailyQuery, type DailyQuery, type DailyQueryResult } from '@jarvis/contracts';
import { DailyReadError, queryDaily } from './client';

type Result = { key: string; data?: DailyQueryResult; error?: string; pending: boolean };
export function useDailyQuery(backendUrl: string | null, getAccessToken: () => Promise<string>, query: DailyQuery | null, refreshVersion: number) {
  const key = JSON.stringify([backendUrl, query]);
  const queryKey = JSON.stringify(query);
  const [result, setResult] = useState<Result>({ key, pending: query !== null });
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    const requested: unknown = JSON.parse(queryKey);
    if (!isDailyQuery(requested)) { refresh.current = () => {}; return; }
    const controller = new AbortController();
    let active = true; let running = false; let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!active) return;
      if (running) { queued = true; return; }
      running = true;
      setResult(previous => ({ key, pending: true, ...(previous.key === key && previous.data ? { data: previous.data } : {}) }));
      try {
        const data = await queryDaily(backendUrl, requested, getAccessToken, controller.signal);
        if (active) setResult({ key, data, pending: false });
      } catch (error) {
        if (active && !controller.signal.aborted) {
          const message = error instanceof DailyReadError ? error.message : 'Daily could not be loaded.';
          const clear = error instanceof DailyReadError && (error.kind === 'auth' || error.kind === 'disabled');
          setResult(previous => ({ key, pending: false, error: message,
            ...(!clear && previous.key === key && previous.data ? { data: previous.data } : {}) }));
        }
      } finally {
        running = false;
        if (active && queued) { queued = false; schedule(); }
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, 200);
    };
    const visible = () => { if (document.visibilityState !== 'hidden') schedule(); };
    refresh.current = schedule;
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    void load();
    return () => {
      active = false; controller.abort(); clearTimeout(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      refresh.current = () => {};
    };
  }, [backendUrl, getAccessToken, key, queryKey]);
  const previousVersion = useRef(refreshVersion);
  useEffect(() => {
    if (previousVersion.current !== refreshVersion) refresh.current();
    previousVersion.current = refreshVersion;
  }, [refreshVersion]);
  const reload = useCallback(() => refresh.current(), []);
  return { ...(result.key === key ? result : { key, pending: query !== null }), reload };
}
