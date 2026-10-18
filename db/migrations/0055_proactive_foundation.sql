ALTER TABLE dbo.proactive_items DROP CONSTRAINT CK_proactive_items_kind;
ALTER TABLE dbo.proactive_items ADD CONSTRAINT CK_proactive_items_kind
  CHECK (kind IN (N'test', N'finding'));

ALTER TABLE dbo.proactive_items ADD
  category nvarchar(32) NULL,
  urgency nvarchar(24) NOT NULL CONSTRAINT DF_proactive_items_urgency DEFAULT N'normal',
  due_at datetime2(7) NULL,
  evidence_json nvarchar(max) NULL,
  state nvarchar(16) NOT NULL CONSTRAINT DF_proactive_items_state DEFAULT N'new',
  snoozed_until datetime2(7) NULL,
  feedback nvarchar(16) NULL,
  run_id uniqueidentifier NULL,
  todo_added bit NOT NULL CONSTRAINT DF_proactive_items_todo_added DEFAULT 0,
  language nvarchar(2) NULL,
  dedupe_key nvarchar(64) NULL,
  CONSTRAINT CK_proactive_items_category CHECK (
    category IS NULL OR category IN (N'deadline', N'clash', N'travel', N'todo', N'prep', N'news', N'weather', N'status', N'suggestion')
  ),
  CONSTRAINT CK_proactive_items_urgency CHECK (urgency IN (N'time_critical', N'normal', N'fyi')),
  CONSTRAINT CK_proactive_items_state CHECK (state IN (N'new', N'seen', N'dismissed', N'snoozed')),
  CONSTRAINT CK_proactive_items_feedback CHECK (feedback IS NULL OR feedback IN (N'useful', N'wrong')),
  CONSTRAINT CK_proactive_items_language CHECK (language IS NULL OR language IN (N'da', N'en')),
  CONSTRAINT CK_proactive_items_dedupe_key CHECK (dedupe_key IS NULL OR LEN(dedupe_key) <= 64);
EXEC(N'CREATE UNIQUE INDEX UX_proactive_items_owner_dedupe_key
  ON dbo.proactive_items (owner_object_id, dedupe_key) WHERE dedupe_key IS NOT NULL;');

CREATE TABLE dbo.proactive_settings (
  owner_object_id uniqueidentifier NOT NULL CONSTRAINT PK_proactive_settings PRIMARY KEY,
  paused bit NOT NULL CONSTRAINT DF_proactive_settings_paused DEFAULT 0,
  monthly_budget_dkk int NOT NULL CONSTRAINT DF_proactive_settings_monthly_budget_dkk DEFAULT 100,
  sources_json nvarchar(max) NOT NULL,
  news_feeds_json nvarchar(max) NOT NULL,
  guidance nvarchar(1000) NOT NULL CONSTRAINT DF_proactive_settings_guidance DEFAULT N'',
  updated_at datetime2(7) NOT NULL CONSTRAINT DF_proactive_settings_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_proactive_settings_monthly_budget_dkk CHECK (monthly_budget_dkk BETWEEN 0 AND 1000),
  CONSTRAINT CK_proactive_settings_guidance CHECK (LEN(guidance) <= 1000)
);

CREATE TABLE dbo.proactive_runs (
  id uniqueidentifier NOT NULL CONSTRAINT PK_proactive_runs PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  [trigger] nvarchar(16) NOT NULL,
  slot_key nvarchar(16) NULL,
  status nvarchar(16) NOT NULL,
  reason nvarchar(64) NULL,
  started_at datetime2(7) NOT NULL,
  finished_at datetime2(7) NULL,
  finding_count int NOT NULL CONSTRAINT DF_proactive_runs_finding_count DEFAULT 0,
  lease_until datetime2(7) NULL,
  claim_generation bigint NOT NULL CONSTRAINT DF_proactive_runs_claim_generation DEFAULT 1,
  CONSTRAINT CK_proactive_runs_trigger CHECK ([trigger] IN (N'scheduled', N'catchup', N'manual')),
  CONSTRAINT CK_proactive_runs_slot CHECK (slot_key IS NULL OR
    slot_key LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T07:00' OR
    slot_key LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T18:00'),
  CONSTRAINT CK_proactive_runs_status CHECK (status IN (N'running', N'done', N'failed', N'skipped', N'cancelled')),
  CONSTRAINT CK_proactive_runs_finding_count CHECK (finding_count >= 0),
  CONSTRAINT CK_proactive_runs_claim_generation CHECK (claim_generation >= 1)
);
CREATE UNIQUE INDEX UX_proactive_runs_owner_slot
  ON dbo.proactive_runs (owner_object_id, slot_key) WHERE slot_key IS NOT NULL;
CREATE INDEX IX_proactive_runs_owner_started_at
  ON dbo.proactive_runs (owner_object_id, started_at DESC);

CREATE TABLE dbo.proactive_source_status (
  owner_object_id uniqueidentifier NOT NULL,
  source_id nvarchar(16) NOT NULL,
  state nvarchar(16) NOT NULL,
  reason nvarchar(64) NULL,
  observed_at datetime2(7) NOT NULL,
  CONSTRAINT PK_proactive_source_status PRIMARY KEY (owner_object_id, source_id),
  CONSTRAINT CK_proactive_source_status_source CHECK (source_id IN (N'todos', N'calendar', N'mail', N'weather', N'factory', N'news', N'travel', N'x')),
  CONSTRAINT CK_proactive_source_status_state CHECK (state IN (N'ok', N'unavailable', N'stale'))
);

CREATE TABLE dbo.proactive_spend (
  id uniqueidentifier NOT NULL CONSTRAINT PK_proactive_spend PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  run_id uniqueidentifier NOT NULL,
  month_key char(7) NOT NULL,
  input_tokens int NOT NULL,
  output_tokens int NOT NULL,
  estimated_dkk decimal(9,4) NOT NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_proactive_spend_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_proactive_spend_month_key CHECK (month_key LIKE '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  CONSTRAINT CK_proactive_spend_tokens CHECK (input_tokens >= 0 AND output_tokens >= 0),
  CONSTRAINT CK_proactive_spend_estimated_dkk CHECK (estimated_dkk >= 0)
);
CREATE INDEX IX_proactive_spend_owner_month
  ON dbo.proactive_spend (owner_object_id, month_key);
