-- P2-01 (#27): data-model groups 4 and 6. Reverse with down/0002_sandbox_operations.sql.

CREATE TABLE dbo.sandbox_sessions (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_sandbox_sessions PRIMARY KEY,
  task_id bigint NOT NULL CONSTRAINT FK_sandbox_sessions_tasks REFERENCES dbo.tasks (id),
  foundry_session_id nvarchar(255) COLLATE Latin1_General_100_BIN2 NOT NULL,
  agent_version nvarchar(100) NOT NULL,
  size nvarchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL,
  image nvarchar(255) NOT NULL,
  status nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  started_at datetime2(7) NOT NULL CONSTRAINT DF_sandbox_sessions_started_at DEFAULT SYSUTCDATETIME(),
  last_heartbeat_at datetime2(7) NULL,
  last_event_at datetime2(7) NULL,
  ended_at datetime2(7) NULL,
  end_reason nvarchar(16) COLLATE Latin1_General_100_BIN2 NULL,
  cost_estimate_dkk decimal(12,4) NOT NULL CONSTRAINT DF_sandbox_sessions_cost_estimate_dkk DEFAULT 0,
  CONSTRAINT UQ_sandbox_sessions_foundry_session_id UNIQUE (foundry_session_id),
  CONSTRAINT CK_sandbox_sessions_foundry_session_id CHECK (LEN(foundry_session_id) > 0),
  CONSTRAINT CK_sandbox_sessions_agent_version CHECK (LEN(agent_version) > 0),
  CONSTRAINT CK_sandbox_sessions_image CHECK (LEN(image) > 0),
  CONSTRAINT CK_sandbox_sessions_size CHECK (size IN (N'1x2', N'2x4')),
  CONSTRAINT CK_sandbox_sessions_status CHECK (status IN (N'Starting', N'Active', N'Idle', N'Crashed', N'Ended')),
  CONSTRAINT CK_sandbox_sessions_end_reason CHECK (end_reason IS NULL OR end_reason IN (N'done', N'cancelled', N'crashed', N'idle')),
  CONSTRAINT CK_sandbox_sessions_ended_at CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT CK_sandbox_sessions_heartbeat CHECK (last_heartbeat_at IS NULL OR last_heartbeat_at >= started_at),
  CONSTRAINT CK_sandbox_sessions_last_event CHECK (last_event_at IS NULL OR last_event_at >= started_at),
  CONSTRAINT CK_sandbox_sessions_cost_estimate_dkk CHECK (cost_estimate_dkk >= 0)
);
CREATE INDEX IX_sandbox_sessions_task_id_status ON dbo.sandbox_sessions (task_id, status);

CREATE TABLE dbo.sandbox_turns (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_sandbox_turns PRIMARY KEY,
  sandbox_session_id bigint NOT NULL CONSTRAINT FK_sandbox_turns_sandbox_sessions REFERENCES dbo.sandbox_sessions (id),
  invocation_id nvarchar(255) NOT NULL,
  mode nvarchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL,
  acp_session_id nvarchar(255) NOT NULL,
  status nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  started_at datetime2(7) NOT NULL CONSTRAINT DF_sandbox_turns_started_at DEFAULT SYSUTCDATETIME(),
  ended_at datetime2(7) NULL,
  CONSTRAINT CK_sandbox_turns_mode CHECK (mode IN (N'task', N'steer', N'pause', N'resume')),
  CONSTRAINT CK_sandbox_turns_status CHECK (status IN (N'running', N'completed', N'cancelled', N'failed')),
  CONSTRAINT CK_sandbox_turns_invocation_id CHECK (LEN(invocation_id) > 0),
  CONSTRAINT CK_sandbox_turns_acp_session_id CHECK (LEN(acp_session_id) > 0),
  CONSTRAINT CK_sandbox_turns_ended_at CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX IX_sandbox_turns_sandbox_session_id_started_at ON dbo.sandbox_turns (sandbox_session_id, started_at);

CREATE TABLE dbo.artifacts (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_artifacts PRIMARY KEY,
  task_id bigint NOT NULL CONSTRAINT FK_artifacts_tasks REFERENCES dbo.tasks (id),
  kind nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  blob_path nvarchar(1024) NOT NULL,
  size_bytes int NOT NULL,
  at datetime2(7) NOT NULL CONSTRAINT DF_artifacts_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_artifacts_kind CHECK (kind IN (N'log', N'transcript', N'screenshot', N'ci_log')),
  CONSTRAINT CK_artifacts_blob_path CHECK (LEN(blob_path) > 0),
  CONSTRAINT CK_artifacts_size_bytes CHECK (size_bytes >= 0)
);
CREATE INDEX IX_artifacts_task_id_at ON dbo.artifacts (task_id, at);

CREATE TABLE dbo.webhook_deliveries (
  delivery_id nvarchar(100) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_webhook_deliveries PRIMARY KEY,
  event nvarchar(64) NOT NULL,
  received_at datetime2(7) NOT NULL CONSTRAINT DF_webhook_deliveries_received_at DEFAULT SYSUTCDATETIME(),
  processed_at datetime2(7) NULL,
  outcome nvarchar(8) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT CK_webhook_deliveries_delivery_id CHECK (LEN(delivery_id) > 0),
  CONSTRAINT CK_webhook_deliveries_event CHECK (LEN(event) > 0),
  CONSTRAINT CK_webhook_deliveries_outcome CHECK (outcome IS NULL OR outcome IN (N'ok', N'ignored', N'error')),
  CONSTRAINT CK_webhook_deliveries_processing CHECK ((processed_at IS NULL AND outcome IS NULL) OR (processed_at IS NOT NULL AND outcome IS NOT NULL)),
  CONSTRAINT CK_webhook_deliveries_processed_at CHECK (processed_at IS NULL OR processed_at >= received_at)
);

CREATE TABLE dbo.credential_status (
  name nvarchar(32) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_credential_status PRIMARY KEY,
  expires_at datetime2(7) NULL,
  last_renewed_at datetime2(7) NULL,
  status nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT CK_credential_status_name CHECK (name IN (N'codex-login', N'copilot-token', N'github-app-key')),
  CONSTRAINT CK_credential_status_status CHECK (status IN (N'ok', N'renew_soon', N'failed'))
);
