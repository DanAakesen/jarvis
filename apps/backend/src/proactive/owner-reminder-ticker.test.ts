import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryProactiveStore } from './store.js';
import { createMemoryOwnerReminderStore } from './owner-reminder-store.js';
import { createReminderTicker } from './reminder-ticker.js';
import { parseTodosWithContext } from './todo-file.js';
import type { SystemPushOutcome, SystemPushRequest } from './push-delivery.js';
import { createMemoryAlertLedgerStore } from './alert-ledger.js';
import { reminderKey } from './reminders.js';
import type { ReminderRow } from './reminder-store.js';

const owner = '11111111-1111-4111-8111-111111111111';
const taskPath = 'Personal/Inbox.md';
const initialTime = new Date('2026-10-20T08:00:00.000Z');
const subscription = { id: owner, endpoint: 'https://push.example.test/synthetic', p256dh: 'synthetic', auth: 'synthetic' };
const stoppers: (() => Promise<void>)[] = [];

async function fixture(options: {
  content?: string;
  fireAt?: Date;
  cadence?: 'daily' | 'weekly' | null;
  anchorDate?: string | null;
  localTime?: string;
  subscribed?: boolean;
  automatic?: ReminderRow;
  send?: (request: SystemPushRequest) => Promise<SystemPushOutcome>;
} = {}) {
  let now = new Date(options.fireAt ?? initialTime);
  let content = options.content ?? '- [ ] Synthetic task 📅 2031-01-01';
  let sha = 'a'.repeat(40);
  let path = taskPath;
  const vault = {
    tree: vi.fn(async () => [{ path, sha }]),
    read: vi.fn(async () => ({ path, sha, content })),
  };
  const parsed = parseTodosWithContext(content, taskPath)[0]!;
  const updateAutomatic = vi.fn(async () => false);
  const schedules = createMemoryOwnerReminderStore();
  await schedules.create({
    idempotencyKey: 'a'.repeat(64),
    taskIdentity: parsed.taskIdentity,
    taskTitle: parsed.text,
    fireAt: new Date(options.fireAt ?? initialTime),
    localTime: options.localTime ?? '10:00',
    anchorDate: options.anchorDate ?? (options.cadence ? '2026-10-20' : null),
    cadence: options.cadence ?? null,
    untilTaskDone: options.cadence !== undefined && options.cadence !== null,
  }, new Date(initialTime.getTime() - 60_000));
  const store = createMemoryProactiveStore(owner);
  await store.settings.patch({
    paused: true, sources: { todos: false }, categories: { todo: false }, suggestionScope: 'work',
  });
  const send = vi.fn(async (request: SystemPushRequest) => options.send
    ? options.send(request)
    : { status: 'sent', reason: null, attempted: 1, accepted: 1, statusCode: 201 } satisfies SystemPushOutcome);
  const pushStore = {
    listSubscriptions: vi.fn(async () => options.subscribed === false ? [] : [subscription]),
    updateItemDelivery: vi.fn(async () => {}),
  };
  const ticker = createReminderTicker({
    store,
    reminders: {
      async plan() { return { inserted: [], capSkipped: 0, purged: 0 }; },
      async earliestPendingFireAt() { return options.automatic?.fireAt ?? null; },
      async listDue() { return options.automatic ? [options.automatic] : []; },
      async countSent() { return 0; },
      updatePending: updateAutomatic,
    },
    ownerReminders: schedules,
    vault,
    pushStore,
    ledger: createMemoryAlertLedgerStore(),
    ownerObjectId: owner,
    send,
    now: () => new Date(now),
  });
  await ticker.start();
  stoppers.push(() => ticker.stop());
  return {
    ticker, store, schedules, send, pushStore, vault, updateAutomatic,
    setNow(value: Date) { now = new Date(value); },
    setTask(value: string) { content = value; sha = `${sha.slice(0, -1)}b`; },
    setPath(value: string) { path = value; sha = `${sha.slice(0, -1)}c`; },
  };
}

afterEach(async () => { await Promise.all(stoppers.splice(0).map((stop) => stop())); });

