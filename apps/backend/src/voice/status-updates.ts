import type { NowFeedEventHub, NowFeedStatusKind } from '../core/now.js';
import type { TaskEventHub, TaskEventMessage } from '../factory/task-store.js';

export type VoiceStatusKind =
  | 'task_finished'
  | 'needs_attention'
  | NowFeedStatusKind;

const statusText: Readonly<Record<VoiceStatusKind, string>> = {
  task_finished: 'A task has finished',
  needs_attention: 'A task needs attention',
  pull_request_ready: 'A pull request is ready',
  deployment_failed: 'A deployment has failed',
};

function taskStatus(event: TaskEventMessage): VoiceStatusKind | undefined {
  if (event.type !== 'state_changed' || event.payload === null ||
      typeof event.payload !== 'object' || Array.isArray(event.payload)) return undefined;
  const destination = (event.payload as Record<string, unknown>).to;
  if (destination === 'Done') return 'task_finished';
  if (destination === 'NeedsAttention') return 'needs_attention';
  return undefined;
}

function announcement(kinds: readonly VoiceStatusKind[]): string {
  const phrases = kinds.map((kind) => statusText[kind]);
  if (phrases.length === 1) return `${phrases[0]}.`;
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases.at(-1)}.`;
}

export function createVoiceStatusAnnouncer(options: {
  readonly taskEvents: TaskEventHub;
  readonly nowEvents: NowFeedEventHub;
  readonly canSpeak: () => boolean;
  readonly speak: (text: string) => void;
  readonly mergeWindowMs?: number;
}) {
  const pending = new Set<VoiceStatusKind>();
  const mergeWindowMs = options.mergeWindowMs ?? 500;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const flush = () => {
    if (closed || timer || pending.size === 0 || !options.canSpeak()) return;
    const kinds = [...pending];
    pending.clear();
    options.speak(announcement(kinds));
  };

  const enqueue = (kind: VoiceStatusKind) => {
    if (closed) return;
    pending.add(kind);
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      flush();
    }, mergeWindowMs);
    timer.unref();
  };

  const unsubscribeTaskEvents = options.taskEvents.subscribe((event) => {
    const kind = taskStatus(event);
    if (kind) enqueue(kind);
  });
  const unsubscribeNowEvents = options.nowEvents.subscribe((event) => {
    if (event.type === 'status') enqueue(event.kind);
  });

  return {
    flush,
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending.clear();
      unsubscribeTaskEvents();
      unsubscribeNowEvents();
    },
  };
}
