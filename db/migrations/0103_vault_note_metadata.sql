CREATE TABLE dbo.vault_notes (
  path_hash binary(32) NOT NULL CONSTRAINT PK_vault_notes PRIMARY KEY,
  path nvarchar(1024) NOT NULL,
  blob_sha char(40) NOT NULL,
  title nvarchar(200) NULL,
  updated_at datetime2(3) NOT NULL CONSTRAINT DF_vault_notes_updated_at DEFAULT SYSUTCDATETIME()
);

-- Preserve the existing inventory and dates. Only the original Markdown can supply the title.
INSERT INTO dbo.vault_notes (path_hash, path, blob_sha, updated_at)
SELECT path_hash, MAX(path), MAX(blob_sha), MAX(indexed_at)
FROM dbo.vault_chunks
GROUP BY path_hash;
