CREATE TABLE dbo.task_status_notifications (
  task_id bigint NOT NULL CONSTRAINT FK_task_status_notifications_tasks REFERENCES dbo.tasks (id),
  state nvarchar(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_task_status_notifications_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_task_status_notifications PRIMARY KEY (task_id, state),
  CONSTRAINT CK_task_status_notifications_state CHECK (state IN
    (N'Done', N'NeedsAttention', N'Cancelled', N'pull_request_opened'))
);
