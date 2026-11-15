ALTER TABLE dbo.inbox_capture_credentials ADD scope varchar(16) NOT NULL
  CONSTRAINT DF_inbox_capture_credentials_scope DEFAULT 'write'
  CONSTRAINT CK_inbox_capture_credentials_scope CHECK (scope IN ('write', 'read_write'));
