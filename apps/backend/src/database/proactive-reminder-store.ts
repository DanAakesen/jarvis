import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type {
  ProactiveReminderStore,
  ReminderPlanResult,
  ReminderRow,
  ReminderUpdate,
  ReminderState,
} from '../proactive/reminder-store.js';

interface ReminderDatabaseRow {
  id: string;
  reminder_key: string;
  deadline_alert_key: string | null;
  fire_at: Date | string;
  due_at: Date | string;
  title: string;
  state: ReminderState;
  reason: string | null;
  verify_attempts: number;
  send_attempts: number;
  item_id: string | null;
  sent_day_key: string | null;
  planned_run_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const columns = `id, reminder_key, deadline_alert_key, fire_at, due_at, title, state, reason,
  verify_attempts, send_attempts, item_id, sent_day_key, planned_run_id, created_at, updated_at`;
const insertedColumns = columns.split(',').map((column) => `inserted.${column.trim()}`).join(', ');

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(row: ReminderDatabaseRow): ReminderRow {
  return {
    id: row.id.toLowerCase(),
    reminderKey: row.reminder_key,
    deadlineAlertKey: row.deadline_alert_key,
    fireAt: date(row.fire_at),
    dueAt: date(row.due_at),
    title: row.title,
    state: row.state,
    reason: row.reason,
    verifyAttempts: row.verify_attempts,
    sendAttempts: row.send_attempts,
    itemId: row.item_id?.toLowerCase() ?? null,
    sentDayKey: row.sent_day_key,
    plannedRunId: row.planned_run_id?.toLowerCase() ?? null,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

const updateColumns: Record<keyof ReminderUpdate, string> = {
  state: 'state',
  reason: 'reason',
  fireAt: 'fire_at',
  verifyAttempts: 'verify_attempts',
  sendAttempts: 'send_attempts',
  itemId: 'item_id',
  sentDayKey: 'sent_day_key',
};

export function createProactiveReminderStore(
  pool: sql.ConnectionPool,
  ownerObjectId: string,
): ProactiveReminderStore {
  const owner = ownerObjectId.toLowerCase();
  return {
    async plan(candidates, now): Promise<ReminderPlanResult> {
      const transaction = new sql.Transaction(pool);
      const inserted: ReminderRow[] = [];
      let capSkipped = 0;
      let purged: number;
      await transaction.begin();
      try {
        const lock = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{ result: number }>(`DECLARE @result int;
            DECLARE @resource nvarchar(255) =
              CONCAT(N'jarvis.proactive.reminders:', LOWER(CONVERT(nvarchar(36), @owner)));
            EXEC @result = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive',
              @LockOwner = 'Transaction', @LockTimeout = 10000;
            SELECT @result AS result;`);
        if ((lock.recordset[0]?.result ?? -1) < 0) throw new Error('Reminder plan lock was not acquired');

        const cleanup = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('cutoff', sql.DateTime2, new Date(now.getTime() - 30 * 24 * 60 * 60_000))
          .query(`DELETE dbo.proactive_reminders
            WHERE owner_object_id = @owner AND state <> N'pending' AND created_at < @cutoff;
            SELECT @@ROWCOUNT AS purged;`);
        purged = cleanup.recordset[0]?.purged ?? 0;

        const pending = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{ count: number }>(`SELECT COUNT(*) AS count FROM dbo.proactive_reminders WITH (UPDLOCK, HOLDLOCK)
            WHERE owner_object_id = @owner AND state = N'pending';`);
        let pendingCount = pending.recordset[0]?.count ?? 0;

        for (const candidate of candidates) {
          if (!/^[\da-f]{32}$/u.test(candidate.reminderKey) ||
              (candidate.deadlineAlertKey !== null && !/^[\da-f]{32}$/u.test(candidate.deadlineAlertKey)) ||
              !Number.isFinite(candidate.fireAt.getTime()) || !Number.isFinite(candidate.dueAt.getTime()) ||
              candidate.title.length > 80) {
            throw new RangeError('Invalid proactive reminder');
          }
          const existing = await new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, owner)
            .input('key', sql.Char(32), candidate.reminderKey)
            .query<{ id: string }>(`SELECT id FROM dbo.proactive_reminders WITH (UPDLOCK, HOLDLOCK)
              WHERE owner_object_id = @owner AND reminder_key = @key;`);
          if (existing.recordset.length > 0) continue;
          if (inserted.length >= 20 || pendingCount >= 100) {
            capSkipped += 1;
            continue;
          }
          const rowId = randomUUID();
          const saved = await new sql.Request(transaction)
            .input('id', sql.UniqueIdentifier, rowId)
            .input('owner', sql.UniqueIdentifier, owner)
            .input('key', sql.Char(32), candidate.reminderKey)
            .input('alertKey', sql.Char(32), candidate.deadlineAlertKey)
            .input('fireAt', sql.DateTime2, candidate.fireAt)
            .input('dueAt', sql.DateTime2, candidate.dueAt)
            .input('title', sql.NVarChar(80), candidate.title)
            .input('runId', sql.UniqueIdentifier, candidate.plannedRunId)
            .input('now', sql.DateTime2, now)
            .query<ReminderDatabaseRow>(`INSERT dbo.proactive_reminders
              (id, owner_object_id, reminder_key, deadline_alert_key, fire_at, due_at, title, planned_run_id,
               created_at, updated_at)
              OUTPUT ${insertedColumns}
              VALUES (@id, @owner, @key, @alertKey, @fireAt, @dueAt, @title, @runId, @now, @now);`);
          if (!saved.recordset[0]) throw new Error('Proactive reminder was not saved');
          inserted.push(mapRow(saved.recordset[0]));
          pendingCount += 1;
        }
        await transaction.commit();
        return { inserted, capSkipped, purged };
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve the store failure. */ }
        throw error;
      }
    },
    async earliestPendingFireAt() {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .query<{ fire_at: Date | string | null }>(`SELECT MIN(fire_at) AS fire_at FROM dbo.proactive_reminders
          WHERE owner_object_id = @owner AND state = N'pending';`);
      const fireAt = recordset[0]?.fire_at;
      return fireAt === null || fireAt === undefined ? null : date(fireAt);
    },
    async listDue(now, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new RangeError('Invalid reminder limit');
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('now', sql.DateTime2, now)
        .input('limit', sql.Int, limit)
        .query<ReminderDatabaseRow>(`SELECT TOP (@limit) ${columns} FROM dbo.proactive_reminders
          WHERE owner_object_id = @owner AND state = N'pending' AND fire_at <= @now
          ORDER BY due_at ASC;`);
      return recordset.map(mapRow);
    },
    async countSent(dayKey) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('dayKey', sql.Char(10), dayKey)
        .query<{ count: number }>(`SELECT COUNT(*) AS count FROM dbo.proactive_reminders
          WHERE owner_object_id = @owner AND sent_day_key = @dayKey AND state = N'sent';`);
      return recordset[0]?.count ?? 0;
    },
    async updatePending(id, update) {
      const entries = Object.entries(update) as [keyof ReminderUpdate, ReminderUpdate[keyof ReminderUpdate]][];
      if (entries.length === 0) return false;
      const request = new sql.Request(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id);
      const assignments = entries.map(([key, value], index) => {
        const parameter = `value${index}`;
        const type = key === 'fireAt' ? sql.DateTime2
          : key === 'verifyAttempts' || key === 'sendAttempts' ? sql.TinyInt
            : key === 'itemId' ? sql.UniqueIdentifier
              : key === 'sentDayKey' ? sql.Char(10)
                : key === 'state' ? sql.NVarChar(16) : sql.NVarChar(64);
        request.input(parameter, type, value instanceof Date ? value : value);
        return `${updateColumns[key]} = @${parameter}`;
      });
      const { rowsAffected } = await request.query(`UPDATE dbo.proactive_reminders
        SET ${assignments.join(', ')}, updated_at = SYSUTCDATETIME()
        WHERE owner_object_id = @owner AND id = @id AND state = N'pending';`);
      return (rowsAffected[0] ?? 0) > 0;
    },
  };
}
