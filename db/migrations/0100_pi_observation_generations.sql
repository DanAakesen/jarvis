ALTER TABLE dbo.proactive_source_status ADD verified_at datetime2(7) NULL;
EXEC(N'
  UPDATE dbo.proactive_source_status SET verified_at = observed_at;
  ALTER TABLE dbo.proactive_source_status ALTER COLUMN verified_at datetime2(7) NOT NULL;
');

ALTER TABLE dbo.pi_situation_ref_authority
  DROP CONSTRAINT PK_pi_situation_ref_authority;
ALTER TABLE dbo.pi_situation_ref_authority ADD
  receipt_id uniqueidentifier NULL,
  invalidated_at datetime2(7) NULL,
  stale_reason nvarchar(160) NULL,
  CONSTRAINT CK_pi_situation_ref_authority_stale CHECK (
    (invalidated_at IS NULL AND stale_reason IS NULL)
    OR (invalidated_at IS NOT NULL AND stale_reason IS NOT NULL)
  );
EXEC(N'
  UPDATE dbo.pi_situation_ref_authority SET receipt_id = NEWID();
');
EXEC(N'
  ALTER TABLE dbo.pi_situation_ref_authority
    ALTER COLUMN receipt_id uniqueidentifier NOT NULL;
');
EXEC(N'
  ALTER TABLE dbo.pi_situation_ref_authority
    ADD CONSTRAINT PK_pi_situation_ref_authority PRIMARY KEY (receipt_id);
  CREATE UNIQUE INDEX UX_pi_situation_ref_authority_active
    ON dbo.pi_situation_ref_authority (owner_object_id, source_id, ref_id)
    WHERE invalidated_at IS NULL;
');
