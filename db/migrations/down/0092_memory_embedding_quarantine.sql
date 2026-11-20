IF EXISTS (
  SELECT 1 FROM dbo.memories WITH (TABLOCKX, HOLDLOCK)
  WHERE embedding_quarantined_at IS NOT NULL
)
BEGIN
  THROW 51000, 'Quarantined memory embeddings are durable policy evidence; retain them before rollback', 1;
END;

DROP INDEX IX_memories_embedding_quarantine ON dbo.memories;
ALTER TABLE dbo.memories DROP CONSTRAINT CK_memories_embedding_quarantine;
ALTER TABLE dbo.memories DROP COLUMN embedding_quarantined_at, embedding_quarantine_reason;
