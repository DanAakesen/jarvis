import { describe, expect, it, vi } from 'vitest';
import { defaultProactiveSettings } from '../store.js';
import type { ProactiveSource, SourceContext, SourceResult } from '../types.js';
import { calendarFact } from './shared.js';
import { dailyWeatherSource, type DailyWeatherStore, supportsWeatherMessage, weatherDestination } from './daily-weather.js';
import { readTripForecast } from './weather.js';

const now = new Date('2026-11-26T22:00:00Z');
const event = { title: 'Drive to Aarhus', location: 'Aarhus', startsAt: new Date('2026-11-27T09:00Z'),
  endsAt: new Date('2026-11-27T11:00Z'), allDay: false, attendeeCount: 0, id: 'drive' };
const trip = calendarFact(event, 'Calendar', now.toISOString());
const context: SourceContext = { now, signal: AbortSignal.timeout(10_000), settings: defaultProactiveSettings() };
const observed: SourceResult = { source: 'weather', state: 'ok', reason: null, observedAt: now.toISOString(),
  facts: [{ ref: 'trip-weather:1', kind: 'weather', label: 'Weather', text: 'Snow', observedAt: now.toISOString() }] };

function fixture() {
  const rows = new Map<string, { eventRef: string; result: SourceResult | null }>();
  const store: DailyWeatherStore = {
    async read(day) { return rows.get(day) ?? null; },
    async claim(day, eventRef) {
      if (rows.has(day)) return false;
      rows.set(day, { eventRef, result: null }); return true;
    },
    async save(day, result) { rows.get(day)!.result = result; },
  };
  const calendar: ProactiveSource = { id: 'calendar', label: 'Calendar', async read() {
    return { ...observed, source: 'calendar', facts: [trip] };
  } };
  const forecast = vi.fn(async () => structuredClone(observed));
  const source = () => dailyWeatherSource(store, forecast, calendar);
  return { source, rows, forecast };
}

describe('calendar-dependent background weather', () => {
  it('skips ordinary, online, all-day and short events', () => {
    expect(weatherDestination(event)).toBe('Aarhus');
    for (const change of [{ title: 'Design review' }, { location: '' }, { allDay: true },
      { location: 'https://teams.example/meet' }, { endsAt: new Date('2026-11-27T09:20Z') }]) {
      expect(weatherDestination({ ...event, ...change })).toBeUndefined();
    }
  });

  it('does no provider work without eligible calendar evidence or with either source disabled', async () => {
    const { source, forecast } = fixture();
    for (const calendarFacts of [undefined, [], [{ ...trip, startsAt: now.toISOString() }]]) {
      await source().read({ ...context, ...(calendarFacts ? { calendarFacts } : {}) });
    }
    for (const id of ['weather', 'calendar'] as const) {
      const settings = defaultProactiveSettings(); settings.sources[id] = false;
      await source().read({ ...context, settings, calendarFacts: [trip] });
    }
    expect(forecast).not.toHaveBeenCalled();
  });

  it('shares one claim across simultaneous polls, restarts and lookups, and resets at Copenhagen midnight', async () => {
    const { source, forecast } = fixture();
    const poll = { ...context, calendarFacts: [trip] };
    await Promise.all(Array.from({ length: 11 }, () => source().read(poll)));
    expect(forecast).toHaveBeenCalledTimes(1);
    expect((await source().read(context)).facts[0]?.text).toContain('Snow');
    expect((await source().read({ ...poll, calendarFacts: [] })).facts).toEqual([]);
    expect((await source().read({ ...poll, calendarFacts: [{ ...trip, weatherDestination: 'Paris' }] })).facts).toEqual([]);
    await source().read({ ...poll, now: new Date('2026-11-26T23:01Z') });
    expect(forecast).toHaveBeenCalledTimes(2);
  });

  it('permits weather outreach only with adverse conditions and the matching trip and forecast evidence', () => {
    const fact = { ...observed.facts[0]!, highPriority: true, weatherEventRef: trip.ref };
    const weather = { source: 'weather', identity: fact.ref, ref: null };
    const calendar = { source: 'calendar', identity: `calendar:${trip.ref}`, ref: null };
    expect(supportsWeatherMessage([fact], [weather, calendar])).toBe(true);
    expect(supportsWeatherMessage([fact], [weather])).toBe(false);
    expect(supportsWeatherMessage([fact], [weather, { ...calendar, identity: 'unrelated' }])).toBe(false);
    expect(supportsWeatherMessage([{ ...fact, highPriority: false }], [weather, calendar])).toBe(false);
  });

  it('counts a failed attempt for the day', async () => {
    const { source, forecast } = fixture();
    forecast.mockResolvedValue({ ...observed, state: 'unavailable', reason: 'timeout', facts: [] });
    for (let n = 0; n < 3; n++) expect((await source().read({ ...context, calendarFacts: [trip] })).state).toBe('unavailable');
    expect(forecast).toHaveBeenCalledTimes(1);
  });

  it('stores the conditions for the destination on the trip day', async () => {
    const fetcher = vi.fn(async () => Response.json({ timezone: 'Europe/Copenhagen', daily: {
      time: ['2026-11-26', '2026-11-27'], weather_code: [3, 75], temperature_2m_max: [7, 1],
      temperature_2m_min: [2, -1], precipitation_probability_max: [10, 90],
      precipitation_sum: [1, 12], wind_speed_10m_max: [12, 40],
    } }));
    const result = await readTripForecast('56.1,10.2', event.startsAt.toISOString(), context, fetcher);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({ highPriority: true });
    expect(result.facts[0]?.text).toContain('2026-11-27');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
