CREATE TABLE dbo.reply_notification_approval_deliveries (
  confirmation_id char(43) NOT NULL
    CONSTRAINT FK_reply_notification_approval_deliveries_claims
      REFERENCES dbo.reply_notification_approval_claims (confirmation_id) ON DELETE CASCADE,
  device_reference char(36) COLLATE Latin1_General_100_BIN2 NOT NULL,
  registration_id uniqueidentifier NULL
    CONSTRAINT FK_reply_notification_approval_deliveries_registrations
      REFERENCES dbo.approval_notification_registrations (registration_id) ON DELETE SET NULL,
  state varchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  last_result varchar(32) COLLATE Latin1_General_100_BIN2 NULL,
  last_status_code int NULL,
  lease_until datetime2(3) NOT NULL,
  completed_at datetime2(3) NULL,
  created_at datetime2(7) NOT NULL
    CONSTRAINT DF_reply_notification_approval_deliveries_created_at DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(7) NOT NULL
    CONSTRAINT DF_reply_notification_approval_deliveries_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_reply_notification_approval_deliveries PRIMARY KEY (confirmation_id, device_reference),
  CONSTRAINT CK_reply_notification_approval_deliveries_state CHECK (
    state IN ('sending', 'accepted', 'failed', 'invalid_token')
  ),
  CONSTRAINT CK_reply_notification_approval_deliveries_status_code CHECK (
    last_status_code IS NULL OR last_status_code BETWEEN 100 AND 599
  )
);
CREATE INDEX IX_reply_notification_approval_deliveries_pending
  ON dbo.reply_notification_approval_deliveries (state, lease_until, registration_id);

ALTER TABLE dbo.reply_notification_deliveries
  DROP CONSTRAINT CK_reply_notification_deliveries_state;
ALTER TABLE dbo.reply_notification_deliveries
  ADD CONSTRAINT CK_reply_notification_deliveries_state CHECK (
    state IN ('pending', 'sending', 'accepted', 'failed', 'expired', 'invalid_token', 'suppressed')
  );
