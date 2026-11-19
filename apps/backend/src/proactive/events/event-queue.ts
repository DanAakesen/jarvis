import { createHash, randomUUID } from 'node:crypto';
import {
  EVENT_DETAIL_MAX_BYTES, EVENT_KIND_PATTERN, EVENT_SOURCE_PATTERN, EVENT_SUMMARY_MAX,
  type ProactiveEventInput, type QueuedEvent,
} from './types.js';

export interface EventSettlement {
  id: string;
  /** Free text: what happened to the event. Never a closed list. */
  outcome: string;
  /** The model call this event was part of, when it reached the model. */
  batchId?: string;
}

export interface EventBatchReservation {
  readonly at: Date;
  readonly activationType: 'event' | 'scheduled';
  readonly satisfiedSlot: string | null;
}

/** The queue is a table read by the existing ticker. State is derived from columns, never an enum. */
export interface EventQueueStore {
  enqueue(input: ProactiveEventInput, now: Date): Promise<{ id: string; inserted: boolean }>;
  hasWork(now: Date): Promise<boolean>;
  /** When the earliest unprocessed event becomes due, or null when none is waiting. */
  nextDueAt(): Promise<Date | null>;
  claim(now: Date, limit: number, leaseMs: number): Promise<QueuedEvent[]>;
  settle(settlements: readonly EventSettlement[], now: Date): Promise<void>;
  retryLater(ids: readonly string[], retryAt: Date): Promise<void>;
  /** Records a model call before it is made; every call counts toward the daily limit, whatever its outcome. */
  startBatch(
    batchId: string,
    now: Date,
    eventCount: number,
    metadata?: { readonly activationType?: 'event' | 'scheduled'; readonly satisfiedSlot?: string | null },
  ): Promise<void>;
  modelBatchesSince(since: Date): Promise<number>;
  lastBatch(): Promise<EventBatchReservation | null>;
  recovery(now: Date): Promise<{
    readonly pending: number;
    readonly leased: number;
    readonly retrying: number;
  }>;
  escalatedSince(source: string, since: Date): Promise<number>;
  hasSource(source: string): Promise<boolean>;
  purge(olderThan: Date): Promise<number>;
}

export interface NormalizedEvent {
  source: string;
  kind: string;
  dedupeKey: string;
  summary: string;
  detail: Record<string, unknown>;
  occurredAt: Date;
  baseline: boolean;
}

