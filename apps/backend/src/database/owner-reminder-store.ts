import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type {
  ClaimedOwnerReminderDelivery,
  NewOwnerReminder,
  OwnerReminderCadence,
  OwnerReminderDelivery,
  OwnerReminderDeliveryStore,
  OwnerReminderProvider,
  OwnerReminderProviderOutcome,
  OwnerReminderSchedule,
  OwnerReminderState,
  OwnerReminderStore,
  OwnerReminderUpdate,
} from '../proactive/owner-reminder-store.js';
import { summarizeOwnerReminderDeliveries } from '../proactive/owner-reminder-store.js';

interface OwnerReminderDatabaseRow {
  id: string;
  idempotency_key: string;
  task_identity: string;
  task_title: string;
  fire_at: Date | string;
  local_time: string;
  anchor_date: string | null;
  cadence: OwnerReminderCadence | null;
  until_task_done: boolean;
  state: OwnerReminderState;
  reason: string | null;
  verify_attempts: number;
  send_attempts: number;
  next_attempt_at: Date | string | null;
  item_id: string | null;
  last_fire_at: Date | string | null;
  last_delivery: OwnerReminderDelivery;
  last_provider: OwnerReminderProvider;
  last_provider_outcome: OwnerReminderProviderOutcome;
  last_provider_status_code: number | null;
  recipient_count: number;
  accepted_recipient_count: number;
  claim_token: string | null;
  lease_until: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const columns = `id, idempotency_key, task_identity, task_title, fire_at, local_time, anchor_date, cadence,
  until_task_done, state, reason, verify_attempts, send_attempts, next_attempt_at, item_id, last_fire_at,
  last_delivery, last_provider, last_provider_outcome, last_provider_status_code, recipient_count, accepted_recipient_count,
  claim_token, lease_until, created_at, updated_at`;
const outputColumns = columns.split(/\s*,\s*/u).map((column) => `inserted.${column}`).join(', ');

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(row: OwnerReminderDatabaseRow): OwnerReminderSchedule {
  return {
    id: row.id.toLowerCase(),
    idempotencyKey: row.idempotency_key,
    taskIdentity: row.task_identity,
    taskTitle: row.task_title,
    fireAt: date(row.fire_at),
    localTime: row.local_time,
    anchorDate: row.anchor_date,
    cadence: row.cadence,
    untilTaskDone: row.until_task_done,
    state: row.state,
    reason: row.reason,
    verifyAttempts: row.verify_attempts,
    sendAttempts: row.send_attempts,
    nextAttemptAt: row.next_attempt_at === null ? null : date(row.next_attempt_at),
    itemId: row.item_id?.toLowerCase() ?? null,
    lastFireAt: row.last_fire_at === null ? null : date(row.last_fire_at),
    lastDelivery: row.last_delivery,
    lastProvider: row.last_provider,
    lastProviderOutcome: row.last_provider_outcome,
    lastProviderStatusCode: row.last_provider_status_code,
    recipientCount: row.recipient_count,
    acceptedRecipientCount: row.accepted_recipient_count,
    claimToken: row.claim_token?.toLowerCase() ?? null,
    leaseUntil: row.lease_until === null ? null : date(row.lease_until),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

const updateColumns: Record<keyof OwnerReminderUpdate, string> = {
  fireAt: 'fire_at',
  localTime: 'local_time',
  anchorDate: 'anchor_date',
  cadence: 'cadence',
  untilTaskDone: 'until_task_done',
  taskTitle: 'task_title',
};

interface OwnerReminderDeliveryDatabaseRow {
  id: string;
  claim_token: string;
  reminder_id: string;
  occurrence_at: Date | string;
  item_id: string;
  registration_id: string;
  device_token: string;
  notification_id: string;
  expires_at: Date | string;
  attempt_count: number;
}

interface OwnerReminderDeliverySummaryDatabaseRow {
  state: 'pending' | 'sending' | 'retrying' | 'accepted' | 'failed' | 'expired' | 'invalid_token' | 'suppressed';
  attempt_count: number;
  last_result: string | null;
  last_status_code: number | null;
  next_attempt_at: Date | string | null;
  lease_until: Date | string | null;
  last_attempt_at: Date | string | null;
}

function mapClaimedDelivery(row: OwnerReminderDeliveryDatabaseRow): ClaimedOwnerReminderDelivery {
  return {
    id: row.id.toLowerCase(),
    claimToken: row.claim_token.toLowerCase(),
    scheduleId: row.reminder_id.toLowerCase(),
    occurrenceAt: date(row.occurrence_at),
    itemId: row.item_id.toLowerCase(),
    registrationId: row.registration_id.toLowerCase(),
    deviceToken: row.device_token,
    notificationId: row.notification_id,
    expiresAt: date(row.expires_at),
    attemptCount: row.attempt_count,
  };
}

export function createOwnerReminderStore(
  pool: sql.ConnectionPool,
  ownerObjectId: string,
): OwnerReminderStore & OwnerReminderDeliveryStore {
  const owner = ownerObjectId.toLowerCase();
  const nativeDeliverySummary = async (scheduleId: string, occurrenceAt: Date) => {
    const { recordset } = await databaseReadRequest(pool)
      .input('owner', sql.UniqueIdentifier, owner)
      .input('scheduleId', sql.UniqueIdentifier, scheduleId)
      .input('occurrenceAt', sql.DateTime2(7), occurrenceAt)
      .query<OwnerReminderDeliverySummaryDatabaseRow>(`SELECT state, attempt_count, last_result,
          last_status_code, next_attempt_at, lease_until, last_attempt_at
        FROM dbo.owner_reminder_deliveries
        WHERE owner_object_id = @owner AND reminder_id = @scheduleId AND occurrence_at = @occurrenceAt
        ORDER BY last_attempt_at, id;`);
    return summarizeOwnerReminderDeliveries(recordset.map((row) => ({
      state: row.state,
      attemptCount: row.attempt_count,
      lastResult: row.last_result,
      lastStatusCode: row.last_status_code,
      nextAttemptAt: row.next_attempt_at === null ? null : date(row.next_attempt_at),
      leaseUntil: row.lease_until === null ? null : date(row.lease_until),
      lastAttemptAt: row.last_attempt_at === null ? null : date(row.last_attempt_at),
    })));
  };
  return {
    async create(candidate: NewOwnerReminder, now: Date) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const lock = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{ result: number }>(`DECLARE @result int;
            DECLARE @resource nvarchar(255) =
              CONCAT(N'jarvis.owner-reminders:', LOWER(CONVERT(nvarchar(36), @owner)));
            EXEC @result = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive',
              @LockOwner = 'Transaction', @LockTimeout = 10000;
            SELECT @result AS result;`);
        if ((lock.recordset[0]?.result ?? -1) < 0) throw new Error('Reminder create lock was not acquired');
        const existing = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('key', sql.Char(64), candidate.idempotencyKey)
          .query<OwnerReminderDatabaseRow>(`SELECT ${columns} FROM dbo.owner_reminder_schedules WITH (UPDLOCK, HOLDLOCK)
            WHERE owner_object_id = @owner AND idempotency_key = @key;`);
        if (existing.recordset[0]) {
          await transaction.commit();
          return { schedule: mapRow(existing.recordset[0]), created: false };
        }
        const active = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{ count: number }>(`SELECT COUNT(*) AS count FROM dbo.owner_reminder_schedules WITH (UPDLOCK, HOLDLOCK)
            WHERE owner_object_id = @owner AND state IN (N'scheduled', N'sending', N'retrying');`);
        if ((active.recordset[0]?.count ?? 0) >= 100) throw new RangeError('Owner reminder limit reached');
        const rowId = randomUUID();
        const saved = await new sql.Request(transaction)
          .input('id', sql.UniqueIdentifier, rowId)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('key', sql.Char(64), candidate.idempotencyKey)
          .input('identity', sql.Char(64), candidate.taskIdentity)
          .input('title', sql.NVarChar(300), candidate.taskTitle)
          .input('fireAt', sql.DateTime2, candidate.fireAt)
          .input('localTime', sql.Char(5), candidate.localTime)
          .input('anchorDate', sql.Char(10), candidate.anchorDate)
          .input('cadence', sql.NVarChar(8), candidate.cadence)
          .input('untilDone', sql.Bit, candidate.untilTaskDone)
          .input('now', sql.DateTime2, now)
          .query<OwnerReminderDatabaseRow>(`INSERT dbo.owner_reminder_schedules
            (id, owner_object_id, idempotency_key, task_identity, task_title, fire_at, local_time,
             anchor_date, cadence, until_task_done, created_at, updated_at)
            OUTPUT ${outputColumns}
            VALUES (@id, @owner, @key, @identity, @title, @fireAt, @localTime, @anchorDate, @cadence, @untilDone, @now, @now);`);
        if (!saved.recordset[0]) throw new Error('Owner reminder was not saved');
        await transaction.commit();
        return { schedule: mapRow(saved.recordset[0]), created: true };
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve the store failure. */ }
        throw error;
      }
    },
    async list(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new RangeError('Invalid reminder limit');
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('limit', sql.Int, limit)
        .query<OwnerReminderDatabaseRow>(`SELECT TOP (@limit) ${columns} FROM dbo.owner_reminder_schedules
          WHERE owner_object_id = @owner
          ORDER BY CASE WHEN state IN (N'scheduled', N'sending', N'retrying') THEN 0 ELSE 1 END,
            COALESCE(next_attempt_at, fire_at) ASC, fire_at DESC;`);
      return recordset.map(mapRow);
    },
    async get(id) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .query<OwnerReminderDatabaseRow>(`SELECT ${columns} FROM dbo.owner_reminder_schedules
          WHERE owner_object_id = @owner AND id = @id;`);
      return recordset[0] ? mapRow(recordset[0]) : null;
    },
    async updateScheduled(id, update) {
      const entries = Object.entries(update) as [keyof OwnerReminderUpdate, OwnerReminderUpdate[keyof OwnerReminderUpdate]][];
      if (entries.length === 0) return false;
      const request = new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id);
      const assignments = entries.map(([key, value], index) => {
        const parameter = `value${index}`;
        const type = key === 'fireAt' ? sql.DateTime2
          : key === 'untilTaskDone' ? sql.Bit
            : key === 'cadence' ? sql.NVarChar(8)
              : key === 'localTime' ? sql.Char(5)
                : key === 'anchorDate' ? sql.Char(10) : sql.NVarChar(300);
        request.input(parameter, type, value);
        return `${updateColumns[key]} = @${parameter}`;
      });
      const { recordset } = await request.query<{ updated: boolean }>(`SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        DECLARE @updated int;
        UPDATE dbo.owner_reminder_schedules
          SET ${assignments.join(', ')}, state = N'scheduled', reason = NULL,
            verify_attempts = 0, send_attempts = 0, next_attempt_at = NULL,
            last_delivery = NULL, last_provider = NULL, last_provider_outcome = NULL,
            last_provider_status_code = NULL, recipient_count = 0,
            accepted_recipient_count = 0, updated_at = SYSUTCDATETIME()
          WHERE owner_object_id = @owner AND id = @id
            AND state IN (N'scheduled', N'retrying');
        SET @updated = @@ROWCOUNT;
        IF @updated = 1
          UPDATE dbo.owner_reminder_deliveries
            SET state = N'suppressed', last_result = N'rescheduled',
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
            WHERE owner_object_id = @owner AND reminder_id = @id
              AND state IN (N'pending', N'retrying');
        COMMIT TRANSACTION;
        SELECT CONVERT(bit, @updated) AS updated;`);
      return recordset[0]?.updated === true;
    },
    async cancel(id) {
      const { recordset } = await new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .query<{ cancelled: boolean }>(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @cancelled int;
          UPDATE dbo.owner_reminder_schedules
            SET state = N'cancelled', reason = N'cancelled',
              next_attempt_at = NULL, claim_token = NULL, lease_until = NULL,
              updated_at = SYSUTCDATETIME()
            WHERE owner_object_id = @owner AND id = @id
              AND state IN (N'scheduled', N'retrying');
          SET @cancelled = @@ROWCOUNT;
          IF @cancelled = 1
            UPDATE dbo.owner_reminder_deliveries
              SET state = N'suppressed', last_result = N'cancelled',
                  completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                  next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
              WHERE owner_object_id = @owner AND reminder_id = @id
                AND state IN (N'pending', N'retrying');
          COMMIT TRANSACTION;
          SELECT CONVERT(bit, @cancelled) AS cancelled;`);
      return recordset[0]?.cancelled === true;
    },
    async earliestFireAt() {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .query<{ fire_at: Date | string | null }>(`SELECT MIN(CASE
            WHEN state = N'scheduled' THEN fire_at
            WHEN state = N'retrying' THEN next_attempt_at
            ELSE lease_until
          END) AS fire_at
          FROM dbo.owner_reminder_schedules
          WHERE owner_object_id = @owner AND state IN (N'scheduled', N'sending', N'retrying');`);
      const fireAt = recordset[0]?.fire_at;
      return fireAt === null || fireAt === undefined ? null : date(fireAt);
    },
    async hasTaskReminderNear(taskIdentity, fireAt, windowMs) {
      if (!Number.isFinite(windowMs) || windowMs < 0 || windowMs > 24 * 60 * 60_000) {
        throw new RangeError('Invalid reminder overlap window');
      }
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('identity', sql.Char(64), taskIdentity)
        .input('start', sql.DateTime2, new Date(fireAt.getTime() - windowMs))
        .input('end', sql.DateTime2, new Date(fireAt.getTime() + windowMs))
        .query<{ present: number }>(`SELECT TOP (1) 1 AS present FROM dbo.owner_reminder_schedules
          WHERE owner_object_id = @owner AND task_identity = @identity AND (
            (state IN (N'scheduled', N'sending', N'retrying') AND fire_at BETWEEN @start AND @end) OR
            (last_delivery = N'provider_accepted' AND last_fire_at BETWEEN @start AND @end)
          );`);
      return recordset.length > 0;
    },
    async claimDue(now, limit, leaseMs) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isFinite(leaseMs) || leaseMs < 1) {
        throw new RangeError('Invalid reminder claim');
      }
      const claimToken = randomUUID();
      const { recordset } = await new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('now', sql.DateTime2, now)
        .input('lease', sql.DateTime2, new Date(now.getTime() + leaseMs))
        .input('limit', sql.Int, limit)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .query<OwnerReminderDatabaseRow>(`;WITH due AS (
            SELECT TOP (@limit) * FROM dbo.owner_reminder_schedules WITH (UPDLOCK, READPAST, ROWLOCK)
            WHERE owner_object_id = @owner AND
              ((state = N'scheduled' AND fire_at <= @now) OR
               (state = N'retrying' AND next_attempt_at <= @now) OR
               (state = N'sending' AND lease_until <= @now))
            ORDER BY COALESCE(next_attempt_at, fire_at) ASC
          )
          UPDATE due SET state = N'sending', claim_token = @claimToken, lease_until = @lease,
            next_attempt_at = NULL,
            send_attempts = CASE WHEN due.state = N'scheduled' THEN 0 ELSE due.send_attempts END,
            updated_at = @now
          OUTPUT ${outputColumns};`);
      return recordset.map(mapRow);
    },
    async finishClaim(id, claimToken, update) {
      const assignments: string[] = [
        'state = @state',
        'next_attempt_at = @nextAttemptAt',
        'claim_token = NULL',
        'lease_until = NULL',
        'updated_at = SYSUTCDATETIME()',
      ];
      const request = new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('state', sql.NVarChar(16), update.state ?? 'scheduled')
        .input('nextAttemptAt', sql.DateTime2, update.nextAttemptAt ?? null);
      const fields = [
        ['fireAt', 'fire_at', sql.DateTime2],
        ['localTime', 'local_time', sql.Char(5)],
        ['taskTitle', 'task_title', sql.NVarChar(300)],
        ['reason', 'reason', sql.NVarChar(64)],
        ['verifyAttempts', 'verify_attempts', sql.TinyInt],
        ['sendAttempts', 'send_attempts', sql.TinyInt],
        ['itemId', 'item_id', sql.UniqueIdentifier],
        ['lastFireAt', 'last_fire_at', sql.DateTime2],
        ['lastDelivery', 'last_delivery', sql.NVarChar(32)],
        ['lastProvider', 'last_provider', sql.NVarChar(16)],
        ['lastProviderOutcome', 'last_provider_outcome', sql.NVarChar(32)],
        ['lastProviderStatusCode', 'last_provider_status_code', sql.Int],
        ['recipientCount', 'recipient_count', sql.Int],
        ['acceptedRecipientCount', 'accepted_recipient_count', sql.Int],
      ] as const;
      for (const [property, column, type] of fields) {
        const value = update[property];
        if (value === undefined) continue;
        const parameter = `value_${property}`;
        request.input(parameter, type, value);
        assignments.push(`${column} = @${parameter}`);
      }
      const { recordset } = await request.query<{ finished: boolean }>(`SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        DECLARE @finished int;
        UPDATE dbo.owner_reminder_schedules
          SET ${assignments.join(', ')}
          WHERE owner_object_id = @owner AND id = @id
            AND state = N'sending' AND claim_token = @claimToken;
        SET @finished = @@ROWCOUNT;
        IF @finished = 1 AND @state IN (N'cancelled', N'failed', N'suppressed')
          UPDATE dbo.owner_reminder_deliveries
            SET state = N'suppressed', last_result = N'cancelled',
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
            WHERE owner_object_id = @owner AND reminder_id = @id
              AND state IN (N'pending', N'retrying');
        COMMIT TRANSACTION;
        SELECT CONVERT(bit, @finished) AS finished;`);
      return recordset[0]?.finished === true;
    },
    async queueNativeDeliveries(input) {
      await new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('scheduleId', sql.UniqueIdentifier, input.scheduleId)
        .input('claimToken', sql.UniqueIdentifier, input.claimToken)
        .input('occurrenceAt', sql.DateTime2(7), input.occurrenceAt)
        .input('itemId', sql.UniqueIdentifier, input.itemId)
        .input('notificationId', sql.VarChar(64), input.notificationId)
        .input('now', sql.DateTime2(3), input.now)
        .input('expiresAt', sql.DateTime2(3), input.expiresAt)
        .query(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) = CONCAT(
            N'jarvis.approval-notifications:', CONVERT(nvarchar(36), @owner)
          );
          EXEC @lockResult = sys.sp_getapplock
            @Resource=@resource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51001, 'Owner reminder recipient selection unavailable', 1;
          IF EXISTS (
            SELECT 1 FROM dbo.owner_reminder_schedules
            WHERE id = @scheduleId AND owner_object_id = @owner AND state = N'sending'
              AND claim_token = @claimToken AND fire_at = @occurrenceAt
          )
          BEGIN
            INSERT dbo.owner_reminder_delivery_snapshots
              (reminder_id, occurrence_at, recipient_count, created_at)
            SELECT @scheduleId, @occurrenceAt, 0, @now
            WHERE NOT EXISTS (
              SELECT 1 FROM dbo.owner_reminder_delivery_snapshots
              WHERE reminder_id = @scheduleId AND occurrence_at = @occurrenceAt
            );
            IF @@ROWCOUNT = 1
            BEGIN
              INSERT dbo.owner_reminder_deliveries
                (id, owner_object_id, reminder_id, occurrence_at, item_id,
                 registration_id, device_reference, notification_id, state,
                 next_attempt_at, expires_at)
              SELECT NEWID(), @owner, @scheduleId, @occurrenceAt, @itemId,
                r.registration_id, CONVERT(char(36), r.registration_id), @notificationId,
                N'pending', @now, @expiresAt
              FROM dbo.approval_notification_registrations r
              WHERE r.owner_object_id = @owner AND r.expires_at > @now
                AND NOT EXISTS (
                  SELECT 1 FROM dbo.approval_notification_token_tombstones tombstone
                  WHERE tombstone.owner_object_id = r.owner_object_id
                    AND tombstone.device_token_hash = CONVERT(
                      char(64),
                      HASHBYTES(
                        N'SHA2_256',
                        CONVERT(varbinary(512), LOWER(r.device_token))
                      ),
                      2
                    )
                );
              UPDATE dbo.owner_reminder_delivery_snapshots
                SET recipient_count = (
                  SELECT COUNT(*) FROM dbo.owner_reminder_deliveries
                  WHERE reminder_id = @scheduleId AND occurrence_at = @occurrenceAt
                )
                WHERE reminder_id = @scheduleId AND occurrence_at = @occurrenceAt;
            END;
          END;
          COMMIT TRANSACTION;`);
      return nativeDeliverySummary(input.scheduleId, input.occurrenceAt);
    },
    async claimNativeDeliveries(input) {
      const limit = input.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 ||
          !Number.isFinite(input.now.getTime()) || !Number.isFinite(input.leaseUntil.getTime())) {
        throw new RangeError('Invalid owner reminder delivery claim');
      }
      const { recordset } = await new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('scheduleId', sql.UniqueIdentifier, input.scheduleId)
        .input('occurrenceAt', sql.DateTime2(7), input.occurrenceAt)
        .input('claimToken', sql.UniqueIdentifier, input.claimToken)
        .input('now', sql.DateTime2(3), input.now)
        .input('leaseUntil', sql.DateTime2(3), input.leaseUntil)
        .input('limit', sql.Int, limit)
        .input('maxAttempts', sql.TinyInt, 2)
        .query<OwnerReminderDeliveryDatabaseRow>(`SET XACT_ABORT ON;
          SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
          BEGIN TRANSACTION;
          DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) = CONCAT(
            N'jarvis.approval-notifications:', CONVERT(nvarchar(36), @owner)
          );
          EXEC @lockResult = sys.sp_getapplock
            @Resource=@resource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51001, 'Owner reminder delivery claim unavailable', 1;
          DECLARE @expired TABLE (
            registration_id uniqueidentifier NOT NULL,
            device_reference char(36) COLLATE Latin1_General_100_BIN2 NOT NULL
          );
          INSERT @expired (registration_id, device_reference)
          SELECT registration_id, CONVERT(char(36), registration_id)
            FROM dbo.approval_notification_registrations
            WHERE owner_object_id = @owner AND expires_at <= @now;
          UPDATE a
            SET state = N'failed', last_result = N'registration_expired',
                completed_at = @now, updated_at = SYSUTCDATETIME()
          FROM dbo.reply_notification_approval_deliveries a
          INNER JOIN @expired expired ON expired.device_reference = a.device_reference
          WHERE a.state = N'sending';
          UPDATE reply
            SET state = N'failed', last_result = N'registration_expired',
                completed_at = @now, updated_at = SYSUTCDATETIME(),
                lease_owner = NULL, lease_until = NULL
          FROM dbo.reply_notification_deliveries reply
          INNER JOIN @expired expired ON expired.device_reference = reply.device_reference
          WHERE reply.state IN (N'pending', N'sending');
          UPDATE d
            SET state = N'failed', last_result = N'registration_expired',
                completed_at = @now, updated_at = SYSUTCDATETIME(),
                next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
          FROM dbo.owner_reminder_deliveries d
          INNER JOIN @expired expired ON expired.device_reference = d.device_reference
          WHERE d.owner_object_id = @owner
            AND d.state IN (N'pending', N'sending', N'retrying');
          DELETE registration
          FROM dbo.approval_notification_registrations registration
          INNER JOIN @expired expired ON expired.registration_id = registration.registration_id;
          UPDATE dbo.owner_reminder_deliveries
            SET state = N'expired', last_result = N'delivery_expired',
                completed_at = @now, updated_at = SYSUTCDATETIME(),
                next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
            WHERE owner_object_id = @owner AND reminder_id = @scheduleId
              AND occurrence_at = @occurrenceAt AND expires_at <= @now
              AND state IN (N'pending', N'sending', N'retrying');
          UPDATE dbo.owner_reminder_deliveries
            SET state = N'failed', last_result = N'delivery_evidence_unavailable',
                completed_at = @now, updated_at = SYSUTCDATETIME(),
                next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
            WHERE owner_object_id = @owner AND reminder_id = @scheduleId
              AND occurrence_at = @occurrenceAt AND attempt_count >= @maxAttempts
              AND (
                state = N'retrying' AND next_attempt_at <= @now OR
                state = N'sending' AND lease_until <= @now
              );
          DECLARE @claimed TABLE (id uniqueidentifier NOT NULL PRIMARY KEY);
          ;WITH due AS (
            SELECT TOP (@limit) d.id
            FROM dbo.owner_reminder_deliveries d WITH (UPDLOCK, READPAST, ROWLOCK)
            INNER JOIN dbo.approval_notification_registrations r
              ON r.registration_id = d.registration_id
            WHERE d.owner_object_id = @owner AND d.reminder_id = @scheduleId
              AND d.occurrence_at = @occurrenceAt AND r.owner_object_id = @owner
              AND r.expires_at > @now AND d.expires_at > @now
              AND d.attempt_count < @maxAttempts
              AND NOT EXISTS (
                SELECT 1 FROM dbo.approval_notification_token_tombstones tombstone
                WHERE tombstone.owner_object_id = r.owner_object_id
                  AND tombstone.device_token_hash = CONVERT(
                    char(64),
                    HASHBYTES(N'SHA2_256', CONVERT(varbinary(512), LOWER(r.device_token))),
                    2
                  )
              )
              AND (
                d.state IN (N'pending', N'retrying') AND d.next_attempt_at <= @now OR
                d.state = N'sending' AND d.lease_until <= @now
              )
            ORDER BY COALESCE(d.next_attempt_at, d.lease_until), d.created_at
          )
          UPDATE d
            SET state = N'sending', attempt_count = d.attempt_count + 1,
                last_attempt_at = @now, next_attempt_at = NULL,
                lease_owner = @claimToken, lease_until = @leaseUntil,
                updated_at = SYSUTCDATETIME()
            OUTPUT inserted.id INTO @claimed
          FROM dbo.owner_reminder_deliveries d
          INNER JOIN due ON due.id = d.id;
          SELECT d.id, CONVERT(nvarchar(36), d.lease_owner) AS claim_token,
            d.reminder_id, d.occurrence_at, d.item_id, d.registration_id,
            r.device_token, d.notification_id, d.expires_at, d.attempt_count
          FROM dbo.owner_reminder_deliveries d
          INNER JOIN @claimed claimed ON claimed.id = d.id
          INNER JOIN dbo.approval_notification_registrations r
            ON r.registration_id = d.registration_id
          ORDER BY d.created_at;
          COMMIT TRANSACTION;`);
      return recordset.map(mapClaimedDelivery);
    },
    async acceptedNativeDelivery(id, claimToken, statusCode) {
      const { rowsAffected } = await new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('statusCode', sql.Int, statusCode)
        .query(`UPDATE dbo.owner_reminder_deliveries
          SET state = N'accepted', last_result = N'provider_accepted',
              last_status_code = @statusCode, completed_at = SYSUTCDATETIME(),
              updated_at = SYSUTCDATETIME(), next_attempt_at = NULL,
              lease_owner = NULL, lease_until = NULL
          WHERE owner_object_id = @owner AND id = @id
            AND state = N'sending' AND lease_owner = @claimToken;`);
      return (rowsAffected[0] ?? 0) > 0;
    },
    async retryNativeDelivery(id, claimToken, nextAttemptAt, statusCode) {
      const { rowsAffected } = await new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('nextAttemptAt', sql.DateTime2(3), nextAttemptAt)
        .input('statusCode', sql.Int, statusCode)
        .query(`UPDATE dbo.owner_reminder_deliveries
          SET state = N'retrying', last_result = N'provider_unavailable',
              last_status_code = @statusCode, next_attempt_at = @nextAttemptAt,
              updated_at = SYSUTCDATETIME(), lease_owner = NULL, lease_until = NULL
          WHERE owner_object_id = @owner AND id = @id
            AND state = N'sending' AND lease_owner = @claimToken;`);
      return (rowsAffected[0] ?? 0) > 0;
    },
    async failedNativeDelivery(id, claimToken, result, statusCode) {
      const { rowsAffected } = await new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('result', sql.VarChar(32), result)
        .input('statusCode', sql.Int, statusCode)
        .query(`UPDATE dbo.owner_reminder_deliveries
          SET state = N'failed', last_result = @result, last_status_code = @statusCode,
              completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
              next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
          WHERE owner_object_id = @owner AND id = @id
            AND state = N'sending' AND lease_owner = @claimToken;`);
      return (rowsAffected[0] ?? 0) > 0;
    },
    async invalidNativeDelivery(id, claimToken, statusCode) {
      const { rowsAffected } = await new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('statusCode', sql.Int, statusCode)
        .query(`UPDATE dbo.owner_reminder_deliveries
          SET state = N'invalid_token', last_result = N'apns_invalid_token',
              last_status_code = @statusCode, completed_at = SYSUTCDATETIME(),
              updated_at = SYSUTCDATETIME(), next_attempt_at = NULL,
              lease_owner = NULL, lease_until = NULL
          WHERE owner_object_id = @owner AND id = @id
            AND state = N'sending' AND lease_owner = @claimToken;`);
      return (rowsAffected[0] ?? 0) > 0;
    },
    async nativeDeliverySummary(scheduleId, occurrenceAt) {
      return nativeDeliverySummary(scheduleId, occurrenceAt);
    },
  };
}
