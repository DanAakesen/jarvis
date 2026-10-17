IF EXISTS (SELECT 1 FROM dbo.background_job_dismissals WITH (TABLOCKX,HOLDLOCK))
  THROW 51000, 'Background job dismissal preferences must be retained before reverting migration 0052.', 1;

DROP TABLE dbo.background_job_dismissals;
