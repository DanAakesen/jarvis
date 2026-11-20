ALTER TABLE dbo.memories DROP CONSTRAINT FK_memories_source_message;
ALTER TABLE dbo.memories ALTER COLUMN source_message_id bigint NULL;
ALTER TABLE dbo.memories ADD
  source_kind varchar(12) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT DF_memories_source_kind DEFAULT 'conversation',
  action_request_id uniqueidentifier NULL,
  action_owner_id uniqueidentifier NULL,
  CONSTRAINT CK_memories_source_provenance CHECK (
    (source_kind = 'conversation' AND source_message_id IS NOT NULL
      AND action_request_id IS NULL AND action_owner_id IS NULL)
    OR (source_kind = 'settings' AND source_message_id IS NULL
      AND action_request_id IS NOT NULL AND action_owner_id IS NOT NULL)
  ),
  CONSTRAINT FK_memories_source_message FOREIGN KEY (source_message_id) REFERENCES dbo.messages (id);

ALTER TABLE dbo.memory_history DROP CONSTRAINT FK_memory_history_source_message;
ALTER TABLE dbo.memory_history ALTER COLUMN source_message_id bigint NULL;
ALTER TABLE dbo.memory_history ADD
  source_kind varchar(12) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT DF_memory_history_source_kind DEFAULT 'conversation',
  action_request_id uniqueidentifier NULL,
  action_owner_id uniqueidentifier NULL,
  CONSTRAINT CK_memory_history_source_provenance CHECK (
    (source_kind = 'conversation' AND source_message_id IS NOT NULL
      AND action_request_id IS NULL AND action_owner_id IS NULL)
    OR (source_kind = 'settings' AND source_message_id IS NULL
      AND action_request_id IS NOT NULL AND action_owner_id IS NOT NULL)
  ),
  CONSTRAINT FK_memory_history_source_message FOREIGN KEY (source_message_id) REFERENCES dbo.messages (id);

ALTER TABLE dbo.memory_deletions DROP CONSTRAINT FK_memory_deletions_message;
ALTER TABLE dbo.memory_deletions ALTER COLUMN request_message_id bigint NULL;
ALTER TABLE dbo.memory_deletions ADD
  source_kind varchar(12) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT DF_memory_deletions_source_kind DEFAULT 'conversation',
  action_request_id uniqueidentifier NULL,
  action_owner_id uniqueidentifier NULL,
  CONSTRAINT CK_memory_deletions_source_provenance CHECK (
    (source_kind = 'conversation' AND request_message_id IS NOT NULL
      AND action_request_id IS NULL AND action_owner_id IS NULL)
    OR (source_kind = 'settings' AND request_message_id IS NULL
      AND action_request_id IS NOT NULL AND action_owner_id IS NOT NULL)
  ),
  CONSTRAINT FK_memory_deletions_message FOREIGN KEY (request_message_id) REFERENCES dbo.messages (id);
