import { Loader } from '../../Loader';
import { formatTime } from './formatters';

export function DailyState({ status, message, emptyMessage, retryLabel = 'Retry', onRetry, onLoadMore, coverage, freshness }: {
  status: 'loading' | 'empty' | 'error' | 'partial' | 'ready';
  message?: string;
  emptyMessage?: string;
  retryLabel?: string;
  onRetry?: () => void;
  onLoadMore?: () => void;
  coverage?: { returned: number; hasMore: boolean };
  freshness?: { observedAt: string };
}) {
  return <div className="daily-state">
    {status === 'loading' && <Loader label="Loading Daily history" variant="rows" />}
    {status === 'empty' && <p role="status">{emptyMessage ?? 'No records'}</p>}
    {status === 'error' && <div role="alert"><p>{message ?? 'Daily history could not be loaded.'}</p>
      {onRetry && <button className="secondary-button" type="button" onClick={onRetry}>{retryLabel}</button>}
    </div>}
    {status === 'partial' && coverage?.hasMore && <p role="status">Showing the first {coverage.returned}. {onLoadMore &&
      <button className="secondary-button" type="button" onClick={onLoadMore}>Load more</button>}</p>}
    {freshness && <p className="daily-state-freshness">Read <time dateTime={freshness.observedAt}>{formatTime(freshness.observedAt)}</time>.</p>}
  </div>;
}
