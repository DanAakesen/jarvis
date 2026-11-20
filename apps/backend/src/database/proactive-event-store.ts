import { createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import {
  normalizeEvent,
  type EventBatchReserveResult,
  type EventQueueStore,
} from '../proactive/events/event-queue.js';
import type { QueuedEvent } from '../proactive/events/types.js';
import {
  PI_SITUATION_SCHEMA_VERSION,
  currentSituationFollowUpActions,
  parsePiSituationState,
  piSituationHash,
  type PiSituationFollowUpAction,
} from '../pi/situation.js';
import { proactiveSettingsFromRow, type ProactiveSettingsRow } from './proactive-store.js';
import { defaultProactiveSettings } from '../proactive/store.js';
import { effectiveProactiveBudget } from '../proactive/budget.js';
import { proactiveSettingsRevision } from '../proactive/preferences.js';
import { monthKey } from '../proactive/time.js';
import { LOCATION_FRESHNESS_MS } from '../proactive/sources/location.js';

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

function archivedDedupeKey(key: string, generationId: string): string {
  const archived = `${key}:archived:${generationId}`;
  if (archived.length <= 200) return archived;
  return `sha256:${createHash('sha256').update(archived).digest('hex')}`;
}

function materialDedupeKey(key: string, materialHash: string): string {
  return `${key.slice(0, 175)}:${materialHash.slice(0, 24)}`;
}

async function enqueueInTransaction(
  transaction: sql.Transaction,
  owner: string,
  input: Parameters<EventQueueStore['enqueue']>[0],
  now: Date,
): Promise<{ id: string; inserted: boolean }> {
  const event = normalizeEvent(input);
  const id = randomUUID();
  const lock = await new sql.Request(transaction)
    .input('owner', sql.UniqueIdentifier, owner)
    .input('identity', sql.NVarChar(200), event.identity)
    .query<{ id: string; material_hash: string | null }>(`DECLARE @lockResult int;
      DECLARE @resource nvarchar(255) =
        CONCAT(N'jarvis.proactive.event:', LOWER(CONVERT(nvarchar(36), @owner)), N':', @identity);
      EXEC @lockResult = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive',
        @LockOwner = 'Transaction', @LockTimeout = 10000;
      IF @lockResult < 0 THROW 51001, 'Could not acquire proactive event identity lock', 1;
      SELECT id, material_hash FROM dbo.proactive_events WITH (UPDLOCK, HOLDLOCK)
        WHERE owner_object_id = @owner AND identity_key = @identity AND processed_at IS NULL;`);
  const active = lock.recordset[0];
  if (active?.material_hash?.trim() === event.materialHash) {
    return { id: active.id.toLowerCase(), inserted: false };
  }
  const existing = await new sql.Request(transaction)
    .input('owner', sql.UniqueIdentifier, owner)
    .input('key', sql.NVarChar(200), event.dedupeKey)
    .input('identity', sql.NVarChar(200), event.identity)
    .input('material', sql.Char(64), event.materialHash)
    .query<{
      id: string;
      dedupe_key: string;
      identity_key: string | null;
      material_hash: string | null;
      outcome: string | null;
      reopenable: boolean;
    }>(
      `SELECT TOP (1) id, dedupe_key, identity_key, material_hash, outcome, reopenable
        FROM dbo.proactive_events WITH (UPDLOCK, HOLDLOCK)
        WHERE owner_object_id = @owner
          AND (dedupe_key = @key OR identity_key = @identity AND material_hash = @material)
        ORDER BY CASE WHEN identity_key = @identity AND material_hash = @material THEN 0 ELSE 1 END,
          received_at DESC, id DESC;`,
    );
  const previous = existing.recordset[0];
  if (previous?.identity_key === event.identity &&
      previous.material_hash?.trim() === event.materialHash &&
      !previous.reopenable) {
    return { id: previous.id.toLowerCase(), inserted: false };
  }
  const reopensPrevious = previous?.identity_key === event.identity &&
    previous.material_hash?.trim() === event.materialHash &&
    previous.reopenable === true;
  if (reopensPrevious) {
    if (active) {
      await new sql.Request(transaction)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('active', sql.UniqueIdentifier, active.id)
        .input('now', sql.DateTime2, now)
        .query(`UPDATE dbo.proactive_events
          SET processed_at = @now, claimed_until = NULL, reopenable = 1,
            outcome = N'superseded by material change'
          WHERE owner_object_id = @owner AND id = @active AND processed_at IS NULL;`);
    }
    await new sql.Request(transaction)
      .input('owner', sql.UniqueIdentifier, owner)
      .input('id', sql.UniqueIdentifier, previous.id)
      .input('archivedKey', sql.NVarChar(200), archivedDedupeKey(event.dedupeKey, id))
      .query(`UPDATE dbo.proactive_events
        SET dedupe_key = @archivedKey
        WHERE owner_object_id = @owner AND id = @id;`);
  }
  if (previous && !reopensPrevious && !active && previous.identity_key !== event.identity) {
    return { id: previous.id.toLowerCase(), inserted: false };
  }
  const dedupeKey = active || !reopensPrevious && previous?.dedupe_key === event.dedupeKey
    ? materialDedupeKey(event.dedupeKey, event.materialHash)
    : event.dedupeKey;
  if (active) {
    await new sql.Request(transaction)
      .input('owner', sql.UniqueIdentifier, owner)
      .input('active', sql.UniqueIdentifier, active.id)
      .input('now', sql.DateTime2, now)
      .query(`UPDATE dbo.proactive_events
        SET processed_at = @now, claimed_until = NULL, reopenable = 1,
          outcome = N'superseded by material change'
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
  return { id: recordset[0]!.id.toLowerCase(), inserted: true };
}

async function cancelInTransaction(
  transaction: sql.Transaction,
  owner: string,
  identity: string,
  now: Date,
  reason: string,
): Promise<boolean> {
  const identityValue = normalizeEvent({
    source: 'queue', kind: 'cancel', dedupeKey: identity, identity,
    summary: 'cancel', occurredAt: now,
  }).identity;
  const { rowsAffected } = await new sql.Request(transaction)
    .input('owner', sql.UniqueIdentifier, owner)
    .input('identity', sql.NVarChar(200), identityValue)
    .input('now', sql.DateTime2, now)
    .input('outcome', sql.NVarChar(400), reason.slice(0, 400))
    .query(`UPDATE dbo.proactive_events
      SET processed_at = @now, claimed_until = NULL, outcome = @outcome, reopenable = 1
      WHERE owner_object_id = @owner AND identity_key = @identity AND processed_at IS NULL;`);
  return (rowsAffected[0] ?? 0) > 0;
}

export function createProactiveEventStore(pool: sql.ConnectionPool, ownerObjectId: string): EventQueueStore {
  const owner = ownerObjectId.toLowerCase();
  const dueClause = `processed_at IS NULL AND (retry_at IS NULL OR retry_at <= @now)
    AND (claimed_until IS NULL OR claimed_until <= @now)
    AND (not_before_at IS NULL OR not_before_at <= @now)`;
  return {
    supportsSituationOutbox: true,
    async reconcileSituationOutbox(at, signal) {
      signal.throwIfAborted();
      const transaction = new sql.Transaction(pool);
      let activeRequest: sql.Request | undefined;
      const cancel = () => activeRequest?.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await transaction.begin();
        activeRequest = new sql.Request(transaction).input('owner', sql.UniqueIdentifier, owner);
        await activeRequest.query(`DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) =
            CONCAT(N'jarvis.pi.situation-outbox:', LOWER(CONVERT(nvarchar(36), @owner)));
          EXEC @lockResult = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive',
            @LockOwner = 'Transaction', @LockTimeout = 10000;
          IF @lockResult < 0 THROW 51001, 'Could not acquire PI situation outbox lock', 1;`);
        activeRequest = new sql.Request(transaction).input('owner', sql.UniqueIdentifier, owner);
        const settingsRow = await activeRequest.query<ProactiveSettingsRow>(`
          SELECT paused, monthly_budget_dkk, background_turns_per_day, sources_json,
            categories_json, suggestion_scope, news_feeds_json, guidance
          FROM dbo.proactive_settings WITH (UPDLOCK, HOLDLOCK)
          WHERE owner_object_id = @owner;`);
        const settings = settingsRow.recordset[0]
          ? proactiveSettingsFromRow(settingsRow.recordset[0])
          : defaultProactiveSettings();
        activeRequest = new sql.Request(transaction).input('owner', sql.UniqueIdentifier, owner);
        const state = await activeRequest.query<{
          schema_version: number;
          revision: string | number;
          state_json: string;
          content_hash: string;
        }>(`
          SELECT schema_version, revision, state_json, content_hash
          FROM dbo.pi_situational_state WITH (UPDLOCK, HOLDLOCK)
          WHERE owner_object_id = @owner;`);
        const currentRevision = state.recordset[0] ? Number(state.recordset[0].revision) : null;
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('now', sql.DateTime2, at)
          .input('current', sql.BigInt, currentRevision);
        await activeRequest.query(`UPDATE dbo.pi_situation_outbox
          SET applied_at = @now, outcome = CASE
            WHEN @current IS NULL OR situation_revision < @current THEN N'superseded_revision'
            ELSE outcome END
          WHERE owner_object_id = @owner AND applied_at IS NULL
            AND (@current IS NULL OR situation_revision < @current);`);
        if (currentRevision === null) {
          await transaction.commit();
          return { changed: false, pending: false };
        }
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('revision', sql.BigInt, currentRevision);
        const pending = await activeRequest.query<{ actions_json: string }>(`
          SELECT actions_json FROM dbo.pi_situation_outbox WITH (UPDLOCK, HOLDLOCK)
          WHERE owner_object_id = @owner AND situation_revision = @revision
            AND applied_at IS NULL;`);
        let pendingLater = false;
        if (!pending.recordset[0]) {
          const later = await transaction.request()
            .input('owner', sql.UniqueIdentifier, owner)
            .input('revision', sql.BigInt, currentRevision)
            .query<{ count: number }>(`SELECT COUNT(*) AS count
              FROM dbo.pi_situation_outbox
              WHERE owner_object_id = @owner AND applied_at IS NULL
                AND situation_revision > @revision;`);
          pendingLater = Number(later.recordset[0]?.count ?? 0) > 0;
        }
        const stateValue = parsePiSituationState(JSON.parse(state.recordset[0]!.state_json));
        if (state.recordset[0]!.schema_version !== PI_SITUATION_SCHEMA_VERSION ||
            state.recordset[0]!.content_hash.trim() !== piSituationHash(stateValue)) {
          throw new Error('PI situation outbox state hash is invalid');
        }
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner);
        const sourceStatuses = await activeRequest.query<{
          source_id: keyof typeof settings.sources;
          state: 'ok' | 'unavailable' | 'stale';
          observed_at: Date | string | null;
          invalidated_at: Date | string | null;
        }>(`SELECT source_id, state, observed_at, invalidated_at
          FROM dbo.proactive_source_status
          WHERE owner_object_id = @owner;`);
        const statusBySource = new Map(sourceStatuses.recordset.map((row) =>
          [row.source_id, row] as const));
        const currentState = {
          ...stateValue,
          sources: stateValue.sources.map((source) => {
            const status = statusBySource.get(source.id);
            if (!settings.sources[source.id]) return { ...source, state: 'disabled' as const };
            if (!status) return source;
            const observedAt = status.observed_at
              ? (status.observed_at instanceof Date
                ? status.observed_at
                : new Date(status.observed_at))
              : null;
            const locationStale = source.id === 'location' && observedAt !== null &&
              at.getTime() - observedAt.getTime() > LOCATION_FRESHNESS_MS;
            const invalidated = status.invalidated_at !== null &&
              observedAt !== null &&
              observedAt.getTime() <= (status.invalidated_at instanceof Date
                ? status.invalidated_at
                : new Date(status.invalidated_at)).getTime();
            return {
              ...source,
              state: status.state === 'stale' || invalidated || locationStale ? 'stale' as const
                : status.state === 'ok' && observedAt !== null ? 'fresh' as const
                  : 'missing' as const,
              observedAt: observedAt?.toISOString() ?? null,
            };
          }),
        };
        const desiredActions = currentSituationFollowUpActions(currentState, settings, at);
        const desiredIdentities = new Set(desiredActions.map((action) =>
          action.operation === 'upsert' ? action.event.identity : action.identity));
        let parsed: unknown;
        if (pending.recordset[0]) {
          try { parsed = JSON.parse(pending.recordset[0].actions_json); }
          catch { throw new Error('PI situation outbox is not valid JSON'); }
        } else parsed = [];
        if (!Array.isArray(parsed) || parsed.length > 32) {
          throw new Error('PI situation outbox actions are invalid');
        }
        let changed = false;
        for (const raw of parsed) {
          signal.throwIfAborted();
          const action = raw as PiSituationFollowUpAction;
          if (!action || typeof action !== 'object' ||
              (action.operation !== 'upsert' && action.operation !== 'cancel')) {
            throw new Error('PI situation outbox action is invalid');
          }
          if (action.operation === 'cancel') {
            changed = await cancelInTransaction(
              transaction,
              owner,
              action.identity,
              at,
              'follow-up cancelled or invalidated',
            ) || changed;
            continue;
          }
          const evidenceSources = Array.isArray(action.event.detail.evidenceSources)
            ? action.event.detail.evidenceSources.filter((value): value is keyof typeof settings.sources =>
              typeof value === 'string' && Object.hasOwn(settings.sources, value))
            : [];
          if (evidenceSources.some((source) => !settings.sources[source])) {
            changed = await cancelInTransaction(
              transaction,
              owner,
              action.event.identity,
              at,
              'follow-up source disabled',
            ) || changed;
            continue;
          }
          const queued = await enqueueInTransaction(transaction, owner, {
            source: action.event.source,
            kind: action.event.kind,
            identity: action.event.identity,
            material: action.event.material,
            dedupeKey: action.event.dedupeKey,
            summary: action.event.summary,
            detail: action.event.detail,
            occurredAt: new Date(action.event.occurredAt),
            notBeforeAt: new Date(action.event.notBeforeAt),
          }, at);
          changed ||= queued.inserted;
        }
        for (const desired of desiredActions) {
          if (desired.operation !== 'upsert') continue;
          const queued = await enqueueInTransaction(transaction, owner, {
            ...desired.event,
            occurredAt: new Date(desired.event.occurredAt),
            notBeforeAt: new Date(desired.event.notBeforeAt),
          }, at);
          changed ||= queued.inserted;
        }
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner);
        const activeFollowUps = await activeRequest.query<{ id: string; identity_key: string }>(`
          SELECT id, identity_key FROM dbo.proactive_events
          WHERE owner_object_id = @owner AND source = N'followup' AND processed_at IS NULL;`);
        for (const row of activeFollowUps.recordset) {
          if (desiredIdentities.has(row.identity_key)) continue;
          changed = await cancelInTransaction(
            transaction,
            owner,
            row.identity_key,
            at,
            'follow-up no longer in current situation',
          ) || changed;
        }
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('revision', sql.BigInt, currentRevision)
          .input('now', sql.DateTime2, at);
        await activeRequest.query(`UPDATE dbo.pi_situation_outbox
          SET applied_at = @now, outcome = N'applied'
          WHERE owner_object_id = @owner AND situation_revision = @revision
            AND applied_at IS NULL;`);
        await transaction.commit();
        return { changed, pending: pendingLater };
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve reconciliation error. */ }
        throw error;
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
    async enqueue(input, now) {
      const event = normalizeEvent(input);
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin();
        const result = await enqueueInTransaction(transaction, owner, input, now);
        await transaction.commit();
        return result;
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
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin();
        const changed = await cancelInTransaction(transaction, owner, identity, now, reason);
        await transaction.commit();
        return changed;
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve cancel error. */ }
        throw error;
      }
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
        .query<{ due_at: Date | string }>(`SELECT TOP (1) due.due_at
          FROM dbo.proactive_events AS e
          CROSS APPLY (
            SELECT MAX(value) AS due_at FROM (
              VALUES
                (e.received_at),
                (COALESCE(e.not_before_at, e.received_at)),
                (COALESCE(e.retry_at, e.received_at)),
                (COALESCE(e.claimed_until, e.received_at))
            ) AS times(value)
          ) AS due
          WHERE e.owner_object_id = @owner AND e.processed_at IS NULL
          ORDER BY due.due_at, e.id;`);
      return recordset[0] ? date(recordset[0].due_at) : null;
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
      for (const { id, outcome, batchId, reopenable } of settlements) {
        await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .input('id', sql.UniqueIdentifier, id)
          .input('now', sql.DateTime2, now)
          .input('outcome', sql.NVarChar(400), outcome.slice(0, 400))
          .input('batch', sql.UniqueIdentifier, batchId ?? null)
          .input('reopenable', sql.Bit, reopenable === true)
          .query(`UPDATE dbo.proactive_events SET processed_at = @now, claimed_until = NULL,
              outcome = @outcome, batch_id = @batch, reopenable = @reopenable
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
        await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .query(`DECLARE @lockResult int;
            DECLARE @resource nvarchar(255) =
              CONCAT(N'jarvis.pi.background:', LOWER(CONVERT(nvarchar(36), @owner)));
            EXEC @lockResult = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive',
              @LockOwner = 'Transaction', @LockTimeout = 10000;
            IF @lockResult < 0 THROW 51001, 'Could not acquire PI background slot lock', 1;`);
        const sampled = input.sampleTime();
        if (!Number.isFinite(sampled.at.getTime()) || !Number.isFinite(sampled.dayStart.getTime())) {
          throw new RangeError('Invalid PI background reservation time');
        }
        if (!Number.isFinite(input.worstCaseDkk) || input.worstCaseDkk < 0) {
          throw new RangeError('Invalid PI background worst-case cost');
        }
        const policyRow = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .query<ProactiveSettingsRow>(`SELECT paused, monthly_budget_dkk, background_turns_per_day,
              sources_json, categories_json, suggestion_scope, news_feeds_json, guidance
            FROM dbo.proactive_settings WITH (UPDLOCK, HOLDLOCK)
            WHERE owner_object_id = @owner;`);
        const settings = policyRow.recordset[0]
          ? proactiveSettingsFromRow(policyRow.recordset[0])
          : defaultProactiveSettings();
        const policyMatches = proactiveSettingsRevision(settings) === input.expectedPolicyRevision;
        const { recordset } = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('id', sql.UniqueIdentifier, input.batchId)
          .input('at', sql.DateTime2, sampled.at)
          .input('dayStart', sql.DateTime2, sampled.dayStart)
          .input('count', sql.Int, input.eventCount)
          .input('activationType', sql.VarChar(10), input.activationType)
          .input('satisfiedSlot', sql.NVarChar(16), sampled.satisfiedSlot)
          .input('allowQuiet', sql.Bit, input.allowQuiet)
          .input('quiet', sql.Bit, sampled.quiet)
          .input('minimumGapMs', sql.Int, input.minimumGapMs)
          .input('fallbackAllowed', sql.Int, input.fallbackAllowed)
          .input('allowedTurns', sql.Int, Math.min(input.fallbackAllowed, settings.backgroundTurnsPerDay))
          .input('paused', sql.Bit, settings.paused)
          .input('policyMatches', sql.Bit, policyMatches)
          .input('policyRevision', sql.Char(64), input.expectedPolicyRevision)
          .input('budgetLimit', sql.Decimal(9, 4), effectiveProactiveBudget(settings.monthlyBudgetDkk))
          .input('worstCase', sql.Decimal(9, 4), input.worstCaseDkk)
          .input('monthKey', sql.Char(7), monthKey(sampled.at))
          .query<{
            allowed: boolean;
            reason: EventBatchReserveResult['reason'] | null;
            used: number;
            allowed_turns: number;
            last_at: Date | string | null;
            activation_type: 'event' | 'scheduled' | null;
            satisfied_slot: string | null;
          }>(`IF @allowedTurns < 1 SET @allowedTurns = @fallbackAllowed;
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
            DECLARE @spent decimal(19,4) = (
              SELECT ISNULL(SUM(estimated_dkk), 0) FROM dbo.proactive_spend WITH (UPDLOCK, HOLDLOCK)
                WHERE owner_object_id = @owner AND month_key = @monthKey
            );
            DECLARE @reserved decimal(19,4) = (
              SELECT ISNULL(SUM(reserved_dkk), 0) FROM dbo.proactive_event_batches WITH (UPDLOCK, HOLDLOCK)
                WHERE owner_object_id = @owner AND month_key = @monthKey AND actual_dkk IS NULL
            );
            DECLARE @existingPolicy char(64);
            DECLARE @existingBatch bit = 0;
            SELECT @existingPolicy = policy_revision FROM dbo.proactive_event_batches
              WHERE owner_object_id = @owner AND id = @id;
            SELECT @existingBatch = 1 FROM dbo.proactive_event_batches
              WHERE owner_object_id = @owner AND id = @id;
            DECLARE @reason varchar(16);

            IF @policyMatches = 0 OR @existingBatch = 1
                AND (@existingPolicy IS NULL OR @existingPolicy <> @policyRevision)
              SET @reason = 'policy_changed';
            ELSE IF EXISTS (SELECT 1 FROM dbo.proactive_event_batches
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
            ELSE IF @spent + @reserved + @worstCase > @budgetLimit
              SET @reason = 'budget_exhausted';
            ELSE
            BEGIN
              INSERT dbo.proactive_event_batches (
                id, owner_object_id, created_at, event_count, activation_type, satisfied_slot,
                policy_revision, month_key, reserved_dkk
              ) VALUES (
                @id, @owner, @at, @count, @activationType, @satisfiedSlot,
                @policyRevision, @monthKey, @worstCase
              );
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
