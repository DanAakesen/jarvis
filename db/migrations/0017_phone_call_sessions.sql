ALTER TABLE dbo.jarvis_sessions DROP CONSTRAINT CK_jarvis_sessions_channel;
ALTER TABLE dbo.jarvis_sessions ADD CONSTRAINT CK_jarvis_sessions_channel
  CHECK (channel IN (N'voice', N'chat', N'phone'));

CREATE TABLE dbo.phone_sessions (
  jarvis_session_id bigint NOT NULL CONSTRAINT PK_phone_sessions PRIMARY KEY
    CONSTRAINT FK_phone_sessions_jarvis_session REFERENCES dbo.jarvis_sessions (id),
  event_id varchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT UQ_phone_sessions_event_id UNIQUE,
  call_id varchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT UQ_phone_sessions_call_id UNIQUE,
  caller_kind varchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL,
  caller_id nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  trust_tier varchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT DF_phone_sessions_trust_tier DEFAULT 'untrusted',
  status varchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT DF_phone_sessions_status DEFAULT 'answering',
  call_connection_id nvarchar(256) NULL,
  started_at datetime2(3) NOT NULL
    CONSTRAINT DF_phone_sessions_started_at DEFAULT SYSUTCDATETIME(),
  ended_at datetime2(3) NULL,
  CONSTRAINT CK_phone_sessions_caller_kind CHECK (caller_kind IN ('entra', 'phone')),
  CONSTRAINT CK_phone_sessions_trust_tier CHECK (trust_tier = 'untrusted'),
  CONSTRAINT CK_phone_sessions_status CHECK (status IN ('answering', 'active', 'ended', 'failed'))
);
CREATE UNIQUE INDEX UX_phone_sessions_call_connection_id
  ON dbo.phone_sessions (call_connection_id) WHERE call_connection_id IS NOT NULL;

ALTER TABLE dbo.teams_confirmations ADD phone_session_id bigint NULL;
ALTER TABLE dbo.teams_confirmations ADD CONSTRAINT FK_teams_confirmations_phone_session
  FOREIGN KEY (phone_session_id) REFERENCES dbo.phone_sessions (jarvis_session_id);
