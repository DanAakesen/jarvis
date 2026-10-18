CREATE TABLE dbo.proactive_reminders (
  id uniqueidentifier NOT NULL CONSTRAINT PK_proactive_reminders PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  reminder_key char(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  deadline_alert_key char(32) COLLATE Latin1_General_100_BIN2 NULL,
  fire_at datetime2(7) NOT NULL,
  due_at datetime2(7) NOT NULL,
  title nvarchar(80) NOT NULL,
  state nvarchar(16) NOT NULL CONSTRAINT DF_proactive_reminders_state DEFAULT N'pending',
  reason nvarchar(64) NULL,
  verify_attempts tinyint NOT NULL CONSTRAINT DF_proactive_reminders_verify_attempts DEFAULT 0,
  send_attempts tinyint NOT NULL CONSTRAINT DF_proactive_reminders_send_attempts DEFAULT 0,
  item_id uniqueidentifier NULL,
  sent_day_key char(10) NULL,
  planned_run_id uniqueidentifier NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_proactive_reminders_created_at DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(7) NOT NULL CONSTRAINT DF_proactive_reminders_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_proactive_reminders_key CHECK (LEN(reminder_key) = 32 AND reminder_key NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT CK_proactive_reminders_deadline_key CHECK (
    deadline_alert_key IS NULL OR
      (LEN(deadline_alert_key) = 32 AND deadline_alert_key NOT LIKE '%[^0-9a-f]%')
  ),
  CONSTRAINT CK_proactive_reminders_state CHECK (
    state IN (N'pending', N'sent', N'cancelled', N'expired', N'failed', N'suppressed')
  ),
  CONSTRAINT CK_proactive_reminders_day_key CHECK (
    sent_day_key IS NULL OR sent_day_key LIKE '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
  ),
  CONSTRAINT CK_proactive_reminders_reason CHECK (
    reason IS NULL OR reason IN (
      N'too_late', N'paused', N'no_subscription', N'todo_changed', N'already_alerted',
      N'daily_cap', N'unverified', N'provider_rejected', N'provider_unavailable'
    )
  )
);
CREATE UNIQUE INDEX UX_proactive_reminders_owner_key
  ON dbo.proactive_reminders (owner_object_id, reminder_key);
CREATE INDEX IX_proactive_reminders_owner_state_fire_at
  ON dbo.proactive_reminders (owner_object_id, state, fire_at);
CREATE INDEX IX_proactive_reminders_owner_day_state
  ON dbo.proactive_reminders (owner_object_id, sent_day_key, state);
