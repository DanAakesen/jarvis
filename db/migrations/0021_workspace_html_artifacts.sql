CREATE TABLE dbo.workspace_html_artifacts (
  id uniqueidentifier NOT NULL CONSTRAINT PK_workspace_html_artifacts PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  title nvarchar(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  html nvarchar(max) NOT NULL,
  sources_json nvarchar(max) NOT NULL,
  size_bytes int NOT NULL,
  pinned bit NOT NULL CONSTRAINT DF_workspace_html_artifacts_pinned DEFAULT 1,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_workspace_html_artifacts_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_workspace_html_artifacts_size CHECK (size_bytes BETWEEN 1 AND 524288),
  CONSTRAINT CK_workspace_html_artifacts_pinned CHECK (pinned = 1),
  CONSTRAINT CK_workspace_html_artifacts_sources CHECK (ISJSON(sources_json, ARRAY) = 1)
);

CREATE INDEX IX_workspace_html_artifacts_owner_created
  ON dbo.workspace_html_artifacts (owner_object_id, pinned, created_at DESC, id DESC);
