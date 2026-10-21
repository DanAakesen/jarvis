import type { DailyQueryResult } from '@jarvis/contracts';
import { formatTime } from '../../../ui/formatters';
import { feedSource } from './data';

export function FeedState({ result, source }: { result: DailyQueryResult; source: 'Gmail' | 'GoogleCalendar' }) {
  const feed = feedSource(result, source);
  return <p className="attention-source">
    {feed.status === 'Stale' && feed.capturedAt ? 'Stale retained data. ' : ''}
    {feed.error && feed.attemptedAt ? 'The last source update failed. ' : ''}
    {feed.capturedAt ? `Last successful capture: ${formatTime(feed.capturedAt)}.` : 'No successful capture recorded.'}
  </p>;
}

export function FeedMessage({ pending, error, retry, noun }: {
  pending: boolean; error?: string | undefined; retry: () => void; noun: string;
}) {
  if (error) return <div role="alert"><p>Could not load {noun}. {error}</p>
    <button type="button" className="secondary-button" onClick={retry}>Retry {noun}</button></div>;
  return <p role="status">{pending ? `Loading ${noun}…` : `${noun} feed not connected.`}</p>;
}
