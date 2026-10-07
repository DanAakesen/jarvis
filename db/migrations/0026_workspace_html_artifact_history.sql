ALTER TABLE dbo.workspace_html_artifacts
  ADD version_number int NOT NULL
    CONSTRAINT DF_workspace_html_artifacts_version DEFAULT 1,
  repair_attempted bit NOT NULL
    CONSTRAINT DF_workspace_html_artifacts_repair_attempted DEFAULT 0,
  CONSTRAINT CK_workspace_html_artifacts_version CHECK (version_number > 0);

CREATE TABLE dbo.workspace_html_artifact_versions (
  artifact_id uniqueidentifier NOT NULL,
  version_number int NOT NULL,
  title nvarchar(200) NOT NULL,
  html nvarchar(max) NOT NULL,
  size_bytes int NOT NULL,
  sources_json nvarchar(max) NOT NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_workspace_html_artifact_versions_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_workspace_html_artifact_versions PRIMARY KEY (artifact_id, version_number),
  CONSTRAINT FK_workspace_html_artifact_versions_artifact FOREIGN KEY (artifact_id)
    REFERENCES dbo.workspace_html_artifacts (id) ON DELETE CASCADE,
  CONSTRAINT CK_workspace_html_artifact_versions_size CHECK (size_bytes BETWEEN 1 AND 524288),
  CONSTRAINT CK_workspace_html_artifact_versions_sources CHECK (ISJSON(sources_json) = 1),
  CONSTRAINT CK_workspace_html_artifact_versions_version CHECK (version_number > 0)
);
