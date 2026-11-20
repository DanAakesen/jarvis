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
