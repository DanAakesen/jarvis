import { Link } from 'react-router-dom';
import { healthQuerySources as sources } from '@jarvis/contracts';
import { useHealthQuery } from '../../useHealthQuery';
import { formatNumber, formatTime } from '../../ui/formatters';
import { Loader } from '../../../Loader';
import type { HealthSourceId } from '@jarvis/contracts';
import type { LiftEntry } from '../../lifts-client';

export function LastLifts({ backendUrl, getAccessToken, available, refreshVersion }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  available: readonly HealthSourceId[];
  refreshVersion: number;
}) {
  const enabled = available.includes(sources.lifts);
  const result = useHealthQuery(backendUrl, getAccessToken,
    enabled ? { source: sources.lifts, limit: 6, lastPerExercise: true } : null, refreshVersion);
  if (!enabled) return null;
  const entries = (result.data?.items ?? []) as unknown as LiftEntry[];
  return <section className="health-last-lifts" aria-labelledby="health-last-lifts-heading" aria-busy={result.pending}>
    <h2 id="health-last-lifts-heading">Last lifts</h2>
    {result.pending && entries.length === 0 && <Loader label="Loading last lifts" variant="inline" />}
    {result.error && <div role="alert">
      <p>{result.error}</p><button className="secondary-button" type="button" onClick={result.reload}>Retry</button>
    </div>}
    {!result.pending && !result.error && entries.length === 0 && <p role="status">No lifts logged.</p>}
    {entries.length > 0 && <ul aria-label="Latest lift per exercise">
      {entries.map(entry => <li key={entry.id}>
        <strong>{entry.exerciseName}</strong>
        <span>{formatNumber(entry.weightKg)} kg · {entry.reps} reps · {entry.sets} sets</span>
        <time dateTime={entry.performedAt}>{formatTime(entry.performedAt)}</time>
      </li>)}
    </ul>}
    <Link className="secondary-button" to="?section=track-workout">Track workout</Link>
  </section>;
}
