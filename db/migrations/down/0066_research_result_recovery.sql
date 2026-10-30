ALTER TABLE dbo.background_jobs DROP CONSTRAINT CK_background_jobs_research_result;
ALTER TABLE dbo.background_jobs DROP COLUMN result_folio_id, result_delivery_status;
