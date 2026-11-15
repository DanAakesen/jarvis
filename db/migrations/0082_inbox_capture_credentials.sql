CREATE TABLE dbo.inbox_capture_credentials (
  credential_hash binary(32) NOT NULL,
  owner_object_id uniqueidentifier NOT NULL,
  label nvarchar(40) NOT NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_inbox_capture_credentials_created DEFAULT SYSUTCDATETIME(),
  last_used_at datetime2(7) NULL,
  CONSTRAINT PK_inbox_capture_credentials PRIMARY KEY (credential_hash),
  CONSTRAINT CK_inbox_capture_credentials_label CHECK (LEN(LTRIM(RTRIM(label))) > 0)
);
CREATE INDEX IX_inbox_capture_credentials_owner ON dbo.inbox_capture_credentials (owner_object_id, created_at);
