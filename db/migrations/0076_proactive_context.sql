ALTER TABLE dbo.proactive_source_status DROP CONSTRAINT CK_proactive_source_status_source;
ALTER TABLE dbo.proactive_source_status ADD CONSTRAINT CK_proactive_source_status_source CHECK
  (source_id IN (N'todos',N'calendar',N'mail',N'weather',N'factory',N'news',N'travel',N'x',N'health',N'nutrition',N'notes',N'memory'));
ALTER TABLE dbo.proactive_alerts DROP CONSTRAINT CK_proactive_alerts_class;
ALTER TABLE dbo.proactive_alerts ADD CONSTRAINT CK_proactive_alerts_class CHECK
  (class IN (N'deadline_24h',N'calendar_clash',N'travel_disruption',N'insight'));
