ALTER TABLE daily.nutrition_favorites ADD revision bigint NOT NULL
  CONSTRAINT DF_daily_nutrition_favorites_revision DEFAULT 1;
EXEC(N'ALTER TABLE daily.nutrition_favorites ADD CONSTRAINT CK_daily_nutrition_favorites_revision CHECK (revision >= 1);');
ALTER TABLE daily.nutrition_recommendation_feedback ADD revision bigint NOT NULL
  CONSTRAINT DF_daily_nutrition_feedback_revision DEFAULT 1;
EXEC(N'ALTER TABLE daily.nutrition_recommendation_feedback ADD CONSTRAINT CK_daily_nutrition_feedback_revision CHECK (revision >= 1);');
ALTER TABLE daily.nutrition_recommendation_feedback ALTER COLUMN preference nvarchar(256) NULL;

ALTER TABLE dbo.tool_calls DROP CONSTRAINT CK_tool_calls_identity;
ALTER TABLE dbo.tool_calls ADD CONSTRAINT CK_tool_calls_identity CHECK (
  (message_id IS NOT NULL AND connector_request_id IS NULL) OR
  (message_id IS NULL AND connector_request_id IS NOT NULL AND tool IN (
    N'daily_mcp_read_nutrition', N'daily_mcp_lookup_food', N'daily_mcp_log_food',
    N'daily_mcp_correct_food', N'daily_mcp_delete_food',
    N'daily_mcp_read_food_preferences', N'daily_mcp_manage_saved_food'
  ))
);
