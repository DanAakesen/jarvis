import { errorClassName } from '../logging.js';
import type { ProactiveStore } from './store.js';
import { isQuietHour, latestSlotAtOrBefore } from './time.js';
import type { RunSummary } from './types.js';

/** Where the scheduler failed: what `proactive.failed` says besides `internal_error`. */
type FailureStage = 'startup' | 'slot' | 'run' | 'run_finish' | 'event_tick';

export interface ProactiveSchedulerOptions {
  store: ProactiveStore;
  now: () => Date;
  /** What a 07:00 or 18:00 slot starts. Without it only the event tick runs, so no slot is ever claimed. */
  run?: ((claim: { run: RunSummary; generation: number }, signal?: AbortSignal) => Promise<void>) | undefined;
  logger?: { warn: (fields: object, message: string) => void } | undefined;
  /** Runs on every tick after the slot check, also at night. The event pipeline reads its queue here. */
  onTick?: ((signal: AbortSignal) => Promise<unknown>) | undefined;
}

export function createProactiveScheduler(options: ProactiveSchedulerOptions) {
  let stopped = false;
  let startup: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticking: Promise<void> | undefined;
  let active: { controller: AbortController; task: Promise<void> } | undefined;
  const shutdown = new AbortController();
  const handledSlots = new Set<string>();

  /** One `proactive.failed` line: where it failed and the class of what was thrown, never its message. */
  function warn(stage: FailureStage, error: unknown) {
    try {
      options.logger?.warn({ reason: 'internal_error', stage, errorClass: errorClassName(error) }, 'proactive.failed');
    } catch { /* Logging cannot change the scheduler. */ }
  }

  async function evaluate() {
    if (stopped || !options.run) return;
    const now = options.now();
    if (isQuietHour(now)) {
      active?.controller.abort('quiet_hours');
      return;
    }
    if (active) return;
    const slot = latestSlotAtOrBefore(now);
    if (handledSlots.has(slot.key)) return;
    const age = now.getTime() - slot.at.getTime();
    if (age >= 12 * 60 * 60_000) {
      handledSlots.add(slot.key);
      return;
    }
    const settings = await options.store.settings.read();
    if (stopped) return;
    const claim = await options.store.runs.claim({
      trigger: age < 5 * 60_000 ? 'scheduled' : 'catchup',
      slot: slot.key,
      now,
    });
    // Only a read and a claim that were answered settle the slot. One that threw is tried again on the next tick, until the slot is 12 hours old.
    handledSlots.add(slot.key);
    if (!claim) return;
    const skip = settings.paused ? 'paused'
      : !Object.values(settings.sources).some(Boolean) ? 'no_sources' : null;
    if (skip) {
      await options.store.runs.finish(claim.run.id, claim.generation, 'skipped', skip, 0, options.now());
      return;
    }
    const controller = new AbortController();
    if (stopped) controller.abort('interrupted_by_restart');
    else if (isQuietHour(options.now())) controller.abort('quiet_hours');
    const task = Promise.resolve().then(async () => {
      try {
        if (controller.signal.aborted) {
          await options.store.runs.finish(claim.run.id, claim.generation, 'cancelled',
            controller.signal.reason === 'quiet_hours' ? 'quiet_hours' : 'interrupted_by_restart', 0, options.now());
        } else await options.run!(claim, controller.signal);
      } catch (error) {
        const aborted = controller.signal.aborted;
        if (!aborted) warn('run', error);
        await options.store.runs.finish(claim.run.id, claim.generation,
          aborted ? 'cancelled' : 'failed',
          aborted ? String(controller.signal.reason) : 'internal_error', 0, options.now());
      }
    }).catch((error) => warn('run_finish', error)).finally(() => { active = undefined; });
    active = { controller, task };
  }

  async function tickEvents() {
    if (stopped || !options.onTick) return;
    try { await options.onTick(shutdown.signal); } catch (error) { if (!stopped) warn('event_tick', error); }
  }

  /** Never rejects: a failing slot check is logged and the event tick still runs. */
  function tick(): Promise<void> {
    ticking ??= (async () => {
      try { await evaluate(); } catch (error) { if (!stopped) warn('slot', error); }
      await tickEvents();
    })().finally(() => { ticking = undefined; });
    return ticking;
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void tick().finally(schedule);
    }, 30_000);
    timer.unref();
  }

  return {
    start(): Promise<void> {
      startup ??= (async () => {
        // Marking what a restart interrupted is housekeeping (the next claim reclaims a stale lease anyway), so a failed write is
        // logged and the scheduler, and with it the brain's tick, still starts.
        try { await options.store.runs.markInterruptedOnStartup(); } catch (error) { warn('startup', error); }
        await tick();
        schedule();
      })();
      return startup;
    },
    async stop(): Promise<void> {
      stopped = true;
      shutdown.abort('shutdown');
      if (timer) clearTimeout(timer);
      active?.controller.abort('interrupted_by_restart');
      await Promise.allSettled([startup, ticking]);
      active?.controller.abort('interrupted_by_restart');
      await active?.task;
    },
    tick,
  };
}
