import type { ProactiveStore } from './store.js';
import { isQuietHour, latestSlotAtOrBefore } from './time.js';
import type { RunSummary } from './types.js';

export interface ProactiveSchedulerOptions {
  store: ProactiveStore;
  now: () => Date;
  run: (claim: { run: RunSummary; generation: number }, signal?: AbortSignal) => Promise<void>;
  logger?: { warn: (fields: object, message: string) => void } | undefined;
}

export function createProactiveScheduler(options: ProactiveSchedulerOptions) {
  let stopped = false;
  let startup: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticking: Promise<void> | undefined;
  let active: { controller: AbortController; task: Promise<void> } | undefined;
  const handledSlots = new Set<string>();

  function warn() {
    options.logger?.warn({ reason: 'internal_error' }, 'Proactive scheduler failed');
  }

  async function evaluate() {
    if (stopped) return;
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
    handledSlots.add(slot.key);
    const settings = await options.store.settings.read();
    if (stopped) return;
    const claim = await options.store.runs.claim({
      trigger: age < 5 * 60_000 ? 'scheduled' : 'catchup',
      slot: slot.key,
      now,
    });
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
        } else await options.run(claim, controller.signal);
      } catch {
        await options.store.runs.finish(claim.run.id, claim.generation,
          controller.signal.aborted ? 'cancelled' : 'failed',
          controller.signal.aborted ? String(controller.signal.reason) : 'internal_error', 0, options.now());
      }
    }).catch(warn).finally(() => { active = undefined; });
    active = { controller, task };
  }

  function tick(): Promise<void> {
    ticking ??= evaluate().finally(() => { ticking = undefined; });
    return ticking;
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void tick().catch(warn).finally(schedule);
    }, 30_000);
    timer.unref();
  }

  return {
    start(): Promise<void> {
      startup ??= (async () => {
        try {
          await options.store.runs.markInterruptedOnStartup();
        } catch {
          stopped = true;
          warn();
          return;
        }
        await tick().catch(warn);
        schedule();
      })();
      return startup;
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      active?.controller.abort('interrupted_by_restart');
      await startup?.catch(warn);
      await ticking?.catch(warn);
      active?.controller.abort('interrupted_by_restart');
      await active?.task;
    },
    tick,
  };
}
