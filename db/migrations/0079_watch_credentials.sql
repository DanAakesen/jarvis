CREATE TABLE dbo.watch_credentials (
  owner_object_id uniqueidentifier NOT NULL CONSTRAINT PK_watch_credentials PRIMARY KEY,
  credential_hash binary(32) NOT NULL,
  created_at datetime2(7) NOT NULL,
  expires_at datetime2(7) NOT NULL,
  CONSTRAINT CK_watch_credentials_lifetime CHECK (
    expires_at > created_at AND expires_at <= DATEADD(hour, 24, created_at)
  )
);
