-- Additive metadata only; existing sessions and their history remain unchanged.
CREATE TABLE dbo.session_runtime_tests (
  jarvis_session_id bigint NOT NULL CONSTRAINT PK_session_runtime_tests PRIMARY KEY
    CONSTRAINT FK_session_runtime_tests_session REFERENCES dbo.jarvis_sessions (id),
  owner_object_id uniqueidentifier NOT NULL,
  runtime_test nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  native_conversation_id nvarchar(512) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT CK_session_runtime_tests_runtime CHECK (runtime_test IN (N'current', N'copilot')),
  CONSTRAINT CK_session_runtime_tests_native CHECK (native_conversation_id IS NULL OR
    (runtime_test = N'copilot' AND DATALENGTH(native_conversation_id) > 0))
);
