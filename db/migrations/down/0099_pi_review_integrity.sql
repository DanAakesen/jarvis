IF EXISTS (
  SELECT 1 FROM dbo.pi_situation_ref_authority WITH (TABLOCKX, HOLDLOCK)
)
BEGIN
  THROW 51000, 'PI reference authority receipts are durable and must be retained before rollback', 1;
END;

DROP INDEX IX_pi_situation_ref_authority_owner_source ON dbo.pi_situation_ref_authority;
DROP TABLE dbo.pi_situation_ref_authority;

ALTER TABLE dbo.proactive_event_batches
  DROP CONSTRAINT CK_proactive_event_batches_reconciliation,
    CK_proactive_event_batches_cost,
    CK_proactive_event_batches_month_key,
    CK_proactive_event_batches_policy_revision,
    DF_proactive_event_batches_reserved_dkk;
ALTER TABLE dbo.proactive_event_batches DROP COLUMN
  reconciled_at, actual_dkk, reserved_dkk, month_key, policy_revision;

ALTER TABLE dbo.proactive_source_status DROP COLUMN invalidated_at;

ALTER TABLE dbo.proactive_events DROP CONSTRAINT DF_proactive_events_reopenable;
ALTER TABLE dbo.proactive_events DROP COLUMN reopenable;
