import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryProactiveStore } from './store.js';
import { createMemoryProactiveReminderStore } from './reminder-store.js';
import { createMemoryAlertLedgerStore } from './alert-ledger.js';
import { reminderKey } from './reminders.js';
import { createReminderTicker } from './reminder-ticker.js';
import { buildPushPayload, type SystemPushRequest } from './push-delivery.js';
import { dayKey, localTimeLabel } from './time.js';

const now = new Date('2026-10-20T08:00:00Z');
const owner = '11111111-1111-4111-8111-111111111111';
const stoppers: (() => Promise<void>)[] = [];

async function setup(language: 'en' | 'da', throws = false) {
  const store = createMemoryProactiveStore(owner);
  const reminders = createMemoryProactiveReminderStore(owner);
  const rows = [50, 10, 40, 20, 30].map((minutes) => {
    const dueAt = new Date(now.getTime() + minutes * 60_000);
    const title = `Synthetic private task ${minutes}`;
    return {
      reminderKey: reminderKey(title, dueAt.toISOString()),
      deadlineAlertKey: null,
      // Deliberately use a different fire order from due order.
      fireAt: new Date(now.getTime() - minutes * 60_000),
      dueAt, title, plannedRunId: null,
    };
  });
  await reminders.plan(rows, now);
  const content = rows.map(({ title, dueAt }) =>
    `- [ ] ${title} 📅 ${dayKey(dueAt)} ${localTimeLabel(dueAt)} 🔺`).join('\n');
  const send = vi.fn(async (request: SystemPushRequest) => {
    if (throws) throw new Error(request.details![0]!.title);
    return { status: 'sent' as const, reason: null, attempted: 1, accepted: 1, statusCode: 201 };
  });
  const logger = { info: vi.fn(), warn: vi.fn() };
  const update = vi.spyOn(reminders, 'updatePending');
  const pushStore = {
    listSubscriptions: vi.fn(async () => [{ id: owner, endpoint: 'https://push.example.test/synthetic', p256dh: 'synthetic', auth: 'synthetic' }]),
    updateItemDelivery: vi.fn(async () => {}),
  };
  const ticker = createReminderTicker({
    store, reminders, pushStore, ownerObjectId: owner,
    vault: {
      tree: async () => [{ path: 'tasks.md', sha: 'synthetic' }],
      read: async () => ({ path: 'tasks.md', sha: 'synthetic', content }),
    },
    ledger: createMemoryAlertLedgerStore(),
    conversationStore: { readRecentUserMessages: async () => language === 'da' ? ['Jeg har en opgave i morgen'] : ['I have a task tomorrow'] },
    now: () => new Date(now), send, logger,
  });
  stoppers.push(() => ticker.stop());
  await ticker.start();
  return { ticker, send, logger, rows, update, pushStore, reminders };
}

afterEach(async () => {
  await Promise.all(stoppers.splice(0).map((stop) => stop()));
});

describe('reminder ticker push details', () => {
  it.each(['en', 'da'] as const)('sends only the soonest three row titles and due times with the full %s count', async (language) => {
    const fixture = await setup(language);
    await fixture.ticker.tick();
    const request = fixture.send.mock.calls[0]![0];
    expect(request).toMatchObject({
      kind: 'due_soon', count: 5, language, origin: 'proactive_reminder',
      details: [...fixture.rows].sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())
        .slice(0, 3).map(({ title, dueAt }) => ({ title, dueAt: dueAt.toISOString() })),
    });
    expect(JSON.parse(buildPushPayload(request, now).toString()).body).toBe([
      '10:10 Synthetic private task 10',
      '10:20 Synthetic private task 20',
      '10:30 Synthetic private task 30',
      `+2 ${language === 'da' ? 'flere' : 'more'}`,
    ].join('\n'));
    expect(fixture.reminders.snapshot().every(({ state }) => state === 'sent')).toBe(true);
    const telemetry = JSON.stringify({
      logs: [fixture.logger.info.mock.calls, fixture.logger.warn.mock.calls],
      updates: fixture.update.mock.calls, delivery: fixture.pushStore.updateItemDelivery.mock.calls,
    });
    expect(telemetry).not.toContain('Synthetic private task');
    expect(telemetry).not.toContain('"details"');
  });

  it('contains a thrown detail-bearing sender error without logging or persisting content', async () => {
    const fixture = await setup('en', true);
    await expect(fixture.ticker.tick()).resolves.toBeUndefined();
    expect(fixture.send).toHaveBeenCalledOnce();
    expect(fixture.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'internal_error' }), 'proactive.reminder_tick');
    expect(JSON.stringify([fixture.logger.info.mock.calls, fixture.logger.warn.mock.calls])).not.toContain('Synthetic private task');
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.pushStore.updateItemDelivery).not.toHaveBeenCalled();
    expect(fixture.reminders.snapshot().every(({ state }) => state === 'pending')).toBe(true);
  });
});
