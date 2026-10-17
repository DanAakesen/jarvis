BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM dbo.factory_task_submissions WITH (TABLOCKX, HOLDLOCK))
BEGIN
  ROLLBACK TRANSACTION;
  THROW 51000, 'Task submission retry evidence must be retained; cannot roll back while submissions exist', 1;
END;
DROP TABLE dbo.factory_task_submissions;
COMMIT TRANSACTION;
