ALTER TABLE dbo.tasks ADD execution_generation bigint NOT NULL
  CONSTRAINT DF_tasks_execution_generation DEFAULT (0) WITH VALUES;
ALTER TABLE dbo.sandbox_sessions ADD execution_generation bigint NOT NULL
  CONSTRAINT DF_sandbox_sessions_execution_generation DEFAULT (0) WITH VALUES;
