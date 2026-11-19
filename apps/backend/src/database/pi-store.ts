import sql from 'mssql';
import type { PiConversationRow, PiStore, PiStoredTurn, PiTurnKind } from '../pi/store.js';
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

interface TurnRecord {
  at: Date; kind: PiTurnKind; message_id: string | null; model: string; input_tokens: number; cached_tokens: number;
  output_tokens: number; cost_dkk: number; first_text_ms: number | null; total_ms: number; outcome: PiStoredTurn['outcome'];
  activation_id: string | null; activation_type: PiStoredTurn['activationType'] | null;
  activation_source: string | null; slot_key: string | null; state_revision: string | number | null;
  stale_source_count: number; tool_count: number; action_count: number; push_count: number;
  activation_result: PiStoredTurn['activationResult'] | null;
}

const toTurn = (row: TurnRecord): PiStoredTurn => ({
  at: row.at, kind: row.kind, messageId: row.message_id, model: row.model, inputTokens: row.input_tokens,
  cachedTokens: row.cached_tokens, outputTokens: row.output_tokens, costDkk: Number(row.cost_dkk),
  firstTextMs: row.first_text_ms, totalMs: row.total_ms, outcome: row.outcome,
  ...(row.activation_id ? { activationId: row.activation_id.toLowerCase() } : {}),
  ...(row.activation_type ? { activationType: row.activation_type } : {}),
  activationSource: row.activation_source,
  slotKey: row.slot_key,
  stateRevision: row.state_revision === null ? null : Number(row.state_revision),
  staleSourceCount: Number(row.stale_source_count),
  toolCount: Number(row.tool_count),
  actionCount: Number(row.action_count),
  pushCount: Number(row.push_count),
  ...(row.activation_result ? { activationResult: row.activation_result } : {}),
});

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
        .input('outcome', sql.VarChar(12), turn.outcome)
        .input('activationId', sql.UniqueIdentifier, turn.activationId ?? null)
        .input('activationType', sql.VarChar(10), turn.activationType ?? null)
        .input('activationSource', sql.NVarChar(64), turn.activationSource ?? null)
        .input('slotKey', sql.NVarChar(32), turn.slotKey ?? null)
        .input('stateRevision', sql.BigInt, turn.stateRevision ?? null)
        .input('staleSources', sql.Int, turn.staleSourceCount ?? 0)
        .input('toolCount', sql.Int, turn.toolCount ?? 0)
        .input('actionCount', sql.Int, turn.actionCount ?? 0)
        .input('pushCount', sql.Int, turn.pushCount ?? 0)
        .input('activationResult', sql.VarChar(8), turn.activationResult ?? null),
      `INSERT dbo.pi_turn (
          kind, message_id, model, input_tokens, cached_tokens, output_tokens, cost_dkk, first_text_ms, total_ms, outcome,
          activation_id, activation_type, activation_source, slot_key, state_revision, stale_source_count,
          tool_count, action_count, push_count, activation_result
        ) VALUES (
          @kind, @message, @model, @input, @cached, @output, @cost, @first, @total, @outcome,
          @activationId, @activationType, @activationSource, @slotKey, @stateRevision, @staleSources,
          @toolCount, @actionCount, @pushCount, @activationResult
        );`, signal);
    },
    async spendSince(from, kinds, signal) {
      const result = await query<{ cost: number | null; turns: number }>(
        databaseReadRequest(pool).input('from', sql.DateTime2, from).input('kinds', sql.VarChar(64), kinds.join(',')),
        `SELECT COALESCE(SUM(cost_dkk), 0) AS cost, COUNT(*) AS turns FROM dbo.pi_turn
          WHERE at >= @from AND kind IN (SELECT value FROM STRING_SPLIT(@kinds, ','));`, signal);
      const row = result.recordset[0];
      return { costDkk: Number(row?.cost ?? 0), turns: Number(row?.turns ?? 0) };
    },
    async recentTurns(limit, kinds, signal) {
      const result = await query<TurnRecord>(databaseReadRequest(pool).input('limit', sql.Int, limit).input('kinds', sql.VarChar(64), kinds.join(',')),
        `SELECT TOP (@limit) at, kind, CONVERT(varchar(19), message_id) AS message_id, model, input_tokens, cached_tokens,
          output_tokens, cost_dkk, first_text_ms, total_ms, outcome, CONVERT(varchar(36), activation_id) AS activation_id,
          activation_type, activation_source, slot_key, CONVERT(varchar(19), state_revision) AS state_revision,
          stale_source_count, tool_count, action_count, push_count, activation_result FROM dbo.pi_turn
          WHERE kind IN (SELECT value FROM STRING_SPLIT(@kinds, ',')) ORDER BY id DESC;`, signal);
      return result.recordset.map(toTurn);
    },
    async lastTurn(kinds, signal) {
      const result = await query<TurnRecord>(databaseReadRequest(pool).input('kinds', sql.VarChar(64), kinds.join(',')), `SELECT TOP (1) at, kind,
        CONVERT(varchar(19), message_id) AS message_id, model, input_tokens, cached_tokens, output_tokens, cost_dkk,
      first_text_ms, total_ms, outcome, CONVERT(varchar(36), activation_id) AS activation_id,
      activation_type, activation_source, slot_key, CONVERT(varchar(19), state_revision) AS state_revision,
      stale_source_count, tool_count, action_count, push_count, activation_result
      FROM dbo.pi_turn WHERE kind IN (SELECT value FROM STRING_SPLIT(@kinds, ',')) ORDER BY id DESC;`, signal);
      const row = result.recordset[0];
      return row ? toTurn(row) : null;
    },
    async readBrainSwitch(owner, signal) {
      const result = await query<{ brain: boolean; updated_at: Date }>(databaseReadRequest(pool).input('owner', sql.UniqueIdentifier, owner),
        `SELECT brain, updated_at FROM dbo.pi_switch WHERE owner_object_id=@owner;`, signal);
      const row = result.recordset[0];
      return { enabled: row?.brain === true, updatedAt: row?.updated_at ?? null };
    },
    async writeBrainSwitch(owner, enabled, at, signal) {
      await query(pool.request().input('owner', sql.UniqueIdentifier, owner).input('brain', sql.Bit, enabled).input('at', sql.DateTime2, at), `
        MERGE dbo.pi_switch WITH (HOLDLOCK) AS target USING (SELECT @owner AS owner_object_id) AS source ON target.owner_object_id = source.owner_object_id
        WHEN MATCHED THEN UPDATE SET brain=@brain, updated_at=@at
        WHEN NOT MATCHED THEN INSERT (owner_object_id, brain, updated_at) VALUES (@owner, @brain, @at);`, signal);
    },
    async recordMessage(message, at, signal) {
      await query(pool.request().input('at', sql.DateTime2, at).input('run', sql.Char(36), message.runId)
        .input('session', sql.BigInt, message.sessionId).input('message', sql.BigInt, message.messageId).input('hash', sql.Char(64), message.textHash),
      `INSERT dbo.pi_message (at, run_id, session_id, message_id, text_hash) VALUES (@at, @run, @session, @message, @hash);`, signal);
    },
    async recordLook(watch, runId, at, signal) {
      await query(pool.request().input('watch', sql.NVarChar(120), watch).input('run', sql.Char(36), runId).input('at', sql.DateTime2, at),
        `INSERT dbo.pi_watch_look (at, watch, run_id) VALUES (@at, @watch, @run);`, signal);
    },
    async allocateRunCost(runId, perLookDkk, signal) {
      await query(pool.request().input('run', sql.Char(36), runId).input('cost', sql.Decimal(12, 6), perLookDkk),
        `UPDATE dbo.pi_watch_look SET cost_dkk=@cost WHERE run_id=@run;`, signal);
    },
    async watchActivity(from, signal) {
      const result = await query<{ watch: string; looks: number; cost: number; last: Date }>(databaseReadRequest(pool).input('from', sql.DateTime2, from),
        `SELECT watch, COUNT(*) AS looks, COALESCE(SUM(cost_dkk), 0) AS cost, MAX(at) AS last FROM dbo.pi_watch_look WHERE at >= @from GROUP BY watch;`, signal);
      return result.recordset.map(row => ({ watch: row.watch, looks: Number(row.looks), costDkk: Number(row.cost), lastLookAt: row.last }));
    },
    async messagesSince(from, signal) {
      const result = await query<{ text_hash: string }>(databaseReadRequest(pool).input('from', sql.DateTime2, from),
        `SELECT text_hash FROM dbo.pi_message WHERE at >= @from;`, signal);
      return { count: result.recordset.length, textHashes: result.recordset.map(row => row.text_hash.trim()) };
    },
  };
}
