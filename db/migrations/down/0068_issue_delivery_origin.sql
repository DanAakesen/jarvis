DROP TABLE dbo.factory_issue_origins;
DROP INDEX UX_tasks_issue_delivery ON dbo.tasks;
ALTER TABLE dbo.tasks DROP COLUMN issue_delivery_id;
