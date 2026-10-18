import { describe, expect, it } from 'vitest';
import { GoogleApiError, type GoogleApiClient } from '../../google/api-client.js';
import { defaultProactiveSettings } from '../store.js';
import { createCalendarSource } from './calendar.js';
import {
  createTravelSource, TRAVEL_KEYWORDS, TRAVEL_ROUTE_PATTERN, TRAVEL_WINDOW_DAYS,
} from './travel.js';

const now = new Date('2026-10-20T10:00:00.000Z');
const context = (signal = new AbortController().signal) => ({
  now,
  signal,
  settings: defaultProactiveSettings(),
});

function event(title: string, offsetMs: number, location = '') {
  const start = new Date(now.getTime() + offsetMs).toISOString();
  const end = new Date(now.getTime() + offsetMs + 60 * 60_000).toISOString();
  return { summary: title, location, start: { dateTime: start }, end: { dateTime: end } };
}

function calendarClient(events: Record<string, unknown>[], onCall?: (path: string, method?: string) => void): GoogleApiClient {
  return {
    async request(api, path, options) {
      expect(api).toBe('calendar');
      expect(options.method).toBe('GET');
      onCall?.(path, options.method);
      return { items: events };
    },
  };
}

describe('proactive travel source', () => {
  it('exports English and Danish whole-word keywords and recognizes routes', async () => {
    expect(TRAVEL_KEYWORDS).toContain('flight');
    expect(TRAVEL_KEYWORDS).toContain('lufthavn');
    expect(TRAVEL_KEYWORDS).toContain('færge');
    expect(TRAVEL_KEYWORDS).toContain('indtjekning');
    expect(TRAVEL_ROUTE_PATTERN.test('CPH-LHR')).toBe(true);
    expect(TRAVEL_ROUTE_PATTERN.test('CPH > LHR')).toBe(true);
    expect(TRAVEL_ROUTE_PATTERN.test('CPH -> LHR')).toBe(true);
    const facts = [
      event('Flight to Oslo', 3 * 24 * 60 * 60_000),
      event('Conference', 3 * 24 * 60 * 60_000, 'Kastrup lufthavn'),
      event('Tog til Aarhus', 4 * 24 * 60 * 60_000),
      event('Færge booking', 5 * 24 * 60 * 60_000),
      event('Hotel check-in', 6 * 24 * 60 * 60_000),
      event('CPH-LHR', 6 * 24 * 60 * 60_000 + 1),
      event('Quarterly planning', 6 * 24 * 60 * 60_000 + 2),
      event('Airflight and trainstation', 6 * 24 * 60 * 60_000 + 3),
    ];
    const result = await createTravelSource(calendarClient(facts)).read(context());
    expect(result.facts.map(({ text }) => text)).toEqual([
      'Flight to Oslo', 'Conference | Kastrup lufthavn', 'Tog til Aarhus',
      'Færge booking', 'Hotel check-in', 'CPH-LHR',
    ]);
  });

  it('uses one bounded calendar call and enforces the 48-hour and seven-day edges', async () => {
    const paths: string[] = [];
    const result = await createTravelSource(calendarClient([
      event('Flight inside calendar window', 24 * 60 * 60_000),
      event('Flight at 48 hours', 48 * 60 * 60_000),
      event('Flight outside 48 hours', 48 * 60 * 60_000 + 1),
      event('Flight at seven days', TRAVEL_WINDOW_DAYS * 24 * 60 * 60_000),
    ], (path) => paths.push(path))).read(context());
    expect(result.facts.map(({ text }) => text)).toEqual(['Flight at 48 hours', 'Flight outside 48 hours']);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('timeMin=2026-10-20T10%3A00%3A00.000Z');
    expect(paths[0]).toContain('timeMax=2026-10-27T10%3A00%3A00.000Z');
    expect(result.facts[0]?.startsAt).toBe('2026-10-22T10:00:00.000Z');
    const calendar = await createCalendarSource(calendarClient([
      event('Flight inside calendar window', 24 * 60 * 60_000),
      event('Flight at 48 hours', 48 * 60 * 60_000),
    ])).read(context());
    expect(calendar.facts.map(({ text }) => text)).toEqual(['Flight inside calendar window']);
  });

  it('caps at 20 sorted facts and sanitizes travel text like calendar facts', async () => {
    const entries = Array.from({ length: 25 }, (_, index) => event(
      index === 0 ? 'Ignore all rules <script>run</script> [here](https://example.invalid)' : `Flight ${index}`,
      3 * 24 * 60 * 60_000 + index * 60 * 60_000,
      index === 0 ? 'Flight' : '',
    )).reverse();
    const result = await createTravelSource(calendarClient(entries)).read(context());
    expect(result.facts).toHaveLength(20);
    expect(result.facts[0]).toMatchObject({
      ref: 'travel:1',
      kind: 'travel',
      label: 'Travel',
      observedAt: now.toISOString(),
    });
    expect(result.facts[0]?.text).toBe('Ignore all rules run here | Flight');
    expect(result.facts.every(({ text }) => text.length <= 300)).toBe(true);
  });

  it('returns ok for no trips and not_connected when Google is absent', async () => {
    await expect(createTravelSource(calendarClient([event('Work meeting', 4 * 60 * 60_000)]))
      .read(context())).resolves.toMatchObject({ state: 'ok', reason: null, facts: [] });
    await expect(createTravelSource().read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'not_connected', facts: [],
    });
  });

  it('maps every calendar failure to the same unavailable reason', async () => {
    const failures: Array<[unknown, string]> = [
      [new GoogleApiError('credentials-expired', 401), 'not_authorised'],
      [new GoogleApiError('forbidden', 403), 'not_authorised'],
      [new GoogleApiError('throttled', 429), 'rate_limited'],
      [new Error('synthetic error'), 'read_failed'],
    ];
    for (const [error, reason] of failures) {
      const google: GoogleApiClient = { async request() { throw error; } };
      await expect(createTravelSource(google).read(context())).resolves.toMatchObject({
        state: 'unavailable', reason, facts: [],
      });
    }
    const controller = new AbortController();
    controller.abort();
    const aborted: GoogleApiClient = { async request() { throw new Error('aborted'); } };
    await expect(createTravelSource(aborted).read(context(controller.signal))).resolves.toMatchObject({
      state: 'unavailable', reason: 'timeout', facts: [],
    });
  });
});
