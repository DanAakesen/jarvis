IF EXISTS (
  SELECT 1
  FROM dbo.proactive_settings AS settings
  WHERE suggestion_scope <> N'all'
     OR ISJSON(categories_json) <> 1
     OR (SELECT COUNT(*) FROM OPENJSON(
       CASE WHEN ISJSON(categories_json) = 1 THEN categories_json ELSE N'{}' END
     )) <> 9
     OR EXISTS (
       SELECT 1
       FROM OPENJSON(CASE WHEN ISJSON(categories_json) = 1 THEN categories_json ELSE N'{}' END)
       WHERE [key] NOT IN (N'deadline', N'clash', N'travel', N'todo', N'prep', N'news', N'weather', N'status', N'suggestion')
          OR [value] <> N'true'
     )
)
  OR EXISTS (
    SELECT 1
    FROM dbo.proactive_items AS item
    WHERE suggestion_scope <> N'unknown'
       OR EXISTS (
         SELECT 1
         FROM OPENJSON(
           CASE WHEN ISJSON(evidence_json) = 1 THEN evidence_json ELSE N'{}' END, '$.relatedCategories'
         )
       )
  )
BEGIN
  THROW 51000, 'Proactive suggestion preferences and classifications are durable settings; retain them before rollback', 1;
END;

ALTER TABLE dbo.proactive_items DROP CONSTRAINT CK_proactive_items_suggestion_scope;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT DF_proactive_items_suggestion_scope;
ALTER TABLE dbo.proactive_items DROP COLUMN suggestion_scope;

ALTER TABLE dbo.proactive_settings DROP CONSTRAINT CK_proactive_settings_categories_json;
ALTER TABLE dbo.proactive_settings DROP CONSTRAINT CK_proactive_settings_suggestion_scope;
ALTER TABLE dbo.proactive_settings DROP CONSTRAINT DF_proactive_settings_categories_json;
ALTER TABLE dbo.proactive_settings DROP CONSTRAINT DF_proactive_settings_suggestion_scope;
ALTER TABLE dbo.proactive_settings DROP COLUMN categories_json, suggestion_scope;
