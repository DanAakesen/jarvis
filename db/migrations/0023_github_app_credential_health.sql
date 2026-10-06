ALTER TABLE dbo.credential_status DROP CONSTRAINT CK_credential_status_name;
ALTER TABLE dbo.credential_status ADD CONSTRAINT CK_credential_status_name CHECK (
  name IN (N'codex-login', N'copilot-token', N'github-app-key', N'github-app')
);
ALTER TABLE dbo.credential_status ADD last_checked_at datetime2(7) NULL;
INSERT dbo.credential_status (name, status) VALUES (N'github-app', N'unknown');
