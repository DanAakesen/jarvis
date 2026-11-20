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
  /** State/policy invalidations can be reactivated by a later valid observation. */
  reopenable?: boolean;
}

export interface EventBatchReservation {
  readonly at: Date;
  readonly activationType: 'event' | 'scheduled';
  readonly satisfiedSlot: string | null;
}

export interface EventBatchReserveInput {
  readonly batchId: string;
  /** Called by the store after it has acquired the exact owner reservation lock. */
  readonly sampleTime: () => {
    readonly at: Date;
    readonly dayStart: Date;
    readonly quiet: boolean;
    readonly satisfiedSlot: string | null;
  };
  readonly eventCount: number;
  readonly activationType: 'event' | 'scheduled';
  readonly allowQuiet: boolean;
  readonly minimumGapMs: number;
  readonly expectedPolicyRevision: string;
  readonly worstCaseDkk: number;
  /** Memory-store fallback; SQL reads the owner setting inside the reservation transaction. */
  readonly fallbackAllowed: number;
}

export interface EventBatchReserveResult {
  readonly allowed: boolean;
  readonly reason?: 'paused' | 'quiet_hours' | 'spaced' | 'daily_cap' | 'policy_changed' | 'budget_exhausted';
  readonly status: {
    readonly used: number;
    readonly allowed: number;
    readonly last: EventBatchReservation | null;
  };
}

/** The queue is a table read by the existing ticker. State is derived from columns, never an enum. */
export interface EventQueueStore {
  readonly supportsSituationOutbox: boolean;
  reconcileSituationOutbox(at: Date, signal: AbortSignal): Promise<{
    readonly changed: boolean;
    readonly pending: boolean;
  }>;
  enqueue(input: ProactiveEventInput, now: Date): Promise<{ id: string; inserted: boolean }>;
  /** Cancels one stable identity without deleting its evidence. */
  cancel(identity: string, now: Date, reason: string): Promise<boolean>;
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
  /** Atomically checks the owner allowance and persists the model batch. */
  reserveBatch(input: EventBatchReserveInput): Promise<EventBatchReserveResult>;
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
  identity: string;
  materialHash: string;
  notBeforeAt: Date | null;
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
  const dedupeKey = key.length <= 200
    ? key
    : `sha256:${createHash('sha256').update(key).digest('hex')}`;
  const summary = Array.from(oneLine(input.summary));
  if (summary.length === 0) throw new RangeError('Invalid event summary');
  let detail: Record<string, unknown> = input.detail ?? {};
  if (Buffer.byteLength(JSON.stringify(detail), 'utf8') > EVENT_DETAIL_MAX_BYTES) detail = { truncated: true };
  if (input.notBeforeAt !== undefined && !Number.isFinite(input.notBeforeAt.getTime())) {
    throw new RangeError('Invalid event availability time');
  }
  const identity = oneLine(input.identity ?? dedupeKey);
  if (!identity || identity.length > 200) throw new RangeError('Invalid event identity');
  const material = input.material ?? {
    source: input.source,
    kind: input.kind,
    summary: summary.join(''),
    detail,
    occurredAt: input.occurredAt.toISOString(),
    notBeforeAt: input.notBeforeAt?.toISOString() ?? null,
  };
  let materialJson: string;
  try { materialJson = JSON.stringify(material); }
  catch { throw new RangeError('Invalid event material'); }
  if (Buffer.byteLength(materialJson, 'utf8') > EVENT_DETAIL_MAX_BYTES) {
    throw new RangeError('Invalid event material');
  }
  return {
    source: input.source,
    kind: input.kind,
    dedupeKey,
    summary: summary.length <= EVENT_SUMMARY_MAX ? summary.join('') : `${summary.slice(0, EVENT_SUMMARY_MAX - 1).join('')}…`,
    detail,
    occurredAt: input.occurredAt,
    baseline: input.baseline === true,
    identity,
    materialHash: createHash('sha256').update(materialJson).digest('hex'),
    notBeforeAt: input.notBeforeAt ? new Date(input.notBeforeAt) : null,
  };
}

interface MemoryRow extends QueuedEvent {
  claimedUntil: Date | null;
  retryAt: Date | null;
  processedAt: Date | null;
  outcome: string | null;
  batchId: string | null;
  reopenable: boolean;
}

function archivedDedupeKey(key: string, generationId: string): string {
  const archived = `${key}:archived:${generationId}`;
  return archived.length <= 200
    ? archived
    : `sha256:${createHash('sha256').update(archived).digest('hex')}`;
}

function materialDedupeKey(key: string, materialHash: string): string {
  return `${key.slice(0, 175)}:${materialHash.slice(0, 24)}`;
}

