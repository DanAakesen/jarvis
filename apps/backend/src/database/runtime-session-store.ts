import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import type { ConversationLanguage } from '../core/conversation-store.js';
import { parseRuntimeTest, validateNativeConversationId, validateRuntimeSessionId, validateRuntimeSessionOwner,
  validateManagedTarget, validateManagedTurnClaim, type ManagedTurnClaimResult,
  type RuntimeSessionStore, type RuntimeTestSession } from '../core/runtime-session.js';
import { databaseReadRequest } from './wake-retry.js';

interface Row {
  id: string; language: ConversationLanguage; started_at: Date; ended_at: Date | null;
  runtime_test: unknown; native_conversation_id: string | null;
}
function fromRow(row: Row): RuntimeTestSession {
  const runtimeTest = parseRuntimeTest(row.runtime_test);
  if (!runtimeTest) throw new Error('Missing persisted runtime test selection');
  return { session: { id: row.id, channel: 'chat', language: row.language, startedAt: row.started_at,
    endedAt: row.ended_at }, runtimeTest, nativeConversationId: row.native_conversation_id };
}
const projection = `CONVERT(varchar(20), s.id) AS id, s.language, s.started_at, s.ended_at,
  r.runtime_test, r.native_conversation_id`;

export function createRuntimeSessionStore(pool: sql.ConnectionPool): RuntimeSessionStore {
  return {
    async createSession(input) {
      validateRuntimeSessionOwner(input.ownerObjectId);
      const runtimeTest = parseRuntimeTest(input.runtimeTest);
      if (!runtimeTest || (input.language !== 'da' && input.language !== 'en')) throw new TypeError('Invalid runtime session');
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const result = await transaction.request()
          .input('owner', sql.UniqueIdentifier, input.ownerObjectId)
          .input('language', sql.NVarChar(8), input.language)
          .input('runtimeTest', sql.NVarChar(16), runtimeTest)
          .query<Row>(`DECLARE @created TABLE (id bigint);
            INSERT INTO dbo.jarvis_sessions (channel, language)
              OUTPUT INSERTED.id INTO @created VALUES (N'chat', @language);
            INSERT INTO dbo.session_runtime_tests (jarvis_session_id, owner_object_id, runtime_test)
              SELECT id, @owner, @runtimeTest FROM @created;
            SELECT ${projection} FROM dbo.jarvis_sessions s
              JOIN dbo.session_runtime_tests r ON r.jarvis_session_id = s.id
              JOIN @created c ON c.id = s.id;`);
        const row = result.recordset[0];
        if (!row) throw new Error('Runtime session was not created');
        const session = fromRow(row);
        await transaction.commit();
        return session;
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve original failure. */ }
        throw error;
      }
    },
    async getSession(ownerObjectId, sessionId) {
      validateRuntimeSessionOwner(ownerObjectId);
      validateRuntimeSessionId(sessionId);
      const result = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .query<Row>(`SELECT ${projection} FROM dbo.jarvis_sessions s
          JOIN dbo.session_runtime_tests r ON r.jarvis_session_id = s.id
          WHERE s.id = @sessionId AND r.owner_object_id = @owner;`);
      return result.recordset[0] ? fromRow(result.recordset[0]) : null;
    },
    async claimTurn(input) {
      validateRuntimeSessionOwner(input.ownerObjectId);
      validateRuntimeSessionId(input.sessionId);
      validateRuntimeSessionId(input.sourceMessageId);
      validateManagedTarget(input.target);
      const claimId = randomUUID();
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const result = await transaction.request()
          .input('owner', sql.UniqueIdentifier, input.ownerObjectId)
          .input('sessionId', sql.BigInt, BigInt(input.sessionId))
          .input('sourceId', sql.BigInt, BigInt(input.sourceMessageId))
          .input('claimId', sql.UniqueIdentifier, claimId)
          .input('model', sql.NVarChar(100), input.target.model)
          .input('effort', sql.NVarChar(32), input.target.effort)
          .input('agentName', sql.NVarChar(128), input.target.agentName)
          .input('version', sql.NVarChar(128), input.target.version)
          .input('fingerprint', sql.VarChar(64), input.target.fingerprint)
          .query<{ kind: ManagedTurnClaimResult['kind']; native_conversation_id?: string | null }>(`
            -- Serialize all claims for this persisted session before inspecting source/ledger/target.
            DECLARE @locked bigint;
            SELECT @locked = r.jarvis_session_id FROM dbo.session_runtime_tests r WITH (UPDLOCK, HOLDLOCK)
              JOIN dbo.jarvis_sessions s ON s.id = r.jarvis_session_id
              WHERE r.jarvis_session_id = @sessionId AND r.owner_object_id = @owner
                AND r.runtime_test = N'copilot' AND s.ended_at IS NULL;
            IF @locked IS NULL OR NOT EXISTS (
              SELECT 1 FROM dbo.messages WITH (HOLDLOCK) WHERE id = @sourceId
                AND jarvis_session_id = @sessionId AND role = N'dan')
              SELECT 'unavailable' AS kind;
            ELSE IF EXISTS (SELECT 1 FROM dbo.session_runtime_sources WHERE jarvis_session_id = @sessionId AND source_message_id = @sourceId)
              SELECT 'source_already_claimed' AS kind;
            ELSE IF EXISTS (SELECT 1 FROM dbo.session_runtime_turns WHERE jarvis_session_id = @sessionId AND status = N'active')
              SELECT 'session_busy' AS kind;
            ELSE IF EXISTS (SELECT 1 FROM dbo.session_runtime_tests WHERE jarvis_session_id = @sessionId AND target_model IS NOT NULL
              AND (target_model <> @model OR target_effort <> @effort OR target_agent_name <> @agentName
                OR target_version <> @version OR target_fingerprint <> @fingerprint))
              SELECT 'target_mismatch' AS kind;
            ELSE BEGIN
              UPDATE dbo.session_runtime_tests SET target_model = @model, target_effort = @effort,
                target_agent_name = @agentName, target_version = @version, target_fingerprint = @fingerprint
                WHERE jarvis_session_id = @sessionId AND target_model IS NULL;
              INSERT INTO dbo.session_runtime_turns (jarvis_session_id, source_message_id, claim_id, status)
                VALUES (@sessionId, @sourceId, @claimId, N'active');
              INSERT INTO dbo.session_runtime_sources (jarvis_session_id, source_message_id, claim_id)
                VALUES (@sessionId, @sourceId, @claimId);
              SELECT 'claimed' AS kind, native_conversation_id FROM dbo.session_runtime_tests WHERE jarvis_session_id = @sessionId;
            END;`);
        const row = result.recordset[0];
        if (!row) throw new Error('Missing managed turn claim result');
        if (row.kind !== 'claimed') {
          if (!['unavailable', 'source_already_claimed', 'session_busy', 'target_mismatch'].includes(row.kind)) {
            throw new Error('Invalid managed turn claim result');
          }
          await transaction.rollback();
          return { kind: row.kind };
        }
        await transaction.commit();
        return { kind: 'claimed', claimId, nativeConversationId: row.native_conversation_id ?? null };
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve original failure, including uncertain commit. */ }
        throw error;
      }
    },
    async attachSource(input) {
      validateManagedTurnClaim(input);
      validateRuntimeSessionId(input.additionalSourceMessageId);
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const result = await transaction.request()
          .input('owner', sql.UniqueIdentifier, input.ownerObjectId)
          .input('sessionId', sql.BigInt, BigInt(input.sessionId))
          .input('sourceId', sql.BigInt, BigInt(input.sourceMessageId))
          .input('claimId', sql.UniqueIdentifier, input.claimId)
          .input('additionalSourceId', sql.BigInt, BigInt(input.additionalSourceMessageId))
          .query<{ attached: boolean }>(`DECLARE @active bigint;
            SELECT @active = t.source_message_id
              FROM dbo.session_runtime_tests r WITH (UPDLOCK, HOLDLOCK)
              JOIN dbo.jarvis_sessions s ON s.id = r.jarvis_session_id
              JOIN dbo.session_runtime_turns t WITH (UPDLOCK, HOLDLOCK) ON t.jarvis_session_id = r.jarvis_session_id
              WHERE r.jarvis_session_id = @sessionId AND r.owner_object_id = @owner
                AND r.runtime_test = N'copilot' AND s.ended_at IS NULL
                AND t.source_message_id = @sourceId AND t.claim_id = @claimId AND t.status = N'active';
            IF @active IS NULL OR @additionalSourceId <= @sourceId OR NOT EXISTS (
              SELECT 1 FROM dbo.messages WITH (HOLDLOCK) WHERE id = @additionalSourceId
                AND jarvis_session_id = @sessionId AND role = N'dan')
              SELECT CONVERT(bit, 0) AS attached;
            ELSE IF EXISTS (SELECT 1 FROM dbo.session_runtime_sources
              WHERE jarvis_session_id = @sessionId AND source_message_id = @additionalSourceId)
              SELECT CONVERT(bit, CASE WHEN EXISTS (SELECT 1 FROM dbo.session_runtime_sources
                WHERE jarvis_session_id = @sessionId AND source_message_id = @additionalSourceId AND claim_id = @claimId)
                THEN 1 ELSE 0 END) AS attached;
            ELSE BEGIN
              INSERT INTO dbo.session_runtime_sources (jarvis_session_id, source_message_id, claim_id)
                VALUES (@sessionId, @additionalSourceId, @claimId);
              SELECT CONVERT(bit, 1) AS attached;
            END;`);
        const row = result.recordset[0];
        if (!row || typeof row.attached !== 'boolean') throw new Error('Missing managed source attachment result');
        if (!row.attached) {
          await transaction.rollback();
          return false;
        }
        await transaction.commit();
        return true;
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve original failure, including uncertain commit. */ }
        throw error;
      }
    },
    async completeTurn(input) {
      validateManagedTurnClaim(input);
      if (input.outcome !== 'succeeded' && input.outcome !== 'failed') throw new TypeError('Invalid managed turn outcome');
      const result = await pool.request()
        .input('owner', sql.UniqueIdentifier, input.ownerObjectId)
        .input('sessionId', sql.BigInt, BigInt(input.sessionId))
        .input('sourceId', sql.BigInt, BigInt(input.sourceMessageId))
        .input('claimId', sql.UniqueIdentifier, input.claimId)
        .input('outcome', sql.NVarChar(16), input.outcome)
        .query(`UPDATE t SET status = @outcome FROM dbo.session_runtime_turns t
          JOIN dbo.session_runtime_tests r ON r.jarvis_session_id = t.jarvis_session_id
          WHERE t.jarvis_session_id = @sessionId AND t.source_message_id = @sourceId
            AND t.claim_id = @claimId AND t.status = N'active'
            AND r.owner_object_id = @owner AND r.runtime_test = N'copilot';`);
      return result.rowsAffected[0] === 1;
    },
    async bindNativeConversation(input) {
      validateManagedTurnClaim(input);
      validateNativeConversationId(input.nativeConversationId);
      const result = await pool.request()
        .input('owner', sql.UniqueIdentifier, input.ownerObjectId)
        .input('sessionId', sql.BigInt, BigInt(input.sessionId))
        .input('sourceId', sql.BigInt, BigInt(input.sourceMessageId))
        .input('claimId', sql.UniqueIdentifier, input.claimId)
        .input('nativeId', sql.NVarChar(512), input.nativeConversationId)
        .query(`UPDATE r SET native_conversation_id = @nativeId
          FROM dbo.session_runtime_tests r
          JOIN dbo.jarvis_sessions s ON s.id = r.jarvis_session_id
          JOIN dbo.session_runtime_turns t ON t.jarvis_session_id = r.jarvis_session_id
          WHERE r.jarvis_session_id = @sessionId AND r.owner_object_id = @owner
            AND r.runtime_test = N'copilot' AND s.ended_at IS NULL
            AND t.source_message_id = @sourceId AND t.claim_id = @claimId AND t.status = N'active'
            AND (r.native_conversation_id IS NULL OR
              (r.native_conversation_id = @nativeId AND DATALENGTH(r.native_conversation_id) = DATALENGTH(@nativeId)));`);
      return result.rowsAffected[0] === 1;
    },
  };
}
