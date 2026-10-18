IF EXISTS(SELECT 1 FROM daily.health_upload_inbox WHERE processing_status='processing')
  THROW 51060,'Cannot revert while health processing claims exist',1;
ALTER TABLE daily.health_upload_inbox DROP CONSTRAINT CK_daily_health_upload_processing;
ALTER TABLE daily.health_upload_inbox ADD CONSTRAINT CK_daily_health_upload_processing CHECK(
  (processing_status IN('pending','quarantined') AND processed_at IS NULL) OR
  (processing_status='processed' AND processed_at IS NOT NULL)
);
