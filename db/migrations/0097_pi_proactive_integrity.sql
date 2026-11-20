ALTER TABLE dbo.proactive_events ADD
  identity_key nvarchar(200) COLLATE Latin1_General_100_BIN2 NULL,
  material_hash char(64) COLLATE Latin1_General_100_BIN2 NULL,
  not_before_at datetime2(7) NULL,
  CONSTRAINT CK_proactive_events_identity CHECK (
    identity_key IS NULL OR LEN(identity_key) > 0
  ),
  CONSTRAINT CK_proactive_events_material_hash CHECK (
    material_hash IS NULL OR LEN(material_hash) = 64
  );
EXEC(N'CREATE UNIQUE INDEX UX_proactive_events_owner_active_identity
  ON dbo.proactive_events (owner_object_id, identity_key)
  WHERE identity_key IS NOT NULL AND processed_at IS NULL;
  CREATE INDEX IX_proactive_events_owner_due
    ON dbo.proactive_events
      (owner_object_id, processed_at, not_before_at, retry_at, claimed_until, received_at);');

ALTER TABLE dbo.pi_message ADD
  owner_object_id uniqueidentifier NULL,
  message_text nvarchar(1500) NULL,
  evidence_json nvarchar(max) NOT NULL
    CONSTRAINT DF_pi_message_evidence_json DEFAULT N'[]',
  follow_up_ids_json nvarchar(max) NOT NULL
    CONSTRAINT DF_pi_message_follow_up_ids_json DEFAULT N'[]',
  CONSTRAINT CK_pi_message_text CHECK (message_text IS NULL OR LEN(message_text) BETWEEN 1 AND 1500),
  CONSTRAINT CK_pi_message_evidence_json CHECK (
    ISJSON(evidence_json) = 1 AND DATALENGTH(evidence_json) <= 8192
  ),
  CONSTRAINT CK_pi_message_follow_up_ids_json CHECK (
    ISJSON(follow_up_ids_json) = 1 AND DATALENGTH(follow_up_ids_json) <= 4096
  ),
  CONSTRAINT CK_pi_message_delivery_owner CHECK (
    owner_object_id IS NOT NULL OR
    (message_text IS NULL AND evidence_json = N'[]' AND follow_up_ids_json = N'[]')
  );
EXEC(N'IF (
    SELECT COUNT_BIG(*) FROM dbo.pi_switch
  ) = 1
  BEGIN
    UPDATE message
      SET owner_object_id = only_owner.owner_object_id
    FROM dbo.pi_message AS message
    CROSS JOIN (
      SELECT TOP (1) owner_object_id FROM dbo.pi_switch
    ) AS only_owner
    WHERE message.owner_object_id IS NULL;
  END;
  CREATE INDEX IX_pi_message_owner_at
    ON dbo.pi_message (owner_object_id, at DESC);');
