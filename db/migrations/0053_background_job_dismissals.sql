CREATE TABLE dbo.background_job_dismissals (
  owner_object_id uniqueidentifier NOT NULL,
  job_id nvarchar(36) COLLATE Latin1_General_100_BIN2 NOT NULL,
  dismissed_at datetime2(7) NOT NULL CONSTRAINT DF_background_job_dismissals_dismissed_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_background_job_dismissals PRIMARY KEY (owner_object_id, job_id),
  CONSTRAINT FK_background_job_dismissals_job FOREIGN KEY (job_id)
    REFERENCES dbo.background_jobs (job_id) ON DELETE CASCADE
);

CREATE INDEX IX_background_job_dismissals_job_id ON dbo.background_job_dismissals (job_id);
