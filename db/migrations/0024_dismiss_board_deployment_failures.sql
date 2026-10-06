CREATE TABLE dbo.deployment_failure_receipts (
  github_deployment_id bigint NOT NULL CONSTRAINT PK_deployment_failure_receipts PRIMARY KEY,
  CONSTRAINT CK_deployment_failure_receipts_id CHECK (github_deployment_id > 0)
);

UPDATE dbo.activity
SET dismissed_at = SYSUTCDATETIME()
WHERE kind = N'deployment_failure'
  AND title = N'Deployment failed: project-board'
  AND dismissed_at IS NULL;
