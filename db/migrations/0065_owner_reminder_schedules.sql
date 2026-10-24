CREATE TABLE dbo.owner_reminder_schedules (
  id uniqueidentifier NOT NULL CONSTRAINT PK_owner_reminder_schedules PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  idempotency_key char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  task_identity char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  task_title nvarchar(300) NOT NULL,
  fire_at datetime2(7) NOT NULL,
  local_time char(5) COLLATE Latin1_General_100_BIN2 NOT NULL,
  anchor_date char(10) COLLATE Latin1_General_100_BIN2 NULL,
  cadence nvarchar(8) COLLATE Latin1_General_100_BIN2 NULL,
  until_task_done bit NOT NULL CONSTRAINT DF_owner_reminder_schedules_until_done DEFAULT 0,
  state nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT DF_owner_reminder_schedules_state DEFAULT N'scheduled',
  reason nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  verify_attempts tinyint NOT NULL CONSTRAINT DF_owner_reminder_schedules_verify_attempts DEFAULT 0,
  send_attempts tinyint NOT NULL CONSTRAINT DF_owner_reminder_schedules_send_attempts DEFAULT 0,
  item_id uniqueidentifier NULL,
  last_fire_at datetime2(7) NULL,
  last_delivery nvarchar(32) COLLATE Latin1_General_100_BIN2 NULL,
  claim_token uniqueidentifier NULL,
  lease_until datetime2(7) NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_owner_reminder_schedules_created_at DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(7) NOT NULL CONSTRAINT DF_owner_reminder_schedules_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_owner_reminder_schedules_hashes CHECK (
    LEN(idempotency_key) = 64 AND idempotency_key NOT LIKE '%[^0-9a-f]%' AND
    LEN(task_identity) = 64 AND task_identity NOT LIKE '%[^0-9a-f]%'
  ),
  CONSTRAINT CK_owner_reminder_schedules_title CHECK (LEN(task_title) BETWEEN 1 AND 300),
  CONSTRAINT CK_owner_reminder_schedules_local_time CHECK (
    local_time LIKE '[0-1][0-9]:[0-5][0-9]' OR local_time LIKE '2[0-3]:[0-5][0-9]'
  ),
  CONSTRAINT CK_owner_reminder_schedules_cadence CHECK (cadence IS NULL OR cadence IN (N'daily', N'weekly')),
  CONSTRAINT CK_owner_reminder_schedules_anchor CHECK (
    (cadence IS NULL AND anchor_date IS NULL) OR
    (cadence IS NOT NULL AND anchor_date LIKE '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
  ),
  CONSTRAINT CK_owner_reminder_schedules_until_done CHECK (until_task_done = 0 OR cadence IS NOT NULL),
  CONSTRAINT CK_owner_reminder_schedules_state CHECK (
    state IN (N'scheduled', N'sending', N'completed', N'cancelled', N'failed', N'suppressed')
  ),
  CONSTRAINT CK_owner_reminder_schedules_reason CHECK (
    reason IS NULL OR reason IN (
      N'cancelled', N'task_completed', N'task_missing', N'task_ambiguous',
      N'task_unavailable', N'quiet_hours', N'no_subscription', N'provider_unavailable',
      N'provider_rejected', N'verification_exhausted', N'retries_exhausted', N'missed_time'
    )
  ),
  CONSTRAINT CK_owner_reminder_schedules_delivery CHECK (
    last_delivery IS NULL OR last_delivery IN (N'provider_accepted', N'failed', N'suppressed')
  ),
  CONSTRAINT CK_owner_reminder_schedules_claim CHECK (
    (state = N'sending' AND claim_token IS NOT NULL AND lease_until IS NOT NULL) OR
    (state <> N'sending' AND claim_token IS NULL AND lease_until IS NULL)
  )
);
CREATE UNIQUE INDEX UX_owner_reminder_schedules_owner_idempotency
  ON dbo.owner_reminder_schedules (owner_object_id, idempotency_key);
CREATE INDEX IX_owner_reminder_schedules_owner_state_fire_at
  ON dbo.owner_reminder_schedules (owner_object_id, state, fire_at);
CREATE INDEX IX_owner_reminder_schedules_owner_task_state_fire
  ON dbo.owner_reminder_schedules (owner_object_id, task_identity, state, fire_at);

ALTER TABLE dbo.proactive_items ADD owner_requested bit NOT NULL
  CONSTRAINT DF_proactive_items_owner_requested DEFAULT 0;
