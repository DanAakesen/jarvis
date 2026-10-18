import { calendarViewPath } from '../../google/tools.js';
import type { GoogleApiClient } from '../../google/api-client.js';
import { copenhagenDateStart } from '../time.js';

const PAGE_SIZE = 25;
const MAX_EVENTS = 50;
const MAX_PAGES = 2;

export interface CalendarEvent {
  title: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  attendeeCount: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(0);
  const [year, month, day] = value.split('-').map(Number);
  parsed.setUTCFullYear(year!, month! - 1, day!);
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed.toISOString().slice(0, 10) === value;
}

function eventInstant(value: unknown): { date: Date; allDay: boolean } | undefined {
  const input = record(value);
  if (typeof input?.date === 'string') {
    if (!validCalendarDate(input.date)) return undefined;
    return { date: copenhagenDateStart(input.date), allDay: true };
  }
  if (typeof input?.dateTime !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(input.dateTime) ||
      !validCalendarDate(input.dateTime.slice(0, 10))) return undefined;
  const date = new Date(input.dateTime);
  return Number.isFinite(date.getTime()) ? { date, allDay: false } : undefined;
}

function normalizeEvent(value: unknown): CalendarEvent | undefined {
  const event = record(value);
  if (!event || event.status === 'cancelled' || event.transparency === 'transparent') return undefined;
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];
  if (attendees.some((attendee) => {
    const item = record(attendee);
    return item?.self === true && item.responseStatus === 'declined';
  })) return undefined;

  const start = eventInstant(event.start);
  const end = eventInstant(event.end);
  if (!start || !end || start.allDay !== end.allDay || end.date <= start.date) return undefined;
  const title = typeof event.summary === 'string' ? event.summary : '';
  const location = typeof event.location === 'string' ? event.location : '';
  return {
    title,
    location,
    startsAt: start.date,
    endsAt: end.date,
    allDay: start.allDay,
    attendeeCount: attendees.filter((attendee) => {
      const item = record(attendee);
      return item && item.self !== true;
    }).length,
  };
}

export async function readCalendarEvents(
  google: GoogleApiClient,
  { from, to, signal }: { from: Date; to: Date; signal: AbortSignal },
): Promise<CalendarEvent[]> {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new RangeError('Invalid calendar range');
  }
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES && events.length < MAX_EVENTS; page += 1) {
    const path = calendarViewPath(from, to, PAGE_SIZE, undefined, pageToken);
    const payload = await google.request('calendar', path, { method: 'GET', signal });
    if (payload.items !== undefined && !Array.isArray(payload.items)) throw new TypeError('Invalid calendar response');
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      const event = normalizeEvent(item);
      if (event && event.startsAt < to && event.endsAt > from) events.push(event);
      if (events.length >= MAX_EVENTS) break;
    }
    pageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken
      ? payload.nextPageToken
      : undefined;
    if (!pageToken || page === MAX_PAGES - 1) break;
  }
  return events.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime()).slice(0, MAX_EVENTS);
}
