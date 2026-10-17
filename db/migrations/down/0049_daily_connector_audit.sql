IF EXISTS (SELECT 1 FROM dbo.tool_calls WITH (TABLOCKX,HOLDLOCK) WHERE connector_request_id IS NOT NULL)
  THROW 51000, 'Daily connector audit evidence must be retained before reverting migration 0049.', 1;

ALTER TABLE dbo.tool_calls DROP CONSTRAINT CK_tool_calls_identity;
DROP INDEX IX_tool_calls_message_id ON dbo.tool_calls;
ALTER TABLE dbo.tool_calls ALTER COLUMN message_id bigint NOT NULL;
CREATE INDEX IX_tool_calls_message_id ON dbo.tool_calls (message_id);
ALTER TABLE dbo.tool_calls DROP COLUMN connector_request_id;
