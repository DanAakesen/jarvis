UPDATE dbo.usage SET cost_dkk = ROUND(cost_dkk, 4);

ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_role;
ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_model;
ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_cost_usd;
ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_cost_status;
ALTER TABLE dbo.usage DROP CONSTRAINT DF_usage_cost_status;
ALTER TABLE dbo.usage DROP COLUMN role, model, cost_usd, cost_status;
-- cost_dkk is referenced by a check constraint and two covering indexes; recreate them around the type change.
DROP INDEX IX_usage_task_id ON dbo.usage;
DROP INDEX IX_usage_project_id_at ON dbo.usage;
ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_cost_dkk;
ALTER TABLE dbo.usage ALTER COLUMN cost_dkk decimal(12,4) NULL;
ALTER TABLE dbo.usage ADD CONSTRAINT CK_usage_cost_dkk CHECK (cost_dkk IS NULL OR cost_dkk >= 0);
CREATE INDEX IX_usage_task_id ON dbo.usage (task_id, at)
  INCLUDE (source, metric, quantity, cost_dkk, sandbox_session_id);
CREATE INDEX IX_usage_project_id_at ON dbo.usage (project_id, at)
  INCLUDE (source, metric, quantity, cost_dkk);
