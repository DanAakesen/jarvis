ALTER TABLE dbo.background_jobs
  ADD result_folio_id nvarchar(80) COLLATE Latin1_General_100_BIN2 NULL,
  result_delivery_status nvarchar(16) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT CK_background_jobs_research_result CHECK (
    (result_folio_id IS NULL AND result_delivery_status IS NULL) OR
    (kind = N'research' AND status = N'done' AND
      LEN(result_folio_id) = 45 AND LEFT(result_folio_id, 9) = N'research:' AND
      TRY_CONVERT(uniqueidentifier, SUBSTRING(result_folio_id, 10, 36)) IS NOT NULL AND
      result_folio_id = LOWER(result_folio_id) AND
      result_delivery_status IN (N'pending', N'unknown', N'failed', N'delivered'))
  );
