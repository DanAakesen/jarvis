import { createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';

export interface ApprovalNotificationRegistration {
  deviceToken: string;
  showActions: boolean;
  timeZone: string;
}

export interface StoredApprovalNotificationRegistration extends ApprovalNotificationRegistration {
  registrationId: string;
}

export interface ApprovalNotificationStore {
  upsert(
    owner: string,
    registration: ApprovalNotificationRegistration,
  ): Promise<'saved' | 'device_limit' | 'invalid_token'>;
  list(owner: string): Promise<StoredApprovalNotificationRegistration[]>;
  remove(owner: string, deviceToken: string): Promise<void>;
  invalidate(owner: string, deviceToken: string, statusCode?: number | null): Promise<void>;
}

export function createApprovalNotificationStore(pool: sql.ConnectionPool): ApprovalNotificationStore {
  return {
    async upsert(owner, registration) {
      const token = registration.deviceToken.toLowerCase();
      const tokenHash = createHash('sha256').update(token).digest('hex').toUpperCase();
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('registrationId', sql.UniqueIdentifier, randomUUID())
        .input('token', sql.VarChar(512), token)
        .input('tokenHash', sql.Char(64), tokenHash)
        .input('showActions', sql.Bit, registration.showActions)
        .input('timeZone', sql.VarChar(64), registration.timeZone)
        .query<{ outcome: 'saved' | 'device_limit' | 'invalid_token' }>(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) = CONCAT(N'jarvis.approval-notifications:', CONVERT(nvarchar(36), @owner));
          EXEC @lockResult = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51001, 'Approval notification registration unavailable', 1;
          DECLARE @expired TABLE (
            registration_id uniqueidentifier NOT NULL,
            device_reference char(36) COLLATE Latin1_General_100_BIN2 NOT NULL
          );
          INSERT @expired (registration_id, device_reference)
          SELECT registration_id, CONVERT(char(36), registration_id)
            FROM dbo.approval_notification_registrations
            WHERE owner_object_id=@owner AND expires_at <= SYSUTCDATETIME();
          UPDATE a
            SET state = N'failed', last_result = N'registration_expired',
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
          FROM dbo.reply_notification_approval_deliveries a
          INNER JOIN @expired expired ON expired.device_reference = a.device_reference
          WHERE a.state = N'sending';
          UPDATE d
            SET state = N'failed', last_result = N'registration_expired',
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                lease_owner = NULL, lease_until = NULL
          FROM dbo.reply_notification_deliveries d
          INNER JOIN @expired expired ON expired.device_reference = d.device_reference
          WHERE d.state IN (N'pending', N'sending');
          UPDATE o
            SET state = N'failed', last_result = N'registration_expired',
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
          FROM dbo.owner_reminder_deliveries o
          INNER JOIN @expired expired ON expired.device_reference = o.device_reference
          WHERE o.state IN (N'pending', N'sending', N'retrying');
          DELETE registration
          FROM dbo.approval_notification_registrations registration
          INNER JOIN @expired expired ON expired.registration_id = registration.registration_id;
          DECLARE @outcome varchar(16);
          IF EXISTS (
            SELECT 1 FROM dbo.approval_notification_token_tombstones
            WHERE owner_object_id = @owner AND device_token_hash = @tokenHash
          )
          BEGIN
            DECLARE @rejected TABLE (
              registration_id uniqueidentifier NOT NULL,
              device_reference char(36) COLLATE Latin1_General_100_BIN2 NOT NULL
            );
            INSERT @rejected (registration_id, device_reference)
            SELECT registration_id, CONVERT(char(36), registration_id)
              FROM dbo.approval_notification_registrations
              WHERE owner_object_id = @owner AND device_token = @token;
            UPDATE a
              SET state = N'invalid_token', last_result = N'apns_invalid_token',
                  completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
            FROM dbo.reply_notification_approval_deliveries a
            INNER JOIN @rejected rejected ON rejected.device_reference = a.device_reference
            WHERE a.state = N'sending';
            UPDATE d
              SET state = N'invalid_token', last_result = N'apns_invalid_token',
                  completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                  lease_owner = NULL, lease_until = NULL
            FROM dbo.reply_notification_deliveries d
            INNER JOIN @rejected rejected ON rejected.device_reference = d.device_reference
            WHERE d.state IN (N'pending', N'sending');
            UPDATE o
              SET state = N'invalid_token', last_result = N'apns_invalid_token',
                  completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                  next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
            FROM dbo.owner_reminder_deliveries o
            INNER JOIN @rejected rejected ON rejected.device_reference = o.device_reference
            WHERE o.state IN (N'pending', N'sending', N'retrying');
            DELETE registration
            FROM dbo.approval_notification_registrations registration
            INNER JOIN @rejected rejected ON rejected.registration_id = registration.registration_id;
            UPDATE dbo.approval_notification_token_tombstones
              SET last_rejected_at = SYSUTCDATETIME()
              WHERE owner_object_id = @owner AND device_token_hash = @tokenHash;
            SET @outcome = 'invalid_token';
          END
          ELSE
          BEGIN
            IF EXISTS (SELECT 1 FROM dbo.approval_notification_registrations
              WHERE owner_object_id=@owner AND device_token=@token)
            BEGIN
              UPDATE dbo.approval_notification_registrations
                SET language='en', show_actions=@showActions, time_zone=@timeZone,
                  expires_at=DATEADD(day, 30, SYSUTCDATETIME())
                WHERE owner_object_id=@owner AND device_token=@token;
              SET @outcome = 'saved';
            END
            ELSE IF (SELECT COUNT(*) FROM dbo.approval_notification_registrations
              WHERE owner_object_id=@owner) < 5
            BEGIN
              INSERT dbo.approval_notification_registrations
                (registration_id, owner_object_id, device_token, language, show_actions, time_zone, expires_at)
                VALUES (@registrationId, @owner, @token, 'en', @showActions, @timeZone, DATEADD(day, 30, SYSUTCDATETIME()));
              SET @outcome = 'saved';
            END
            ELSE SET @outcome = 'device_limit';
          END
          COMMIT TRANSACTION;
          SELECT @outcome AS outcome;`);
      const outcome = recordset[0]?.outcome;
      if (outcome === undefined) throw new Error('Approval notification registration outcome was unavailable');
      return outcome;
    },
    async list(owner) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .query<StoredApprovalNotificationRegistration>(`SELECT TOP (5)
          CONVERT(nvarchar(36), registration_id) AS registrationId,
          device_token AS deviceToken,
          show_actions AS showActions, time_zone AS timeZone
          FROM dbo.approval_notification_registrations
          WHERE owner_object_id=@owner AND expires_at > SYSUTCDATETIME()
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
            )
          ORDER BY device_token;`);
      return recordset.map((registration) => ({
        ...registration,
        registrationId: registration.registrationId.toLowerCase(),
        showActions: registration.showActions === true,
      }));
    },
    async remove(owner, deviceToken) {
      await pool.request().input('owner', sql.UniqueIdentifier, owner)
        .input('token', sql.VarChar(512), deviceToken)
        .query(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) = CONCAT(N'jarvis.approval-notifications:', CONVERT(nvarchar(36), @owner));
          EXEC @lockResult = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51001, 'Approval notification registration unavailable', 1;
          DECLARE @removed TABLE (
            registration_id uniqueidentifier NOT NULL,
            device_reference char(36) COLLATE Latin1_General_100_BIN2 NOT NULL
          );
          INSERT @removed (registration_id, device_reference)
          SELECT registration_id, CONVERT(char(36), registration_id)
            FROM dbo.approval_notification_registrations
            WHERE owner_object_id=@owner AND device_token=@token;
          UPDATE a
            SET state = N'failed', last_result = N'registration_removed',
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
          FROM dbo.reply_notification_approval_deliveries a
          INNER JOIN @removed removed ON removed.device_reference = a.device_reference
          WHERE a.state = N'sending';
          UPDATE d
            SET state = N'failed', last_result = N'registration_removed',
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                lease_owner = NULL, lease_until = NULL
          FROM dbo.reply_notification_deliveries d
          INNER JOIN @removed removed ON removed.device_reference = d.device_reference
          WHERE d.state IN (N'pending', N'sending');
          DELETE registration
          FROM dbo.approval_notification_registrations registration
          INNER JOIN @removed removed ON removed.registration_id = registration.registration_id;
          COMMIT TRANSACTION;`);
    },
    async invalidate(owner, deviceToken, statusCode = null) {
      const token = deviceToken.toLowerCase();
      const tokenHash = createHash('sha256').update(token).digest('hex').toUpperCase();
      await pool.request().input('owner', sql.UniqueIdentifier, owner)
        .input('token', sql.VarChar(512), token)
        .input('tokenHash', sql.Char(64), tokenHash)
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
            device_reference char(36) COLLATE Latin1_General_100_BIN2 NOT NULL,
            token_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL
          );
          INSERT @invalid (registration_id, device_reference, token_hash)
          SELECT registration_id, CONVERT(char(36), registration_id),
            CONVERT(char(64), HASHBYTES(N'SHA2_256', CONVERT(varbinary(512), LOWER(device_token))), 2)
          FROM dbo.approval_notification_registrations
          WHERE owner_object_id=@owner AND device_token=@token;
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
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
          FROM dbo.reply_notification_approval_deliveries a
          INNER JOIN @invalid invalid ON invalid.device_reference = a.device_reference
          WHERE a.state = N'sending';
          UPDATE d
            SET state = N'invalid_token', last_result = N'apns_invalid_token',
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                lease_owner = NULL, lease_until = NULL
          FROM dbo.reply_notification_deliveries d
          INNER JOIN @invalid invalid ON invalid.device_reference = d.device_reference
          WHERE d.state IN (N'pending', N'sending');
          UPDATE o
            SET state = N'invalid_token', last_result = N'apns_invalid_token',
                last_status_code = @statusCode, completed_at = SYSUTCDATETIME(),
                updated_at = SYSUTCDATETIME(), next_attempt_at = NULL,
                lease_owner = NULL, lease_until = NULL
          FROM dbo.owner_reminder_deliveries o
          INNER JOIN @invalid invalid ON invalid.device_reference = o.device_reference
          WHERE o.state IN (N'pending', N'sending', N'retrying');
          DELETE registration
          FROM dbo.approval_notification_registrations registration
          INNER JOIN @invalid invalid ON invalid.registration_id = registration.registration_id;
          COMMIT TRANSACTION;`);
    },
  };
}
