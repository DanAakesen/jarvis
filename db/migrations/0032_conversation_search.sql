CREATE INDEX IX_messages_at ON dbo.messages (at DESC, id DESC)
  INCLUDE (jarvis_session_id, role);
