UPDATE dbo.activity
SET github_app_scope_key = NULL, recovered_at = NULL
WHERE alert_key LIKE N'credential:github-app:failed:%'
  AND (github_app_scope_key IS NOT NULL OR recovered_at IS NOT NULL);

DROP TABLE dbo.github_app_mint_status;
ALTER TABLE dbo.activity DROP CONSTRAINT CK_activity_github_app_recovered;
ALTER TABLE dbo.activity DROP CONSTRAINT CK_activity_github_app_scope;
ALTER TABLE dbo.activity DROP COLUMN recovered_at, github_app_scope_key;
