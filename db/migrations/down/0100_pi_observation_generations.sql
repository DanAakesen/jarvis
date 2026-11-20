IF EXISTS (
  SELECT 1
  FROM dbo.pi_situation_ref_authority WITH (TABLOCKX, HOLDLOCK)
  WHERE invalidated_at IS NOT NULL
)
BEGIN
  THROW 51000, 'Invalidated PI authority history is durable and must be retained before rollback', 1;
END;
IF EXISTS (
  SELECT owner_object_id, source_id, ref_id
  FROM dbo.pi_situation_ref_authority
  GROUP BY owner_object_id, source_id, ref_id
  HAVING COUNT(*) > 1
)
BEGIN
  THROW 51000, 'PI reference authority generations cannot be collapsed safely during rollback', 1;
END;

DROP INDEX UX_pi_situation_ref_authority_active ON dbo.pi_situation_ref_authority;
ALTER TABLE dbo.pi_situation_ref_authority
  DROP CONSTRAINT PK_pi_situation_ref_authority,
    CK_pi_situation_ref_authority_stale;
ALTER TABLE dbo.pi_situation_ref_authority DROP COLUMN
  stale_reason, invalidated_at, receipt_id;
ALTER TABLE dbo.pi_situation_ref_authority
  ADD CONSTRAINT PK_pi_situation_ref_authority
    PRIMARY KEY (owner_object_id, source_id, ref_id);

ALTER TABLE dbo.proactive_source_status DROP COLUMN verified_at;
