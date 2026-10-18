import sql from 'mssql';

export type ConfirmationDecision = 'approve' | 'reject';
export type ConfirmationStatus = 'approved' | 'rejected' | 'expired' | 'cancelled' | 'executing';

export interface ConfirmationStore {
  createConfirmation(
    id: string,
    ownerObjectId: string,
    conversationId: string,
    actionKind: string,
    lifetimeSeconds: number,
    phoneSessionId?: string | null,
  ): Promise<void>;
  resolveConfirmation(
    id: string,
    ownerObjectId: string,
    conversationId: string,
    decision: ConfirmationDecision,
  ): Promise<ConfirmationStatus | null>;
  expireConfirmation(id: string, ownerObjectId: string): Promise<boolean>;
  expirePendingConfirmations(): Promise<void>;
  cancelConfirmation(id: string, ownerObjectId: string): Promise<void>;
  consumeApproval(id: string, ownerObjectId: string): Promise<boolean>;
}

export function createConfirmationStore(pool: sql.ConnectionPool): ConfirmationStore {
  return {
    async createConfirmation(id, ownerObjectId, conversationId, actionKind, lifetimeSeconds, phoneSessionId = null) {
      if (phoneSessionId !== null &&
          (!/^[1-9]\d{0,18}$/u.test(phoneSessionId) || BigInt(phoneSessionId) > 9_223_372_036_854_775_807n)) {
        throw new TypeError('Invalid phone session');
      }
      await pool.request()
        .input('confirmationId', sql.Char(43), id)
        .input('ownerObjectId', sql.Char(36), ownerObjectId)
        .input('conversationId', sql.NVarChar(512), conversationId)
        .input('actionKind', sql.VarChar(32), actionKind)
        .input('lifetimeSeconds', sql.Int, lifetimeSeconds)
        .input('phoneSessionId', sql.BigInt, phoneSessionId === null ? null : BigInt(phoneSessionId))
        .query(`UPDATE dbo.teams_confirmations SET status = 'expired', resolved_at = SYSUTCDATETIME()
          WHERE status = 'pending' AND expires_at <= SYSUTCDATETIME();
          DELETE FROM dbo.teams_confirmations
          WHERE expires_at < DATEADD(day, -1, SYSUTCDATETIME()) AND status <> 'executing';
          INSERT INTO dbo.teams_confirmations
            (confirmation_id, owner_object_id, conversation_id, action_kind, status, expires_at, phone_session_id)
          VALUES
            (@confirmationId, @ownerObjectId, @conversationId, @actionKind, 'pending',
              DATEADD(second, @lifetimeSeconds, SYSUTCDATETIME()), @phoneSessionId);`);
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
    async expireConfirmation(id, ownerObjectId) {
      const { rowsAffected } = await pool.request()
        .input('confirmationId', sql.Char(43), id)
        .input('ownerObjectId', sql.Char(36), ownerObjectId)
        .query(`UPDATE dbo.teams_confirmations
          SET status = 'expired', resolved_at = SYSUTCDATETIME()
          WHERE confirmation_id = @confirmationId AND owner_object_id = @ownerObjectId
            AND status = 'pending' AND expires_at <= SYSUTCDATETIME();`);
      return (rowsAffected[0] ?? 0) > 0;
    },
    async expirePendingConfirmations() {
      await pool.request().query(`UPDATE dbo.teams_confirmations SET status = 'expired', resolved_at = SYSUTCDATETIME()
        WHERE status = 'pending';`);
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
