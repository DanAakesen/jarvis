CREATE TABLE dbo.workspace_artifacts (
  id uniqueidentifier NOT NULL CONSTRAINT PK_workspace_artifacts PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  content_type nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  size_bytes int NOT NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_workspace_artifacts_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_workspace_artifacts_content_type CHECK (content_type IN (N'image/png', N'image/jpeg')),
  CONSTRAINT CK_workspace_artifacts_size CHECK (size_bytes BETWEEN 1 AND 5242880)
);

CREATE INDEX IX_workspace_artifacts_owner_created
  ON dbo.workspace_artifacts (owner_object_id, created_at DESC, id DESC);
