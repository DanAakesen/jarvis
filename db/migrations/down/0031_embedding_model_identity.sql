IF EXISTS (SELECT 1 FROM dbo.background_jobs WHERE kind = N'embedding')
  THROW 51000, 'Embedding background jobs exist; remove them before reverting migration 0031.', 1;

ALTER TABLE dbo.background_jobs DROP CONSTRAINT CK_background_jobs_kind;
ALTER TABLE dbo.background_jobs ADD CONSTRAINT CK_background_jobs_kind CHECK (
  kind IN (N'research', N'image', N'html_app')
);

IF COL_LENGTH(N'dbo.vault_chunks', N'embedding_model') IS NOT NULL
  ALTER TABLE dbo.vault_chunks DROP COLUMN embedding_model;
IF COL_LENGTH(N'dbo.memories', N'embedding_model') IS NOT NULL
  ALTER TABLE dbo.memories DROP COLUMN embedding_model;
