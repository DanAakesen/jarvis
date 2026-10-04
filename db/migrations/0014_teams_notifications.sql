CREATE TABLE dbo.teams_conversations (
  owner_object_id char(36) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT PK_teams_conversations PRIMARY KEY,
  conversation_id nvarchar(512) NOT NULL,
  reference_json nvarchar(4000) NOT NULL,
  updated_at datetime2(3) NOT NULL
    CONSTRAINT DF_teams_conversations_updated_at DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.teams_confirmations (
  confirmation_id char(43) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT PK_teams_confirmations PRIMARY KEY,
  owner_object_id char(36) COLLATE Latin1_General_100_BIN2 NOT NULL,
  conversation_id nvarchar(512) NOT NULL,
  action_kind varchar(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  status varchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT DF_teams_confirmations_status DEFAULT 'pending',
  expires_at datetime2(3) NOT NULL,
  resolved_at datetime2(3) NULL,
  CONSTRAINT CK_teams_confirmations_status CHECK
    (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'executing'))
);

CREATE INDEX IX_teams_confirmations_expiry ON dbo.teams_confirmations (expires_at, status);
