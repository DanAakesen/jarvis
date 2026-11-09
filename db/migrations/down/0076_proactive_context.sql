IF EXISTS (SELECT 1 FROM dbo.proactive_source_status WHERE source_id IN(N'health',N'nutrition',N'notes',N'memory'))
  OR EXISTS (SELECT 1 FROM dbo.proactive_alerts WHERE class=N'insight')
  THROW 51000, 'Retain proactive context history; downgrade is blocked while new source or insight rows exist.', 1;
ALTER TABLE dbo.proactive_source_status DROP CONSTRAINT CK_proactive_source_status_source;
ALTER TABLE dbo.proactive_source_status ADD CONSTRAINT CK_proactive_source_status_source CHECK
  (source_id IN(N'todos',N'calendar',N'mail',N'weather',N'factory',N'news',N'travel',N'x'));
ALTER TABLE dbo.proactive_alerts DROP CONSTRAINT CK_proactive_alerts_class;
ALTER TABLE dbo.proactive_alerts ADD CONSTRAINT CK_proactive_alerts_class CHECK
  (class IN(N'deadline_24h',N'calendar_clash',N'travel_disruption'));
