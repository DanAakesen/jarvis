CREATE TABLE dbo.proactive_conversation_context (
  owner_object_id uniqueidentifier NOT NULL,
  item_id uniqueidentifier NOT NULL,
  selected_at datetime2 NOT NULL,
  CONSTRAINT PK_proactive_conversation_context PRIMARY KEY (owner_object_id)
);
