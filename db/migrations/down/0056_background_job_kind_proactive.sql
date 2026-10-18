IF EXISTS (SELECT 1 FROM dbo.background_jobs WITH (TABLOCKX, HOLDLOCK) WHERE kind = N'proactive')
  THROW 51000, 'Proactive background jobs are durable history; cannot roll back while rows exist', 1;

ALTER TABLE dbo.background_jobs DROP CONSTRAINT CK_background_jobs_kind;
ALTER TABLE dbo.background_jobs ADD CONSTRAINT CK_background_jobs_kind CHECK (
  kind IN (N'research', N'image', N'html_app', N'embedding')
);
