IF EXISTS (SELECT 1 FROM dbo.owner_reminder_schedules WITH (TABLOCKX, HOLDLOCK))
  THROW 51000, 'Owner reminder schedules must be retained before rollback', 1;
DROP TABLE dbo.owner_reminder_schedules;
IF EXISTS (SELECT 1 FROM dbo.proactive_items WITH (TABLOCKX, HOLDLOCK) WHERE owner_requested = 1)
  THROW 51000, 'Owner-requested reminder items must be retained before rollback', 1;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT DF_proactive_items_owner_requested;
ALTER TABLE dbo.proactive_items DROP COLUMN owner_requested;
