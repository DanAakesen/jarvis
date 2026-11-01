import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';

export interface ActivityRegistration {
  activityId: string;
  kind: 'background_job' | 'factory_task';
  resourceId: string;
  pushToken: string;
  language: 'da' | 'en';
}
export interface ActivityRegistrationStore {
  upsert(owner: string, registration: ActivityRegistration): Promise<boolean>;
  list(owner: string): Promise<ActivityRegistration[]>;
  remove(owner: string, activityId: string, pushToken?: string): Promise<void>;
}

export function createActivityRegistrationStore(pool: sql.ConnectionPool): ActivityRegistrationStore {
  return {
    async upsert(owner, registration) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('activityId', sql.VarChar(128), registration.activityId)
        .input('kind', sql.VarChar(16), registration.kind)
        .input('resourceId', sql.VarChar(36), registration.resourceId)
        .input('token', sql.VarChar(512), registration.pushToken)
        .input('language', sql.Char(2), registration.language)
        .query<{ saved: boolean }>(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @lockResult int;
          DECLARE @resource nvarchar(255) = CONCAT(N'jarvis.activitykit:', CONVERT(nvarchar(36), @owner));
          EXEC @lockResult = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=5000;
          IF @lockResult < 0 THROW 51001, 'Activity registration unavailable', 1;
          DELETE dbo.activitykit_registrations WHERE owner_object_id=@owner AND expires_at <= SYSUTCDATETIME();
          DECLARE @saved bit = 0;
          IF EXISTS (SELECT 1 FROM dbo.activitykit_registrations WHERE owner_object_id=@owner AND activity_id=@activityId)
          BEGIN
            UPDATE dbo.activitykit_registrations SET resource_kind=@kind, resource_id=@resourceId,
              push_token=@token, language=@language, expires_at=DATEADD(hour, 8, SYSUTCDATETIME())
              WHERE owner_object_id=@owner AND activity_id=@activityId;
            SET @saved=1;
          END
          ELSE IF (SELECT COUNT(*) FROM dbo.activitykit_registrations WHERE owner_object_id=@owner) < 20
          BEGIN
            INSERT dbo.activitykit_registrations (owner_object_id, activity_id, resource_kind, resource_id, push_token, language, expires_at)
              VALUES (@owner, @activityId, @kind, @resourceId, @token, @language, DATEADD(hour, 8, SYSUTCDATETIME()));
            SET @saved=1;
          END
          COMMIT TRANSACTION;
          SELECT @saved AS saved;`);
      return recordset[0]?.saved === true;
    },
    async list(owner) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .query<ActivityRegistration>(`SELECT TOP (20) activity_id AS activityId, resource_kind AS kind,
          resource_id AS resourceId, push_token AS pushToken, language
          FROM dbo.activitykit_registrations
          WHERE owner_object_id=@owner AND expires_at > SYSUTCDATETIME()
          ORDER BY activity_id;`);
      return recordset;
    },
    async remove(owner, activityId, pushToken) {
      await pool.request().input('owner', sql.UniqueIdentifier, owner)
        .input('activityId', sql.VarChar(128), activityId)
        .input('token', sql.VarChar(512), pushToken ?? null)
        .query(`DELETE dbo.activitykit_registrations WHERE owner_object_id=@owner AND activity_id=@activityId
          AND (@token IS NULL OR push_token=@token);`);
    },
  };
}
