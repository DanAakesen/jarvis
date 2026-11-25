import { parseRuntimeTest, validateRuntimeSessionId } from '../core/runtime-session.js';
import { createRuntimeSessionStore } from './runtime-session-store.js';
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
  ConversationAttachmentReference,
  AddProactiveMessageResult,
} from '../core/conversation-store.js';
import { InvalidConversationAttachmentsError } from '../core/conversation-store.js';
import { chatBlockLimits, isChatBlock, type ChatBlock } from '@jarvis/contracts';
import { trustedBlobHostFromEnvironment } from '../core/generated-view-validation.js';
import { normalizeVisualContext, persistedVisualContext } from '../core/visual-context.js';
import {
  safeReplyNotificationPreview,
  serializeReplyNotificationEvidence,
} from '../push/reply-notifications.js';

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
  runtime_test?: unknown;
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
  metadata?: string | null;
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
  const runtimeTest = row.runtime_test === null ? undefined : parseRuntimeTest(row.runtime_test);
  return {
    id: row.id,
    channel: row.channel,
    language: row.language,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    ...(runtimeTest === undefined ? {} : { runtimeTest }),
  };
}

function validReplyToTurnId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/u.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
}

function messageFromRow(row: MessageRow): ConversationMessage {
  let visualContext;
  let replyToTurnId: string | undefined;
  let blocks: ChatBlock[] = [];
  try {
    const metadata = row.metadata ? JSON.parse(row.metadata) as { visualContext?: unknown; blocks?: unknown; replyToTurnId?: unknown } : undefined;
    visualContext = metadata?.visualContext === undefined ? undefined : normalizeVisualContext(metadata.visualContext, true);
    if (row.role === 'jarvis' && validReplyToTurnId(metadata?.replyToTurnId)) replyToTurnId = metadata.replyToTurnId;
    if (row.role === 'jarvis' && Array.isArray(metadata?.blocks)) {
      const trustedBlobHost = trustedBlobHostFromEnvironment();
      blocks = metadata.blocks.filter((block): block is ChatBlock =>
        isChatBlock(block, trustedBlobHost ? { trustedBlobHost } : {}));
    }
  } catch { /* Ignore malformed legacy metadata. */ }
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    text: row.text,
    model: row.model,
    at: row.at,
    ...(replyToTurnId === undefined ? {} : { replyToTurnId }),
    ...(visualContext ? { metadata: { visualContext } } : {}),
    ...(blocks.length > 0 ? { blocks } : {}),
  };
}

interface HistoryAttachmentRow extends ConversationAttachmentReference {
  message_id: string;
}

async function addMessageWithAttachments(
  pool: sql.ConnectionPool,
  input: Parameters<ConversationStore['addMessage']>[0],
): Promise<ConversationMessage | null> {
  const ids = input.attachmentIds ?? [];
  if (input.role !== 'dan' || ids.length > 5 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) ||
      !input.attachmentOwnerObjectId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(input.attachmentOwnerObjectId) ||
      !Number.isInteger(input.attachmentRetentionDays) ||
      input.attachmentRetentionDays! < 1 || input.attachmentRetentionDays! > 90) {
    throw new InvalidConversationAttachmentsError();
  }
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const messageResult = await transaction.request()
      .input('sessionId', sql.BigInt, BigInt(input.sessionId))
      .input('role', sql.NVarChar(16), input.role)
      .input('text', sql.NVarChar(sql.MAX), input.text)
      .input('model', sql.NVarChar(100), input.model)
      .input('language', sql.NVarChar(8), input.language ?? null)
      .input('interrupted', sql.Bit, input.interrupted ?? false)
      .input('sourceItemId', sql.NVarChar(128), input.sourceItemId ?? null)
      .input('allowEndedSession', sql.Bit, input.allowEndedSession ?? false)
      .input('metadata', sql.NVarChar(sql.MAX), messageMetadata(input))
      .query<MessageRow>(`INSERT INTO dbo.messages
          (jarvis_session_id, role, text, model, language, interrupted, source_item_id, metadata)
        OUTPUT CONVERT(varchar(20), INSERTED.id) AS id,
          CONVERT(varchar(20), INSERTED.jarvis_session_id) AS session_id,
          INSERTED.role, INSERTED.text, INSERTED.model, INSERTED.at, INSERTED.metadata
        SELECT id, @role, @text, @model, @language, @interrupted, @sourceItemId, @metadata
        FROM dbo.jarvis_sessions
        WHERE id = @sessionId AND (ended_at IS NULL OR @allowEndedSession = 1)
          AND (@sourceItemId IS NULL OR @sourceItemId NOT LIKE N'screen:chat:%' OR NOT EXISTS (
            SELECT 1 FROM dbo.messages WITH (UPDLOCK, HOLDLOCK)
            WHERE source_item_id = @sourceItemId AND role = N'dan'
          ));`);
    const row = messageResult.recordset[0];
    if (!row) {
      await transaction.commit();
      return null;
    }
    const attachRequest = transaction.request()
      .input('messageId', sql.BigInt, BigInt(row.id))
      .input('owner', sql.UniqueIdentifier, input.attachmentOwnerObjectId)
      .input('retentionDays', sql.Int, input.attachmentRetentionDays);
    ids.forEach((id, index) => attachRequest.input(`id${index}`, sql.VarChar(36), id));
    const linked = await attachRequest.query<{ id: string }>(`UPDATE dbo.conversation_attachments WITH (UPDLOCK, HOLDLOCK)
      SET message_id = @messageId, expires_at = DATEADD(day, @retentionDays, SYSUTCDATETIME())
      OUTPUT INSERTED.id
      WHERE owner_object_id = @owner AND message_id IS NULL
        AND status IN (N'ready', N'failed') AND expires_at > SYSUTCDATETIME()
        AND id IN (${ids.map((_, index) => `@id${index}`).join(', ')});`);
    if (linked.recordset.length !== ids.length) throw new InvalidConversationAttachmentsError();
    await transaction.commit();
    return messageFromRow(row);
  } catch (error) {
    try { await transaction.rollback(); } catch { /* Preserve the original attachment error. */ }
    throw error;
  }
}

