IF OBJECT_ID(N'dbo.memory_history', N'U') IS NOT NULL DROP TABLE dbo.memory_history;
IF OBJECT_ID(N'dbo.memory_deletions', N'U') IS NOT NULL DROP TABLE dbo.memory_deletions;
IF OBJECT_ID(N'dbo.memories', N'U') IS NOT NULL DROP TABLE dbo.memories;
IF EXISTS (SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.messages') AND name = N'IX_messages_source_item_id')
  DROP INDEX IX_messages_source_item_id ON dbo.messages;
IF COL_LENGTH(N'dbo.messages', N'source_item_id') IS NOT NULL
  ALTER TABLE dbo.messages DROP COLUMN source_item_id;
