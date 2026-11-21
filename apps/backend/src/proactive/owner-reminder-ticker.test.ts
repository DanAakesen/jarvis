import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryProactiveStore } from './store.js';
import { createMemoryProactiveReminderStore } from './reminder-store.js';
import { createMemoryOwnerReminderStore, type OwnerReminderDeliverySummary } from './owner-reminder-store.js';
import { createReminderTicker, type ReminderTickerLogger } from './reminder-ticker.js';
import { readVaultTasks } from './todo-discovery.js';
import type { SystemPushOutcome, SystemPushRequest } from './push-delivery.js';
import { createMemoryEventQueueStore } from './events/event-queue.js';
import type { ProactiveEventInput, ProactiveEventSink } from './events/types.js';

const owner = randomUUID();
const title = 'Send the final draft';

function taskVault(done = false, stableId = 'owner-ticker-task') {
  const path = 'Personal/Tasks.md';
  const content = `- [${done ? 'x' : ' '}] ${title} 🆔 ${stableId}`;
  return {
    tree: async () => [{ path, sha: 'task-sha', size: Buffer.byteLength(content) }],
    read: async () => ({ path, sha: 'task-sha', content }),
  };
}

const acceptedEvidence: OwnerReminderDeliverySummary = {
  evidenceAvailable: true,
  recipientCount: 1,
  acceptedRecipientCount: 1,
  pendingRecipientCount: 0,
  attemptCount: 1,
  providerOutcome: 'provider_accepted',
  providerStatusCode: 200,
  nextAttemptAt: null,
};

