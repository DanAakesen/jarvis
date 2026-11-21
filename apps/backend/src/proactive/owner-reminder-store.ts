import { randomUUID } from 'node:crypto';

export type OwnerReminderCadence = 'daily' | 'weekly';
export type OwnerReminderState = 'scheduled' | 'sending' | 'retrying' | 'completed' | 'cancelled' | 'failed' | 'suppressed';
export type OwnerReminderDelivery = 'provider_accepted' | 'retrying' | 'failed' | 'suppressed' | null;
export type OwnerReminderProviderOutcome =
  | 'provider_accepted'
  | 'partial_acceptance'
  | 'in_progress'
  | 'provider_unavailable'
  | 'provider_rejected'
  | 'retry_exhausted'
  | 'apns_invalid_token'
  | 'registration_removed'
  | 'registration_expired'
  | 'delivery_expired'
  | 'no_subscription'
  | 'delivery_failed'
  | 'delivery_evidence_unavailable'
  | null;
export type OwnerReminderProvider = 'apns' | 'web_push' | null;

export const ownerReminderMaxSendAttempts = 2;
export const ownerReminderRetryDelayMs = 5 * 60_000;

export type OwnerReminderOutboxState =
  | 'pending'
  | 'sending'
  | 'retrying'
  | 'accepted'
  | 'failed'
  | 'expired'
  | 'invalid_token'
  | 'suppressed';

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
  nextAttemptAt: Date | null;
  itemId: string | null;
  lastFireAt: Date | null;
  lastDelivery: OwnerReminderDelivery;
  lastProvider: OwnerReminderProvider;
  lastProviderOutcome: OwnerReminderProviderOutcome;
  lastProviderStatusCode: number | null;
  recipientCount: number;
  acceptedRecipientCount: number;
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

export interface OwnerReminderDeliverySummary {
  evidenceAvailable: boolean;
  recipientCount: number;
  acceptedRecipientCount: number;
  pendingRecipientCount: number;
  attemptCount: number;
  providerOutcome: OwnerReminderProviderOutcome;
  providerStatusCode: number | null;
  nextAttemptAt: Date | null;
}

export interface OwnerReminderNativeDeliveryInput {
  scheduleId: string;
  claimToken: string;
  occurrenceAt: Date;
  itemId: string;
  notificationId: string;
  now: Date;
  expiresAt: Date;
}

export interface ClaimedOwnerReminderDelivery {
  id: string;
  claimToken: string;
  scheduleId: string;
  occurrenceAt: Date;
  itemId: string;
  registrationId: string;
  deviceToken: string;
  notificationId: string;
  expiresAt: Date;
  attemptCount: number;
}

export interface OwnerReminderDeliveryStore {
  queueNativeDeliveries(input: OwnerReminderNativeDeliveryInput): Promise<OwnerReminderDeliverySummary>;
  claimNativeDeliveries(input: {
    scheduleId: string;
    occurrenceAt: Date;
    claimToken: string;
    now: Date;
    leaseUntil: Date;
    limit?: number;
  }): Promise<ClaimedOwnerReminderDelivery[]>;
  acceptedNativeDelivery(id: string, claimToken: string, statusCode: number | null): Promise<boolean>;
  retryNativeDelivery(
    id: string,
    claimToken: string,
    nextAttemptAt: Date,
    statusCode: number | null,
  ): Promise<boolean>;
  failedNativeDelivery(
    id: string,
    claimToken: string,
    result: 'provider_rejected' | 'retry_exhausted',
    statusCode: number | null,
  ): Promise<boolean>;
  invalidNativeDelivery(id: string, claimToken: string, statusCode: number | null): Promise<boolean>;
  nativeDeliverySummary(
    scheduleId: string,
    occurrenceAt: Date,
  ): Promise<OwnerReminderDeliverySummary>;
}

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
      'nextAttemptAt' | 'itemId' | 'lastFireAt' | 'lastDelivery' | 'lastProviderOutcome' |
      'lastProvider' | 'lastProviderStatusCode' | 'recipientCount' | 'acceptedRecipientCount'>>,
  ): Promise<boolean>;
}

interface DeliverySummaryRow {
  state: OwnerReminderOutboxState;
  attemptCount: number;
  lastResult: string | null;
  lastStatusCode: number | null;
  nextAttemptAt: Date | null;
  leaseUntil: Date | null;
  lastAttemptAt: Date | null;
}

