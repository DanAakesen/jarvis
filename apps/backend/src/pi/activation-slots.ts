import type { EventQueueStore } from '../proactive/events/event-queue.js';
import type { ProactiveStore } from '../proactive/store.js';
import { copenhagenDayStart, isQuietHour, nextSlotAfter } from '../proactive/time.js';

export const MIN_WAKE_GAP_MS = 10 * 60_000;
export const DEFAULT_BACKGROUND_TURNS_PER_DAY = 12;

export interface PiBackgroundSlotStatus {
  readonly used: number;
  readonly allowed: number;
  readonly remaining: number;
  readonly lastAt: string | null;
  readonly lastActivationType: 'event' | 'scheduled' | null;
  readonly lastSatisfiedSlot: string | null;
  readonly nextAllowedAt: string | null;
  readonly quiet: boolean;
  readonly queue: {
    readonly pending: number;
    readonly leased: number;
    readonly retrying: number;
  };
}

export type PiBackgroundReservation =
  | { readonly allowed: true; readonly status: PiBackgroundSlotStatus }
  | {
    readonly allowed: false;
    readonly reason: 'paused' | 'quiet_hours' | 'spaced' | 'daily_cap' | 'duplicate';
    readonly status: PiBackgroundSlotStatus;
  };

export interface PiBackgroundSlotService {
  status(): Promise<PiBackgroundSlotStatus>;
  reserve(input: {
    readonly runId: string;
    readonly eventCount: number;
    readonly activationType: 'event' | 'scheduled';
    readonly satisfiedSlot?: string | null;
    readonly allowQuiet?: boolean;
  }): Promise<PiBackgroundReservation>;
}

export function createPiBackgroundSlotService(options: {
  readonly queue: EventQueueStore;
  readonly proactive: Pick<ProactiveStore, 'settings'>;
  readonly now: () => Date;
}): PiBackgroundSlotService {
  async function status(): Promise<PiBackgroundSlotStatus> {
    const at = options.now();
    const settings = await options.proactive.settings.read();
    const day = copenhagenDayStart(at);
    const [used, last, recovery] = await Promise.all([
      options.queue.modelBatchesSince(day),
      options.queue.lastBatch(),
      options.queue.recovery(at),
    ]);
    const quiet = isQuietHour(at);
    const lastAt = last?.at ?? null;
    const gapReady = lastAt ? new Date(lastAt.getTime() + MIN_WAKE_GAP_MS) : at;
    const quietReady = quiet || isQuietHour(gapReady) ? nextSlotAfter(quiet ? at : gapReady).at : at;
    const nextAllowed = new Date(Math.max(gapReady.getTime(), quietReady.getTime()));
    const allowed = Math.min(DEFAULT_BACKGROUND_TURNS_PER_DAY, settings.backgroundTurnsPerDay);
    return {
      used,
      allowed,
      remaining: Math.max(0, allowed - used),
      lastAt: lastAt?.toISOString() ?? null,
      lastActivationType: last?.activationType ?? null,
      lastSatisfiedSlot: last?.satisfiedSlot ?? null,
      nextAllowedAt: used >= allowed || !settings.paused && nextAllowed.getTime() <= at.getTime()
        ? null
        : nextAllowed.toISOString(),
      quiet,
      queue: recovery,
    };
  }

  return {
    status,
    async reserve(input) {
      const at = options.now();
      const settings = await options.proactive.settings.read();
      const reason = await options.queue.reserveBatch({
        batchId: input.runId,
        now: at,
        dayStart: copenhagenDayStart(at),
        eventCount: input.eventCount,
        allowed: Math.min(DEFAULT_BACKGROUND_TURNS_PER_DAY, settings.backgroundTurnsPerDay),
        minGapMs: MIN_WAKE_GAP_MS,
        quiet: isQuietHour(at),
        allowQuiet: input.allowQuiet === true,
        paused: settings.paused,
        activationType: input.activationType,
        satisfiedSlot: input.satisfiedSlot ?? null,
      });
      const updated = await status();
      return reason
        ? { allowed: false, reason, status: updated }
        : { allowed: true, status: updated };
    },
  };
}