export function createMemoryEventQueueStore(): EventQueueStore {
  const rows = new Map<string, MemoryRow>();
  const byKey = new Map<string, string>();
  const batches: EventBatchReservation[] = [];
  const batchIds = new Map<string, EventBatchReservation>();
  const view = (row: MemoryRow): QueuedEvent => ({
    id: row.id, source: row.source, kind: row.kind, dedupeKey: row.dedupeKey, summary: row.summary,
    detail: structuredClone(row.detail), occurredAt: row.occurredAt, receivedAt: row.receivedAt, attempts: row.attempts,
    ...(row.identity !== undefined ? { identity: row.identity } : {}),
    ...(row.materialHash !== undefined ? { materialHash: row.materialHash } : {}),
    ...(row.notBeforeAt !== undefined ? { notBeforeAt: row.notBeforeAt } : {}),
  });
  const due = (row: MemoryRow, now: Date) => row.processedAt === null &&
    (row.notBeforeAt == null || row.notBeforeAt <= now) &&
    (row.retryAt === null || row.retryAt <= now) && (row.claimedUntil === null || row.claimedUntil <= now);
  return {
    supportsSituationOutbox: false,
    async reconcileSituationOutbox() { return { changed: false, pending: false }; },
    async enqueue(input, now) {
      const event = normalizeEvent(input);
      const active = [...rows.values()].find((row) =>
        row.identity === event.identity && row.processedAt === null);
      if (active?.materialHash === event.materialHash) return { id: active.id, inserted: false };
      const existing = byKey.get(event.dedupeKey);
      const existingRow = existing ? rows.get(existing) : undefined;
      const sameMaterial = [...rows.values()]
        .filter((row) => row.identity === event.identity && row.materialHash === event.materialHash)
        .sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime())[0];
      const id = randomUUID();
      const previous = sameMaterial ?? existingRow;
      if (previous?.identity === event.identity &&
          previous.materialHash === event.materialHash &&
          previous.processedAt !== null &&
          !previous.reopenable) {
        return { id: previous.id, inserted: false };
      }
      const reopensPrevious = previous?.identity === event.identity &&
        previous.materialHash === event.materialHash &&
        previous.processedAt !== null &&
        previous.reopenable;
      if (reopensPrevious) {
        if (active) {
          active.processedAt = now;
          active.claimedUntil = null;
          active.outcome = 'superseded by material change';
          active.reopenable = true;
        }
        const archived = archivedDedupeKey(previous.dedupeKey, id);
        byKey.delete(previous.dedupeKey);
        previous.dedupeKey = archived;
        byKey.set(archived, previous.id);
      }
      if (previous && !reopensPrevious && !active && previous.identity !== event.identity) {
        return { id: previous.id, inserted: false };
      }
      if (active) {
        active.processedAt = now;
        active.claimedUntil = null;
        active.outcome = 'superseded by material change';
        active.reopenable = true;
      }
      const baseOccupied = byKey.has(event.dedupeKey);
      const dedupeKey = baseOccupied || active
        ? materialDedupeKey(event.dedupeKey, event.materialHash)
        : event.dedupeKey;
      rows.set(id, {
        id, source: event.source, kind: event.kind, dedupeKey, summary: event.summary,
        detail: event.detail, occurredAt: event.occurredAt, receivedAt: now, attempts: 0,
        identity: event.identity, materialHash: event.materialHash, notBeforeAt: event.notBeforeAt,
        claimedUntil: null, retryAt: null, processedAt: event.baseline ? now : null,
        outcome: event.baseline ? 'baseline' : null, batchId: null, reopenable: false,
      });
      byKey.set(dedupeKey, id);
      return { id, inserted: true };
    },
    async cancel(identity, now, reason) {
      let changed = false;
      for (const row of rows.values()) {
        if (row.identity !== identity || row.processedAt !== null) continue;
        row.processedAt = now;
        row.claimedUntil = null;
        row.outcome = reason.slice(0, 400);
        row.reopenable = true;
        changed = true;
      }
      return changed;
    },
    async hasWork(now) { return [...rows.values()].some((row) => due(row, now)); },
    async nextDueAt() {
      const times = [...rows.values()].filter((row) => row.processedAt === null)
        .map((row) => Math.max(
          row.retryAt?.getTime() ?? 0,
          row.claimedUntil?.getTime() ?? 0,
          row.notBeforeAt?.getTime() ?? 0,
          row.receivedAt.getTime(),
        ));
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
      for (const { id, outcome, batchId, reopenable } of settlements) {
        const row = rows.get(id);
        if (!row) continue;
        row.processedAt = now;
        row.claimedUntil = null;
        row.outcome = outcome.slice(0, 400);
        row.batchId = batchId ?? null;
        row.reopenable = reopenable === true;
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
    async startBatch(batchId, now, _eventCount, metadata) {
      if (batchIds.has(batchId)) return;
      const reservation = {
        at: new Date(now),
        activationType: metadata?.activationType ?? 'event',
        satisfiedSlot: metadata?.satisfiedSlot ?? null,
      } as const;
      batches.push(reservation);
      batchIds.set(batchId, reservation);
    },
    async reserveBatch(input) {
      const existing = batchIds.get(input.batchId);
      const last = batches.at(-1) ?? null;
      const sampled = input.sampleTime();
      const { at, dayStart, quiet, satisfiedSlot } = sampled;
      const used = batches.filter(({ at: createdAt }) => createdAt >= dayStart).length;
      if (existing) {
        return {
          allowed: true,
          status: { used, allowed: input.fallbackAllowed, last },
        };
      }
      const denied = (reason: NonNullable<EventBatchReserveResult['reason']>): EventBatchReserveResult => ({
        allowed: false,
        reason,
        status: { used, allowed: input.fallbackAllowed, last },
      });
      if (quiet && !input.allowQuiet) return denied('quiet_hours');
      if (used >= input.fallbackAllowed) return denied('daily_cap');
      if (last && at.getTime() - last.at.getTime() < input.minimumGapMs) return denied('spaced');
      const reservation = {
        at: new Date(at),
        activationType: input.activationType,
        satisfiedSlot,
      } as const;
      batches.push(reservation);
      batchIds.set(input.batchId, reservation);
      return {
        allowed: true,
        status: {
          used: used + 1,
          allowed: input.fallbackAllowed,
          last: reservation,
        },
      };
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
