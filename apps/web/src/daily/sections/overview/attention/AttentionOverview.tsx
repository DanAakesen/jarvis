import { useMemo, useState, type ReactNode } from 'react';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import type { DailySectionProps } from '../../types';
import { defaultOverviewPreset, overviewWindow, type OverviewPresetId } from '../overview-window';
import { useToday } from '../useToday';
import { OverviewPeriodContext } from './period-context';
import { CalendarAgenda } from './CalendarAgenda';
import { WaitingLists } from './WaitingLists';
import { FeedRefresh } from './FeedRefresh';
import { calendarRange } from './data';
import './attention.css';

export function AttentionOverview({ children, ...props }: Pick<DailySectionProps,
  'backendUrl' | 'getAccessToken' | 'sources' | 'refreshVersion'> & { children: ReactNode }) {
  const [preset, setPreset] = useState<OverviewPresetId>(defaultOverviewPreset);
  const [version, setVersion] = useState(0);
  const { today } = useToday();
  const period = overviewWindow(preset, today);
  const selection = useMemo(() => ({ preset, setPreset }), [preset]);
  const enabled = props.sources.includes(sources.attention) || props.sources.includes(sources.calendar);
  const feedProps = { ...props, refreshVersion: props.refreshVersion + version };
  return <OverviewPeriodContext.Provider value={selection}>
    {children}
    {!enabled ? <section className="attention-card attention-unavailable" aria-label="Overview feeds">
      <h3>Mail and calendar</h3><p role="status">Waiting lists and calendar agenda unavailable. These sources are not offered by the backend.</p>
    </section> : <section className="attention-overview" aria-label="Mail and calendar">
      <FeedRefresh key={props.backendUrl} backendUrl={props.backendUrl} getAccessToken={props.getAccessToken}
        range={calendarRange(period)} onCompleted={() => setVersion(value => value + 1)} />
      <div className="attention-layout">
        <CalendarAgenda {...feedProps} period={period} />
        <WaitingLists key={`${props.backendUrl}:${props.sources.includes(sources.attention)}`} {...feedProps} />
      </div>
    </section>}
  </OverviewPeriodContext.Provider>;
}
