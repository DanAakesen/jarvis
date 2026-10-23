import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type {
  NewOwnerReminder,
  OwnerReminderCadence,
  OwnerReminderDelivery,
  OwnerReminderSchedule,
  OwnerReminderState,
  OwnerReminderStore,
  OwnerReminderUpdate,
} from '../proactive/owner-reminder-store.js';

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
  item_id: string | null;
  last_fire_at: Date | string | null;
  last_delivery: OwnerReminderDelivery;
  claim_token: string | null;
  lease_until: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const columns = `id, idempotency_key, task_identity, task_title, fire_at, local_time, anchor_date, cadence,
  until_task_done, state, reason, verify_attempts, send_attempts, item_id, last_fire_at, last_delivery, claim_token,
  lease_until, created_at, updated_at`;
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
    itemId: row.item_id?.toLowerCase() ?? null,
    lastFireAt: row.last_fire_at === null ? null : date(row.last_fire_at),
    lastDelivery: row.last_delivery,
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

export function createOwnerReminderStore(pool: sql.ConnectionPool, ownerObjectId: string): OwnerReminderStore {
  const owner = ownerObjectId.toLowerCase();
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
            WHERE owner_object_id = @owner AND state IN (N'scheduled', N'sending');`);
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
          ORDER BY CASE WHEN state IN (N'scheduled', N'sending') THEN 0 ELSE 1 END, fire_at DESC;`);
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
      const { rowsAffected } = await request.query(`UPDATE dbo.owner_reminder_schedules
        SET ${assignments.join(', ')}, reason = NULL, verify_attempts = 0, send_attempts = 0,
          last_delivery = NULL, updated_at = SYSUTCDATETIME()
        WHERE owner_object_id = @owner AND id = @id AND state = N'scheduled';`);
      return (rowsAffected[0] ?? 0) > 0;
    },
    async cancel(id) {
      const { rowsAffected } = await new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .query(`UPDATE dbo.owner_reminder_schedules
          SET state = N'cancelled', reason = N'cancelled', claim_token = NULL, lease_until = NULL,
            updated_at = SYSUTCDATETIME()
          WHERE owner_object_id = @owner AND id = @id AND state IN (N'scheduled', N'sending');`);
      return (rowsAffected[0] ?? 0) > 0;
    },
    async earliestFireAt() {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .query<{ fire_at: Date | string | null }>(`SELECT MIN(CASE WHEN state = N'scheduled' THEN fire_at ELSE lease_until END) AS fire_at
          FROM dbo.owner_reminder_schedules
          WHERE owner_object_id = @owner AND state IN (N'scheduled', N'sending');`);
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
            (state IN (N'scheduled', N'sending') AND fire_at BETWEEN @start AND @end) OR
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
              ((state = N'scheduled' AND fire_at <= @now) OR (state = N'sending' AND lease_until <= @now))
            ORDER BY fire_at ASC
          )
          UPDATE due SET state = N'sending', claim_token = @claimToken, lease_until = @lease,
            updated_at = @now
          OUTPUT ${outputColumns};`);
      return recordset.map(mapRow);
    },
    async finishClaim(id, claimToken, update) {
      const assignments: string[] = ['state = @state', 'claim_token = NULL', 'lease_until = NULL', 'updated_at = SYSUTCDATETIME()'];
      const request = new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('state', sql.NVarChar(16), update.state ?? 'scheduled');
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
      ] as const;
      for (const [property, column, type] of fields) {
        const value = update[property];
        if (value === undefined) continue;
        const parameter = `value_${property}`;
        request.input(parameter, type, value);
        assignments.push(`${column} = @${parameter}`);
      }
      const { rowsAffected } = await request.query(`UPDATE dbo.owner_reminder_schedules
        SET ${assignments.join(', ')}
        WHERE owner_object_id = @owner AND id = @id AND state = N'sending' AND claim_token = @claimToken;`);
      return (rowsAffected[0] ?? 0) > 0;
    },
  };
}
