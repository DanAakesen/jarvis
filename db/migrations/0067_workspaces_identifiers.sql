EXEC sys.sp_rename N'dbo.folio_items', N'workspace_items', N'OBJECT';
EXEC sys.sp_rename N'dbo.PK_folio_items', N'PK_workspace_items', N'OBJECT';
EXEC sys.sp_rename N'dbo.DF_folio_items_pinned', N'DF_workspace_items_pinned', N'OBJECT';
EXEC sys.sp_rename N'dbo.UQ_folio_items_source', N'UQ_workspace_items_source', N'OBJECT';
EXEC sys.sp_rename N'dbo.CK_folio_items_kind', N'CK_workspace_items_kind', N'OBJECT';
EXEC sys.sp_rename N'dbo.CK_folio_items_payload', N'CK_workspace_items_payload', N'OBJECT';
EXEC sys.sp_rename N'dbo.workspace_items.IX_folio_items_owner_created', N'IX_workspace_items_owner_created', N'INDEX';
CREATE SYNONYM dbo.folio_items FOR dbo.workspace_items;

ALTER TABLE dbo.background_jobs
  ADD result_workspace_item_id nvarchar(80) COLLATE Latin1_General_100_BIN2 NULL;

EXEC(N'UPDATE dbo.background_jobs
  SET result_workspace_item_id = result_folio_id
  WHERE result_folio_id IS NOT NULL;');

ALTER TABLE dbo.background_jobs
  DROP CONSTRAINT CK_background_jobs_research_result;

EXEC(N'ALTER TABLE dbo.background_jobs
  ADD CONSTRAINT CK_background_jobs_workspace_result CHECK (
    (result_workspace_item_id IS NULL AND result_folio_id IS NULL AND result_delivery_status IS NULL) OR
    (kind = N''research'' AND status = N''done'' AND
      (result_workspace_item_id IS NULL OR
        (LEN(result_workspace_item_id) = 45 AND LEFT(result_workspace_item_id, 9) = N''research:'' AND
         TRY_CONVERT(uniqueidentifier, SUBSTRING(result_workspace_item_id, 10, 36)) IS NOT NULL AND
         result_workspace_item_id = LOWER(result_workspace_item_id))) AND
      (result_folio_id IS NULL OR
        (LEN(result_folio_id) = 45 AND LEFT(result_folio_id, 9) = N''research:'' AND
         TRY_CONVERT(uniqueidentifier, SUBSTRING(result_folio_id, 10, 36)) IS NOT NULL AND
         result_folio_id = LOWER(result_folio_id))) AND
      ((COALESCE(result_workspace_item_id, result_folio_id) IS NOT NULL AND
        result_delivery_status IN (N''pending'', N''unknown'', N''failed'', N''delivered'')) OR
       (result_delivery_status IS NULL AND
        (result_workspace_item_id IS NULL OR result_folio_id IS NULL))))
  );');

EXEC(N'CREATE TRIGGER dbo.TR_background_jobs_workspace_result_compat
ON dbo.background_jobs
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF TRIGGER_NESTLEVEL() > 1 RETURN;

  IF NOT EXISTS (SELECT 1 FROM deleted)
  BEGIN
    IF EXISTS (SELECT 1 FROM inserted
      WHERE result_workspace_item_id IS NOT NULL AND result_folio_id IS NOT NULL
        AND result_workspace_item_id <> result_folio_id)
      THROW 51000, N''Workspaces result identifiers must match.'', 1;
    UPDATE job
      SET result_workspace_item_id = COALESCE(inserted.result_workspace_item_id, inserted.result_folio_id),
          result_folio_id = COALESCE(inserted.result_workspace_item_id, inserted.result_folio_id)
      FROM dbo.background_jobs AS job
      INNER JOIN inserted ON inserted.job_id = job.job_id
      WHERE (inserted.result_workspace_item_id IS NULL AND inserted.result_folio_id IS NOT NULL)
         OR (inserted.result_workspace_item_id IS NOT NULL AND inserted.result_folio_id IS NULL);
    RETURN;
  END;

  IF UPDATE(result_workspace_item_id) AND UPDATE(result_folio_id)
  BEGIN
    IF EXISTS (SELECT 1 FROM inserted
      WHERE result_workspace_item_id IS NOT NULL AND result_folio_id IS NOT NULL
        AND result_workspace_item_id <> result_folio_id)
      THROW 51000, N''Workspaces result identifiers must match.'', 1;
    UPDATE job
      SET result_workspace_item_id = CASE WHEN inserted.result_delivery_status IS NULL
            THEN NULL ELSE COALESCE(inserted.result_workspace_item_id, inserted.result_folio_id) END,
          result_folio_id = CASE WHEN inserted.result_delivery_status IS NULL
            THEN NULL ELSE COALESCE(inserted.result_workspace_item_id, inserted.result_folio_id) END
      FROM dbo.background_jobs AS job
      INNER JOIN inserted ON inserted.job_id = job.job_id
      WHERE (inserted.result_workspace_item_id IS NULL AND inserted.result_folio_id IS NOT NULL)
         OR (inserted.result_workspace_item_id IS NOT NULL AND inserted.result_folio_id IS NULL);
    RETURN;
  END;

  IF UPDATE(result_workspace_item_id)
    UPDATE job
      SET result_folio_id = inserted.result_workspace_item_id,
          result_delivery_status = CASE WHEN inserted.result_workspace_item_id IS NULL
            THEN NULL ELSE inserted.result_delivery_status END
      FROM dbo.background_jobs AS job INNER JOIN inserted ON inserted.job_id = job.job_id;
  ELSE IF UPDATE(result_folio_id)
    UPDATE job
      SET result_workspace_item_id = inserted.result_folio_id,
          result_delivery_status = CASE WHEN inserted.result_folio_id IS NULL
            THEN NULL ELSE inserted.result_delivery_status END
      FROM dbo.background_jobs AS job INNER JOIN inserted ON inserted.job_id = job.job_id;
END;');
