import sql from 'mssql';
import type { InboxFeedback, InboxIndexRow, InboxIndexStore } from '../inbox/item-index.js';
import { databaseReadRequest } from './wake-retry.js';

interface Row {
  item_id: string;
  path: string | null;
  sha: string | null;
  last_nudged_at: Date | null;
  last_feedback: InboxFeedback | null;
  last_feedback_at: Date | null;
  created_at: Date;
}

const projection = 'item_id, path, sha, last_nudged_at, last_feedback, last_feedback_at, created_at';
const maxRows = 5_000;

function row(value: Row): InboxIndexRow {
  return {
    itemId: value.item_id,
    path: value.path,
    sha: value.sha,
    lastNudgedAt: value.last_nudged_at,
    lastFeedback: value.last_feedback,
    lastFeedbackAt: value.last_feedback_at,
    createdAt: value.created_at,
  };
}

async function query<T>(request: sql.Request, statement: string, signal: AbortSignal): Promise<sql.IResult<T>> {
  signal.throwIfAborted();
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try { return await request.query<T>(statement); }
  finally { signal.removeEventListener('abort', cancel); }
}

/** Azure SQL implementation of the rebuildable inbox index (migration 0080). */
export function createInboxIndexStore(pool: sql.ConnectionPool): InboxIndexStore {
  return {
    async all(signal) {
      const result = await query<Row>(databaseReadRequest(pool),
        `SELECT TOP (${maxRows}) ${projection} FROM dbo.inbox_items ORDER BY created_at, item_id;`, signal);
      return result.recordset.map(row);
    },
    async get(itemId, signal) {
      const result = await query<Row>(databaseReadRequest(pool).input('id', sql.VarChar(32), itemId),
        `SELECT ${projection} FROM dbo.inbox_items WHERE item_id=@id;`, signal);
      return result.recordset[0] ? row(result.recordset[0]) : null;
    },
    async reserve(itemId, signal) {
      const result = await query<Row & { inserted: boolean }>(pool.request().input('id', sql.VarChar(32), itemId), `
        SET XACT_ABORT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          DECLARE @inserted bit = 0;
          IF NOT EXISTS (SELECT 1 FROM dbo.inbox_items WITH (UPDLOCK, HOLDLOCK) WHERE item_id=@id)
          BEGIN
            INSERT dbo.inbox_items (item_id) VALUES (@id);
            SET @inserted = 1;
          END;
          SELECT ${projection}, @inserted AS inserted FROM dbo.inbox_items WHERE item_id=@id;
          COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
          IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;`, signal);
      const value = result.recordset[0];
      if (!value) throw new Error('Inbox item was not reserved');
      return { row: row(value), inserted: Boolean(value.inserted) };
    },
    async upsert(value, signal) {
      await query(pool.request()
        .input('id', sql.VarChar(32), value.itemId)
        .input('path', sql.NVarChar(260), value.path)
        .input('sha', sql.Char(40), value.sha)
        .input('nudged', sql.DateTime2(7), value.lastNudgedAt ?? null), `
        SET XACT_ABORT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          UPDATE dbo.inbox_items WITH (UPDLOCK, HOLDLOCK)
            SET path=@path, sha=@sha, updated_at=SYSUTCDATETIME() WHERE item_id=@id;
          IF @@ROWCOUNT = 0
            INSERT dbo.inbox_items (item_id, path, sha, last_nudged_at) VALUES (@id, @path, @sha, @nudged);
          COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
          IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;`, signal);
    },
    async remove(itemIds, signal) {
      if (itemIds.length === 0) return;
      await query(pool.request().input('ids', sql.NVarChar(sql.MAX), JSON.stringify(itemIds)),
        `DELETE FROM dbo.inbox_items WHERE item_id IN (SELECT value FROM OPENJSON(@ids));`, signal);
    },
    async markNudged(itemId, at, signal) {
      const result = await query(pool.request()
        .input('id', sql.VarChar(32), itemId).input('at', sql.DateTime2(7), at),
      `UPDATE dbo.inbox_items SET last_nudged_at=@at, updated_at=SYSUTCDATETIME() WHERE item_id=@id;`, signal);
      return result.rowsAffected[0] === 1;
    },
    async setFeedback(itemId, feedback, at, signal) {
      const result = await query(pool.request()
        .input('id', sql.VarChar(32), itemId).input('feedback', sql.VarChar(4), feedback).input('at', sql.DateTime2(7), at),
      `UPDATE dbo.inbox_items SET last_feedback=@feedback, last_feedback_at=@at, updated_at=SYSUTCDATETIME() WHERE item_id=@id;`, signal);
      return result.rowsAffected[0] === 1;
    },
  };
}
