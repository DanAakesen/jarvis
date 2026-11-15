import sql from 'mssql';
import type { InboxOpsStore, InboxSpendKind, InboxSpendRow } from '../inbox/ops.js';
import { databaseReadRequest } from './wake-retry.js';

async function query<T>(request: sql.Request, statement: string, signal: AbortSignal): Promise<sql.IResult<T>> {
  signal.throwIfAborted();
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try { return await request.query<T>(statement); }
  finally { signal.removeEventListener('abort', cancel); }
}

/** Azure SQL implementation of the inbox's small operational state and spend ledger (migration 0085). */
export function createInboxOpsStore(pool: sql.ConnectionPool): InboxOpsStore {
  return {
    async getState(key, signal) {
      const result = await query<{ state_value: string }>(databaseReadRequest(pool).input('key', sql.VarChar(40), key),
        'SELECT state_value FROM dbo.inbox_state WHERE state_key=@key;', signal);
      return result.recordset[0]?.state_value ?? null;
    },
    async setState(key, value, signal) {
      await query(pool.request().input('key', sql.VarChar(40), key).input('value', sql.NVarChar(2000), value), `
        SET XACT_ABORT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          UPDATE dbo.inbox_state WITH (UPDLOCK, HOLDLOCK) SET state_value=@value, updated_at=SYSUTCDATETIME() WHERE state_key=@key;
          IF @@ROWCOUNT = 0 INSERT dbo.inbox_state (state_key, state_value) VALUES (@key, @value);
          COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
          IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;`, signal);
    },
    async deleteState(key, signal) {
      await query(pool.request().input('key', sql.VarChar(40), key), 'DELETE FROM dbo.inbox_state WHERE state_key=@key;', signal);
    },
    async addSpend(day, kind, usage, signal) {
      await query(pool.request()
        .input('day', sql.Date, day).input('kind', sql.VarChar(16), kind).input('calls', sql.Int, usage.calls)
        .input('input', sql.BigInt, usage.inputTokens).input('output', sql.BigInt, usage.outputTokens)
        .input('dkk', sql.Decimal(12, 6), usage.estimatedDkk), `
        SET XACT_ABORT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          UPDATE dbo.inbox_spend WITH (UPDLOCK, HOLDLOCK)
            SET calls=calls+@calls, input_tokens=input_tokens+@input, output_tokens=output_tokens+@output, estimated_dkk=estimated_dkk+@dkk
            WHERE spend_day=@day AND kind=@kind;
          IF @@ROWCOUNT = 0
            INSERT dbo.inbox_spend (spend_day, kind, calls, input_tokens, output_tokens, estimated_dkk) VALUES (@day, @kind, @calls, @input, @output, @dkk);
          COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
          IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;`, signal);
    },
    async spendSince(fromDay, signal) {
      const result = await query<{ day: string; kind: InboxSpendKind; calls: number; input_tokens: string; output_tokens: string; estimated_dkk: number }>(
        databaseReadRequest(pool).input('from', sql.Date, fromDay),
        `SELECT CONVERT(char(10), spend_day, 23) AS day, kind, calls, input_tokens, output_tokens, estimated_dkk
           FROM dbo.inbox_spend WHERE spend_day >= @from ORDER BY spend_day, kind;`, signal);
      return result.recordset.map((row): InboxSpendRow => ({
        day: row.day, kind: row.kind, calls: row.calls,
        inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), estimatedDkk: Number(row.estimated_dkk),
      }));
    },
  };
}
