CREATE TABLE dbo.inbox_items (
  item_id varchar(32) NOT NULL,
  path nvarchar(260) NULL,
  sha char(40) NULL,
  last_nudged_at datetime2(7) NULL,
  last_feedback varchar(4) NULL,
  last_feedback_at datetime2(7) NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_inbox_items_created DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(7) NOT NULL CONSTRAINT DF_inbox_items_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_inbox_items PRIMARY KEY (item_id),
  CONSTRAINT CK_inbox_items_id CHECK (LEN(item_id) BETWEEN 8 AND 32 AND item_id NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT CK_inbox_items_sha CHECK (sha IS NULL OR sha NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT CK_inbox_items_location CHECK ((path IS NULL AND sha IS NULL) OR (path IS NOT NULL AND sha IS NOT NULL)),
  CONSTRAINT CK_inbox_items_feedback CHECK (
    (last_feedback IS NULL AND last_feedback_at IS NULL) OR
    (last_feedback IN ('up', 'down') AND last_feedback_at IS NOT NULL))
);
CREATE INDEX IX_inbox_items_path ON dbo.inbox_items (path) WHERE path IS NOT NULL;
