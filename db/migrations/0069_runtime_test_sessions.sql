-- Additive metadata only; existing sessions and their history remain unchanged.
CREATE TABLE dbo.session_runtime_tests (
  jarvis_session_id bigint NOT NULL CONSTRAINT PK_session_runtime_tests PRIMARY KEY
    CONSTRAINT FK_session_runtime_tests_session REFERENCES dbo.jarvis_sessions (id),
  owner_object_id uniqueidentifier NOT NULL,
  runtime_test nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  native_conversation_id nvarchar(512) COLLATE Latin1_General_100_BIN2 NULL,
  target_model nvarchar(100) COLLATE Latin1_General_100_BIN2 NULL,
  target_effort nvarchar(32) COLLATE Latin1_General_100_BIN2 NULL,
  target_agent_name nvarchar(128) COLLATE Latin1_General_100_BIN2 NULL,
  target_version nvarchar(128) COLLATE Latin1_General_100_BIN2 NULL,
  target_fingerprint varchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT CK_session_runtime_tests_target CHECK (
    (target_model IS NULL AND target_effort IS NULL AND target_agent_name IS NULL AND target_version IS NULL AND target_fingerprint IS NULL) OR
    (runtime_test = N'copilot' AND target_model IS NOT NULL AND target_effort IS NOT NULL AND target_agent_name IS NOT NULL AND target_version IS NOT NULL AND target_fingerprint IS NOT NULL)),
  CONSTRAINT CK_session_runtime_tests_runtime CHECK (runtime_test IN (N'current', N'copilot')),
  CONSTRAINT CK_session_runtime_tests_native CHECK (native_conversation_id IS NULL OR
    (runtime_test = N'copilot' AND DATALENGTH(native_conversation_id) > 0))
);

-- No expiration: interrupted/uncertain active work blocks new turns until reviewed recovery exists.
CREATE TABLE dbo.session_runtime_turns (
  jarvis_session_id bigint NOT NULL CONSTRAINT FK_session_runtime_turns_session REFERENCES dbo.session_runtime_tests (jarvis_session_id),
  source_message_id bigint NOT NULL CONSTRAINT FK_session_runtime_turns_source REFERENCES dbo.messages (id),
  claim_id uniqueidentifier NOT NULL,
  status nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_session_runtime_turns PRIMARY KEY (jarvis_session_id, source_message_id),
  CONSTRAINT UQ_session_runtime_turns_claim UNIQUE (claim_id),
  CONSTRAINT CK_session_runtime_turns_status CHECK (status IN (N'active', N'succeeded', N'failed'))
);
CREATE UNIQUE INDEX UX_session_runtime_turns_active ON dbo.session_runtime_turns (jarvis_session_id) WHERE status = N'active';

-- Every consumed source remains nonreplayable after its owning turn finishes.
CREATE TABLE dbo.session_runtime_sources (
  jarvis_session_id bigint NOT NULL CONSTRAINT FK_session_runtime_sources_session REFERENCES dbo.session_runtime_tests (jarvis_session_id),
  source_message_id bigint NOT NULL CONSTRAINT FK_session_runtime_sources_message REFERENCES dbo.messages (id),
  claim_id uniqueidentifier NOT NULL CONSTRAINT FK_session_runtime_sources_claim REFERENCES dbo.session_runtime_turns (claim_id),
  CONSTRAINT PK_session_runtime_sources PRIMARY KEY (jarvis_session_id, source_message_id)
);
