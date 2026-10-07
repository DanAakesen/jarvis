DROP TABLE dbo.vault_links;

ALTER TABLE dbo.vault_chunks DROP CONSTRAINT DF_vault_chunks_indexed_at;
ALTER TABLE dbo.vault_chunks DROP COLUMN indexed_at;
