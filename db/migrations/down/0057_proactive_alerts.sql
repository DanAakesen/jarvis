IF EXISTS (SELECT 1 FROM dbo.proactive_alerts WITH (TABLOCKX, HOLDLOCK))
BEGIN
  THROW 51000, 'Proactive alert delivery records are durable evidence; cannot roll back while rows exist', 1;
END;

DROP INDEX IX_proactive_alerts_owner_day_status ON dbo.proactive_alerts;
DROP INDEX UX_proactive_alerts_owner_alert_key ON dbo.proactive_alerts;
DROP TABLE dbo.proactive_alerts;
