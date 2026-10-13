-- Inactive P12-04 acceptance boundary. No device credentials or source records are seeded.
CREATE TABLE daily.health_upload_capabilities (
  owner_object_id uniqueidentifier NOT NULL,
  token_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  device_id nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  can_ingest bit NOT NULL, can_heartbeat bit NOT NULL,
  expires_at datetime2(3) NOT NULL, revoked bit NOT NULL,
  replacement_reference char(64) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT PK_daily_health_upload_capabilities PRIMARY KEY(owner_object_id,token_hash),
  CONSTRAINT CK_daily_health_upload_capability_scope CHECK(can_ingest=1 OR can_heartbeat=1),
  CONSTRAINT CK_daily_health_upload_capability_hash CHECK(LEN(token_hash)=64 AND token_hash NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT CK_daily_health_upload_rotation CHECK(replacement_reference IS NULL OR (revoked=1 AND LEN(replacement_reference)=64 AND replacement_reference<>token_hash AND replacement_reference NOT LIKE '%[^0-9a-f]%'))
);
CREATE TABLE daily.health_upload_inbox (
  owner_object_id uniqueidentifier NOT NULL,
  session_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  acceptance_id uniqueidentifier NOT NULL,
  capability_reference char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  device_id nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  kind varchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  automation_id nvarchar(1024) COLLATE Latin1_General_100_BIN2 NOT NULL,
  session_id nvarchar(1024) COLLATE Latin1_General_100_BIN2 NOT NULL,
  checksum char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  byte_count int NOT NULL, raw_bytes varbinary(max) NOT NULL,
  accepted_at datetime2(3) NOT NULL,
  processing_status varchar(16) NOT NULL CONSTRAINT DF_daily_health_upload_pending DEFAULT 'pending',
  processed_at datetime2(3) NULL,
  CONSTRAINT PK_daily_health_upload_inbox PRIMARY KEY(owner_object_id,session_hash),
  CONSTRAINT UQ_daily_health_upload_acceptance UNIQUE(owner_object_id,acceptance_id),
  CONSTRAINT FK_daily_health_upload_capability FOREIGN KEY(owner_object_id,capability_reference) REFERENCES daily.health_upload_capabilities(owner_object_id,token_hash),
  CONSTRAINT CK_daily_health_upload_kind CHECK(kind IN('upload','heartbeat')),
  CONSTRAINT CK_daily_health_upload_bytes CHECK(byte_count BETWEEN 1 AND 8388608 AND DATALENGTH(raw_bytes)=byte_count AND (kind<>'heartbeat' OR byte_count<=32768)),
  CONSTRAINT CK_daily_health_upload_checksum CHECK(LEN(checksum)=64 AND LEN(session_hash)=64 AND checksum NOT LIKE '%[^0-9a-f]%' AND session_hash NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT CK_daily_health_upload_processing CHECK((processing_status IN('pending','quarantined') AND processed_at IS NULL) OR (processing_status='processed' AND processed_at IS NOT NULL))
);
CREATE INDEX IX_daily_health_upload_pending ON daily.health_upload_inbox(owner_object_id,processing_status,accepted_at);
