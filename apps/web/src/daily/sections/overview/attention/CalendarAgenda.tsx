import { useId } from 'react';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import { useDailyQuery } from '../../../useDailyQuery';
import { formatClockTime, formatDate } from '../../../ui/formatters';
import { formatShortMonth, formatShortWeekday } from '../../../../format/date-time';
import type { DailySectionProps } from '../../types';
import type { OverviewWindow } from '../overview-window';
import { agendaEvents, calendarRange, conflictingEvents, eventDays, feedSource } from './data';
import { FeedMessage, FeedState } from './FeedState';

type Props = Pick<DailySectionProps, 'backendUrl' | 'getAccessToken' | 'sources' | 'refreshVersion'> & {
  period: Pick<OverviewWindow, 'startDate' | 'endDate'>;
};

export function CalendarAgenda({ period, ...props }: Props) {
  const enabled = props.sources.includes(sources.calendar);
  const range = calendarRange(period);
  const read = useDailyQuery(props.backendUrl, props.getAccessToken, enabled ? { source: sources.calendar, ...range } : null, props.refreshVersion);
  const heading = useId();
  let events: ReturnType<typeof agendaEvents> = [];
  let invalid = false;
  let disconnected = false;
  if (read.data) {
    try {
      const feed = feedSource(read.data, 'GoogleCalendar');
      disconnected = feed.status === 'Missing' || feed.capturedAt === null;
      if (read.data.calendarRange?.from !== range.from || read.data.calendarRange.to !== range.to ||
          typeof read.data.rangeCovered !== 'boolean') throw new Error('Mismatched calendar range');
      events = agendaEvents(read.data).filter(event => event.startDate <= period.endDate &&
        (event.allDay ? event.endDate > period.startDate : event.endDate >= period.startDate));
    } catch { invalid = true; }
  }
  const conflicts = conflictingEvents(events);
  const days = eventDays(events, period);
  const ready = enabled && read.data && !invalid && !disconnected;
  const partial = ready && !read.data!.rangeCovered;
  return <section className="attention-card attention-agenda" aria-labelledby={heading} aria-busy={read.pending}>
    <header className="attention-heading"><h3 id={heading}>Calendar agenda</h3>
      <span className="attention-chip" aria-label={ready ? `${events.length} events` : 'Event count unavailable'}>{ready ? events.length : '—'}</span></header>
    <p className="attention-period">{formatDate(period.startDate)}{period.startDate !== period.endDate && ` – ${formatDate(period.endDate)}`} · Copenhagen time</p>
    <div className="attention-scroll" role="region" aria-label="Calendar events" tabIndex={0}>
      {!enabled ? <p role="status">Calendar agenda unavailable. This source is not offered by the backend.</p>
        : !ready ? <FeedMessage pending={read.pending} error={invalid ? 'Incomplete calendar evidence.' : read.error} retry={read.reload} noun="Calendar" />
          : <>
            {read.error && <FeedMessage pending={false} error={read.error} retry={read.reload} noun="Calendar" />}
            {partial && <p role="status" className="attention-notice">Partial coverage: the retained calendar does not cover the entire selected period. Events may be missing.</p>}
            {!events.length ? <p className="attention-empty">{partial ? 'No events in the available coverage.' : 'No events in this period.'}</p> :
              <ol className="attention-days">{days.map(day => <li key={day.date} className="attention-day">
                <time className="attention-date" dateTime={day.date}>
                  <span>{formatShortWeekday(day.date, { timeZone: 'UTC' })}</span>
                  <strong>{Number(day.date.slice(8))}</strong>
                  <span>{formatShortMonth(day.date, { timeZone: 'UTC' })}</span>
                </time>
                <ul className="attention-events">{day.events.map(event => <li key={event.id} className="attention-event">
                  <p className="attention-event-time">{event.allDay ? 'All day' : `${formatClockTime(event.startsAt)} – ${formatClockTime(event.endsAt)}`}
                    {!event.allDay && event.startDate !== event.endDate && ' · Multi-day'}</p>
                  <p className="attention-event-title">{event.title}</p>
                  {(event.calendarName || event.location) && <p className="attention-event-meta">{[event.calendarName, event.location].filter(Boolean).join(' · ')}</p>}
                  {conflicts.has(event.id) && <span className="attention-chip attention-conflict">Time conflict</span>}
                </li>)}</ul>
              </li>)}</ol>}
          </>}
    </div>
    {read.data && !invalid && <FeedState result={read.data} source="GoogleCalendar" />}
  </section>;
}
