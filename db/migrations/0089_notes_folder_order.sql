-- Manual folder order in the Notes page (#1920): display metadata only, one row per folder in an owner's order for one
-- parent folder. A folder that is missing here sorts after the ordered ones; nothing in the vault is renamed or moved.
CREATE TABLE dbo.notes_folder_order (
  owner_object_id uniqueidentifier NOT NULL,
  parent_path nvarchar(180) COLLATE Latin1_General_100_BIN2 NOT NULL,
  folder_path nvarchar(180) COLLATE Latin1_General_100_BIN2 NOT NULL,
  position int NOT NULL,
  CONSTRAINT PK_notes_folder_order PRIMARY KEY (owner_object_id, parent_path, folder_path),
  CONSTRAINT UQ_notes_folder_order_position UNIQUE (owner_object_id, parent_path, position),
  CONSTRAINT CK_notes_folder_order_position CHECK (position >= 0),
  CONSTRAINT CK_notes_folder_order_folder CHECK (LEN(folder_path) > 0)
);
