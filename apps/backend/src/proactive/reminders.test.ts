import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FindingsStoredContext } from './engine.js';
import { createMemoryAlertLedgerStore } from './alert-ledger.js';
import { createMemoryProactiveReminderStore, type PlannedReminder } from './reminder-store.js';
import { createMemoryProactiveStore } from './store.js';
import { createTodoReminderPlanner, reminderDedupeKey, reminderKey, reminderTitle } from './reminders.js';
import { createReminderTicker } from './reminder-ticker.js';
import { dayKey, localDateTimeInstant, localTimeLabel } from './time.js';
import { deterministicDedupeKey } from './detect.js';
import { proactiveAlertKey } from './alerts.js';
import { buildPushPayload } from './push-delivery.js';
import type { SystemPushOutcome, SystemPushRequest } from './push-delivery.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-20T08:00:00.000Z');
const subscription = {
  id: '33333333-3333-4333-8333-333333333333',
  endpoint: 'https://push.example.test/device/synthetic',
  p256dh: 'synthetic',
  auth: 'synthetic',
};
const stopTickers: (() => Promise<void>)[] = [];

function context(facts: FindingsStoredContext['facts'] = [], overrides: Partial<FindingsStoredContext> = {}): FindingsStoredContext {
  return {
    runId: RUN,
    trigger: 'manual',
    now: NOW,
    signal: new AbortController().signal,
    findings: [],
    facts,
    sources: [{ id: 'todos', state: 'ok' }],
    ...overrides,
  };
}

function fact(text: string, dueAt: string | null, dueHasTime = true): FindingsStoredContext['facts'][number] {
  return {
    ref: `todo:${text}`,
    source: 'todos',
    kind: 'todo',
    text,
    dueAt,
    dueHasTime,
  };
}

function planned(text: string, dueAt: Date, overrides: Partial<PlannedReminder> = {}): PlannedReminder {
  const iso = dueAt.toISOString();
  return {
    reminderKey: reminderKey(text, iso),
    deadlineAlertKey: null,
    fireAt: new Date(dueAt.getTime() - 60 * 60_000),
    dueAt,
    title: text,
    plannedRunId: RUN,
    ...overrides,
  };
}

function todoText(text: string, dueAt: Date): string {
  return `- [ ] ${text} 📅 ${dayKey(dueAt)} ${localTimeLabel(dueAt)} [priority:: P1 - High]`;
}

function fixture(options: {
  at?: Date;
  content?: string;
  subscriptions?: typeof subscription[];
  send?: (request: SystemPushRequest, signal: AbortSignal) => Promise<SystemPushOutcome>;
  ledger?: ReturnType<typeof createMemoryAlertLedgerStore>;
  conversation?: () => Promise<string[]>;
} = {}) {
  let at = new Date(options.at ?? NOW);
  let content = options.content ?? '';
  const store = createMemoryProactiveStore(OWNER);
  vi.spyOn(store.settings, 'read');
  vi.spyOn(store.items, 'upsertFinding');
  const reminders = createMemoryProactiveReminderStore(OWNER);
  vi.spyOn(reminders, 'listDue');
  vi.spyOn(reminders, 'earliestPendingFireAt');
  vi.spyOn(reminders, 'countSent');
  vi.spyOn(reminders, 'updatePending');
  const vault = {
    tree: vi.fn(async () => [{ path: 'tasks.md', sha: '0'.repeat(40) }]),
    read: vi.fn(async () => ({ path: 'tasks.md', sha: '0'.repeat(40), content })),
  };
  const pushStore = {
    listSubscriptions: vi.fn(async () => options.subscriptions ?? [subscription]),
    updateItemDelivery: vi.fn(async () => {}),
  };
  const send = vi.fn(options.send ?? (async () => ({
    status: 'sent', reason: null, attempted: 1, accepted: 1, statusCode: 202,
  } satisfies SystemPushOutcome)));
  const ledger = options.ledger ?? createMemoryAlertLedgerStore(() => new Date(at));
  vi.spyOn(ledger, 'get');
  const logger = { info: vi.fn(), warn: vi.fn() };
  const ticker = createReminderTicker({
    store,
    reminders,
    vault,
    pushStore,
    ledger,
    ownerObjectId: OWNER,
    send,
    ...(options.conversation ? { conversationStore: { readRecentUserMessages: options.conversation } } : {}),
    now: () => new Date(at),
    logger,
  });
  stopTickers.push(() => ticker.stop());
  return {
    store, reminders, vault, pushStore, send, ledger, logger, ticker,
    now: () => new Date(at),
    setNow(value: Date) { at = new Date(value); },
    setContent(value: string) { content = value; },
  };
}

