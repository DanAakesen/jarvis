import { DailyState } from '../../ui/DailyState';
import type { DailyPages } from '../../ui/useDailyPages';

export function ReadState({ pages, name }: { pages: DailyPages; name: string }) {
  return <div className="body-sleep-read-state" aria-busy={pages.status === 'loading' || pages.loadingMore}>
    {pages.status === 'loading' && pages.items.length === 0 && <DailyState status="loading" />}
    {(pages.status === 'loading' && pages.items.length > 0 || pages.loadingMore) &&
      <p role="status">Refreshing {name}…</p>}
    {pages.error && <DailyState status="error" message={pages.error} retryLabel={`Retry ${name}`} onRetry={pages.reload} />}
    {pages.hasMore && <p role="status">{pages.capped ? 'Five-page limit reached.' : 'More records remain.'} Loaded records only; narrow the period for more detail.</p>}
  </div>;
}
