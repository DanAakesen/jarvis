ALTER TABLE dbo.owner_reminder_schedules
  ADD next_attempt_at datetime2(7) NULL,
      last_provider_outcome nvarchar(32) COLLATE Latin1_General_100_BIN2 NULL,
      last_provider_status_code int NULL,
      last_provider nvarchar(16) COLLATE Latin1_General_100_BIN2 NULL,
      recipient_count int NOT NULL
        CONSTRAINT DF_owner_reminder_schedules_recipient_count DEFAULT 0,
      accepted_recipient_count int NOT NULL
        CONSTRAINT DF_owner_reminder_schedules_accepted_recipient_count DEFAULT 0;

ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT CK_owner_reminder_schedules_state;
ALTER TABLE dbo.owner_reminder_schedules ADD CONSTRAINT CK_owner_reminder_schedules_state CHECK (
  state IN (N'scheduled', N'sending', N'retrying', N'completed', N'cancelled', N'failed', N'suppressed')
);
ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT CK_owner_reminder_schedules_reason;
ALTER TABLE dbo.owner_reminder_schedules ADD CONSTRAINT CK_owner_reminder_schedules_reason CHECK (
  reason IS NULL OR reason IN (
    N'cancelled', N'task_completed', N'task_missing', N'task_ambiguous', N'task_unavailable',
    N'quiet_hours', N'no_subscription', N'provider_unavailable', N'provider_rejected',
    N'apns_invalid_token', N'registration_removed', N'registration_expired',
    N'verification_exhausted', N'retries_exhausted', N'missed_time', N'rescheduled',
    N'delivery_failed', N'delivery_evidence_unavailable'
  )
);
ALTER TABLE dbo.owner_reminder_schedules DROP CONSTRAINT CK_owner_reminder_schedules_delivery;
ALTER TABLE dbo.owner_reminder_schedules ADD CONSTRAINT CK_owner_reminder_schedules_delivery CHECK (
  last_delivery IS NULL OR last_delivery IN (
    N'provider_accepted', N'retrying', N'failed', N'suppressed'
  )
);
-- The new columns are not resolvable by constraints in the same batch.
EXEC(N'
ALTER TABLE dbo.owner_reminder_schedules ADD CONSTRAINT CK_owner_reminder_schedules_next_attempt CHECK (
  (state = N''retrying'' AND next_attempt_at IS NOT NULL) OR
  (state <> N''retrying'' AND next_attempt_at IS NULL)
);
ALTER TABLE dbo.owner_reminder_schedules ADD CONSTRAINT CK_owner_reminder_schedules_provider CHECK (
  last_provider_outcome IS NULL OR last_provider_outcome IN (
    N''provider_accepted'', N''partial_acceptance'', N''in_progress'', N''provider_unavailable'',
    N''provider_rejected'', N''retry_exhausted'', N''apns_invalid_token'', N''registration_removed'',
    N''registration_expired'', N''delivery_expired'', N''no_subscription'', N''delivery_failed'',
    N''delivery_evidence_unavailable''
  )
);
ALTER TABLE dbo.owner_reminder_schedules ADD CONSTRAINT CK_owner_reminder_schedules_provider_status CHECK (
  last_provider_status_code IS NULL OR last_provider_status_code BETWEEN 100 AND 599
);
ALTER TABLE dbo.owner_reminder_schedules ADD CONSTRAINT CK_owner_reminder_schedules_provider_name CHECK (
  last_provider IS NULL OR last_provider IN (N''apns'', N''web_push'')
);
ALTER TABLE dbo.owner_reminder_schedules ADD CONSTRAINT CK_owner_reminder_schedules_recipients CHECK (
  recipient_count >= 0 AND accepted_recipient_count >= 0 AND accepted_recipient_count <= recipient_count
);
');

CREATE TABLE dbo.owner_reminder_delivery_snapshots (
  reminder_id uniqueidentifier NOT NULL
    CONSTRAINT FK_owner_reminder_delivery_snapshots_schedules
      REFERENCES dbo.owner_reminder_schedules (id),
  occurrence_at datetime2(7) NOT NULL,
  recipient_count int NOT NULL
    CONSTRAINT DF_owner_reminder_delivery_snapshots_recipient_count DEFAULT 0,
  created_at datetime2(7) NOT NULL
    CONSTRAINT DF_owner_reminder_delivery_snapshots_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_owner_reminder_delivery_snapshots PRIMARY KEY (reminder_id, occurrence_at),
  CONSTRAINT CK_owner_reminder_delivery_snapshots_recipient_count CHECK (recipient_count >= 0)
);

CREATE TABLE dbo.owner_reminder_deliveries (
  id uniqueidentifier NOT NULL CONSTRAINT PK_owner_reminder_deliveries PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  reminder_id uniqueidentifier NOT NULL
    CONSTRAINT FK_owner_reminder_deliveries_schedules
      REFERENCES dbo.owner_reminder_schedules (id),
  occurrence_at datetime2(7) NOT NULL,
  item_id uniqueidentifier NOT NULL,
  registration_id uniqueidentifier NULL
    CONSTRAINT FK_owner_reminder_deliveries_registrations
      REFERENCES dbo.approval_notification_registrations (registration_id) ON DELETE SET NULL,
  device_reference char(36) COLLATE Latin1_General_100_BIN2 NOT NULL,
  notification_id varchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  state varchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  attempt_count tinyint NOT NULL
    CONSTRAINT DF_owner_reminder_deliveries_attempt_count DEFAULT 0,
  last_result varchar(32) COLLATE Latin1_General_100_BIN2 NULL,
  last_status_code int NULL,
  next_attempt_at datetime2(3) NULL,
  expires_at datetime2(3) NOT NULL,
  last_attempt_at datetime2(3) NULL,
  completed_at datetime2(3) NULL,
  lease_owner uniqueidentifier NULL,
  lease_until datetime2(3) NULL,
  created_at datetime2(7) NOT NULL
    CONSTRAINT DF_owner_reminder_deliveries_created_at DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(7) NOT NULL
    CONSTRAINT DF_owner_reminder_deliveries_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_owner_reminder_deliveries_notification CHECK (
    LEN(notification_id) BETWEEN 1 AND 64 AND notification_id NOT LIKE '%[^A-Za-z0-9_.:-]%'
  ),
  CONSTRAINT CK_owner_reminder_deliveries_state CHECK (
    state IN (
      'pending', 'sending', 'retrying', 'accepted', 'failed', 'expired',
      'invalid_token', 'suppressed'
    )
  ),
  CONSTRAINT CK_owner_reminder_deliveries_attempt_count CHECK (attempt_count BETWEEN 0 AND 2),
  CONSTRAINT CK_owner_reminder_deliveries_status_code CHECK (
    last_status_code IS NULL OR last_status_code BETWEEN 100 AND 599
  ),
  CONSTRAINT CK_owner_reminder_deliveries_result CHECK (
    last_result IS NULL OR last_result IN (
      'provider_accepted', 'provider_unavailable', 'provider_rejected', 'retry_exhausted',
      'apns_invalid_token', 'registration_removed', 'registration_expired', 'delivery_expired',
      'cancelled', 'rescheduled', 'delivery_evidence_unavailable'
    )
  ),
  CONSTRAINT CK_owner_reminder_deliveries_lease CHECK (
    (state = 'sending' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL) OR
    (state <> 'sending' AND lease_owner IS NULL AND lease_until IS NULL)
  ),
  CONSTRAINT CK_owner_reminder_deliveries_next_attempt CHECK (
    (state IN ('pending', 'retrying') AND next_attempt_at IS NOT NULL) OR
    (state NOT IN ('pending', 'retrying') AND next_attempt_at IS NULL)
  )
);
CREATE UNIQUE INDEX UX_owner_reminder_deliveries_occurrence_device
  ON dbo.owner_reminder_deliveries (reminder_id, occurrence_at, device_reference);
CREATE INDEX IX_owner_reminder_deliveries_due
  ON dbo.owner_reminder_deliveries (owner_object_id, reminder_id, occurrence_at, state, next_attempt_at, lease_until);
CREATE INDEX IX_owner_reminder_deliveries_registration
  ON dbo.owner_reminder_deliveries (registration_id, state, device_reference);

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

  UPDATE o
    SET state = N''failed'', last_result = N''registration_removed'',
        completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(),
        next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
  FROM dbo.owner_reminder_deliveries o
  INNER JOIN deleted r
    ON o.device_reference = CONVERT(char(36), r.registration_id)
  WHERE o.state IN (N''pending'', N''sending'', N''retrying'');

  DELETE registration
  FROM dbo.approval_notification_registrations registration
  INNER JOIN deleted removed
    ON removed.registration_id = registration.registration_id;
END;
');
