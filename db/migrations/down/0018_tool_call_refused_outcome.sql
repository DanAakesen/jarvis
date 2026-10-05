IF EXISTS (SELECT 1 FROM dbo.tool_calls WHERE outcome = N'refused')
  THROW 51000, 'Refused tool calls must be retained before reverting migration 0018.', 1;

ALTER TABLE dbo.tool_calls DROP CONSTRAINT CK_tool_calls_outcome;
ALTER TABLE dbo.tool_calls ADD CONSTRAINT CK_tool_calls_outcome
  CHECK (outcome IN (N'ok', N'error'));
