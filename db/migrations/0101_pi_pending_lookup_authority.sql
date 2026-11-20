ALTER TABLE dbo.pi_situation_ref_authority ADD activated_at datetime2(7) NULL;
EXEC(N'
  UPDATE dbo.pi_situation_ref_authority
    SET activated_at = verified_at;
  DROP INDEX UX_pi_situation_ref_authority_active
    ON dbo.pi_situation_ref_authority;
  CREATE UNIQUE INDEX UX_pi_situation_ref_authority_active
    ON dbo.pi_situation_ref_authority (owner_object_id, source_id, ref_id)
    WHERE invalidated_at IS NULL AND activated_at IS NOT NULL;
  CREATE UNIQUE INDEX UX_pi_situation_ref_authority_pending
    ON dbo.pi_situation_ref_authority (
      owner_object_id, source_id, ref_id, material_hash, verified_at
    )
    WHERE invalidated_at IS NULL AND activated_at IS NULL;
');