export function summarizeOwnerReminderDeliveries(
  rows: readonly DeliverySummaryRow[],
): OwnerReminderDeliverySummary {
  if (rows.length === 0) {
    return {
      evidenceAvailable: false,
      recipientCount: 0,
      acceptedRecipientCount: 0,
      pendingRecipientCount: 0,
      attemptCount: 0,
      providerOutcome: null,
      providerStatusCode: null,
      nextAttemptAt: null,
    };
  }
  const accepted = rows.filter(({ state }) => state === 'accepted').length;
  const pending = rows.filter(({ state }) =>
    state === 'pending' || state === 'sending' || state === 'retrying');
  const latest = [...rows].sort((left, right) =>
    (right.lastAttemptAt?.getTime() ?? 0) - (left.lastAttemptAt?.getTime() ?? 0))[0]!;
  const nextAttemptTimes = pending.flatMap(({ nextAttemptAt, leaseUntil }) =>
    [nextAttemptAt, leaseUntil].flatMap((value) => value === null ? [] : [value.getTime()]));
  let providerOutcome: OwnerReminderProviderOutcome;
  if (accepted === rows.length) providerOutcome = 'provider_accepted';
  else if (pending.length > 0) {
    providerOutcome = latest.attemptCount > 0 && latest.lastResult === 'provider_unavailable'
      ? 'provider_unavailable'
      : 'in_progress';
  } else if (accepted > 0) providerOutcome = 'partial_acceptance';
  else if (rows.every(({ state }) => state === 'invalid_token')) providerOutcome = 'apns_invalid_token';
  else if (rows.every(({ lastResult }) => lastResult === 'registration_removed')) {
    providerOutcome = 'registration_removed';
  } else if (rows.every(({ lastResult }) => lastResult === 'registration_expired')) {
    providerOutcome = 'registration_expired';
  } else if (rows.every(({ lastResult }) => lastResult === 'delivery_expired')) {
    providerOutcome = 'delivery_expired';
  } else if (rows.some(({ lastResult }) => lastResult === 'retry_exhausted')) {
    providerOutcome = 'retry_exhausted';
  } else if (rows.some(({ lastResult }) => lastResult === 'delivery_evidence_unavailable')) {
    providerOutcome = 'delivery_evidence_unavailable';
  } else if (rows.some(({ lastResult }) => lastResult === 'provider_unavailable')) {
    providerOutcome = 'provider_unavailable';
  } else if (rows.some(({ lastResult }) => lastResult === 'provider_rejected')) {
    providerOutcome = 'provider_rejected';
  } else providerOutcome = 'delivery_failed';
  return {
    evidenceAvailable: true,
    recipientCount: rows.length,
    acceptedRecipientCount: accepted,
    pendingRecipientCount: pending.length,
    attemptCount: Math.max(...rows.map((row) => row.attemptCount)),
    providerOutcome,
    providerStatusCode: latest.lastStatusCode,
    nextAttemptAt: nextAttemptTimes.length === 0 ? null : new Date(Math.min(...nextAttemptTimes)),
  };
}

export function ownerReminderRetryAt(attemptCount: number, now: Date): Date | null {
  if (!Number.isInteger(attemptCount) || attemptCount < 1 ||
      attemptCount >= ownerReminderMaxSendAttempts) return null;
  return new Date(now.getTime() + ownerReminderRetryDelayMs);
}

function copy(schedule: OwnerReminderSchedule): OwnerReminderSchedule {
  return {
    ...schedule,
    fireAt: new Date(schedule.fireAt),
    nextAttemptAt: schedule.nextAttemptAt ? new Date(schedule.nextAttemptAt) : null,
    lastFireAt: schedule.lastFireAt ? new Date(schedule.lastFireAt) : null,
    leaseUntil: schedule.leaseUntil ? new Date(schedule.leaseUntil) : null,
    createdAt: new Date(schedule.createdAt),
    updatedAt: new Date(schedule.updatedAt),
  };
}

interface MemoryDelivery {
  id: string;
  scheduleId: string;
  occurrenceAt: Date;
  itemId: string;
  registrationId: string;
  deviceToken: string;
  notificationId: string;
  state: OwnerReminderOutboxState;
  attemptCount: number;
  lastResult: string | null;
  lastStatusCode: number | null;
  nextAttemptAt: Date | null;
  expiresAt: Date;
  claimToken: string | null;
  leaseUntil: Date | null;
  lastAttemptAt: Date | null;
}

