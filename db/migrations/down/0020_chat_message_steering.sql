IF EXISTS (
  SELECT 1 FROM dbo.messages WHERE language IS NOT NULL OR interrupted = 1
)
  THROW 51000, 'Message language and interruption data must be retained before reverting migration 0020.', 1;

ALTER TABLE dbo.messages DROP CONSTRAINT CK_messages_interrupted;
ALTER TABLE dbo.messages DROP CONSTRAINT CK_messages_language;
ALTER TABLE dbo.messages DROP CONSTRAINT DF_messages_interrupted;
ALTER TABLE dbo.messages DROP COLUMN interrupted, language;
