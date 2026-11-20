CREATE TABLE dbo.pi_situation_outbox (
  owner_object_id uniqueidentifier NOT NULL,
  situation_revision bigint NOT NULL,
  actions_json nvarchar(max) NOT NULL,
  created_at datetime2(7) NOT NULL,
  applied_at datetime2(7) NULL,
  outcome nvarchar(200) NULL,
  CONSTRAINT PK_pi_situation_outbox PRIMARY KEY (owner_object_id, situation_revision),
  CONSTRAINT CK_pi_situation_outbox_revision CHECK (situation_revision >= 1),
  CONSTRAINT CK_pi_situation_outbox_actions CHECK (
    ISJSON(actions_json) = 1 AND DATALENGTH(actions_json) <= 32768
  ),
  CONSTRAINT CK_pi_situation_outbox_applied CHECK (
    (applied_at IS NULL AND outcome IS NULL)
    OR (applied_at IS NOT NULL AND outcome IS NOT NULL)
  )
);
CREATE INDEX IX_pi_situation_outbox_pending
  ON dbo.pi_situation_outbox (owner_object_id, applied_at, situation_revision);

CREATE INDEX IX_pi_message_owner_run_hash
  ON dbo.pi_message (owner_object_id, run_id, text_hash, at);
