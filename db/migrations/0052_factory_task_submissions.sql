CREATE TABLE dbo.factory_task_submissions (
  submission_id uniqueidentifier NOT NULL PRIMARY KEY,
  fingerprint varchar(64) NOT NULL,
  status_code int NULL,
  response nvarchar(max) NULL,
  created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
