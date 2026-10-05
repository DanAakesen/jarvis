ALTER TABLE dbo.messages DROP CONSTRAINT CK_messages_interrupted;
ALTER TABLE dbo.messages DROP CONSTRAINT CK_messages_language;
ALTER TABLE dbo.messages DROP CONSTRAINT DF_messages_interrupted;
ALTER TABLE dbo.messages DROP COLUMN interrupted, language;