describe('owner reminder ticker', () => {
  it('sends an explicit low-priority date-only task reminder independently of proactive preferences', async () => {
    const f = await fixture();
    await f.ticker.tick();

    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]![0]).toMatchObject({
      kind: 'owner_reminder',
      origin: 'proactive_reminder',
      details: [{ title: 'Synthetic task', dueAt: null }],
    });
    expect(await f.store.items.get(f.send.mock.calls[0]![0].itemId)).toMatchObject({ ownerRequested: true });
    expect(f.schedules.snapshot()[0]).toMatchObject({ state: 'completed', lastDelivery: 'provider_accepted' });
    expect(f.pushStore.updateItemDelivery).toHaveBeenCalledWith(expect.any(String), 'accepted', 201);
    expect(f.store.items).toBeDefined();
  });

  it('suppresses a same-task automatic reminder at the explicit schedule time', async () => {
    const fireAt = new Date('2026-10-20T07:00:00.000Z');
    const dueAt = new Date('2026-10-20T08:00:00.000Z');
    const content = '- [ ] Synthetic task 🔺 📅 2026-10-20 10:00';
    const parsed = parseTodosWithContext(content, taskPath)[0]!;
    const automatic: ReminderRow = {
      id: '22222222-2222-4222-8222-222222222222',
      reminderKey: reminderKey(parsed.text, dueAt.toISOString()),
      deadlineAlertKey: null,
      fireAt,
      dueAt,
      title: parsed.text,
      plannedRunId: null,
      state: 'pending',
      reason: null,
      verifyAttempts: 0,
      sendAttempts: 0,
      itemId: null,
      sentDayKey: null,
      createdAt: new Date(initialTime),
      updatedAt: new Date(initialTime),
    };
    const f = await fixture({
      content,
      fireAt,
      localTime: '09:00',
      automatic,
    });
    await f.store.settings.patch({
      paused: false, sources: { todos: true }, categories: { todo: true }, suggestionScope: 'all',
    });
    await f.ticker.tick();

    expect(f.send).toHaveBeenCalledOnce();
    expect(f.updateAutomatic).toHaveBeenCalledWith(automatic.id, {
      state: 'suppressed',
      reason: 'already_alerted',
    });
  });

  it('repeats on Copenhagen calendar days and stops once the stable task identity is completed', async () => {
    const f = await fixture({
      content: '- [ ] Original title 🆔 stable-123 📅 2031-01-01',
      cadence: 'daily',
      localTime: '10:00',
    });
    await f.ticker.tick();
    expect(f.schedules.snapshot()[0]).toMatchObject({
      state: 'scheduled',
      taskTitle: 'Original title',
      fireAt: new Date('2026-10-21T08:00:00.000Z'),
    });
    f.setTask('- [x] Renamed after completion 🆔 STABLE-123');
    f.setNow(new Date('2026-10-21T08:00:00.000Z'));
    await f.ticker.tick();
    expect(f.schedules.snapshot()[0]).toMatchObject({ state: 'cancelled', reason: 'task_completed' });
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('keeps a stable task reminder through an Obsidian sync rename and move', async () => {
    const f = await fixture({ content: '- [ ] Original title 🆔 move-123' });
    f.setTask('- [ ] Updated task wording 🆔 MOVE-123 📅 2031-02-01');
    f.setPath('Work/Other.md');
    await f.ticker.tick();
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.schedules.snapshot()[0]).toMatchObject({ state: 'completed', taskTitle: 'Updated task wording' });
  });

  it('cancels deleted and ambiguous task identities without sending', async () => {
    const deleted = await fixture();
    deleted.setTask('# Empty');
    await deleted.ticker.tick();
    expect(deleted.schedules.snapshot()[0]).toMatchObject({ state: 'cancelled', reason: 'task_missing' });
    expect(deleted.send).not.toHaveBeenCalled();

    const ambiguous = await fixture({
      content: '- [ ] Synthetic task 📅 2031-01-01\n- [ ] Synthetic task 📅 2031-01-02',
    });
    await ambiguous.ticker.tick();
    expect(ambiguous.schedules.snapshot()[0]).toMatchObject({ state: 'cancelled', reason: 'task_ambiguous' });
    expect(ambiguous.send).not.toHaveBeenCalled();
  });

  it('reuses the same claimed due row across concurrent tickers', async () => {
    const f = await fixture();
    const second = createReminderTicker({
      store: f.store,
      reminders: {
        async plan() { return { inserted: [], capSkipped: 0, purged: 0 }; },
        async earliestPendingFireAt() { return null; },
        async listDue() { return []; },
        async countSent() { return 0; },
        async updatePending() { return false; },
      },
      ownerReminders: f.schedules,
      vault: f.vault,
      pushStore: f.pushStore,
      ledger: createMemoryAlertLedgerStore(),
      ownerObjectId: owner,
      send: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { status: 'sent', reason: null, attempted: 1, accepted: 1, statusCode: 201 };
      },
      now: () => new Date(initialTime),
    });
    await second.start();
    stoppers.push(() => second.stop());
    await Promise.all([f.ticker.tick(), second.tick()]);
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('suppresses a due schedule without a subscription and keeps device acknowledgement unknown', async () => {
    const f = await fixture({ subscribed: false });
    await f.ticker.tick();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.schedules.snapshot()[0]).toMatchObject({ state: 'suppressed', reason: 'no_subscription' });
    expect(f.pushStore.updateItemDelivery).not.toHaveBeenCalled();
  });

  it('recovers an expired delivery lease after restart without creating another schedule', async () => {
    const f = await fixture();
    await f.schedules.claimDue(initialTime, 20, 60_000);
    f.setNow(new Date(initialTime.getTime() + 60_000));
    const restarted = createReminderTicker({
      store: f.store,
      reminders: {
        async plan() { return { inserted: [], capSkipped: 0, purged: 0 }; },
        async earliestPendingFireAt() { return null; },
        async listDue() { return []; },
        async countSent() { return 0; },
        async updatePending() { return false; },
      },
      ownerReminders: f.schedules,
      vault: f.vault,
      pushStore: f.pushStore,
      ledger: createMemoryAlertLedgerStore(),
      ownerObjectId: owner,
      send: f.send,
      now: () => new Date(initialTime.getTime() + 60_000),
    });
    await restarted.start();
    stoppers.push(() => restarted.stop());
    await restarted.tick();
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.schedules.snapshot()).toHaveLength(1);
    expect(f.schedules.snapshot()[0]?.state).toBe('completed');
  });

  it('keeps weekly calendar time across the autumn overlap and skips a nonexistent spring occurrence', async () => {
    const autumn = await fixture({
      fireAt: new Date('2026-10-24T00:30:00.000Z'),
      cadence: 'weekly',
      anchorDate: '2026-10-24',
      localTime: '02:30',
    });
    autumn.setNow(new Date('2026-10-24T05:30:00.000Z'));
    await autumn.ticker.tick();
    expect(autumn.schedules.snapshot()[0]?.fireAt.toISOString()).toBe('2026-10-31T01:30:00.000Z');

    const spring = await fixture({
      fireAt: new Date('2027-03-27T01:30:00.000Z'),
      cadence: 'daily',
      anchorDate: '2027-03-27',
      localTime: '02:30',
    });
    spring.setNow(new Date('2027-03-27T06:30:00.000Z'));
    await spring.ticker.tick();
    expect(spring.schedules.snapshot()[0]?.fireAt.toISOString()).toBe('2027-03-29T00:30:00.000Z');
  });

  it('bounds provider retries and leaves an explicit terminal failure after the retry', async () => {
    const f = await fixture({
      send: async () => ({ status: 'failed', reason: 'provider_unavailable', attempted: 1, accepted: 0, statusCode: 503 }),
    });
    await f.ticker.tick();
    expect(f.schedules.snapshot()[0]).toMatchObject({ state: 'scheduled', sendAttempts: 1, lastDelivery: 'failed' });
    f.setNow(new Date(initialTime.getTime() + 5 * 60_000));
    await f.ticker.tick();
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.schedules.snapshot()[0]).toMatchObject({ state: 'failed', reason: 'retries_exhausted', sendAttempts: 2 });
  });
});
