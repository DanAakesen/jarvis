import { HealthState } from '../../ui/HealthState';
import type { HealthPages } from '../../ui/useHealthPages';

export function ReadState({ pages, name }: { pages: HealthPages; name: string }) {
  return <div className="body-sleep-read-state" aria-busy={pages.status === 'loading' || pages.loadingMore}>
    {pages.status === 'loading' && pages.items.length === 0 && <HealthState status="loading" />}
    {(pages.status === 'loading' && pages.items.length > 0 || pages.loadingMore) &&
      <p role="status">Refreshing {name}…</p>}
    {pages.error && <HealthState status="error" message={pages.error} retryLabel={`Retry ${name}`} onRetry={pages.reload} />}
    {pages.hasMore && <p role="status">{pages.capped ? 'Five-page limit reached.' : 'More records remain.'} Narrow the period.</p>}
  </div>;
}
