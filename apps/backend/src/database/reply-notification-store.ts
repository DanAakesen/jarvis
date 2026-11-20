import sql from 'mssql';

const validId = (value: string): boolean =>
  /^[1-9]\d{0,18}$/u.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
const maxAttempts = 5;

export interface ReplyNotificationApprovalClaim {
  readonly owner: string;
  readonly confirmationId: string;
  readonly turnMessageId: string | null;
  readonly expiresAt: Date;
}

export interface ClaimedApprovalNotificationDelivery {
  readonly confirmationId: string;
  readonly registrationId: string;
  readonly deviceToken: string;
  readonly showActions: boolean;
  readonly timeZone: string;
}

export interface ReplyNotificationApprovalClaimResult {
  readonly claimed: boolean;
  readonly deliveries: readonly ClaimedApprovalNotificationDelivery[];
}

export interface ClaimedReplyNotificationDelivery {
  readonly id: string;
  readonly claimToken: string;
  readonly registrationId: string;
  readonly deviceToken: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly notificationId: string;
  readonly preview: string;
  readonly expiresAt: Date;
  readonly attemptCount: number;
}

export interface ReplyNotificationDiagnostics {
  readonly pending: number;
  readonly accepted: number;
  readonly failed: number;
  readonly expired: number;
  readonly invalidToken: number;
  readonly suppressed: number;
  readonly lastFailureAt: string | null;
}

export interface ReplyNotificationStore {
  claimApproval(input: ReplyNotificationApprovalClaim): Promise<ReplyNotificationApprovalClaimResult>;
  approvalAccepted(
    owner: string,
    confirmationId: string,
    registrationId: string,
    statusCode: number | null,
  ): Promise<void>;
  approvalFailed(
    owner: string,
    confirmationId: string,
    registrationId: string,
    result: 'provider_rejected' | 'transport_unavailable',
    statusCode: number | null,
  ): Promise<void>;
  approvalInvalidToken(
    owner: string,
    confirmationId: string,
    registrationId: string,
    statusCode: number | null,
  ): Promise<void>;
  reconciliationComplete(owner: string, turnMessageId: string, at: Date): Promise<boolean>;
  claimDue(owner: string, claimToken: string, now: Date, leaseUntil: Date, limit?: number): Promise<ClaimedReplyNotificationDelivery[]>;
  accepted(id: string, claimToken: string, statusCode: number | null): Promise<void>;
  retry(id: string, claimToken: string, nextAttemptAt: Date, statusCode: number | null): Promise<void>;
  failed(id: string, claimToken: string, result: 'provider_rejected' | 'retry_exhausted', statusCode: number | null): Promise<void>;
  expired(id: string, claimToken: string, statusCode: number | null): Promise<void>;
  invalidateRegistration(
    owner: string,
    registrationId: string,
    deliveryId: string,
    claimToken: string,
    statusCode: number | null,
  ): Promise<void>;
  diagnostics(owner: string, signal?: AbortSignal): Promise<ReplyNotificationDiagnostics>;
}

interface ClaimedDeliveryRow {
  id: string;
  registration_id: string;
  device_token: string;
  session_id: string;
  message_id: string;
  notification_id: string;
  preview: string;
  expires_at: Date;
  attempt_count: number;
}

interface ClaimedApprovalDeliveryRow {
  claimed: boolean;
  confirmation_id: string | null;
  registration_id: string | null;
  device_token: string | null;
  show_actions: boolean | null;
  time_zone: string | null;
}

