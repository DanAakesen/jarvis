ALTER TABLE dbo.tool_calls ADD connector_request_id uniqueidentifier NULL;
ALTER TABLE dbo.tool_calls ALTER COLUMN message_id bigint NULL;
EXEC(N'ALTER TABLE dbo.tool_calls ADD CONSTRAINT CK_tool_calls_identity CHECK (
  (message_id IS NOT NULL AND connector_request_id IS NULL) OR
  (message_id IS NULL AND connector_request_id IS NOT NULL AND tool IN (
    N''daily_mcp_read_nutrition'', N''daily_mcp_lookup_food'', N''daily_mcp_log_food'',
    N''daily_mcp_correct_food'', N''daily_mcp_delete_food''
  ))
);');
