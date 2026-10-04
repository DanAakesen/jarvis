-- P3-04 (#42): data-model group 5. Reverse with down/0009_github_release_records.sql.

CREATE TABLE dbo.pull_requests (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_pull_requests PRIMARY KEY,
  task_id bigint NULL CONSTRAINT FK_pull_requests_tasks REFERENCES dbo.tasks (id),
  project_id bigint NOT NULL CONSTRAINT FK_pull_requests_projects REFERENCES dbo.projects (id),
  number int NOT NULL,
  branch nvarchar(255) NOT NULL,
  head_sha char(40) COLLATE Latin1_General_100_BIN2 NOT NULL,
  state nvarchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL,
  checks nvarchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT DF_pull_requests_checks DEFAULT N'pending',
  opened_at datetime2(7) NOT NULL,
  merged_at datetime2(7) NULL,
  CONSTRAINT UQ_pull_requests_project_number UNIQUE (project_id, number),
  CONSTRAINT CK_pull_requests_number CHECK (number > 0),
  CONSTRAINT CK_pull_requests_branch CHECK (LEN(branch) > 0),
  CONSTRAINT CK_pull_requests_head_sha CHECK (head_sha NOT LIKE '%[^0-9a-fA-F]%'),
  CONSTRAINT CK_pull_requests_state CHECK (state IN (N'open', N'merged', N'closed')),
  CONSTRAINT CK_pull_requests_checks CHECK (checks IN (N'pending', N'passed', N'failed')),
  CONSTRAINT CK_pull_requests_merged_at CHECK ((state = N'merged' AND merged_at IS NOT NULL) OR state <> N'merged'),
  CONSTRAINT CK_pull_requests_time CHECK (merged_at IS NULL OR merged_at >= opened_at)
);
CREATE INDEX IX_pull_requests_project_head_sha ON dbo.pull_requests (project_id, head_sha);
CREATE INDEX IX_pull_requests_task_id ON dbo.pull_requests (task_id) WHERE task_id IS NOT NULL;

CREATE TABLE dbo.releases (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_releases PRIMARY KEY,
  project_id bigint NOT NULL CONSTRAINT FK_releases_projects REFERENCES dbo.projects (id),
  version nvarchar(100) NOT NULL,
  sha char(40) COLLATE Latin1_General_100_BIN2 NOT NULL,
  status nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_releases_created_at DEFAULT SYSUTCDATETIME(),
  released_at datetime2(7) NULL,
  CONSTRAINT UQ_releases_project_sha UNIQUE (project_id, sha),
  CONSTRAINT CK_releases_version CHECK (LEN(version) > 0),
  CONSTRAINT CK_releases_sha CHECK (sha NOT LIKE '%[^0-9a-fA-F]%'),
  CONSTRAINT CK_releases_status CHECK (status IN (N'building', N'deploying', N'released', N'failed')),
  CONSTRAINT CK_releases_released_at CHECK (released_at IS NULL OR released_at >= created_at)
);
CREATE INDEX IX_releases_project_created_at ON dbo.releases (project_id, created_at);

CREATE TABLE dbo.workflow_runs (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_workflow_runs PRIMARY KEY,
  project_id bigint NOT NULL CONSTRAINT FK_workflow_runs_projects REFERENCES dbo.projects (id),
  github_run_id bigint NOT NULL,
  workflow nvarchar(255) NOT NULL,
  [trigger] nvarchar(32) NOT NULL,
  head_sha char(40) COLLATE Latin1_General_100_BIN2 NOT NULL,
  pull_request_id bigint NULL CONSTRAINT FK_workflow_runs_pull_requests REFERENCES dbo.pull_requests (id),
  release_id bigint NULL CONSTRAINT FK_workflow_runs_releases REFERENCES dbo.releases (id),
  status nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  conclusion nvarchar(16) COLLATE Latin1_General_100_BIN2 NULL,
  log_artifact nvarchar(1024) NULL,
  started_at datetime2(7) NULL,
  completed_at datetime2(7) NULL,
  CONSTRAINT UQ_workflow_runs_project_github_run UNIQUE (project_id, github_run_id),
  CONSTRAINT CK_workflow_runs_github_run_id CHECK (github_run_id > 0),
  CONSTRAINT CK_workflow_runs_workflow CHECK (LEN(workflow) > 0),
  CONSTRAINT CK_workflow_runs_trigger CHECK (LEN([trigger]) > 0),
  CONSTRAINT CK_workflow_runs_head_sha CHECK (head_sha NOT LIKE '%[^0-9a-fA-F]%'),
  CONSTRAINT CK_workflow_runs_status CHECK (status IN (N'queued', N'in_progress', N'completed')),
  CONSTRAINT CK_workflow_runs_conclusion CHECK (conclusion IS NULL OR conclusion IN (N'success', N'failure', N'cancelled')),
  CONSTRAINT CK_workflow_runs_completed_at CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX IX_workflow_runs_project_head_sha ON dbo.workflow_runs (project_id, head_sha);
CREATE INDEX IX_workflow_runs_pull_request_id ON dbo.workflow_runs (pull_request_id) WHERE pull_request_id IS NOT NULL;
CREATE INDEX IX_workflow_runs_release_id ON dbo.workflow_runs (release_id) WHERE release_id IS NOT NULL;

CREATE TABLE dbo.deployments (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_deployments PRIMARY KEY,
  release_id bigint NOT NULL CONSTRAINT FK_deployments_releases REFERENCES dbo.releases (id),
  github_deployment_id bigint NOT NULL,
  environment nvarchar(255) NOT NULL,
  status nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  at datetime2(7) NOT NULL,
  CONSTRAINT UQ_deployments_github_deployment_id UNIQUE (github_deployment_id),
  CONSTRAINT CK_deployments_github_deployment_id CHECK (github_deployment_id > 0),
  CONSTRAINT CK_deployments_environment CHECK (LEN(environment) > 0),
  CONSTRAINT CK_deployments_status CHECK (status IN (N'queued', N'in_progress', N'success', N'failure'))
);
CREATE INDEX IX_deployments_release_id_at ON dbo.deployments (release_id, at);
