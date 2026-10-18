CREATE TABLE dbo.proactive_todo_receipts (
  id uniqueidentifier NOT NULL CONSTRAINT PK_proactive_todo_receipts PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  item_id uniqueidentifier NULL,
  dedupe_key char(32) NOT NULL,
  day_key char(10) NOT NULL,
  run_id uniqueidentifier NOT NULL,
  status nvarchar(16) NOT NULL,
  reason nvarchar(64) NULL,
  commit_sha char(40) NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_proactive_todo_receipts_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_proactive_todo_receipts_day_key CHECK (day_key LIKE '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  CONSTRAINT CK_proactive_todo_receipts_status CHECK (status IN (N'added', N'skipped', N'failed'))
);
CREATE UNIQUE INDEX UX_proactive_todo_receipts_owner_dedupe_added
  ON dbo.proactive_todo_receipts (owner_object_id, dedupe_key)
  WHERE status = N'added';
CREATE INDEX IX_proactive_todo_receipts_owner_day_status
  ON dbo.proactive_todo_receipts (owner_object_id, day_key, status);
