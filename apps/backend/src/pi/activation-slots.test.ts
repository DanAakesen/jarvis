import { describe, expect, it } from 'vitest';
import { createMemoryEventQueueStore } from '../proactive/events/event-queue.js';
import { createMemoryProactiveStore } from '../proactive/store.js';
import { createPiBackgroundSlotService, MIN_WAKE_GAP_MS } from './activation-slots.js';

const owner = '11111111-1111-4111-8111-111111111111';

describe('combined PI background slots', () => {
  it('shares event and scheduled reservations, survives restart, and enforces spacing and the owner allowance', async () => {
    let now = new Date('2026-11-19T09:00:00.000Z');
    const queue = createMemoryEventQueueStore();
    const proactive = createMemoryProactiveStore(owner);
    await proactive.settings.patch({ backgroundTurnsPerDay: 2 });
    const first = createPiBackgroundSlotService({ queue, proactive, now: () => now });
    expect(await first.reserve({
      runId: '00000000-0000-4000-8000-000000000001', eventCount: 3,
      activationType: 'event', satisfiedSlot: '2026-11-19T18:00', allowQuiet: true,
    })).toMatchObject({ allowed: true });
    expect(await first.reserve({
      runId: '00000000-0000-4000-8000-000000000002', eventCount: 0,
      activationType: 'scheduled', satisfiedSlot: '2026-11-19T18:00',
    })).toMatchObject({ allowed: false, reason: 'spaced' });

    const restarted = createPiBackgroundSlotService({ queue, proactive, now: () => now });
    expect((await restarted.status()).used).toBe(1);
    expect(await restarted.reserve({
      runId: '00000000-0000-4000-8000-000000000003', eventCount: 0,
      activationType: 'scheduled', satisfiedSlot: '2026-11-19T18:00',
    })).toMatchObject({ allowed: false, reason: 'spaced' });

    now = new Date(now.getTime() + MIN_WAKE_GAP_MS);
    await expect(restarted.reserve({
      runId: '00000000-0000-4000-8000-000000000004', eventCount: 0,
      activationType: 'scheduled', satisfiedSlot: '2026-11-19T18:00',
    })).resolves.toMatchObject({ allowed: true });
    await expect(restarted.reserve({
      runId: '00000000-0000-4000-8000-000000000005', eventCount: 1,
      activationType: 'event', satisfiedSlot: '2026-11-19T18:00', allowQuiet: true,
    })).resolves.toMatchObject({ allowed: false, reason: 'daily_cap' });
    now = new Date(now.getTime() + MIN_WAKE_GAP_MS);
    await expect(restarted.reserve({
      runId: '00000000-0000-4000-8000-000000000006', eventCount: 1,
      activationType: 'event', satisfiedSlot: '2026-11-19T18:00', allowQuiet: true,
    })).resolves.toMatchObject({ allowed: false, reason: 'daily_cap' });
  });

  it('lets an event consume an early slot at night but keeps scheduled work in quiet hours off', async () => {
    const now = new Date('2026-11-19T00:30:00.000Z');
    const queue = createMemoryEventQueueStore();
    const proactive = createMemoryProactiveStore(owner);
    await proactive.settings.patch({ backgroundTurnsPerDay: 1 });
    const slots = createPiBackgroundSlotService({ queue, proactive, now: () => now });
    await expect(slots.reserve({
      runId: '00000000-0000-4000-8000-000000000007', eventCount: 0,
      activationType: 'scheduled', satisfiedSlot: '2026-11-19T07:00',
    })).resolves.toMatchObject({ allowed: false, reason: 'quiet_hours' });
    await expect(slots.reserve({
      runId: '00000000-0000-4000-8000-000000000008', eventCount: 1,
      activationType: 'event', satisfiedSlot: '2026-11-19T07:00', allowQuiet: true,
    })).resolves.toMatchObject({ allowed: true });
    await expect(slots.status()).resolves.toMatchObject({ used: 1, allowed: 1, remaining: 0 });
  });

  it('atomically lets only one concurrent activation reserve the final daily slot', async () => {
    const now = new Date('2026-11-19T09:00:00.000Z');
    const queue = createMemoryEventQueueStore();
    const proactive = createMemoryProactiveStore(owner);
    await proactive.settings.patch({ backgroundTurnsPerDay: 1 });
    const slots = createPiBackgroundSlotService({ queue, proactive, now: () => now });
    const results = await Promise.all(['00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000022']
      .map((runId) => slots.reserve({
        runId, eventCount: 1, activationType: 'event', allowQuiet: true,
      })));

    expect(results.filter(({ allowed }) => allowed)).toHaveLength(1);
    expect(results.filter(({ allowed, reason }) => !allowed && reason === 'daily_cap')).toHaveLength(1);
    await expect(slots.status()).resolves.toMatchObject({ used: 1, remaining: 0 });
  });

  it('keeps persisted spacing across Copenhagen midnight after restart', async () => {
    let now = new Date('2026-11-19T22:55:00.000Z');
    const queue = createMemoryEventQueueStore();
    const proactive = createMemoryProactiveStore(owner);
    const before = createPiBackgroundSlotService({ queue, proactive, now: () => now });
    await before.reserve({
      runId: '00000000-0000-4000-8000-000000000009',
      eventCount: 1,
      activationType: 'event',
      satisfiedSlot: '2026-11-20T07:00',
      allowQuiet: true,
    });
    now = new Date('2026-11-19T23:01:00.000Z');
    const afterRestart = createPiBackgroundSlotService({ queue, proactive, now: () => now });
    await expect(afterRestart.reserve({
      runId: '00000000-0000-4000-8000-000000000010',
      eventCount: 1,
      activationType: 'event',
      satisfiedSlot: '2026-11-20T07:00',
      allowQuiet: true,
    })).resolves.toMatchObject({ allowed: false, reason: 'spaced' });
  });
});
