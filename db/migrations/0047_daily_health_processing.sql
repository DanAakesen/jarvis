-- Inactive P12-05 bounded retry/lease evidence on the existing SQL inbox only.
ALTER TABLE daily.health_upload_inbox ADD
  processing_attempts int NOT NULL CONSTRAINT DF_daily_health_processing_attempts DEFAULT 0,
  processing_next_attempt_at datetime2(3) NULL,
  processing_error_code varchar(64) NULL;
-- Compile references only after the columns exist (the runner executes one batch per migration).
EXEC(N'ALTER TABLE daily.health_upload_inbox ADD CONSTRAINT CK_daily_health_processing_attempts CHECK(processing_attempts BETWEEN 0 AND 3)');
EXEC(N'ALTER TABLE daily.health_upload_inbox ADD CONSTRAINT CK_daily_health_processing_error CHECK(processing_error_code IS NULL OR processing_error_code IN(
  ''interrupted'',''retry_exhausted'',''invalid_payload'',''invalid_timestamp'',''invalid_identifier'',''payload_complexity'',''conflicting_workout'',''unsupported_unit''))');
