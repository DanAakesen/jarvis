import { useContext, useMemo } from 'react';
import { DailyOverview } from '../../DailyOverview';
import { DailySectionNavigationContext } from '../../section-navigation';
import type { DailySectionProps } from '../types';
import { HealthPanel } from './health-panel/HealthPanel';
import './overview.css';

export default function OverviewSection({ backendUrl, getAccessToken, sources, refreshVersion }: DailySectionProps) {
  const navigation = useContext(DailySectionNavigationContext);
  const knownSources = useMemo(() => [...sources], [sources]);
  return <><DailyOverview embedded backendUrl={backendUrl} getAccessToken={getAccessToken}
    capabilities={{ sources: knownSources, error: navigation.availabilityError }}
    onRetryAvailability={navigation.retryAvailability} onOpen={navigation.openSource}
    returnFocusTo={navigation.initialSource} />
    <HealthPanel backendUrl={backendUrl} getAccessToken={getAccessToken} sources={sources}
      refreshVersion={refreshVersion} targets={null} /></>;
}
