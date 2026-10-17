IF EXISTS (SELECT 1 FROM dbo.tool_calls WITH (TABLOCKX,HOLDLOCK)
  WHERE connector_request_id IS NOT NULL AND tool IN (N'daily_mcp_read_food_preferences', N'daily_mcp_manage_saved_food'))
  THROW 51000, 'Saved-food connector audit evidence must be retained before reverting migration 0050.', 1;
IF EXISTS (SELECT 1 FROM daily.nutrition_favorites WITH (TABLOCKX,HOLDLOCK) WHERE revision <> 1) OR
   EXISTS (SELECT 1 FROM daily.nutrition_recommendation_feedback WITH (TABLOCKX,HOLDLOCK) WHERE revision <> 1 OR preference IS NULL)
  THROW 51000, 'Saved-food rollback cannot discard revisions or cleared preferences.', 1;

ALTER TABLE dbo.tool_calls DROP CONSTRAINT CK_tool_calls_identity;
ALTER TABLE dbo.tool_calls ADD CONSTRAINT CK_tool_calls_identity CHECK (
  (message_id IS NOT NULL AND connector_request_id IS NULL) OR
  (message_id IS NULL AND connector_request_id IS NOT NULL AND tool IN (
    N'daily_mcp_read_nutrition', N'daily_mcp_lookup_food', N'daily_mcp_log_food',
    N'daily_mcp_correct_food', N'daily_mcp_delete_food'
  ))
);
ALTER TABLE daily.nutrition_recommendation_feedback ALTER COLUMN preference nvarchar(256) NOT NULL;
ALTER TABLE daily.nutrition_recommendation_feedback DROP CONSTRAINT CK_daily_nutrition_feedback_revision;
ALTER TABLE daily.nutrition_recommendation_feedback DROP CONSTRAINT DF_daily_nutrition_feedback_revision;
ALTER TABLE daily.nutrition_recommendation_feedback DROP COLUMN revision;
ALTER TABLE daily.nutrition_favorites DROP CONSTRAINT CK_daily_nutrition_favorites_revision;
ALTER TABLE daily.nutrition_favorites DROP CONSTRAINT DF_daily_nutrition_favorites_revision;
ALTER TABLE daily.nutrition_favorites DROP COLUMN revision;
