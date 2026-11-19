IF EXISTS (SELECT 1 FROM dbo.pi_situational_state WITH (TABLOCKX, HOLDLOCK))
BEGIN
  THROW 51000, 'PI situational state is durable owner context; retain it before rollback', 1;
END;

IF EXISTS (
  SELECT 1 FROM dbo.pi_turn WITH (TABLOCKX, HOLDLOCK)
  WHERE activation_id IS NOT NULL OR state_revision IS NOT NULL
    OR stale_source_count <> 0 OR tool_count <> 0 OR action_count <> 0 OR push_count <> 0
)
BEGIN
  THROW 51000, 'PI activation ledger details are durable evidence; retain them before rollback', 1;
END;

IF EXISTS (
  SELECT 1 FROM dbo.proactive_event_batches WITH (TABLOCKX, HOLDLOCK)
  WHERE activation_type <> 'event' OR satisfied_slot IS NOT NULL
)
BEGIN
  THROW 51000, 'PI slot activation metadata is durable cadence evidence; retain it before rollback', 1;
END;

IF EXISTS (SELECT 1 FROM dbo.proactive_source_status WITH (TABLOCKX, HOLDLOCK) WHERE source_id = N'location')
BEGIN
  THROW 51000, 'Location source history is durable context; retain it before rollback', 1;
END;

IF EXISTS (
  SELECT 1 FROM dbo.proactive_settings WITH (TABLOCKX, HOLDLOCK)
  WHERE background_turns_per_day <> 12
)
BEGIN
  THROW 51000, 'A non-default PI background-turn allowance is durable policy; retain it before rollback', 1;
END;

DROP TABLE dbo.pi_situational_state;

ALTER TABLE dbo.proactive_event_batches DROP CONSTRAINT CK_proactive_event_batches_satisfied_slot;
ALTER TABLE dbo.proactive_event_batches DROP CONSTRAINT CK_proactive_event_batches_activation_type;
ALTER TABLE dbo.proactive_event_batches DROP CONSTRAINT DF_proactive_event_batches_activation_type;
ALTER TABLE dbo.proactive_event_batches DROP COLUMN satisfied_slot, activation_type;

DROP INDEX UX_pi_turn_activation ON dbo.pi_turn;
ALTER TABLE dbo.pi_turn DROP CONSTRAINT CK_pi_turn_activation_counts;
ALTER TABLE dbo.pi_turn DROP CONSTRAINT CK_pi_turn_activation_result;
ALTER TABLE dbo.pi_turn DROP CONSTRAINT CK_pi_turn_activation_type;
ALTER TABLE dbo.pi_turn DROP CONSTRAINT DF_pi_turn_push_count;
ALTER TABLE dbo.pi_turn DROP CONSTRAINT DF_pi_turn_action_count;
ALTER TABLE dbo.pi_turn DROP CONSTRAINT DF_pi_turn_tool_count;
ALTER TABLE dbo.pi_turn DROP CONSTRAINT DF_pi_turn_stale_source_count;
ALTER TABLE dbo.pi_turn DROP COLUMN
  activation_id, activation_type, activation_source, slot_key, state_revision,
  stale_source_count, tool_count, action_count, push_count, activation_result;

ALTER TABLE dbo.proactive_source_status DROP CONSTRAINT CK_proactive_source_status_source;
ALTER TABLE dbo.proactive_source_status ADD CONSTRAINT CK_proactive_source_status_source
  CHECK (source_id IN (
    N'todos', N'calendar', N'mail', N'weather', N'factory', N'news', N'travel',
    N'x', N'health', N'nutrition', N'notes', N'memory'
  ));

ALTER TABLE dbo.proactive_settings DROP CONSTRAINT CK_proactive_settings_background_turns_per_day;
ALTER TABLE dbo.proactive_settings DROP CONSTRAINT DF_proactive_settings_background_turns_per_day;
ALTER TABLE dbo.proactive_settings DROP COLUMN background_turns_per_day;
