ALTER TABLE dbo.credential_status
  DROP CONSTRAINT CK_credential_status_status;

ALTER TABLE dbo.credential_status
  ADD renewal_lease_owner uniqueidentifier NULL,
      renewal_lease_until datetime2(7) NULL,
      CONSTRAINT CK_credential_status_lease CHECK (
        (renewal_lease_owner IS NULL AND renewal_lease_until IS NULL)
        OR (renewal_lease_owner IS NOT NULL AND renewal_lease_until IS NOT NULL)
      ),
      CONSTRAINT CK_credential_status_status CHECK (
        status IN (N'ok', N'renew_soon', N'failed', N'unknown')
      );

IF NOT EXISTS (SELECT 1 FROM dbo.credential_status WHERE name = N'codex-login')
  INSERT dbo.credential_status (name, status) VALUES (N'codex-login', N'unknown');

IF NOT EXISTS (SELECT 1 FROM dbo.credential_status WHERE name = N'copilot-token')
  INSERT dbo.credential_status (name, status) VALUES (N'copilot-token', N'unknown');
