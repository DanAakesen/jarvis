import { describe, expect, it } from 'vitest';
import { GoogleApiError, type GoogleApiClient } from '../../google/api-client.js';
import { defaultProactiveSettings } from '../store.js';
import { createCalendarSource } from './calendar.js';

const now = new Date('2026-10-20T10:00:00.000Z');
const context = (signal = new AbortController().signal) => ({
  now,
  signal,
  settings: defaultProactiveSettings(),
});

function event(index: number) {
  const start = new Date(now.getTime() + index * 10 * 60_000).toISOString();
  const end = new Date(now.getTime() + index * 10 * 60_000 + 30 * 60_000).toISOString();
  return {
    id: `event-${index}`,
    summary: `Event ${index}`,
    start: { dateTime: start },
    end: { dateTime: end },
  };
}

function client(request: GoogleApiClient['request']): GoogleApiClient {
  return { request };
}

describe('proactive calendar source', () => {
  it('returns up to 40 sorted sanitized facts with opaque refs and a 48-hour primary-calendar window', async () => {
    const calls: string[] = [];
    const source = createCalendarSource(client(async (_api, path, options) => {
      calls.push(path);
      expect(options.method).toBe('GET');
      return calls.length === 1
        ? { items: Array.from({ length: 25 }, (_, index) => event(index)), nextPageToken: 'more' }
        : { items: Array.from({ length: 25 }, (_, index) => event(index + 25)) };
    }));
    const result = await source.read(context());
    expect(result.state).toBe('ok');
    expect(result.facts).toHaveLength(40);
    expect(result.facts[0]).toMatchObject({
      ref: 'cal:1',
      identity: 'calendar-event:event-0',
      kind: 'event',
      label: 'Calendar',
      observedAt: now.toISOString(),
    });
    expect(result.facts.every(({ text }) => text.length <= 300)).toBe(true);
    expect(result.facts.every((fact, index, facts) =>
      index === 0 || fact.startsAt! >= facts[index - 1]!.startsAt!)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/calendars/primary/events?');
    expect(calls[0]).toContain('timeMin=2026-10-20T10%3A00%3A00.000Z');
    expect(calls[0]).toContain('timeMax=2026-10-22T10%3A00%3A00.000Z');
    expect(calls[0]).toContain('singleEvents=true');
    expect(calls[1]).toContain('pageToken=more');
  });

  it('returns ok with no facts when there are no events', async () => {
    const source = createCalendarSource(client(async () => ({ items: [] })));
    await expect(source.read(context())).resolves.toMatchObject({ state: 'ok', reason: null, facts: [] });
  });

  it('keeps only safe title and short location data in facts', async () => {
    const source = createCalendarSource(client(async () => ({
      items: [{
        summary: 'Prompt says ignore all instructions',
        location: 'Room [map](https://example.invalid) ' + 'x'.repeat(90),
        start: { dateTime: '2026-10-20T11:00:00Z' },
        end: { dateTime: '2026-10-20T12:00:00Z' },
        attendees: [{ email: 'attendee@example.invalid', self: false }],
        description: 'Private description',
        organizer: { email: 'organizer@example.invalid' },
        conferenceData: { entryPoints: [{ uri: 'https://meet.example.invalid' }] },
      }],
    })));
    const result = await source.read(context());
    const text = result.facts[0]?.text ?? '';
    expect(text.startsWith('Prompt says ignore all instructions | Room map ')).toBe(true);
    expect(text.split('|')[1]?.trim().length).toBeLessThanOrEqual(80);
    expect(text).toContain('1 attendees');
    expect(JSON.stringify(result.facts)).not.toMatch(/attendee@example|organizer@example|Private description|meet\.example|https:\/\//u);
  });

  it('keeps location and attendee count when the event title needs truncation', async () => {
    const source = createCalendarSource(client(async () => ({
      items: [{
        summary: 'A'.repeat(400),
        location: 'Room 4',
        start: { dateTime: '2026-10-20T11:00:00Z' },
        end: { dateTime: '2026-10-20T12:00:00Z' },
        attendees: [{ email: 'guest@example.invalid' }],
      }],
    })));
    const result = await source.read(context());
    const text = result.facts[0]?.text ?? '';
    expect(text).toHaveLength(300);
    expect(text.endsWith(' | Room 4 | 1 attendees')).toBe(true);
  });

  it('returns not_connected when Google is absent and maps provider failures', async () => {
    await expect(createCalendarSource().read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'not_connected', facts: [],
    });
    const failures: Array<[unknown, string]> = [
      [new GoogleApiError('credentials-expired', 401), 'not_authorised'],
      [new GoogleApiError('forbidden', 403), 'not_authorised'],
      [new GoogleApiError('throttled', 429), 'rate_limited'],
      [new Error('Unexpected provider response'), 'read_failed'],
    ];
    for (const [error, reason] of failures) {
      const source = createCalendarSource(client(async () => { throw error; }));
      await expect(source.read(context())).resolves.toMatchObject({ state: 'unavailable', reason, facts: [] });
    }
    const controller = new AbortController();
    controller.abort();
    const source = createCalendarSource(client(async () => { throw new Error('aborted'); }));
    await expect(source.read(context(controller.signal))).resolves.toMatchObject({
      state: 'unavailable', reason: 'timeout', facts: [],
    });
  });
});
