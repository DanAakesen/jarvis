CREATE TABLE dbo.watch_task_submissions (
  owner_object_id uniqueidentifier NOT NULL,
  submission_id uniqueidentifier NOT NULL,
  request_hash char(64) NOT NULL,
  resolved_json nvarchar(max) NOT NULL,
  result_json nvarchar(max) NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_watch_task_submissions_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_watch_task_submissions PRIMARY KEY (owner_object_id, submission_id),
  CONSTRAINT CK_watch_task_submissions_resolved CHECK (ISJSON(resolved_json)=1 AND DATALENGTH(resolved_json)<=32768),
  CONSTRAINT CK_watch_task_submissions_result CHECK (result_json IS NULL OR (ISJSON(result_json)=1 AND DATALENGTH(result_json)<=32768))
);
