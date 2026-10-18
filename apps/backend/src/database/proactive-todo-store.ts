import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { ProactiveTodoReceiptStore, TodoReceiptInput, TodoReceiptSummary } from '../proactive/todo-store.js';

export function createProactiveTodoReceiptStore(
  pool: sql.ConnectionPool,
  ownerObjectId: string,
): ProactiveTodoReceiptStore {
  const owner = ownerObjectId.toLowerCase();
  return {
    async list(dedupeKeys: readonly string[]): Promise<TodoReceiptSummary[]> {
      if (dedupeKeys.length === 0) return [];
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('keys', sql.NVarChar(sql.MAX), JSON.stringify(dedupeKeys))
        .query<{ dedupe_key: string; status: 'added' | 'skipped' | 'failed'; attempt_count: number }>(`
          SELECT receipt.dedupe_key, receipt.status, COUNT(*) AS attempt_count
          FROM dbo.proactive_todo_receipts AS receipt
          INNER JOIN OPENJSON(@keys) WITH (dedupe_key char(32) '$') AS requested
            ON requested.dedupe_key = receipt.dedupe_key
          WHERE receipt.owner_object_id = @owner
          GROUP BY receipt.dedupe_key, receipt.status;`);
      const summaries = new Map<string, TodoReceiptSummary>();
      for (const row of recordset) {
        const summary = summaries.get(row.dedupe_key) ?? {
          dedupeKey: row.dedupe_key,
          added: false,
          skipped: false,
          failedAttempts: 0,
        };
        if (row.status === 'added') summary.added = true;
        else if (row.status === 'skipped') summary.skipped = true;
        else summary.failedAttempts = Number(row.attempt_count);
        summaries.set(row.dedupe_key, summary);
      }
      return [...summaries.values()];
    },
    async countAdded(dayKey: string): Promise<number> {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('dayKey', sql.Char(10), dayKey)
        .query<{ count: number }>(`SELECT COUNT(*) AS count FROM dbo.proactive_todo_receipts
          WHERE owner_object_id = @owner AND day_key = @dayKey AND status = N'added';`);
      return Number(recordset[0]?.count ?? 0);
    },
    async insert(input: TodoReceiptInput): Promise<boolean> {
      const request = pool.request()
        .input('id', sql.UniqueIdentifier, randomUUID())
        .input('owner', sql.UniqueIdentifier, owner)
        .input('itemId', sql.UniqueIdentifier, input.itemId)
        .input('key', sql.Char(32), input.dedupeKey)
        .input('dayKey', sql.Char(10), input.dayKey)
        .input('runId', sql.UniqueIdentifier, input.runId)
        .input('status', sql.NVarChar(16), input.status)
        .input('reason', sql.NVarChar(64), input.reason)
        .input('commitSha', sql.Char(40), input.commitSha);
      const { recordset } = await request.query<{ inserted: boolean }>(`
        BEGIN TRY
          INSERT dbo.proactive_todo_receipts
            (id, owner_object_id, item_id, dedupe_key, day_key, run_id, status, reason, commit_sha)
          VALUES (@id, @owner, @itemId, @key, @dayKey, @runId, @status, @reason, @commitSha);
          SELECT CAST(1 AS bit) AS inserted;
        END TRY
        BEGIN CATCH
          IF @status = N'added' AND ERROR_NUMBER() IN (2601, 2627)
            SELECT CAST(0 AS bit) AS inserted;
          ELSE THROW;
        END CATCH;`);
      return recordset[0]?.inserted === true;
    },
  };
}
