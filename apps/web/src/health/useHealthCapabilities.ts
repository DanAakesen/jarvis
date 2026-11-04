import { useCallback, useEffect, useState } from 'react';
import type { HealthSourceId } from '@jarvis/contracts';
import { HealthReadError, loadHealthSources } from './client';

type Loaded = { key: string; sources?: HealthSourceId[]; error?: string };

/**
 * Which Health collections this backend exposes. Pass `enabled: false` when the caller already holds the answer,
 * so no second request is made.
 */
export function useHealthCapabilities(backendUrl: string | null, getAccessToken: () => Promise<string>, enabled = true) {
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([backendUrl, retry]);
  const [loaded, setLoaded] = useState<Loaded>({ key });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loadHealthSources(backendUrl, getAccessToken, controller.signal).then(
      sources => { if (!controller.signal.aborted) setLoaded({ key, sources }); },
      error => {
        if (!controller.signal.aborted) setLoaded({ key,
          error: error instanceof HealthReadError ? error.message : 'Health availability could not be checked.' });
      },
    );
    return () => controller.abort();
  }, [backendUrl, getAccessToken, key, enabled]);
  const current = loaded.key === key ? loaded : { key };
  const reload = useCallback(() => setRetry(value => value + 1), []);
  return { sources: current.sources, error: current.error, reload };
}
