import sql from 'mssql';
import { createHash } from 'node:crypto';

const validId = (value: string): boolean =>
  /^[1-9]\d{0,18}$/u.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
const maxAttempts = 5;
const deviceTokenHash = (token: string) =>
  createHash('sha256').update(token.toLowerCase()).digest('hex').toUpperCase();

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
  readonly proactiveText: string | null;
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
    deviceToken: string,
    statusCode: number | null,
  ): Promise<void>;
  reconciliationComplete(owner: string, turnMessageId: string): Promise<boolean>;
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
    deviceToken: string,
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
  proactive_text: string | null;
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
          DECLARE @registrationResource nvarchar(255) =
            CONCAT(N'jarvis.approval-notifications:', CONVERT(nvarchar(36), @owner));
          EXEC @lockResult = sys.sp_getapplock
            @Resource=@registrationResource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51001, 'Approval notification registration unavailable', 1;
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
            WHERE expires_at < DATEADD(day, -30, SYSUTCDATETIME());
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
            WHERE owner_object_id = @owner AND expires_at > SYSUTCDATETIME()
              AND NOT EXISTS (
                SELECT 1 FROM dbo.approval_notification_token_tombstones tombstone
                WHERE tombstone.owner_object_id = dbo.approval_notification_registrations.owner_object_id
                  AND tombstone.device_token_hash = CONVERT(
                    char(64),
                    HASHBYTES(
                      N'SHA2_256',
                      CONVERT(varbinary(512), LOWER(dbo.approval_notification_registrations.device_token))
                    ),
                    2
                  )
              );
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

    async approvalInvalidToken(owner, _confirmationId, _registrationId, deviceToken, statusCode) {
      await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('token', sql.VarChar(512), deviceToken.toLowerCase())
        .input('tokenHash', sql.Char(64), deviceTokenHash(deviceToken))
        .input('statusCode', sql.Int, statusCode)
        .query(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) = CONCAT(N'jarvis.approval-notifications:', CONVERT(nvarchar(36), @owner));
          EXEC @lockResult = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51001, 'Approval notification registration unavailable', 1;
          DECLARE @invalid TABLE (
            registration_id uniqueidentifier NOT NULL,
            device_reference char(36) COLLATE Latin1_General_100_BIN2 NOT NULL
          );
          INSERT @invalid (registration_id, device_reference)
          SELECT registration_id, CONVERT(char(36), registration_id)
            FROM dbo.approval_notification_registrations
            WHERE owner_object_id = @owner AND device_token = @token;
          MERGE dbo.approval_notification_token_tombstones WITH (HOLDLOCK) AS target
          USING (SELECT @owner AS owner_object_id, @tokenHash AS device_token_hash) AS source
            ON target.owner_object_id = source.owner_object_id
              AND target.device_token_hash = source.device_token_hash
          WHEN MATCHED THEN UPDATE SET last_rejected_at = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT (
              owner_object_id, device_token_hash, reason, invalidated_at, last_rejected_at
            ) VALUES (
              source.owner_object_id, source.device_token_hash, N'apns_invalid_token',
              SYSUTCDATETIME(), SYSUTCDATETIME()
            );
          UPDATE a
            SET state = N'invalid_token', last_result = N'apns_invalid_token',
                last_status_code = @statusCode, completed_at = SYSUTCDATETIME(),
                updated_at = SYSUTCDATETIME()
          FROM dbo.reply_notification_approval_deliveries a
          INNER JOIN dbo.reply_notification_approval_claims c
            ON c.confirmation_id = a.confirmation_id
          INNER JOIN @invalid invalid
            ON invalid.device_reference = a.device_reference
          WHERE c.owner_object_id = @owner
            AND a.state = N'sending';
          UPDATE d
            SET state = N'invalid_token', last_result = N'apns_invalid_token',
                last_status_code = @statusCode, completed_at = SYSUTCDATETIME(),
                updated_at = SYSUTCDATETIME(), lease_owner = NULL, lease_until = NULL
          FROM dbo.reply_notification_deliveries d
          INNER JOIN @invalid invalid ON invalid.device_reference = d.device_reference
          WHERE d.owner_object_id = @owner AND d.state IN (N'pending', N'sending');
          UPDATE o
            SET state = N'invalid_token', last_result = N'apns_invalid_token',
                last_status_code = @statusCode, completed_at = SYSUTCDATETIME(),
                updated_at = SYSUTCDATETIME(), next_attempt_at = NULL,
                lease_owner = NULL, lease_until = NULL
          FROM dbo.owner_reminder_deliveries o
          INNER JOIN @invalid invalid ON invalid.device_reference = o.device_reference
          WHERE o.owner_object_id = @owner AND o.state IN (N'pending', N'sending', N'retrying');
          DELETE registration
          FROM dbo.approval_notification_registrations registration
          INNER JOIN @invalid invalid ON invalid.registration_id = registration.registration_id;
          COMMIT TRANSACTION;`);
    },

    async reconciliationComplete(owner, turnMessageId) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('turnMessageId', sql.BigInt, BigInt(turnMessageId))
        .query<{ complete: boolean }>(`SELECT CONVERT(bit, CASE WHEN EXISTS (
          SELECT 1
          FROM dbo.reply_notification_approval_deliveries d
          INNER JOIN dbo.reply_notification_approval_claims c
            ON c.confirmation_id = d.confirmation_id
          WHERE c.owner_object_id = @owner AND c.turn_message_id = @turnMessageId
            AND d.state = N'sending'
        ) THEN 0 ELSE 1 END) AS complete;`);
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
          DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) = CONCAT(N'jarvis.approval-notifications:', CONVERT(nvarchar(36), @owner));
          EXEC @lockResult = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51001, 'Approval notification registration unavailable', 1;
          DELETE FROM dbo.reply_notification_deliveries
            WHERE owner_object_id = @owner
              AND state IN (N'accepted', N'failed', N'expired', N'invalid_token', N'suppressed')
              AND completed_at < DATEADD(day, -30, @now);
          DECLARE @expired TABLE (
            registration_id uniqueidentifier NOT NULL,
            device_reference char(36) COLLATE Latin1_General_100_BIN2 NOT NULL
          );
          INSERT @expired (registration_id, device_reference)
          SELECT registration_id, CONVERT(char(36), registration_id)
            FROM dbo.approval_notification_registrations
            WHERE owner_object_id = @owner AND expires_at <= @now;
          UPDATE a
            SET state = N'failed', last_result = N'registration_expired',
                completed_at = @now, updated_at = SYSUTCDATETIME()
          FROM dbo.reply_notification_approval_deliveries a
          INNER JOIN @expired expired ON expired.device_reference = a.device_reference
          WHERE a.state = N'sending';
          UPDATE d
            SET state = N'failed', last_result = N'registration_expired',
                completed_at = @now, updated_at = SYSUTCDATETIME(),
                lease_owner = NULL, lease_until = NULL
          FROM dbo.reply_notification_deliveries d
          INNER JOIN @expired expired ON expired.device_reference = d.device_reference
          WHERE d.state IN (N'pending', N'sending');
          UPDATE o
            SET state = N'failed', last_result = N'registration_expired',
                completed_at = @now, updated_at = SYSUTCDATETIME(),
                next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
          FROM dbo.owner_reminder_deliveries o
          INNER JOIN @expired expired ON expired.device_reference = o.device_reference
          WHERE o.owner_object_id = @owner
            AND o.state IN (N'pending', N'sending', N'retrying');
          DELETE registration
          FROM dbo.approval_notification_registrations registration
          INNER JOIN @expired expired ON expired.registration_id = registration.registration_id;
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
              AND NOT EXISTS (
                SELECT 1 FROM dbo.approval_notification_token_tombstones tombstone
                WHERE tombstone.owner_object_id = r.owner_object_id
                  AND tombstone.device_token_hash = CONVERT(
                    char(64),
                    HASHBYTES(N'SHA2_256', CONVERT(varbinary(512), LOWER(r.device_token))),
                    2
                  )
              )
              AND d.attempt_count < @maxAttempts
              AND d.expires_at > @now
              AND NOT EXISTS (
                SELECT 1
                FROM dbo.reply_notification_approval_claims c
                INNER JOIN dbo.reply_notification_approval_deliveries a
                  ON a.confirmation_id = c.confirmation_id
                WHERE c.owner_object_id = d.owner_object_id
                  AND c.turn_message_id = d.turn_message_id
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
            d.notification_id, d.preview, proactive.message_text AS proactive_text, d.expires_at, d.attempt_count
          FROM dbo.reply_notification_deliveries d
          INNER JOIN @claimed c ON c.id = d.id
          INNER JOIN dbo.approval_notification_registrations r
            ON r.registration_id = d.registration_id
          OUTER APPLY (
            SELECT TOP (1) receipt.message_text
            FROM dbo.pi_message AS receipt
            WHERE receipt.owner_object_id = @owner AND receipt.message_id = d.message_id
              AND receipt.session_id = d.jarvis_session_id
            ORDER BY receipt.id DESC
          ) AS proactive
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
        proactiveText: row.proactive_text,
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

    async invalidateRegistration(owner, _registrationId, _deliveryId, _claimToken, deviceToken, statusCode) {
      await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('token', sql.VarChar(512), deviceToken.toLowerCase())
        .input('tokenHash', sql.Char(64), deviceTokenHash(deviceToken))
        .input('statusCode', sql.Int, statusCode)
        .query(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) = CONCAT(N'jarvis.approval-notifications:', CONVERT(nvarchar(36), @owner));
          EXEC @lockResult = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51001, 'Approval notification registration unavailable', 1;
          DECLARE @invalid TABLE (
            registration_id uniqueidentifier NOT NULL,
            device_reference char(36) COLLATE Latin1_General_100_BIN2 NOT NULL
          );
          INSERT @invalid (registration_id, device_reference)
          SELECT registration_id, CONVERT(char(36), registration_id)
            FROM dbo.approval_notification_registrations
            WHERE owner_object_id = @owner AND device_token = @token;
          MERGE dbo.approval_notification_token_tombstones WITH (HOLDLOCK) AS target
          USING (SELECT @owner AS owner_object_id, @tokenHash AS device_token_hash) AS source
            ON target.owner_object_id = source.owner_object_id
              AND target.device_token_hash = source.device_token_hash
          WHEN MATCHED THEN UPDATE SET last_rejected_at = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT (
              owner_object_id, device_token_hash, reason, invalidated_at, last_rejected_at
            ) VALUES (
              source.owner_object_id, source.device_token_hash, N'apns_invalid_token',
              SYSUTCDATETIME(), SYSUTCDATETIME()
            );
          UPDATE a
            SET state = N'invalid_token', last_result = N'apns_invalid_token',
                last_status_code = @statusCode, completed_at = SYSUTCDATETIME(),
                updated_at = SYSUTCDATETIME()
          FROM dbo.reply_notification_approval_deliveries a
          INNER JOIN dbo.reply_notification_approval_claims c
            ON c.confirmation_id = a.confirmation_id
          INNER JOIN @invalid invalid
            ON invalid.device_reference = a.device_reference
          WHERE c.owner_object_id = @owner
            AND a.state = N'sending';
          UPDATE d
            SET state = N'invalid_token', last_result = N'apns_invalid_token',
                last_status_code = @statusCode,
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                lease_owner = NULL, lease_until = NULL
          FROM dbo.reply_notification_deliveries d
          INNER JOIN @invalid invalid ON invalid.device_reference = d.device_reference
          WHERE d.owner_object_id = @owner AND d.state IN (N'pending', N'sending');
          UPDATE o
            SET state = N'invalid_token', last_result = N'apns_invalid_token',
                last_status_code = @statusCode, completed_at = SYSUTCDATETIME(),
                updated_at = SYSUTCDATETIME(), next_attempt_at = NULL,
                lease_owner = NULL, lease_until = NULL
          FROM dbo.owner_reminder_deliveries o
          INNER JOIN @invalid invalid ON invalid.device_reference = o.device_reference
          WHERE o.owner_object_id = @owner AND o.state IN (N'pending', N'sending', N'retrying');
          DELETE registration
          FROM dbo.approval_notification_registrations registration
          INNER JOIN @invalid invalid ON invalid.registration_id = registration.registration_id;
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
