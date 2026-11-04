import { useContext } from 'react';
import { healthQuerySources as sources, type HealthSourceId } from '@jarvis/contracts';
import { Loader } from '../Loader';
import { TopCards } from './sections/overview/TopCards';
import { LastLifts } from './sections/overview/LastLifts';
import { HealthRefreshContext } from './refresh';
import './health.css';
import './health-overview.css';

/**
 * The Health landing view: the Training, Health and Body cards for one period.
 */
export function HealthOverview({ backendUrl, getAccessToken, capabilities, onRetryAvailability }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  capabilities: { sources?: HealthSourceId[] | undefined; error?: string | undefined };
  onRetryAvailability: () => void;
}) {
  const refreshVersion = useContext(HealthRefreshContext);
  const available = capabilities.sources ?? [];
  const hasCardSource =
    available.includes(sources.workouts) ||
    available.includes(sources.days) && available.includes(sources.meals) ||
    available.includes(sources.metrics) && available.includes(sources.metricCatalog) ||
    available.includes(sources.sleep);
  return <section className="health-page health-overview health-overview-embedded" aria-labelledby="health-heading">
    {capabilities.error
      ? <div className="health-notice" role="alert"><p>{capabilities.error}</p>
        <button className="secondary-button" type="button" onClick={onRetryAvailability}>Retry availability</button></div>
      : !capabilities.sources ? <Loader label="Checking Health availability" variant="rows" />
        : <>
          {hasCardSource && <TopCards backendUrl={backendUrl} getAccessToken={getAccessToken} refreshVersion={refreshVersion} available={available} />}
          {available.includes(sources.lifts) && <LastLifts backendUrl={backendUrl} getAccessToken={getAccessToken}
            refreshVersion={refreshVersion} available={available} />}
          {!hasCardSource && !available.includes(sources.lifts) && <p className="health-empty" role="status">No Health data</p>}
        </>}
  </section>;
}
