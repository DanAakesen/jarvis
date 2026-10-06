UPDATE dbo.activity
SET dismissed_at = SYSUTCDATETIME()
WHERE kind = N'deployment_failure'
  AND title = N'Deployment failed: project-board'
  AND dismissed_at IS NULL;
