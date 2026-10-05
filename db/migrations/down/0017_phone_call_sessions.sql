IF EXISTS (SELECT 1 FROM dbo.phone_sessions)
  THROW 51000, 'Phone sessions must be retained before reverting migration 0017.', 1;

ALTER TABLE dbo.teams_confirmations DROP CONSTRAINT FK_teams_confirmations_phone_session;
ALTER TABLE dbo.teams_confirmations DROP COLUMN phone_session_id;
DROP TABLE dbo.phone_sessions;
ALTER TABLE dbo.jarvis_sessions DROP CONSTRAINT CK_jarvis_sessions_channel;
ALTER TABLE dbo.jarvis_sessions ADD CONSTRAINT CK_jarvis_sessions_channel
  CHECK (channel IN (N'voice', N'chat'));
