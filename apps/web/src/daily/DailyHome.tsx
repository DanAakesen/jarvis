import { useEffect, useState } from 'react';
import type { DailySourceId } from '@jarvis/contracts';
import type { AreaProps } from '../areas';
import { DailyOverview } from './DailyOverview';
import { DailyPage } from './DailyPage';
import { useDailyCapabilities } from './useDailyCapabilities';

type View = { kind: 'overview'; returnFocusTo?: DailySourceId | undefined } | { kind: 'browse'; source: DailySourceId };

/** Daily opens on an overview of what is stored; Open takes one collection into the record browser and Back returns. */
export function DailyHome({ backendUrl, getAccessToken }: AreaProps) {
  const capabilities = useDailyCapabilities(backendUrl, getAccessToken);
  const [view, setView] = useState<View>({ kind: 'overview' });
  useEffect(() => {
    if (view.kind === 'browse') document.getElementById('daily-heading')?.focus({ preventScroll: true });
  }, [view.kind]);
  if (view.kind === 'browse' && capabilities.sources) {
    const { source } = view;
    return <DailyPage backendUrl={backendUrl} getAccessToken={getAccessToken} knownSources={capabilities.sources}
      initialSource={source} onBack={() => setView({ kind: 'overview', returnFocusTo: source })} />;
  }
  return <DailyOverview backendUrl={backendUrl} getAccessToken={getAccessToken}
    capabilities={{ sources: capabilities.sources, error: capabilities.error }}
    onRetryAvailability={capabilities.reload}
    onOpen={source => setView({ kind: 'browse', source })}
    returnFocusTo={view.kind === 'overview' ? view.returnFocusTo : undefined} />;
}
