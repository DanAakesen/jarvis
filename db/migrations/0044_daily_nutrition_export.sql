-- New export metadata only. Legacy queue credentials are never activated/imported.
ALTER TABLE daily.nutrition_queue ADD source_revision bigint NULL,
  claim_token uniqueidentifier NULL, claim_device_id nvarchar(256) COLLATE Latin1_General_100_BIN2 NULL,
  receipt_json nvarchar(4000) NULL, reconciliation_json nvarchar(2000) NULL;
CREATE TABLE daily.nutrition_export_requests (
  owner_object_id uniqueidentifier NOT NULL,
  id nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  from_at nvarchar(64) NOT NULL, to_at nvarchar(64) NOT NULL,
  queued_count int NOT NULL, skipped_count int NOT NULL, created_at nvarchar(64) NOT NULL,
  CONSTRAINT PK_daily_export_requests PRIMARY KEY(owner_object_id,id)
);
CREATE TABLE daily.nutrition_export_claims (
  owner_object_id uniqueidentifier NOT NULL,
  id nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  device_id nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  claim_token uniqueidentifier NOT NULL, claim_limit int NOT NULL,
  claimed_at nvarchar(64) NOT NULL, claim_expires_at nvarchar(64) NOT NULL,
  CONSTRAINT PK_daily_export_claims PRIMARY KEY(owner_object_id,id),
  CONSTRAINT CK_daily_export_claim_limit CHECK(claim_limit BETWEEN 1 AND 20)
);
