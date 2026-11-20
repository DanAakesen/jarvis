CREATE TRIGGER dbo.TR_approval_notification_registrations_terminalize_deliveries
ON dbo.approval_notification_registrations
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE a
    SET state = N'failed', last_result = N'registration_removed',
        completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
  FROM dbo.reply_notification_approval_deliveries a
  INNER JOIN deleted r
    ON a.device_reference = CONVERT(char(36), r.registration_id)
  WHERE a.state = N'sending';

  UPDATE d
    SET state = N'failed', last_result = N'registration_removed',
        completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
        lease_owner = NULL, lease_until = NULL
  FROM dbo.reply_notification_deliveries d
  INNER JOIN deleted r
    ON d.device_reference = CONVERT(char(36), r.registration_id)
  WHERE d.state IN (N'pending', N'sending');

  DELETE registration
  FROM dbo.approval_notification_registrations registration
  INNER JOIN deleted removed
    ON removed.registration_id = registration.registration_id;
END;
