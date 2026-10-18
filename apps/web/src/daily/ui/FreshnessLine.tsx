import { formatTime } from './formatters';

export function FreshnessLine({ observedAt, count, partial = false, recordLabel = 'records' }: {
  observedAt?: string | null;
  count?: number | null;
  partial?: boolean;
  recordLabel?: string;
}) {
  const timestamp = observedAt && Number.isFinite(Date.parse(observedAt)) ? observedAt : null;
  return <p className="daily-freshness" role="status">
    Read {timestamp ? <time dateTime={timestamp}>{formatTime(timestamp)}</time> : 'at an unknown time'}
    {', '}
    {typeof count === 'number' && Number.isFinite(count) ? `${count} ${count === 1 ? recordLabel.replace(/s$/u, '') : recordLabel}` : `an unknown number of ${recordLabel}`}
    {partial ? ', partial' : ''}
  </p>;
}
