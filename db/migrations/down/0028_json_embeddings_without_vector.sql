IF TYPE_ID(N'vector') IS NULL
BEGIN
  IF COL_LENGTH(N'dbo.vault_chunks', N'embedding_json') IS NOT NULL
    ALTER TABLE dbo.vault_chunks DROP COLUMN embedding_json;
  IF COL_LENGTH(N'dbo.memories', N'embedding_json') IS NOT NULL
    ALTER TABLE dbo.memories DROP COLUMN embedding_json;
END;