function oneLine(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/** Producers hand over loose data; this is the single place it becomes a safe row. */
export function normalizeEvent(input: ProactiveEventInput): NormalizedEvent {
  if (!EVENT_SOURCE_PATTERN.test(input.source)) throw new RangeError('Invalid event source');
  if (!EVENT_KIND_PATTERN.test(input.kind)) throw new RangeError('Invalid event kind');
  if (!Number.isFinite(input.occurredAt.getTime())) throw new RangeError('Invalid event time');
  const key = oneLine(input.dedupeKey);
  if (!key) throw new RangeError('Invalid event dedupe key');
  const summary = Array.from(oneLine(input.summary));
  if (summary.length === 0) throw new RangeError('Invalid event summary');
  let detail: Record<string, unknown> = input.detail ?? {};
  if (Buffer.byteLength(JSON.stringify(detail), 'utf8') > EVENT_DETAIL_MAX_BYTES) detail = { truncated: true };
  return {
    source: input.source,
    kind: input.kind,
    dedupeKey: key.length <= 200 ? key : `sha256:${createHash('sha256').update(key).digest('hex')}`,
    summary: summary.length <= EVENT_SUMMARY_MAX ? summary.join('') : `${summary.slice(0, EVENT_SUMMARY_MAX - 1).join('')}…`,
    detail,
    occurredAt: input.occurredAt,
    baseline: input.baseline === true,
  };
}

interface MemoryRow extends QueuedEvent {
  claimedUntil: Date | null;
  retryAt: Date | null;
  processedAt: Date | null;
  outcome: string | null;
  batchId: string | null;
}

export function createMemoryEventQueueStore(): EventQueueStore {
  const rows = new Map<string, MemoryRow>();
  const byKey = new Map<string, string>();
  const batches: EventBatchReservation[] = [];
  const view = (row: MemoryRow): QueuedEvent => ({
    id: row.id, source: row.source, kind: row.kind, dedupeKey: row.dedupeKey, summary: row.summary,
    detail: structuredClone(row.detail), occurredAt: row.occurredAt, receivedAt: row.receivedAt, attempts: row.attempts,
  });
  const due = (row: MemoryRow, now: Date) => row.processedAt === null &&
    (row.retryAt === null || row.retryAt <= now) && (row.claimedUntil === null || row.claimedUntil <= now);
  return {
    async enqueue(input, now) {
      const event = normalizeEvent(input);
      const existing = byKey.get(event.dedupeKey);
      if (existing) return { id: existing, inserted: false };
      const id = randomUUID();
      rows.set(id, {
        id, source: event.source, kind: event.kind, dedupeKey: event.dedupeKey, summary: event.summary,
        detail: event.detail, occurredAt: event.occurredAt, receivedAt: now, attempts: 0,
        claimedUntil: null, retryAt: null, processedAt: event.baseline ? now : null,
        outcome: event.baseline ? 'baseline' : null, batchId: null,
      });
      byKey.set(event.dedupeKey, id);
      return { id, inserted: true };
    },
    async hasWork(now) { return [...rows.values()].some((row) => due(row, now)); },
    async nextDueAt() {
      const times = [...rows.values()].filter((row) => row.processedAt === null)
        .map((row) => Math.max(row.retryAt?.getTime() ?? 0, row.claimedUntil?.getTime() ?? 0, row.receivedAt.getTime()));
      return times.length ? new Date(Math.min(...times)) : null;
    },
    async claim(now, limit, leaseMs) {
      const claimed = [...rows.values()].filter((row) => due(row, now))
        .sort((left, right) => left.receivedAt.getTime() - right.receivedAt.getTime()).slice(0, limit);
      for (const row of claimed) {
        row.claimedUntil = new Date(now.getTime() + leaseMs);
        row.attempts += 1;
      }
      return claimed.map(view);
    },
    async settle(settlements, now) {
      for (const { id, outcome, batchId } of settlements) {
        const row = rows.get(id);
        if (!row) continue;
        row.processedAt = now;
        row.claimedUntil = null;
        row.outcome = outcome.slice(0, 400);
        row.batchId = batchId ?? null;
      }
    },
    async retryLater(ids, retryAt) {
      for (const id of ids) {
        const row = rows.get(id);
        if (!row || row.processedAt) continue;
        row.claimedUntil = null;
        row.retryAt = retryAt;
      }
    },
    async startBatch(_batchId, now, _eventCount, metadata) {
      batches.push({
        at: new Date(now),
        activationType: metadata?.activationType ?? 'event',
        satisfiedSlot: metadata?.satisfiedSlot ?? null,
      });
    },
    async modelBatchesSince(since) { return batches.filter(({ at }) => at >= since).length; },
    async lastBatch() {
      if (batches.length === 0) return null;
      const value = batches.reduce((latest, entry) => entry.at > latest.at ? entry : latest);
      return { ...value, at: new Date(value.at) };
    },
    async recovery(now) {
      const open = [...rows.values()].filter((row) => row.processedAt === null);
      return {
        pending: open.length,
        leased: open.filter((row) => row.claimedUntil !== null && row.claimedUntil > now).length,
        retrying: open.filter((row) => row.retryAt !== null && row.retryAt > now).length,
      };
    },
    async escalatedSince(source, since) {
      return [...rows.values()].filter((row) => row.source === source && row.batchId !== null &&
        row.processedAt !== null && row.processedAt >= since).length;
    },
    async hasSource(source) { return [...rows.values()].some((row) => row.source === source); },
    async purge(olderThan) {
      let removed = 0;
      for (const [id, row] of rows) {
        if (row.processedAt && row.processedAt < olderThan) {
          rows.delete(id);
          byKey.delete(row.dedupeKey);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
