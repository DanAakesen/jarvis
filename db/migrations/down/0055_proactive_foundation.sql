IF EXISTS (SELECT 1 FROM dbo.proactive_items WITH (TABLOCKX, HOLDLOCK)
  WHERE kind = N'finding' OR category IS NOT NULL OR urgency <> N'normal' OR due_at IS NOT NULL
    OR evidence_json IS NOT NULL OR state <> N'new' OR snoozed_until IS NOT NULL
    OR feedback IS NOT NULL OR run_id IS NOT NULL OR todo_added <> 0 OR language IS NOT NULL OR dedupe_key IS NOT NULL)
  OR EXISTS (SELECT 1 FROM dbo.proactive_settings WITH (TABLOCKX, HOLDLOCK))
  OR EXISTS (SELECT 1 FROM dbo.proactive_runs WITH (TABLOCKX, HOLDLOCK))
  OR EXISTS (SELECT 1 FROM dbo.proactive_source_status WITH (TABLOCKX, HOLDLOCK))
  OR EXISTS (SELECT 1 FROM dbo.proactive_spend WITH (TABLOCKX, HOLDLOCK))
BEGIN
  THROW 51000, 'Proactive records are durable evidence; cannot roll back while rows exist', 1;
END;

DROP INDEX UX_proactive_items_owner_dedupe_key ON dbo.proactive_items;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT CK_proactive_items_category;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT CK_proactive_items_urgency;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT CK_proactive_items_state;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT CK_proactive_items_feedback;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT CK_proactive_items_language;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT CK_proactive_items_dedupe_key;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT DF_proactive_items_urgency;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT DF_proactive_items_state;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT DF_proactive_items_todo_added;
ALTER TABLE dbo.proactive_items DROP COLUMN category, urgency, due_at, evidence_json, state,
  snoozed_until, feedback, run_id, todo_added, language, dedupe_key;
ALTER TABLE dbo.proactive_items DROP CONSTRAINT CK_proactive_items_kind;
ALTER TABLE dbo.proactive_items ADD CONSTRAINT CK_proactive_items_kind CHECK (kind = N'test');

DROP TABLE dbo.proactive_spend;
DROP TABLE dbo.proactive_source_status;
DROP TABLE dbo.proactive_runs;
DROP TABLE dbo.proactive_settings;
