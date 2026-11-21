IF EXISTS (SELECT 1 FROM dbo.owner_reminder_deliveries WITH (TABLOCKX, HOLDLOCK))
  THROW 51000, 'Owner reminder delivery evidence must be retained before rollback', 1;
IF EXISTS (SELECT 1 FROM dbo.owner_reminder_delivery_snapshots WITH (TABLOCKX, HOLDLOCK))
  THROW 51000, 'Owner reminder recipient snapshots must be retained before rollback', 1;
IF EXISTS (
  SELECT 1 FROM dbo.owner_reminder_schedules WITH (TABLOCKX, HOLDLOCK)
  WHERE state = N'retrying' OR next_attempt_at IS NOT NULL OR last_provider_outcome IS NOT NULL
    OR last_provider_status_code IS NOT NULL OR last_provider IS NOT NULL
    OR recipient_count <> 0 OR accepted_recipient_count <> 0
)
  THROW 51000, 'Owner reminder delivery state must be retained before rollback', 1;

EXEC(N'
ALTER TRIGGER dbo.TR_approval_notification_registrations_terminalize_deliveries
ON dbo.approval_notification_registrations
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE a
    SET state = N''failed'', last_result = N''registration_removed'',
        completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
  FROM dbo.reply_notification_approval_deliveries a
  INNER JOIN deleted r
    ON a.device_reference = CONVERT(char(36), r.registration_id)
  WHERE a.state = N''sending'';

  UPDATE d
    SET state = N''failed'', last_result = N''registration_removed'',
        completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
        lease_owner = NULL, lease_until = NULL
  FROM dbo.reply_notification_deliveries d
  INNER JOIN deleted r
    ON d.device_reference = CONVERT(char(36), r.registration_id)
  WHERE d.state IN (N''pending'', N''sending'');

  DELETE registration
  FROM dbo.approval_notification_registrations registration
  INNER JOIN deleted removed
    ON removed.registration_id = registration.registration_id;
END;
');

DROP TABLE dbo.owner_reminder_deliveries;
DROP TABLE dbo.owner_reminder_delivery_snapshots;
ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT CK_owner_reminder_schedules_next_attempt;
ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT CK_owner_reminder_schedules_provider;
ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT CK_owner_reminder_schedules_provider_status;
ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT CK_owner_reminder_schedules_provider_name;
ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT CK_owner_reminder_schedules_recipients;
ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT DF_owner_reminder_schedules_accepted_recipient_count;
ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT DF_owner_reminder_schedules_recipient_count;
ALTER TABLE dbo.owner_reminder_schedules DROP COLUMN accepted_recipient_count;
ALTER TABLE dbo.owner_reminder_schedules DROP COLUMN recipient_count;
ALTER TABLE dbo.owner_reminder_schedules DROP COLUMN last_provider_status_code;
ALTER TABLE dbo.owner_reminder_schedules DROP COLUMN last_provider;
ALTER TABLE dbo.owner_reminder_schedules DROP COLUMN last_provider_outcome;
ALTER TABLE dbo.owner_reminder_schedules DROP COLUMN next_attempt_at;

ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT CK_owner_reminder_schedules_delivery;
ALTER TABLE dbo.owner_reminder_schedules ADD CONSTRAINT CK_owner_reminder_schedules_delivery CHECK (
  last_delivery IS NULL OR last_delivery IN (N'provider_accepted', N'failed', N'suppressed')
);
ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT CK_owner_reminder_schedules_reason;
ALTER TABLE dbo.owner_reminder_schedules ADD CONSTRAINT CK_owner_reminder_schedules_reason CHECK (
  reason IS NULL OR reason IN (
    N'cancelled', N'task_completed', N'task_missing', N'task_ambiguous',
    N'task_unavailable', N'quiet_hours', N'no_subscription', N'provider_unavailable',
    N'provider_rejected', N'verification_exhausted', N'retries_exhausted', N'missed_time'
  )
);
ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT CK_owner_reminder_schedules_state;
ALTER TABLE dbo.owner_reminder_schedules ADD CONSTRAINT CK_owner_reminder_schedules_state CHECK (
  state IN (N'scheduled', N'sending', N'completed', N'cancelled', N'failed', N'suppressed')
);
