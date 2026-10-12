ALTER TABLE dbo.messages ADD metadata nvarchar(max) NULL;

EXEC(N'ALTER TABLE dbo.messages ADD CONSTRAINT CK_messages_metadata CHECK (
  metadata IS NULL OR (ISJSON(metadata) = 1 AND DATALENGTH(metadata) <= 64000)
);');
