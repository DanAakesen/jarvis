UPDATE dbo.activity
SET dismissed_at = COALESCE(dismissed_at, SYSUTCDATETIME())
WHERE alert_key LIKE N'notification:%' AND kind = N'success' AND dismissed_at IS NULL;
