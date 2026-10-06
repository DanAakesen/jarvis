CREATE TABLE dbo.vault_chunks (
  path_hash binary(32) NOT NULL,
  path nvarchar(1024) NOT NULL,
  blob_sha char(40) NOT NULL,
  chunk_index int NOT NULL,
  heading nvarchar(500) NOT NULL,
  content nvarchar(max) NOT NULL,
  CONSTRAINT PK_vault_chunks PRIMARY KEY (path_hash, blob_sha, chunk_index),
  CONSTRAINT CK_vault_chunks_blob_sha CHECK (blob_sha NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT CK_vault_chunks_chunk_index CHECK (chunk_index >= 0)
);

IF TYPE_ID(N'vector') IS NOT NULL
  EXEC(N'ALTER TABLE dbo.vault_chunks ADD embedding vector(1536) NULL;');
