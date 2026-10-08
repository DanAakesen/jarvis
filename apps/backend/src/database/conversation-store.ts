import sql from 'mssql';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { databaseReadRequest } from './wake-retry.js';
import type {
  ConversationChannel,
  ConversationHistoryMessage,
  ConversationHistoryPage,
  ConversationSearchInput,
  ConversationLanguage,
  ConversationMessage,
  ConversationSteeringMessage,
  ConversationRole,
  ConversationSession,
  ConversationStore,
  ConversationToolCall,
} from '../core/conversation-store.js';

const conversationSearchSetupPath = fileURLToPath(
  new URL('../../../../db/migrations/setup/0032_conversation_search.sql', import.meta.url),
);
const execute = async <T>(request: sql.Request, signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
  signal.throwIfAborted();
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await work();
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
};

function searchTerms(query: string): string[] {
  return [...new Set(query.match(/[\p{L}\p{N}]{2,}/gu)?.map((term) => term.toLowerCase().slice(0, 64)) ?? [])].slice(0, 8);
}

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
  let initialized = false;
  let fullTextSearchAvailable = false;
  return {
    async initialize() {
      if (initialized) return;
      const setup = await readFile(conversationSearchSetupPath, 'utf8');
      await pool.request().query(setup);
      const result = await pool.request().query<{ fulltext_search: boolean }>(
        `SELECT CONVERT(bit, CASE WHEN EXISTS (
          SELECT 1 FROM sys.fulltext_indexes WHERE object_id = OBJECT_ID(N'dbo.messages')
        ) THEN 1 ELSE 0 END) AS fulltext_search;`);
      fullTextSearchAvailable = result.recordset[0]?.fulltext_search === true;
      initialized = true;
    },

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
        .input('allowEndedSession', sql.Bit, input.allowEndedSession ?? false)
        .query<MessageRow>(`INSERT INTO dbo.messages
            (jarvis_session_id, role, text, model, language, interrupted, source_item_id)
          OUTPUT CONVERT(varchar(20), INSERTED.id) AS id,
            CONVERT(varchar(20), INSERTED.jarvis_session_id) AS session_id,
            INSERTED.role, INSERTED.text, INSERTED.model, INSERTED.at
          SELECT id, @role, @text, @model, @language, @interrupted, @sourceItemId
          FROM dbo.jarvis_sessions
          WHERE id = @sessionId AND (ended_at IS NULL OR @allowEndedSession = 1);`);
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

    async getMessageSessionId(messageId) {
      const result = await databaseReadRequest(pool)
        .input('messageId', sql.BigInt, BigInt(messageId))
        .query<{ session_id: string }>(`SELECT CONVERT(varchar(20), jarvis_session_id) AS session_id
          FROM dbo.messages WHERE id = @messageId AND role = N'dan';`);
      return result.recordset[0]?.session_id ?? null;
    },

    async getLatestDanMessageText(sessionId) {
      const result = await databaseReadRequest(pool)
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .query<{ text: string }>(`SELECT TOP (1) text FROM dbo.messages
          WHERE jarvis_session_id = @sessionId AND role = N'dan' ORDER BY id DESC;`);
      return result.recordset[0]?.text ?? null;
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
            interrupted bit NOT NULL,
            voice_minutes decimal(19,6) NULL,
            at datetime2(7) NOT NULL
          );
          INSERT INTO @history (id, session_id, channel, language, role, text, model, interrupted, voice_minutes, at)
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

    async searchMessages(input: ConversationSearchInput, signal: AbortSignal) {
      const query = input.query.trim();
      if (!query || query.length > 500 || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50 ||
          (input.from && !Number.isFinite(input.from.getTime())) ||
          (input.toExclusive && !Number.isFinite(input.toExclusive.getTime()))) {
        throw new TypeError('Conversation search request is invalid');
      }
      const terms = searchTerms(query);
      if (terms.length === 0) return { results: [], hasMore: false };

      const request = databaseReadRequest(pool)
        .input('take', sql.Int, input.limit + 1)
        .input('source', sql.NVarChar(16), input.source ?? null)
        .input('from', sql.DateTime2(7), input.from ?? null)
        .input('toExclusive', sql.DateTime2(7), input.toExclusive ?? null);
      terms.forEach((term, index) => request.input(`term${index}`, sql.NVarChar(64), term));
      if (fullTextSearchAvailable) {
        request.input('condition', sql.NVarChar(4000), terms.map((term) => `"${term}"`).join(' OR '));
      }

      const snippetPosition = terms.map((_term, index) =>
        `NULLIF(CHARINDEX(@term${index}, m.text COLLATE Latin1_General_100_CI_AI), 0)`,
      ).join(', ');
      const matching = fullTextSearchAvailable
        ? `FROM CONTAINSTABLE(dbo.messages, text, @condition) AS matches
          INNER JOIN dbo.messages AS m ON m.id = matches.[KEY]
          INNER JOIN dbo.jarvis_sessions AS s ON s.id = m.jarvis_session_id`
        : `FROM dbo.messages AS m
          INNER JOIN dbo.jarvis_sessions AS s ON s.id = m.jarvis_session_id`;
      const fallbackTerms = fullTextSearchAvailable
        ? ''
        : `AND (${terms.map((_term, index) => `m.text LIKE N'%' + @term${index} + N'%'`).join(' OR ')})`;
      const rank = fullTextSearchAvailable ? 'matches.[RANK]' : '0';
      const result = await execute(request, signal, () => request.query<{
        message_id: string;
        session_id: string;
        source: ConversationChannel;
        role: ConversationRole;
        at: Date;
        snippet: string;
      }>(`WITH candidates AS (
          SELECT TOP (@take) m.id, m.jarvis_session_id, s.channel, m.role, m.at, m.text, ${rank} AS search_rank
          ${matching}
          WHERE (@source IS NULL OR s.channel = @source)
            AND (@from IS NULL OR m.at >= @from)
            AND (@toExclusive IS NULL OR m.at < @toExclusive)
            ${fallbackTerms}
          ORDER BY search_rank DESC, m.at DESC, m.id DESC
        )
        SELECT CONVERT(varchar(20), m.id) AS message_id,
          CONVERT(varchar(20), m.jarvis_session_id) AS session_id,
          m.channel AS source, m.role, m.at,
          CASE WHEN position.match_at = 0 THEN LEFT(m.text, 240)
            ELSE SUBSTRING(m.text, CASE WHEN position.match_at > 80 THEN position.match_at - 80 ELSE 1 END, 240)
          END AS snippet
        FROM candidates AS m
        CROSS APPLY (SELECT COALESCE(${snippetPosition}, 0) AS match_at) AS position
        ORDER BY m.search_rank DESC, m.at DESC, m.id DESC;`));
      const hasMore = result.recordset.length > input.limit;
      return {
        results: result.recordset.slice(0, input.limit).map((row) => ({
          messageId: row.message_id,
          sessionId: row.session_id,
          source: row.source,
          role: row.role,
          at: row.at.toISOString(),
          snippet: row.snippet,
        })),
        hasMore,
      };
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
