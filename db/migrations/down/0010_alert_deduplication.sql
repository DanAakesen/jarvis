EXEC(N'DROP INDEX UX_activity_alert_key ON dbo.activity;');
EXEC(N'ALTER TABLE dbo.activity DROP COLUMN alert_key;');
