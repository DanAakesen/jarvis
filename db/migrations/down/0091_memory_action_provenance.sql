IF EXISTS (SELECT 1 FROM dbo.memories WITH (TABLOCKX, HOLDLOCK) WHERE source_kind <> 'conversation')
  OR EXISTS (SELECT 1 FROM dbo.memory_history WITH (TABLOCKX, HOLDLOCK) WHERE source_kind <> 'conversation')
  OR EXISTS (SELECT 1 FROM dbo.memory_deletions WITH (TABLOCKX, HOLDLOCK) WHERE source_kind <> 'conversation')
BEGIN
  THROW 51000, 'Memory Settings provenance is durable audit evidence; retain it before rollback', 1;
END;

ALTER TABLE dbo.memories DROP CONSTRAINT CK_memories_source_provenance;
ALTER TABLE dbo.memories DROP CONSTRAINT FK_memories_source_message;
ALTER TABLE dbo.memories DROP CONSTRAINT DF_memories_source_kind;
ALTER TABLE dbo.memories DROP COLUMN source_kind, action_request_id, action_owner_id;
ALTER TABLE dbo.memories ALTER COLUMN source_message_id bigint NOT NULL;
ALTER TABLE dbo.memories ADD CONSTRAINT FK_memories_source_message
  FOREIGN KEY (source_message_id) REFERENCES dbo.messages (id);

ALTER TABLE dbo.memory_history DROP CONSTRAINT CK_memory_history_source_provenance;
ALTER TABLE dbo.memory_history DROP CONSTRAINT FK_memory_history_source_message;
ALTER TABLE dbo.memory_history DROP CONSTRAINT DF_memory_history_source_kind;
ALTER TABLE dbo.memory_history DROP COLUMN source_kind, action_request_id, action_owner_id;
ALTER TABLE dbo.memory_history ALTER COLUMN source_message_id bigint NOT NULL;
ALTER TABLE dbo.memory_history ADD CONSTRAINT FK_memory_history_source_message
  FOREIGN KEY (source_message_id) REFERENCES dbo.messages (id);

ALTER TABLE dbo.memory_deletions DROP CONSTRAINT CK_memory_deletions_source_provenance;
ALTER TABLE dbo.memory_deletions DROP CONSTRAINT FK_memory_deletions_message;
ALTER TABLE dbo.memory_deletions DROP CONSTRAINT DF_memory_deletions_source_kind;
ALTER TABLE dbo.memory_deletions DROP COLUMN source_kind, action_request_id, action_owner_id;
ALTER TABLE dbo.memory_deletions ALTER COLUMN request_message_id bigint NOT NULL;
ALTER TABLE dbo.memory_deletions ADD CONSTRAINT FK_memory_deletions_message
  FOREIGN KEY (request_message_id) REFERENCES dbo.messages (id);
