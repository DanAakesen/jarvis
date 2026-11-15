import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import { normalizeEvent, type EventQueueStore } from '../proactive/events/event-queue.js';
import type { QueuedEvent } from '../proactive/events/types.js';

interface EventRow {
  id: string;
  source: string;
  kind: string;
  dedupe_key: string;
  summary: string;
  detail_json: string;
  occurred_at: Date | string;
  received_at: Date | string;
  attempts: number;
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(row: EventRow): QueuedEvent {
  let detail: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.detail_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) detail = parsed as Record<string, unknown>;
  } catch { /* A row that cannot be parsed still carries its summary. */ }
  return {
    id: row.id.toLowerCase(), source: row.source, kind: row.kind, dedupeKey: row.dedupe_key, summary: row.summary,
    detail, occurredAt: date(row.occurred_at), receivedAt: date(row.received_at), attempts: row.attempts,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'number' in error &&
    (error.number === 2601 || error.number === 2627);
}

export function createProactiveEventStore(pool: sql.ConnectionPool, ownerObjectId: string): EventQueueStore {
  const owner = ownerObjectId.toLowerCase();
  const dueClause = `processed_at IS NULL AND (retry_at IS NULL OR retry_at <= @now)
    AND (claimed_until IS NULL OR claimed_until <= @now)`;
  return {
    async enqueue(input, now) {
      const event = normalizeEvent(input);
      const id = randomUUID();
      const request = () => pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('key', sql.NVarChar(200), event.dedupeKey);
      try {
        const { recordset } = await request()
          .input('id', sql.UniqueIdentifier, id)
          .input('source', sql.NVarChar(64), event.source)
          .input('kind', sql.NVarChar(96), event.kind)
          .input('summary', sql.NVarChar(400), event.summary)
          .input('detail', sql.NVarChar(sql.MAX), JSON.stringify(event.detail))
          .input('occurredAt', sql.DateTime2, event.occurredAt)
          .input('now', sql.DateTime2, now)
          .input('processedAt', sql.DateTime2, event.baseline ? now : null)
          .input('outcome', sql.NVarChar(400), event.baseline ? 'baseline' : null)
          .query<{ id: string }>(`INSERT dbo.proactive_events
              (id, owner_object_id, source, kind, dedupe_key, summary, detail_json, occurred_at, received_at, processed_at, outcome)
            OUTPUT inserted.id
            SELECT @id, @owner, @source, @kind, @key, @summary, @detail, @occurredAt, @now, @processedAt, @outcome
            WHERE NOT EXISTS (SELECT 1 FROM dbo.proactive_events WITH (UPDLOCK, HOLDLOCK)
              WHERE owner_object_id = @owner AND dedupe_key = @key);`);
        if (recordset[0]) return { id: recordset[0].id.toLowerCase(), inserted: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
      const { recordset } = await request().query<{ id: string }>(`SELECT id FROM dbo.proactive_events
        WHERE owner_object_id = @owner AND dedupe_key = @key;`);
      if (!recordset[0]) throw new Error('Proactive event could not be queued');
      return { id: recordset[0].id.toLowerCase(), inserted: false };
    },

    async hasWork(now) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('now', sql.DateTime2, now)
        .query(`SELECT TOP (1) 1 AS due FROM dbo.proactive_events WHERE owner_object_id = @owner AND ${dueClause};`);
      return recordset.length > 0;
    },

    async nextDueAt() {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .query<{ received_at: Date | string; retry_at: Date | string | null; claimed_until: Date | string | null }>(
          `SELECT TOP (200) received_at, retry_at, claimed_until FROM dbo.proactive_events
            WHERE owner_object_id = @owner AND processed_at IS NULL ORDER BY received_at;`);
      const times = recordset.map((row) => Math.max(
        date(row.received_at).getTime(),
        row.retry_at ? date(row.retry_at).getTime() : 0,
        row.claimed_until ? date(row.claimed_until).getTime() : 0,
      ));
      return times.length ? new Date(Math.min(...times)) : null;
    },

    async claim(now, limit, leaseMs) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('now', sql.DateTime2, now)
        .input('until', sql.DateTime2, new Date(now.getTime() + leaseMs))
        .input('limit', sql.Int, limit)
        .query<EventRow>(`WITH due AS (
            SELECT TOP (@limit) * FROM dbo.proactive_events WITH (UPDLOCK, READPAST, ROWLOCK)
            WHERE owner_object_id = @owner AND ${dueClause}
            ORDER BY received_at, id)
          UPDATE due SET claimed_until = @until, attempts = attempts + 1
          OUTPUT inserted.id, inserted.source, inserted.kind, inserted.dedupe_key, inserted.summary,
            inserted.detail_json, inserted.occurred_at, inserted.received_at, inserted.attempts;`);
      return recordset.map(mapRow).sort((left, right) => left.receivedAt.getTime() - right.receivedAt.getTime());
    },

    async settle(settlements, now) {
      for (const { id, outcome, batchId } of settlements) {
        await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .input('id', sql.UniqueIdentifier, id)
          .input('now', sql.DateTime2, now)
          .input('outcome', sql.NVarChar(400), outcome.slice(0, 400))
          .input('batch', sql.UniqueIdentifier, batchId ?? null)
          .query(`UPDATE dbo.proactive_events SET processed_at = @now, claimed_until = NULL,
              outcome = @outcome, batch_id = @batch
            WHERE owner_object_id = @owner AND id = @id AND processed_at IS NULL;`);
      }
    },

    async retryLater(ids, retryAt) {
      for (const id of ids) {
        await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .input('id', sql.UniqueIdentifier, id)
          .input('retryAt', sql.DateTime2, retryAt)
          .query(`UPDATE dbo.proactive_events SET claimed_until = NULL, retry_at = @retryAt
            WHERE owner_object_id = @owner AND id = @id AND processed_at IS NULL;`);
      }
    },

    async modelBatchesSince(since) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('since', sql.DateTime2, since)
        .query<{ count: number }>(`SELECT COUNT(DISTINCT batch_id) AS count FROM dbo.proactive_events
          WHERE owner_object_id = @owner AND batch_id IS NOT NULL AND processed_at >= @since;`);
      return recordset[0]?.count ?? 0;
    },

    async escalatedSince(source, since) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('source', sql.NVarChar(64), source)
        .input('since', sql.DateTime2, since)
        .query<{ count: number }>(`SELECT COUNT(*) AS count FROM dbo.proactive_events
          WHERE owner_object_id = @owner AND source = @source AND batch_id IS NOT NULL AND processed_at >= @since;`);
      return recordset[0]?.count ?? 0;
    },

    async hasSource(source) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('source', sql.NVarChar(64), source)
        .query(`SELECT TOP (1) 1 AS found FROM dbo.proactive_events WHERE owner_object_id = @owner AND source = @source;`);
      return recordset.length > 0;
    },

    async purge(olderThan) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('before', sql.DateTime2, olderThan)
        .query<{ removed: number }>(`DELETE FROM dbo.proactive_events
          WHERE owner_object_id = @owner AND processed_at < @before;
          SELECT @@ROWCOUNT AS removed;`);
      return recordset[0]?.removed ?? 0;
    },
  };
}
