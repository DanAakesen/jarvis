import type { DailyJson, DailyQueryResult } from '@jarvis/contracts';
import { copenhagenDate } from '../../../period';
import { dateStep } from '../../nutrition/totals';
import type { OverviewWindow } from '../overview-window';
import { copenhagenHour } from '../overview-values';

export const record = (value: unknown): value is Record<string, DailyJson> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const instant = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d\d-\d\dT/u.test(value) && Number.isFinite(Date.parse(value));

export type WaitingRow = {
  id: string; suppressionKey: string; hidden: boolean;
  bucket: 'waiting_for_you' | 'waiting_on_others'; ageBusinessDays: number;
  title: string; detail: string; sender: string | null;
};
export function waitingRows(result: DailyQueryResult): WaitingRow[] {
  return result.items.filter(item => item.type === 'thread').map(item => {
    if (typeof item.id !== 'string' || typeof item.suppressionKey !== 'string' ||
        typeof item.hidden !== 'boolean' ||
        (item.bucket !== 'waiting_for_you' && item.bucket !== 'waiting_on_others') ||
        typeof item.ageBusinessDays !== 'number' || !Number.isInteger(item.ageBusinessDays) || item.ageBusinessDays < 0 ||
        !record(item.thread) || typeof item.thread.title !== 'string') throw new Error('Invalid waiting row');
    return {
      id: item.id, suppressionKey: item.suppressionKey, hidden: item.hidden,
      bucket: item.bucket, ageBusinessDays: item.ageBusinessDays, title: item.thread.title,
      detail: typeof item.thread.snippet === 'string' && item.thread.snippet ? item.thread.snippet :
        typeof item.thread.semanticEvidence === 'string' && item.thread.semanticEvidence ? item.thread.semanticEvidence : 'No detail available.',
      sender: typeof item.thread.senderName === 'string' ? item.thread.senderName : null,
    };
  });
}

export type AgendaEvent = {
  id: string; title: string; startsAt: string; endsAt: string; allDay: boolean;
  startDate: string; endDate: string; calendarName: string | null; location: string | null;
};
export function agendaEvents(result: DailyQueryResult): AgendaEvent[] {
  return result.items.filter(item => item.status !== 'cancelled').map(item => {
    if (typeof item.id !== 'string' || typeof item.title !== 'string' ||
        !instant(item.startsAt) || !instant(item.endsAt) || Date.parse(item.endsAt) <= Date.parse(item.startsAt) ||
        typeof item.allDay !== 'boolean' ||
        (item.allDay && (!record(item.start) || typeof item.start.date !== 'string' ||
          !record(item.end) || typeof item.end.date !== 'string'))) throw new Error('Invalid calendar event');
    return {
      id: item.id, title: item.title, startsAt: item.startsAt, endsAt: item.endsAt, allDay: item.allDay,
      startDate: item.allDay && record(item.start) ? String(item.start.date) : copenhagenDate(new Date(item.startsAt)),
      endDate: item.allDay && record(item.end) ? String(item.end.date) : copenhagenDate(new Date(Date.parse(item.endsAt) - 1)),
      calendarName: typeof item.calendarName === 'string' ? item.calendarName : null,
      location: typeof item.location === 'string' ? item.location : null,
    };
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
}

export function conflictingEvents(events: readonly AgendaEvent[]): Set<string> {
  const timed = events.filter(event => !event.allDay);
  const conflicts = new Set<string>();
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!; const b = timed[j]!;
      if (Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt)) {
        conflicts.add(a.id); conflicts.add(b.id);
      }
    }
  }
  return conflicts;
}

export function eventDays(events: readonly AgendaEvent[], period: Pick<OverviewWindow, 'startDate' | 'endDate'>) {
  const days: { date: string; events: AgendaEvent[] }[] = [];
  for (let date = period.startDate; date <= period.endDate; date = dateStep(date, 1)) {
    const onDate = events.filter(event => event.startDate <= date && (event.allDay ? date < event.endDate : date <= event.endDate));
    if (onDate.length) days.push({ date, events: onDate.sort((a, b) => Number(b.allDay) - Number(a.allDay)) });
  }
  return days;
}

/** Copenhagen midnight precedes the clock change on DST transition days. */
function midnight(date: string) {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const hour = copenhagenHour(new Date(utc));
  return new Date(utc - hour * 3_600_000).toISOString();
}
export function calendarRange(period: Pick<OverviewWindow, 'startDate' | 'endDate'>) {
  return { from: midnight(period.startDate), to: midnight(dateStep(period.endDate, 1)) };
}

export function feedSource(result: DailyQueryResult, source: 'Gmail' | 'GoogleCalendar') {
  const feed = result.feedSources?.find(item => item.source === source);
  if (!feed || !['Missing', 'Stale', 'Current'].includes(feed.status) ||
      (feed.capturedAt !== null && !instant(feed.capturedAt)) ||
      (feed.attemptedAt !== null && !instant(feed.attemptedAt)) ||
      (feed.error !== null && typeof feed.error !== 'string')) throw new Error('Invalid feed evidence');
  return feed;
}
