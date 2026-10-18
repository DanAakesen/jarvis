import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { DailySourceId } from '@jarvis/contracts';
import { DailyReadError, queryDaily } from './client';
import { dailyProbe, probeState, type DailyProbe } from './overview';
import { dailySources, initialDailyPeriod } from './presentation';
import { DailyRefreshContext } from './refresh';

const unreadable = 'This collection could not be read. Retry without changing your records.';
/** The backend shares a small SQL pool with chat, so the overview reads two collections at a time. */
const concurrency = 2;

type Source = typeof dailySources[number];
interface Entry { scope: string; key: string; probe: DailyProbe }
export interface ProbeRow { source: Source; probe: DailyProbe | undefined; pending: boolean }

const firstGeneration = () => ({ n: 0, asOf: new Date() });

/**
 * Reads each exposed collection once, read-only and one record deep, for the Daily overview.
 * `available` must keep its identity between renders (it is capabilities state). A refresh, a retry or the
 * existing Daily refresh stream re-reads everything while the previous settled results stay visible.
 */
export function useDailyProbes(backendUrl: string | null, getAccessToken: () => Promise<string>, available: readonly DailySourceId[] | undefined) {
  const refreshVersion = useContext(DailyRefreshContext);
  const [generation, setGeneration] = useState(firstGeneration);
  const [entries, setEntries] = useState<Partial<Record<DailySourceId, Entry>>>({});
  const requests = useMemo(() => {
    const period = initialDailyPeriod(generation.asOf);
    return dailySources.flatMap(source => {
      const query = available?.includes(source.id) ? dailyProbe(source.id, period) : null;
      return query ? [{ source, query }] : [];
    });
  }, [available, generation]);
  const scope = JSON.stringify(backendUrl);
  const key = JSON.stringify([scope, requests.map(request => request.query), generation.n, refreshVersion]);
  useEffect(() => {
    const controller = new AbortController();
    const queue = [...requests];
    const worker = async () => {
      for (let next = queue.shift(); next && !controller.signal.aborted; next = queue.shift()) {
        let probe: DailyProbe;
        try {
          const result = await queryDaily(backendUrl, next.query, getAccessToken, controller.signal);
          probe = { state: probeState(result), observedAt: result.freshness.observedAt };
        } catch (error) {
          if (controller.signal.aborted) return;
          probe = { state: 'failed', message: error instanceof DailyReadError ? error.message : unreadable };
        }
        if (controller.signal.aborted) return;
        const id = next.source.id;
        setEntries(current => ({ ...current, [id]: { scope, key, probe } }));
      }
    };
    void Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    return () => controller.abort();
  }, [backendUrl, getAccessToken, requests, scope, key]);
  const rows: ProbeRow[] = requests.map(({ source }) => {
    const entry = entries[source.id];
    return { source, probe: entry?.scope === scope ? entry.probe : undefined, pending: entry?.key !== key };
  });
  const reload = useCallback(() => setGeneration(previous => ({ n: previous.n + 1, asOf: new Date() })), []);
  return { rows, pending: rows.some(row => row.pending), reload };
}
