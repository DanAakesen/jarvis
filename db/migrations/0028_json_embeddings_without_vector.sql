IF TYPE_ID(N'vector') IS NULL
BEGIN
  IF COL_LENGTH(N'dbo.memories', N'embedding_json') IS NULL
    ALTER TABLE dbo.memories ADD embedding_json nvarchar(max) NULL;
  IF COL_LENGTH(N'dbo.vault_chunks', N'embedding_json') IS NULL
    ALTER TABLE dbo.vault_chunks ADD embedding_json nvarchar(max) NULL;
END;
