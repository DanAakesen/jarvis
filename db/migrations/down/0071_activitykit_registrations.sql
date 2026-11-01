SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM dbo.activitykit_registrations WITH (TABLOCKX,HOLDLOCK))
  THROW 51000, 'ActivityKit registrations must be removed explicitly before rollback', 1;
DROP TABLE dbo.activitykit_registrations;
COMMIT TRANSACTION;
