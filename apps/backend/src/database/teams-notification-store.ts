import sql from 'mssql';
import type { ConversationReference } from '@microsoft/teams.api';

export type ConfirmationDecision = 'approve' | 'reject';
export type ConfirmationStatus = 'approved' | 'rejected' | 'expired' | 'cancelled' | 'executing';

export interface TeamsNotificationStore {
  getConversation(ownerObjectId: string): Promise<ConversationReference | null>;
  saveConversation(ownerObjectId: string, reference: ConversationReference): Promise<void>;
  createConfirmation(
    id: string,
    ownerObjectId: string,
    conversationId: string,
    actionKind: string,
    lifetimeSeconds: number,
  ): Promise<void>;
  resolveConfirmation(
    id: string,
    ownerObjectId: string,
    conversationId: string,
    decision: ConfirmationDecision,
  ): Promise<ConfirmationStatus | null>;
  expirePendingConfirmations(): Promise<void>;
  cancelConfirmation(id: string, ownerObjectId: string): Promise<void>;
  consumeApproval(id: string, ownerObjectId: string): Promise<boolean>;
}

const safeServiceHosts = ['trafficmanager.net', 'teams.microsoft.com', 'botframework.com'];

function safeReference(value: unknown): ConversationReference | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const reference = value as Record<string, unknown>;
  const conversation = reference.conversation as Record<string, unknown> | undefined;
  const user = reference.user as Record<string, unknown> | undefined;
  const bot = reference.bot as Record<string, unknown> | undefined;
  const serviceUrl = reference.serviceUrl;
  if (reference.channelId !== 'msteams' || typeof serviceUrl !== 'string' ||
    typeof conversation?.id !== 'string' || !conversation.id || conversation.id.length > 512 ||
    conversation.conversationType !== 'personal' ||
    typeof user?.id !== 'string' || !user.id || user.id.length > 256 ||
    typeof user.aadObjectId !== 'string' || !/^[\da-f-]{36}$/iu.test(user.aadObjectId) ||
    typeof user.tenantId !== 'string' || !/^[\da-f-]{36}$/iu.test(user.tenantId) ||
    typeof bot?.id !== 'string' || !bot.id || bot.id.length > 256) return null;
  let url: URL;
  try { url = new URL(serviceUrl); }
  catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash ||
    !safeServiceHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
  return {
    channelId: 'msteams',
    serviceUrl: url.origin + url.pathname.replace(/\/+$/u, ''),
    conversation: {
      id: conversation.id,
      conversationType: 'personal',
      tenantId: user.tenantId,
    },
    user: {
      id: user.id,
      aadObjectId: user.aadObjectId,
      tenantId: user.tenantId,
      role: 'user',
    },
    bot: { id: bot.id, role: 'bot' },
  } as ConversationReference;
}

