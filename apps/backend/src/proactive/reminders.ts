import { createHash } from 'node:crypto';
import type { FindingsStoredContext } from './engine.js';
import { deterministicDedupeKey, normaliseFactText, todosDueWithin } from './detect.js';
import { proactiveAlertKey } from './alerts.js';
import type { PlannedReminder, ProactiveReminderStore } from './reminder-store.js';
import type { ProactiveStore } from './store.js';

export interface ReminderPlannerLogger {
  info?: (data: { runId: string; count?: number; durationMs?: number; reason: string }, message: string) => void;
  warn?: (data: { runId: string; count?: number; durationMs?: number; reason: string }, message: string) => void;
}

export function reminderKey(text: string, dueAt: string): string {
  return createHash('sha256')
    .update(['todo_due_soon', normaliseFactText(text), dueAt].join('|'))
    .digest('hex').slice(0, 32);
}

export function reminderTitle(text: string): string {
  let length = 0;
  let title = '';
  for (const character of text.replace(/\p{Cc}/gu, '').replace(/\s+/gu, ' ').trim()) {
    if (length + character.length > 80) break;
    title += character;
    length += character.length;
  }
  return title;
}

export function reminderDedupeKey(key: string): string {
  return createHash('sha256').update(`reminder|${key}`).digest('hex').slice(0, 32);
}

export function createTodoReminderPlanner(options: {
  store: Pick<ProactiveStore, 'settings'>;
  reminders: Pick<ProactiveReminderStore, 'plan'>;
  now: () => Date;
  onPlanned?: (fireAt: Date) => void;
  logger?: ReminderPlannerLogger;
}) {
  const log = (
    level: 'info' | 'warn',
    context: FindingsStoredContext,
    reason: string,
    startedAt: number,
    count?: number,
  ) => {
    try {
      options.logger?.[level]?.({
        runId: context.runId,
        ...(count === undefined ? {} : { count }),
        durationMs: Math.max(0, options.now().getTime() - startedAt),
        reason,
      }, 'proactive.reminder_plan');
    } catch { /* Logging cannot change the run. */ }
  };

  return async (context: FindingsStoredContext): Promise<void> => {
    let startedAt = 0;
    try {
      startedAt = options.now().getTime();
      if (context.signal.aborted) {
        log('info', context, 'aborted', startedAt);
        return;
      }
      const settings = await options.store.settings.read();
      if (settings.paused) {
        log('info', context, 'paused', startedAt);
        return;
      }
      if (context.signal.aborted) {
        log('info', context, 'aborted', startedAt);
        return;
      }
      if (!context.sources.some(({ id, state }) => id === 'todos' && state === 'ok')) {
        log('info', context, 'todos_unavailable', startedAt);
        return;
      }
      const now = options.now();
      const candidates: PlannedReminder[] = todosDueWithin(context.facts, now, 48 * 60)
        .filter((fact) => fact.dueHasTime === true && typeof fact.dueAt === 'string' &&
          Number.isFinite(Date.parse(fact.dueAt)))
        .flatMap((fact) => {
          const dueAt = new Date(fact.dueAt!);
          const title = reminderTitle(fact.text);
          if (!title) return [];
          const dueIso = dueAt.toISOString();
          return [{
            reminderKey: reminderKey(fact.text, dueIso),
            deadlineAlertKey: proactiveAlertKey(
              'deadline_24h', deterministicDedupeKey('deadline', fact.text, dueIso),
            ),
            fireAt: new Date(dueAt.getTime() - 60 * 60_000),
            dueAt,
            title,
            plannedRunId: context.runId,
          }];
        });
      if (context.signal.aborted) {
        log('info', context, 'aborted', startedAt);
        return;
      }
      const result = await options.reminders.plan(candidates, now);
      if (result.inserted.length > 0) {
        const earliest = result.inserted.reduce((value, row) =>
          row.fireAt.getTime() < value.getTime() ? row.fireAt : value, result.inserted[0]!.fireAt);
        try { options.onPlanned?.(earliest); } catch { /* Wake-up hints are best effort. */ }
      }
      if (result.capSkipped > 0) log('warn', context, 'plan_cap', startedAt, result.capSkipped);
      else if (result.inserted.length > 0 || result.purged > 0) {
        log('info', context, 'planned', startedAt, result.inserted.length);
      }
    } catch {
      log('warn', context, 'planner_failed', startedAt);
    }
  };
}
