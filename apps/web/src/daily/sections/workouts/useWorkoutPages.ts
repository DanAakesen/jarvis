import { useState } from 'react';
import type { DailyCursor, DailyQuery } from '@jarvis/contracts';
import { useDailyPages } from '../../ui/useDailyPages';
import type { Workout } from './summary';

// Each explicit continuation permits another bounded batch, without changing the shared hook.
export function useWorkoutPages(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  query: DailyQuery | null,
  refreshVersion: number,
) {
  const key = JSON.stringify([backendUrl, query, refreshVersion]);
  const [continuation, setContinuation] = useState<{ key: string; items: Workout[]; cursor: DailyCursor } | null>(null);
  const batch = continuation?.key === key ? continuation : null;
  const requested = query && batch ? { ...query, cursor: batch.cursor } as DailyQuery : query;
  const result = useDailyPages(backendUrl, getAccessToken, requested, refreshVersion, { autoLoad: true, maxPages: 10 });
  const items = result.status === 'error' ? result.items : [...(batch?.items ?? []), ...result.items];
  return {
    ...result,
    items,
    loadMore: () => {
      const cursor = result.last?.coverage.next;
      if (result.capped && cursor) setContinuation({ key, items, cursor });
      else result.loadMore();
    },
  };
}
