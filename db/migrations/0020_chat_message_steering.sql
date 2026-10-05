ALTER TABLE dbo.messages
  ADD language nvarchar(8) COLLATE Latin1_General_100_BIN2 NULL,
      interrupted bit NOT NULL CONSTRAINT DF_messages_interrupted DEFAULT 0;

EXEC(N'ALTER TABLE dbo.messages
  ADD CONSTRAINT CK_messages_language
  CHECK (language IS NULL OR language IN (N''da'', N''en''));');

EXEC(N'ALTER TABLE dbo.messages
  ADD CONSTRAINT CK_messages_interrupted
  CHECK (interrupted = 0 OR role = N''jarvis'');');
