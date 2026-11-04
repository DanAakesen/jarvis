import { useContext } from 'react';
import { HealthPage } from '../../HealthPage';
import { HealthSectionNavigationContext } from '../../section-navigation';
import type { HealthSectionProps } from '../types';
import './data.css';

export default function DataSection({ backendUrl, getAccessToken, sources, period, onPeriodChange }: HealthSectionProps) {
  const navigation = useContext(HealthSectionNavigationContext);
  return <HealthPage embedded backendUrl={backendUrl} getAccessToken={getAccessToken} knownSources={sources}
    {...(navigation.initialSource ? { initialSource: navigation.initialSource } : {})} onSourceChange={navigation.onSourceChange}
    sharedPeriod={period} onPeriodChange={onPeriodChange}
    availabilityError={navigation.availabilityError} onRetryAvailability={navigation.retryAvailability} />;
}
