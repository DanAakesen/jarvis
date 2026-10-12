-- P12-03: empty owner-bound tables from nonsensitive source definitions.
-- No import, seed, auth/device credential, route activation or source mutation.
EXEC(N'CREATE SCHEMA daily');

CREATE TABLE daily.[health_ingestions] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [automation_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [session_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [checksum] nvarchar(256) NOT NULL,
  [status] nvarchar(256) NOT NULL,
  [content_bytes] bigint NOT NULL,
  [received_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [completed_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [request_metadata_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_health_ingestions_request_metadata_json DEFAULT N'{}',
  [normalized_counts_json] nvarchar(max) NULL,
  [error_code] nvarchar(256) NULL,
  [error_message] nvarchar(max) NULL,
  CONSTRAINT PK_daily_health_ingestions PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_health_ingestions_request_metadata_json CHECK ([request_metadata_json] IS NULL OR ISJSON([request_metadata_json], VALUE) = 1),
  CONSTRAINT CK_daily_health_ingestions_normalized_counts_json CHECK ([normalized_counts_json] IS NULL OR ISJSON([normalized_counts_json], VALUE) = 1)
);
CREATE UNIQUE INDEX UQ_daily_health_ingestions_0 ON daily.[health_ingestions] ([owner_object_id], [automation_id], [session_id]);

CREATE TABLE daily.[health_raw_objects] (
  owner_object_id uniqueidentifier NOT NULL,
  [ingestion_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [object_key] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [checksum] nvarchar(256) NOT NULL,
  [sanitized_checksum] nvarchar(256) NULL,
  [content_bytes] bigint NOT NULL,
  [content_type] nvarchar(256) NOT NULL,
  [stored_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [expires_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [storage_status] nvarchar(256) NOT NULL CONSTRAINT DF_daily_health_raw_objects_storage_status DEFAULT N'pending',
  [last_error] nvarchar(max) NULL,
  [deleted_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT PK_daily_health_raw_objects PRIMARY KEY NONCLUSTERED ([owner_object_id], [ingestion_id])
);
CREATE UNIQUE INDEX UQ_daily_health_raw_objects_0 ON daily.[health_raw_objects] ([owner_object_id], [object_key]);

CREATE TABLE daily.[health_daily_metrics] (
  owner_object_id uniqueidentifier NOT NULL,
  [metric_name] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [metric_date] date NOT NULL,
  [unit] nvarchar(256) NULL,
  [value] float NULL,
  [min_value] float NULL,
  [avg_value] float NULL,
  [max_value] float NULL,
  [sample_count] bigint NOT NULL CONSTRAINT DF_daily_health_daily_metrics_sample_count DEFAULT 0,
  [start_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [end_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [fields_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_health_daily_metrics_fields_json DEFAULT N'{}',
  [ingestion_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_health_daily_metrics PRIMARY KEY NONCLUSTERED ([owner_object_id], [metric_name], [metric_date]),
  CONSTRAINT CK_daily_health_daily_metrics_fields_json CHECK ([fields_json] IS NULL OR ISJSON([fields_json], VALUE) = 1)
);

CREATE TABLE daily.[health_sleep_daily] (
  owner_object_id uniqueidentifier NOT NULL,
  [sleep_date] date NOT NULL,
  [sleep_start] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [sleep_end] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [total_sleep_hours] float NULL,
  [asleep_hours] float NULL,
  [core_hours] float NULL,
  [deep_hours] float NULL,
  [rem_hours] float NULL,
  [awake_hours] float NULL,
  [in_bed_hours] float NULL,
  [source_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_health_sleep_daily_source_json DEFAULT N'[]',
  [segment_count] bigint NOT NULL CONSTRAINT DF_daily_health_sleep_daily_segment_count DEFAULT 0,
  [ingestion_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_health_sleep_daily PRIMARY KEY NONCLUSTERED ([owner_object_id], [sleep_date]),
  CONSTRAINT CK_daily_health_sleep_daily_source_json CHECK ([source_json] IS NULL OR ISJSON([source_json], VALUE) = 1)
);

CREATE TABLE daily.[health_workouts] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [workout_type] nvarchar(256) NOT NULL,
  [activity_identifier] nvarchar(256) NULL,
  [workout_date] date NOT NULL,
  [start_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [end_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [duration_seconds] float NOT NULL,
  [source_name] nvarchar(256) NULL,
  [is_indoor] bit NULL,
  [active_energy_value] float NULL,
  [active_energy_unit] nvarchar(256) NULL,
  [total_energy_value] float NULL,
  [total_energy_unit] nvarchar(256) NULL,
  [distance_value] float NULL,
  [distance_unit] nvarchar(256) NULL,
  [avg_heart_rate] float NULL,
  [max_heart_rate] float NULL,
  [detail_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_health_workouts_detail_json DEFAULT N'{}',
  [ingestion_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_health_workouts PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_health_workouts_detail_json CHECK ([detail_json] IS NULL OR ISJSON([detail_json], VALUE) = 1)
);

CREATE TABLE daily.[health_workout_metrics] (
  owner_object_id uniqueidentifier NOT NULL,
  [workout_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [metric_name] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [unit] nvarchar(256) NULL,
  [value] float NULL,
  [min_value] float NULL,
  [avg_value] float NULL,
  [max_value] float NULL,
  [sample_count] bigint NOT NULL CONSTRAINT DF_daily_health_workout_metrics_sample_count DEFAULT 0,
  [fields_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_health_workout_metrics_fields_json DEFAULT N'{}',
  [ingestion_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_health_workout_metrics PRIMARY KEY NONCLUSTERED ([owner_object_id], [workout_id], [metric_name]),
  CONSTRAINT CK_daily_health_workout_metrics_fields_json CHECK ([fields_json] IS NULL OR ISJSON([fields_json], VALUE) = 1)
);

CREATE TABLE daily.[health_workout_heart_rate_minute] (
  owner_object_id uniqueidentifier NOT NULL,
  [workout_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [sample_minute] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [metric_name] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [min_value] float NULL,
  [avg_value] float NULL,
  [max_value] float NULL,
  [unit] nvarchar(256) NULL,
  [source_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_health_workout_heart_rate_minute_source_json DEFAULT N'[]',
  [sample_count] bigint NOT NULL CONSTRAINT DF_daily_health_workout_heart_rate_minute_sample_count DEFAULT 0,
  [ingestion_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_health_workout_heart_rate_minute PRIMARY KEY NONCLUSTERED ([owner_object_id], [workout_id], [sample_minute], [metric_name]),
  CONSTRAINT CK_daily_health_workout_heart_rate_minute_source_json CHECK ([source_json] IS NULL OR ISJSON([source_json], VALUE) = 1)
);

CREATE TABLE daily.[health_sync_state] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] bigint NOT NULL,
  [last_attempt_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [last_success_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [last_automation_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NULL,
  [last_session_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NULL,
  [last_checksum] nvarchar(256) NULL,
  [last_error] nvarchar(max) NULL,
  [last_error_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [last_cleanup_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [last_counts_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_health_sync_state_last_counts_json DEFAULT N'{}',
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT PK_daily_health_sync_state PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_health_sync_state_last_counts_json CHECK ([last_counts_json] IS NULL OR ISJSON([last_counts_json], VALUE) = 1)
);

CREATE TABLE daily.[health_sync_feeds] (
  owner_object_id uniqueidentifier NOT NULL,
  [feed_kind] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [automation_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [session_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [checksum] nvarchar(256) NOT NULL,
  [last_success_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [last_counts_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_health_sync_feeds_last_counts_json DEFAULT N'{}',
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_health_sync_feeds PRIMARY KEY NONCLUSTERED ([owner_object_id], [feed_kind]),
  CONSTRAINT CK_daily_health_sync_feeds_last_counts_json CHECK ([last_counts_json] IS NULL OR ISJSON([last_counts_json], VALUE) = 1)
);

CREATE TABLE daily.[health_phone_sync_state] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] bigint NOT NULL,
  [last_received_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [shortcut_name] nvarchar(256) NOT NULL,
  [checked_feeds_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_health_phone_sync_state_checked_feeds_json DEFAULT N'[]',
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_health_phone_sync_state PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_health_phone_sync_state_checked_feeds_json CHECK ([checked_feeds_json] IS NULL OR ISJSON([checked_feeds_json], VALUE) = 1)
);

CREATE TABLE daily.[nutrition_queue] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [idempotency_key] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [meal_name] nvarchar(max) NOT NULL,
  [meal_type] nvarchar(256) NULL,
  [components_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_nutrition_queue_components_json DEFAULT N'[]',
  [occurred_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [energy_kcal] float NOT NULL,
  [protein_grams] float NULL,
  [carbohydrates_grams] float NULL,
  [fat_grams] float NULL,
  [fiber_grams] float NULL,
  [confidence] nvarchar(256) NOT NULL,
  [capture_method] nvarchar(256) NOT NULL,
  [status] nvarchar(256) NOT NULL CONSTRAINT DF_daily_nutrition_queue_status DEFAULT N'pending',
  [created_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [claimed_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [claim_expires_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [completed_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [writer] nvarchar(256) NULL,
  [last_error] nvarchar(max) NULL,
  [expires_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_nutrition_queue PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_nutrition_queue_components_json CHECK ([components_json] IS NULL OR ISJSON([components_json], VALUE) = 1)
);
CREATE UNIQUE INDEX UQ_daily_nutrition_queue_0 ON daily.[nutrition_queue] ([owner_object_id], [idempotency_key]);

CREATE TABLE daily.[nutrition_meals] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [idempotency_key] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [meal_name] nvarchar(max) NOT NULL,
  [meal_type] nvarchar(256) NULL,
  [components_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_nutrition_meals_components_json DEFAULT N'[]',
  [occurred_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [meal_date] date NOT NULL,
  [energy_kcal] float NOT NULL,
  [protein_grams] float NULL,
  [carbohydrates_grams] float NULL,
  [fat_grams] float NULL,
  [fiber_grams] float NULL,
  [confidence] nvarchar(256) NOT NULL,
  [capture_method] nvarchar(256) NOT NULL,
  [source] nvarchar(256) NOT NULL CONSTRAINT DF_daily_nutrition_meals_source DEFAULT N'sites',
  [revision] bigint NOT NULL CONSTRAINT DF_daily_nutrition_meals_revision DEFAULT 1,
  [nutrient_provenance_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_nutrition_meals_nutrient_provenance_json DEFAULT N'{}',
  [apple_health_status] nvarchar(256) NOT NULL CONSTRAINT DF_daily_nutrition_meals_apple_health_status DEFAULT N'not_exported',
  [apple_health_completed_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [apple_health_writer] nvarchar(256) NULL,
  [apple_health_error] nvarchar(max) NULL,
  [deleted_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [created_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [expires_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_nutrition_meals PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_nutrition_meals_components_json CHECK ([components_json] IS NULL OR ISJSON([components_json], VALUE) = 1),
  CONSTRAINT CK_daily_nutrition_meals_nutrient_provenance_json CHECK ([nutrient_provenance_json] IS NULL OR ISJSON([nutrient_provenance_json], VALUE) = 1),
  CONSTRAINT CK_daily_nutrition_meals_revision CHECK (revision >= 1)
);
CREATE UNIQUE INDEX UQ_daily_nutrition_meals_0 ON daily.[nutrition_meals] ([owner_object_id], [idempotency_key]);

CREATE TABLE daily.[nutrition_favorites] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [favorite_name] nvarchar(max) NOT NULL,
  [normalized_name] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [aliases_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_nutrition_favorites_aliases_json DEFAULT N'[]',
  [meal_name] nvarchar(max) NOT NULL,
  [meal_type] nvarchar(256) NULL,
  [components_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_nutrition_favorites_components_json DEFAULT N'[]',
  [energy_kcal] float NOT NULL,
  [protein_grams] float NULL,
  [carbohydrates_grams] float NULL,
  [fat_grams] float NULL,
  [fiber_grams] float NULL,
  [confidence] nvarchar(256) NOT NULL,
  [source_meal_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [source_idempotency_key] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [created_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_nutrition_favorites PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_nutrition_favorites_aliases_json CHECK ([aliases_json] IS NULL OR ISJSON([aliases_json], VALUE) = 1),
  CONSTRAINT CK_daily_nutrition_favorites_components_json CHECK ([components_json] IS NULL OR ISJSON([components_json], VALUE) = 1)
);
CREATE UNIQUE INDEX UQ_daily_nutrition_favorites_0 ON daily.[nutrition_favorites] ([owner_object_id], [normalized_name]);

CREATE TABLE daily.[nutrition_meal_plans] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [plan_name] nvarchar(max) NOT NULL,
  [normalized_name] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [description] nvarchar(max) NULL,
  [items_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_nutrition_meal_plans_items_json DEFAULT N'[]',
  [energy_kcal] float NOT NULL,
  [protein_grams] float NOT NULL,
  [carbohydrates_grams] float NOT NULL,
  [fat_grams] float NOT NULL,
  [fiber_grams] float NOT NULL,
  [revision] bigint NOT NULL CONSTRAINT DF_daily_nutrition_meal_plans_revision DEFAULT 1,
  [deleted_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [created_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_nutrition_meal_plans PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_nutrition_meal_plans_items_json CHECK ([items_json] IS NULL OR ISJSON([items_json], VALUE) = 1),
  CONSTRAINT CK_daily_nutrition_meal_plans_revision CHECK (revision >= 1)
);
CREATE UNIQUE INDEX UQ_daily_nutrition_meal_plans_0 ON daily.[nutrition_meal_plans] ([owner_object_id], [normalized_name]);

CREATE TABLE daily.[nutrition_recommendation_feedback] (
  owner_object_id uniqueidentifier NOT NULL,
  [meal_key] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [preference] nvarchar(256) NOT NULL,
  [created_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_nutrition_recommendation_feedback PRIMARY KEY NONCLUSTERED ([owner_object_id], [meal_key])
);

CREATE TABLE daily.[coach_profiles] (
  owner_object_id uniqueidentifier NOT NULL,
  [display_name] nvarchar(max) NOT NULL,
  [primary_goal] nvarchar(max) NOT NULL,
  [current_phase] nvarchar(256) NOT NULL,
  [date_of_birth] date NOT NULL,
  [deficit_rate] float NOT NULL,
  [protein_minimum_grams] float NOT NULL,
  [protein_per_kg] float NOT NULL,
  [sleep_target_hours] float NOT NULL,
  [steps_target] bigint NOT NULL,
  [gym_target_weekly] bigint NOT NULL,
  [run_target_weekly] bigint NOT NULL,
  [coaching_intensity] nvarchar(256) NOT NULL,
  [profanity_preference] nvarchar(256) NOT NULL,
  [meal_schedule_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_coach_profiles_meal_schedule_json DEFAULT N'{}',
  [food_preferences_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_coach_profiles_food_preferences_json DEFAULT N'{}',
  [restrictions_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_coach_profiles_restrictions_json DEFAULT N'[]',
  [football_preferences_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_coach_profiles_football_preferences_json DEFAULT N'{}',
  [revision] bigint NOT NULL CONSTRAINT DF_daily_coach_profiles_revision DEFAULT 1,
  [created_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_coach_profiles PRIMARY KEY NONCLUSTERED ([owner_object_id]),
  CONSTRAINT CK_daily_coach_profiles_meal_schedule_json CHECK ([meal_schedule_json] IS NULL OR ISJSON([meal_schedule_json], VALUE) = 1),
  CONSTRAINT CK_daily_coach_profiles_food_preferences_json CHECK ([food_preferences_json] IS NULL OR ISJSON([food_preferences_json], VALUE) = 1),
  CONSTRAINT CK_daily_coach_profiles_restrictions_json CHECK ([restrictions_json] IS NULL OR ISJSON([restrictions_json], VALUE) = 1),
  CONSTRAINT CK_daily_coach_profiles_football_preferences_json CHECK ([football_preferences_json] IS NULL OR ISJSON([football_preferences_json], VALUE) = 1),
  CONSTRAINT CK_daily_coach_profiles_revision CHECK (revision >= 1)
);

CREATE TABLE daily.[coach_commitments] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [commitment_date] date NOT NULL,
  [metric] nvarchar(256) NOT NULL,
  [instruction] nvarchar(max) NOT NULL,
  [target_value] float NOT NULL,
  [unit] nvarchar(256) NOT NULL,
  [comparison] nvarchar(256) NOT NULL CONSTRAINT DF_daily_coach_commitments_comparison DEFAULT N'at_least',
  [baseline_value] float NULL,
  [due_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [status] nvarchar(256) NOT NULL CONSTRAINT DF_daily_coach_commitments_status DEFAULT N'active',
  [idempotency_key] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [created_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_coach_commitments PRIMARY KEY NONCLUSTERED ([owner_object_id], [id])
);
CREATE UNIQUE INDEX UQ_daily_coach_commitments_0 ON daily.[coach_commitments] ([owner_object_id], [idempotency_key]);

CREATE TABLE daily.[readiness_checkins] (
  owner_object_id uniqueidentifier NOT NULL,
  [checkin_date] date NOT NULL,
  [feeling_rating] bigint NOT NULL,
  [context_text] nvarchar(max) NULL,
  [captured_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [created_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_readiness_checkins PRIMARY KEY NONCLUSTERED ([owner_object_id], [checkin_date])
);

CREATE TABLE daily.[recovery_days] (
  owner_object_id uniqueidentifier NOT NULL,
  [recovery_date] date NOT NULL,
  [context_text] nvarchar(max) NULL,
  [created_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_recovery_days PRIMARY KEY NONCLUSTERED ([owner_object_id], [recovery_date])
);

CREATE TABLE daily.[attention_runs] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [idempotency_key] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [mode] nvarchar(256) NOT NULL,
  [captured_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [received_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [checksum] nvarchar(256) NOT NULL,
  [status] nvarchar(256) NOT NULL,
  [source_status_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_attention_runs_source_status_json DEFAULT N'{}',
  [completed_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT PK_daily_attention_runs PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_attention_runs_source_status_json CHECK ([source_status_json] IS NULL OR ISJSON([source_status_json], VALUE) = 1)
);
CREATE UNIQUE INDEX UQ_daily_attention_runs_0 ON daily.[attention_runs] ([owner_object_id], [idempotency_key]);

CREATE TABLE daily.[attention_source_snapshots] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [run_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [source] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [status] nvarchar(256) NOT NULL,
  [captured_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [received_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [item_count] bigint NOT NULL CONSTRAINT DF_daily_attention_source_snapshots_item_count DEFAULT 0,
  [checksum] nvarchar(256) NULL,
  [error_code] nvarchar(256) NULL,
  [error_message] nvarchar(max) NULL,
  CONSTRAINT PK_daily_attention_source_snapshots PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_attention_source_snapshots_source CHECK (LOWER(source) NOT LIKE N'%ticktick%')
);
CREATE UNIQUE INDEX UQ_daily_attention_source_snapshots_0 ON daily.[attention_source_snapshots] ([owner_object_id], [run_id], [source]);

CREATE TABLE daily.[attention_items] (
  owner_object_id uniqueidentifier NOT NULL,
  [snapshot_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [source] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [item_type] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [stable_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [parent_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NULL,
  [title] nvarchar(max) NOT NULL,
  [starts_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [ends_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [due_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [priority] bigint NULL,
  [is_all_day] bit NULL,
  [state] nvarchar(256) NULL,
  [content_json] nvarchar(max) NOT NULL,
  CONSTRAINT PK_daily_attention_items PRIMARY KEY NONCLUSTERED ([owner_object_id], [snapshot_id], [item_type], [stable_id]),
  CONSTRAINT CK_daily_attention_items_content_json CHECK ([content_json] IS NULL OR ISJSON([content_json], VALUE) = 1),
  CONSTRAINT CK_daily_attention_items_source CHECK (LOWER(source) NOT LIKE N'%ticktick%')
);

CREATE TABLE daily.[gmail_suppressions] (
  owner_object_id uniqueidentifier NOT NULL,
  [thread_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [suppressed_message_id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [suppressed_incoming_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [suppressed_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [revived_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_gmail_suppressions PRIMARY KEY NONCLUSTERED ([owner_object_id], [thread_id])
);

CREATE TABLE daily.[order_suppressions] (
  owner_object_id uniqueidentifier NOT NULL,
  [order_key] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [suppressed_order_updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [suppressed_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [revived_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_order_suppressions PRIMARY KEY NONCLUSTERED ([owner_object_id], [order_key])
);

CREATE TABLE daily.[briefing_runs] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [trigger] nvarchar(256) NOT NULL,
  [started_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [completed_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [status] nvarchar(256) NOT NULL,
  [preview_text] nvarchar(max) NULL,
  [body_json] nvarchar(max) NULL,
  [source_snapshots_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_briefing_runs_source_snapshots_json DEFAULT N'{}',
  [health_status] nvarchar(256) NULL,
  [delivery_status] nvarchar(256) NOT NULL CONSTRAINT DF_daily_briefing_runs_delivery_status DEFAULT N'not_requested',
  [delivered_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  [delivery_evidence_json] nvarchar(max) NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_briefing_runs PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_briefing_runs_body_json CHECK ([body_json] IS NULL OR ISJSON([body_json], VALUE) = 1),
  CONSTRAINT CK_daily_briefing_runs_source_snapshots_json CHECK ([source_snapshots_json] IS NULL OR ISJSON([source_snapshots_json], VALUE) = 1),
  CONSTRAINT CK_daily_briefing_runs_delivery_evidence_json CHECK ([delivery_evidence_json] IS NULL OR ISJSON([delivery_evidence_json], VALUE) = 1)
);

CREATE TABLE daily.[attention_rule_config] (
  owner_object_id uniqueidentifier NOT NULL,
  [key] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [value_json] nvarchar(max) NOT NULL,
  [source] nvarchar(256) NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_attention_rule_config PRIMARY KEY NONCLUSTERED ([owner_object_id], [key]),
  CONSTRAINT CK_daily_attention_rule_config_value_json CHECK ([value_json] IS NULL OR ISJSON([value_json], VALUE) = 1),
  CONSTRAINT CK_daily_attention_rule_config_source CHECK (LOWER(source) NOT LIKE N'%ticktick%')
);

CREATE TABLE daily.[coach_experiments] (
  owner_object_id uniqueidentifier NOT NULL,
  [id] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [metric] nvarchar(256) NOT NULL,
  [instruction] nvarchar(max) NOT NULL,
  [target_value] float NOT NULL,
  [target_days] bigint NOT NULL,
  [unit] nvarchar(256) NOT NULL,
  [baseline_value] float NULL,
  [baseline_days] bigint NULL,
  [starts_on] date NOT NULL,
  [ends_on] date NOT NULL,
  [status] nvarchar(256) NOT NULL CONSTRAINT DF_daily_coach_experiments_status DEFAULT N'active',
  [review_start_date] date NOT NULL,
  [review_end_date] date NOT NULL,
  [locked_variables_json] nvarchar(max) NOT NULL CONSTRAINT DF_daily_coach_experiments_locked_variables_json DEFAULT N'[]',
  [rationale] nvarchar(max) NULL,
  [idempotency_key] nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [created_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [updated_at] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_daily_coach_experiments PRIMARY KEY NONCLUSTERED ([owner_object_id], [id]),
  CONSTRAINT CK_daily_coach_experiments_locked_variables_json CHECK ([locked_variables_json] IS NULL OR ISJSON([locked_variables_json], VALUE) = 1)
);
CREATE UNIQUE INDEX UQ_daily_coach_experiments_0 ON daily.[coach_experiments] ([owner_object_id], [idempotency_key]);

ALTER TABLE daily.[health_workout_metrics] ADD CONSTRAINT FK_daily_health_workout_metrics FOREIGN KEY ([owner_object_id], [workout_id]) REFERENCES daily.[health_workouts] ([owner_object_id], [id]);
ALTER TABLE daily.[health_workout_heart_rate_minute] ADD CONSTRAINT FK_daily_health_workout_heart_rate_minute FOREIGN KEY ([owner_object_id], [workout_id]) REFERENCES daily.[health_workouts] ([owner_object_id], [id]);
ALTER TABLE daily.[attention_source_snapshots] ADD CONSTRAINT FK_daily_attention_source_snapshots FOREIGN KEY ([owner_object_id], [run_id]) REFERENCES daily.[attention_runs] ([owner_object_id], [id]);
ALTER TABLE daily.[attention_items] ADD CONSTRAINT FK_daily_attention_items FOREIGN KEY ([owner_object_id], [snapshot_id]) REFERENCES daily.[attention_source_snapshots] ([owner_object_id], [id]);
