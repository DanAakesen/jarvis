import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type {
  ConversationChannel,
  ConversationHistoryMessage,
  ConversationHistoryPage,
  ConversationLanguage,
  ConversationMessage,
  ConversationSteeringMessage,
  ConversationRole,
  ConversationSession,
  ConversationStore,
  ConversationToolCall,
} from '../core/conversation-store.js';

interface SessionRow {
  id: string;
  channel: ConversationChannel;
  language: ConversationLanguage;
  started_at: Date;
  ended_at: Date | null;
}

interface SessionIdRow extends SessionRow {
  id: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: ConversationRole;
  text: string;
  model: string | null;
  at: Date;
}

interface HistoryRow extends MessageRow {
  channel: ConversationChannel;
  language: ConversationLanguage;
  interrupted: boolean;
  voice_minutes: number | null;
}

interface ToolCallRow {
  id: string;
  message_id: string;
  tool: string;
  outcome: 'ok' | 'refused' | 'error';
  task_id: string | null;
  artifact_id: string | null;
}

function sessionFromRow(row: SessionRow): ConversationSession {
  return {
    id: row.id,
    channel: row.channel,
    language: row.language,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function messageFromRow(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    text: row.text,
    model: row.model,
    at: row.at,
  };
}

export function createConversationStore(pool: sql.ConnectionPool): ConversationStore {
  return {
    async createSession(input) {
      const result = await pool.request()
        .input('channel', sql.NVarChar(16), input.channel)
        .input('language', sql.NVarChar(8), input.language)
        .query<SessionRow>(`INSERT INTO dbo.jarvis_sessions (channel, language)
          OUTPUT CONVERT(varchar(20), INSERTED.id) AS id, INSERTED.channel, INSERTED.language,
            INSERTED.started_at, INSERTED.ended_at
          VALUES (@channel, @language);`);
      const row = result.recordset[0];
      if (!row) throw new Error('Conversation session was not created');
      return sessionFromRow(row);
    },

    async getSession(sessionId) {
      const result = await databaseReadRequest(pool)
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .query<SessionIdRow>(`SELECT CONVERT(varchar(20), id) AS id, channel, language,
          started_at, ended_at
          FROM dbo.jarvis_sessions WHERE id = @sessionId;`);
      const row = result.recordset[0];
      return row ? sessionFromRow(row) : null;
    },

    async endSession(sessionId) {
      const result = await pool.request()
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .query<{ session_exists: number }>(`DECLARE @ended TABLE (
            id bigint NOT NULL,
            channel nvarchar(16) NOT NULL,
            started_at datetime2(7) NOT NULL,
            ended_at datetime2(7) NOT NULL
          );
          BEGIN TRY
            BEGIN TRANSACTION;
            UPDATE dbo.jarvis_sessions
            SET ended_at = SYSUTCDATETIME()
            OUTPUT INSERTED.id, INSERTED.channel, DELETED.started_at, INSERTED.ended_at
              INTO @ended (id, channel, started_at, ended_at)
            WHERE id = @sessionId AND ended_at IS NULL;

            INSERT INTO dbo.usage (jarvis_session_id, source, metric, quantity, source_event_id, at)
            SELECT id, N'voice', N'minutes',
              CONVERT(decimal(19,6), DATEDIFF_BIG(MILLISECOND, started_at, ended_at)) / 60000.0,
              CONVERT(nvarchar(300), id), ended_at
            FROM @ended
            WHERE channel = N'voice';

            DECLARE @session_exists int = CONVERT(int, CASE WHEN EXISTS (
              SELECT 1 FROM dbo.jarvis_sessions WHERE id = @sessionId
            ) THEN 1 ELSE 0 END);
            COMMIT TRANSACTION;
            SELECT @session_exists AS session_exists;
          END TRY
          BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            THROW;
          END CATCH;`);
      return result.recordset[0]?.session_exists === 1;
    },

    async addMessage(input) {
      const result = await pool.request()
        .input('sessionId', sql.BigInt, BigInt(input.sessionId))
        .input('role', sql.NVarChar(16), input.role)
        .input('text', sql.NVarChar(sql.MAX), input.text)
        .input('model', sql.NVarChar(100), input.model)
        .input('language', sql.NVarChar(8), input.language ?? null)
        .input('interrupted', sql.Bit, input.interrupted ?? false)
        .input('sourceItemId', sql.NVarChar(128), input.sourceItemId ?? null)
        .query<MessageRow>(`INSERT INTO dbo.messages
            (jarvis_session_id, role, text, model, language, interrupted, source_item_id)
          OUTPUT CONVERT(varchar(20), INSERTED.id) AS id,
            CONVERT(varchar(20), INSERTED.jarvis_session_id) AS session_id,
            INSERTED.role, INSERTED.text, INSERTED.model, INSERTED.at
          SELECT id, @role, @text, @model, @language, @interrupted, @sourceItemId
          FROM dbo.jarvis_sessions
          WHERE id = @sessionId AND ended_at IS NULL;`);
      const row = result.recordset[0];
      return row ? messageFromRow(row) : null;
    },

    async updateMessage(messageId, text) {
      const result = await pool.request()
        .input('messageId', sql.BigInt, BigInt(messageId))
        .input('text', sql.NVarChar(sql.MAX), text)
        .query<MessageRow>(`UPDATE dbo.messages
          SET text = @text
          OUTPUT CONVERT(varchar(20), INSERTED.id) AS id,
            CONVERT(varchar(20), INSERTED.jarvis_session_id) AS session_id,
            INSERTED.role, INSERTED.text, INSERTED.model, INSERTED.at
          WHERE id = @messageId AND role = N'dan';`);
      const row = result.recordset[0];
      return row ? messageFromRow(row) : null;
    },

    async getDanMessageIdBySourceItemId(sourceItemId) {
      const result = await databaseReadRequest(pool)
        .input('sourceItemId', sql.NVarChar(128), sourceItemId)
        .query<{ id: string }>(`SELECT TOP (1) CONVERT(varchar(20), id) AS id
          FROM dbo.messages
          WHERE source_item_id = @sourceItemId AND role = N'dan'
          ORDER BY id DESC;`);
      return result.recordset[0]?.id ?? null;
    },

    async getHistory({ limit, before }) {
      const result = await databaseReadRequest(pool)
        .input('take', sql.Int, limit + 1)
        .input('beforeId', sql.BigInt, before === undefined ? null : BigInt(before))
        .query<HistoryRow>(`DECLARE @history TABLE (
            id bigint NOT NULL PRIMARY KEY,
            session_id bigint NOT NULL,
            channel nvarchar(16) NOT NULL,
            language nvarchar(8) NOT NULL,
            role nvarchar(16) NOT NULL,
            text nvarchar(max) NOT NULL,
            model nvarchar(100) NULL,
            voice_minutes decimal(19,6) NULL,
            at datetime2(7) NOT NULL
          );
          INSERT INTO @history (id, session_id, channel, language, role, text, model, voice_minutes, at)
          SELECT TOP (@take) m.id, m.jarvis_session_id, s.channel, COALESCE(m.language, s.language) AS language,
            m.role, m.text, m.model, m.interrupted,
            voice_usage.voice_minutes, m.at
          FROM dbo.messages AS m
          INNER JOIN dbo.jarvis_sessions AS s ON s.id = m.jarvis_session_id
          OUTER APPLY (
            SELECT SUM(u.quantity) AS voice_minutes
            FROM dbo.usage AS u
            WHERE u.jarvis_session_id = s.id AND u.source = N'voice' AND u.metric = N'minutes'
          ) AS voice_usage
          WHERE @beforeId IS NULL OR m.id < @beforeId
          ORDER BY m.id DESC;

          SELECT CONVERT(varchar(20), id) AS id,
            CONVERT(varchar(20), session_id) AS session_id, channel, language, role, text, model,
            interrupted, voice_minutes, at
          FROM @history
          ORDER BY id;

          SELECT CONVERT(varchar(20), tc.id) AS id,
            CONVERT(varchar(20), tc.message_id) AS message_id, tc.tool, tc.outcome,
            CONVERT(varchar(20), tc.task_id) AS task_id,
            CASE WHEN tc.tool = N'image_generation' AND tc.outcome = N'ok'
              THEN TRY_CONVERT(varchar(36), TRY_CONVERT(uniqueidentifier, JSON_VALUE(tc.result, '$.artifactId')))
              ELSE NULL END AS artifact_id
          FROM dbo.tool_calls AS tc
          INNER JOIN @history AS h ON h.id = tc.message_id
          ORDER BY tc.message_id, tc.id;`);
      const messageRows = (result.recordsets[0] ?? []) as HistoryRow[];
      const toolCallRows = (result.recordsets[1] ?? []) as ToolCallRow[];
      const hasMore = messageRows.length > limit;
      const pageRows = hasMore ? messageRows.slice(1) : messageRows;
      const callsByMessage = new Map<string, ConversationToolCall[]>();
      for (const call of toolCallRows) {
        const calls = callsByMessage.get(call.message_id) ?? [];
        const artifactId = call.artifact_id && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(call.artifact_id)
          ? call.artifact_id
          : undefined;
        calls.push({
          id: call.id,
          tool: call.tool,
          outcome: call.outcome,
          taskId: call.task_id,
          ...(artifactId === undefined ? {} : { artifactId }),
        });
        callsByMessage.set(call.message_id, calls);
      }
      const messages: ConversationHistoryMessage[] = pageRows.map((row) => ({
        ...messageFromRow(row),
        channel: row.channel,
        language: row.language,
        interrupted: row.interrupted,
        voiceMinutes: row.voice_minutes,
        toolCalls: callsByMessage.get(row.id) ?? [],
      }));
      return {
        messages,
        nextCursor: hasMore ? messages[0]?.id ?? null : null,
      } satisfies ConversationHistoryPage;
    },

    async getDanMessagesAfter({ sessionId, after, limit }) {
      const result = await databaseReadRequest(pool)
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .input('afterId', sql.BigInt, BigInt(after))
        .input('take', sql.Int, limit)
        .query<ConversationSteeringMessage>(`SELECT TOP (@take)
            CONVERT(varchar(20), m.id) AS id, m.text, COALESCE(m.language, s.language) AS language
          FROM dbo.messages AS m
          INNER JOIN dbo.jarvis_sessions AS s ON s.id = m.jarvis_session_id
          WHERE m.jarvis_session_id = @sessionId AND m.role = N'dan' AND m.id > @afterId
          ORDER BY m.id;`);
      return result.recordset;
    },
  };
}
