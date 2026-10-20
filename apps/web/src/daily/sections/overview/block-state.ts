import type { DailyPages } from '../../ui/useDailyPages';

export type BlockState = 'loading' | 'error' | 'ready' | 'unavailable';

const severity: Record<BlockState, number> = { ready: 0, unavailable: 0, loading: 1, error: 2 };

/** Where a read stands. A refresh of values already on screen stays `ready`, so nothing blinks back to a skeleton. */
export function pagesState(pages: DailyPages, served: boolean): BlockState {
  if (!served) return 'unavailable';
  if (pages.status === 'error' && pages.items.length === 0) return 'error';
  return pages.first === null ? 'loading' : 'ready';
}

/** A read that failed after returning values: a refresh, or a later page. The values stay shown, so the card must say so and offer Retry. */
export const pagesStale = (pages: DailyPages) => pages.error !== null && pages.items.length > 0;

/** A card built from several reads shows the least settled of them. A read that is not served does not count: the tile that needs it says so itself. */
export function combineStates(...states: readonly BlockState[]): BlockState {
  return states.reduce<BlockState>((worst, state) => severity[state] > severity[worst] ? state : worst, 'ready');
}
