import { useCallback, useEffect, useRef, useState } from 'react';
import { isHealthQuery, type HealthQuery, type HealthQueryResult } from '@jarvis/contracts';
import { HealthReadError, queryHealth } from './client';

type Result = { key: string; data?: HealthQueryResult; error?: string; pending: boolean };
export function useHealthQuery(backendUrl: string | null, getAccessToken: () => Promise<string>, query: HealthQuery | null, refreshVersion: number) {
  const key = JSON.stringify([backendUrl, query]);
  const queryKey = JSON.stringify(query);
  const [result, setResult] = useState<Result>({ key, pending: query !== null });
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    const requested: unknown = JSON.parse(queryKey);
    if (!isHealthQuery(requested)) { refresh.current = () => {}; return; }
    const controller = new AbortController();
    let active = true; let running = false; let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!active) return;
      if (running) { queued = true; return; }
      running = true;
      setResult(previous => ({ key, pending: true, ...(previous.key === key && previous.data ? { data: previous.data } : {}) }));
      try {
        const data = await queryHealth(backendUrl, requested, getAccessToken, controller.signal);
        if (active) setResult({ key, data, pending: false });
      } catch (error) {
        if (active && !controller.signal.aborted) {
          const message = error instanceof HealthReadError ? error.message : 'Health could not be loaded.';
          const clear = error instanceof HealthReadError && (error.kind === 'auth' || error.kind === 'disabled');
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
