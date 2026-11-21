import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  ApprovalNotificationStore,
  StoredApprovalNotificationRegistration,
} from '../database/approval-notification-store.js';
import type { ApprovalNotificationSender } from '../push/approval-notifications.js';
import { ownerReminderApnsFixtures } from './owner-reminder-apns.testkit.js';
import { createMemoryOwnerReminderStore } from './owner-reminder-store.js';
import { createNativeProactiveDelivery } from './native-delivery.js';
import type { SystemPushRequest } from './push-delivery.js';

const owner = randomUUID();
const registration: StoredApprovalNotificationRegistration = {
  registrationId: randomUUID(),
  deviceToken: 'ab'.repeat(32),
  showActions: true,
  timeZone: 'Europe/Copenhagen',
};
const now = new Date('2026-11-20T10:00:00.000Z');

async function setup(sender: ApprovalNotificationSender) {
  let clock = new Date(now);
  const store = createMemoryOwnerReminderStore({
    nativeRecipients: () => [{
      registrationId: registration.registrationId,
      deviceToken: registration.deviceToken,
    }],
  });
  const { schedule } = await store.create({
    idempotencyKey: 'a'.repeat(64),
    taskIdentity: 'b'.repeat(64),
    taskTitle: 'Send the final draft',
    fireAt: now,
    localTime: '11:00',
    anchorDate: null,
    cadence: null,
    untilTaskDone: false,
  }, new Date(now.getTime() - 300_000));
  const [claimed] = await store.claimDue(now, 1, 120_000);
  if (!claimed?.claimToken) throw new Error('Missing owner reminder claim');
  const invalidated = vi.fn(async () => {});
  const registrations: ApprovalNotificationStore = {
    async upsert() { return 'saved'; },
    async list() { return [registration]; },
    async remove() {},
    invalidate: invalidated,
  };
  const delivery = createNativeProactiveDelivery(
    owner,
    { store: registrations, sender },
    () => new Date(clock),
    store,
  );
  const request: SystemPushRequest = {
    kind: 'owner_reminder',
    ownerRequested: true,
    count: 1,
    itemId: randomUUID(),
    origin: 'proactive_reminder',
    details: [{ title: 'Send the final draft', dueAt: null }],
    ownerReminderDelivery: {
      scheduleId: schedule.id,
      claimToken: claimed.claimToken,
      occurrenceAt: schedule.fireAt,
      notificationId: `reminder-${'c'.repeat(48)}`,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    },
  };
  return {
    store,
    schedule,
    delivery,
    request,
    invalidated,
    advance: (value: Date) => { clock = new Date(value); },
  };
}

