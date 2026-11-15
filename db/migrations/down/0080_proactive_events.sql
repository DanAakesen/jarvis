IF EXISTS (SELECT 1 FROM dbo.proactive_outreach WITH (TABLOCKX, HOLDLOCK))
BEGIN
  THROW 51000, 'Proactive outreach and its thumbs feedback are durable evidence; cannot roll back while rows exist', 1;
END;

DROP TABLE dbo.proactive_outreach;
DROP TABLE dbo.proactive_events;
