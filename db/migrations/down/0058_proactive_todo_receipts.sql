IF EXISTS (SELECT 1 FROM dbo.proactive_todo_receipts WITH (TABLOCKX, HOLDLOCK))
  THROW 51000, 'Proactive todo receipts are durable evidence and must be retained.', 1;
DROP TABLE dbo.proactive_todo_receipts;
