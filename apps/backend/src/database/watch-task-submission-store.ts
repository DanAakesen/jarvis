import sql from 'mssql';
import type { WatchTaskReceipt, WatchTaskSubmissionStore } from '../vault/watch-task-capture.js';
import { validateTaskCreateInput, type TaskWriteResult } from '../vault/task-writes.js';
import { databaseReadRequest } from './wake-retry.js';

interface Row { request_hash: string; resolved_json: string; result_json: string | null }
const projection = 'request_hash, resolved_json, result_json';

function receipt(row: Row): WatchTaskReceipt {
  const resolved: unknown = JSON.parse(row.resolved_json);
  if (!validateTaskCreateInput(resolved)) throw new Error('Invalid persisted task submission');
  const result = row.result_json ? JSON.parse(row.result_json) as TaskWriteResult : null;
  return { requestHash: row.request_hash, resolved, result };
}

async function query<T>(request: sql.Request, statement: string, signal: AbortSignal): Promise<sql.IResult<T>> {
  signal.throwIfAborted();
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try { return await request.query<T>(statement); }
  finally { signal.removeEventListener('abort', cancel); }
}

export function createWatchTaskSubmissionStore(pool: sql.ConnectionPool): WatchTaskSubmissionStore {
  const request = (owner: string, submissionId: string, read = false) => (read ? databaseReadRequest(pool) : pool.request())
    .input('owner', sql.UniqueIdentifier, owner).input('submission', sql.UniqueIdentifier, submissionId);
  return {
    async get(owner, submissionId, signal) {
      const result = await query<Row>(request(owner, submissionId, true),
        `SELECT ${projection} FROM dbo.watch_task_submissions WHERE owner_object_id=@owner AND submission_id=@submission;`, signal);
      return result.recordset[0] ? receipt(result.recordset[0]) : null;
    },
    async reserve(owner, submissionId, value, signal) {
      const result = await query<Row>(request(owner, submissionId)
        .input('hash', sql.Char(64), value.requestHash)
        .input('resolved', sql.NVarChar(sql.MAX), JSON.stringify(value.resolved)), `
          SET XACT_ABORT ON;
          BEGIN TRY
            BEGIN TRANSACTION;
            IF NOT EXISTS (SELECT 1 FROM dbo.watch_task_submissions WITH (UPDLOCK, HOLDLOCK)
              WHERE owner_object_id=@owner AND submission_id=@submission)
              INSERT dbo.watch_task_submissions (owner_object_id, submission_id, request_hash, resolved_json)
                VALUES (@owner, @submission, @hash, @resolved);
            SELECT ${projection} FROM dbo.watch_task_submissions WHERE owner_object_id=@owner AND submission_id=@submission;
            COMMIT TRANSACTION;
          END TRY
          BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            THROW;
          END CATCH;`, signal);
      if (!result.recordset[0]) throw new Error('Task submission was not reserved');
      return receipt(result.recordset[0]);
    },
    async complete(owner, submissionId, requestHash, result, signal) {
      const saved = await query(request(owner, submissionId)
        .input('hash', sql.Char(64), requestHash)
        .input('result', sql.NVarChar(sql.MAX), JSON.stringify(result)), `
          UPDATE dbo.watch_task_submissions SET result_json=COALESCE(result_json, @result)
            WHERE owner_object_id=@owner AND submission_id=@submission AND request_hash=@hash;`, signal);
      if (saved.rowsAffected[0] !== 1) throw new Error('Task submission receipt was not saved');
    },
  };
}
