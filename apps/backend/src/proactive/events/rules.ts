import { isGitHubActivity, type QueuedEvent } from './types.js';

export interface RuleInput {
  now: Date;
  /** False when the owner switched the matching proactive source off. */
  sourceEnabled: boolean;
  /** Events from this source already sent to the model in the last hour. */
  escalatedLastHour: number;
}

export interface RuleVerdict {
  keep: boolean;
  reason: string;
}

export const MAX_EVENT_ATTEMPTS = 4;
const HOUR_MS = 60 * 60_000;
const DEFAULT_MAX_AGE_MS = 24 * HOUR_MS;
const maxAgeMs: Record<string, number> = { timer: HOUR_MS };
const hourlyCap: Record<string, number> = { mail: 12 };
const DEFAULT_HOURLY_CAP = 10;
const CALENDAR_HORIZON_MS = 14 * 24 * HOUR_MS;

function instant(value: unknown): number | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined;
}

/** Cheap filter with no model call: exact checks only; judgement stays with the model. */
export function applyRules(event: QueuedEvent, input: RuleInput): RuleVerdict {
  if (isGitHubActivity(event)) return { keep: false, reason: 'github_context_only' };
  const now = input.now.getTime();
  if (event.attempts > MAX_EVENT_ATTEMPTS) return { keep: false, reason: 'gave_up_after_retries' };
  if (!input.sourceEnabled) return { keep: false, reason: 'source_disabled' };
  if (now - event.occurredAt.getTime() > (maxAgeMs[event.source] ?? DEFAULT_MAX_AGE_MS)) {
    return { keep: false, reason: 'stale' };
  }
  if (event.source === 'calendar') {
    const ends = instant(event.detail.endsAt);
    const starts = instant(event.detail.startsAt);
    if (ends !== undefined && ends < now) return { keep: false, reason: 'calendar_event_over' };
    if (starts !== undefined && starts - now > CALENDAR_HORIZON_MS) return { keep: false, reason: 'calendar_too_far_ahead' };
  }
  if (input.escalatedLastHour >= (hourlyCap[event.source] ?? DEFAULT_HOURLY_CAP)) {
    return { keep: false, reason: 'source_rate_limited' };
  }
  return { keep: true, reason: 'passed_rules' };
}
