-- Expose an in-flight processing state while retaining recoverable claim deadlines.
ALTER TABLE daily.health_upload_inbox DROP CONSTRAINT CK_daily_health_upload_processing;
ALTER TABLE daily.health_upload_inbox ADD CONSTRAINT CK_daily_health_upload_processing CHECK(
  (processing_status IN('pending','quarantined') AND processed_at IS NULL) OR
  (processing_status='processing' AND processed_at IS NULL AND processing_next_attempt_at IS NOT NULL) OR
  (processing_status='processed' AND processed_at IS NOT NULL)
);
