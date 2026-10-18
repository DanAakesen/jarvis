ALTER TABLE dbo.background_jobs DROP CONSTRAINT CK_background_jobs_kind;
ALTER TABLE dbo.background_jobs ADD CONSTRAINT CK_background_jobs_kind CHECK (
  kind IN (N'research', N'image', N'html_app', N'embedding', N'proactive')
);
