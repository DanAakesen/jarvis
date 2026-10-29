import sql from 'mssql';
import type { ConversationLanguage } from '../core/conversation-store.js';
import { parseRuntimeTest, validateNativeConversationId, validateRuntimeSessionId, validateRuntimeSessionOwner,
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
    async bindNativeConversation(ownerObjectId, sessionId, nativeConversationId) {
      validateRuntimeSessionOwner(ownerObjectId);
      validateRuntimeSessionId(sessionId);
      validateNativeConversationId(nativeConversationId);
      const result = await pool.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .input('nativeId', sql.NVarChar(512), nativeConversationId)
        .query(`UPDATE r SET native_conversation_id = @nativeId
          FROM dbo.session_runtime_tests r
          JOIN dbo.jarvis_sessions s ON s.id = r.jarvis_session_id
          WHERE r.jarvis_session_id = @sessionId AND r.owner_object_id = @owner
            AND r.runtime_test = N'copilot' AND s.ended_at IS NULL
            AND (r.native_conversation_id IS NULL OR
              (r.native_conversation_id = @nativeId AND DATALENGTH(r.native_conversation_id) = DATALENGTH(@nativeId)));`);
      return result.rowsAffected[0] === 1;
    },
  };
}
