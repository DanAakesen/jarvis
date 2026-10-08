ALTER TABLE dbo.background_jobs ADD retry_input nvarchar(max) NULL;
ALTER TABLE dbo.background_jobs ADD retry_job_id nvarchar(36) COLLATE Latin1_General_100_BIN2 NULL;
