ALTER TABLE dbo.proactive_settings ADD
  background_turns_per_day int NOT NULL
    CONSTRAINT DF_proactive_settings_background_turns_per_day DEFAULT 12,
  CONSTRAINT CK_proactive_settings_background_turns_per_day
    CHECK (background_turns_per_day BETWEEN 1 AND 12);

ALTER TABLE dbo.proactive_source_status DROP CONSTRAINT CK_proactive_source_status_source;
ALTER TABLE dbo.proactive_source_status ADD CONSTRAINT CK_proactive_source_status_source
  CHECK (source_id IN (
    N'todos', N'calendar', N'mail', N'weather', N'factory', N'news', N'travel',
    N'x', N'health', N'nutrition', N'notes', N'memory', N'location'
  ));

ALTER TABLE dbo.pi_turn ADD
  activation_id uniqueidentifier NULL,
  activation_type varchar(10) NULL,
  activation_source nvarchar(64) NULL,
  slot_key nvarchar(32) NULL,
  state_revision bigint NULL,
  stale_source_count int NOT NULL CONSTRAINT DF_pi_turn_stale_source_count DEFAULT 0,
  tool_count int NOT NULL CONSTRAINT DF_pi_turn_tool_count DEFAULT 0,
  action_count int NOT NULL CONSTRAINT DF_pi_turn_action_count DEFAULT 0,
  push_count int NOT NULL CONSTRAINT DF_pi_turn_push_count DEFAULT 0,
  activation_result varchar(8) NULL,
  CONSTRAINT CK_pi_turn_activation_type CHECK (
    activation_type IS NULL OR activation_type IN ('chat', 'voice', 'scheduled', 'event')
  ),
  CONSTRAINT CK_pi_turn_activation_result CHECK (
    activation_result IS NULL OR activation_result IN ('action', 'push', 'silence', 'failed')
  ),
  CONSTRAINT CK_pi_turn_activation_counts CHECK (
    (state_revision IS NULL OR state_revision >= 0)
    AND stale_source_count >= 0 AND tool_count >= 0
    AND action_count >= 0 AND push_count >= 0
  );
EXEC(N'CREATE UNIQUE INDEX UX_pi_turn_activation
  ON dbo.pi_turn (activation_id) WHERE activation_id IS NOT NULL;');

CREATE TABLE dbo.pi_situational_state (
  owner_object_id uniqueidentifier NOT NULL,
  schema_version smallint NOT NULL CONSTRAINT DF_pi_situational_state_schema_version DEFAULT 1,
  revision bigint NOT NULL CONSTRAINT DF_pi_situational_state_revision DEFAULT 1,
  state_json nvarchar(max) NOT NULL,
  content_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  source_refs_json nvarchar(max) NOT NULL,
  freshness_json nvarchar(max) NOT NULL,
  stale_reasons_json nvarchar(max) NOT NULL,
  last_activation_id uniqueidentifier NULL,
  last_activation_type varchar(10) NULL,
  last_activation_source nvarchar(64) NULL,
  last_activation_at datetime2(7) NULL,
  as_of_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL CONSTRAINT DF_pi_situational_state_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_pi_situational_state PRIMARY KEY (owner_object_id),
  CONSTRAINT CK_pi_situational_state_schema_version CHECK (schema_version = 1),
  CONSTRAINT CK_pi_situational_state_revision CHECK (revision >= 1),
  CONSTRAINT CK_pi_situational_state_content_hash CHECK (LEN(content_hash) = 64),
  CONSTRAINT CK_pi_situational_state_json CHECK (
    ISJSON(state_json) = 1 AND ISJSON(source_refs_json) = 1
    AND ISJSON(freshness_json) = 1 AND ISJSON(stale_reasons_json) = 1
    AND DATALENGTH(state_json) <= 16384
    AND DATALENGTH(source_refs_json) <= 16384
    AND DATALENGTH(freshness_json) <= 16384
    AND DATALENGTH(stale_reasons_json) <= 8192
  ),
  CONSTRAINT CK_pi_situational_state_last_activation_type CHECK (
    last_activation_type IS NULL OR last_activation_type IN ('chat', 'voice', 'scheduled', 'event')
  ),
  CONSTRAINT CK_pi_situational_state_last_activation CHECK (
    (last_activation_id IS NULL AND last_activation_type IS NULL
      AND last_activation_source IS NULL AND last_activation_at IS NULL)
    OR (last_activation_id IS NOT NULL AND last_activation_type IS NOT NULL AND last_activation_at IS NOT NULL)
  )
);
