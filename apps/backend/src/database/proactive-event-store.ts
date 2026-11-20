import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import {
  normalizeEvent,
  type EventBatchReserveResult,
  type EventQueueStore,
} from '../proactive/events/event-queue.js';
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
  identity_key: string | null;
  material_hash: string | null;
  not_before_at: Date | string | null;
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
    identity: row.identity_key, materialHash: row.material_hash?.trim() ?? null,
    notBeforeAt: row.not_before_at ? date(row.not_before_at) : null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'number' in error &&
    (error.number === 2601 || error.number === 2627);
}

export function createProactiveEventStore(pool: sql.ConnectionPool, ownerObjectId: string): EventQueueStore {
  const owner = ownerObjectId.toLowerCase();
  const dueClause = `processed_at IS NULL AND (retry_at IS NULL OR retry_at <= @now)
    AND (claimed_until IS NULL OR claimed_until <= @now)
    AND (not_before_at IS NULL OR not_before_at <= @now)`;
  return {
    async enqueue(input, now) {
      const event = normalizeEvent(input);
      const id = randomUUID();
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin();
        const lock = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('identity', sql.NVarChar(200), event.identity)
          .input('id', sql.UniqueIdentifier, id)
          .query<{ id: string; material_hash: string | null }>(`DECLARE @lockResult int;
            DECLARE @resource nvarchar(255) =
              CONCAT(N'jarvis.proactive.event:', LOWER(CONVERT(nvarchar(36), @owner)), N':', @identity);
            EXEC @lockResult = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive',
              @LockOwner = 'Transaction', @LockTimeout = 10000;
            IF @lockResult < 0 THROW 51001, 'Could not acquire proactive event identity lock', 1;
            SELECT id, material_hash FROM dbo.proactive_events WITH (UPDLOCK, HOLDLOCK)
              WHERE owner_object_id = @owner AND identity_key = @identity AND processed_at IS NULL;`);
        const active = lock.recordset[0];
        const activeMatches = active?.material_hash?.trim() === event.materialHash;
        if (activeMatches) {
          await transaction.commit();
          return { id: active.id.toLowerCase(), inserted: false };
        }
        const existing = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('key', sql.NVarChar(200), event.dedupeKey)
          .query<{ id: string; identity_key: string | null; material_hash: string | null; outcome: string | null }>(`SELECT id, identity_key, material_hash, outcome FROM dbo.proactive_events
            WHERE owner_object_id = @owner AND dedupe_key = @key;`);
        const previous = existing.recordset[0];
        const reopensCancelled = previous?.outcome?.startsWith('follow-up cancelled') === true;
        const reopensSuperseded = active !== undefined &&
          previous?.outcome === 'superseded by material change';
        if (previous?.identity_key === event.identity &&
            previous.material_hash?.trim() === event.materialHash &&
            (reopensCancelled || reopensSuperseded)) {
          if (active) {
            await new sql.Request(transaction)
              .input('owner', sql.UniqueIdentifier, owner)
              .input('active', sql.UniqueIdentifier, active.id)
              .input('now', sql.DateTime2, now)
              .query(`UPDATE dbo.proactive_events
                SET processed_at = @now, claimed_until = NULL, outcome = N'superseded by material change'
                WHERE owner_object_id = @owner AND id = @active AND processed_at IS NULL;`);
          }
          await new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, owner)
            .input('id', sql.UniqueIdentifier, previous.id)
            .input('now', sql.DateTime2, now)
            .input('notBeforeAt', sql.DateTime2, event.notBeforeAt)
            .query(`UPDATE dbo.proactive_events
              SET processed_at = NULL, outcome = NULL, received_at = @now,
                claimed_until = NULL, retry_at = NULL, attempts = 0, not_before_at = @notBeforeAt
              WHERE owner_object_id = @owner AND id = @id;`);
          await transaction.commit();
          return { id: previous.id.toLowerCase(), inserted: true };
        }
        const collidesWithActive = active && existing.recordset[0]?.id.toLowerCase() === active.id.toLowerCase();
        if (existing.recordset[0] && !collidesWithActive) {
          await transaction.commit();
          return { id: existing.recordset[0].id.toLowerCase(), inserted: false };
        }
        const dedupeKey = collidesWithActive
          ? `${event.dedupeKey.slice(0, 175)}:${event.materialHash.slice(0, 24)}`
          : event.dedupeKey;
        if (active) {
          await new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, owner)
            .input('active', sql.UniqueIdentifier, active.id)
            .input('now', sql.DateTime2, now)
            .query(`UPDATE dbo.proactive_events
              SET processed_at = @now, claimed_until = NULL, outcome = N'superseded by material change'
              WHERE owner_object_id = @owner AND id = @active AND processed_at IS NULL;`);
        }
        const { recordset } = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('source', sql.NVarChar(64), event.source)
          .input('kind', sql.NVarChar(96), event.kind)
          .input('id', sql.UniqueIdentifier, id)
          .input('key', sql.NVarChar(200), dedupeKey)
          .input('summary', sql.NVarChar(400), event.summary)
          .input('detail', sql.NVarChar(sql.MAX), JSON.stringify(event.detail))
          .input('occurredAt', sql.DateTime2, event.occurredAt)
          .input('identity', sql.NVarChar(200), event.identity)
          .input('material', sql.Char(64), event.materialHash)
          .input('notBeforeAt', sql.DateTime2, event.notBeforeAt)
          .input('now', sql.DateTime2, now)
          .input('processedAt', sql.DateTime2, event.baseline ? now : null)
          .input('outcome', sql.NVarChar(400), event.baseline ? 'baseline' : null)
          .query<{ id: string }>(`INSERT dbo.proactive_events
              (id, owner_object_id, source, kind, dedupe_key, summary, detail_json, occurred_at, received_at,
                processed_at, outcome, identity_key, material_hash, not_before_at)
            OUTPUT inserted.id
            VALUES (
              @id, @owner, @source, @kind, @key, @summary, @detail, @occurredAt, @now,
              @processedAt, @outcome, @identity, @material, @notBeforeAt
            );`);
        await transaction.commit();
        return { id: recordset[0]!.id.toLowerCase(), inserted: true };
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve the enqueue error. */ }
        if (isUniqueViolation(error)) {
          const { recordset } = await pool.request()
            .input('owner', sql.UniqueIdentifier, owner)
            .input('key', sql.NVarChar(200), event.dedupeKey)
            .query<{ id: string }>(`SELECT id FROM dbo.proactive_events
              WHERE owner_object_id = @owner AND dedupe_key = @key;`);
          if (recordset[0]) return { id: recordset[0].id.toLowerCase(), inserted: false };
        }
        throw error;
      }
    },

    async cancel(identity, now, reason) {
      const identityValue = normalizeEvent({
        source: 'queue', kind: 'cancel', dedupeKey: identity, identity,
        summary: 'cancel', occurredAt: now,
      }).identity;
      const { rowsAffected } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('identity', sql.NVarChar(200), identityValue)
        .input('now', sql.DateTime2, now)
        .input('outcome', sql.NVarChar(400), reason.slice(0, 400))
        .query(`UPDATE dbo.proactive_events
          SET processed_at = @now, claimed_until = NULL, outcome = @outcome
          WHERE owner_object_id = @owner AND identity_key = @identity AND processed_at IS NULL;`);
      return (rowsAffected[0] ?? 0) > 0;
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
        .query<{ received_at: Date | string; retry_at: Date | string | null; claimed_until: Date | string | null; not_before_at: Date | string | null }>(
          `SELECT TOP (200) received_at, retry_at, claimed_until, not_before_at FROM dbo.proactive_events
            WHERE owner_object_id = @owner AND processed_at IS NULL ORDER BY received_at;`);
      const times = recordset.map((row) => Math.max(
        date(row.received_at).getTime(),
        row.not_before_at ? date(row.not_before_at).getTime() : 0,
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
            inserted.detail_json, inserted.occurred_at, inserted.received_at, inserted.attempts,
            inserted.identity_key, inserted.material_hash, inserted.not_before_at;`);
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

    async startBatch(batchId, now, eventCount, metadata) {
      await pool.request()
        .input('id', sql.UniqueIdentifier, batchId)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('now', sql.DateTime2, now)
        .input('count', sql.Int, eventCount)
        .input('activationType', sql.VarChar(10), metadata?.activationType ?? 'event')
        .input('satisfiedSlot', sql.NVarChar(16), metadata?.satisfiedSlot ?? null)
        .query(`INSERT dbo.proactive_event_batches (
            id, owner_object_id, created_at, event_count, activation_type, satisfied_slot
          ) VALUES (@id, @owner, @now, @count, @activationType, @satisfiedSlot);`);
    },

    async reserveBatch(input) {
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin();
        const { recordset } = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('id', sql.UniqueIdentifier, input.batchId)
          .input('at', sql.DateTime2, input.at)
          .input('dayStart', sql.DateTime2, input.dayStart)
          .input('count', sql.Int, input.eventCount)
          .input('activationType', sql.VarChar(10), input.activationType)
          .input('satisfiedSlot', sql.NVarChar(16), input.satisfiedSlot)
          .input('allowQuiet', sql.Bit, input.allowQuiet)
          .input('quiet', sql.Bit, input.quiet)
          .input('minimumGapMs', sql.Int, input.minimumGapMs)
          .input('fallbackAllowed', sql.Int, input.fallbackAllowed)
          .query<{
            allowed: boolean;
            reason: EventBatchReserveResult['reason'] | null;
            used: number;
            allowed_turns: number;
            last_at: Date | string | null;
            activation_type: 'event' | 'scheduled' | null;
            satisfied_slot: string | null;
          }>(`DECLARE @lockResult int;
            DECLARE @resource nvarchar(255) =
              CONCAT(N'jarvis.pi.background:', LOWER(CONVERT(nvarchar(36), @owner)));
            EXEC @lockResult = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive',
              @LockOwner = 'Transaction', @LockTimeout = 10000;
            IF @lockResult < 0 THROW 51001, 'Could not acquire PI background slot lock', 1;

            DECLARE @paused bit = 0;
            DECLARE @allowedTurns int = @fallbackAllowed;
            SELECT @paused = paused, @allowedTurns = background_turns_per_day
              FROM dbo.proactive_settings WITH (UPDLOCK, HOLDLOCK)
              WHERE owner_object_id = @owner;
            IF @allowedTurns < 1 SET @allowedTurns = @fallbackAllowed;
            IF @allowedTurns > @fallbackAllowed SET @allowedTurns = @fallbackAllowed;

            DECLARE @used int = (
              SELECT COUNT(*) FROM dbo.proactive_event_batches WITH (UPDLOCK, HOLDLOCK)
                WHERE owner_object_id = @owner AND created_at >= @dayStart
            );
            DECLARE @lastAt datetime2(7);
            DECLARE @lastType varchar(10);
            DECLARE @lastSlot nvarchar(16);
            SELECT TOP (1) @lastAt = created_at, @lastType = activation_type, @lastSlot = satisfied_slot
              FROM dbo.proactive_event_batches WITH (UPDLOCK, HOLDLOCK)
              WHERE owner_object_id = @owner
              ORDER BY created_at DESC, id DESC;
            DECLARE @reason varchar(16);

            IF EXISTS (SELECT 1 FROM dbo.proactive_event_batches
                WHERE owner_object_id = @owner AND id = @id)
              SET @reason = NULL;
            ELSE IF @paused = 1
              SET @reason = 'paused';
            ELSE IF @quiet = 1 AND @allowQuiet = 0
              SET @reason = 'quiet_hours';
            ELSE IF @used >= @allowedTurns
              SET @reason = 'daily_cap';
            ELSE IF @lastAt IS NOT NULL
                AND DATEDIFF_BIG(millisecond, @lastAt, @at) < @minimumGapMs
              SET @reason = 'spaced';
            ELSE
            BEGIN
              INSERT dbo.proactive_event_batches (
                id, owner_object_id, created_at, event_count, activation_type, satisfied_slot
              ) VALUES (@id, @owner, @at, @count, @activationType, @satisfiedSlot);
              SET @used += 1;
              SET @lastAt = @at;
              SET @lastType = @activationType;
              SET @lastSlot = @satisfiedSlot;
            END;

            SELECT CAST(CASE WHEN @reason IS NULL THEN 1 ELSE 0 END AS bit) AS allowed,
              @reason AS reason, @used AS used, @allowedTurns AS allowed_turns,
              @lastAt AS last_at, @lastType AS activation_type, @lastSlot AS satisfied_slot;`);
        await transaction.commit();
        const row = recordset[0]!;
        const last = row.last_at ? {
          at: date(row.last_at),
          activationType: row.activation_type!,
          satisfiedSlot: row.satisfied_slot,
        } : null;
        return {
          allowed: row.allowed,
          ...(row.reason ? { reason: row.reason } : {}),
          status: { used: Number(row.used), allowed: Number(row.allowed_turns), last },
        };
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve the reservation error. */ }
        throw error;
      }
    },

    async modelBatchesSince(since) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('since', sql.DateTime2, since)
        .query<{ count: number }>(`SELECT COUNT(*) AS count FROM dbo.proactive_event_batches
          WHERE owner_object_id = @owner AND created_at >= @since;`);
      return recordset[0]?.count ?? 0;
    },

    async lastBatch() {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .query<{ last_at: Date | string; activation_type: 'event' | 'scheduled'; satisfied_slot: string | null }>(
          `SELECT TOP (1) created_at AS last_at, activation_type, satisfied_slot
            FROM dbo.proactive_event_batches
            WHERE owner_object_id=@owner
            ORDER BY created_at DESC, id DESC;`);
      const row = recordset[0];
      return row ? {
        at: date(row.last_at),
        activationType: row.activation_type,
        satisfiedSlot: row.satisfied_slot,
      } : null;
    },

    async recovery(now) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('now', sql.DateTime2, now)
        .query<{ pending: number; leased: number; retrying: number }>(`
          SELECT
            COUNT_BIG(*) AS pending,
            SUM(CASE WHEN claimed_until > @now THEN 1 ELSE 0 END) AS leased,
            SUM(CASE WHEN retry_at > @now THEN 1 ELSE 0 END) AS retrying
          FROM dbo.proactive_events
          WHERE owner_object_id=@owner AND processed_at IS NULL;`);
      return {
        pending: Number(recordset[0]?.pending ?? 0),
        leased: Number(recordset[0]?.leased ?? 0),
        retrying: Number(recordset[0]?.retrying ?? 0),
      };
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
