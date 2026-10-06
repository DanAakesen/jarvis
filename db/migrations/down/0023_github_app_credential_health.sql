DELETE dbo.credential_status WHERE name = N'github-app';
ALTER TABLE dbo.credential_status DROP COLUMN last_checked_at;
ALTER TABLE dbo.credential_status DROP CONSTRAINT CK_credential_status_name;
ALTER TABLE dbo.credential_status ADD CONSTRAINT CK_credential_status_name CHECK (
  name IN (N'codex-login', N'copilot-token', N'github-app-key')
);
