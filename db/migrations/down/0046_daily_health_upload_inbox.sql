-- Only inside the migration rollback transaction. Never discard accepted/private evidence.
DECLARE @count bigint;
SELECT @count=COUNT_BIG(*) FROM daily.health_upload_inbox WITH(TABLOCKX,HOLDLOCK);
IF @count<>0 THROW 51046,'Health upload rollback requires an empty inbox',1;
SELECT @count=COUNT_BIG(*) FROM daily.health_upload_capabilities WITH(TABLOCKX,HOLDLOCK);
IF @count<>0 THROW 51046,'Health upload rollback requires empty capability evidence',1;
DROP TABLE daily.health_upload_inbox;
DROP TABLE daily.health_upload_capabilities;
