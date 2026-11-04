import { describe, expect, it } from 'vitest';
import { admitNotification, notificationDailyCapPerKind, type RecentNotification } from './notification-policy.js';

const now = new Date('2026-11-03T10:00:00.000Z');

describe('owner notification admission', () => {
  it('never admits a success: a successful run is a log entry, not a notification', () => {
    expect(admitNotification([], { kind: 'success', title: 'Deployment accepted.' }, now)).toBe('not_notifiable');
  });

  it('rejects the same text of the same kind inside the rolling day, even when dismissed', () => {
    const recent: RecentNotification[] = [{ kind: 'info', title: 'Task 1 is now Done.', at: new Date('2026-11-03T08:00:00Z') }];
    expect(admitNotification(recent, { kind: 'info', title: 'Task 1 is now Done.' }, now)).toBe('duplicate');
    expect(admitNotification(recent, { kind: 'error', title: 'Task 1 is now Done.' }, now)).toBe('admit');
  });

  it('allows the text again once the day has passed', () => {
    const recent: RecentNotification[] = [{ kind: 'info', title: 'Task 1 is now Done.', at: new Date('2026-11-02T09:00:00Z') }];
    expect(admitNotification(recent, { kind: 'info', title: 'Task 1 is now Done.' }, now)).toBe('admit');
  });

  it('never admits more than the cap per kind in a burst', () => {
    const stored: RecentNotification[] = [];
    for (let index = 0; index < 100; index += 1) {
      const title = `Task ${index} needs attention.`;
      if (admitNotification(stored, { kind: 'warning', title }, now) === 'admit') {
        stored.push({ kind: 'warning', title, at: now });
      }
    }
    expect(stored).toHaveLength(notificationDailyCapPerKind);
    expect(admitNotification(stored, { kind: 'error', title: 'Another kind.' }, now)).toBe('admit');
  });
});
