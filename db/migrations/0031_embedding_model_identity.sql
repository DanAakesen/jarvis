IF COL_LENGTH(N'dbo.memories', N'embedding_model') IS NULL
  ALTER TABLE dbo.memories ADD embedding_model nvarchar(128) NULL;
IF COL_LENGTH(N'dbo.vault_chunks', N'embedding_model') IS NULL
  ALTER TABLE dbo.vault_chunks ADD embedding_model nvarchar(128) NULL;

ALTER TABLE dbo.background_jobs DROP CONSTRAINT CK_background_jobs_kind;
ALTER TABLE dbo.background_jobs ADD CONSTRAINT CK_background_jobs_kind CHECK (
  kind IN (N'research', N'image', N'html_app', N'embedding')
);
