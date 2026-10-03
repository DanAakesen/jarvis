-- P1-01 (#15): data-model groups 1-3. Reverse with down/0001_core_tables.sql.
-- Fixed vocabularies use a binary collation so checks and comparisons are exact.

CREATE TABLE dbo.settings (
  scope nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [key] nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  value nvarchar(max) NOT NULL,
  updated_at datetime2(7) NOT NULL CONSTRAINT DF_settings_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_settings PRIMARY KEY (scope, [key]),
  CONSTRAINT CK_settings_scope CHECK (scope = N'global' OR (scope LIKE N'project:[1-9]%' AND scope NOT LIKE N'project:%[^0-9]%')),
  CONSTRAINT CK_settings_key CHECK ([key] LIKE N'[a-z]%' AND [key] NOT LIKE N'%[^-a-z0-9._]%'),
  CONSTRAINT CK_settings_value CHECK (ISJSON(value, VALUE) = 1)
);

CREATE TABLE dbo.jarvis_sessions (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_jarvis_sessions PRIMARY KEY,
  channel nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  language nvarchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL,
  started_at datetime2(7) NOT NULL CONSTRAINT DF_jarvis_sessions_started_at DEFAULT SYSUTCDATETIME(),
  ended_at datetime2(7) NULL,
  CONSTRAINT CK_jarvis_sessions_channel CHECK (channel IN (N'voice', N'chat')),
  CONSTRAINT CK_jarvis_sessions_language CHECK (language IN (N'da', N'en')),
  CONSTRAINT CK_jarvis_sessions_ended_at CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE dbo.messages (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_messages PRIMARY KEY,
  jarvis_session_id bigint NOT NULL CONSTRAINT FK_messages_jarvis_sessions REFERENCES dbo.jarvis_sessions (id),
  role nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  text nvarchar(max) NOT NULL,
  model nvarchar(100) NULL,
  input_tokens int NULL,
  output_tokens int NULL,
  at datetime2(7) NOT NULL CONSTRAINT DF_messages_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_messages_role CHECK (role IN (N'dan', N'jarvis')),
  CONSTRAINT CK_messages_tokens CHECK ((input_tokens IS NULL OR input_tokens >= 0) AND (output_tokens IS NULL OR output_tokens >= 0))
);
CREATE INDEX IX_messages_jarvis_session_id_at ON dbo.messages (jarvis_session_id, at);

CREATE TABLE dbo.activity (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_activity PRIMARY KEY,
  area nvarchar(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  kind nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  title nvarchar(400) NOT NULL,
  link nvarchar(100) NULL,
  at datetime2(7) NOT NULL CONSTRAINT DF_activity_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_activity_area CHECK (area LIKE N'[a-z]%' AND area NOT LIKE N'%[^a-z_]%'),
  CONSTRAINT CK_activity_kind CHECK (kind LIKE N'[a-z]%' AND kind NOT LIKE N'%[^a-z_]%'),
  CONSTRAINT CK_activity_title CHECK (LEN(title) > 0)
);

CREATE TABLE dbo.projects (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_projects PRIMARY KEY,
  name nvarchar(100) NOT NULL,
  repo nvarchar(140) NOT NULL,
  default_branch nvarchar(255) NOT NULL,
  default_agent nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  policy nvarchar(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  merge_rules nvarchar(4000) NULL,
  sandbox_size nvarchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL,
  tech nvarchar(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  max_parallel_tasks int NOT NULL CONSTRAINT DF_projects_max_parallel_tasks DEFAULT 1,
  active bit NOT NULL CONSTRAINT DF_projects_active DEFAULT 1,
  CONSTRAINT UQ_projects_repo UNIQUE (repo),
  CONSTRAINT CK_projects_name CHECK (LEN(name) > 0),
  CONSTRAINT CK_projects_repo CHECK (repo LIKE N'_%/_%' AND repo NOT LIKE N'%/%/%'
    AND repo COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^-A-Za-z0-9._/]%'),
  CONSTRAINT CK_projects_default_branch CHECK (LEN(default_branch) > 0),
  CONSTRAINT CK_projects_default_agent CHECK (default_agent IN (N'codex', N'copilot')),
  CONSTRAINT CK_projects_policy CHECK (policy IN (N'deliver_pr', N'complete_without_deployment')),
  CONSTRAINT CK_projects_sandbox_size CHECK (sandbox_size IN (N'1x2', N'2x4')),
  CONSTRAINT CK_projects_tech CHECK (tech LIKE N'[a-z]%' AND tech NOT LIKE N'%[^-a-z0-9_.]%'),
  CONSTRAINT CK_projects_max_parallel_tasks CHECK (max_parallel_tasks >= 1)
);

CREATE TABLE dbo.tasks (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_tasks PRIMARY KEY,
  project_id bigint NOT NULL CONSTRAINT FK_tasks_projects REFERENCES dbo.projects (id),
  origin_message_id bigint NULL CONSTRAINT FK_tasks_messages REFERENCES dbo.messages (id),
  title nvarchar(200) NOT NULL,
  request nvarchar(max) NOT NULL,
  source nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  agent nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  model_override nvarchar(100) NULL,
  reasoning_override nvarchar(32) NULL,
  state nvarchar(32) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT DF_tasks_state DEFAULT N'Ready',
  activity nvarchar(400) NULL,
  priority int NOT NULL CONSTRAINT DF_tasks_priority DEFAULT 0,
  attempt_count int NOT NULL CONSTRAINT DF_tasks_attempt_count DEFAULT 0,
  next_attempt_at datetime2(7) NULL,
  lease_owner nvarchar(100) NULL,
  lease_until datetime2(7) NULL,
  branch nvarchar(255) NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_tasks_created_at DEFAULT SYSUTCDATETIME(),
  started_at datetime2(7) NULL,
  finished_at datetime2(7) NULL,
  CONSTRAINT CK_tasks_title CHECK (LEN(title) > 0),
  CONSTRAINT CK_tasks_source CHECK (source IN (N'board', N'voice', N'chat')),
  CONSTRAINT CK_tasks_origin_message CHECK (source = N'board' OR origin_message_id IS NOT NULL),
  CONSTRAINT CK_tasks_agent CHECK (agent IN (N'codex', N'copilot')),
  CONSTRAINT CK_tasks_state CHECK (state IN (N'Ready', N'Running', N'PauseRequested', N'Paused', N'NeedsAttention', N'Done', N'Cancelled')),
  CONSTRAINT CK_tasks_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT CK_tasks_lease CHECK ((lease_owner IS NULL AND lease_until IS NULL) OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL)),
  CONSTRAINT CK_tasks_started_at CHECK (started_at IS NULL OR started_at >= created_at),
  CONSTRAINT CK_tasks_finished_at CHECK (finished_at IS NULL OR finished_at >= created_at)
);
CREATE INDEX IX_tasks_state_next_attempt_at ON dbo.tasks (state, next_attempt_at);
CREATE INDEX IX_tasks_project_id_state ON dbo.tasks (project_id, state);
CREATE INDEX IX_tasks_origin_message_id ON dbo.tasks (origin_message_id) WHERE origin_message_id IS NOT NULL;

CREATE TABLE dbo.tool_calls (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_tool_calls PRIMARY KEY,
  message_id bigint NOT NULL CONSTRAINT FK_tool_calls_messages REFERENCES dbo.messages (id),
  tool nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  arguments nvarchar(max) NOT NULL,
  result nvarchar(max) NULL,
  outcome nvarchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL,
  task_id bigint NULL CONSTRAINT FK_tool_calls_tasks REFERENCES dbo.tasks (id),
  at datetime2(7) NOT NULL CONSTRAINT DF_tool_calls_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_tool_calls_tool CHECK (LEN(tool) > 0 AND tool NOT LIKE N'%[^-A-Za-z0-9_]%'),
  CONSTRAINT CK_tool_calls_arguments CHECK (ISJSON(arguments, OBJECT) = 1),
  CONSTRAINT CK_tool_calls_result CHECK (result IS NULL OR ISJSON(result, VALUE) = 1),
  CONSTRAINT CK_tool_calls_outcome CHECK (outcome IN (N'ok', N'error'))
);
CREATE INDEX IX_tool_calls_message_id ON dbo.tool_calls (message_id);
CREATE INDEX IX_tool_calls_task_id ON dbo.tool_calls (task_id) WHERE task_id IS NOT NULL;

CREATE TABLE dbo.task_events (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_task_events PRIMARY KEY,
  task_id bigint NOT NULL CONSTRAINT FK_task_events_tasks REFERENCES dbo.tasks (id),
  type nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  summary nvarchar(2000) NULL,
  payload nvarchar(max) NULL,
  source nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  at datetime2(7) NOT NULL CONSTRAINT DF_task_events_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_task_events_type CHECK (type LIKE N'[a-z]%' AND type NOT LIKE N'%[^a-z_]%'),
  CONSTRAINT CK_task_events_payload CHECK (payload IS NULL OR ISJSON(payload, VALUE) = 1),
  CONSTRAINT CK_task_events_source CHECK (source IN (N'runner', N'backend', N'github', N'dan'))
);
CREATE INDEX IX_task_events_task_id_at ON dbo.task_events (task_id, at);
