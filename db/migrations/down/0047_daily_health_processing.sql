-- Called only inside the existing rollback transaction. Retain processing/recovery evidence.
DECLARE @evidence bigint;
SELECT @evidence=COUNT_BIG(*) FROM daily.health_upload_inbox WITH(TABLOCKX,HOLDLOCK)
  WHERE processing_attempts<>0 OR processing_next_attempt_at IS NOT NULL OR processing_error_code IS NOT NULL OR processing_status<>'pending';
IF @evidence<>0 THROW 51047,'Health processing rollback requires no processing evidence',1;
ALTER TABLE daily.health_upload_inbox DROP CONSTRAINT CK_daily_health_processing_error,CK_daily_health_processing_attempts,DF_daily_health_processing_attempts;
ALTER TABLE daily.health_upload_inbox DROP COLUMN processing_attempts,processing_next_attempt_at,processing_error_code;
