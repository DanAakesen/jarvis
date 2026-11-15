CREATE TABLE dbo.inbox_state (
  state_key varchar(40) NOT NULL,
  state_value nvarchar(2000) NOT NULL,
  updated_at datetime2(7) NOT NULL CONSTRAINT DF_inbox_state_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_inbox_state PRIMARY KEY (state_key),
  CONSTRAINT CK_inbox_state_key CHECK (state_key NOT LIKE '%[^a-z_]%')
);
CREATE TABLE dbo.inbox_spend (
  spend_day date NOT NULL,
  kind varchar(16) NOT NULL,
  calls int NOT NULL CONSTRAINT DF_inbox_spend_calls DEFAULT 0,
  input_tokens bigint NOT NULL CONSTRAINT DF_inbox_spend_input DEFAULT 0,
  output_tokens bigint NOT NULL CONSTRAINT DF_inbox_spend_output DEFAULT 0,
  estimated_dkk decimal(12,6) NOT NULL CONSTRAINT DF_inbox_spend_dkk DEFAULT 0,
  CONSTRAINT PK_inbox_spend PRIMARY KEY (spend_day, kind),
  CONSTRAINT CK_inbox_spend_kind CHECK (kind IN ('review', 'audit', 'weekly', 'triage'))
);
