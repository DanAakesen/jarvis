-- PI chat engine (test selector): the one long managed-agent conversation per owner, and one row per model turn
-- with its tokens and DKK. The per-turn table is also the monthly hard-stop ledger.
CREATE TABLE dbo.pi_conversation (
  owner_object_id uniqueidentifier NOT NULL,
  agent_name varchar(128) NOT NULL,
  conversation_id nvarchar(512) NOT NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_pi_conversation_created DEFAULT SYSUTCDATETIME(),
  warmed_at datetime2(7) NULL,
  context_hash char(64) NULL,
  CONSTRAINT PK_pi_conversation PRIMARY KEY (owner_object_id),
  CONSTRAINT CK_pi_conversation_id CHECK (LEN(conversation_id) > 0)
);
CREATE TABLE dbo.pi_turn (
  id bigint IDENTITY(1,1) NOT NULL,
  at datetime2(7) NOT NULL CONSTRAINT DF_pi_turn_at DEFAULT SYSUTCDATETIME(),
  kind varchar(8) NOT NULL,
  message_id bigint NULL,
  model varchar(128) NOT NULL,
  input_tokens int NOT NULL CONSTRAINT DF_pi_turn_input DEFAULT 0,
  cached_tokens int NOT NULL CONSTRAINT DF_pi_turn_cached DEFAULT 0,
  output_tokens int NOT NULL CONSTRAINT DF_pi_turn_output DEFAULT 0,
  cost_dkk decimal(12,6) NOT NULL CONSTRAINT DF_pi_turn_cost DEFAULT 0,
  first_text_ms int NULL,
  total_ms int NOT NULL,
  outcome varchar(12) NOT NULL,
  CONSTRAINT PK_pi_turn PRIMARY KEY (id),
  CONSTRAINT CK_pi_turn_kind CHECK (kind IN ('chat', 'warm', 'smoke')),
  CONSTRAINT CK_pi_turn_outcome CHECK (outcome IN ('ok', 'failed', 'cancelled', 'timeout')),
  CONSTRAINT CK_pi_turn_counts CHECK (input_tokens >= 0 AND cached_tokens >= 0 AND output_tokens >= 0 AND cost_dkk >= 0 AND total_ms >= 0)
);
CREATE INDEX IX_pi_turn_at ON dbo.pi_turn (at DESC) INCLUDE (cost_dkk, kind, outcome);
