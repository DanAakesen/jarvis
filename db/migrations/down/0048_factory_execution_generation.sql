IF EXISTS (SELECT 1 FROM dbo.tasks WHERE execution_generation <> 0)
  THROW 51000, 'Factory execution generations must be retained before reverting migration 0048.', 1;

ALTER TABLE dbo.sandbox_sessions DROP CONSTRAINT DF_sandbox_sessions_execution_generation;
ALTER TABLE dbo.sandbox_sessions DROP COLUMN execution_generation;
ALTER TABLE dbo.tasks DROP CONSTRAINT DF_tasks_execution_generation;
ALTER TABLE dbo.tasks DROP COLUMN execution_generation;
