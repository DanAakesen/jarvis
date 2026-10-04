-- P2-12 (#38): usage by task, session, agent, and metric.

CREATE TABLE dbo.usage (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_usage PRIMARY KEY,
  task_id bigint NULL CONSTRAINT FK_usage_tasks REFERENCES dbo.tasks (id),
  project_id bigint NULL CONSTRAINT FK_usage_projects REFERENCES dbo.projects (id),
  sandbox_session_id bigint NULL CONSTRAINT FK_usage_sandbox_sessions REFERENCES dbo.sandbox_sessions (id),
  jarvis_session_id bigint NULL CONSTRAINT FK_usage_jarvis_sessions REFERENCES dbo.jarvis_sessions (id),
  source nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  metric nvarchar(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  quantity decimal(19,6) NOT NULL,
  cost_dkk decimal(12,4) NULL,
  source_event_id nvarchar(300) NULL,
  at datetime2(7) NOT NULL CONSTRAINT DF_usage_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_usage_source_metric CHECK (
    (source = N'sandbox' AND metric = N'minutes') OR
    (source IN (N'codex', N'copilot') AND metric IN (N'turns', N'input_tokens', N'output_tokens', N'premium_requests')) OR
    (source = N'jarvis_model' AND metric IN (N'input_tokens', N'output_tokens')) OR
    (source = N'voice' AND metric = N'minutes')
  ),
  CONSTRAINT CK_usage_quantity CHECK (quantity >= 0),
  CONSTRAINT CK_usage_cost_dkk CHECK (cost_dkk IS NULL OR cost_dkk >= 0),
  CONSTRAINT CK_usage_source_event_id CHECK (source_event_id IS NULL OR LEN(source_event_id) > 0)
);
CREATE INDEX IX_usage_task_id ON dbo.usage (task_id, at)
  INCLUDE (source, metric, quantity, cost_dkk, sandbox_session_id);
CREATE INDEX IX_usage_project_id_at ON dbo.usage (project_id, at)
  INCLUDE (source, metric, quantity, cost_dkk);
CREATE INDEX IX_usage_sandbox_session_id ON dbo.usage (sandbox_session_id)
  WHERE sandbox_session_id IS NOT NULL;
CREATE INDEX IX_usage_jarvis_session_id ON dbo.usage (jarvis_session_id)
  WHERE jarvis_session_id IS NOT NULL;
CREATE UNIQUE INDEX UX_usage_source_event
  ON dbo.usage (task_id, source, metric, source_event_id)
  WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX UX_usage_sandbox_session_metric
  ON dbo.usage (sandbox_session_id, metric)
  WHERE source = N'sandbox' AND sandbox_session_id IS NOT NULL;
