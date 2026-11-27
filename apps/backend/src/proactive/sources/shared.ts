import { createHash } from 'node:crypto';
import { GoogleApiError } from '../../google/api-client.js';
import type { SourceFact } from '../types.js';
import { weatherDestination } from './daily-weather.js';
import type { CalendarEvent } from './calendar-reader.js';

export const PROACTIVE_SOURCE_TIMEOUT_MS = 20_000;

export function sourceSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(PROACTIVE_SOURCE_TIMEOUT_MS)]);
}

export function sourceFailureReason(error: unknown, signal: AbortSignal): string {
  if (signal.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) {
    return 'timeout';
  }
  if (error instanceof GoogleApiError) {
    if (error.statusCode === 401 || error.statusCode === 403 ||
        error.kind === 'credentials-expired' || error.kind === 'forbidden') return 'not_authorised';
    if (error.statusCode === 429 || error.kind === 'throttled') return 'rate_limited';
  }
  return 'read_failed';
}

export function cleanSourceText(value: string, maxLength = 300): string {
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/gu, '$1')
    .replace(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

export function eventFactText(event: CalendarEvent): string {
  const safeLocation = event.location ? cleanSourceText(event.location, 80) : '';
  const suffix = [
    ...(safeLocation ? [safeLocation] : []),
    ...(event.attendeeCount > 0 ? [`${event.attendeeCount} attendees`] : []),
  ];
  const ending = suffix.length ? ` | ${suffix.join(' | ')}` : '';
  const title = cleanSourceText(event.title).slice(0, Math.max(0, 300 - ending.length));
  return cleanSourceText(`${title}${ending}`);
}

export function calendarFact(
  event: CalendarEvent,
  label: 'Calendar' | 'Travel',
  observedAt: string,
): SourceFact {
  const provider = label.toLowerCase();
  const destination = label === 'Calendar' ? weatherDestination(event) : undefined;
  const identity = event.id
    ? `${provider}-event:${event.id}`
    : `${provider}-event:${createHash('sha256').update(JSON.stringify([
      event.title, event.location, event.startsAt.toISOString(), event.endsAt.toISOString(), event.allDay,
    ])).digest('hex').slice(0, 32)}`;
  return {
    ...(destination ? { weatherDestination: destination } : {}),
    ref: identity,
    identity,
    kind: label === 'Calendar' ? 'event' : 'travel',
    label,
    text: eventFactText(event),
    observedAt,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    allDay: event.allDay,
  };
}

export function observedAtOrEpoch(now: Date): string {
  return Number.isFinite(now.getTime()) ? now.toISOString() : new Date(0).toISOString();
}
