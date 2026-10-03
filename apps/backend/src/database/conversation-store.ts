import sql from 'mssql';
import type {
  ConversationChannel,
  ConversationHistoryMessage,
  ConversationHistoryPage,
  ConversationLanguage,
  ConversationMessage,
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
}

interface ToolCallRow {
  id: string;
  message_id: string;
  tool: string;
  outcome: 'ok' | 'error';
  task_id: string | null;
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

    async endSession(sessionId) {
      const result = await pool.request()
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .query<{ session_exists: number }>(`UPDATE dbo.jarvis_sessions
          SET ended_at = SYSUTCDATETIME()
          WHERE id = @sessionId AND ended_at IS NULL;
          SELECT CONVERT(int, CASE WHEN EXISTS (
            SELECT 1 FROM dbo.jarvis_sessions WHERE id = @sessionId
          ) THEN 1 ELSE 0 END) AS session_exists;`);
      return result.recordset[0]?.session_exists === 1;
    },

    async addMessage(input) {
      const result = await pool.request()
        .input('sessionId', sql.BigInt, BigInt(input.sessionId))
        .input('role', sql.NVarChar(16), input.role)
        .input('text', sql.NVarChar(sql.MAX), input.text)
        .input('model', sql.NVarChar(100), input.model)
        .query<MessageRow>(`INSERT INTO dbo.messages (jarvis_session_id, role, text, model)
          OUTPUT CONVERT(varchar(20), INSERTED.id) AS id,
            CONVERT(varchar(20), INSERTED.jarvis_session_id) AS session_id,
            INSERTED.role, INSERTED.text, INSERTED.model, INSERTED.at
          SELECT id, @role, @text, @model
          FROM dbo.jarvis_sessions
          WHERE id = @sessionId AND ended_at IS NULL;`);
      const row = result.recordset[0];
      return row ? messageFromRow(row) : null;
    },

    async getHistory({ limit, before }) {
      const result = await pool.request()
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
            at datetime2(7) NOT NULL
          );
          INSERT INTO @history (id, session_id, channel, language, role, text, model, at)
          SELECT TOP (@take) m.id, m.jarvis_session_id, s.channel, s.language, m.role, m.text, m.model, m.at
          FROM dbo.messages AS m
          INNER JOIN dbo.jarvis_sessions AS s ON s.id = m.jarvis_session_id
          WHERE @beforeId IS NULL OR m.id < @beforeId
          ORDER BY m.id DESC;

          SELECT CONVERT(varchar(20), id) AS id,
            CONVERT(varchar(20), session_id) AS session_id, channel, language, role, text, model, at
          FROM @history
          ORDER BY id;

          SELECT CONVERT(varchar(20), tc.id) AS id,
            CONVERT(varchar(20), tc.message_id) AS message_id, tc.tool, tc.outcome,
            CONVERT(varchar(20), tc.task_id) AS task_id
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
        calls.push({ id: call.id, tool: call.tool, outcome: call.outcome, taskId: call.task_id });
        callsByMessage.set(call.message_id, calls);
      }
      const messages: ConversationHistoryMessage[] = pageRows.map((row) => ({
        ...messageFromRow(row),
        channel: row.channel,
        language: row.language,
        toolCalls: callsByMessage.get(row.id) ?? [],
      }));
      return {
        messages,
        nextCursor: hasMore ? messages[0]?.id ?? null : null,
      } satisfies ConversationHistoryPage;
    },
  };
}
