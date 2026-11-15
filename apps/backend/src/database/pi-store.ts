import sql from 'mssql';
import type { PiConversationRow, PiStore, PiStoredTurn } from '../pi/store.js';
import { databaseReadRequest } from './wake-retry.js';

async function query<T>(request: sql.Request, statement: string, signal: AbortSignal): Promise<sql.IResult<T>> {
  signal.throwIfAborted();
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try { return await request.query<T>(statement); }
  finally { signal.removeEventListener('abort', cancel); }
}

interface ConversationRecord {
  agent_name: string;
  conversation_id: string;
  warmed_at: Date | null;
  context_hash: string | null;
}

const toRow = (row: ConversationRecord): PiConversationRow => ({
  agentName: row.agent_name, conversationId: row.conversation_id, warmedAt: row.warmed_at, contextHash: row.context_hash,
});

/** Azure SQL implementation of the PI conversation binding and turn ledger (migration 0086). */
export function createPiStore(pool: sql.ConnectionPool): PiStore {
  return {
    async getConversation(owner, signal) {
      const result = await query<ConversationRecord>(
        databaseReadRequest(pool).input('owner', sql.UniqueIdentifier, owner),
        `SELECT agent_name, conversation_id, warmed_at, context_hash FROM dbo.pi_conversation WHERE owner_object_id=@owner;`,
        signal);
      return result.recordset[0] ? toRow(result.recordset[0]) : null;
    },
    async bindConversation(owner, agentName, conversationId, signal) {
      const result = await query<ConversationRecord>(pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('agent', sql.VarChar(128), agentName)
        .input('conversation', sql.NVarChar(512), conversationId), `
        SET XACT_ABORT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          IF NOT EXISTS (SELECT 1 FROM dbo.pi_conversation WITH (UPDLOCK, HOLDLOCK) WHERE owner_object_id=@owner)
            INSERT dbo.pi_conversation (owner_object_id, agent_name, conversation_id) VALUES (@owner, @agent, @conversation);
          ELSE
            UPDATE dbo.pi_conversation SET agent_name=@agent, conversation_id=@conversation, warmed_at=NULL, context_hash=NULL,
              created_at=SYSUTCDATETIME()
              WHERE owner_object_id=@owner AND agent_name<>@agent;
          SELECT agent_name, conversation_id, warmed_at, context_hash FROM dbo.pi_conversation WHERE owner_object_id=@owner;
          COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
          IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;`, signal);
      return toRow(result.recordset[0]!);
    },
    async dropConversation(owner, signal) {
      await query(pool.request().input('owner', sql.UniqueIdentifier, owner),
        `DELETE FROM dbo.pi_conversation WHERE owner_object_id=@owner;`, signal);
    },
    async markWarm(owner, contextHash, at, signal) {
      await query(pool.request().input('owner', sql.UniqueIdentifier, owner)
        .input('hash', sql.Char(64), contextHash).input('at', sql.DateTime2, at),
      `UPDATE dbo.pi_conversation SET warmed_at=@at, context_hash=@hash WHERE owner_object_id=@owner;`, signal);
    },
    async recordTurn(turn, signal) {
      await query(pool.request()
        .input('kind', sql.VarChar(8), turn.kind)
        .input('message', sql.BigInt, turn.messageId)
        .input('model', sql.VarChar(128), turn.model)
        .input('input', sql.Int, turn.inputTokens).input('cached', sql.Int, turn.cachedTokens)
        .input('output', sql.Int, turn.outputTokens).input('cost', sql.Decimal(12, 6), turn.costDkk)
        .input('first', sql.Int, turn.firstTextMs).input('total', sql.Int, turn.totalMs)
        .input('outcome', sql.VarChar(12), turn.outcome),
      `INSERT dbo.pi_turn (kind, message_id, model, input_tokens, cached_tokens, output_tokens, cost_dkk, first_text_ms, total_ms, outcome)
        VALUES (@kind, @message, @model, @input, @cached, @output, @cost, @first, @total, @outcome);`, signal);
    },
    async spendSince(from, signal) {
      const result = await query<{ cost: number | null; turns: number }>(
        databaseReadRequest(pool).input('from', sql.DateTime2, from),
        `SELECT COALESCE(SUM(cost_dkk), 0) AS cost, COUNT(*) AS turns FROM dbo.pi_turn WHERE at >= @from;`, signal);
      const row = result.recordset[0];
      return { costDkk: Number(row?.cost ?? 0), turns: Number(row?.turns ?? 0) };
    },
    async lastTurn(signal) {
      const result = await query<{
        at: Date; kind: 'chat' | 'warm' | 'smoke'; message_id: string | null; model: string; input_tokens: number; cached_tokens: number;
        output_tokens: number; cost_dkk: number; first_text_ms: number | null; total_ms: number; outcome: PiStoredTurn['outcome'];
      }>(databaseReadRequest(pool), `SELECT TOP (1) at, kind, CONVERT(varchar(19), message_id) AS message_id, model, input_tokens,
        cached_tokens, output_tokens, cost_dkk, first_text_ms, total_ms, outcome FROM dbo.pi_turn ORDER BY id DESC;`, signal);
      const row = result.recordset[0];
      return row ? {
        at: row.at, kind: row.kind, messageId: row.message_id, model: row.model, inputTokens: row.input_tokens,
        cachedTokens: row.cached_tokens, outputTokens: row.output_tokens, costDkk: Number(row.cost_dkk),
        firstTextMs: row.first_text_ms, totalMs: row.total_ms, outcome: row.outcome,
      } : null;
    },
  };
}
