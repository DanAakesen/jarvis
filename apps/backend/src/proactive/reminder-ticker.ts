import type { ConversationStore } from '../core/conversation-store.js';
import type { PushStore } from '../database/push-store.js';
import type { createGitHubVaultClient } from '../vault/github-client.js';
import { readVaultTasks } from './todo-discovery.js';
import { detectLanguage } from './language.js';
import { reminderDedupeKey, reminderKey } from './reminders.js';
import type { AlertLedgerStore } from './alert-ledger.js';
import type { SystemPushOutcome, SystemPushRequest } from './push-delivery.js';
import type { ProactiveReminderStore, ReminderRow } from './reminder-store.js';
import type { ProactiveStore } from './store.js';
import { dayKey, isQuietHour, localTimeLabel } from './time.js';
import type { FindingInput } from './store.js';
import type { SuggestionScope } from './types.js';
import { findingAllowed } from './policy.js';

const tickIntervalMs = 30_000;
const retryDelayMs = 5 * 60_000;
const verifyTimeoutMs = 20_000;
const maxDueRows = 20;
const maxDailyReminders = 8;
type VaultReader = Pick<ReturnType<typeof createGitHubVaultClient>, 'tree' | 'read'>;

export interface ReminderTickerLogger {
  info?: (data: { count?: number; durationMs?: number; reason: string }, message: string) => void;
  warn?: (data: { count?: number; durationMs?: number; reason: string }, message: string) => void;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Operation aborted'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {});
    if (signal.aborted) abort();
  });
}

async function readTodos(vault: VaultReader, signal: AbortSignal) {
  const timeout = AbortSignal.timeout(verifyTimeoutMs);
  const boundedSignal = AbortSignal.any([signal, timeout]);
  return abortable(readVaultTasks(vault, boundedSignal), boundedSignal);
}

function itemBody(row: ReminderRow, now: Date, language: 'da' | 'en'): string {
  const due = row.dueAt;
  const time = localTimeLabel(due);
  if (dayKey(due) !== dayKey(now)) {
    return language === 'da' ? `Forfaldt i går kl. ${time}` : `Was due yesterday at ${time}`;
  }
  if (due.getTime() > now.getTime()) {
    return language === 'da' ? `Forfalder kl. ${time}` : `Due at ${time}`;
  }
  return language === 'da' ? `Forfaldt kl. ${time}` : `Was due at ${time}`;
}

function findingFor(row: ReminderRow, now: Date, language: 'da' | 'en', suggestionScope: SuggestionScope): FindingInput {
  return {
    dedupeKey: reminderDedupeKey(row.reminderKey),
    title: row.title,
    body: itemBody(row, now, language),
    category: 'todo',
    suggestionScope,
    urgency: 'time_critical',
    dueAt: row.dueAt.toISOString(),
    evidence: [{ source: 'todos', label: 'Todo list', observedAt: now.toISOString() }],
    runId: null,
    language,
  };
}

