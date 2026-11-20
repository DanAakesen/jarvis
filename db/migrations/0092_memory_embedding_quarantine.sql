ALTER TABLE dbo.memories ADD
  embedding_quarantined_at datetime2(7) NULL,
  embedding_quarantine_reason varchar(16) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT CK_memories_embedding_quarantine CHECK (
    (embedding_quarantined_at IS NULL AND embedding_quarantine_reason IS NULL)
    OR (embedding_quarantined_at IS NOT NULL AND embedding_quarantine_reason = 'credential')
  );

EXEC(N'CREATE INDEX IX_memories_embedding_quarantine
  ON dbo.memories (embedding_quarantined_at, id)
  WHERE embedding_quarantined_at IS NOT NULL;');
