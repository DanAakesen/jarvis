CREATE TABLE dbo.owner_sessions (
  session_id binary(16) NOT NULL
    CONSTRAINT PK_owner_sessions PRIMARY KEY,
  secret_hash binary(32) NOT NULL,
  owner_object_id uniqueidentifier NOT NULL,
  display_name nvarchar(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  device_label nvarchar(40) COLLATE Latin1_General_100_BIN2 NULL,
  created_at datetime2(3) NOT NULL,
  last_used_at datetime2(3) NOT NULL,
  idle_expires_at datetime2(3) NOT NULL,
  absolute_expires_at datetime2(3) NOT NULL,
  revoked_at datetime2(3) NULL,
  CONSTRAINT CK_owner_sessions_display_name CHECK (LEN(display_name) BETWEEN 1 AND 200),
  CONSTRAINT CK_owner_sessions_device_label CHECK (device_label IS NULL OR LEN(device_label) BETWEEN 1 AND 40),
  CONSTRAINT CK_owner_sessions_lifetime CHECK (
    idle_expires_at <= absolute_expires_at AND
    created_at < absolute_expires_at
  )
);

CREATE INDEX IX_owner_sessions_owner_last_used
  ON dbo.owner_sessions (owner_object_id, last_used_at DESC);
