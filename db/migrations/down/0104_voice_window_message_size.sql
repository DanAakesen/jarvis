IF EXISTS (SELECT 1 FROM dbo.messages WHERE DATALENGTH(metadata) > 64000)
  THROW 51000, 'Existing Voice windows exceed the earlier message size limit.', 1;
ALTER TABLE dbo.messages DROP CONSTRAINT CK_messages_metadata;
ALTER TABLE dbo.messages WITH CHECK ADD CONSTRAINT CK_messages_metadata CHECK (
  metadata IS NULL OR (ISJSON(metadata) = 1 AND DATALENGTH(metadata) <= 64000)
);
