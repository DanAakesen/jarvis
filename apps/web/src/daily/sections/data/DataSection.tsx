import { useContext } from 'react';
import { DailyPage } from '../../DailyPage';
import { DailySectionNavigationContext } from '../../section-navigation';
import type { DailySectionProps } from '../types';
import './data.css';

export default function DataSection({ backendUrl, getAccessToken, sources, period, onPeriodChange }: DailySectionProps) {
  const navigation = useContext(DailySectionNavigationContext);
  return <DailyPage embedded backendUrl={backendUrl} getAccessToken={getAccessToken} knownSources={sources}
    {...(navigation.initialSource ? { initialSource: navigation.initialSource } : {})} onSourceChange={navigation.onSourceChange}
    sharedPeriod={period} onPeriodChange={onPeriodChange}
    availabilityError={navigation.availabilityError} onRetryAvailability={navigation.retryAvailability} />;
}
