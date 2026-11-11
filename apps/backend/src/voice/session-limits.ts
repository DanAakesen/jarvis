export const VOICE_IDLE_TIMEOUT_MS = 10 * 60_000;
export const VOICE_MAX_DURATION_MS = 30 * 60_000;
export const SESSION_LIMIT_CHECK_MS = 15_000;

export type SessionEndReason = 'inactivity' | 'max_duration';

export interface SessionLimits {
  /** Records user activity: speech, a typed or touch message, or a tool call the user triggered. */
  touch(): void;
  /** Returns the reason to end the session now, or undefined. `busy` defers only the idle rule. */
  due(busy?: boolean): SessionEndReason | undefined;
}

/**
 * Assistant output and camera frames never call touch(), so a narrating camera session still
 * ends after the idle window; the absolute cap bounds any session regardless of activity.
 */
export function createSessionLimits(
  now: () => number = () => performance.now(),
  idleMs = VOICE_IDLE_TIMEOUT_MS,
  maxMs = VOICE_MAX_DURATION_MS,
): SessionLimits {
  const startedAt = now();
  let lastActivityAt = startedAt;
  return {
    touch() { lastActivityAt = now(); },
    due(busy = false) {
      const current = now();
      if (current - startedAt >= maxMs) return 'max_duration';
      if (!busy && current - lastActivityAt >= idleMs) return 'inactivity';
      return undefined;
    },
  };
}
