import { randomUUID } from 'node:crypto';

export type OwnerReminderCadence = 'daily' | 'weekly';
export type OwnerReminderState = 'scheduled' | 'sending' | 'completed' | 'cancelled' | 'failed' | 'suppressed';
export type OwnerReminderDelivery = 'provider_accepted' | 'failed' | 'suppressed' | null;

export interface OwnerReminderSchedule {
  id: string;
  idempotencyKey: string;
  taskIdentity: string;
  taskTitle: string;
  fireAt: Date;
  localTime: string;
  anchorDate: string | null;
  cadence: OwnerReminderCadence | null;
  untilTaskDone: boolean;
  state: OwnerReminderState;
  reason: string | null;
  verifyAttempts: number;
  sendAttempts: number;
  itemId: string | null;
  lastFireAt: Date | null;
  lastDelivery: OwnerReminderDelivery;
  claimToken: string | null;
  leaseUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOwnerReminder {
  idempotencyKey: string;
  taskIdentity: string;
  taskTitle: string;
  fireAt: Date;
  localTime: string;
  anchorDate: string | null;
  cadence: OwnerReminderCadence | null;
  untilTaskDone: boolean;
}

export type OwnerReminderUpdate = Partial<Pick<OwnerReminderSchedule,
  'fireAt' | 'localTime' | 'anchorDate' | 'cadence' | 'untilTaskDone' | 'taskTitle'>>;

export interface OwnerReminderStore {
  create(candidate: NewOwnerReminder, now: Date): Promise<{ schedule: OwnerReminderSchedule; created: boolean }>;
  list(limit: number): Promise<OwnerReminderSchedule[]>;
  get(id: string): Promise<OwnerReminderSchedule | null>;
  updateScheduled(id: string, update: OwnerReminderUpdate): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  earliestFireAt(): Promise<Date | null>;
  hasTaskReminderNear(taskIdentity: string, fireAt: Date, windowMs: number): Promise<boolean>;
  claimDue(now: Date, limit: number, leaseMs: number): Promise<OwnerReminderSchedule[]>;
  finishClaim(
    id: string,
    claimToken: string,
    update: Partial<Pick<OwnerReminderSchedule,
      'fireAt' | 'localTime' | 'taskTitle' | 'state' | 'reason' | 'verifyAttempts' | 'sendAttempts' |
      'itemId' | 'lastFireAt' | 'lastDelivery'>>,
  ): Promise<boolean>;
}

function copy(schedule: OwnerReminderSchedule): OwnerReminderSchedule {
  return {
    ...schedule,
    fireAt: new Date(schedule.fireAt),
    lastFireAt: schedule.lastFireAt ? new Date(schedule.lastFireAt) : null,
    leaseUntil: schedule.leaseUntil ? new Date(schedule.leaseUntil) : null,
    createdAt: new Date(schedule.createdAt),
    updatedAt: new Date(schedule.updatedAt),
  };
}

export function createMemoryOwnerReminderStore(): OwnerReminderStore & { snapshot(): OwnerReminderSchedule[] } {
  const schedules = new Map<string, OwnerReminderSchedule>();
  return {
    async create(candidate, now) {
      const previous = [...schedules.values()].find(({ idempotencyKey }) => idempotencyKey === candidate.idempotencyKey);
      if (previous) return { schedule: copy(previous), created: false };
      const active = [...schedules.values()].filter(({ state }) => state === 'scheduled' || state === 'sending').length;
      if (active >= 100) throw new RangeError('Owner reminder limit reached');
      const schedule: OwnerReminderSchedule = {
        ...candidate,
        id: randomUUID(),
        state: 'scheduled',
        reason: null,
        verifyAttempts: 0,
        sendAttempts: 0,
        itemId: null,
        lastFireAt: null,
        lastDelivery: null,
        claimToken: null,
        leaseUntil: null,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      };
      schedules.set(schedule.id, schedule);
      return { schedule: copy(schedule), created: true };
    },
    async list(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new RangeError('Invalid reminder limit');
      return [...schedules.values()]
        .sort((left, right) => left.fireAt.getTime() - right.fireAt.getTime())
        .slice(0, limit)
        .map(copy);
    },
    async get(id) {
      const schedule = schedules.get(id);
      return schedule ? copy(schedule) : null;
    },
    async updateScheduled(id, update) {
      const schedule = schedules.get(id);
      if (!schedule || schedule.state !== 'scheduled') return false;
      Object.assign(schedule, update, { updatedAt: new Date() });
      return true;
    },
    async cancel(id) {
      const schedule = schedules.get(id);
      if (!schedule || (schedule.state !== 'scheduled' && schedule.state !== 'sending')) return false;
      Object.assign(schedule, {
        state: 'cancelled',
        reason: 'cancelled',
        claimToken: null,
        leaseUntil: null,
        updatedAt: new Date(),
      });
      return true;
    },
    async earliestFireAt() {
      const earliest = [...schedules.values()]
        .filter(({ state }) => state === 'scheduled' || state === 'sending')
        .reduce<number | null>((value, row) => {
          const at = row.state === 'sending' ? row.leaseUntil?.getTime() : row.fireAt.getTime();
          return at === undefined || at === null ? value : value === null ? at : Math.min(value, at);
        }, null);
      return earliest === null ? null : new Date(earliest);
    },
    async hasTaskReminderNear(taskIdentity, fireAt, windowMs) {
      if (!Number.isFinite(windowMs) || windowMs < 0 || windowMs > 24 * 60 * 60_000) {
        throw new RangeError('Invalid reminder overlap window');
      }
      const start = fireAt.getTime() - windowMs;
      const end = fireAt.getTime() + windowMs;
      return [...schedules.values()].some((schedule) =>
        schedule.taskIdentity === taskIdentity &&
        ((schedule.state === 'scheduled' || schedule.state === 'sending') &&
          schedule.fireAt.getTime() >= start && schedule.fireAt.getTime() <= end ||
         schedule.lastDelivery === 'provider_accepted' && schedule.lastFireAt !== null &&
          schedule.lastFireAt.getTime() >= start && schedule.lastFireAt.getTime() <= end));
    },
    async claimDue(now, limit, leaseMs) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isFinite(leaseMs) || leaseMs < 1) {
        throw new RangeError('Invalid reminder claim');
      }
      const candidates = [...schedules.values()]
        .filter(({ state, fireAt, leaseUntil }) =>
          (state === 'scheduled' && fireAt.getTime() <= now.getTime()) ||
          (state === 'sending' && leaseUntil !== null && leaseUntil.getTime() <= now.getTime()))
        .sort((left, right) => left.fireAt.getTime() - right.fireAt.getTime())
        .slice(0, limit);
      for (const schedule of candidates) {
        schedule.state = 'sending';
        schedule.claimToken = randomUUID();
        schedule.leaseUntil = new Date(now.getTime() + leaseMs);
        schedule.updatedAt = new Date(now);
      }
      return candidates.map(copy);
    },
    async finishClaim(id, claimToken, update) {
      const schedule = schedules.get(id);
      if (!schedule || schedule.state !== 'sending' || schedule.claimToken !== claimToken) return false;
      Object.assign(schedule, update, {
        state: update.state ?? 'scheduled',
        claimToken: null,
        leaseUntil: null,
        updatedAt: new Date(),
      });
      return true;
    },
    snapshot() {
      return [...schedules.values()].map(copy);
    },
  };
}
