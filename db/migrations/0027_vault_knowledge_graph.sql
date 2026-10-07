ALTER TABLE dbo.vault_chunks
  ADD indexed_at datetime2(3) NOT NULL
    CONSTRAINT DF_vault_chunks_indexed_at DEFAULT SYSUTCDATETIME();

CREATE TABLE dbo.vault_links (
  source_path_hash binary(32) NOT NULL,
  source_path nvarchar(1024) NOT NULL,
  target_path nvarchar(1024) NOT NULL,
  CONSTRAINT PK_vault_links PRIMARY KEY (source_path_hash, target_path)
);

CREATE INDEX IX_vault_links_source_path ON dbo.vault_links (source_path);
