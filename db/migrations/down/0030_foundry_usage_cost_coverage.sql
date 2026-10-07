UPDATE dbo.usage SET cost_dkk = ROUND(cost_dkk, 4);

ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_role;
ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_model;
ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_cost_usd;
ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_cost_status;
ALTER TABLE dbo.usage DROP CONSTRAINT DF_usage_cost_status;
ALTER TABLE dbo.usage DROP COLUMN role, model, cost_usd, cost_status;
ALTER TABLE dbo.usage ALTER COLUMN cost_dkk decimal(12,4) NULL;
