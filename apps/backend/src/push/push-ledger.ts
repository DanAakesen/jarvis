export type PushEventKind = 'approval' | 'reply';

export interface PushLogEntry {
  readonly key: string;
  readonly kind: PushEventKind;
  readonly at: number;
}

export interface PushLedger {
  /** True exactly once per event: the caller that gets true sends the single push and owns the single log entry. */
  claim(kind: PushEventKind, id: string): boolean;
  /** Like claim, but a reply that finishes the turn that staged an approval is dropped: the approval push carried it. */
  claimReply(id: string, turnStartedAt: number): boolean;
  entries(): readonly PushLogEntry[];
}

const retentionMs = 60 * 60_000;
const maxEntries = 2000;

export function createPushLedger(now: () => number = Date.now): PushLedger {
  const log = new Map<string, PushLogEntry>();
  function prune(time: number) {
    for (const [key, entry] of log) if (time - entry.at > retentionMs) log.delete(key);
    while (log.size > maxEntries) log.delete(log.keys().next().value!);
  }
  function claim(kind: PushEventKind, id: string): boolean {
    const time = now();
    prune(time);
    const key = `${kind}:${id}`;
    if (log.has(key)) return false;
    log.set(key, { key, kind, at: time });
    return true;
  }
  return {
    claim,
    claimReply(id, turnStartedAt) {
      prune(now());
      if ([...log.values()].some((entry) => entry.kind === 'approval' && entry.at >= turnStartedAt)) return false;
      return claim('reply', id);
    },
    entries: () => [...log.values()],
  };
}