function messageMetadata(input: Parameters<ConversationStore['addMessage']>[0]): string | null {
  const { replyToTurnId } = input;
  if (replyToTurnId !== undefined && (input.role !== 'jarvis' || input.interrupted || !validReplyToTurnId(replyToTurnId))) {
    throw new TypeError('Invalid reply turn ID');
  }
  if (input.blocks !== undefined) {
    const trustedBlobHost = trustedBlobHostFromEnvironment();
    const options = trustedBlobHost ? { trustedBlobHost } : {};
    if (input.role !== 'jarvis' || input.visualContext !== undefined || input.blocks.length < 1 ||
        input.blocks.length > chatBlockLimits.blocksPerMessage || !input.blocks.every((block) => isChatBlock(block, options))) {
      throw new TypeError('Invalid message blocks');
    }
    return JSON.stringify({ blocks: input.blocks, replyToTurnId });
  }
  if (input.visualContext === undefined) return replyToTurnId === undefined ? null : JSON.stringify({ replyToTurnId });
  const visualContext = normalizeVisualContext(input.visualContext, true);
  if (input.role !== 'dan' || !visualContext) throw new TypeError('Invalid visual context');
  return JSON.stringify({ visualContext: persistedVisualContext(visualContext) });
}

async function addMessageWithReplyNotification(
  pool: sql.ConnectionPool,
  input: Parameters<ConversationStore['addMessage']>[0],
): Promise<ConversationMessage | null> {
  const delivery = input.replyNotification;
  if (!delivery ||
      input.role !== 'jarvis' ||
      input.attachmentIds?.length ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(delivery.ownerObjectId) ||
      delivery.turnMessageId !== undefined &&
      (!/^[1-9]\d{0,18}$/u.test(delivery.turnMessageId) ||
        BigInt(delivery.turnMessageId) > 9_223_372_036_854_775_807n)) {
    throw new TypeError('Invalid reply notification message');
  }
  const evidenceJson = serializeReplyNotificationEvidence(delivery.evidence);
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    if (delivery.turnMessageId !== undefined) {
      await transaction.request()
        .input('owner', sql.UniqueIdentifier, delivery.ownerObjectId)
        .input('turnMessageId', sql.BigInt, BigInt(delivery.turnMessageId))
        .query<{ lock_result: number }>(`DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) = CONCAT(
            N'jarvis.reply-notification-turn:',
            LOWER(CONVERT(nvarchar(36), @owner)),
            N':',
            CONVERT(nvarchar(20), @turnMessageId)
          );
          EXEC @lockResult = sys.sp_getapplock
            @Resource=@resource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51002, 'Reply notification turn unavailable', 1;
          SELECT @lockResult AS lock_result;`);
    }
    const request = transaction.request()
      .input('owner', sql.UniqueIdentifier, delivery.ownerObjectId)
      .input('turnMessageId', sql.BigInt,
        delivery.turnMessageId === undefined ? null : BigInt(delivery.turnMessageId))
      .input('sessionId', sql.BigInt, BigInt(input.sessionId))
      .input('role', sql.NVarChar(16), input.role)
      .input('text', sql.NVarChar(sql.MAX), input.text)
      .input('model', sql.NVarChar(100), input.model)
      .input('language', sql.NVarChar(8), input.language ?? null)
      .input('interrupted', sql.Bit, input.interrupted ?? false)
      .input('sourceItemId', sql.NVarChar(128), input.sourceItemId ?? null)
      .input('allowEndedSession', sql.Bit, input.allowEndedSession ?? false)
      .input('metadata', sql.NVarChar(sql.MAX), messageMetadata(input))
      .input('preview', sql.NVarChar(160), safeReplyNotificationPreview(input.text))
      .input('evidence', sql.NVarChar(sql.MAX), evidenceJson);
    const write = () => request.query<MessageRow>(`DECLARE @inserted TABLE (
        id bigint NOT NULL, session_id bigint NOT NULL, role nvarchar(16), text nvarchar(max),
        model nvarchar(100), at datetime2(7), metadata nvarchar(max)
      );
      INSERT INTO dbo.messages
        (jarvis_session_id, role, text, model, language, interrupted, source_item_id, metadata)
      OUTPUT CONVERT(bigint, INSERTED.id), CONVERT(bigint, INSERTED.jarvis_session_id),
        INSERTED.role, INSERTED.text, INSERTED.model, INSERTED.at, INSERTED.metadata
      INTO @inserted (id, session_id, role, text, model, at, metadata)
      SELECT id, @role, @text, @model, @language, @interrupted, @sourceItemId, @metadata
      FROM dbo.jarvis_sessions
      WHERE id = @sessionId AND (ended_at IS NULL OR @allowEndedSession = 1);
      DECLARE @messageId bigint = (SELECT TOP (1) id FROM @inserted);
      IF @messageId IS NOT NULL
      BEGIN
        INSERT dbo.reply_notification_deliveries (
          id, owner_object_id, jarvis_session_id, message_id, turn_message_id,
          registration_id, device_reference, notification_id, preview, state, last_result,
          next_attempt_at, expires_at, completed_at, evidence_json
        )
        SELECT NEWID(), @owner, @sessionId, @messageId, @turnMessageId,
          r.registration_id, CONVERT(char(36), r.registration_id),
          CONCAT(N'reply-', CONVERT(nvarchar(20), @messageId)),
          @preview,
          CASE WHEN a.state = N'accepted' THEN N'suppressed' ELSE N'pending' END,
          CASE WHEN a.state = N'accepted' THEN N'approval_delivered' ELSE NULL END,
          SYSUTCDATETIME(), DATEADD(hour, 1, SYSUTCDATETIME()),
          CASE WHEN a.state = N'accepted' THEN SYSUTCDATETIME() ELSE NULL END,
          @evidence
        FROM dbo.approval_notification_registrations r
        OUTER APPLY (
          SELECT TOP (1) a.state
          FROM dbo.reply_notification_approval_claims c
          INNER JOIN dbo.reply_notification_approval_deliveries a
            ON a.confirmation_id = c.confirmation_id
            AND a.device_reference = CONVERT(char(36), r.registration_id)
          WHERE c.owner_object_id = @owner AND c.turn_message_id = @turnMessageId
            AND a.state = N'accepted'
          ORDER BY c.created_at DESC
        ) a
        WHERE r.owner_object_id = @owner AND r.expires_at > SYSUTCDATETIME()
          AND NOT EXISTS (
            SELECT 1 FROM dbo.approval_notification_token_tombstones tombstone
            WHERE tombstone.owner_object_id = r.owner_object_id
              AND tombstone.device_token_hash = CONVERT(
                char(64),
                HASHBYTES(N'SHA2_256', CONVERT(varbinary(512), LOWER(r.device_token))),
                2
              )
          );
      END;
      SELECT CONVERT(varchar(20), id) AS id, CONVERT(varchar(20), session_id) AS session_id,
        role, text, model, at, metadata
      FROM @inserted;`);
    const result = input.signal ? await execute(request, input.signal, write) : await write();
    const row = result.recordset[0];
    await transaction.commit();
    return row ? messageFromRow(row) : null;
  } catch (error) {
    try { await transaction.rollback(); } catch { /* Preserve the original delivery error. */ }
    throw error;
  }
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
      const runtimeTest = parseRuntimeTest(input.runtimeTest);
      if (runtimeTest !== undefined) {
        if (input.channel !== 'chat' || !input.ownerObjectId) throw new TypeError('Runtime test requires an authenticated chat owner');
        const created = await createRuntimeSessionStore(pool).createSession({ ownerObjectId: input.ownerObjectId,
          language: input.language, runtimeTest });
        return { ...created.session, runtimeTest: created.runtimeTest };
      }
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
        .query<SessionIdRow>(`SELECT CONVERT(varchar(20), s.id) AS id, s.channel, s.language,
          s.started_at, s.ended_at, r.runtime_test
          FROM dbo.jarvis_sessions s LEFT JOIN dbo.session_runtime_tests r ON r.jarvis_session_id = s.id
          WHERE s.id = @sessionId;`);
      const row = result.recordset[0];
      return row ? sessionFromRow(row) : null;
    },

    async endSession(sessionId, voiceUsage) {
      if (voiceUsage?.providerVoiceSeconds !== undefined && (!Number.isFinite(voiceUsage.providerVoiceSeconds) ||
          voiceUsage.providerVoiceSeconds < 0 || voiceUsage.providerVoiceSeconds > 24 * 60 * 60)) {
        throw new RangeError('Provider voice usage is invalid');
      }
      const result = await pool.request()
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .input(
          'providerVoiceMinutes',
          sql.Decimal(19, 6),
          voiceUsage?.providerVoiceSeconds === undefined ? null : voiceUsage.providerVoiceSeconds / 60,
        )
        .input('allowWallClockFallback', sql.Bit, voiceUsage?.allowWallClockFallback ?? false)
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
              COALESCE(@providerVoiceMinutes,
                CONVERT(decimal(19,6), DATEDIFF_BIG(MILLISECOND, started_at, ended_at)) / 60000.0),
              CONVERT(nvarchar(300), id), ended_at
            FROM @ended
            WHERE channel = N'voice'
              AND (@providerVoiceMinutes IS NOT NULL OR @allowWallClockFallback = 1);

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

    async saveVoiceWindow(turnId, sourceItemId, block) {
      if (!validReplyToTurnId(turnId)) return false;
      const trustedBlobHost = trustedBlobHostFromEnvironment();
      if (!isChatBlock(block, trustedBlobHost ? { trustedBlobHost } : {})) throw new TypeError('Invalid voice window');
      const result = await pool.request()
        .input('turnId', sql.BigInt, BigInt(turnId))
        .input('sourceItemId', sql.NVarChar(128), sourceItemId)
        .input('title', sql.NVarChar(200), block.title)
        .input('metadata', sql.NVarChar(sql.MAX), JSON.stringify({ blocks: [block], replyToTurnId: turnId }))
        .query<{ id: string }>(`MERGE dbo.messages WITH (HOLDLOCK) AS target
          USING (SELECT s.id, s.language FROM dbo.jarvis_sessions s JOIN dbo.messages m ON m.jarvis_session_id = s.id
                 WHERE m.id = @turnId AND m.role = N'dan' AND s.channel = N'voice') AS source
          ON target.jarvis_session_id = source.id AND target.source_item_id = @sourceItemId AND target.role = N'jarvis'
          WHEN MATCHED THEN UPDATE SET text = @title,
            metadata = JSON_MODIFY(@metadata, '$.blocks[0].id', JSON_VALUE(target.metadata, '$.blocks[0].id'))
          WHEN NOT MATCHED THEN INSERT (jarvis_session_id, role, text, language, interrupted, source_item_id, metadata)
            VALUES (source.id, N'jarvis', @title, source.language, 0, @sourceItemId, @metadata)
          OUTPUT CONVERT(varchar(20), inserted.id) AS id;`);
      return result.recordset.length === 1;
    },

    async addMessage(input) {
      if (input.attachmentIds?.length) return addMessageWithAttachments(pool, input);
      if (input.replyNotification) return addMessageWithReplyNotification(pool, input);
      const request = pool.request()
        .input('sessionId', sql.BigInt, BigInt(input.sessionId))
        .input('role', sql.NVarChar(16), input.role)
        .input('text', sql.NVarChar(sql.MAX), input.text)
        .input('model', sql.NVarChar(100), input.model)
        .input('language', sql.NVarChar(8), input.language ?? null)
        .input('interrupted', sql.Bit, input.interrupted ?? false)
        .input('sourceItemId', sql.NVarChar(128), input.sourceItemId ?? null)
        .input('allowEndedSession', sql.Bit, input.allowEndedSession ?? false)
        .input('metadata', sql.NVarChar(sql.MAX), messageMetadata(input));
      const write = () => request.query<MessageRow>(`INSERT INTO dbo.messages
            (jarvis_session_id, role, text, model, language, interrupted, source_item_id, metadata)
          OUTPUT CONVERT(varchar(20), INSERTED.id) AS id,
            CONVERT(varchar(20), INSERTED.jarvis_session_id) AS session_id,
            INSERTED.role, INSERTED.text, INSERTED.model, INSERTED.at, INSERTED.metadata
          SELECT id, @role, @text, @model, @language, @interrupted, @sourceItemId, @metadata
          FROM dbo.jarvis_sessions
          WHERE id = @sessionId AND (ended_at IS NULL OR @allowEndedSession = 1)
            AND (@sourceItemId IS NULL OR @sourceItemId NOT LIKE N'screen:chat:%' OR NOT EXISTS (
              SELECT 1 FROM dbo.messages WITH (UPDLOCK, HOLDLOCK)
              WHERE source_item_id = @sourceItemId AND role = N'dan'
            ));`);
      const result = input.signal ? await execute(request, input.signal, write) : await write();
      const row = result.recordset[0];
      return row ? messageFromRow(row) : null;
    },

    async addProactiveMessage(input): Promise<AddProactiveMessageResult> {
      input.signal?.throwIfAborted();
      const delivery = input.replyNotification;
      if (delivery &&
          (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(delivery.ownerObjectId) ||
            delivery.ownerObjectId.toLowerCase() !== input.ownerObjectId.toLowerCase() ||
            delivery.turnMessageId !== undefined &&
              (!/^[1-9]\d{0,18}$/u.test(delivery.turnMessageId) ||
                BigInt(delivery.turnMessageId) > 9_223_372_036_854_775_807n))) {
        throw new TypeError('Invalid proactive reply notification');
      }
      const transaction = new sql.Transaction(pool);
      let activeRequest: sql.Request | undefined;
      const cancel = () => activeRequest?.cancel();
      input.signal?.addEventListener('abort', cancel, { once: true });
      try {
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, input.ownerObjectId)
          .input('run', sql.Char(36), input.runId)
          .input('hash', sql.Char(64), input.textHash)
          .input('dayStart', sql.DateTime2, input.dayStart)
          .input('sessionId', sql.BigInt, BigInt(input.sessionId));
        const existing = await activeRequest.query<MessageRow>(`DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) =
            CONCAT(N'jarvis.pi.message:', LOWER(CONVERT(nvarchar(36), @owner)));
          EXEC @lockResult = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive',
            @LockOwner = 'Transaction', @LockTimeout = 10000;
          IF @lockResult < 0 THROW 51001, 'Could not acquire PI message admission lock', 1;
          SELECT CONVERT(varchar(20), receipt.message_id) AS id,
            CONVERT(varchar(20), receipt.session_id) AS session_id,
            message.role, message.text, message.model, message.at, message.metadata
          FROM dbo.pi_message AS receipt
          INNER JOIN dbo.messages AS message ON message.id = receipt.message_id
          WHERE receipt.owner_object_id = @owner
            AND receipt.run_id = @run AND receipt.text_hash = @hash;

          SELECT COUNT(*) AS sent_today,
            MAX(CASE WHEN text_hash = @hash THEN 1 ELSE 0 END) AS duplicate_today
          FROM dbo.pi_message
          WHERE owner_object_id = @owner AND at >= @dayStart;

          SELECT CONVERT(bit, CASE WHEN EXISTS (
            SELECT 1 FROM dbo.jarvis_sessions
            WHERE id = @sessionId
          ) THEN 1 ELSE 0 END) AS session_exists;`);
        const existingRecord = existing.recordsets[0] as MessageRow[] | undefined;
        if (existingRecord?.[0]) {
          input.signal?.throwIfAborted();
          await transaction.commit();
          return { status: 'existing', message: messageFromRow(existingRecord[0]) };
        }
        const counts = (existing.recordsets[1] as Array<{
          sent_today: number;
          duplicate_today: number | null;
        }> | undefined)?.[0];
        const session = (existing.recordsets[2] as Array<{ session_exists: boolean }> | undefined)?.[0];
        if (!session?.session_exists) {
          input.signal?.throwIfAborted();
          await transaction.commit();
          return { status: 'session_missing', message: null };
        }
        if ((counts?.duplicate_today ?? 0) === 1) {
          input.signal?.throwIfAborted();
          await transaction.commit();
          return { status: 'duplicate', message: null };
        }
        if (Number(counts?.sent_today ?? 0) >= input.maxMessages) {
          input.signal?.throwIfAborted();
          await transaction.commit();
          return { status: 'daily_limit', message: null };
        }
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, input.ownerObjectId)
          .input('evidence', sql.NVarChar(sql.MAX), JSON.stringify(input.evidence));
        await activeRequest.query(`IF EXISTS (
            SELECT 1
            FROM OPENJSON(@evidence) AS evidence
            WHERE JSON_VALUE(evidence.value, '$.origin') = N'situation'
              AND NOT EXISTS (
                SELECT 1
                FROM dbo.pi_situational_state AS state WITH (UPDLOCK, HOLDLOCK)
                CROSS APPLY OPENJSON(state.state_json, '$.sources') AS source
                CROSS APPLY OPENJSON(state.state_json, '$.refs') AS ref
                INNER JOIN dbo.pi_situation_ref_authority AS authority
                  WITH (UPDLOCK, HOLDLOCK)
                  ON authority.owner_object_id = state.owner_object_id
                  AND authority.source_id =
                    JSON_VALUE(evidence.value, '$.source') COLLATE Latin1_General_100_BIN2
                  AND authority.ref_id =
                    JSON_VALUE(evidence.value, '$.ref') COLLATE Latin1_General_100_BIN2
                INNER JOIN dbo.proactive_source_status AS status WITH (UPDLOCK, HOLDLOCK)
                  ON status.owner_object_id = state.owner_object_id
                  AND status.source_id = JSON_VALUE(evidence.value, '$.source')
                WHERE state.owner_object_id = @owner
                  AND JSON_VALUE(source.value, '$.id') = JSON_VALUE(evidence.value, '$.source')
                  AND JSON_VALUE(source.value, '$.state') = N'fresh'
                  AND TRY_CONVERT(datetime2(7), JSON_VALUE(source.value, '$.verifiedAt')) =
                    TRY_CONVERT(datetime2(7), JSON_VALUE(evidence.value, '$.verifiedAt'))
                  AND JSON_VALUE(ref.value, '$.source') = JSON_VALUE(evidence.value, '$.source')
                  AND JSON_VALUE(ref.value, '$.id') = JSON_VALUE(evidence.value, '$.ref')
                  AND JSON_VALUE(ref.value, '$.identity') = JSON_VALUE(evidence.value, '$.identity')
                  AND JSON_VALUE(ref.value, '$.observedAt') = JSON_VALUE(evidence.value, '$.observedAt')
                  AND TRY_CONVERT(datetime2(7), JSON_VALUE(ref.value, '$.verifiedAt')) =
                    TRY_CONVERT(datetime2(7), JSON_VALUE(evidence.value, '$.verifiedAt'))
                  AND JSON_VALUE(ref.value, '$.materialHash') =
                    JSON_VALUE(evidence.value, '$.materialHash')
                  AND authority.activated_at IS NOT NULL
                  AND authority.invalidated_at IS NULL
                  AND authority.provider_identity = JSON_VALUE(evidence.value, '$.identity')
                  AND authority.material_hash =
                    JSON_VALUE(evidence.value, '$.materialHash') COLLATE Latin1_General_100_BIN2
                  AND authority.verified_at =
                    TRY_CONVERT(datetime2(7), JSON_VALUE(evidence.value, '$.verifiedAt'))
                  AND status.state = N'ok'
                  AND status.verified_at =
                    TRY_CONVERT(datetime2(7), JSON_VALUE(evidence.value, '$.verifiedAt'))
                  AND (status.invalidated_at IS NULL
                    OR status.verified_at > status.invalidated_at)
              )
          ) THROW 51002, 'Proactive situation evidence generation changed before delivery', 1;`);
        activeRequest = new sql.Request(transaction)
          .input('sessionId', sql.BigInt, BigInt(input.sessionId))
          .input('text', sql.NVarChar(sql.MAX), input.text)
          .input('model', sql.NVarChar(100), input.model)
          .input('language', sql.NVarChar(8), input.language)
          .input('at', sql.DateTime2, input.at);
        const inserted = await activeRequest.query<MessageRow>(`INSERT INTO dbo.messages
            (jarvis_session_id, role, text, model, language, interrupted, at)
          OUTPUT CONVERT(varchar(20), INSERTED.id) AS id,
            CONVERT(varchar(20), INSERTED.jarvis_session_id) AS session_id,
            INSERTED.role, INSERTED.text, INSERTED.model, INSERTED.at, INSERTED.metadata
          SELECT @sessionId, N'jarvis', @text, @model, @language, 0, @at
          FROM dbo.jarvis_sessions
          WHERE id = @sessionId;`);
        const message = inserted.recordset[0];
        if (!message) {
          await transaction.commit();
          return { status: 'session_missing', message: null };
        }
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, input.ownerObjectId)
          .input('at', sql.DateTime2, input.at)
          .input('run', sql.Char(36), input.runId)
          .input('session', sql.BigInt, BigInt(input.sessionId))
          .input('message', sql.BigInt, BigInt(message.id))
          .input('hash', sql.Char(64), input.textHash)
          .input('text', sql.NVarChar(1500), input.text)
          .input('evidence', sql.NVarChar(sql.MAX), JSON.stringify(input.evidence))
          .input('followUps', sql.NVarChar(sql.MAX), JSON.stringify(input.followUpIds));
        await activeRequest.query(`INSERT dbo.pi_message (
            at, run_id, session_id, message_id, text_hash,
            owner_object_id, message_text, evidence_json, follow_up_ids_json
          ) VALUES (
            @at, @run, @session, @message, @hash,
            @owner, @text, @evidence, @followUps
          );`);
        if (delivery) {
          if (delivery.turnMessageId !== undefined) {
            activeRequest = new sql.Request(transaction)
              .input('owner', sql.UniqueIdentifier, delivery.ownerObjectId)
              .input('turnMessageId', sql.BigInt, BigInt(delivery.turnMessageId));
            await activeRequest.query(`DECLARE @lockResult int;
              DECLARE @resource nvarchar(255) = CONCAT(
                N'jarvis.reply-notification-turn:',
                LOWER(CONVERT(nvarchar(36), @owner)),
                N':',
                CONVERT(nvarchar(20), @turnMessageId)
              );
              EXEC @lockResult = sys.sp_getapplock
                @Resource=@resource, @LockMode='Exclusive',
                @LockOwner='Transaction', @LockTimeout=5000;
              IF @lockResult < 0 THROW 51002, 'Reply notification turn unavailable', 1;`);
          }
          activeRequest = new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, delivery.ownerObjectId)
            .input('turnMessageId', sql.BigInt,
              delivery.turnMessageId === undefined ? null : BigInt(delivery.turnMessageId))
            .input('session', sql.BigInt, BigInt(input.sessionId))
            .input('message', sql.BigInt, BigInt(message.id))
            .input('preview', sql.NVarChar(160), safeReplyNotificationPreview(input.text))
            .input('evidence', sql.NVarChar(sql.MAX),
              serializeReplyNotificationEvidence(delivery.evidence));
          await activeRequest.query(`INSERT dbo.reply_notification_deliveries (
              id, owner_object_id, jarvis_session_id, message_id, turn_message_id,
              registration_id, device_reference, notification_id, preview, state, last_result,
              next_attempt_at, expires_at, completed_at, evidence_json
            )
            SELECT NEWID(), @owner, @session, @message, @turnMessageId,
              r.registration_id, CONVERT(char(36), r.registration_id),
              CONCAT(N'reply-', CONVERT(nvarchar(20), @message)),
              @preview,
              CASE WHEN a.state = N'accepted' THEN N'suppressed' ELSE N'pending' END,
              CASE WHEN a.state = N'accepted' THEN N'approval_delivered' ELSE NULL END,
              SYSUTCDATETIME(), DATEADD(hour, 1, SYSUTCDATETIME()),
              CASE WHEN a.state = N'accepted' THEN SYSUTCDATETIME() ELSE NULL END,
              @evidence
            FROM dbo.approval_notification_registrations r
            OUTER APPLY (
              SELECT TOP (1) a.state
              FROM dbo.reply_notification_approval_claims c
              INNER JOIN dbo.reply_notification_approval_deliveries a
                ON a.confirmation_id = c.confirmation_id
                AND a.device_reference = CONVERT(char(36), r.registration_id)
              WHERE c.owner_object_id = @owner AND c.turn_message_id = @turnMessageId
                AND a.state = N'accepted'
              ORDER BY c.created_at DESC
            ) a
            WHERE r.owner_object_id = @owner AND r.expires_at > SYSUTCDATETIME()
              AND NOT EXISTS (
                SELECT 1 FROM dbo.approval_notification_token_tombstones tombstone
                WHERE tombstone.owner_object_id = r.owner_object_id
                  AND tombstone.device_token_hash = CONVERT(
                    char(64),
                    HASHBYTES(N'SHA2_256', CONVERT(varbinary(512), LOWER(r.device_token))),
                    2
                  )
              );`);
        }
        input.signal?.throwIfAborted();
        await transaction.commit();
        return { status: 'stored', message: messageFromRow(message) };
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve the message write failure. */ }
        throw error;
      } finally {
        input.signal?.removeEventListener('abort', cancel);
      }
    },

    async setVisualContext({ sessionId, messageId, visualContext }) {
      const metadata = messageMetadata({ sessionId, role: 'dan', text: '', model: null, visualContext });
      const result = await pool.request()
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .input('messageId', sql.BigInt, BigInt(messageId))
        .input('metadata', sql.NVarChar(sql.MAX), metadata)
        .query(`UPDATE dbo.messages SET metadata = @metadata
          WHERE id = @messageId AND jarvis_session_id = @sessionId AND role = N'dan';`);
      return result.rowsAffected[0] === 1;
    },

    async updateMessage({ messageId, sessionId, role, text }) {
      const result = await pool.request()
        .input('messageId', sql.BigInt, BigInt(messageId))
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .input('role', sql.NVarChar(16), role)
        .input('text', sql.NVarChar(sql.MAX), text)
        .query<MessageRow>(`UPDATE dbo.messages
          SET text = @text
          OUTPUT CONVERT(varchar(20), INSERTED.id) AS id,
            CONVERT(varchar(20), INSERTED.jarvis_session_id) AS session_id,
            INSERTED.role, INSERTED.text, INSERTED.model, INSERTED.at, INSERTED.metadata
          WHERE id = @messageId AND jarvis_session_id = @sessionId AND role = @role;`);
      const row = result.recordset[0];
      return row ? messageFromRow(row) : null;
    },

    async getDanMessageIdBySourceItemId(sourceItemId) {
      const result = await databaseReadRequest(pool)
        .input('sourceItemId', sql.NVarChar(128), sourceItemId)
        .query<{ id: string }>(`SELECT TOP (1) CONVERT(varchar(20), m.id) AS id
          FROM dbo.messages AS m
          WHERE m.source_item_id = @sourceItemId AND m.role = N'dan'
          ORDER BY m.id DESC;`);
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

    async readDanMessagesSince(since, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new RangeError('Message limit must be an integer from 1 to 100');
      }
      const result = await databaseReadRequest(pool)
        .input('limit', sql.Int, limit)
        .input('since', sql.DateTime2(7), since)
        .query<{ id: string; text: string; at: Date }>(`SELECT TOP (@limit) CONVERT(varchar(20), m.id) AS id, m.text, m.at
          FROM dbo.messages AS m
          INNER JOIN dbo.jarvis_sessions AS s ON s.id = m.jarvis_session_id
          WHERE m.role = N'dan' AND m.at >= @since AND NOT EXISTS (SELECT 1 FROM dbo.session_runtime_tests r WHERE r.jarvis_session_id = s.id) ORDER BY m.id ASC;`);
      return result.recordset.map((row) => ({ id: row.id, text: row.text, at: row.at }));
    },

    async readRecentUserMessages(limit = 5) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new RangeError('Recent user message limit must be an integer from 1 to 20');
      }
      const result = await databaseReadRequest(pool)
        .input('limit', sql.Int, limit)
        .query<{ text: string }>(`SELECT TOP (@limit) m.text FROM dbo.messages AS m
          INNER JOIN dbo.jarvis_sessions AS s ON s.id = m.jarvis_session_id
          WHERE m.role = N'dan' AND s.channel = N'chat' ORDER BY m.id DESC;`);
      return result.recordset.map((row) => row.text);
    },

    async getHistory({ limit, before, sessionId, excludeRuntimeTests = false }) {
      if (sessionId !== undefined) validateRuntimeSessionId(sessionId);
      const result = await databaseReadRequest(pool)
        .input('take', sql.Int, limit + 1)
        .input('beforeId', sql.BigInt, before === undefined ? null : BigInt(before))
        .input('sessionId', sql.BigInt, sessionId === undefined ? null : BigInt(sessionId))
        .input('excludeRuntimeTests', sql.Bit, excludeRuntimeTests)
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
            metadata nvarchar(max) NULL,
            at datetime2(7) NOT NULL
          );
          INSERT INTO @history (id, session_id, channel, language, role, text, model, interrupted, voice_minutes, metadata, at)
          SELECT TOP (@take) m.id, m.jarvis_session_id, s.channel, COALESCE(m.language, s.language) AS language,
            m.role, m.text, m.model, m.interrupted,
            voice_usage.voice_minutes, m.metadata, m.at
          FROM dbo.messages AS m
          INNER JOIN dbo.jarvis_sessions AS s ON s.id = m.jarvis_session_id
          OUTER APPLY (
            SELECT SUM(u.quantity) AS voice_minutes
            FROM dbo.usage AS u
            WHERE u.jarvis_session_id = s.id AND u.source = N'voice' AND u.metric = N'minutes'
          ) AS voice_usage
          WHERE (@beforeId IS NULL OR m.id < @beforeId)
            AND ((@sessionId IS NOT NULL AND s.id = @sessionId) OR
              (@sessionId IS NULL AND (@excludeRuntimeTests = 0 OR NOT EXISTS (
                SELECT 1 FROM dbo.session_runtime_tests r WHERE r.jarvis_session_id = s.id))))
          ORDER BY m.id DESC;

          SELECT CONVERT(varchar(20), h.id) AS id,
            CONVERT(varchar(20), session_id) AS session_id, channel, language, role, text, model,
            interrupted, voice_minutes, metadata, at
          FROM @history AS h
          ORDER BY h.id;

          SELECT CONVERT(varchar(20), tc.id) AS id,
            CONVERT(varchar(20), tc.message_id) AS message_id, tc.tool, tc.outcome,
            CONVERT(varchar(20), tc.task_id) AS task_id,
            CASE WHEN tc.tool = N'image_generation' AND tc.outcome = N'ok'
              THEN TRY_CONVERT(varchar(36), TRY_CONVERT(uniqueidentifier, JSON_VALUE(tc.result, '$.artifactId')))
              ELSE NULL END AS artifact_id
          FROM dbo.tool_calls AS tc
          INNER JOIN @history AS h ON h.id = tc.message_id
          ORDER BY tc.message_id, tc.id;

          SELECT CONVERT(varchar(20), ca.message_id) AS message_id,
            ca.id, ca.file_name AS name, ca.content_type AS contentType, ca.size_bytes AS size
          FROM dbo.conversation_attachments AS ca
          INNER JOIN @history AS h ON h.id = ca.message_id
          ORDER BY ca.message_id, ca.created_at, ca.id;`);
      const messageRows = (result.recordsets[0] ?? []) as HistoryRow[];
      const toolCallRows = (result.recordsets[1] ?? []) as ToolCallRow[];
      const attachmentRows = (result.recordsets[2] ?? []) as HistoryAttachmentRow[];
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
        attachments: attachmentRows.filter((attachment) => attachment.message_id === row.id)
          .map(({ id, name, contentType, size }) => ({ id, name, contentType, size })),
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
