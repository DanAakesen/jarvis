CREATE TABLE dbo.approval_notification_token_tombstones (
  owner_object_id uniqueidentifier NOT NULL,
  device_token_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  reason varchar(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  invalidated_at datetime2(7) NOT NULL
    CONSTRAINT DF_approval_notification_token_tombstones_invalidated_at DEFAULT SYSUTCDATETIME(),
  last_rejected_at datetime2(7) NOT NULL
    CONSTRAINT DF_approval_notification_token_tombstones_last_rejected_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_approval_notification_token_tombstones PRIMARY KEY (owner_object_id, device_token_hash),
  CONSTRAINT CK_approval_notification_token_tombstones_reason CHECK (
    reason = 'apns_invalid_token'
  )
);
