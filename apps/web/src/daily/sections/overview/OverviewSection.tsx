import { useContext, useMemo } from 'react';
import { DailyOverview } from '../../DailyOverview';
import { DailySectionNavigationContext } from '../../section-navigation';
import type { DailySectionProps } from '../types';
import './overview.css';

export default function OverviewSection({ backendUrl, getAccessToken, sources }: DailySectionProps) {
  const navigation = useContext(DailySectionNavigationContext);
  const knownSources = useMemo(() => [...sources], [sources]);
  return <DailyOverview backendUrl={backendUrl} getAccessToken={getAccessToken}
    capabilities={{ sources: knownSources, error: navigation.availabilityError }}
    onRetryAvailability={navigation.retryAvailability} />;
}
