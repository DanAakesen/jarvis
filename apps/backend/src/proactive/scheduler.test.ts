import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProactiveScheduler, type ProactiveSchedulerOptions } from './scheduler.js';
import { createMemoryProactiveStore } from './store.js';
import { sourceIds } from './types.js';

const schedulers: ReturnType<typeof createProactiveScheduler>[] = [];

function fixture(instant = '2026-10-20T05:00:00Z') {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(instant));
  const store = createMemoryProactiveStore();
  const run = vi.fn(async (claim: Parameters<ProactiveSchedulerOptions['run']>[0]) => {
    await store.runs.finish(claim.run.id, claim.generation, 'done', null, 0, new Date());
  });
  const scheduler = createProactiveScheduler({ store, now: () => new Date(), run });
  schedulers.push(scheduler);
  return { store, run, scheduler };
}

afterEach(async () => {
  await Promise.all(schedulers.splice(0).map((scheduler) => scheduler.stop()));
  vi.useRealTimers();
});

describe('proactive scheduler', () => {
  it.each([
    ['2026-03-29T05:00:00Z', '2026-03-29T07:00', 'scheduled'],
    ['2026-10-25T06:00:00Z', '2026-10-25T07:00', 'scheduled'],
    ['2026-10-20T05:04:59.999Z', '2026-10-20T07:00', 'scheduled'],
    ['2026-10-20T05:05:00Z', '2026-10-20T07:00', 'catchup'],
    ['2026-10-20T15:59:59Z', '2026-10-20T07:00', 'catchup'],
    ['2026-10-20T19:59:59Z', '2026-10-20T18:00', 'catchup'],
  ])('evaluates latest Copenhagen slot at %s', async (instant, slot, trigger) => {
    const { store, scheduler, run } = fixture(instant);
    await scheduler.start();
    expect(run).toHaveBeenCalledOnce();
    expect(await store.runs.list(50)).toMatchObject([{ slot, trigger }]);
  });

  it('interrupts startup runs exactly once and evaluates immediately without replay', async () => {
    const { store, scheduler, run } = fixture('2026-10-20T12:00:00Z');
    await store.runs.claim({ trigger: 'manual', slot: null, now: new Date() });
    const interrupted = vi.spyOn(store.runs, 'markInterruptedOnStartup');
    await Promise.all([scheduler.start(), scheduler.start()]);
    await scheduler.tick();
    expect(interrupted).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect((await store.runs.list(50)).filter((entry) => entry.trigger !== 'manual')).toHaveLength(1);
  });

  it('fails closed without rejecting or leaking details when startup recovery fails', async () => {
    const { store } = fixture();
    const recover = vi.spyOn(store.runs, 'markInterruptedOnStartup').mockRejectedValue(new Error('private database failure'));
    const run = vi.fn(async () => {});
    const logger = { warn: vi.fn() };
    const scheduler = createProactiveScheduler({ store, now: () => new Date(), run, logger });
    schedulers.push(scheduler);
    await expect(scheduler.start()).resolves.toBeUndefined();
    await scheduler.start();
    await scheduler.tick();
    expect(recover).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith({ reason: 'internal_error' }, 'proactive.failed');
    await scheduler.stop();
  });

  it('performs zero storage calls on idle and quiet ticks, retaining the morning opportunity', async () => {
    const { store, scheduler, run } = fixture('2026-10-20T04:59:00Z');
    const read = vi.spyOn(store.settings, 'read');
    const claim = vi.spyOn(store.runs, 'claim');
    await scheduler.start();
    await scheduler.tick();
    expect(read).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-20T05:00:00Z'));
    await scheduler.tick();
    expect(run).toHaveBeenCalledOnce();
    read.mockClear();
    claim.mockClear();
    await scheduler.tick();
    await scheduler.tick();
    expect(read).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it('coalesces claim admission and stops its recurring timer', async () => {
    const { store, scheduler, run } = fixture();
    const claim = vi.spyOn(store.runs, 'claim');
    await Promise.all([scheduler.tick(), scheduler.tick(), scheduler.tick()]);
    expect(claim).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    await scheduler.start();
    expect(vi.getTimerCount()).toBe(1);
    await scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    claim.mockClear();
    await scheduler.tick();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(claim).not.toHaveBeenCalled();
  });

  it('remembers all handled slots when the clock moves backwards', async () => {
    const { store, scheduler, run } = fixture();
    await scheduler.start();
    vi.setSystemTime(new Date('2026-10-20T16:00:00Z'));
    await scheduler.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    const read = vi.spyOn(store.settings, 'read');
    const claim = vi.spyOn(store.runs, 'claim');
    vi.setSystemTime(new Date('2026-10-20T05:01:00Z'));
    await scheduler.tick();
    expect(read).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(await store.runs.list(50)).toHaveLength(2);
  });

  it.each(['paused', 'no_sources'])('persists %s as skipped without a job or replay', async (reason) => {
    const { store, scheduler, run } = fixture();
    await store.settings.patch(reason === 'paused' ? { paused: true }
      : { sources: Object.fromEntries(sourceIds.map((id) => [id, false])) });
    await scheduler.start();
    expect(await store.runs.latest()).toMatchObject({ status: 'skipped', reason });
    await store.settings.patch({ paused: false, sources: { todos: true } });
    await scheduler.tick();
    expect(run).not.toHaveBeenCalled();
  });

  it('does not replay a persisted slot after restart', async () => {
    const { store, scheduler } = fixture();
    await scheduler.start();
    await scheduler.stop();
    const run = vi.fn(async () => {});
    const restarted = createProactiveScheduler({ store, now: () => new Date(), run });
    schedulers.push(restarted);
    await restarted.start();
    await restarted.tick();
    expect(run).not.toHaveBeenCalled();
    expect(await store.runs.list(50)).toHaveLength(1);
  });

  it.each([
    '2026-10-20T03:59:59Z',
    '2026-10-20T04:00:00Z',
    '2026-10-20T04:59:59Z',
  ])('does not replay yesterday near the 12-hour catchup boundary at %s', async (instant) => {
    const { store, scheduler, run } = fixture(instant);
    await scheduler.start();
    expect(await store.runs.list(50)).toEqual([]);
    vi.setSystemTime(new Date('2026-10-20T05:00:00Z'));
    await scheduler.tick();
    expect(run).toHaveBeenCalledOnce();
    expect(await store.runs.latest()).toMatchObject({ slot: '2026-10-20T07:00' });
  });

  it('keeps a later completed manual run from causing idle duplicate-slot polling', async () => {
    const { store, scheduler } = fixture();
    await scheduler.start();
    await scheduler.stop();
    const manual = await store.runs.claim({
      trigger: 'manual', slot: null, now: new Date('2026-10-20T05:10:00Z'),
    });
    await store.runs.finish(manual!.run.id, manual!.generation, 'done', null, 0, new Date());
    const restarted = createProactiveScheduler({ store, now: () => new Date(), run: vi.fn(async () => {}) });
    schedulers.push(restarted);
    await restarted.start();
    const claim = vi.spyOn(store.runs, 'claim');
    await restarted.tick();
    expect(claim).not.toHaveBeenCalled();
  });

  it('recovers from a failed timer tick without overlapping or an unhandled rejection', async () => {
    const { store, scheduler, run } = fixture();
    await scheduler.start();
    const read = vi.spyOn(store.settings, 'read').mockRejectedValueOnce(new Error('private failure'));
    vi.setSystemTime(new Date('2026-10-20T16:00:00Z'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date('2026-10-21T05:00:00Z'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs in background, coalesces concurrent ticks, and cancels at 22:00', async () => {
    const { store } = fixture('2026-10-20T19:59:30Z');
    let signal: AbortSignal | undefined;
    const finish = vi.spyOn(store.runs, 'finish');
    const run = vi.fn(async (claim: Parameters<ProactiveSchedulerOptions['run']>[0], current?: AbortSignal) => {
      signal = current;
      await new Promise<void>((resolve) => current!.addEventListener('abort', () => resolve(), { once: true }));
      await store.runs.finish(claim.run.id, claim.generation, 'cancelled', 'quiet_hours', 0, new Date());
    });
    const scheduler = createProactiveScheduler({ store, now: () => new Date(), run });
    schedulers.push(scheduler);
    await scheduler.start();
    await Promise.all([scheduler.tick(), scheduler.tick()]);
    expect(run).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signal?.aborted).toBe(true);
    expect(await store.runs.latest()).toMatchObject({ status: 'cancelled', reason: 'quiet_hours' });
    expect(finish).toHaveBeenCalledOnce();
  });

  it('finishes once without invoking the engine if quiet hours start while claiming', async () => {
    const { store, scheduler, run } = fixture('2026-10-20T19:59:59Z');
    const original = store.runs.claim.bind(store.runs);
    vi.spyOn(store.runs, 'claim').mockImplementationOnce(async (input) => {
      const claim = await original(input);
      vi.setSystemTime(new Date('2026-10-20T20:00:00Z'));
      return claim;
    });
    const finish = vi.spyOn(store.runs, 'finish');
    await scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledOnce();
    expect(await store.runs.latest()).toMatchObject({ status: 'cancelled', reason: 'quiet_hours' });
  });

  it('leaves manual runs alone and evaluates a blocked slot only once without idle database calls', async () => {
    const { store, scheduler, run } = fixture();
    const manual = await store.runs.claim({ trigger: 'manual', slot: null, now: new Date() });
    const read = vi.spyOn(store.settings, 'read');
    const claim = vi.spyOn(store.runs, 'claim');
    await scheduler.tick();
    expect(run).not.toHaveBeenCalled();
    await store.runs.finish(manual!.run.id, manual!.generation, 'done', null, 0, new Date());
    await scheduler.tick();
    await scheduler.tick();
    expect(run).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date('2026-10-20T20:00:00Z'));
    const next = await store.runs.claim({ trigger: 'manual', slot: null, now: new Date() });
    await scheduler.tick();
    expect(await store.runs.latest()).toMatchObject({ id: next!.run.id, status: 'running' });
  });

  it('catches callback errors and safely stops an active callback', async () => {
    const { store } = fixture();
    const failed = createProactiveScheduler({ store, now: () => new Date(), run: async () => { throw new Error('private'); } });
    schedulers.push(failed);
    await failed.start();
    await failed.stop();
    expect(await store.runs.latest()).toMatchObject({ status: 'failed', reason: 'internal_error' });

    vi.setSystemTime(new Date('2026-10-20T16:00:00Z'));
    let aborted = false;
    const scheduler = createProactiveScheduler({
      store, now: () => new Date(),
      run: async (claim, signal) => {
        await new Promise<void>((resolve) => signal!.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
        await store.runs.finish(claim.run.id, claim.generation, 'cancelled', 'interrupted_by_restart', 0, new Date());
      },
    });
    schedulers.push(scheduler);
    await scheduler.start();
    await scheduler.stop();
    expect(aborted).toBe(true);
    expect(await store.runs.latest()).toMatchObject({ status: 'cancelled', reason: 'interrupted_by_restart' });
  });
});
