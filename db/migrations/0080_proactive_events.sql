CREATE TABLE dbo.proactive_events (
  id uniqueidentifier NOT NULL CONSTRAINT PK_proactive_events PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  source nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  kind nvarchar(96) COLLATE Latin1_General_100_BIN2 NOT NULL,
  dedupe_key nvarchar(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  summary nvarchar(400) NOT NULL,
  detail_json nvarchar(max) NOT NULL,
  occurred_at datetime2(7) NOT NULL,
  received_at datetime2(7) NOT NULL CONSTRAINT DF_proactive_events_received_at DEFAULT SYSUTCDATETIME(),
  attempts int NOT NULL CONSTRAINT DF_proactive_events_attempts DEFAULT 0,
  claimed_until datetime2(7) NULL,
  retry_at datetime2(7) NULL,
  processed_at datetime2(7) NULL,
  outcome nvarchar(400) NULL,
  batch_id uniqueidentifier NULL,
  CONSTRAINT UQ_proactive_events_dedupe UNIQUE (owner_object_id, dedupe_key),
  CONSTRAINT CK_proactive_events_detail CHECK (ISJSON(detail_json) = 1),
  CONSTRAINT CK_proactive_events_attempts CHECK (attempts >= 0)
);
CREATE INDEX IX_proactive_events_queue
  ON dbo.proactive_events (owner_object_id, processed_at, received_at);

CREATE TABLE dbo.proactive_outreach (
  id uniqueidentifier NOT NULL CONSTRAINT PK_proactive_outreach PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  tier nvarchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL,
  title nvarchar(80) NOT NULL,
  body nvarchar(400) NOT NULL,
  why nvarchar(400) NOT NULL,
  category nvarchar(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  event_ids_json nvarchar(max) NOT NULL,
  batch_id uniqueidentifier NOT NULL,
  item_id uniqueidentifier NULL,
  delivery_json nvarchar(max) NOT NULL CONSTRAINT DF_proactive_outreach_delivery DEFAULT N'[]',
  pushed_at datetime2(7) NULL,
  rating nvarchar(8) COLLATE Latin1_General_100_BIN2 NULL,
  rated_at datetime2(7) NULL,
  rating_note nvarchar(400) NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_proactive_outreach_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_proactive_outreach_tier CHECK (tier IN (N'low', N'medium', N'high')),
  CONSTRAINT CK_proactive_outreach_rating CHECK (rating IS NULL OR rating IN (N'up', N'down')),
  CONSTRAINT CK_proactive_outreach_event_ids CHECK (ISJSON(event_ids_json) = 1),
  CONSTRAINT CK_proactive_outreach_delivery CHECK (ISJSON(delivery_json) = 1)
);
CREATE INDEX IX_proactive_outreach_owner_created
  ON dbo.proactive_outreach (owner_object_id, created_at DESC);
CREATE INDEX IX_proactive_outreach_item
  ON dbo.proactive_outreach (item_id);