export function createReplyNotificationStore(pool: sql.ConnectionPool): ReplyNotificationStore {
  return {
    async claimApproval(input) {
      if (!/^[A-Za-z0-9_-]{43}$/u.test(input.confirmationId) ||
          input.turnMessageId !== null && !validId(input.turnMessageId) ||
          !Number.isFinite(input.expiresAt.getTime())) {
        throw new TypeError('Invalid reply notification approval claim');
      }
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, input.owner)
        .input('confirmationId', sql.Char(43), input.confirmationId)
        .input('turnMessageId', sql.BigInt, input.turnMessageId === null ? null : BigInt(input.turnMessageId))
        .input('expiresAt', sql.DateTime2(3), input.expiresAt)
        .query<ClaimedApprovalDeliveryRow>(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) = CONCAT(
            N'jarvis.reply-notification-turn:',
            LOWER(CONVERT(nvarchar(36), @owner)),
            N':',
            COALESCE(CONVERT(nvarchar(20), @turnMessageId), @confirmationId)
          );
          EXEC @lockResult = sys.sp_getapplock
            @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51001, 'Reply notification approval claim unavailable', 1;
          DELETE FROM dbo.reply_notification_approval_claims
            WHERE expires_at < DATEADD(day, -1, SYSUTCDATETIME());
          DECLARE @claimed bit = 0;
          IF NOT EXISTS (
            SELECT 1 FROM dbo.reply_notification_approval_claims
            WHERE confirmation_id = @confirmationId
          )
          BEGIN
            INSERT dbo.reply_notification_approval_claims
              (confirmation_id, owner_object_id, turn_message_id, expires_at)
              VALUES (@confirmationId, @owner, @turnMessageId, @expiresAt);
            SET @claimed = 1;
          END;
          IF @claimed = 1
          BEGIN
            INSERT dbo.reply_notification_approval_deliveries
              (confirmation_id, device_reference, registration_id, state, lease_until)
            SELECT @confirmationId, CONVERT(char(36), registration_id), registration_id,
              N'sending', DATEADD(second, 8, SYSUTCDATETIME())
            FROM dbo.approval_notification_registrations
            WHERE owner_object_id = @owner AND expires_at > SYSUTCDATETIME();
          END;
          SELECT @claimed AS claimed, c.confirmation_id,
            CONVERT(nvarchar(36), r.registration_id) AS registration_id,
            r.device_token, r.show_actions, r.time_zone
          FROM (VALUES (1)) seed(n)
          LEFT JOIN dbo.reply_notification_approval_claims c
            ON @claimed = 1 AND c.confirmation_id = @confirmationId
          LEFT JOIN dbo.reply_notification_approval_deliveries d
            ON d.confirmation_id = c.confirmation_id AND d.state = N'sending'
          LEFT JOIN dbo.approval_notification_registrations r
            ON r.registration_id = d.registration_id AND r.owner_object_id = c.owner_object_id
          ORDER BY r.device_token;
          COMMIT TRANSACTION;
          `);
      return {
        claimed: recordset[0]?.claimed === true,
        deliveries: recordset.flatMap((row) => row.registration_id === null
          || row.confirmation_id === null || row.device_token === null || row.time_zone === null
          ? []
          : [{
          confirmationId: row.confirmation_id,
          registrationId: String(row.registration_id).toLowerCase(),
          deviceToken: row.device_token,
          showActions: row.show_actions === true,
          timeZone: row.time_zone,
        }]),
      };
    },

    async approvalAccepted(owner, confirmationId, registrationId, statusCode) {
      await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('confirmationId', sql.Char(43), confirmationId)
        .input('registrationId', sql.UniqueIdentifier, registrationId)
        .input('statusCode', sql.Int, statusCode)
        .query(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @turnMessageId bigint;
          SELECT @turnMessageId = turn_message_id
            FROM dbo.reply_notification_approval_claims
            WHERE confirmation_id = @confirmationId AND owner_object_id = @owner;
          UPDATE dbo.reply_notification_approval_deliveries
            SET state = N'accepted', last_result = N'accepted', last_status_code = @statusCode,
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
            WHERE confirmation_id = @confirmationId AND registration_id = @registrationId
              AND state IN (N'sending', N'failed');
          UPDATE dbo.reply_notification_deliveries
            SET state = N'suppressed', last_result = N'approval_delivered',
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                lease_owner = NULL, lease_until = NULL
            WHERE owner_object_id = @owner AND turn_message_id = @turnMessageId
              AND registration_id = @registrationId AND state = N'pending';
          COMMIT TRANSACTION;`);
    },

    async approvalFailed(owner, confirmationId, registrationId, result, statusCode) {
      await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('confirmationId', sql.Char(43), confirmationId)
        .input('registrationId', sql.UniqueIdentifier, registrationId)
        .input('result', sql.VarChar(32), result)
        .input('statusCode', sql.Int, statusCode)
        .query(`UPDATE dbo.reply_notification_approval_deliveries
          SET state = N'failed', last_result = @result, last_status_code = @statusCode,
              completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
            WHERE confirmation_id = @confirmationId AND registration_id = @registrationId
              AND state = N'sending'
              AND confirmation_id IN (
                SELECT confirmation_id FROM dbo.reply_notification_approval_claims
                WHERE owner_object_id = @owner
              );`);
    },

    async approvalInvalidToken(owner, confirmationId, registrationId, statusCode) {
      await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('confirmationId', sql.Char(43), confirmationId)
        .input('registrationId', sql.UniqueIdentifier, registrationId)
        .input('statusCode', sql.Int, statusCode)
        .query(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          UPDATE dbo.reply_notification_approval_deliveries
            SET state = N'invalid_token', last_result = N'apns_invalid_token',
                last_status_code = @statusCode, completed_at = SYSUTCDATETIME(),
                updated_at = SYSUTCDATETIME()
            WHERE confirmation_id = @confirmationId AND registration_id = @registrationId
              AND state = N'sending'
              AND confirmation_id IN (
                SELECT confirmation_id FROM dbo.reply_notification_approval_claims
                WHERE owner_object_id = @owner
              );
          UPDATE dbo.reply_notification_deliveries
            SET state = N'invalid_token', last_result = N'apns_invalid_token',
                last_status_code = @statusCode, completed_at = SYSUTCDATETIME(),
                updated_at = SYSUTCDATETIME(), lease_owner = NULL, lease_until = NULL
            WHERE owner_object_id = @owner AND registration_id = @registrationId
              AND state IN (N'pending', N'sending');
          DELETE FROM dbo.approval_notification_registrations
            WHERE owner_object_id = @owner AND registration_id = @registrationId;
          COMMIT TRANSACTION;`);
    },

    async reconciliationComplete(owner, turnMessageId, at) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('turnMessageId', sql.BigInt, BigInt(turnMessageId))
        .input('at', sql.DateTime2(3), at)
        .query<{ complete: boolean }>(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          UPDATE d
            SET state = N'failed', last_result = N'reconciliation_timeout',
                completed_at = @at, updated_at = SYSUTCDATETIME()
          FROM dbo.reply_notification_approval_deliveries d
          INNER JOIN dbo.reply_notification_approval_claims c
            ON c.confirmation_id = d.confirmation_id
          WHERE c.owner_object_id = @owner AND c.turn_message_id = @turnMessageId
            AND d.state = N'sending' AND d.lease_until <= @at;
          DECLARE @complete bit = CONVERT(bit, CASE WHEN EXISTS (
            SELECT 1
            FROM dbo.reply_notification_approval_deliveries d
            INNER JOIN dbo.reply_notification_approval_claims c
              ON c.confirmation_id = d.confirmation_id
            WHERE c.owner_object_id = @owner AND c.turn_message_id = @turnMessageId
              AND c.expires_at > @at AND d.state = N'sending'
          ) THEN 0 ELSE 1 END);
          COMMIT TRANSACTION;
          SELECT @complete AS complete;`);
      return recordset[0]?.complete === true;
    },

    async claimDue(owner, claimToken, now, leaseUntil, limit = 20) {
      if (!Number.isFinite(now.getTime()) || !Number.isFinite(leaseUntil.getTime()) ||
          !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new TypeError('Invalid reply notification claim');
      }
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('now', sql.DateTime2(3), now)
        .input('leaseUntil', sql.DateTime2(3), leaseUntil)
        .input('limit', sql.Int, limit)
        .input('maxAttempts', sql.Int, maxAttempts)
        .query<ClaimedDeliveryRow>(`SET XACT_ABORT ON;
          SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
          BEGIN TRANSACTION;
          DELETE FROM dbo.reply_notification_deliveries
            WHERE owner_object_id = @owner
              AND state IN (N'accepted', N'failed', N'expired', N'invalid_token', N'suppressed')
              AND completed_at < DATEADD(day, -30, @now);
          UPDATE a
            SET state = N'failed', last_result = N'reconciliation_timeout',
                completed_at = @now, updated_at = SYSUTCDATETIME()
          FROM dbo.reply_notification_approval_deliveries a
          INNER JOIN dbo.reply_notification_approval_claims c
            ON c.confirmation_id = a.confirmation_id
          WHERE c.owner_object_id = @owner AND a.state = N'sending' AND a.lease_until <= @now;
          UPDATE dbo.reply_notification_deliveries
            SET state = N'expired', last_result = N'expired', completed_at = @now,
                updated_at = SYSUTCDATETIME(), lease_owner = NULL, lease_until = NULL
            WHERE owner_object_id = @owner
              AND state IN (N'pending', N'sending') AND expires_at <= @now;
          UPDATE dbo.reply_notification_deliveries
            SET state = N'invalid_token', last_result = N'token_unavailable', completed_at = @now,
                updated_at = SYSUTCDATETIME(), lease_owner = NULL, lease_until = NULL
            WHERE owner_object_id = @owner
              AND state IN (N'pending', N'sending') AND registration_id IS NULL;
          UPDATE dbo.reply_notification_deliveries
            SET state = N'failed', last_result = N'retry_exhausted', completed_at = @now,
                updated_at = SYSUTCDATETIME(), lease_owner = NULL, lease_until = NULL
            WHERE owner_object_id = @owner
              AND attempt_count >= @maxAttempts
              AND (
                state = N'pending'
                OR state = N'sending' AND lease_until <= @now
              );
          DECLARE @claimed TABLE (
            id uniqueidentifier NOT NULL PRIMARY KEY
          );
          ;WITH due AS (
            SELECT TOP (@limit) d.id
            FROM dbo.reply_notification_deliveries d WITH (UPDLOCK, READPAST)
            INNER JOIN dbo.approval_notification_registrations r
              ON r.registration_id = d.registration_id
            WHERE d.owner_object_id = @owner AND r.owner_object_id = @owner
              AND r.expires_at > @now
              AND d.attempt_count < @maxAttempts
              AND d.expires_at > @now
              AND NOT EXISTS (
                SELECT 1
                FROM dbo.reply_notification_approval_claims c
                INNER JOIN dbo.reply_notification_approval_deliveries a
                  ON a.confirmation_id = c.confirmation_id
                WHERE c.owner_object_id = d.owner_object_id
                  AND c.turn_message_id = d.turn_message_id
                  AND c.expires_at > @now
                  AND a.device_reference = d.device_reference
                  AND a.state = N'sending'
              )
              AND (
                d.state = N'pending' AND d.next_attempt_at <= @now
                OR d.state = N'sending' AND d.lease_until <= @now
              )
            ORDER BY d.next_attempt_at, d.created_at
          )
          UPDATE d
            SET state = N'sending', attempt_count = d.attempt_count + 1,
                lease_owner = @claimToken, lease_until = @leaseUntil,
                last_attempt_at = @now, updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id INTO @claimed (id)
          FROM dbo.reply_notification_deliveries d
          INNER JOIN due ON due.id = d.id;
          SELECT d.id, CONVERT(nvarchar(36), r.registration_id) AS registration_id,
            r.device_token, CONVERT(varchar(20), d.jarvis_session_id) AS session_id,
            CONVERT(varchar(20), d.message_id) AS message_id,
            d.notification_id, d.preview, d.expires_at, d.attempt_count
          FROM dbo.reply_notification_deliveries d
          INNER JOIN @claimed c ON c.id = d.id
          INNER JOIN dbo.approval_notification_registrations r
            ON r.registration_id = d.registration_id
          WHERE d.lease_owner = @claimToken
          ORDER BY d.next_attempt_at, d.created_at;
          COMMIT TRANSACTION;`);
      return recordset.map((row) => ({
        id: String(row.id).toLowerCase(),
        claimToken,
        registrationId: String(row.registration_id).toLowerCase(),
        deviceToken: row.device_token,
        sessionId: row.session_id,
        messageId: row.message_id,
        notificationId: row.notification_id,
        preview: row.preview,
        expiresAt: row.expires_at,
        attemptCount: row.attempt_count,
      }));
    },

    async accepted(id, claimToken, statusCode) {
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('statusCode', sql.Int, statusCode)
        .query(`UPDATE dbo.reply_notification_deliveries
          SET state = N'accepted', last_result = N'accepted', last_status_code = @statusCode,
              completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
              lease_owner = NULL, lease_until = NULL
          WHERE id = @id AND state = N'sending' AND lease_owner = @claimToken;`);
    },

    async retry(id, claimToken, nextAttemptAt, statusCode) {
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('nextAttemptAt', sql.DateTime2(3), nextAttemptAt)
        .input('statusCode', sql.Int, statusCode)
        .query(`UPDATE dbo.reply_notification_deliveries
          SET state = N'pending', last_result = N'transient', last_status_code = @statusCode,
              next_attempt_at = CASE WHEN @nextAttemptAt < expires_at THEN @nextAttemptAt ELSE expires_at END,
              updated_at = SYSUTCDATETIME(), lease_owner = NULL, lease_until = NULL
          WHERE id = @id AND state = N'sending' AND lease_owner = @claimToken;`);
    },

    async failed(id, claimToken, result, statusCode) {
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('result', sql.VarChar(32), result)
        .input('statusCode', sql.Int, statusCode)
        .query(`UPDATE dbo.reply_notification_deliveries
          SET state = N'failed', last_result = @result, last_status_code = @statusCode,
              completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
              lease_owner = NULL, lease_until = NULL
          WHERE id = @id AND state = N'sending' AND lease_owner = @claimToken;`);
    },

    async expired(id, claimToken, statusCode) {
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('statusCode', sql.Int, statusCode)
        .query(`UPDATE dbo.reply_notification_deliveries
          SET state = N'expired', last_result = N'expired', last_status_code = @statusCode,
              completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
              lease_owner = NULL, lease_until = NULL
          WHERE id = @id AND state = N'sending' AND lease_owner = @claimToken;`);
    },

    async invalidateRegistration(owner, registrationId, deliveryId, claimToken, statusCode) {
      await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('registrationId', sql.UniqueIdentifier, registrationId)
        .input('deliveryId', sql.UniqueIdentifier, deliveryId)
        .input('claimToken', sql.UniqueIdentifier, claimToken)
        .input('statusCode', sql.Int, statusCode)
        .query(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          UPDATE dbo.reply_notification_deliveries
            SET state = N'invalid_token', last_result = N'apns_invalid_token',
                last_status_code = @statusCode,
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                lease_owner = NULL, lease_until = NULL
            WHERE owner_object_id = @owner AND registration_id = @registrationId
              AND (state IN (N'pending', N'sending') OR id = @deliveryId)
              AND (id <> @deliveryId OR lease_owner = @claimToken);
          DELETE FROM dbo.approval_notification_registrations
            WHERE owner_object_id = @owner AND registration_id = @registrationId;
          COMMIT TRANSACTION;`);
    },

    async diagnostics(owner, signal) {
      signal?.throwIfAborted();
      const request = pool.request()
        .input('owner', sql.UniqueIdentifier, owner);
      const cancel = () => { request.cancel(); };
      const read = () => request.query<{
          pending: number;
          accepted: number;
          failed: number;
          expired: number;
          invalid_token: number;
          suppressed: number;
          last_failure_at: Date | null;
        }>(`SELECT
            SUM(CASE WHEN state IN (N'pending', N'sending') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN state = N'accepted' AND created_at >= DATEADD(day, -1, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS accepted,
            SUM(CASE WHEN state = N'failed' AND completed_at >= DATEADD(day, -1, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN state = N'expired' AND completed_at >= DATEADD(day, -1, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS expired,
            SUM(CASE WHEN state = N'invalid_token' AND completed_at >= DATEADD(day, -1, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS invalid_token,
            SUM(CASE WHEN state = N'suppressed' AND completed_at >= DATEADD(day, -1, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS suppressed,
            MAX(CASE WHEN state IN (N'failed', N'expired')
              THEN completed_at ELSE NULL END) AS last_failure_at
          FROM dbo.reply_notification_deliveries
          WHERE owner_object_id = @owner;`);
      signal?.addEventListener('abort', cancel, { once: true });
      let recordset: Awaited<ReturnType<typeof read>>['recordset'];
      try {
        recordset = (await read()).recordset;
        signal?.throwIfAborted();
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
      const row = recordset[0];
      return {
        pending: row?.pending ?? 0,
        accepted: row?.accepted ?? 0,
        failed: row?.failed ?? 0,
        expired: row?.expired ?? 0,
        invalidToken: row?.invalid_token ?? 0,
        suppressed: row?.suppressed ?? 0,
        lastFailureAt: row?.last_failure_at ? row.last_failure_at.toISOString() : null,
      };
    },
  };
}
