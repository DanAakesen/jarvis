import type { NotificationKind } from './owner-interactions.js';

/** At most this many owner notifications per kind enter the Now feed in any rolling 24 hours. */
export const notificationDailyCapPerKind = 10;
/** Owner notifications older than this leave the Now feed automatically. */
export const notificationExpiryDays = 7;
export const notificationWindowMs = 24 * 60 * 60_000;

export interface RecentNotification {
  readonly kind: NotificationKind;
  readonly title: string;
  readonly at: Date;
}

export type NotificationAdmission = 'admit' | 'duplicate' | 'daily_cap';

/**
 * Decides whether a new owner notification may be stored. `recent` holds every stored notification row
 * (dismissed or not) from the last rolling day, so a message the owner already dismissed does not come back.
 */
export function admitNotification(
  recent: readonly RecentNotification[],
  candidate: { readonly kind: NotificationKind; readonly title: string },
  now: Date,
): NotificationAdmission {
  const since = now.getTime() - notificationWindowMs;
  const inWindow = recent.filter(({ at }) => at.getTime() > since);
  if (inWindow.some(({ kind, title }) => kind === candidate.kind && title === candidate.title)) return 'duplicate';
  if (inWindow.filter(({ kind }) => kind === candidate.kind).length >= notificationDailyCapPerKind) return 'daily_cap';
  return 'admit';
}
