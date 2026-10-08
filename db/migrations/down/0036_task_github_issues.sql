DROP INDEX UX_tasks_active_project_issue ON dbo.tasks;
ALTER TABLE dbo.tasks DROP COLUMN issue_number;