export function createTeamsNotificationStore(pool: sql.ConnectionPool): TeamsNotificationStore {
  return {
    async getConversation(ownerObjectId) {
      const { recordset } = await pool.request()
        .input('ownerObjectId', sql.Char(36), ownerObjectId)
        .query<{ reference_json: string }>(
          'SELECT reference_json FROM dbo.teams_conversations WHERE owner_object_id = @ownerObjectId;',
        );
      const row = recordset[0];
      if (!row) return null;
      let reference: unknown;
      try { reference = JSON.parse(row.reference_json) as unknown; }
      catch { return null; }
      const safe = safeReference(reference);
      return safe?.user?.aadObjectId?.toLowerCase() === ownerObjectId.toLowerCase() ? safe : null;
    },
    async saveConversation(ownerObjectId, reference) {
      const safe = safeReference(reference);
      if (!safe || safe.user?.aadObjectId?.toLowerCase() !== ownerObjectId.toLowerCase()) {
        throw new TypeError('Invalid Teams conversation reference');
      }
      const referenceJson = JSON.stringify(safe);
      if (referenceJson.length > 4000) throw new TypeError('Invalid Teams conversation reference');
      await pool.request()
        .input('ownerObjectId', sql.Char(36), ownerObjectId)
        .input('conversationId', sql.NVarChar(512), safe.conversation.id)
        .input('referenceJson', sql.NVarChar(4000), referenceJson)
        .query(`MERGE dbo.teams_conversations WITH (HOLDLOCK) AS target
          USING (SELECT @ownerObjectId AS owner_object_id) AS source
          ON target.owner_object_id = source.owner_object_id
          WHEN MATCHED THEN UPDATE SET conversation_id = @conversationId,
            reference_json = @referenceJson, updated_at = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT (owner_object_id, conversation_id, reference_json)
            VALUES (@ownerObjectId, @conversationId, @referenceJson);`);
    },
    async createConfirmation(id, ownerObjectId, conversationId, actionKind, lifetimeSeconds) {
      await pool.request()
        .input('confirmationId', sql.Char(43), id)
        .input('ownerObjectId', sql.Char(36), ownerObjectId)
        .input('conversationId', sql.NVarChar(512), conversationId)
        .input('actionKind', sql.VarChar(32), actionKind)
        .input('lifetimeSeconds', sql.Int, lifetimeSeconds)
        .query(`UPDATE dbo.teams_confirmations SET status = 'expired', resolved_at = SYSUTCDATETIME()
          WHERE status = 'pending' AND expires_at <= SYSUTCDATETIME();
          DELETE FROM dbo.teams_confirmations
          WHERE expires_at < DATEADD(day, -1, SYSUTCDATETIME()) AND status <> 'executing';
          INSERT INTO dbo.teams_confirmations
            (confirmation_id, owner_object_id, conversation_id, action_kind, status, expires_at)
          VALUES
            (@confirmationId, @ownerObjectId, @conversationId, @actionKind, 'pending',
              DATEADD(second, @lifetimeSeconds, SYSUTCDATETIME()));`);
    },
    async resolveConfirmation(id, ownerObjectId, conversationId, decision) {
      const { recordset } = await pool.request()
        .input('confirmationId', sql.Char(43), id)
        .input('ownerObjectId', sql.Char(36), ownerObjectId)
        .input('conversationId', sql.NVarChar(512), conversationId)
        .input('decision', sql.VarChar(16), decision === 'approve' ? 'approved' : 'rejected')
        .query<{ status: ConfirmationStatus }>(`UPDATE dbo.teams_confirmations
          SET status = CASE WHEN expires_at <= SYSUTCDATETIME() THEN 'expired' ELSE @decision END,
            resolved_at = SYSUTCDATETIME()
          OUTPUT INSERTED.status
          WHERE confirmation_id = @confirmationId AND owner_object_id = @ownerObjectId
            AND conversation_id = @conversationId AND status = 'pending';`);
      return recordset[0]?.status ?? null;
    },
    async expirePendingConfirmations() {
      await pool.request().query(`UPDATE dbo.teams_confirmations SET status = 'expired', resolved_at = SYSUTCDATETIME()
        WHERE status = 'pending' AND expires_at <= SYSUTCDATETIME();`);
    },
    async cancelConfirmation(id, ownerObjectId) {
      await pool.request()
        .input('confirmationId', sql.Char(43), id)
        .input('ownerObjectId', sql.Char(36), ownerObjectId)
        .query(`UPDATE dbo.teams_confirmations
          SET status = 'cancelled', resolved_at = SYSUTCDATETIME()
          WHERE confirmation_id = @confirmationId AND owner_object_id = @ownerObjectId AND status = 'pending';`);
    },
    async consumeApproval(id, ownerObjectId) {
      const { recordset } = await pool.request()
        .input('confirmationId', sql.Char(43), id)
        .input('ownerObjectId', sql.Char(36), ownerObjectId)
        .query(`UPDATE dbo.teams_confirmations
          SET status = CASE WHEN expires_at > SYSUTCDATETIME() THEN 'executing' ELSE 'expired' END,
            resolved_at = SYSUTCDATETIME()
          OUTPUT INSERTED.status
          WHERE confirmation_id = @confirmationId AND owner_object_id = @ownerObjectId AND status = 'approved';`);
      return recordset[0]?.status === 'executing';
    },
  };
}