export function createReminderTicker(options: {
  store: Pick<ProactiveStore, 'settings' | 'items'>;
  reminders: ProactiveReminderStore;
  vault: VaultReader;
  pushStore: Pick<PushStore, 'listSubscriptions' | 'updateItemDelivery'>;
  ledger: Pick<AlertLedgerStore, 'get'>;
  ownerObjectId: string;
  send: (request: SystemPushRequest, signal: AbortSignal) => Promise<SystemPushOutcome>;
  conversationStore?: Pick<ConversationStore, 'readRecentUserMessages'>;
  now: () => Date;
  logger?: ReminderTickerLogger;
}) {
  let stopped = false;
  let startup: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticking: Promise<void> | undefined;
  let nextWakeAt: Date | null = null;
  const controller = new AbortController();
  let preferenceController = new AbortController();
  const unsubscribePreferences = options.store.settings.subscribePreferencesChanged(() => {
    preferenceController.abort('preferences_changed');
    preferenceController = new AbortController();
  });

  const log = (level: 'info' | 'warn', reason: string, startedAt: number, count?: number) => {
    try {
      options.logger?.[level]?.({
        ...(count === undefined ? {} : { count }),
        durationMs: Math.max(0, options.now().getTime() - startedAt),
        reason,
      }, 'proactive.reminder_tick');
    } catch { /* Logging cannot change the ticker. */ }
  };

  function backoff(reason: string, startedAt: number) {
    let at = Date.now();
    try {
      const current = options.now().getTime();
      if (Number.isFinite(current)) at = current;
    } catch { /* The system clock is the fallback for a broken injected clock. */ }
    nextWakeAt = new Date(at + retryDelayMs);
    log('warn', reason, startedAt);
  }

  function considerFireAt(fireAt: Date) {
    if (!nextWakeAt || fireAt.getTime() < nextWakeAt.getTime()) nextWakeAt = new Date(fireAt);
  }

  async function update(row: ReminderRow, values: Parameters<ProactiveReminderStore['updatePending']>[1]) {
    await options.reminders.updatePending(row.id, values);
  }

  async function processDue(now: Date, signal: AbortSignal): Promise<void> {
    const due = await options.reminders.listDue(now, maxDueRows);
    if (due.length === 0) return;

    const remaining: ReminderRow[] = [];
    for (const row of due) {
      if (now.getTime() > row.dueAt.getTime() + 24 * 60 * 60_000) {
        await update(row, { state: 'expired', reason: 'too_late' });
      } else remaining.push(row);
    }
    if (remaining.length === 0) return;

    const settings = await options.store.settings.read();
    if (settings.paused) {
      await Promise.all(remaining.map((row) => update(row, { state: 'suppressed', reason: 'paused' })));
      return;
    }
    if (!settings.categories.todo) return;

    const subscriptions = await options.pushStore.listSubscriptions(options.ownerObjectId);
    if (subscriptions.length === 0) {
      await Promise.all(remaining.map((row) =>
        update(row, { state: 'suppressed', reason: 'no_subscription' })));
      return;
    }
    if (signal.aborted) return;

    let verifiedKeys: Map<string, SuggestionScope> | undefined;
    try {
      const todos = await readTodos(options.vault, signal);
      verifiedKeys = new Map(todos.filter((todo) => !todo.done && todo.highPriority && todo.dueHasTime &&
        typeof todo.dueAt === 'string' && Number.isFinite(Date.parse(todo.dueAt)))
        .map((todo) => [reminderKey(todo.text, new Date(todo.dueAt!).toISOString()),
          todo.path.startsWith('Personal/') ? 'personal' : todo.path.startsWith('Work/') ? 'work' : 'unknown']));
    } catch {
      if (signal.aborted) return;
      const verifiedAt = options.now();
      for (const row of remaining) {
        const verifyAttempts = Math.min(255, row.verifyAttempts + 1);
        if (verifyAttempts < 3) {
          await update(row, {
            verifyAttempts,
            fireAt: new Date(verifiedAt.getTime() + retryDelayMs),
          });
        } else {
          await update(row, { state: 'suppressed', reason: 'unverified', verifyAttempts });
        }
      }
    }

    const sendable: ReminderRow[] = [];
    const verifiedScopes = new Map<string, SuggestionScope>();
    if (verifiedKeys) {
      for (const row of remaining) {
        const scope = verifiedKeys.get(row.reminderKey);
        if (scope === undefined) {
          await update(row, { state: 'cancelled', reason: 'todo_changed' });
        } else if (settings.suggestionScope === 'all' || scope === settings.suggestionScope) {
          sendable.push(row);
          verifiedScopes.set(row.reminderKey, scope);
        }
      }
    }
    if (sendable.length === 0 || signal.aborted) return;

    const eligible: ReminderRow[] = [];
    for (const row of sendable) {
      if (row.deadlineAlertKey) {
        const alert = await options.ledger.get(row.deadlineAlertKey);
        const sentAt = alert?.status === 'sent' ? Date.parse(alert.updatedAt) : Number.NaN;
        if (Number.isFinite(sentAt) && sentAt <= now.getTime() && sentAt >= now.getTime() - 2 * 60 * 60_000) {
          await update(row, { state: 'suppressed', reason: 'already_alerted' });
          continue;
        }
      }
      eligible.push(row);
    }
    if (eligible.length === 0 || signal.aborted) return;

    const today = dayKey(now);
    const alreadySent = await options.reminders.countSent(today);
    const allowance = Math.max(0, maxDailyReminders - alreadySent);
    const capped = eligible.slice(allowance);
    await Promise.all(capped.map((row) => update(row, { state: 'suppressed', reason: 'daily_cap' })));
    const allowed = eligible.slice(0, allowance);
    if (allowed.length === 0 || signal.aborted) return;

    let language: 'da' | 'en' = 'en';
    try {
      const messages = await options.conversationStore?.readRecentUserMessages(8);
      if (messages?.length) language = detectLanguage(messages);
    } catch { /* English is the safe default if recent-chat reading fails. */ }

    const items = [];
    for (const candidate of allowed) {
      if (signal.aborted) return;
      items.push({
        row: candidate,
        item: await options.store.items.upsertFinding(findingFor(
          candidate, now, language, verifiedScopes.get(candidate.reminderKey) ?? 'unknown',
        )),
      });
    }
    if (items.length === 0 || signal.aborted) return;

    const latestSettings = await options.store.settings.read();
    if (signal.aborted || !items.every(({ item }) => findingAllowed(
      latestSettings, 'todo', item.suggestionScope,
    ))) return;

    const dueTimes = items.map(({ row }) => row.dueAt.getTime());
    const kind: SystemPushRequest['kind'] = dueTimes.every((value) => value > now.getTime())
      ? 'due_soon'
      : dueTimes.every((value) => value <= now.getTime()) ? 'overdue' : 'mixed';
    const outcome = await options.send({
      kind,
      count: items.length,
      language,
      itemId: items[0]!.item.id,
      origin: 'proactive_reminder',
      details: [...items].sort((left, right) => left.row.dueAt.getTime() - right.row.dueAt.getTime())
        .slice(0, 3).map(({ row }) => ({ title: row.title, dueAt: row.dueAt.toISOString() })),
    }, signal);

    if (outcome.status === 'sent') {
      const sentDayKey = dayKey(options.now());
      await Promise.all(items.flatMap(({ row, item }) => [
        update(row, {
          state: 'sent',
          itemId: item.id,
          sentDayKey,
        }),
        options.pushStore.updateItemDelivery(item.id, 'accepted', outcome.statusCode),
      ]));
    } else if (outcome.status === 'failed') {
      await Promise.all(items.flatMap(({ row, item }) => {
        const sendAttempts = Math.min(255, row.sendAttempts + 1);
        return [
          update(row, sendAttempts < 2
            ? { sendAttempts, fireAt: new Date(options.now().getTime() + retryDelayMs) }
            : { state: 'failed', reason: outcome.reason, sendAttempts }),
          options.pushStore.updateItemDelivery(item.id, 'failed', outcome.statusCode),
        ];
      }));
    } else if (outcome.reason === 'no_subscription') {
      await Promise.all(items.map(({ row }) =>
        update(row, { state: 'suppressed', reason: 'no_subscription' })));
    }
    log(outcome.status === 'failed' ? 'warn' : 'info', outcome.reason ?? outcome.status,
      now.getTime(), items.length);
  }

  async function runTick(): Promise<void> {
    if (stopped || controller.signal.aborted) return;
    const signal = AbortSignal.any([controller.signal, preferenceController.signal]);
    let startedAt = Date.now();
    try {
      const now = options.now();
      startedAt = now.getTime();
      if (isQuietHour(now) || nextWakeAt === null || nextWakeAt.getTime() > now.getTime()) return;
      await processDue(now, signal);
      if (!stopped && !controller.signal.aborted) {
        nextWakeAt = await options.reminders.earliestPendingFireAt();
      }
    } catch {
      if (!signal.aborted) backoff('internal_error', startedAt);
    }
  }

  function tick(): Promise<void> {
    if (!ticking) {
      const current = runTick().finally(() => { ticking = undefined; });
      ticking = current;
    }
    return ticking;
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void tick().finally(schedule);
    }, tickIntervalMs);
    timer.unref();
  }

  return {
    start(): Promise<void> {
      startup ??= (async () => {
        try {
          nextWakeAt = await options.reminders.earliestPendingFireAt();
        } catch {
          backoff('startup_read_failed', Date.now());
        }
        schedule();
      })();
      return startup;
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller.abort('shutdown');
      preferenceController.abort('shutdown');
      unsubscribePreferences();
      await startup?.catch(() => {});
      await ticking?.catch(() => {});
    },
    tick,
    considerFireAt,
    get nextWakeAt() { return nextWakeAt ? new Date(nextWakeAt) : null; },
  };
}
