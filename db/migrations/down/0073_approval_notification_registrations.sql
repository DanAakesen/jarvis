SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM dbo.approval_notification_registrations WITH (TABLOCKX,HOLDLOCK))
  THROW 51000, 'Approval notification registrations must be removed explicitly before rollback', 1;
DROP TABLE dbo.approval_notification_registrations;
COMMIT TRANSACTION;