export function createMemoryOwnerReminderStore(options: {
  nativeRecipients?: () => readonly {
    registrationId: string;
    deviceToken: string;
  }[];
} = {}): OwnerReminderStore & OwnerReminderDeliveryStore & {
  snapshot(): OwnerReminderSchedule[];
  deliverySnapshot(): MemoryDelivery[];
} {
  const schedules = new Map<string, OwnerReminderSchedule>();
  const deliveries = new Map<string, MemoryDelivery>();
  const deliverySnapshots = new Set<string>();
  const deliverySummary = (scheduleId: string, occurrenceAt: Date) => summarizeOwnerReminderDeliveries(
    [...deliveries.values()]
      .filter((delivery) => delivery.scheduleId === scheduleId &&
        delivery.occurrenceAt.getTime() === occurrenceAt.getTime()),
  );
  const updateDelivery = (id: string, claimToken: string, update: Partial<MemoryDelivery>): boolean => {
    const delivery = deliveries.get(id);
    if (!delivery || delivery.state !== 'sending' || delivery.claimToken !== claimToken) return false;
    Object.assign(delivery, update);
    return true;
  };
  return {
    async create(candidate, now) {
      const previous = [...schedules.values()].find(({ idempotencyKey }) => idempotencyKey === candidate.idempotencyKey);
      if (previous) return { schedule: copy(previous), created: false };
      const active = [...schedules.values()].filter(({ state }) =>
        state === 'scheduled' || state === 'sending' || state === 'retrying').length;
      if (active >= 100) throw new RangeError('Owner reminder limit reached');
      const schedule: OwnerReminderSchedule = {
        ...candidate,
        id: randomUUID(),
        state: 'scheduled',
        reason: null,
        verifyAttempts: 0,
        sendAttempts: 0,
        nextAttemptAt: null,
        itemId: null,
        lastFireAt: null,
        lastDelivery: null,
        lastProvider: null,
        lastProviderOutcome: null,
        lastProviderStatusCode: null,
        recipientCount: 0,
        acceptedRecipientCount: 0,
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
        .sort((left, right) => {
          const active = (state: OwnerReminderState) =>
            state === 'scheduled' || state === 'sending' || state === 'retrying';
          const rank = Number(!active(left.state)) - Number(!active(right.state));
          if (rank !== 0) return rank;
          const leftAt = left.nextAttemptAt?.getTime() ?? left.fireAt.getTime();
          const rightAt = right.nextAttemptAt?.getTime() ?? right.fireAt.getTime();
          return leftAt - rightAt || right.fireAt.getTime() - left.fireAt.getTime();
        })
        .slice(0, limit)
        .map(copy);
    },
    async get(id) {
      const schedule = schedules.get(id);
      return schedule ? copy(schedule) : null;
    },
    async updateScheduled(id, update) {
      const schedule = schedules.get(id);
      if (!schedule || schedule.state !== 'scheduled' && schedule.state !== 'retrying') return false;
      for (const delivery of deliveries.values()) {
        if (delivery.scheduleId === id && delivery.state !== 'accepted' &&
            delivery.state !== 'failed' && delivery.state !== 'expired' &&
            delivery.state !== 'invalid_token' && delivery.state !== 'suppressed') {
          Object.assign(delivery, {
            state: 'suppressed',
            lastResult: 'rescheduled',
            nextAttemptAt: null,
            claimToken: null,
            leaseUntil: null,
          });
        }
      }
      Object.assign(schedule, update, {
        state: 'scheduled',
        reason: null,
        verifyAttempts: 0,
        sendAttempts: 0,
        nextAttemptAt: null,
        lastDelivery: null,
        lastProvider: null,
        lastProviderOutcome: null,
        lastProviderStatusCode: null,
        recipientCount: 0,
        acceptedRecipientCount: 0,
        updatedAt: new Date(),
      });
      return true;
    },
    async cancel(id) {
      const schedule = schedules.get(id);
      if (!schedule || schedule.state !== 'scheduled' &&
          schedule.state !== 'retrying') return false;
      for (const delivery of deliveries.values()) {
        if (delivery.scheduleId === id && delivery.state !== 'accepted' &&
            delivery.state !== 'failed' &&
            delivery.state !== 'expired' && delivery.state !== 'invalid_token' &&
            delivery.state !== 'suppressed') {
          Object.assign(delivery, {
            state: 'suppressed',
            lastResult: 'cancelled',
            nextAttemptAt: null,
            claimToken: null,
            leaseUntil: null,
          });
        }
      }
      Object.assign(schedule, {
        state: 'cancelled',
        reason: 'cancelled',
        claimToken: null,
        leaseUntil: null,
        nextAttemptAt: null,
        updatedAt: new Date(),
      });
      return true;
    },
    async earliestFireAt() {
      const earliest = [...schedules.values()]
        .filter(({ state }) => state === 'scheduled' || state === 'sending' || state === 'retrying')
        .reduce<number | null>((value, row) => {
          const at = row.state === 'sending' ? row.leaseUntil?.getTime()
            : row.state === 'retrying' ? row.nextAttemptAt?.getTime() : row.fireAt.getTime();
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
      ((schedule.state === 'scheduled' || schedule.state === 'sending' || schedule.state === 'retrying') &&
          schedule.fireAt.getTime() >= start && schedule.fireAt.getTime() <= end ||
         schedule.lastDelivery === 'provider_accepted' && schedule.lastFireAt !== null &&
          schedule.lastFireAt.getTime() >= start && schedule.lastFireAt.getTime() <= end));
    },
    async claimDue(now, limit, leaseMs) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isFinite(leaseMs) || leaseMs < 1) {
        throw new RangeError('Invalid reminder claim');
      }
      const candidates = [...schedules.values()]
        .filter(({ state, fireAt, nextAttemptAt, leaseUntil }) =>
          (state === 'scheduled' && fireAt.getTime() <= now.getTime()) ||
          (state === 'retrying' && nextAttemptAt !== null &&
            nextAttemptAt.getTime() <= now.getTime()) ||
          (state === 'sending' && leaseUntil !== null && leaseUntil.getTime() <= now.getTime()))
        .sort((left, right) => left.fireAt.getTime() - right.fireAt.getTime())
        .slice(0, limit);
      for (const schedule of candidates) {
        if (schedule.state === 'scheduled') schedule.sendAttempts = 0;
        schedule.state = 'sending';
        schedule.claimToken = randomUUID();
        schedule.leaseUntil = new Date(now.getTime() + leaseMs);
        schedule.nextAttemptAt = null;
        schedule.updatedAt = new Date(now);
      }
      return candidates.map(copy);
    },
    async finishClaim(id, claimToken, update) {
      const schedule = schedules.get(id);
      if (!schedule || schedule.state !== 'sending' || schedule.claimToken !== claimToken) return false;
      if (update.state === 'cancelled' || update.state === 'failed' || update.state === 'suppressed') {
        for (const delivery of deliveries.values()) {
          if (delivery.scheduleId === id &&
              (delivery.state === 'pending' || delivery.state === 'retrying')) {
            Object.assign(delivery, {
              state: 'suppressed',
              lastResult: 'cancelled',
              nextAttemptAt: null,
              claimToken: null,
              leaseUntil: null,
            });
          }
        }
      }
      Object.assign(schedule, update, {
        state: update.state ?? 'scheduled',
        nextAttemptAt: update.state === 'retrying' ? update.nextAttemptAt ?? null : null,
        claimToken: null,
        leaseUntil: null,
        updatedAt: new Date(),
      });
      return true;
    },
    async queueNativeDeliveries(input) {
      const schedule = schedules.get(input.scheduleId);
      if (!schedule || schedule.state !== 'sending' || schedule.claimToken !== input.claimToken) {
        return deliverySummary(input.scheduleId, input.occurrenceAt);
      }
      const snapshotKey = `${input.scheduleId}:${input.occurrenceAt.toISOString()}`;
      if (deliverySnapshots.has(snapshotKey)) {
        return deliverySummary(input.scheduleId, input.occurrenceAt);
      }
      deliverySnapshots.add(snapshotKey);
      for (const recipient of options.nativeRecipients?.() ?? []) {
        const existing = [...deliveries.values()].find((delivery) =>
          delivery.scheduleId === input.scheduleId &&
          delivery.occurrenceAt.getTime() === input.occurrenceAt.getTime() &&
          delivery.registrationId === recipient.registrationId);
        if (existing) continue;
        const id = randomUUID();
        deliveries.set(id, {
          id,
          scheduleId: input.scheduleId,
          occurrenceAt: new Date(input.occurrenceAt),
          itemId: input.itemId,
          registrationId: recipient.registrationId,
          deviceToken: recipient.deviceToken,
          notificationId: input.notificationId,
          state: 'pending',
          attemptCount: 0,
          lastResult: null,
          lastStatusCode: null,
          nextAttemptAt: new Date(input.now),
          expiresAt: new Date(input.expiresAt),
          claimToken: null,
          leaseUntil: null,
          lastAttemptAt: null,
        });
      }
      return deliverySummary(input.scheduleId, input.occurrenceAt);
    },
    async claimNativeDeliveries(input) {
      const limit = input.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new RangeError('Invalid owner reminder delivery claim');
      }
      for (const delivery of deliveries.values()) {
        if (delivery.scheduleId === input.scheduleId &&
            delivery.occurrenceAt.getTime() === input.occurrenceAt.getTime() &&
            delivery.expiresAt.getTime() <= input.now.getTime() &&
            (delivery.state === 'pending' || delivery.state === 'sending' ||
              delivery.state === 'retrying')) {
          Object.assign(delivery, {
            state: 'expired',
            lastResult: 'delivery_expired',
            nextAttemptAt: null,
            claimToken: null,
            leaseUntil: null,
          });
        }
      }
      const due = [...deliveries.values()]
        .filter((delivery) => delivery.scheduleId === input.scheduleId &&
          delivery.occurrenceAt.getTime() === input.occurrenceAt.getTime() &&
          delivery.expiresAt.getTime() > input.now.getTime() &&
          ((delivery.state === 'pending' || delivery.state === 'retrying') &&
            delivery.nextAttemptAt !== null && delivery.nextAttemptAt.getTime() <= input.now.getTime() ||
            delivery.state === 'sending' && delivery.leaseUntil !== null &&
              delivery.leaseUntil.getTime() <= input.now.getTime()))
        .slice(0, limit);
      const claimed: ClaimedOwnerReminderDelivery[] = [];
      for (const delivery of due) {
        if (delivery.attemptCount >= ownerReminderMaxSendAttempts) {
          Object.assign(delivery, {
            state: 'failed',
            lastResult: 'delivery_evidence_unavailable',
            nextAttemptAt: null,
            claimToken: null,
            leaseUntil: null,
          });
          continue;
        }
        delivery.state = 'sending';
        delivery.claimToken = input.claimToken;
        delivery.leaseUntil = new Date(input.leaseUntil);
        delivery.nextAttemptAt = null;
        delivery.attemptCount += 1;
        delivery.lastAttemptAt = new Date(input.now);
        claimed.push({
          id: delivery.id,
          claimToken: input.claimToken,
          scheduleId: delivery.scheduleId,
          occurrenceAt: new Date(delivery.occurrenceAt),
          itemId: delivery.itemId,
          registrationId: delivery.registrationId,
          deviceToken: delivery.deviceToken,
          notificationId: delivery.notificationId,
          expiresAt: new Date(delivery.expiresAt),
          attemptCount: delivery.attemptCount,
        });
      }
      return claimed;
    },
    async acceptedNativeDelivery(id, claimToken, statusCode) {
      return updateDelivery(id, claimToken, {
        state: 'accepted',
        lastResult: 'provider_accepted',
        lastStatusCode: statusCode,
        nextAttemptAt: null,
        claimToken: null,
        leaseUntil: null,
      });
    },
    async retryNativeDelivery(id, claimToken, nextAttemptAt, statusCode) {
      return updateDelivery(id, claimToken, {
        state: 'retrying',
        lastResult: 'provider_unavailable',
        lastStatusCode: statusCode,
        nextAttemptAt: new Date(nextAttemptAt),
        claimToken: null,
        leaseUntil: null,
      });
    },
    async failedNativeDelivery(id, claimToken, result, statusCode) {
      return updateDelivery(id, claimToken, {
        state: 'failed',
        lastResult: result,
        lastStatusCode: statusCode,
        nextAttemptAt: null,
        claimToken: null,
        leaseUntil: null,
      });
    },
    async invalidNativeDelivery(id, claimToken, statusCode) {
      return updateDelivery(id, claimToken, {
        state: 'invalid_token',
        lastResult: 'apns_invalid_token',
        lastStatusCode: statusCode,
        nextAttemptAt: null,
        claimToken: null,
        leaseUntil: null,
      });
    },
    async nativeDeliverySummary(scheduleId, occurrenceAt) {
      return deliverySummary(scheduleId, occurrenceAt);
    },
    snapshot() {
      return [...schedules.values()].map(copy);
    },
    deliverySnapshot() {
      return [...deliveries.values()].map((delivery) => ({
        ...delivery,
        occurrenceAt: new Date(delivery.occurrenceAt),
        nextAttemptAt: delivery.nextAttemptAt ? new Date(delivery.nextAttemptAt) : null,
        expiresAt: new Date(delivery.expiresAt),
        leaseUntil: delivery.leaseUntil ? new Date(delivery.leaseUntil) : null,
        lastAttemptAt: delivery.lastAttemptAt ? new Date(delivery.lastAttemptAt) : null,
      }));
    },
  };
}
