DROP TRIGGER dbo.TR_background_jobs_workspace_result_compat;

ALTER TABLE dbo.background_jobs
  DROP CONSTRAINT CK_background_jobs_workspace_result;

ALTER TABLE dbo.background_jobs
  ADD CONSTRAINT CK_background_jobs_research_result CHECK (
    (result_folio_id IS NULL AND result_delivery_status IS NULL) OR
    (kind = N'research' AND status = N'done' AND
      LEN(result_folio_id) = 45 AND LEFT(result_folio_id, 9) = N'research:' AND
      TRY_CONVERT(uniqueidentifier, SUBSTRING(result_folio_id, 10, 36)) IS NOT NULL AND
      result_folio_id = LOWER(result_folio_id) AND
      result_delivery_status IN (N'pending', N'unknown', N'failed', N'delivered'))
  );

ALTER TABLE dbo.background_jobs DROP COLUMN result_workspace_item_id;

DROP SYNONYM dbo.folio_items;
EXEC sys.sp_rename N'dbo.workspace_items.IX_workspace_items_owner_created', N'IX_folio_items_owner_created', N'INDEX';
EXEC sys.sp_rename N'dbo.CK_workspace_items_payload', N'CK_folio_items_payload', N'OBJECT';
EXEC sys.sp_rename N'dbo.CK_workspace_items_kind', N'CK_folio_items_kind', N'OBJECT';
EXEC sys.sp_rename N'dbo.UQ_workspace_items_source', N'UQ_folio_items_source', N'OBJECT';
EXEC sys.sp_rename N'dbo.DF_workspace_items_pinned', N'DF_folio_items_pinned', N'OBJECT';
EXEC sys.sp_rename N'dbo.PK_workspace_items', N'PK_folio_items', N'OBJECT';
EXEC sys.sp_rename N'dbo.workspace_items', N'folio_items', N'OBJECT';
