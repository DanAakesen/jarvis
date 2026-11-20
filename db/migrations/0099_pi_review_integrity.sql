ALTER TABLE dbo.proactive_events ADD
  reopenable bit NOT NULL
    CONSTRAINT DF_proactive_events_reopenable DEFAULT 0;

ALTER TABLE dbo.proactive_source_status ADD
  invalidated_at datetime2(7) NULL;

ALTER TABLE dbo.proactive_event_batches ADD
  policy_revision char(64) COLLATE Latin1_General_100_BIN2 NULL,
  month_key char(7) COLLATE Latin1_General_100_BIN2 NULL,
  reserved_dkk decimal(9,4) NOT NULL
    CONSTRAINT DF_proactive_event_batches_reserved_dkk DEFAULT 0,
  actual_dkk decimal(9,4) NULL,
  reconciled_at datetime2(7) NULL,
  CONSTRAINT CK_proactive_event_batches_policy_revision
    CHECK (policy_revision IS NULL OR LEN(policy_revision) = 64),
  CONSTRAINT CK_proactive_event_batches_month_key
    CHECK (month_key IS NULL OR month_key LIKE '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  CONSTRAINT CK_proactive_event_batches_cost
    CHECK (reserved_dkk >= 0 AND (actual_dkk IS NULL OR actual_dkk >= 0)),
  CONSTRAINT CK_proactive_event_batches_reconciliation
    CHECK ((actual_dkk IS NULL AND reconciled_at IS NULL)
      OR (actual_dkk IS NOT NULL AND reconciled_at IS NOT NULL));

CREATE TABLE dbo.pi_situation_ref_authority (
  owner_object_id uniqueidentifier NOT NULL,
  source_id nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  ref_id nvarchar(120) COLLATE Latin1_General_100_BIN2 NOT NULL,
  provider_identity nvarchar(240) NOT NULL,
  label nvarchar(160) NOT NULL,
  observed_at datetime2(7) NOT NULL,
  expires_at datetime2(7) NULL,
  material_hash char(64) COLLATE Latin1_General_100_BIN2 NULL,
  verified_at datetime2(7) NOT NULL,
  CONSTRAINT PK_pi_situation_ref_authority PRIMARY KEY (owner_object_id, source_id, ref_id),
  CONSTRAINT CK_pi_situation_ref_authority_source CHECK (source_id IN (
    N'todos', N'calendar', N'mail', N'weather', N'factory', N'news', N'travel',
    N'x', N'health', N'nutrition', N'notes', N'memory', N'location'
  )),
  CONSTRAINT CK_pi_situation_ref_authority_hash CHECK (
    material_hash IS NULL OR LEN(material_hash) = 64
  )
);
CREATE INDEX IX_pi_situation_ref_authority_owner_source
  ON dbo.pi_situation_ref_authority (owner_object_id, source_id, verified_at DESC);
