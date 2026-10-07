DROP TABLE dbo.workspace_html_artifact_versions;
ALTER TABLE dbo.workspace_html_artifacts
  DROP CONSTRAINT CK_workspace_html_artifacts_version;
ALTER TABLE dbo.workspace_html_artifacts
  DROP CONSTRAINT DF_workspace_html_artifacts_version,
    DF_workspace_html_artifacts_repair_attempted;
ALTER TABLE dbo.workspace_html_artifacts
  DROP COLUMN version_number, repair_attempted;
