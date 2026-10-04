ALTER TABLE dbo.sandbox_sessions DROP CONSTRAINT CK_sandbox_sessions_end_reason;
ALTER TABLE dbo.sandbox_sessions ADD CONSTRAINT CK_sandbox_sessions_end_reason
  CHECK (end_reason IS NULL OR end_reason IN (N'done', N'cancelled', N'crashed', N'idle', N'idle_expired'));
