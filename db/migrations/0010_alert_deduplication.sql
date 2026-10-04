ALTER TABLE dbo.activity ADD alert_key nvarchar(200) COLLATE Latin1_General_100_BIN2 NULL;
CREATE UNIQUE INDEX UX_activity_alert_key ON dbo.activity (alert_key) WHERE alert_key IS NOT NULL;
