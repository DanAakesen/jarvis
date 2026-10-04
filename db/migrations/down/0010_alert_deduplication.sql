DROP INDEX UX_activity_alert_key ON dbo.activity;
ALTER TABLE dbo.activity DROP COLUMN alert_key;
