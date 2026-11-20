IF EXISTS (
  SELECT 1 FROM dbo.pi_situation_ref_authority WITH (TABLOCKX, HOLDLOCK)
  WHERE activated_at IS NULL AND invalidated_at IS NULL
)
BEGIN
  THROW 51000, 'Pending PI lookup authority receipts must be reconciled before rollback', 1;
END;

DROP INDEX UX_pi_situation_ref_authority_pending ON dbo.pi_situation_ref_authority;
DROP INDEX UX_pi_situation_ref_authority_active ON dbo.pi_situation_ref_authority;
ALTER TABLE dbo.pi_situation_ref_authority DROP COLUMN activated_at;
CREATE UNIQUE INDEX UX_pi_situation_ref_authority_active
  ON dbo.pi_situation_ref_authority (owner_object_id, source_id, ref_id)
  WHERE invalidated_at IS NULL;
