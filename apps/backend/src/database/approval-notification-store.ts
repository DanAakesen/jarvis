import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';

export interface ApprovalNotificationRegistration {
  deviceToken: string;
  language: 'da' | 'en';
  showActions: boolean;
}

export interface ApprovalNotificationStore {
  upsert(owner: string, registration: ApprovalNotificationRegistration): Promise<boolean>;
  list(owner: string): Promise<ApprovalNotificationRegistration[]>;
  remove(owner: string, deviceToken: string): Promise<void>;
}

export function createApprovalNotificationStore(pool: sql.ConnectionPool): ApprovalNotificationStore {
  return {
    async upsert(owner, registration) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('token', sql.VarChar(512), registration.deviceToken)
        .input('language', sql.Char(2), registration.language)
        .input('showActions', sql.Bit, registration.showActions)
        .query<{ saved: boolean }>(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) = CONCAT(N'jarvis.approval-notifications:', CONVERT(nvarchar(36), @owner));
          EXEC @lockResult = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51001, 'Approval notification registration unavailable', 1;
          DELETE dbo.approval_notification_registrations
            WHERE owner_object_id=@owner AND expires_at <= SYSUTCDATETIME();
          DECLARE @saved bit = 0;
          IF EXISTS (SELECT 1 FROM dbo.approval_notification_registrations
            WHERE owner_object_id=@owner AND device_token=@token)
          BEGIN
            UPDATE dbo.approval_notification_registrations
              SET language=@language, show_actions=@showActions,
                expires_at=DATEADD(day, 30, SYSUTCDATETIME())
              WHERE owner_object_id=@owner AND device_token=@token;
            SET @saved=1;
          END
          ELSE IF (SELECT COUNT(*) FROM dbo.approval_notification_registrations
            WHERE owner_object_id=@owner) < 5
          BEGIN
            INSERT dbo.approval_notification_registrations
              (owner_object_id, device_token, language, show_actions, expires_at)
              VALUES (@owner, @token, @language, @showActions, DATEADD(day, 30, SYSUTCDATETIME()));
            SET @saved=1;
          END
          COMMIT TRANSACTION;
          SELECT @saved AS saved;`);
      return recordset[0]?.saved === true;
    },
    async list(owner) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .query<ApprovalNotificationRegistration>(`SELECT TOP (5) device_token AS deviceToken,
          language, show_actions AS showActions
          FROM dbo.approval_notification_registrations
          WHERE owner_object_id=@owner AND expires_at > SYSUTCDATETIME()
          ORDER BY device_token;`);
      return recordset.map((registration) => ({
        ...registration,
        showActions: registration.showActions === true,
      }));
    },
    async remove(owner, deviceToken) {
      await pool.request().input('owner', sql.UniqueIdentifier, owner)
        .input('token', sql.VarChar(512), deviceToken)
        .query(`DELETE dbo.approval_notification_registrations
          WHERE owner_object_id=@owner AND device_token=@token;`);
    },
  };
}
