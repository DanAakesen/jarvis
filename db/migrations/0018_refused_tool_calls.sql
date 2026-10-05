ALTER TABLE dbo.tool_calls DROP CONSTRAINT CK_tool_calls_outcome;

ALTER TABLE dbo.tool_calls
  ADD CONSTRAINT CK_tool_calls_outcome CHECK (outcome IN (N'ok', N'refused', N'error'));