async function setup(options: {
  now: Date;
  recipients?: boolean;
  outcome?: SystemPushOutcome;
  done?: boolean;
  stableId?: string;
  taskIdentity?: string;
  events?: ProactiveEventSink;
  logger?: ReminderTickerLogger;
}) {
  const clock = { at: new Date(options.now) };
  const current = () => new Date(clock.at);
  const proactive = createMemoryProactiveStore(owner, current);
  const reminders = createMemoryProactiveReminderStore(owner);
  const ownerReminders = createMemoryOwnerReminderStore();
  const vault = taskVault(options.done, options.stableId);
  const [task] = await readVaultTasks(vault as never, AbortSignal.timeout(1_000));
  const { schedule } = await ownerReminders.create({
    idempotencyKey: 'a'.repeat(64),
    taskIdentity: options.taskIdentity ?? task!.taskIdentity,
    taskTitle: title,
    fireAt: options.now,
    localTime: '11:00',
    anchorDate: null,
    cadence: null,
    untilTaskDone: false,
  }, new Date(options.now.getTime() - 300_000));
  const pushes: SystemPushRequest[] = [];
  const send = vi.fn(async (request: SystemPushRequest) => {
    pushes.push(request);
    return options.outcome ?? {
      status: 'sent',
      reason: null,
      attempted: 1,
      accepted: 1,
      statusCode: 200,
      deliveryEvidence: acceptedEvidence,
      providerOutcome: 'provider_accepted',
    };
  });
  const updateItemDelivery = vi.fn(async () => {});
  const ticker = createReminderTicker({
    store: proactive,
    reminders,
    ownerReminders,
    vault: vault as never,
    pushStore: {
      listSubscriptions: async () => [],
      updateItemDelivery,
    },
    hasNativeRecipients: async () => options.recipients !== false,
    ownerObjectId: owner,
    send,
    ...(options.events ? { events: options.events } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    now: current,
  });
  await ticker.start();
  return {
    ticker,
    ownerReminders,
    schedule,
    pushes,
    send,
    updateItemDelivery,
    advance: (milliseconds: number) => { clock.at = new Date(clock.at.getTime() + milliseconds); },
  };
}

describe('owner reminder ticker delivery boundary', () => {
  it('fires an explicit reminder during quiet hours and records provider acceptance separately', async () => {
    const fixture = await setup({ now: new Date('2026-11-20T21:00:00.000Z') });
    try {
      await fixture.ticker.tick();
      expect(fixture.send).toHaveBeenCalledTimes(1);
      expect(fixture.pushes[0]).toMatchObject({
        kind: 'owner_reminder',
        ownerRequested: true,
        ownerReminderDelivery: {
          scheduleId: fixture.schedule.id,
          occurrenceAt: fixture.schedule.fireAt,
        },
      });
      expect(fixture.pushes[0]?.ownerReminderDelivery?.notificationId)
        .toMatch(/^reminder-[a-f0-9]{48}$/u);
      expect(await fixture.ownerReminders.get(fixture.schedule.id)).toMatchObject({
        state: 'completed',
        reason: null,
        sendAttempts: 1,
        lastDelivery: 'provider_accepted',
        lastProviderOutcome: 'provider_accepted',
        lastProviderStatusCode: 200,
        recipientCount: 1,
        acceptedRecipientCount: 1,
        nextAttemptAt: null,
      });
      expect(fixture.updateItemDelivery).toHaveBeenCalledWith(
        expect.any(String),
        'accepted',
        200,
      );
    } finally {
      await fixture.ticker.stop();
    }
  });

  it('keeps the original fire time while persisting a bounded next retry', async () => {
    const fireAt = new Date('2026-11-20T10:00:00.000Z');
    const retryAt = new Date('2026-11-20T10:05:00.000Z');
    const fixture = await setup({
      now: fireAt,
      outcome: {
        status: 'failed',
        reason: 'provider_unavailable',
        attempted: 1,
        accepted: 0,
        statusCode: 503,
        providerOutcome: 'provider_unavailable',
        deliveryEvidence: {
          evidenceAvailable: true,
          recipientCount: 1,
          acceptedRecipientCount: 0,
          pendingRecipientCount: 1,
          attemptCount: 1,
          providerOutcome: 'provider_unavailable',
          providerStatusCode: 503,
          nextAttemptAt: retryAt,
        },
      },
    });
    try {
      await fixture.ticker.tick();
      expect(await fixture.ownerReminders.get(fixture.schedule.id)).toMatchObject({
        state: 'retrying',
        fireAt,
        nextAttemptAt: retryAt,
        sendAttempts: 1,
        reason: 'provider_unavailable',
        lastDelivery: 'retrying',
        lastProviderOutcome: 'provider_unavailable',
        lastProviderStatusCode: 503,
      });
      expect(fixture.ticker.nextWakeAt).toEqual(retryAt);
    } finally {
      await fixture.ticker.stop();
    }
  });

  it('records task disappearance and no-recipient outcomes without invoking APNs', async () => {
    const missing = await setup({
      now: new Date('2026-11-20T10:00:00.000Z'),
      stableId: 'owner-ticker-task',
      taskIdentity: 'f'.repeat(64),
    });
    try {
      await missing.ticker.tick();
      expect(await missing.ownerReminders.get(missing.schedule.id)).toMatchObject({
        state: 'cancelled',
        reason: 'task_missing',
      });
      expect(missing.send).not.toHaveBeenCalled();
    } finally {
      await missing.ticker.stop();
    }

    const noRecipient = await setup({
      now: new Date('2026-11-20T10:30:00.000Z'),
      recipients: false,
    });
    try {
      await noRecipient.ticker.tick();
      expect(await noRecipient.ownerReminders.get(noRecipient.schedule.id)).toMatchObject({
        state: 'suppressed',
        reason: 'no_subscription',
        lastDelivery: 'suppressed',
        lastProviderOutcome: 'no_subscription',
        recipientCount: 0,
        sendAttempts: 0,
      });
      expect(noRecipient.send).not.toHaveBeenCalled();
    } finally {
      await noRecipient.ticker.stop();
    }
  });
});

describe('owner reminder delivery failure signal', () => {
  const fireAt = new Date('2026-11-20T10:00:00.000Z');
  const retryAt = new Date(fireAt.getTime() + 300_000);
  const evidence = (overrides: Partial<OwnerReminderDeliverySummary>): OwnerReminderDeliverySummary => ({
    evidenceAvailable: true,
    recipientCount: 1,
    acceptedRecipientCount: 0,
    pendingRecipientCount: 0,
    attemptCount: 1,
    providerOutcome: 'provider_rejected',
    providerStatusCode: 400,
    nextAttemptAt: null,
    ...overrides,
  });
  const rejected: SystemPushOutcome = {
    status: 'failed',
    reason: 'provider_rejected',
    attempted: 1,
    accepted: 0,
    statusCode: 400,
    providerOutcome: 'provider_rejected',
    deliveryEvidence: evidence({}),
  };
  const unavailable: SystemPushOutcome = {
    status: 'failed',
    reason: 'provider_unavailable',
    attempted: 1,
    accepted: 0,
    statusCode: 503,
    providerOutcome: 'provider_unavailable',
    deliveryEvidence: evidence({
      pendingRecipientCount: 1, providerOutcome: 'provider_unavailable', providerStatusCode: 503, nextAttemptAt: retryAt,
    }),
  };
  const queueSink = () => {
    const queue = createMemoryEventQueueStore();
    const inserted: boolean[] = [];
    const sink = {
      enqueue: vi.fn(async (event: ProactiveEventInput) => { inserted.push((await queue.enqueue(event, fireAt)).inserted); }),
    };
    return { queue, inserted, sink };
  };

  it('tells the queue once when delivery ended without a device, with the reminder as identity', async () => {
    const { queue, sink } = queueSink();
    const fixture = await setup({ now: fireAt, outcome: rejected, events: sink });
    try {
      await fixture.ticker.tick();
      expect(await fixture.ownerReminders.get(fixture.schedule.id)).toMatchObject({ state: 'failed', reason: 'provider_rejected' });
      expect(sink.enqueue).toHaveBeenCalledTimes(1);
      const [event] = await queue.claim(fireAt, 10, 60_000);
      expect(event).toMatchObject({
        source: 'reminder',
        kind: 'reminder.delivery_failed',
        identity: `reminder:${fixture.schedule.id}`,
        detail: {
          reminderId: fixture.schedule.id,
          occurrenceAt: fireAt.toISOString(),
          reason: 'provider_rejected',
          providerOutcome: 'provider_rejected',
          attempts: 1,
          recipients: 1,
          accepted: 0,
        },
      });
      expect(event!.summary).toContain(title);
      expect(event!.summary.length).toBeLessThanOrEqual(400);

      // Nothing claims the failed reminder again, and the same failure offered twice is one event.
      await fixture.ticker.tick();
      expect(sink.enqueue).toHaveBeenCalledTimes(1);
      expect((await queue.enqueue(sink.enqueue.mock.calls[0]![0], fireAt)).inserted).toBe(false);
    } finally {
      await fixture.ticker.stop();
    }
  });

  it('waits for the retry to fail as well before it says so', async () => {
    const { sink } = queueSink();
    const fixture = await setup({ now: fireAt, outcome: unavailable, events: sink });
    try {
      await fixture.ticker.tick();
      expect(await fixture.ownerReminders.get(fixture.schedule.id)).toMatchObject({ state: 'retrying' });
      expect(sink.enqueue).not.toHaveBeenCalled();

      fixture.advance(300_000);
      fixture.send.mockResolvedValueOnce({
        ...unavailable,
        reason: 'retry_exhausted',
        providerOutcome: 'retry_exhausted',
        deliveryEvidence: evidence({
          attemptCount: 2, providerOutcome: 'retry_exhausted', providerStatusCode: 503,
        }),
      });
      await fixture.ticker.tick();
      expect(await fixture.ownerReminders.get(fixture.schedule.id)).toMatchObject({
        state: 'failed', reason: 'retries_exhausted', sendAttempts: 2,
      });
      expect(sink.enqueue).toHaveBeenCalledTimes(1);
      expect(sink.enqueue.mock.calls[0]![0].detail).toMatchObject({ reason: 'retries_exhausted', attempts: 2 });
    } finally {
      await fixture.ticker.stop();
    }
  });

  it('stays quiet when the push was accepted or there was no device to try', async () => {
    const accepted = queueSink();
    const sent = await setup({ now: fireAt, events: accepted.sink });
    const none = queueSink();
    const noDevice = await setup({ now: fireAt, recipients: false, events: none.sink });
    try {
      await sent.ticker.tick();
      await noDevice.ticker.tick();
      expect(await sent.ownerReminders.get(sent.schedule.id)).toMatchObject({ state: 'completed' });
      expect(await noDevice.ownerReminders.get(noDevice.schedule.id)).toMatchObject({ state: 'suppressed', reason: 'no_subscription' });
      expect(accepted.sink.enqueue).not.toHaveBeenCalled();
      expect(none.sink.enqueue).not.toHaveBeenCalled();
    } finally {
      await sent.ticker.stop();
      await noDevice.ticker.stop();
    }
  });

  it('logs a signal it could not queue and leaves the delivery result as it was', async () => {
    const warn = vi.fn();
    const fixture = await setup({
      now: fireAt,
      outcome: rejected,
      events: { enqueue: vi.fn(async () => { throw new Error('queue down'); }) },
      logger: { warn },
    });
    try {
      await fixture.ticker.tick();
      expect(await fixture.ownerReminders.get(fixture.schedule.id)).toMatchObject({ state: 'failed', reason: 'provider_rejected' });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'delivery_failed_event_unavailable' }),
        'proactive.reminder_tick',
      );
    } finally {
      await fixture.ticker.stop();
    }
  });
});
