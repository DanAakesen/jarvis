-- P6-03 (#64): index committed task-event archive blobs.
CREATE TABLE dbo.task_event_archives (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_task_event_archives PRIMARY KEY,
  task_id bigint NOT NULL CONSTRAINT FK_task_event_archives_tasks REFERENCES dbo.tasks (id),
  first_at datetime2(7) NOT NULL,
  first_event_id bigint NOT NULL,
  blob_name nvarchar(512) NOT NULL,
  event_count int NOT NULL,
  archived_at datetime2(7) NOT NULL CONSTRAINT DF_task_event_archives_archived_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_task_event_archives_blob_name UNIQUE (blob_name),
  CONSTRAINT UQ_task_event_archives_task_first_event UNIQUE (task_id, first_event_id),
  CONSTRAINT CK_task_event_archives_event_count CHECK (event_count > 0)
);
CREATE INDEX IX_task_event_archives_task_first_at
  ON dbo.task_event_archives (task_id, first_at, first_event_id)
  INCLUDE (blob_name, event_count);
