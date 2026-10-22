/** Owner-session lifetimes and limits (#1217). Every number lives here so a change is one reviewed edit. */
export interface OwnerSessionPolicy {
  /** A session stays valid this long after its last use. */
  readonly idleLifetimeMs: number;
  /** A session never outlives this, however often it is used. */
  readonly absoluteLifetimeMs: number;
  /** The idle expiry is extended at most once per this interval, so verification does not write on every request. */
  readonly refreshAfterMs: number;
  /** Creating one more active session revokes the least recently used one. */
  readonly maxActiveSessions: number;
  /** Revoked and expired rows are kept this long for diagnosis, then purged by the next create. */
  readonly retentionAfterDeathMs: number;
  /** Sliding-window limits for creating sessions. */
  readonly createLimits: readonly { readonly windowMs: number; readonly max: number }[];
  /** UTF-16 code units; must not exceed the width of dbo.owner_sessions.device_label. */
  readonly deviceLabelMaxLength: number;
  /** Advice for clients when the session store is unavailable. */
  readonly unavailableRetryAfterSeconds: number;
}

const DAY_MS = 24 * 60 * 60_000;

export const ownerSessionPolicy: OwnerSessionPolicy = Object.freeze({
  idleLifetimeMs: 10 * DAY_MS,
  absoluteLifetimeMs: 30 * DAY_MS,
  refreshAfterMs: 60 * 60_000,
  maxActiveSessions: 10,
  retentionAfterDeathMs: 30 * DAY_MS,
  createLimits: Object.freeze([
    Object.freeze({ windowMs: 60_000, max: 5 }),
    Object.freeze({ windowMs: 60 * 60_000, max: 30 }),
  ]),
  deviceLabelMaxLength: 40,
  unavailableRetryAfterSeconds: 5,
});
