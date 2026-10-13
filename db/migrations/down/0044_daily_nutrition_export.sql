-- Executed only in the existing migration rollback transaction. Never discard evidence.
DECLARE @count bigint;
SELECT @count=COUNT_BIG(*) FROM daily.nutrition_export_requests WITH(TABLOCKX,HOLDLOCK);
IF @count<>0 THROW 51044,'Export rollback requires empty request evidence',1;
SELECT @count=COUNT_BIG(*) FROM daily.nutrition_export_claims WITH(TABLOCKX,HOLDLOCK);
IF @count<>0 THROW 51044,'Export rollback requires empty claim evidence',1;
SELECT @count=COUNT_BIG(*) FROM daily.nutrition_meals WITH(TABLOCKX,HOLDLOCK);
SELECT @count=COUNT_BIG(*) FROM daily.nutrition_queue WITH(TABLOCKX,HOLDLOCK)
  WHERE source_revision IS NOT NULL OR claim_token IS NOT NULL OR claim_device_id IS NOT NULL OR receipt_json IS NOT NULL OR reconciliation_json IS NOT NULL;
IF @count<>0 THROW 51044,'Export rollback would lose snapshot or receipt evidence',1;
DROP TABLE daily.nutrition_export_claims;
DROP TABLE daily.nutrition_export_requests;
ALTER TABLE daily.nutrition_queue DROP COLUMN source_revision,claim_token,claim_device_id,receipt_json,reconciliation_json;
