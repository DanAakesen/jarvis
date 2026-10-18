import { Loader } from '../../Loader';
import { formatTime } from './formatters';

export function DailyState({ status, onRetry, onLoadMore, returned, freshness }: {
  status: 'loading' | 'empty' | 'error' | 'partial' | 'ready';
  onRetry?: () => void;
  onLoadMore?: () => void;
  returned?: number;
  freshness?: { observedAt: string };
}) {
  return <div className="daily-state">
    {status === 'loading' && <Loader label="Loading Daily history" variant="rows" />}
    {status === 'empty' && <p role="status">History appears after an import or a phone upload. None returned does not prove the original source is empty.</p>}
    {status === 'error' && <div role="alert"><p>Daily history could not be loaded.</p>
      {onRetry && <button className="secondary-button" type="button" onClick={onRetry}>Retry</button>}
    </div>}
    {status === 'partial' && <p role="status">Showing the first {returned ?? 0}. {onLoadMore &&
      <button className="secondary-button" type="button" onClick={onLoadMore}>Load more</button>}</p>}
    {freshness && <p className="daily-state-freshness">Read <time dateTime={freshness.observedAt}>{formatTime(freshness.observedAt)}</time>.</p>}
  </div>;
}
