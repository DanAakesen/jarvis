IF EXISTS (SELECT 1 FROM dbo.usage WHERE role = N'smoke')
  THROW 51000, 'Smoke usage rows must be retained before reverting migration 0045.', 1;

ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_role;
ALTER TABLE dbo.usage ADD CONSTRAINT CK_usage_role
  CHECK (role IS NULL OR role IN (N'chat', N'voice', N'vision', N'research', N'embeddings'));
