import { useContext } from 'react';
import { dailyQuerySources as sources, type DailySourceId } from '@jarvis/contracts';
import { Loader } from '../Loader';
import { TopCards } from './sections/overview/TopCards';
import { DailyRefreshContext } from './refresh';
import './daily.css';
import './daily-overview.css';

/**
 * The Health landing view: the Training, Health and Body cards for one period.
 */
export function DailyOverview({ backendUrl, getAccessToken, capabilities, onRetryAvailability }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  capabilities: { sources?: DailySourceId[] | undefined; error?: string | undefined };
  onRetryAvailability: () => void;
}) {
  const refreshVersion = useContext(DailyRefreshContext);
  const available = capabilities.sources ?? [];
  const hasCardSource =
    available.includes(sources.workouts) ||
    available.includes(sources.days) && available.includes(sources.meals) ||
    available.includes(sources.metrics) && available.includes(sources.metricCatalog) ||
    available.includes(sources.sleep);
  return <section className="daily-page daily-overview daily-overview-embedded" aria-labelledby="daily-heading">
    {capabilities.error
      ? <div className="daily-notice" role="alert"><p>{capabilities.error}</p>
        <button className="secondary-button" type="button" onClick={onRetryAvailability}>Retry availability</button></div>
      : !capabilities.sources ? <Loader label="Checking Health availability" variant="rows" />
        : hasCardSource
          ? <TopCards backendUrl={backendUrl} getAccessToken={getAccessToken} refreshVersion={refreshVersion} available={available} />
          : <p className="daily-empty" role="status">No Health data</p>}
  </section>;
}

