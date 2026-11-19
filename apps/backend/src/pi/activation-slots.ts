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
    readonly reason: 'paused' | 'quiet_hours' | 'spaced' | 'daily_cap';
    readonly status: PiBackgroundSlotStatus;
  };

export interface PiBackgroundSlotService {
  status(): Promise<PiBackgroundSlotStatus>;
  reserve(input: {
    readonly runId: string;
    readonly eventCount: number;
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
      options.queue.lastBatchAt(day),
      options.queue.recovery(at),
    ]);
    const quiet = isQuietHour(at);
    const gapReady = last ? new Date(last.getTime() + MIN_WAKE_GAP_MS) : at;
    const quietReady = quiet || isQuietHour(gapReady) ? nextSlotAfter(quiet ? at : gapReady).at : at;
    const nextAllowed = new Date(Math.max(gapReady.getTime(), quietReady.getTime()));
    const allowed = Math.min(DEFAULT_BACKGROUND_TURNS_PER_DAY, settings.backgroundTurnsPerDay);
    return {
      used,
      allowed,
      remaining: Math.max(0, allowed - used),
      lastAt: last?.toISOString() ?? null,
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
      const current = await status();
      const settings = await options.proactive.settings.read();
      if (settings.paused) return { allowed: false, reason: 'paused', status: current };
      if (current.quiet && input.allowQuiet !== true) {
        return { allowed: false, reason: 'quiet_hours', status: current };
      }
      if (current.used >= current.allowed) return { allowed: false, reason: 'daily_cap', status: current };
      if (current.lastAt && at.getTime() - Date.parse(current.lastAt) < MIN_WAKE_GAP_MS) {
        return { allowed: false, reason: 'spaced', status: current };
      }
      await options.queue.startBatch(input.runId, at, input.eventCount);
      const updated = await status();
      return { allowed: true, status: updated };
    },
  };
}
