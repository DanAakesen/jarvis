import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createMemoryOwnerReminderStore,
  ownerReminderRetryAt,
  summarizeOwnerReminderDeliveries,
} from './owner-reminder-store.js';

const at = new Date('2026-11-20T10:00:00.000Z');

describe('owner reminder delivery state', () => {
  it('keeps schedule creation separate from delivery and exposes an exact retry time', async () => {
    const store = createMemoryOwnerReminderStore();
    const { schedule } = await store.create({
      idempotencyKey: 'a'.repeat(64),
      taskIdentity: 'b'.repeat(64),
      taskTitle: 'Prepare the train tickets',
      fireAt: at,
      localTime: '11:00',
      anchorDate: null,
      cadence: null,
      untilTaskDone: false,
    }, new Date(at.getTime() - 300_000));

    expect(schedule).toMatchObject({
      state: 'scheduled',
      sendAttempts: 0,
      recipientCount: 0,
      acceptedRecipientCount: 0,
      lastDelivery: null,
      lastProviderOutcome: null,
    });
    const [claimed] = await store.claimDue(at, 1, 60_000);
    expect(claimed).toMatchObject({ state: 'sending', sendAttempts: 0 });
    const retryAt = ownerReminderRetryAt(1, at)!;
    await expect(store.finishClaim(schedule.id, claimed!.claimToken!, {
      state: 'retrying',
      reason: 'provider_unavailable',
      sendAttempts: 1,
      nextAttemptAt: retryAt,
      lastDelivery: 'retrying',
      lastProviderOutcome: 'provider_unavailable',
      recipientCount: 1,
      acceptedRecipientCount: 0,
    })).resolves.toBe(true);
    expect((await store.get(schedule.id))?.nextAttemptAt?.toISOString())
      .toBe('2026-11-20T10:05:00.000Z');
    expect(await store.earliestFireAt()).toEqual(retryAt);
    expect(await store.claimDue(new Date(retryAt.getTime() - 1), 1, 60_000)).toEqual([]);
    expect((await store.claimDue(retryAt, 1, 60_000))[0]).toMatchObject({
      state: 'sending',
      sendAttempts: 1,
      fireAt: at,
    });
  });

  it('bounds the retry policy at two total APNs attempts', () => {
    expect(ownerReminderRetryAt(0, at)).toBeNull();
    expect(ownerReminderRetryAt(1, at)?.toISOString()).toBe('2026-11-20T10:05:00.000Z');
    expect(ownerReminderRetryAt(2, at)).toBeNull();
  });

  it('aggregates mixed durable recipient evidence without inventing device acknowledgement', () => {
    expect(summarizeOwnerReminderDeliveries([
      {
        state: 'accepted',
        attemptCount: 1,
        lastResult: 'provider_accepted',
        lastStatusCode: 200,
        nextAttemptAt: null,
        leaseUntil: null,
        lastAttemptAt: at,
      },
      {
        state: 'invalid_token',
        attemptCount: 1,
        lastResult: 'apns_invalid_token',
        lastStatusCode: 410,
        nextAttemptAt: null,
        leaseUntil: null,
        lastAttemptAt: new Date(at.getTime() + 1),
      },
    ])).toMatchObject({
      evidenceAvailable: true,
      recipientCount: 2,
      acceptedRecipientCount: 1,
      pendingRecipientCount: 0,
      attemptCount: 1,
      providerOutcome: 'partial_acceptance',
      providerStatusCode: 410,
      nextAttemptAt: null,
    });
  });

  it('suppresses pending outbox work atomically on reschedule and cancellation', async () => {
    const registrationId = randomUUID();
    const recipients = [{ registrationId, deviceToken: 'ab'.repeat(32) }];
    const store = createMemoryOwnerReminderStore({
      nativeRecipients: () => recipients,
    });
    const { schedule } = await store.create({
      idempotencyKey: 'c'.repeat(64),
      taskIdentity: 'd'.repeat(64),
      taskTitle: 'Call the hotel',
      fireAt: at,
      localTime: '11:00',
      anchorDate: null,
      cadence: null,
      untilTaskDone: false,
    }, new Date(at.getTime() - 300_000));
    const [claimed] = await store.claimDue(at, 1, 60_000);
    await store.queueNativeDeliveries({
      scheduleId: schedule.id,
      claimToken: claimed!.claimToken!,
      occurrenceAt: schedule.fireAt,
      itemId: randomUUID(),
      notificationId: 'reminder-test',
      now: at,
      expiresAt: new Date(at.getTime() + 60 * 60_000),
    });
    recipients.push({ registrationId: randomUUID(), deviceToken: 'cd'.repeat(32) });
    const repeatedQueue = await store.queueNativeDeliveries({
      scheduleId: schedule.id,
      claimToken: claimed!.claimToken!,
      occurrenceAt: schedule.fireAt,
      itemId: randomUUID(),
      notificationId: 'reminder-late-registration',
      now: at,
      expiresAt: new Date(at.getTime() + 60 * 60_000),
    });
    expect(repeatedQueue.recipientCount).toBe(1);
    await expect(store.updateScheduled(schedule.id, {
      fireAt: new Date(at.getTime() + 60 * 60_000),
    })).resolves.toBe(false);
    const nextFireAt = new Date(at.getTime() + 60 * 60_000);
    await store.finishClaim(schedule.id, claimed!.claimToken!, { state: 'retrying',
      nextAttemptAt: new Date(at.getTime() + 300_000) });
    await expect(store.updateScheduled(schedule.id, { fireAt: nextFireAt })).resolves.toBe(true);
    expect(store.deliverySnapshot()[0]).toMatchObject({
      state: 'suppressed',
      lastResult: 'rescheduled',
    });
    const [rescheduled] = await store.claimDue(nextFireAt, 1, 60_000);
    await store.queueNativeDeliveries({
      scheduleId: schedule.id,
      claimToken: rescheduled!.claimToken!,
      occurrenceAt: nextFireAt,
      itemId: randomUUID(),
      notificationId: 'reminder-rescheduled',
      now: nextFireAt,
      expiresAt: new Date(nextFireAt.getTime() + 60 * 60_000),
    });
    await store.finishClaim(schedule.id, rescheduled!.claimToken!, {
      state: 'retrying',
      nextAttemptAt: new Date(nextFireAt.getTime() + 300_000),
    });
    expect(await store.cancel(schedule.id)).toBe(true);
    expect(store.deliverySnapshot().find(({ occurrenceAt }) =>
      occurrenceAt.getTime() === nextFireAt.getTime())).toMatchObject({
      state: 'suppressed',
      lastResult: 'cancelled',
    });
  });

  it('persists a zero-recipient snapshot so a late registration cannot join the occurrence', async () => {
    const recipients: Array<{ registrationId: string; deviceToken: string }> = [];
    const store = createMemoryOwnerReminderStore({ nativeRecipients: () => recipients });
    const { schedule } = await store.create({
      idempotencyKey: 'f'.repeat(64),
      taskIdentity: '1'.repeat(64),
      taskTitle: 'Check the train platform',
      fireAt: at,
      localTime: '11:00',
      anchorDate: null,
      cadence: null,
      untilTaskDone: false,
    }, new Date(at.getTime() - 300_000));
    const [claimed] = await store.claimDue(at, 1, 120_000);
    const input = {
      scheduleId: schedule.id,
      claimToken: claimed!.claimToken!,
      occurrenceAt: schedule.fireAt,
      itemId: randomUUID(),
      notificationId: 'reminder-empty',
      now: at,
      expiresAt: new Date(at.getTime() + 60 * 60_000),
    };
    expect(await store.queueNativeDeliveries(input)).toMatchObject({
      evidenceAvailable: false,
      recipientCount: 0,
    });
    recipients.push({ registrationId: randomUUID(), deviceToken: 'ef'.repeat(32) });
    expect(await store.queueNativeDeliveries(input)).toMatchObject({ recipientCount: 0 });
    expect(store.deliverySnapshot()).toEqual([]);
  });
});