describe('durable native owner reminder delivery', () => {
  it.each(ownerReminderApnsFixtures)('$name', async (fixture) => {
    const send = vi.fn<ApprovalNotificationSender['send']>(async () => {
      if (fixture.throws) throw new Error('fixture transport reset');
      return fixture.result!;
    });
    const { store, delivery, request, invalidated } = await setup({ send });
    const outcome = await delivery.send(request, new AbortController().signal);

    expect(outcome).toMatchObject({
      status: fixture.retry ? 'failed' : fixture.expectedState === 'accepted' ? 'sent' : 'failed',
      attempted: 1,
      accepted: fixture.expectedState === 'accepted' ? 1 : 0,
    });
    expect(outcome?.deliveryEvidence).toMatchObject({
      recipientCount: 1,
      attemptCount: 1,
      providerOutcome: fixture.retry ? 'provider_unavailable'
        : fixture.expectedState === 'accepted' ? 'provider_accepted' : fixture.expectedReason,
    });
    expect(store.deliverySnapshot()[0]).toMatchObject({
      state: fixture.expectedState,
      lastResult: fixture.expectedReason,
      attemptCount: 1,
    });
    expect(send.mock.calls[0]?.[4]).toBe(request.ownerReminderDelivery!.notificationId);
    expect(invalidated).toHaveBeenCalledTimes(fixture.expectedState === 'invalid_token' ? 1 : 0);
    const payload = JSON.parse(send.mock.calls[0]![1].toString('utf8')) as {
      proactiveItemID: string;
      ownerReminderID: string;
    };
    expect(payload).toMatchObject({
      proactiveItemID: request.itemId,
      ownerReminderID: request.ownerReminderDelivery!.scheduleId,
    });
  });

  it('caps transient APNs retries and preserves the same collapse identity', async () => {
    const send = vi.fn<ApprovalNotificationSender['send']>(async () => ({
      accepted: false,
      invalidToken: false,
      retryable: true,
      statusCode: 503,
    }));
    const { store, schedule, delivery, request, advance } = await setup({ send });
    const first = await delivery.send(request, new AbortController().signal);
    const retryAt = first?.deliveryEvidence?.nextAttemptAt;
    expect(retryAt?.toISOString()).toBe('2026-11-20T10:05:00.000Z');
    const current = (await store.get(schedule.id))!;
    await store.finishClaim(schedule.id, current.claimToken!, {
      state: 'retrying',
      nextAttemptAt: retryAt!,
      sendAttempts: 1,
      lastDelivery: 'retrying',
    });

    const [retryClaim] = await store.claimDue(retryAt!, 1, 120_000);
    advance(retryAt!);
    const second = await delivery.send({
      ...request,
      ownerReminderDelivery: {
        ...request.ownerReminderDelivery!,
        claimToken: retryClaim!.claimToken!,
      },
    }, new AbortController().signal);

    expect(second).toMatchObject({
      status: 'failed',
      reason: 'retry_exhausted',
      attempted: 1,
      accepted: 0,
    });
    expect(store.deliverySnapshot()[0]).toMatchObject({
      state: 'failed',
      attemptCount: 2,
      lastResult: 'retry_exhausted',
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((call) => call[4]))
      .toEqual([request.ownerReminderDelivery!.notificationId, request.ownerReminderDelivery!.notificationId]);
  });

  it('recovers an accepted-but-unpersisted APNs result without choosing a new identity', async () => {
    const send = vi.fn<ApprovalNotificationSender['send']>(async () => ({
      accepted: true,
      invalidToken: false,
      statusCode: 200,
    }));
    const { store, delivery, request, advance } = await setup({ send });
    vi.spyOn(store, 'acceptedNativeDelivery').mockRejectedValueOnce(new Error('fixture SQL write failed'));

    const first = await delivery.send(request, new AbortController().signal);
    expect(first).toMatchObject({
      status: 'skipped',
      reason: 'delivery_evidence_unavailable',
    });
    expect(store.deliverySnapshot()[0]?.state).toBe('sending');

    const recoveredAt = new Date(now.getTime() + 120_001);
    const [recovered] = await store.claimDue(
      recoveredAt,
      1,
      120_000,
    );
    advance(recoveredAt);
    const second = await delivery.send({
      ...request,
      ownerReminderDelivery: {
        ...request.ownerReminderDelivery!,
        claimToken: recovered!.claimToken!,
      },
    }, new AbortController().signal);
    expect(second).toMatchObject({ status: 'sent', accepted: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[4]).toBe(send.mock.calls[1]?.[4]);
    expect(store.deliverySnapshot()[0]).toMatchObject({
      state: 'accepted',
      lastResult: 'provider_accepted',
    });
  });

  it('does not resend an APNs row already accepted when the schedule claim is restarted', async () => {
    const send = vi.fn<ApprovalNotificationSender['send']>(async () => ({
      accepted: true,
      invalidToken: false,
      statusCode: 200,
    }));
    const { store, delivery, request, advance } = await setup({ send });
    expect(await delivery.send(
      request,
      new AbortController().signal,
    )).toMatchObject({ status: 'sent' });
    const restartedAt = new Date(now.getTime() + 120_001);
    const [restarted] = await store.claimDue(restartedAt, 1, 120_000);
    advance(restartedAt);
    expect(await delivery.send({
      ...request,
      ownerReminderDelivery: {
        ...request.ownerReminderDelivery!,
        claimToken: restarted!.claimToken!,
      },
    }, new AbortController().signal)).toMatchObject({
      status: 'sent',
      accepted: 1,
      attempted: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
