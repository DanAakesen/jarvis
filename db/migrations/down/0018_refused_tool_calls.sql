IF EXISTS (SELECT 1 FROM dbo.tool_calls WHERE outcome = N'refused')
  THROW 51000, 'Cannot remove refused tool-call outcomes while refused calls are stored', 1;

ALTER TABLE dbo.tool_calls DROP CONSTRAINT CK_tool_calls_outcome;

ALTER TABLE dbo.tool_calls
  ADD CONSTRAINT CK_tool_calls_outcome CHECK (outcome IN (N'ok', N'error'));
