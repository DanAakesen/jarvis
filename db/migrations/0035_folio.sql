CREATE TABLE dbo.folio_items (
  item_id nvarchar(80) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_folio_items PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  kind nvarchar(20) COLLATE Latin1_General_100_BIN2 NOT NULL,
  source_id uniqueidentifier NOT NULL,
  title nvarchar(200) NOT NULL,
  prompt_summary nvarchar(500) NOT NULL,
  created_at datetime2(7) NOT NULL,
  pinned bit NOT NULL CONSTRAINT DF_folio_items_pinned DEFAULT 0,
  payload_json nvarchar(max) NULL,
  CONSTRAINT UQ_folio_items_source UNIQUE (owner_object_id, kind, source_id),
  CONSTRAINT CK_folio_items_kind CHECK (kind IN (N'research', N'html_app', N'image', N'knowledge_graph')),
  CONSTRAINT CK_folio_items_payload CHECK (payload_json IS NULL OR ISJSON(payload_json) = 1)
);

CREATE INDEX IX_folio_items_owner_created
  ON dbo.folio_items (owner_object_id, pinned DESC, created_at DESC, item_id);

INSERT dbo.folio_items (item_id, owner_object_id, kind, source_id, title, prompt_summary, created_at, pinned)
SELECT N'html_app:' + CONVERT(nvarchar(36), artifact.id),
  artifact.owner_object_id,
  N'html_app',
  artifact.id,
  artifact.title,
  LEFT(artifact.title, 500),
  artifact.created_at,
  artifact.pinned
FROM dbo.workspace_html_artifacts AS artifact;

INSERT dbo.folio_items (item_id, owner_object_id, kind, source_id, title, prompt_summary, created_at)
SELECT N'image:' + CONVERT(nvarchar(36), artifact.id),
  artifact.owner_object_id,
  N'image',
  artifact.id,
  COALESCE(jobs.title, N'Generated image'),
  COALESCE(jobs.title, N'Generated image'),
  artifact.created_at
FROM dbo.workspace_artifacts AS artifact
OUTER APPLY (
  SELECT TOP (1) title
  FROM dbo.background_jobs
  WHERE kind = N'image'
    AND view_id = N'image-' + REPLACE(CONVERT(nvarchar(36), artifact.id), N'-', N'')
  ORDER BY started_at DESC
) AS jobs;
