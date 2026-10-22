import type { ProactiveSource } from './types.js';
import type { ProactiveStore } from './store.js';
import type { ProactiveReminderStore } from './reminder-store.js';
import { planTodoReminders } from './reminders.js';
import { isQuietHour } from './time.js';
import { classifySuggestionScope } from './policy.js';

const passTimeoutMs = 60_000;
const coalesceWindowMs = 10_000;
const minimumStartGapMs = 60_000;

export interface VaultPushReminderLogger {
  info?: (data: { runId: null; count?: number; durationMs?: number; reason: string }, message: string) => void;
  warn?: (data: { runId: null; count?: number; durationMs?: number; reason: string }, message: string) => void;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Operation aborted'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {});
    if (signal.aborted) abort();
  });
}

export function createVaultPushReminderPass(options: {
  store: Pick<ProactiveStore, 'settings'>;
  reminders: Pick<ProactiveReminderStore, 'plan'>;
  todos: ProactiveSource;
  now: () => Date;
  onPlanned?: (fireAt: Date) => void;
  logger?: VaultPushReminderLogger;
}) {
  let stopped = false;
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstTriggerAt: number | undefined;
  let pendingAt: number | undefined;
  let lastStartedAt: number | undefined;
  const unsubscribePreferences = options.store.settings.subscribePreferencesChanged(() => {
    controller?.abort('preferences_changed');
  });

  function log(level: 'info' | 'warn', reason: string, startedAt: number, count?: number) {
    try {
      options.logger?.[level]?.({
        runId: null,
        ...(count === undefined ? {} : { count }),
        durationMs: Math.max(0, options.now().getTime() - startedAt),
        reason,
      }, 'proactive.reminder_plan');
    } catch { /* Logging cannot change a reminder pass. */ }
  }

  function logAbort(signal: AbortSignal, startedAt: number) {
    const reason = signal.reason === 'timeout' ? 'vault_push_timeout' : 'vault_push_aborted';
    log(reason === 'vault_push_timeout' ? 'warn' : 'info', reason, startedAt);
  }

  async function execute(signal: AbortSignal, startedAt: number): Promise<void> {
    const initialNow = options.now();
    if (isQuietHour(initialNow)) {
      log('info', 'vault_push_quiet_hours', startedAt);
      return;
    }
    const settings = await abortable(options.store.settings.read(), signal);
    if (signal.aborted) {
      logAbort(signal, startedAt);
      return;
    }
    if (settings.paused) {
      log('info', 'vault_push_paused', startedAt);
      return;
    }
    if (!settings.sources.todos || !settings.categories.todo) {
      log('info', 'vault_push_todos_disabled', startedAt);
      return;
    }
    const now = options.now();
    if (isQuietHour(now)) {
      log('info', 'vault_push_quiet_hours', startedAt);
      return;
    }
    const result = await abortable(options.todos.read({ now, signal, settings }), signal);
    if (signal.aborted) {
      logAbort(signal, startedAt);
      return;
    }
    if (result.state !== 'ok') {
      log('warn', 'vault_push_todos_unavailable', startedAt);
      return;
    }
    const planned = await abortable(planTodoReminders({
      reminders: options.reminders,
      facts: result.facts.filter((fact) => settings.suggestionScope === 'all' ||
        classifySuggestionScope(fact.text, [fact]) === settings.suggestionScope),
      now: options.now(),
      plannedRunId: null,
      ...(options.onPlanned ? { onPlanned: options.onPlanned } : {}),
    }), signal);
    if (planned.capSkipped > 0) {
      log('warn', 'vault_push_plan_cap', startedAt, planned.capSkipped);
    } else if (planned.inserted.length > 0 || planned.purged > 0) {
      log('info', 'vault_push_planned', startedAt, planned.inserted.length);
    } else {
      log('info', 'vault_push_no_new_rows', startedAt);
    }
  }

  function schedulePending() {
    if (stopped || running || pendingAt === undefined || lastStartedAt === undefined) return;
    if (timer) clearTimeout(timer);
    const notBefore = Math.max(pendingAt, lastStartedAt + minimumStartGapMs);
    const delay = Math.max(0, notBefore - options.now().getTime());
    timer = setTimeout(() => {
      timer = undefined;
      if (stopped || running || pendingAt === undefined) return;
      const now = options.now().getTime();
      if (lastStartedAt !== undefined && now < lastStartedAt + minimumStartGapMs) {
        schedulePending();
        return;
      }
      pendingAt = undefined;
      startPass(now);
    }, delay);
    timer.unref();
  }

  function startPass(startedAt: number) {
    if (stopped || running) return;
    firstTriggerAt = startedAt;
    lastStartedAt = startedAt;
    const currentController = new AbortController();
    controller = currentController;
    const timeout = setTimeout(() => currentController.abort('timeout'), passTimeoutMs);
    timeout.unref();
    const current = execute(currentController.signal, startedAt).catch(() => {
      if (currentController.signal.aborted) {
        logAbort(currentController.signal, startedAt);
      } else {
        log('warn', 'vault_push_failed', startedAt);
      }
    }).finally(() => {
      clearTimeout(timeout);
      if (controller === currentController) controller = undefined;
      if (running === current) running = undefined;
      schedulePending();
    });
    running = current;
  }

  function trigger() {
    if (stopped) return;
    const now = options.now().getTime();
    const withinBurst = firstTriggerAt !== undefined && now < firstTriggerAt + coalesceWindowMs;
    const insideMinimumGap = lastStartedAt !== undefined && now < lastStartedAt + minimumStartGapMs;
    if (running || pendingAt !== undefined || withinBurst || insideMinimumGap) {
      if (pendingAt === undefined) {
        pendingAt = withinBurst ? firstTriggerAt! + coalesceWindowMs : now;
      }
      schedulePending();
      return;
    }
    startPass(now);
  }

  return {
    trigger,
    async stop(): Promise<void> {
      stopped = true;
      unsubscribePreferences();
      if (timer) clearTimeout(timer);
      timer = undefined;
      controller?.abort('shutdown');
      await running?.catch(() => {});
    },
  };
}
