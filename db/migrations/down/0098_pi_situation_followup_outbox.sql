IF EXISTS (
  SELECT 1 FROM dbo.pi_situation_outbox WITH (TABLOCKX, HOLDLOCK)
  WHERE applied_at IS NULL
)
BEGIN
  THROW 51000, 'Pending PI follow-up outbox work is durable and must be reconciled before rollback', 1;
END;

DROP INDEX IX_pi_message_owner_run_hash ON dbo.pi_message;
DROP INDEX IX_pi_situation_outbox_pending ON dbo.pi_situation_outbox;
DROP TABLE dbo.pi_situation_outbox;
