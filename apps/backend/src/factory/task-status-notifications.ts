import type { ConversationStore } from '../core/conversation-store.js';
import type { AwayModeStore } from '../core/away-mode.js';
import type { TeamsNotificationService } from '../teams/service.js';
import type { TaskStatusNotificationStore, TaskNotificationState } from '../database/task-status-notification-store.js';
import type { TaskEventMessage, TaskStore } from './task-store.js';

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validPullRequestUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/u.test(url.pathname)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function taskStatusNotification(event: TaskEventMessage): {
  state: TaskNotificationState;
  url?: string;
} | undefined {
  if (event.type === 'pull_request_opened' && event.source === 'backend') {
    const url = validPullRequestUrl(object(event.payload)?.url);
    return url ? { state: 'pull_request_opened', url } : undefined;
  }
  if (event.type !== 'state_changed' || event.source !== 'backend') return undefined;
  const state = object(event.payload)?.to;
  if (state !== 'Done' && state !== 'NeedsAttention' && state !== 'Cancelled') return undefined;
  const url = validPullRequestUrl(object(event.payload)?.pullRequestUrl);
  return { state, ...(url ? { url } : {}) };
}

function pullRequestUrl(event: TaskEventMessage, task: Awaited<ReturnType<TaskStore['get']>>): string | undefined {
  const current = event.type === 'pull_request_opened'
    ? validPullRequestUrl(object(event.payload)?.url)
    : validPullRequestUrl(object(event.payload)?.pullRequestUrl);
  if (current) return current;
  const previous = task?.events.find((candidate) => candidate.type === 'pull_request_opened' &&
    candidate.source === 'backend');
  return validPullRequestUrl(object(previous?.payload)?.url);
}

export function taskStatusMessage(
  taskId: string,
  state: TaskNotificationState,
  url?: string,
  language: 'da' | 'en' = 'en',
): string {
  if (language === 'da') {
    const outcome = state === 'Done'
      ? 'er færdig'
      : state === 'NeedsAttention'
        ? 'kræver opmærksomhed'
        : state === 'Cancelled'
          ? 'blev annulleret'
          : 'åbnede en pull request';
    return `Opgave ${taskId} ${outcome}${url ? ` (PR: ${url})` : ''}.`;
  }
  const outcome = state === 'Done'
    ? 'is done'
    : state === 'NeedsAttention'
      ? 'needs attention'
      : state === 'Cancelled'
        ? 'was cancelled'
        : 'opened a pull request';
  return `Task ${taskId} ${outcome}${url ? ` (PR: ${url})` : ''}.`;
}

export function createTaskStatusNotificationHandler(options: {
  readonly tasks: Pick<TaskStore, 'get'>;
  readonly conversations: ConversationStore;
  readonly awayMode: AwayModeStore;
  readonly teams: TeamsNotificationService | null;
  readonly notifications: TaskStatusNotificationStore;
  readonly onError: () => void;
}) {
  return async (event: TaskEventMessage, awayOverride?: boolean): Promise<boolean> => {
    const notification = taskStatusNotification(event);
    if (!notification) return false;
    const { state } = notification;

    try {
      const task = await options.tasks.get(event.taskId, 200, 0);
      if (!task?.originMessageId || !options.conversations.getMessageSessionId) return false;
      const sessionId = await options.conversations.getMessageSessionId(task.originMessageId);
      if (!sessionId) return false;
      const session = await options.conversations.getSession(sessionId);
      if (!session) return false;
      const away = awayOverride ?? (await options.awayMode.read()).away;
      if (away && !options.teams) return false;
      if (!await options.notifications.claim(event.taskId, state)) return true;

      const text = taskStatusMessage(event.taskId, state, notification.url ?? pullRequestUrl(event, task), session.language);
      if (away) {
        const kind = state === 'NeedsAttention' ? 'warning' : state === 'Done' ? 'success' : 'info';
        await options.teams!.notify(kind, text);
        return true;
      }
      await options.conversations.addMessage({
        sessionId,
        role: 'jarvis',
        text,
        model: null,
        language: session.language,
        allowEndedSession: true,
      });
      return true;
    } catch {
      options.onError();
      return true;
    }
  };
}
