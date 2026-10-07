ALTER TABLE dbo.usage ALTER COLUMN cost_dkk decimal(19,8) NULL;
ALTER TABLE dbo.usage ADD
  role nvarchar(24) COLLATE Latin1_General_100_BIN2 NULL,
  model nvarchar(128) COLLATE Latin1_General_100_BIN2 NULL,
  cost_usd decimal(19,8) NULL,
  cost_status nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT DF_usage_cost_status DEFAULT N'unverified';

UPDATE dbo.usage
SET role = CASE
    WHEN source = N'jarvis_model' THEN N'vision'
    WHEN source = N'voice' THEN N'voice'
    ELSE NULL
  END,
  model = CASE WHEN source = N'jarvis_model' THEN N'gpt-6-luna' ELSE NULL END,
  cost_usd = CASE WHEN cost_dkk IS NULL THEN NULL ELSE ROUND(cost_dkk / 6.5785, 8) END,
  cost_status = CASE WHEN cost_dkk IS NULL THEN N'unverified' ELSE N'estimated' END;

ALTER TABLE dbo.usage ADD CONSTRAINT CK_usage_role
  CHECK (role IS NULL OR role IN (N'chat', N'voice', N'vision', N'research', N'embeddings'));
ALTER TABLE dbo.usage ADD CONSTRAINT CK_usage_model
  CHECK (model IS NULL OR LEN(model) BETWEEN 1 AND 128);
ALTER TABLE dbo.usage ADD CONSTRAINT CK_usage_cost_usd
  CHECK (cost_usd IS NULL OR cost_usd >= 0);
ALTER TABLE dbo.usage ADD CONSTRAINT CK_usage_cost_status
  CHECK (cost_status IN (N'measured', N'estimated', N'unverified'));
