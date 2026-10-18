import type { GoogleApiClient } from '../../google/api-client.js';
import type { ProactiveSource, SourceContext, SourceResult } from '../types.js';
import { readCalendarEvents } from './calendar-reader.js';
import { calendarFact, observedAtOrEpoch, sourceFailureReason, sourceSignal } from './shared.js';

export const CALENDAR_WINDOW_HOURS = 48;
export const CALENDAR_MAX_FACTS = 40;

export function createCalendarSource(google?: GoogleApiClient): ProactiveSource {
  return {
    id: 'calendar',
    label: 'Calendar',
    async read(context: SourceContext): Promise<SourceResult> {
      const observedAt = observedAtOrEpoch(context.now);
      if (!google) return { source: 'calendar', state: 'unavailable', reason: 'not_connected', facts: [], observedAt };
      const signal = sourceSignal(context.signal);
      try {
        const events = await readCalendarEvents(google, {
          from: context.now,
          to: new Date(context.now.getTime() + CALENDAR_WINDOW_HOURS * 60 * 60_000),
          signal,
        });
        return {
          source: 'calendar',
          state: 'ok',
          reason: null,
          facts: events.slice(0, CALENDAR_MAX_FACTS)
            .map((event, index) => calendarFact(event, `cal:${index + 1}`, 'Calendar', observedAt)),
          observedAt,
        };
      } catch (error) {
        return {
          source: 'calendar',
          state: 'unavailable',
          reason: sourceFailureReason(error, signal),
          facts: [],
          observedAt,
        };
      }
    },
  };
}
