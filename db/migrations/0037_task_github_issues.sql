ALTER TABLE dbo.tasks ADD issue_number int NULL;
EXEC(N'CREATE UNIQUE INDEX UX_tasks_active_project_issue
  ON dbo.tasks (project_id, issue_number)
  WHERE issue_number IS NOT NULL AND state <> N''Done'' AND state <> N''Cancelled'';');
