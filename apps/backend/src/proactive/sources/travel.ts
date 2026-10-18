import type { GoogleApiClient } from '../../google/api-client.js';
import type { ProactiveSource, SourceContext, SourceResult } from '../types.js';
import { readCalendarEvents } from './calendar-reader.js';
import { CALENDAR_WINDOW_HOURS } from './calendar.js';
import { calendarFact, observedAtOrEpoch, sourceFailureReason, sourceSignal } from './shared.js';

export const TRAVEL_WINDOW_DAYS = 7;
export const TRAVEL_MAX_FACTS = 20;
export const TRAVEL_KEYWORDS = [
  'flight', 'airport', 'boarding', 'departure', 'arrival', 'train', 'ferry',
  'hotel', 'check-in', 'check-out', 'trip', 'journey', 'fly', 'lufthavn',
  'tog', 'faerge', 'færge', 'rejse', 'afrejse', 'ankomst', 'indtjekning',
] as const;
export const TRAVEL_ROUTE_PATTERN = /\b[A-Z]{3}\s*(?:->|-|>|→)\s*[A-Z]{3}\b/u;

const keywordPatterns = TRAVEL_KEYWORDS.map((keyword) =>
  new RegExp(`(?<![\\p{L}\\p{N}_])${keyword.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu'));

function isTrip(title: string, location: string): boolean {
  const text = `${title} ${location}`;
  return TRAVEL_ROUTE_PATTERN.test(text) || keywordPatterns.some((pattern) => pattern.test(text));
}

export function createTravelSource(google?: GoogleApiClient): ProactiveSource {
  return {
    id: 'travel',
    label: 'Travel',
    async read(context: SourceContext): Promise<SourceResult> {
      const observedAt = observedAtOrEpoch(context.now);
      if (!google) return { source: 'travel', state: 'unavailable', reason: 'not_connected', facts: [], observedAt };
      const signal = sourceSignal(context.signal);
      try {
        const events = await readCalendarEvents(google, {
          from: context.now,
          to: new Date(context.now.getTime() + TRAVEL_WINDOW_DAYS * 24 * 60 * 60_000),
          signal,
        });
        const travelStart = context.now.getTime() + CALENDAR_WINDOW_HOURS * 60 * 60_000;
        const selected = events.filter((event) =>
          event.startsAt.getTime() >= travelStart && isTrip(event.title, event.location));
        return {
          source: 'travel',
          state: 'ok',
          reason: null,
          facts: selected.slice(0, TRAVEL_MAX_FACTS)
            .map((event, index) => calendarFact(event, `travel:${index + 1}`, 'Travel', observedAt)),
          observedAt,
        };
      } catch (error) {
        return {
          source: 'travel',
          state: 'unavailable',
          reason: sourceFailureReason(error, signal),
          facts: [],
          observedAt,
        };
      }
    },
  };
}
