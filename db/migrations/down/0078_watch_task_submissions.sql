IF EXISTS (SELECT 1 FROM dbo.watch_task_submissions)
  THROW 51000, 'Watch task submission receipts must be retained for duplicate-write protection; remove them explicitly before rollback.', 1;
DROP TABLE dbo.watch_task_submissions;
