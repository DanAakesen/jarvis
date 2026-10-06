import type { NowFeedEventHub, NowFeedStatusKind } from '../core/now.js';
import type { TaskEventHub, TaskEventMessage } from '../factory/task-store.js';
import { taskStatusMessage, taskStatusNotification } from '../factory/task-status-notifications.js';

export type VoiceStatusKind = NowFeedStatusKind;

const statusText: Readonly<Record<VoiceStatusKind, string>> = {
  approval_pending: 'Approval is pending in Jarvis',
  pull_request_ready: 'A pull request is ready',
  deployment_failed: 'A deployment has failed',
};

function taskStatus(event: TaskEventMessage): string | undefined {
  const notification = taskStatusNotification(event);
  return notification
    ? taskStatusMessage(event.taskId, notification.state, notification.url)
    : undefined;
}

function announcement(updates: readonly string[]): string {
  if (updates.length === 1) {
    const update = updates[0]!;
    return /[.!?]$/u.test(update) ? update : `${update}.`;
  }
  const phrases = updates.map((update) => update.replace(/[.!?]+$/u, ''));
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases.at(-1)}.`;
}

export function createVoiceStatusAnnouncer(options: {
  readonly taskEvents?: TaskEventHub;
  readonly nowEvents?: NowFeedEventHub;
  readonly language?: 'da' | 'en';
  readonly canSpeak: () => boolean;
  readonly shouldQueueTaskStatus?: () => boolean;
  readonly speak: (text: string) => void;
  readonly mergeWindowMs?: number;
}) {
  const pending = new Set<string>();
  const announcedTaskStates = new Set<string>();
  const mergeWindowMs = options.mergeWindowMs ?? 500;
  const language = options.language ?? 'en';
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const flush = () => {
    if (closed || timer || pending.size === 0 || !options.canSpeak()) return;
    const kinds = [...pending];
    pending.clear();
    options.speak(announcement(kinds));
  };

  const enqueue = (update: string) => {
    if (closed) return;
    pending.add(update);
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      flush();
    }, mergeWindowMs);
    timer.unref();
  };

  const unsubscribeTaskEvents = options.taskEvents?.subscribe((event) => {
    if (options.shouldQueueTaskStatus && !options.shouldQueueTaskStatus()) return;
    const update = taskStatus(event);
    const status = taskStatusNotification(event);
    if (!update || !status) return;
    const key = `${event.taskId}:${status.state}`;
    if (announcedTaskStates.has(key)) return;
    announcedTaskStates.add(key);
    enqueue(language === 'da' ? taskStatusMessage(event.taskId, status.state, status.url, 'da') : update);
  });
  const unsubscribeNowEvents = options.nowEvents?.subscribe((event) => {
    if (event.type === 'status') enqueue(statusText[event.kind]);
  });

  return {
    flush,
    announce(text: string): boolean {
      if (closed || timer || pending.size > 0 || !options.canSpeak()) return false;
      options.speak(text);
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending.clear();
      unsubscribeTaskEvents?.();
      unsubscribeNowEvents?.();
    },
  };
}
