import { DailyState } from '../../ui/DailyState';
import type { DailyPages } from '../../ui/useDailyPages';

export function ReadState({ pages, name }: { pages: DailyPages; name: string }) {
  return <div className="body-sleep-read-state">
    {pages.status === 'loading' && pages.items.length === 0
      ? <DailyState status="loading" />
      : <p role="status">{pages.status === 'loading' || pages.loadingMore ? `Refreshing ${name}…` :
        `${pages.items.length} retained records loaded across ${pages.pages} ${pages.pages === 1 ? 'page' : 'pages'}.`}</p>}
    {pages.error && <DailyState status="error" message={pages.error} retryLabel={`Retry ${name}`} onRetry={pages.reload} />}
    {pages.status === 'ready' && pages.items.length === 0 && <DailyState status="empty" />}
    {pages.hasMore && <p role="status">{pages.capped ? 'Five-page limit reached.' : 'More records remain.'} Loaded records only; narrow the period for more detail.</p>}
    {pages.first && <DailyState status="ready" freshness={pages.first.freshness} />}
  </div>;
}