async function addRows(store: ReturnType<typeof createMemoryProactiveReminderStore>, rows: PlannedReminder[], now = NOW) {
  const result = await store.plan(rows, now);
  return result.inserted;
}

async function startWith(fixtureValue: ReturnType<typeof fixture>, rows: PlannedReminder[]) {
  await addRows(fixtureValue.reminders, rows, fixtureValue.now());
  await fixtureValue.ticker.start();
}

afterEach(async () => {
  await Promise.all(stopTickers.splice(0).map((stop) => stop()));
});

describe('todo reminder planning', () => {
  it('plans only timed todos within 48 hours, including the exact boundary', async () => {
    const reminders = createMemoryProactiveReminderStore(OWNER);
    const planner = createTodoReminderPlanner({
      store: createMemoryProactiveStore(OWNER),
      reminders,
      now: () => NOW,
    });
    const due = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
    await planner(context([
      fact('Synthetic timed task', due(60)),
      fact('Synthetic date only', due(120), false),
      { ...fact('Synthetic other source', due(180)), kind: 'event' },
      fact('Synthetic exact boundary', due(48 * 60)),
      fact('Synthetic outside boundary', due(48 * 60 + 1)),
      fact('Synthetic invalid', 'invalid'),
      fact('Synthetic no due', null),
      fact('\n\t', due(240)),
    ]));
    const rows = reminders.snapshot();
    expect(rows.map(({ title }) => title)).toEqual(['Synthetic timed task', 'Synthetic exact boundary']);
    expect(rows[0]).toMatchObject({
      fireAt: new Date(NOW.getTime()),
      dueAt: new Date(NOW.getTime() + 60 * 60_000),
      reminderKey: reminderKey('Synthetic timed task', due(60)),
      plannedRunId: RUN,
    });
  });

  it('links to the same deadline alert key and wakes the ticker with the earliest inserted time', async () => {
    const reminders = createMemoryProactiveReminderStore(OWNER);
    const wake = vi.fn();
    const planner = createTodoReminderPlanner({
      store: createMemoryProactiveStore(OWNER),
      reminders,
      now: () => NOW,
      onPlanned: wake,
    });
    const dueAt = new Date(NOW.getTime() + 2 * 60 * 60_000);
    await planner(context([fact('Synthetic identity', dueAt.toISOString())]));
    const row = reminders.snapshot()[0]!;
    expect(row.deadlineAlertKey).toMatch(/^[\da-f]{32}$/u);
    expect(row.deadlineAlertKey).toBe(proactiveAlertKey(
      'deadline_24h', deterministicDedupeKey('deadline', 'Synthetic identity', dueAt.toISOString()),
    ));
    expect(wake).toHaveBeenCalledOnce();
    expect(wake).toHaveBeenCalledWith(row.fireAt);
  });

  it('gates paused, aborted and unavailable-source planning without cancelling rows', async () => {
    const store = createMemoryProactiveStore(OWNER);
    const reminders = createMemoryProactiveReminderStore(OWNER);
    const candidate = planned('Synthetic retained', new Date(NOW.getTime() + 2 * 60 * 60_000));
    const existing = (await reminders.plan([candidate], NOW)).inserted[0]!;
    await reminders.updatePending(existing.id, { state: 'cancelled', reason: 'todo_changed' });
    const plan = vi.spyOn(reminders, 'plan');
    const planner = createTodoReminderPlanner({ store, reminders, now: () => NOW });
    await store.settings.patch({ paused: true });
    await planner(context([fact('Synthetic paused', candidate.dueAt.toISOString())]));
    await store.settings.patch({ paused: false });
    await planner(context([fact('Synthetic unavailable', candidate.dueAt.toISOString())], {
      sources: [{ id: 'todos', state: 'unavailable' }],
    }));
    const controller = new AbortController();
    controller.abort();
    await planner(context([fact('Synthetic aborted', candidate.dueAt.toISOString())], { signal: controller.signal }));
    expect(plan).not.toHaveBeenCalled();
    expect(reminders.snapshot()[0]).toMatchObject({ state: 'cancelled', reason: 'todo_changed' });
  });

  it('never changes an existing reminder in any state and enforces both planning caps', async () => {
    const reminders = createMemoryProactiveReminderStore(OWNER);
    const states = ['pending', 'sent', 'cancelled', 'expired', 'failed', 'suppressed'] as const;
    for (const [index, state] of states.entries()) {
      const row = (await reminders.plan([
        planned(`Synthetic state ${state}`, new Date(NOW.getTime() + (index + 2) * 60_000)),
      ], NOW)).inserted[0]!;
      if (state !== 'pending') await reminders.updatePending(row.id, { state, reason: 'synthetic_reason' });
    }
    const before = reminders.snapshot();
    const untouched = await reminders.plan(before.map((row) => ({
      reminderKey: row.reminderKey,
      deadlineAlertKey: row.deadlineAlertKey,
      fireAt: row.fireAt,
      dueAt: row.dueAt,
      title: 'Synthetic changed title',
      plannedRunId: '55555555-5555-4555-8555-555555555555',
    })), NOW);
    expect(untouched.inserted).toEqual([]);
    expect(reminders.snapshot()).toEqual(before);

    const twentyOne = Array.from({ length: 21 }, (_, index) =>
      planned(`Synthetic batch ${index}`, new Date(NOW.getTime() + (index + 1) * 60_000)));
    const cappedRun = await reminders.plan(twentyOne, NOW);
    expect(cappedRun.inserted).toHaveLength(20);
    expect(cappedRun.capSkipped).toBe(1);

    const full = createMemoryProactiveReminderStore(OWNER);
    for (let batch = 0; batch < 5; batch += 1) {
      await full.plan(Array.from({ length: 20 }, (_, index) =>
        planned(`Synthetic pending ${batch * 20 + index}`, new Date(NOW.getTime() + 60_000))), NOW);
    }
    const pendingCap = await full.plan([planned('Synthetic over pending cap', new Date(NOW.getTime() + 60_000))], NOW);
    expect(pendingCap.inserted).toEqual([]);
    expect(pendingCap.capSkipped).toBe(1);
    expect(full.snapshot().filter(({ state }) => state === 'pending')).toHaveLength(100);
  });

  it('purges terminal rows older than 30 days and still plans during quiet hours', async () => {
    const reminders = createMemoryProactiveReminderStore(OWNER);
    const old = new Date(NOW.getTime() - 31 * 24 * 60 * 60_000);
    const row = (await reminders.plan([
      planned('Synthetic old terminal', new Date(old.getTime() + 2 * 60 * 60_000)),
    ], old)).inserted[0]!;
    await reminders.updatePending(row.id, { state: 'expired' });
    const quietNow = localDateTimeInstant('2026-10-20', '02:00');
    const planner = createTodoReminderPlanner({
      store: createMemoryProactiveStore(OWNER),
      reminders,
      now: () => quietNow,
    });
    const dueAt = new Date(quietNow.getTime() + 2 * 60 * 60_000);
    await planner(context([fact('Synthetic night planning', dueAt.toISOString())], { now: quietNow }));
    expect(reminders.snapshot().some(({ title }) => title === 'Synthetic old terminal')).toBe(false);
    expect(reminders.snapshot().some(({ title }) => title === 'Synthetic night planning')).toBe(true);
  });

  it('sanitizes private titles to one line, controls removed, and an nvarchar-safe code-point boundary', () => {
    expect(reminderTitle('  Synthetic\u0000\n\t task   title  ')).toBe('Synthetic task title');
    expect(reminderTitle('x'.repeat(200))).toBe('x'.repeat(80));
    expect(reminderTitle(`${'x'.repeat(79)}🧪suffix`)).toBe('x'.repeat(79));
    expect(reminderTitle(`${'x'.repeat(78)}🧪suffix`)).toBe(`${'x'.repeat(78)}🧪`);
    expect(reminderTitle('\u0000\n\t ')).toBe('');
  });
});

