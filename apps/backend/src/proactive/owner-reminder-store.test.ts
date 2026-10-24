import { describe, expect, it } from 'vitest';
import { createMemoryOwnerReminderStore, type NewOwnerReminder } from './owner-reminder-store.js';

const now = new Date('2026-10-23T08:00:00.000Z');

function candidate(overrides: Partial<NewOwnerReminder> = {}): NewOwnerReminder {
  return {
    idempotencyKey: 'a'.repeat(64),
    taskIdentity: 'b'.repeat(64),
    taskTitle: 'Synthetic task',
    fireAt: new Date('2026-10-23T09:00:00.000Z'),
    localTime: '11:00',
    anchorDate: null,
    cadence: null,
    untilTaskDone: false,
    ...overrides,
  };
}

describe('owner reminder schedule store', () => {
  it('deduplicates repeated tool calls by the source owner message', async () => {
    const store = createMemoryOwnerReminderStore();
    const first = await store.create(candidate(), now);
    const duplicate = await store.create(candidate({ taskTitle: 'Synthetic changed title' }), now);

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.schedule.id).toBe(first.schedule.id);
    expect(duplicate.schedule.taskTitle).toBe('Synthetic task');
  });

  it('claims due work once, recovers an expired lease and rejects stale completion', async () => {
    const store = createMemoryOwnerReminderStore();
    await store.create(candidate(), now);
    const firstClaim = await store.claimDue(new Date('2026-10-23T09:00:00.000Z'), 20, 60_000);
    expect(firstClaim).toHaveLength(1);
    expect(await store.claimDue(new Date('2026-10-23T09:00:30.000Z'), 20, 60_000)).toEqual([]);

    const recovered = await store.claimDue(new Date('2026-10-23T09:01:00.000Z'), 20, 60_000);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.claimToken).not.toBe(firstClaim[0]!.claimToken);
    await expect(store.finishClaim(firstClaim[0]!.id, firstClaim[0]!.claimToken!, {
      state: 'completed',
      lastDelivery: 'provider_accepted',
    })).resolves.toBe(false);
    await expect(store.finishClaim(recovered[0]!.id, recovered[0]!.claimToken!, {
      state: 'completed',
      lastDelivery: 'provider_accepted',
    })).resolves.toBe(true);
    expect((await store.get(recovered[0]!.id))?.state).toBe('completed');
  });

  it('makes cancellation terminal even when a delivery claim is in flight', async () => {
    const store = createMemoryOwnerReminderStore();
    const { schedule } = await store.create(candidate(), now);
    const [claim] = await store.claimDue(new Date('2026-10-23T09:00:00.000Z'), 20, 60_000);

    expect(await store.cancel(schedule.id)).toBe(true);
    expect(await store.finishClaim(schedule.id, claim!.claimToken!, {
      state: 'completed',
      lastDelivery: 'provider_accepted',
    })).toBe(false);
    expect((await store.get(schedule.id))?.state).toBe('cancelled');
  });
});
