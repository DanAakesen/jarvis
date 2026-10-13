ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_role;
ALTER TABLE dbo.usage ADD CONSTRAINT CK_usage_role
  CHECK (role IS NULL OR role IN (N'chat', N'smoke', N'voice', N'vision', N'research', N'embeddings'));
