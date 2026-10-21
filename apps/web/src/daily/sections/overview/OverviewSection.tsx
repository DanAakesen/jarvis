import { useContext, useEffect, useMemo, useRef } from 'react';
import { DailyOverview } from '../../DailyOverview';
import { DailySectionNavigationContext } from '../../section-navigation';
import type { DailySectionProps } from '../types';
import { HealthPanel } from './health-panel/HealthPanel';
import { useHealthPanel } from './useHealthPanel';
import { AttentionOverview } from './attention/AttentionOverview';
import './overview.css';

export default function OverviewSection({ backendUrl, getAccessToken, sources, refreshVersion }: DailySectionProps) {
  const navigation = useContext(DailySectionNavigationContext);
  const knownSources = useMemo(() => [...sources], [sources]);
  const { expanded } = useHealthPanel();
  const wasExpanded = useRef(expanded);
  // The panel unmounts when it closes, so focus goes back to the card control that opens it.
  useEffect(() => {
    const closed = wasExpanded.current && !expanded;
    wasExpanded.current = expanded;
    if (closed && (!document.activeElement || document.activeElement === document.body)) {
      document.querySelector<HTMLElement>('[data-card="health"] [aria-expanded]')?.focus();
    }
  }, [expanded]);
  return <AttentionOverview backendUrl={backendUrl} getAccessToken={getAccessToken} sources={sources} refreshVersion={refreshVersion}>
    <DailyOverview backendUrl={backendUrl} getAccessToken={getAccessToken}
      capabilities={{ sources: knownSources, error: navigation.availabilityError }}
      onRetryAvailability={navigation.retryAvailability} />
    {expanded && <HealthPanel backendUrl={backendUrl} getAccessToken={getAccessToken} sources={sources}
      refreshVersion={refreshVersion} />}
  </AttentionOverview>;
}
