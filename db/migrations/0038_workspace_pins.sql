CREATE TABLE dbo.workspace_pins (
  owner_object_id uniqueidentifier NOT NULL,
  view_id nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  view_json nvarchar(max) NOT NULL,
  pinned_at datetime2(7) NOT NULL CONSTRAINT DF_workspace_pins_pinned_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_workspace_pins PRIMARY KEY (owner_object_id, view_id),
  CONSTRAINT CK_workspace_pins_view CHECK (ISJSON(view_json) = 1)
);

CREATE INDEX IX_workspace_pins_owner_pinned_at
  ON dbo.workspace_pins (owner_object_id, pinned_at, view_id);
