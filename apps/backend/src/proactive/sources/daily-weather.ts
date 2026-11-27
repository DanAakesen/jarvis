import { dayKey } from '../time.js';
import type { ProactiveSource, SourceContext, SourceFact, SourceResult } from '../types.js';
import type { CalendarEvent } from './calendar-reader.js';

export interface DailyWeatherStore {
  claim(day: string, eventRef: string): Promise<boolean>;
  save(day: string, result: SourceResult): Promise<void>;
  read(day: string): Promise<{ eventRef: string; result: SourceResult | null } | null>;
}

// Use the activity, never a meeting's duration alone, to infer exposure to weather.
export function weatherDestination(event: CalendarEvent): string | undefined {
  const location = event.location.trim();
  if (!location || event.allDay || /https?:\/\/|\b(?:teams|zoom|online|virtual)\b/iu.test(location)) return;
  if (/\b(?:google|one|shared|hard|test) drive\b/iu.test(event.title)) return;
  const drive = /\b(?:drive|driving|road trip|kørsel|køre|kør|køretur|biltur|bilferie)\b/iu.test(event.title);
  const longDrive = /\b(?:long drive|road trip|lang køretur|bilferie)\b/iu.test(event.title) ||
    event.endsAt.getTime() - event.startsAt.getTime() >= 60 * 60_000;
  const outdoor = /\b(?:hike|hiking|vandretur|vandring|cykeltur|bike ride|outdoor race)\b/iu.test(event.title);
  return (outdoor || (drive && longDrive)) ? location : undefined;
}

export function supportsWeatherMessage(
  facts: readonly SourceFact[], evidence: readonly { source: string; ref: string | null; identity: string | null }[],
): boolean {
  return facts.some(fact => fact.highPriority && fact.weatherEventRef &&
    evidence.some(e => e.source === 'weather' && (e.identity === fact.ref || e.ref === fact.ref)) &&
    evidence.some(e => e.source === 'calendar' && (e.ref === fact.weatherEventRef ||
      e.identity === fact.weatherEventRef || e.identity === `calendar:${fact.weatherEventRef}`)));
}

type Forecast = (destination: string, startsAt: string, context: SourceContext) => Promise<SourceResult>;

export function dailyWeatherSource(store: DailyWeatherStore | undefined, forecast: Forecast, calendar: ProactiveSource): ProactiveSource {
  return {
    id: 'weather', label: 'Weather',
    async read(context) {
      const { now, settings, calendarFacts } = context;
      const empty: SourceResult = { source: 'weather', state: 'ok', facts: [], reason: null, observedAt: now.toISOString() };
      if (!store || !settings.sources.weather || !settings.sources.calendar || settings.paused) return empty;
      const day = dayKey(now);
      const upcoming = (fact: SourceFact) => !!fact.weatherDestination && !!fact.startsAt &&
        Date.parse(fact.startsAt) > now.getTime() && Date.parse(fact.startsAt) - now.getTime() <= 24 * 60 * 60_000;
      const reserved: SourceResult = { ...empty, state: 'unavailable', reason: 'daily_forecast_reserved' };
      const cached = await store.read(day);
      if (cached) {
        const current = calendarFacts ?? (await calendar.read(context)).facts;
        const trip = current.find(fact => fact.ref === cached.eventRef && upcoming(fact));
        if (!trip) return empty;
        if (cached.result?.facts.some(fact => fact.weatherDestination !== trip.weatherDestination ||
            fact.startsAt !== trip.startsAt)) return empty;
        return cached.result ?? reserved;
      }
      // Only the calendar poll supplies events. All other readers can only reuse the result.
      const trip = calendarFacts?.filter(upcoming).sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))[0];
      if (!trip?.weatherDestination) return empty;
      if (!await store.claim(day, trip.ref)) return reserved;
      const result = await forecast(trip.weatherDestination, trip.startsAt!, context);
      result.facts = result.facts.map(fact => ({
        ...fact, weatherEventRef: trip.ref, weatherDestination: trip.weatherDestination!, startsAt: trip.startsAt!,
        text: `${fact.text}. Calendar: ${trip.text} at ${trip.startsAt}.`,
      }));
      await store.save(day, result);
      return result;
    },
  };
}
