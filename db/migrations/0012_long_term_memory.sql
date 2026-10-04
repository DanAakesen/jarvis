CREATE TABLE dbo.memories (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_memories PRIMARY KEY,
  category nvarchar(24) COLLATE Latin1_General_100_BIN2 NOT NULL,
  memory_key nvarchar(100) COLLATE Latin1_General_100_BIN2 NOT NULL,
  content nvarchar(2000) NOT NULL,
  source_message_id bigint NOT NULL CONSTRAINT FK_memories_source_message REFERENCES dbo.messages (id),
  revision int NOT NULL CONSTRAINT DF_memories_revision DEFAULT 1,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_memories_created_at DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(7) NOT NULL CONSTRAINT DF_memories_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_memories_category CHECK (category IN (N'preference', N'project_fact', N'decision', N'unfinished_task')),
  CONSTRAINT CK_memories_key CHECK (LEN(memory_key) > 0),
  CONSTRAINT CK_memories_content CHECK (LEN(content) > 0),
  CONSTRAINT CK_memories_revision CHECK (revision >= 1),
  CONSTRAINT UQ_memories_category_key UNIQUE (category, memory_key)
);
CREATE INDEX IX_memories_updated_at ON dbo.memories (updated_at DESC, id DESC);

CREATE TABLE dbo.memory_history (
  memory_id bigint NOT NULL CONSTRAINT FK_memory_history_memory REFERENCES dbo.memories (id) ON DELETE CASCADE,
  revision int NOT NULL,
  category nvarchar(24) COLLATE Latin1_General_100_BIN2 NOT NULL,
  memory_key nvarchar(100) COLLATE Latin1_General_100_BIN2 NOT NULL,
  content nvarchar(2000) NOT NULL,
  source_message_id bigint NOT NULL CONSTRAINT FK_memory_history_source_message REFERENCES dbo.messages (id),
  changed_at datetime2(7) NOT NULL CONSTRAINT DF_memory_history_changed_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_memory_history PRIMARY KEY (memory_id, revision),
  CONSTRAINT CK_memory_history_revision CHECK (revision >= 1)
);

CREATE TABLE dbo.memory_deletions (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_memory_deletions PRIMARY KEY,
  memory_id bigint NOT NULL,
  request_message_id bigint NOT NULL CONSTRAINT FK_memory_deletions_message REFERENCES dbo.messages (id),
  deleted_at datetime2(7) NOT NULL CONSTRAINT DF_memory_deletions_deleted_at DEFAULT SYSUTCDATETIME()
);

ALTER TABLE dbo.messages ADD source_item_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NULL;
CREATE INDEX IX_messages_source_item_id ON dbo.messages (source_item_id, id DESC)
  WHERE source_item_id IS NOT NULL;

IF TYPE_ID(N'vector') IS NOT NULL
  EXEC(N'ALTER TABLE dbo.memories ADD embedding vector(1536) NULL;');
