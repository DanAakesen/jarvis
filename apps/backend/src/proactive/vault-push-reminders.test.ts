import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTodosSource } from './sources/todos.js';
import { createMemoryProactiveReminderStore } from './reminder-store.js';
import { createMemoryProactiveStore } from './store.js';
import { createVaultPushReminderPass } from './vault-push-reminders.js';
import { dayKey, localTimeLabel } from './time.js';
import { createTodoReminderPlanner } from './reminders.js';

const stopPasses: (() => Promise<void>)[] = [];

function todoLine(text: string, dueAt: Date): string {
  return `- [ ] ${text} 📅 ${dayKey(dueAt)} ${localTimeLabel(dueAt)} [priority:: P1 - High]`;
}

function fixture(at = new Date('2026-10-20T08:30:00.000Z'), content = '', clock?: () => Date) {
  const store = createMemoryProactiveStore();
  const reminders = createMemoryProactiveReminderStore();
  const hash = createHash('sha1').update(content).digest('hex');
  const vault = {
    tree: vi.fn(async () => [{ path: 'task.md', sha: hash }]),
    read: vi.fn(async () => ({ path: 'task.md', sha: hash, content })),
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const wake = vi.fn();
  const todos = createTodosSource(vault);
  const pass = createVaultPushReminderPass({
    store,
    reminders,
    todos,
    now: clock ?? (() => new Date(at)),
    onPlanned: wake,
    logger,
  });
  stopPasses.push(() => pass.stop());
  return { store, reminders, vault, logger, wake, todos, pass };
}

afterEach(async () => {
  await Promise.all(stopPasses.splice(0).map((stop) => stop()));
  vi.useRealTimers();
});

describe('vault-push todo reminder planning', () => {
  it('plans after fire time but before due and hands the past fire time to the ticker', async () => {
    const dueAt = new Date('2026-10-20T09:00:00.000Z');
    const test = fixture(new Date('2026-10-20T08:30:00.000Z'), todoLine('Synthetic task', dueAt));
    test.pass.trigger();
    await vi.waitFor(() => expect(test.reminders.snapshot()).toHaveLength(1));
    expect(test.reminders.snapshot()[0]).toMatchObject({
      state: 'pending',
      plannedRunId: null,
      fireAt: new Date('2026-10-20T08:00:00.000Z'),
      dueAt,
    });
    expect(test.wake).toHaveBeenCalledWith(new Date('2026-10-20T08:00:00.000Z'));
    expect(test.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runId: null, reason: 'vault_push_planned', count: 1 }),
      'proactive.reminder_plan',
    );
    const settings = await test.store.settings.read();
    const source = await test.todos.read({
      now: new Date('2026-10-20T08:30:00.000Z'),
      signal: new AbortController().signal,
      settings,
    });
    const scheduledPlanner = createTodoReminderPlanner({
      store: test.store,
      reminders: test.reminders,
      now: () => new Date('2026-10-20T08:30:00.000Z'),
    });
    await scheduledPlanner({
      runId: '44444444-4444-4444-8444-444444444444',
      trigger: 'scheduled',
      now: new Date('2026-10-20T08:30:00.000Z'),
      signal: new AbortController().signal,
      findings: [],
      facts: source.facts.map((item) => ({
        ...item,
        source: 'todos' as const,
      })),
      sources: [{ id: 'todos', state: source.state }],
    });
    expect(test.reminders.snapshot()).toHaveLength(1);
    expect(test.reminders.snapshot()[0]?.plannedRunId).toBeNull();
  });

  it('does not plan a task whose due time has passed', async () => {
    const dueAt = new Date('2026-10-20T08:00:00.000Z');
    const test = fixture(new Date('2026-10-20T08:30:00.000Z'), todoLine('Synthetic overdue task', dueAt));
    test.pass.trigger();
    await vi.waitFor(() => expect(test.vault.tree).toHaveBeenCalledOnce());
    expect(test.reminders.snapshot()).toEqual([]);
    expect(test.wake).not.toHaveBeenCalled();
  });

  it.each([
    { reason: 'vault_push_paused', paused: true, enabled: true, at: '2026-10-20T08:30:00.000Z' },
    { reason: 'vault_push_todos_disabled', paused: false, enabled: false, at: '2026-10-20T08:30:00.000Z' },
    { reason: 'vault_push_quiet_hours', paused: false, enabled: true, at: '2026-10-20T21:30:00.000Z' },
  ])('does not read the vault when gated by $reason', async ({ reason, paused, enabled, at }) => {
    const test = fixture(new Date(at), todoLine('Synthetic gated task', new Date('2026-10-20T10:00:00.000Z')));
    await test.store.settings.patch({ paused, sources: { todos: enabled } });
    test.pass.trigger();
    await vi.waitFor(() => expect(test.logger.info).toHaveBeenCalled());
    expect(test.vault.tree).not.toHaveBeenCalled();
    expect(test.vault.read).not.toHaveBeenCalled();
    expect(test.reminders.snapshot()).toEqual([]);
    expect(test.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runId: null, reason }),
      'proactive.reminder_plan',
    );
  });

  it('coalesces repeated triggers and enforces the minimum pass start gap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T08:30:00.000Z'));
    const test = fixture(new Date(), '', () => new Date());
    let releaseSettings!: () => void;
    const originalRead = test.store.settings.read.bind(test.store.settings);
    vi.spyOn(test.store.settings, 'read').mockImplementationOnce(() =>
      new Promise<void>((resolve) => { releaseSettings = resolve; })
        .then(() => originalRead()),
    );
    test.pass.trigger();
    test.pass.trigger();
    test.pass.trigger();
    releaseSettings();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.vault.tree).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    test.pass.trigger();
    await vi.advanceTimersByTimeAsync(54_999);
    expect(test.vault.tree).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(test.vault.tree).toHaveBeenCalledTimes(2);
  });

  it('aborts an in-progress vault read when stopped', async () => {
    const test = fixture(new Date('2026-10-20T08:30:00.000Z'), '');
    test.vault.tree.mockImplementation(() => new Promise(() => {}));
    test.pass.trigger();
    await vi.waitFor(() => expect(test.vault.tree).toHaveBeenCalledOnce());
    await test.pass.stop();
    expect(test.reminders.snapshot()).toEqual([]);
    expect(test.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'vault_push_aborted' }),
      'proactive.reminder_plan',
    );
  });

  it('bounds an unresolved settings read and logs a timeout reason', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T08:30:00.000Z'));
    const test = fixture(new Date(), '', () => new Date());
    vi.spyOn(test.store.settings, 'read').mockImplementation(() => new Promise(() => {}));
    test.pass.trigger();
    expect(test.store.settings.read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'vault_push_timeout' }),
      'proactive.reminder_plan',
    );
    expect(test.vault.tree).not.toHaveBeenCalled();
  });
});
