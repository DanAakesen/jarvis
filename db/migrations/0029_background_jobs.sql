CREATE TABLE dbo.background_jobs (
  job_id nvarchar(36) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_background_jobs PRIMARY KEY,
  kind nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  title nvarchar(80) NOT NULL,
  status nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  step tinyint NOT NULL,
  steps tinyint NOT NULL,
  detail nvarchar(120) NULL,
  view_id nvarchar(200) NULL,
  started_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  CONSTRAINT CK_background_jobs_job_id CHECK (
    LEN(job_id) = 36 AND TRY_CONVERT(uniqueidentifier, job_id) IS NOT NULL AND job_id = LOWER(job_id)
  ),
  CONSTRAINT CK_background_jobs_kind CHECK (kind IN (N'research', N'image', N'html_app')),
  CONSTRAINT CK_background_jobs_status CHECK (status IN (N'running', N'done', N'failed', N'cancelled')),
  CONSTRAINT CK_background_jobs_progress CHECK (steps BETWEEN 1 AND 20 AND step BETWEEN 0 AND steps)
);

CREATE INDEX IX_background_jobs_started_at ON dbo.background_jobs (started_at DESC);

CREATE TABLE dbo.background_job_steps (
  id bigint IDENTITY(1, 1) NOT NULL CONSTRAINT PK_background_job_steps PRIMARY KEY,
  job_id nvarchar(36) COLLATE Latin1_General_100_BIN2 NOT NULL,
  status nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  step tinyint NOT NULL,
  detail nvarchar(120) NULL,
  view_id nvarchar(200) NULL,
  updated_at datetime2(7) NOT NULL,
  CONSTRAINT FK_background_job_steps_job FOREIGN KEY (job_id)
    REFERENCES dbo.background_jobs (job_id) ON DELETE CASCADE
);

CREATE INDEX IX_background_job_steps_job_id ON dbo.background_job_steps (job_id, id);