describe('todo reminder ticker', () => {
  it('does no idle reads, writes, vault work or network calls after its one startup read', async () => {
    const idle = fixture();
    await idle.ticker.start();
    const reads = vi.mocked(idle.reminders.earliestPendingFireAt);
    reads.mockClear();
    for (let count = 0; count < 40; count += 1) await idle.ticker.tick();
    expect(reads).not.toHaveBeenCalled();
    expect(idle.reminders.listDue).not.toHaveBeenCalled();
    expect(idle.store.settings.read).not.toHaveBeenCalled();
    expect(idle.vault.tree).not.toHaveBeenCalled();
    expect(idle.pushStore.listSubscriptions).not.toHaveBeenCalled();
    expect(idle.pushStore.updateItemDelivery).not.toHaveBeenCalled();
    expect(idle.reminders.countSent).not.toHaveBeenCalled();
    expect(idle.reminders.updatePending).not.toHaveBeenCalled();
    expect(idle.ledger.get).not.toHaveBeenCalled();
    expect(idle.store.items.upsertFinding).not.toHaveBeenCalled();
    expect(idle.send).not.toHaveBeenCalled();

    const quiet = fixture({ at: localDateTimeInstant('2026-10-20', '22:00') });
    const dueAt = localDateTimeInstant('2026-10-21', '06:30');
    await startWith(quiet, [planned('Synthetic quiet reminder', dueAt)]);
    const refresh = vi.mocked(quiet.reminders.earliestPendingFireAt);
    refresh.mockClear();
    for (let minute = 0; minute < 540; minute += 1) {
      quiet.setNow(new Date(localDateTimeInstant('2026-10-20', '22:00').getTime() + minute * 60_000));
      await quiet.ticker.tick();
    }
    expect(refresh).not.toHaveBeenCalled();
    expect(quiet.reminders.listDue).not.toHaveBeenCalled();
    expect(quiet.vault.tree).not.toHaveBeenCalled();
    expect(quiet.pushStore.listSubscriptions).not.toHaveBeenCalled();
    expect(quiet.send).not.toHaveBeenCalled();
    expect(quiet.store.settings.read).not.toHaveBeenCalled();
    expect(quiet.reminders.countSent).not.toHaveBeenCalled();
    expect(quiet.reminders.updatePending).not.toHaveBeenCalled();
  });

  it('refreshes the earliest pending time once after processing rows and backs off five minutes on errors', async () => {
    const current = fixture();
    const dueAt = new Date(NOW.getTime() + 60 * 60_000);
    const row = planned('Synthetic refresh', dueAt);
    current.setContent(todoText(row.title, row.dueAt));
    await startWith(current, [row]);
    const earliest = vi.mocked(current.reminders.earliestPendingFireAt);
    earliest.mockClear();
    await current.ticker.tick();
    expect(earliest).toHaveBeenCalledOnce();

    const failed = fixture();
    const failedDue = new Date(NOW.getTime() + 60 * 60_000);
    await startWith(failed, [planned('Synthetic failure', failedDue)]);
    const listDue = vi.spyOn(failed.reminders, 'listDue').mockRejectedValue(new Error('synthetic'));
    failed.setNow(new Date(NOW.getTime() + 1));
    await failed.ticker.tick();
    expect(failed.ticker.nextWakeAt).toEqual(new Date(failed.now().getTime() + 5 * 60_000));
    listDue.mockClear();
    await failed.ticker.tick();
    expect(listDue).not.toHaveBeenCalled();
  });

  it('expires rows before pause suppression, and suppresses paused or unsubscribed rows terminally', async () => {
    const paused = fixture();
    const late = planned('Synthetic expired', new Date(NOW.getTime() - 25 * 60 * 60_000));
    const remaining = planned('Synthetic paused', new Date(NOW.getTime() + 60_000));
    await paused.store.settings.patch({ paused: true });
    await startWith(paused, [late, remaining]);
    paused.setNow(new Date(NOW.getTime() + 1));
    await paused.ticker.tick();
    expect(paused.reminders.snapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ reminderKey: late.reminderKey, state: 'expired', reason: 'too_late' }),
      expect.objectContaining({ reminderKey: remaining.reminderKey, state: 'suppressed', reason: 'paused' }),
    ]));
    expect(paused.pushStore.listSubscriptions).not.toHaveBeenCalled();

    const unsubscribed = fixture({ subscriptions: [] });
    const row = planned('Synthetic unsubscribed', new Date(NOW.getTime() + 60_000));
    await startWith(unsubscribed, [row]);
    unsubscribed.setNow(new Date(NOW.getTime() + 1));
    await unsubscribed.ticker.tick();
    expect(unsubscribed.reminders.snapshot()[0]).toMatchObject({
      state: 'suppressed', reason: 'no_subscription',
    });
    expect(unsubscribed.vault.tree).not.toHaveBeenCalled();
  });

  it('verifies open todos and creates a private idempotent item with a generic push', async () => {
    const current = fixture({
      conversation: async () => ['I have a synthetic task'],
    });
    const dueAt = new Date(NOW.getTime() + 30 * 60_000);
    const row = planned('Synthetic item title', dueAt);
    current.setContent(todoText(row.title, dueAt));
    await startWith(current, [row]);
    current.setNow(new Date(NOW.getTime() + 1));
    await current.ticker.tick();
    const savedRows = current.reminders.snapshot();
    expect(savedRows[0]).toMatchObject({ state: 'sent', itemId: expect.any(String), sentDayKey: dayKey(current.now()) });
    const item = await current.store.items.get(savedRows[0]!.itemId!);
    expect(item).toMatchObject({
      kind: 'finding',
      category: 'todo',
      urgency: 'time_critical',
      title: 'Synthetic item title',
      body: 'Due at 10:30',
      dueAt: dueAt.toISOString(),
      state: 'new',
      language: 'en',
      runId: null,
      evidence: [{ source: 'todos', label: 'Todo list', observedAt: current.now().toISOString() }],
    });
    expect(reminderDedupeKey(row.reminderKey)).toMatch(/^[\da-f]{32}$/u);
    expect(current.send).toHaveBeenCalledWith({
      kind: 'due_soon', count: 1, language: 'en', itemId: item!.id, origin: 'proactive_reminder',
    }, expect.any(AbortSignal));
    expect(current.pushStore.updateItemDelivery).toHaveBeenCalledWith(item!.id, 'accepted', 202);
    await current.store.items.upsertFinding({
      dedupeKey: reminderDedupeKey(row.reminderKey), title: 'Synthetic retry title', body: 'Synthetic retry body',
      category: 'todo', urgency: 'time_critical', dueAt: dueAt.toISOString(), evidence: [],
      runId: null, language: 'en',
    });
    expect(await current.store.items.list('all', 10, current.now())).toHaveLength(1);
  });

  it('uses fixed localized bodies, including an overdue todo from yesterday', async () => {
    const danishNow = localDateTimeInstant('2026-10-20', '08:00');
    const danish = fixture({
      at: danishNow,
      conversation: async () => ['Jeg har en opgave og den er klar'],
    });
    const dueSoon = localDateTimeInstant('2026-10-20', '09:00');
    const danishRow = planned('Synthetic Danish item', dueSoon);
    danish.setContent(todoText(danishRow.title, dueSoon));
    await startWith(danish, [danishRow]);
    await danish.ticker.tick();
    const daItem = (await danish.store.items.list('all', 10, danish.now()))[0]!;
    expect(daItem).toMatchObject({ language: 'da', body: 'Forfalder kl. 09:00' });

    const yesterdayNow = localDateTimeInstant('2026-10-21', '07:00');
    const yesterday = fixture({ at: yesterdayNow });
    const dueYesterday = localDateTimeInstant('2026-10-20', '23:30');
    const yesterdayRow = planned('Synthetic yesterday item', dueYesterday);
    yesterday.setContent(todoText(yesterdayRow.title, dueYesterday));
    await startWith(yesterday, [yesterdayRow]);
    await yesterday.ticker.tick();
    const enItem = (await yesterday.store.items.list('all', 10, yesterday.now()))[0]!;
    expect(enItem).toMatchObject({ language: 'en', body: 'Was due yesterday at 23:30' });
  });

  it.each([
    ['completed', '- [x] Synthetic matching task 📅 2026-10-20 11:00 [priority:: P1 - High]'],
    ['retimed', '- [ ] Synthetic matching task 📅 2026-10-20 12:00 [priority:: P1 - High]'],
    ['deleted', ''],
    ['same text, different time', '- [ ] Synthetic matching task 📅 2026-10-20 12:00 [priority:: P1 - High]'],
    ['priority removed', '- [ ] Synthetic matching task 📅 2026-10-20 11:00'],
    ['priority lowered', '- [ ] Synthetic matching task 📅 2026-10-20 11:00 [priority:: P2 - Medium]'],
  ])('cancels a %s todo without sending', async (_description, content) => {
    const current = fixture({ content });
    const row = planned('Synthetic matching task', new Date('2026-10-20T09:00:00.000Z'));
    await startWith(current, [row]);
    current.setNow(new Date('2026-10-20T08:00:01.000Z'));
    await current.ticker.tick();
    expect(current.reminders.snapshot()[0]).toMatchObject({ state: 'cancelled', reason: 'todo_changed' });
    expect(current.send).not.toHaveBeenCalled();
  });

  it('retries failed verification twice then suppresses without sending an unverified task', async () => {
    const current = fixture();
    const row = planned('Synthetic unverified task', new Date(NOW.getTime() + 30 * 60_000));
    current.vault.tree.mockRejectedValue(new Error('synthetic vault failure'));
    await startWith(current, [row]);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      current.setNow(new Date(NOW.getTime() + (attempt - 1) * 5 * 60_000 + 1));
      await current.ticker.tick();
      if (attempt < 3) {
        expect(current.reminders.snapshot()[0]).toMatchObject({
          state: 'pending', verifyAttempts: attempt,
          fireAt: new Date(NOW.getTime() + attempt * 5 * 60_000 + 1),
        });
      }
    }
    expect(current.reminders.snapshot()[0]).toMatchObject({
      state: 'suppressed', verifyAttempts: 3, reason: 'unverified',
    });
    expect(current.send).not.toHaveBeenCalled();
  });

  it('suppresses only deadline alerts sent within two hours', async () => {
    let ledgerTime = new Date(NOW);
    const ledger = createMemoryAlertLedgerStore(() => ledgerTime);
    const current = fixture({ ledger });
    const recent = planned('Synthetic recent alert', new Date(NOW.getTime() + 60 * 60_000), {
      deadlineAlertKey: 'a'.repeat(32),
    });
    const earlier = planned('Synthetic older alert', new Date(NOW.getTime() + 61 * 60_000), {
      deadlineAlertKey: 'b'.repeat(32),
    });
    current.setContent([todoText(recent.title, recent.dueAt), todoText(earlier.title, earlier.dueAt)].join('\n'));
    ledgerTime = new Date(NOW.getTime() - 119 * 60_000);
    await current.ledger.upsert({
      alertKey: recent.deadlineAlertKey!, class: 'deadline_24h', itemId: randomUUID(),
      runId: RUN, dayKey: dayKey(NOW), status: 'sent', reason: null,
    });
    const past = new Date(NOW.getTime() - 121 * 60_000);
    ledgerTime = past;
    await current.ledger.upsert({
      alertKey: earlier.deadlineAlertKey!, class: 'deadline_24h', itemId: randomUUID(),
      runId: RUN, dayKey: dayKey(past), status: 'sent', reason: null,
    });
    ledgerTime = new Date(NOW);
    const inserted = await addRows(current.reminders, [recent, earlier]);
    await current.ticker.start();
    current.setNow(new Date(NOW.getTime() + 1));
    await current.ticker.tick();
    expect(current.reminders.snapshot().find(({ id }) => id === inserted[0]!.id))
      .toMatchObject({ state: 'suppressed', reason: 'already_alerted' });
    current.setNow(new Date(NOW.getTime() + 61_000));
    await current.ticker.tick();
    expect(current.reminders.snapshot().find(({ id }) => id === inserted[1]!.id)?.state).toBe('sent');
    expect(current.send).toHaveBeenCalledOnce();
  });

  it('enforces eight sent reminders per Copenhagen day and selects due-order rows', async () => {
    const now = localDateTimeInstant('2026-10-21', '08:00');
    const current = fixture({ at: now });
    const previousDay = localDateTimeInstant('2026-10-20', '23:45');
    const today = localDateTimeInstant('2026-10-21', '01:30');
    const already = await addRows(current.reminders, Array.from({ length: 7 }, (_, index) =>
      planned(`Synthetic sent ${index}`, new Date(now.getTime() + 60 * 60_000))), now);
    for (const row of already) await current.reminders.updatePending(row.id, {
      state: 'sent', sentDayKey: dayKey(now),
    });
    const yesterday = await addRows(current.reminders, [
      planned('Synthetic previous-day sent', new Date(previousDay)),
    ], now);
    await current.reminders.updatePending(yesterday[0]!.id, {
      state: 'sent', sentDayKey: dayKey(previousDay),
    });
    const first = planned('Synthetic earlier due', previousDay);
    const second = planned('Synthetic later due', today);
    current.setContent([todoText(first.title, first.dueAt), todoText(second.title, second.dueAt)].join('\n'));
    const rows = await addRows(current.reminders, [first, second], now);
    await current.ticker.start();
    await current.ticker.tick();
    expect(current.reminders.snapshot().find(({ id }) => id === rows[0]!.id)?.state).toBe('sent');
    expect(current.reminders.snapshot().find(({ id }) => id === rows[1]!.id))
      .toMatchObject({ state: 'suppressed', reason: 'daily_cap' });
    expect(await current.reminders.countSent(dayKey(now))).toBe(8);
  });

  it.each([
    { dueOffsets: [30, 60], kind: 'due_soon' },
    { dueOffsets: [-60, -30], kind: 'overdue' },
    { dueOffsets: [-30, 30], kind: 'mixed' },
  ] as const)('bundles due reminders as $kind', async ({ dueOffsets, kind }) => {
    const current = fixture();
    const rows = dueOffsets.map((offset, index) => {
      const dueAt = new Date(NOW.getTime() + offset * 60_000);
      return planned(`Synthetic bundle ${index}`, dueAt);
    });
    current.setContent(rows.map((row) => todoText(row.title, row.dueAt)).join('\n'));
    await startWith(current, rows);
    await current.ticker.tick();
    expect(current.send).toHaveBeenCalledWith(expect.objectContaining({
      kind, count: rows.length, itemId: expect.any(String), origin: 'proactive_reminder',
    }), expect.any(AbortSignal));
  });

  it.each([
    { day: '2026-10-20', dueTime: '06:30', expected: 'overdue' },
    { day: '2026-10-20', dueTime: '07:30', expected: 'due_soon' },
    { day: '2026-10-25', dueTime: '06:30', expected: 'overdue' },
    { day: '2026-10-25', dueTime: '07:30', expected: 'due_soon' },
    { day: '2027-03-28', dueTime: '06:30', expected: 'overdue' },
    { day: '2027-03-28', dueTime: '07:30', expected: 'due_soon' },
  ])('holds a $dueTime reminder until 07:00 on $day as $expected', async ({ day, dueTime, expected }) => {
    const previousDay = new Date(Date.parse(`${day}T12:00:00.000Z`) - 24 * 60 * 60_000).toISOString().slice(0, 10);
    const quietStart = localDateTimeInstant(previousDay, '22:00');
    const dueAt = localDateTimeInstant(day, dueTime);
    const current = fixture({ at: quietStart });
    const row = planned(`Synthetic held ${day} ${dueTime}`, dueAt);
    current.setContent(todoText(row.title, dueAt));
    await startWith(current, [row]);
    await current.ticker.tick();
    expect(current.send).not.toHaveBeenCalled();
    current.setNow(localDateTimeInstant(day, '07:00'));
    await current.ticker.tick();
    expect(current.send).toHaveBeenCalledWith(expect.objectContaining({ kind: expected }), expect.any(AbortSignal));
  });

  it('records one send retry, then terminal failure, and leaves quiet-hour skips pending', async () => {
    const outcomes: SystemPushOutcome[] = [
      { status: 'failed', reason: 'provider_unavailable', attempted: 1, accepted: 0, statusCode: 503 },
      { status: 'failed', reason: 'provider_unavailable', attempted: 1, accepted: 0, statusCode: 503 },
    ];
    const current = fixture({ send: async () => outcomes.shift()! });
    const row = planned('Synthetic failed send', new Date(NOW.getTime() + 30 * 60_000));
    current.setContent(todoText(row.title, row.dueAt));
    await startWith(current, [row]);
    await current.ticker.tick();
    expect(current.reminders.snapshot()[0]).toMatchObject({ state: 'pending', sendAttempts: 1 });
    expect(current.pushStore.updateItemDelivery).toHaveBeenCalledWith(expect.any(String), 'failed', 503);
    current.setNow(new Date(NOW.getTime() + 5 * 60_000 + 1));
    await current.ticker.tick();
    expect(current.reminders.snapshot()[0]).toMatchObject({
      state: 'failed', sendAttempts: 2, reason: 'provider_unavailable',
    });

    const skipped = fixture({
      send: async () => ({
        status: 'skipped', reason: 'quiet_hours', attempted: 0, accepted: 0, statusCode: null,
      }),
    });
    const skippedRow = planned('Synthetic quiet skip', new Date(NOW.getTime() + 30 * 60_000));
    skipped.setContent(todoText(skippedRow.title, skippedRow.dueAt));
    await startWith(skipped, [skippedRow]);
    await skipped.ticker.tick();
    expect(skipped.reminders.snapshot()[0]).toMatchObject({ state: 'pending', sendAttempts: 0 });
    expect(skipped.pushStore.updateItemDelivery).not.toHaveBeenCalled();
  });

  it('keeps canary todo text out of push requests and logs', async () => {
    const canary = 'SYNTHETIC_PRIVATE_CANARY_89d2';
    const current = fixture();
    const row = planned(canary, new Date(NOW.getTime() + 30 * 60_000));
    current.setContent(todoText(canary, row.dueAt));
    await startWith(current, [row]);
    await current.ticker.tick();
    expect(JSON.stringify(current.send.mock.calls)).not.toContain(canary);
    expect(buildPushPayload(current.send.mock.calls[0]![0]).toString()).not.toContain(canary);
    expect(JSON.stringify(current.logger.info.mock.calls)).not.toContain(canary);
    expect(JSON.stringify(current.logger.warn.mock.calls)).not.toContain(canary);
    expect(current.reminders.snapshot()[0]?.title).toBe(canary);
    expect((await current.store.items.list('all', 10, NOW))[0]?.title).toBe(canary);
  });
});
