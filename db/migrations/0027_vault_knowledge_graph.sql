ALTER TABLE dbo.vault_chunks
  ADD indexed_at datetime2(3) NOT NULL
    CONSTRAINT DF_vault_chunks_indexed_at DEFAULT SYSUTCDATETIME();

CREATE TABLE dbo.vault_links (
  source_path_hash binary(32) NOT NULL,
  target_path nvarchar(180) NOT NULL,
  CONSTRAINT PK_vault_links PRIMARY KEY (source_path_hash, target_path)
);
