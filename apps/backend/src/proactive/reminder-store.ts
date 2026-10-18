import { randomUUID } from 'node:crypto';

export type ReminderState = 'pending' | 'sent' | 'cancelled' | 'expired' | 'failed' | 'suppressed';

export interface PlannedReminder {
  reminderKey: string;
  deadlineAlertKey: string | null;
  fireAt: Date;
  dueAt: Date;
  title: string;
  plannedRunId: string | null;
}

export interface ReminderRow extends PlannedReminder {
  id: string;
  state: ReminderState;
  reason: string | null;
  verifyAttempts: number;
  sendAttempts: number;
  itemId: string | null;
  sentDayKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ReminderUpdate = Partial<Pick<ReminderRow,
  'state' | 'reason' | 'fireAt' | 'verifyAttempts' | 'sendAttempts' | 'itemId' | 'sentDayKey'>>;

export interface ReminderPlanResult {
  inserted: ReminderRow[];
  capSkipped: number;
  purged: number;
}

export interface ProactiveReminderStore {
  plan(candidates: readonly PlannedReminder[], now: Date): Promise<ReminderPlanResult>;
  earliestPendingFireAt(): Promise<Date | null>;
  listDue(now: Date, limit: number): Promise<ReminderRow[]>;
  countSent(dayKey: string): Promise<number>;
  updatePending(id: string, update: ReminderUpdate): Promise<boolean>;
}

export function createMemoryProactiveReminderStore(
  ownerObjectId: string = randomUUID(),
): ProactiveReminderStore & { snapshot(): ReminderRow[] } {
  void ownerObjectId;
  const rows = new Map<string, ReminderRow>();
  return {
    async plan(candidates, now) {
      const cutoff = now.getTime() - 30 * 24 * 60 * 60_000;
      let purged = 0;
      for (const [key, row] of rows) {
        if (row.state !== 'pending' && row.createdAt.getTime() < cutoff) {
          rows.delete(key);
          purged += 1;
        }
      }
      let pendingCount = [...rows.values()].filter(({ state }) => state === 'pending').length;
      let insertedCount = 0;
      let capSkipped = 0;
      const inserted: ReminderRow[] = [];
      for (const candidate of candidates) {
        if (rows.has(candidate.reminderKey)) continue;
        if (insertedCount >= 20 || pendingCount >= 100) {
          capSkipped += 1;
          continue;
        }
        const row: ReminderRow = {
          ...candidate,
          id: randomUUID(),
          state: 'pending',
          reason: null,
          verifyAttempts: 0,
          sendAttempts: 0,
          itemId: null,
          sentDayKey: null,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        };
        rows.set(row.reminderKey, row);
        inserted.push({ ...row });
        insertedCount += 1;
        pendingCount += 1;
      }
      return { inserted, capSkipped, purged };
    },
    async earliestPendingFireAt() {
      const earliest = [...rows.values()]
        .filter(({ state }) => state === 'pending')
        .reduce<number | null>((value, row) => value === null
          ? row.fireAt.getTime() : Math.min(value, row.fireAt.getTime()), null);
      return earliest === null ? null : new Date(earliest);
    },
    async listDue(now, limit) {
      return [...rows.values()]
        .filter(({ state, fireAt }) => state === 'pending' && fireAt.getTime() <= now.getTime())
        .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())
        .slice(0, limit)
        .map((row) => ({ ...row }));
    },
    async countSent(dayKey) {
      return [...rows.values()].filter(({ state, sentDayKey }) => state === 'sent' && sentDayKey === dayKey).length;
    },
    async updatePending(id, update) {
      const row = [...rows.values()].find((candidate) => candidate.id === id && candidate.state === 'pending');
      if (!row) return false;
      Object.assign(row, update, { updatedAt: new Date() });
      return true;
    },
    snapshot() {
      return [...rows.values()].map((row) => ({ ...row }));
    },
  };
}
