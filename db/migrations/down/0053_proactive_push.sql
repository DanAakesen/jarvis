BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM dbo.push_vapid_keys WITH (TABLOCKX, HOLDLOCK))
   OR EXISTS (SELECT 1 FROM dbo.push_subscriptions WITH (TABLOCKX, HOLDLOCK))
   OR EXISTS (SELECT 1 FROM dbo.proactive_items WITH (TABLOCKX, HOLDLOCK))
BEGIN
  ROLLBACK TRANSACTION;
  THROW 51000, 'Push keys, subscriptions and proactive items are durable evidence; cannot roll back while rows exist', 1;
END;
DROP TABLE dbo.proactive_items;
DROP TABLE dbo.push_subscriptions;
DROP TABLE dbo.push_vapid_keys;
COMMIT TRANSACTION;
