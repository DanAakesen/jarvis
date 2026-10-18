import { describe, expect, it } from 'vitest';
import type { GoogleApiClient } from '../../google/api-client.js';
import { readCalendarEvents } from './calendar-reader.js';

function calendarEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'synthetic-event',
    summary: 'Synthetic event',
    start: { dateTime: '2026-10-20T12:00:00+02:00' },
    end: { dateTime: '2026-10-20T13:00:00+02:00' },
    ...overrides,
  };
}

function fakeGoogle(pages: Record<string, unknown>[]): { google: GoogleApiClient; paths: string[] } {
  const paths: string[] = [];
  return {
    google: {
      async request(api, path, options) {
        expect(api).toBe('calendar');
        expect(options.method).toBe('GET');
        paths.push(path);
        return pages[paths.length - 1] ?? {};
      },
    },
    paths,
  };
}

describe('readCalendarEvents', () => {
  it('normalizes timed, all-day, multi-day, tentative and needs-action events and omits cancelled, declined and free events', async () => {
    const { google } = fakeGoogle([{
      items: [
        calendarEvent({ id: 'timed', summary: 'Timed', start: { dateTime: '2026-10-20T12:00:00+02:00' }, end: { dateTime: '2026-10-20T13:00:00+02:00' }, status: 'tentative' }),
        calendarEvent({ id: 'all-day', summary: 'All day', start: { date: '2026-10-25' }, end: { date: '2026-10-27' } }),
        calendarEvent({ id: 'needs-action', attendees: [{ responseStatus: 'needsAction' }] }),
        calendarEvent({ id: 'cancelled', status: 'cancelled' }),
        calendarEvent({ id: 'declined', attendees: [{ self: true, responseStatus: 'declined' }] }),
        calendarEvent({ id: 'free', transparency: 'transparent' }),
      ],
    }]);
    const events = await readCalendarEvents(google, {
      from: new Date('2026-10-20T00:00:00Z'),
      to: new Date('2026-10-28T00:00:00Z'),
      signal: new AbortController().signal,
    });
    expect(events.map(({ title }) => title)).toEqual(['Timed', 'Synthetic event', 'All day']);
    const timed = events.find(({ title }) => title === 'Timed')!;
    expect(timed.startsAt.toISOString()).toBe('2026-10-20T10:00:00.000Z');
    expect(timed.allDay).toBe(false);
    const allDay = events.find(({ title }) => title === 'All day')!;
    expect(allDay.startsAt.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(allDay.endsAt.toISOString()).toBe('2026-10-26T23:00:00.000Z');
    expect(allDay.allDay).toBe(true);
  });

  it('uses Copenhagen local midnight for all-day dates on the spring DST change', async () => {
    const { google } = fakeGoogle([{
      items: [calendarEvent({
        summary: 'Spring all-day',
        start: { date: '2027-03-28' },
        end: { date: '2027-03-29' },
      })],
    }]);
    const [event] = await readCalendarEvents(google, {
      from: new Date('2027-03-27T00:00:00Z'),
      to: new Date('2027-03-30T00:00:00Z'),
      signal: new AbortController().signal,
    });
    expect(event?.startsAt.toISOString()).toBe('2027-03-27T23:00:00.000Z');
    expect(event?.endsAt.toISOString()).toBe('2027-03-28T22:00:00.000Z');
  });

  it('preserves timed event instants across both Copenhagen clock changes', async () => {
    const { google } = fakeGoogle([{
      items: [
        calendarEvent({
          summary: 'Autumn clock change',
          start: { dateTime: '2026-10-25T01:30:00+02:00' },
          end: { dateTime: '2026-10-25T03:30:00+01:00' },
        }),
        calendarEvent({
          summary: 'Spring clock change',
          start: { dateTime: '2027-03-28T01:30:00+01:00' },
          end: { dateTime: '2027-03-28T03:30:00+02:00' },
        }),
      ],
    }]);
    const events = await readCalendarEvents(google, {
      from: new Date('2026-10-24T00:00:00Z'),
      to: new Date('2027-03-29T00:00:00Z'),
      signal: new AbortController().signal,
    });
    expect(events.map(({ startsAt, endsAt }) => [startsAt.toISOString(), endsAt.toISOString()])).toEqual([
      ['2026-10-24T23:30:00.000Z', '2026-10-25T02:30:00.000Z'],
      ['2027-03-28T00:30:00.000Z', '2027-03-28T01:30:00.000Z'],
    ]);
  });

  it('bounds calendar requests to 50 events across two 25-event pages', async () => {
    const makeEvents = (offset: number) => Array.from({ length: 25 }, (_, index) => {
      const start = new Date(Date.parse('2026-10-20T01:00:00Z') + (offset + index) * 30 * 60_000);
      const end = new Date(start.getTime() + 20 * 60_000);
      return calendarEvent({
        id: `event-${offset + index}`,
        summary: `Event ${offset + index}`,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      });
    });
    const { google, paths } = fakeGoogle([
      { items: makeEvents(0), nextPageToken: 'opaque-page-token' },
      { items: makeEvents(25), nextPageToken: 'third-page-must-not-be-read' },
      { items: [calendarEvent({ summary: 'Third page' })] },
    ]);
    const events = await readCalendarEvents(google, {
      from: new Date('2026-10-20T00:00:00Z'),
      to: new Date('2026-10-22T00:00:00Z'),
      signal: new AbortController().signal,
    });
    expect(events).toHaveLength(50);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('/calendars/primary/events?');
    expect(paths[0]).toContain('maxResults=25');
    expect(paths[0]).toContain('singleEvents=true');
    expect(paths[0]).toContain('timeMin=2026-10-20T00%3A00%3A00.000Z');
    expect(paths[1]).toContain('pageToken=opaque-page-token');
  });

  it('sorts by start time and includes other-attendee count without storing addresses', async () => {
    const { google } = fakeGoogle([{
      items: [
        calendarEvent({
          summary: '<b>Later</b> <script>ignore()</script> [open](https://example.invalid)',
          location: 'Room <img src=x> ' + 'x'.repeat(90),
          start: { dateTime: '2026-10-20T12:00:00Z' },
          end: { dateTime: '2026-10-20T13:00:00Z' },
          attendees: [
            { email: 'attendee@example.invalid', self: true, responseStatus: 'accepted' },
            { email: 'other@example.invalid', responseStatus: 'accepted' },
          ],
          description: 'Never include this',
          conferenceData: { entryPoints: [{ uri: 'https://meet.example.invalid' }] },
          organizer: { email: 'organizer@example.invalid' },
        }),
        calendarEvent({
          summary: 'Earlier',
          start: { dateTime: '2026-10-20T11:00:00Z' },
          end: { dateTime: '2026-10-20T11:30:00Z' },
        }),
      ],
    }]);
    const events = await readCalendarEvents(google, {
      from: new Date('2026-10-20T00:00:00Z'),
      to: new Date('2026-10-21T00:00:00Z'),
      signal: new AbortController().signal,
    });
    expect(events.map(({ title }) => title)).toEqual([
      'Earlier',
      '<b>Later</b> <script>ignore()</script> [open](https://example.invalid)',
    ]);
    expect(events[1]?.attendeeCount).toBe(1);
  });
});
