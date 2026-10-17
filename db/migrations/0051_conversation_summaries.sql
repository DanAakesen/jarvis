-- P9-105 (#800): rolling summary of older chat messages. Reverse with down/0051_conversation_summaries.sql.
CREATE TABLE dbo.conversation_summaries (
  owner_object_id uniqueidentifier NOT NULL,
  version int NOT NULL,
  from_message_id bigint NOT NULL,
  through_message_id bigint NOT NULL,
  message_count int NOT NULL,
  summary nvarchar(max) NOT NULL,
  open_items nvarchar(3000) NOT NULL,
  model nvarchar(128) NOT NULL,
  created_at datetime2(3) NOT NULL CONSTRAINT DF_conversation_summaries_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_conversation_summaries PRIMARY KEY (owner_object_id, version),
  CONSTRAINT CK_conversation_summaries_version CHECK (version >= 1),
  CONSTRAINT CK_conversation_summaries_range CHECK (from_message_id >= 1 AND through_message_id >= from_message_id),
  CONSTRAINT CK_conversation_summaries_message_count CHECK (message_count >= 1),
  CONSTRAINT CK_conversation_summaries_summary CHECK (LEN(summary) >= 1 AND LEN(summary) <= 6000)
);

CREATE INDEX IX_conversation_summaries_owner_created
  ON dbo.conversation_summaries (owner_object_id, created_at);
