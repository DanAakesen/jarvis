ALTER TABLE dbo.tasks ADD issue_delivery_id nvarchar(100) COLLATE Latin1_General_100_BIN2 NULL;
EXEC(N'CREATE UNIQUE INDEX UX_tasks_issue_delivery ON dbo.tasks (issue_delivery_id) WHERE issue_delivery_id IS NOT NULL;');

CREATE TABLE dbo.factory_issue_origins (
  repository nvarchar(140) NOT NULL,
  issue_number int NOT NULL,
  origin_message_id bigint NOT NULL CONSTRAINT FK_factory_issue_origins_messages REFERENCES dbo.messages (id) ON DELETE CASCADE,
  CONSTRAINT PK_factory_issue_origins PRIMARY KEY (repository, issue_number),
  CONSTRAINT CK_factory_issue_origins_number CHECK (issue_number > 0)
);
