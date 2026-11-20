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
          UPDATE dbo.reply_notification_deliveries
            SET state = N'invalid_token', last_result = N'registration_expired',
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                lease_owner = NULL, lease_until = NULL
            WHERE state IN (N'pending', N'sending')
              AND registration_id IN (
                SELECT registration_id FROM dbo.approval_notification_registrations
                WHERE owner_object_id=@owner AND expires_at <= SYSUTCDATETIME()
              );
          DELETE dbo.approval_notification_registrations
            WHERE owner_object_id=@owner AND expires_at <= SYSUTCDATETIME();
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
          UPDATE dbo.reply_notification_deliveries
            SET state = N'invalid_token', last_result = N'registration_removed',
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
                lease_owner = NULL, lease_until = NULL
            WHERE state IN (N'pending', N'sending')
              AND registration_id IN (
                SELECT registration_id FROM dbo.approval_notification_registrations
                WHERE owner_object_id=@owner AND device_token=@token
              );
          DELETE dbo.approval_notification_registrations
            WHERE owner_object_id=@owner AND device_token=@token;
          COMMIT TRANSACTION;`);
    },
  };
}
