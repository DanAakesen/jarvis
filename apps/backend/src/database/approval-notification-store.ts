import { randomUUID } from 'node:crypto';
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
  upsert(owner: string, registration: ApprovalNotificationRegistration): Promise<boolean>;
  list(owner: string): Promise<StoredApprovalNotificationRegistration[]>;
  remove(owner: string, deviceToken: string): Promise<void>;
}

export function createApprovalNotificationStore(pool: sql.ConnectionPool): ApprovalNotificationStore {
  return {
    async upsert(owner, registration) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('registrationId', sql.UniqueIdentifier, randomUUID())
        .input('token', sql.VarChar(512), registration.deviceToken)
        .input('showActions', sql.Bit, registration.showActions)
        .input('timeZone', sql.VarChar(64), registration.timeZone)
        .query<{ saved: boolean }>(`SET XACT_ABORT ON;
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
          DELETE registration
          FROM dbo.approval_notification_registrations registration
          INNER JOIN @expired expired ON expired.registration_id = registration.registration_id;
          DECLARE @saved bit = 0;
          IF EXISTS (SELECT 1 FROM dbo.approval_notification_registrations
            WHERE owner_object_id=@owner AND device_token=@token)
          BEGIN
            UPDATE dbo.approval_notification_registrations
              SET language='en', show_actions=@showActions, time_zone=@timeZone,
                expires_at=DATEADD(day, 30, SYSUTCDATETIME())
              WHERE owner_object_id=@owner AND device_token=@token;
            SET @saved=1;
          END
          ELSE IF (SELECT COUNT(*) FROM dbo.approval_notification_registrations
            WHERE owner_object_id=@owner) < 5
          BEGIN
            INSERT dbo.approval_notification_registrations
              (registration_id, owner_object_id, device_token, language, show_actions, time_zone, expires_at)
              VALUES (@registrationId, @owner, @token, 'en', @showActions, @timeZone, DATEADD(day, 30, SYSUTCDATETIME()));
            SET @saved=1;
          END
          COMMIT TRANSACTION;
          SELECT @saved AS saved;`);
      return recordset[0]?.saved === true;
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
  };
}
