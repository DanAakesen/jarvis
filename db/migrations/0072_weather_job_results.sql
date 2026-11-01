ALTER TABLE dbo.background_jobs DROP CONSTRAINT CK_background_jobs_workspace_result;

ALTER TABLE dbo.background_jobs
  ADD CONSTRAINT CK_background_jobs_workspace_result CHECK (
    (result_workspace_item_id IS NULL AND result_folio_id IS NULL AND result_delivery_status IS NULL) OR
    (kind IN (N'research', N'html_app') AND status = N'done' AND
      (result_workspace_item_id IS NULL OR
        (LEN(result_workspace_item_id) = 45 AND
         LEFT(result_workspace_item_id, 9) = CASE kind WHEN N'research' THEN N'research:' ELSE N'html_app:' END AND
         TRY_CONVERT(uniqueidentifier, SUBSTRING(result_workspace_item_id, 10, 36)) IS NOT NULL AND
         result_workspace_item_id = LOWER(result_workspace_item_id))) AND
      (result_folio_id IS NULL OR
        (LEN(result_folio_id) = 45 AND
         LEFT(result_folio_id, 9) = CASE kind WHEN N'research' THEN N'research:' ELSE N'html_app:' END AND
         TRY_CONVERT(uniqueidentifier, SUBSTRING(result_folio_id, 10, 36)) IS NOT NULL AND
         result_folio_id = LOWER(result_folio_id))) AND
      ((COALESCE(result_workspace_item_id, result_folio_id) IS NOT NULL AND
        result_delivery_status IN (N'pending', N'unknown', N'failed', N'delivered')) OR
       (result_delivery_status IS NULL AND
        (result_workspace_item_id IS NULL OR result_folio_id IS NULL))))
  );
