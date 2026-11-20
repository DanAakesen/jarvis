ALTER TABLE dbo.approval_notification_registrations
  ADD registration_id uniqueidentifier NULL;
UPDATE dbo.approval_notification_registrations SET registration_id = NEWID();
ALTER TABLE dbo.approval_notification_registrations
  ALTER COLUMN registration_id uniqueidentifier NOT NULL;
ALTER TABLE dbo.approval_notification_registrations
  ADD CONSTRAINT DF_approval_notification_registrations_id DEFAULT NEWID() FOR registration_id;
ALTER TABLE dbo.approval_notification_registrations
  ADD CONSTRAINT UQ_approval_notification_registrations_id UNIQUE (registration_id);

CREATE TABLE dbo.reply_notification_approval_claims (
  confirmation_id char(43) NOT NULL CONSTRAINT PK_reply_notification_approval_claims PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  turn_message_id bigint NULL
    CONSTRAINT FK_reply_notification_approval_claims_messages REFERENCES dbo.messages (id),
  expires_at datetime2(3) NOT NULL,
  created_at datetime2(7) NOT NULL
    CONSTRAINT DF_reply_notification_approval_claims_created_at DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_reply_notification_approval_claims_owner_turn
  ON dbo.reply_notification_approval_claims (owner_object_id, turn_message_id, expires_at);

CREATE TABLE dbo.reply_notification_deliveries (
  id uniqueidentifier NOT NULL CONSTRAINT PK_reply_notification_deliveries PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  jarvis_session_id bigint NOT NULL
    CONSTRAINT FK_reply_notification_deliveries_sessions REFERENCES dbo.jarvis_sessions (id),
  message_id bigint NOT NULL
    CONSTRAINT FK_reply_notification_deliveries_messages REFERENCES dbo.messages (id),
  turn_message_id bigint NULL
    CONSTRAINT FK_reply_notification_deliveries_turn_messages REFERENCES dbo.messages (id),
  registration_id uniqueidentifier NULL
    CONSTRAINT FK_reply_notification_deliveries_registrations
      REFERENCES dbo.approval_notification_registrations (registration_id) ON DELETE SET NULL,
  device_reference char(36) COLLATE Latin1_General_100_BIN2 NOT NULL,
  notification_id varchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  preview nvarchar(160) NOT NULL,
  evidence_json nvarchar(max) NULL,
  state varchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  attempt_count int NOT NULL CONSTRAINT DF_reply_notification_deliveries_attempt_count DEFAULT 0,
  last_result varchar(32) COLLATE Latin1_General_100_BIN2 NULL,
  last_status_code int NULL,
  next_attempt_at datetime2(3) NOT NULL,
  expires_at datetime2(3) NOT NULL,
  last_attempt_at datetime2(3) NULL,
  completed_at datetime2(3) NULL,
  lease_owner uniqueidentifier NULL,
  lease_until datetime2(3) NULL,
  created_at datetime2(7) NOT NULL
    CONSTRAINT DF_reply_notification_deliveries_created_at DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(7) NOT NULL
    CONSTRAINT DF_reply_notification_deliveries_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_reply_notification_deliveries_preview CHECK (LEN(preview) BETWEEN 1 AND 160),
  CONSTRAINT CK_reply_notification_deliveries_evidence CHECK (
    evidence_json IS NULL OR ISJSON(evidence_json) = 1
  ),
  CONSTRAINT CK_reply_notification_deliveries_state CHECK (
    state IN ('pending', 'sending', 'accepted', 'failed', 'expired', 'invalid_token')
  ),
  CONSTRAINT CK_reply_notification_deliveries_attempt_count CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT CK_reply_notification_deliveries_status_code CHECK (
    last_status_code IS NULL OR last_status_code BETWEEN 100 AND 599
  ),
  CONSTRAINT CK_reply_notification_deliveries_window CHECK (expires_at >= created_at),
  CONSTRAINT CK_reply_notification_deliveries_lease CHECK (
    (lease_owner IS NULL AND lease_until IS NULL)
    OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL)
  )
);
CREATE UNIQUE INDEX UX_reply_notification_deliveries_message_registration
  ON dbo.reply_notification_deliveries (message_id, registration_id)
  WHERE registration_id IS NOT NULL;
CREATE INDEX IX_reply_notification_deliveries_due
  ON dbo.reply_notification_deliveries (owner_object_id, state, next_attempt_at, lease_until, expires_at);
CREATE INDEX IX_reply_notification_deliveries_diagnostics
  ON dbo.reply_notification_deliveries (owner_object_id, completed_at, state);
