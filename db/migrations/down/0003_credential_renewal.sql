UPDATE dbo.credential_status SET status = N'failed' WHERE status = N'unknown';

ALTER TABLE dbo.credential_status
  DROP CONSTRAINT CK_credential_status_lease,
  DROP COLUMN renewal_lease_owner,
  DROP COLUMN renewal_lease_until;

ALTER TABLE dbo.credential_status
  DROP CONSTRAINT CK_credential_status_status;

ALTER TABLE dbo.credential_status
  ADD CONSTRAINT CK_credential_status_status CHECK (
    status IN (N'ok', N'renew_soon', N'failed')
  );
