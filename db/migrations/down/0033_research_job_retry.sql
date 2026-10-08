EXEC(N'IF EXISTS (SELECT 1 FROM dbo.background_jobs WHERE retry_input IS NOT NULL OR retry_job_id IS NOT NULL)
  THROW 51000, ''Research retry metadata must be retained before reverting migration 0033.'', 1;');

ALTER TABLE dbo.background_jobs DROP COLUMN retry_input, retry_job_id;
