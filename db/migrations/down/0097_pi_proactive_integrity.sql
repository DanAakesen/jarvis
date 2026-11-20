IF EXISTS (
  SELECT 1 FROM dbo.proactive_events WITH (TABLOCKX, HOLDLOCK)
  WHERE identity_key IS NOT NULL OR material_hash IS NOT NULL OR not_before_at IS NOT NULL
)
BEGIN
  THROW 51000, 'PI event identities and scheduled follow-ups are durable queue state; retain them before rollback', 1;
END;

IF EXISTS (
  SELECT 1 FROM dbo.pi_message WITH (TABLOCKX, HOLDLOCK)
  WHERE owner_object_id IS NOT NULL OR message_text IS NOT NULL
    OR evidence_json <> N'[]' OR follow_up_ids_json <> N'[]'
)
BEGIN
  THROW 51000, 'PI proactive delivery context is durable continuation evidence; retain it before rollback', 1;
END;

DROP INDEX IX_pi_message_owner_at ON dbo.pi_message;
ALTER TABLE dbo.pi_message DROP CONSTRAINT CK_pi_message_delivery_owner;
ALTER TABLE dbo.pi_message DROP CONSTRAINT CK_pi_message_follow_up_ids_json;
ALTER TABLE dbo.pi_message DROP CONSTRAINT CK_pi_message_evidence_json;
ALTER TABLE dbo.pi_message DROP CONSTRAINT CK_pi_message_text;
ALTER TABLE dbo.pi_message DROP CONSTRAINT DF_pi_message_follow_up_ids_json;
ALTER TABLE dbo.pi_message DROP CONSTRAINT DF_pi_message_evidence_json;
ALTER TABLE dbo.pi_message DROP COLUMN
  follow_up_ids_json, evidence_json, message_text, owner_object_id;

DROP INDEX IX_proactive_events_owner_due ON dbo.proactive_events;
DROP INDEX UX_proactive_events_owner_active_identity ON dbo.proactive_events;
ALTER TABLE dbo.proactive_events DROP CONSTRAINT CK_proactive_events_material_hash;
ALTER TABLE dbo.proactive_events DROP CONSTRAINT CK_proactive_events_identity;
ALTER TABLE dbo.proactive_events DROP COLUMN
  not_before_at, material_hash, identity_key;
