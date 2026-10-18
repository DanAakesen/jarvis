-- Original Daily version182, source SHA9e193554c9c8c7c23a788ed3d2b0582580b76c0f
-- Derived in-memory from DDL only in drizzle/*.sql; no data or seed statements executed.
-- Not a live schema introspection and not SQL Server DDL.

CREATE TABLE `attention_items` (
	`snapshot_id` text NOT NULL,
	`source` text NOT NULL,
	`item_type` text NOT NULL,
	`stable_id` text NOT NULL,
	`parent_id` text,
	`title` text NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`due_at` text,
	`priority` integer,
	`is_all_day` integer,
	`state` text,
	`content_json` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `item_type`, `stable_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `attention_source_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_attention_items_snapshot_type` ON `attention_items` (`snapshot_id`,`item_type`);
CREATE INDEX `idx_attention_items_stable` ON `attention_items` (`source`,`stable_id`);

CREATE TABLE `attention_rule_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `attention_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`mode` text NOT NULL,
	`captured_at` text NOT NULL,
	`received_at` text NOT NULL,
	`checksum` text NOT NULL,
	`status` text NOT NULL,
	`source_status_json` text DEFAULT '{}' NOT NULL,
	`completed_at` text
);
CREATE INDEX `idx_attention_runs_received_at` ON `attention_runs` (`received_at`);
CREATE UNIQUE INDEX `uq_attention_runs_idempotency` ON `attention_runs` (`idempotency_key`);

CREATE TABLE `attention_source_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`captured_at` text NOT NULL,
	`received_at` text NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`checksum` text,
	`error_code` text,
	`error_message` text,
	FOREIGN KEY (`run_id`) REFERENCES `attention_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_attention_source_latest` ON `attention_source_snapshots` (`source`,`status`,`captured_at`);
CREATE UNIQUE INDEX `uq_attention_source_run` ON `attention_source_snapshots` (`run_id`,`source`);

CREATE TABLE `briefing_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`preview_text` text,
	`body_json` text,
	`source_snapshots_json` text DEFAULT '{}' NOT NULL,
	`health_status` text,
	`delivery_status` text DEFAULT 'not_requested' NOT NULL,
	`delivered_at` text,
	`delivery_evidence_json` text,
	`updated_at` text NOT NULL
);
CREATE INDEX `idx_briefing_runs_delivery` ON `briefing_runs` (`delivery_status`,`started_at`);
CREATE INDEX `idx_briefing_runs_started_at` ON `briefing_runs` (`started_at`);

CREATE TABLE `coach_commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`commitment_date` text NOT NULL,
	`metric` text NOT NULL,
	`instruction` text NOT NULL,
	`target_value` real NOT NULL,
	`unit` text NOT NULL,
	`comparison` text DEFAULT 'at_least' NOT NULL,
	`baseline_value` real,
	`due_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE INDEX `idx_coach_commitments_owner_date` ON `coach_commitments` (`owner_email`,`commitment_date`,`status`);
CREATE UNIQUE INDEX `uq_coach_commitments_owner_key` ON `coach_commitments` (`owner_email`,`idempotency_key`);

CREATE TABLE `coach_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`metric` text NOT NULL,
	`instruction` text NOT NULL,
	`target_value` real NOT NULL,
	`target_days` integer NOT NULL,
	`unit` text NOT NULL,
	`baseline_value` real,
	`baseline_days` integer,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`review_start_date` text NOT NULL,
	`review_end_date` text NOT NULL,
	`locked_variables_json` text DEFAULT '[]' NOT NULL,
	`rationale` text,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE INDEX `idx_coach_experiments_owner_status` ON `coach_experiments` (`owner_email`,`status`,`ends_on`);
CREATE UNIQUE INDEX `uq_coach_experiments_owner_key` ON `coach_experiments` (`owner_email`,`idempotency_key`);

CREATE TABLE `coach_profiles` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`primary_goal` text NOT NULL,
	`current_phase` text NOT NULL,
	`date_of_birth` text NOT NULL,
	`deficit_rate` real NOT NULL,
	`protein_minimum_grams` real NOT NULL,
	`protein_per_kg` real NOT NULL,
	`sleep_target_hours` real NOT NULL,
	`steps_target` integer NOT NULL,
	`gym_target_weekly` integer NOT NULL,
	`run_target_weekly` integer NOT NULL,
	`coaching_intensity` text NOT NULL,
	`profanity_preference` text NOT NULL,
	`meal_schedule_json` text DEFAULT '{}' NOT NULL,
	`food_preferences_json` text DEFAULT '{}' NOT NULL,
	`restrictions_json` text DEFAULT '[]' NOT NULL,
	`football_preferences_json` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE INDEX `idx_coach_profiles_updated` ON `coach_profiles` (`updated_at`);

CREATE TABLE `gmail_suppressions` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`suppressed_message_id` text NOT NULL,
	`suppressed_incoming_at` text,
	`suppressed_at` text NOT NULL,
	`revived_at` text,
	`updated_at` text NOT NULL
);
CREATE INDEX `idx_gmail_suppressions_active` ON `gmail_suppressions` (`revived_at`,`suppressed_at`);

CREATE TABLE `health_daily_metrics` (
	`metric_name` text NOT NULL,
	`metric_date` text NOT NULL,
	`unit` text,
	`value` real,
	`min_value` real,
	`avg_value` real,
	`max_value` real,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`start_at` text,
	`end_at` text,
	`fields_json` text DEFAULT '{}' NOT NULL,
	`ingestion_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`metric_name`, `metric_date`)
);
CREATE INDEX `idx_health_daily_metrics_date` ON `health_daily_metrics` (`metric_date`);

CREATE TABLE `health_ingestions` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`session_id` text NOT NULL,
	`checksum` text NOT NULL,
	`status` text NOT NULL,
	`content_bytes` integer NOT NULL,
	`received_at` text NOT NULL,
	`completed_at` text,
	`request_metadata_json` text DEFAULT '{}' NOT NULL,
	`normalized_counts_json` text,
	`error_code` text,
	`error_message` text
);
CREATE INDEX `idx_health_ingestions_received_at` ON `health_ingestions` (`received_at`);
CREATE UNIQUE INDEX `uq_health_ingestions_session` ON `health_ingestions` (`automation_id`,`session_id`);

CREATE TABLE `health_phone_sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_received_at` text NOT NULL,
	`shortcut_name` text NOT NULL,
	`checked_feeds_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE "health_raw_objects" (
	`ingestion_id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`checksum` text NOT NULL,
	`sanitized_checksum` text,
	`content_bytes` integer NOT NULL,
	`content_type` text NOT NULL,
	`stored_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`storage_status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`deleted_at` text
);
CREATE INDEX `idx_health_raw_objects_expiry` ON `health_raw_objects` (`expires_at`,`deleted_at`);
CREATE UNIQUE INDEX `uq_health_raw_objects_key` ON `health_raw_objects` (`object_key`);

CREATE TABLE `health_sleep_daily` (
	`sleep_date` text PRIMARY KEY NOT NULL,
	`sleep_start` text,
	`sleep_end` text,
	`total_sleep_hours` real,
	`asleep_hours` real,
	`core_hours` real,
	`deep_hours` real,
	`rem_hours` real,
	`awake_hours` real,
	`in_bed_hours` real,
	`source_json` text DEFAULT '[]' NOT NULL,
	`segment_count` integer DEFAULT 0 NOT NULL,
	`ingestion_id` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE INDEX `idx_health_sleep_daily_end` ON `health_sleep_daily` (`sleep_end`);

CREATE TABLE `health_sync_feeds` (
	`feed_kind` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`session_id` text NOT NULL,
	`checksum` text NOT NULL,
	`last_success_at` text NOT NULL,
	`last_counts_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `health_sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_attempt_at` text,
	`last_success_at` text,
	`last_automation_id` text,
	`last_session_id` text,
	`last_checksum` text,
	`last_error` text,
	`last_error_at` text,
	`last_cleanup_at` text,
	`last_counts_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text
);

CREATE TABLE `health_workout_heart_rate_minute` (
	`workout_id` text NOT NULL,
	`sample_minute` text NOT NULL,
	`metric_name` text NOT NULL,
	`min_value` real,
	`avg_value` real,
	`max_value` real,
	`unit` text,
	`source_json` text DEFAULT '[]' NOT NULL,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`ingestion_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workout_id`, `sample_minute`, `metric_name`),
	FOREIGN KEY (`workout_id`) REFERENCES `health_workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_health_workout_heart_rate_minute_time` ON `health_workout_heart_rate_minute` (`sample_minute`);

CREATE TABLE `health_workout_metrics` (
	`workout_id` text NOT NULL,
	`metric_name` text NOT NULL,
	`unit` text,
	`value` real,
	`min_value` real,
	`avg_value` real,
	`max_value` real,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`fields_json` text DEFAULT '{}' NOT NULL,
	`ingestion_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workout_id`, `metric_name`),
	FOREIGN KEY (`workout_id`) REFERENCES `health_workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_health_workout_metrics_name` ON `health_workout_metrics` (`metric_name`);

CREATE TABLE `health_workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_type` text NOT NULL,
	`workout_date` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`duration_seconds` real NOT NULL,
	`source_name` text,
	`is_indoor` integer,
	`active_energy_value` real,
	`active_energy_unit` text,
	`total_energy_value` real,
	`total_energy_unit` text,
	`distance_value` real,
	`distance_unit` text,
	`avg_heart_rate` real,
	`max_heart_rate` real,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`ingestion_id` text NOT NULL,
	`updated_at` text NOT NULL
, `activity_identifier` text);
CREATE INDEX `idx_health_workouts_date_start` ON `health_workouts` (`workout_date`,`start_at`);

CREATE TABLE `mcp_oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`code_challenge` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text
);
CREATE INDEX `idx_mcp_oauth_codes_expiry` ON `mcp_oauth_codes` (`expires_at`,`consumed_at`);

CREATE TABLE `mcp_oauth_refresh_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`client_id` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text
);
CREATE INDEX `idx_mcp_oauth_refresh_tokens_email` ON `mcp_oauth_refresh_tokens` (`email`,`revoked_at`);
CREATE INDEX `idx_mcp_oauth_refresh_tokens_expiry` ON `mcp_oauth_refresh_tokens` (`expires_at`,`revoked_at`);

CREATE TABLE `mcp_oauth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`client_id` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text
);
CREATE INDEX `idx_mcp_oauth_tokens_email` ON `mcp_oauth_tokens` (`email`,`revoked_at`);
CREATE INDEX `idx_mcp_oauth_tokens_expiry` ON `mcp_oauth_tokens` (`expires_at`,`revoked_at`);

CREATE TABLE `nutrition_favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`favorite_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`meal_name` text NOT NULL,
	`meal_type` text,
	`components_json` text DEFAULT '[]' NOT NULL,
	`energy_kcal` real NOT NULL,
	`protein_grams` real,
	`carbohydrates_grams` real,
	`fat_grams` real,
	`fiber_grams` real,
	`confidence` text NOT NULL,
	`source_meal_id` text NOT NULL,
	`source_idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE INDEX `idx_nutrition_favorites_owner_updated` ON `nutrition_favorites` (`owner_email`,`updated_at`);
CREATE UNIQUE INDEX `uq_nutrition_favorites_owner_name` ON `nutrition_favorites` (`owner_email`,`normalized_name`);

CREATE TABLE `nutrition_meal_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`plan_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`description` text,
	`items_json` text DEFAULT '[]' NOT NULL,
	`energy_kcal` real NOT NULL,
	`protein_grams` real NOT NULL,
	`carbohydrates_grams` real NOT NULL,
	`fat_grams` real NOT NULL,
	`fiber_grams` real NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE INDEX `idx_nutrition_meal_plans_owner_active_updated` ON `nutrition_meal_plans` (`owner_email`,`deleted_at`,`updated_at`);
CREATE UNIQUE INDEX `uq_nutrition_meal_plans_owner_name` ON `nutrition_meal_plans` (`owner_email`,`normalized_name`);

CREATE TABLE `nutrition_meals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`meal_name` text NOT NULL,
	`meal_type` text,
	`components_json` text DEFAULT '[]' NOT NULL,
	`occurred_at` text NOT NULL,
	`meal_date` text NOT NULL,
	`energy_kcal` real NOT NULL,
	`protein_grams` real,
	`carbohydrates_grams` real,
	`fat_grams` real,
	`fiber_grams` real,
	`confidence` text NOT NULL,
	`capture_method` text NOT NULL,
	`apple_health_status` text DEFAULT 'pending' NOT NULL,
	`apple_health_completed_at` text,
	`apple_health_writer` text,
	`apple_health_error` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
, `source` text DEFAULT 'sites' NOT NULL, `revision` integer DEFAULT 1 NOT NULL, `nutrient_provenance_json` text DEFAULT '{}' NOT NULL, `deleted_at` text);
CREATE INDEX `idx_nutrition_meals_expiry` ON `nutrition_meals` (`expires_at`);
CREATE INDEX `idx_nutrition_meals_owner_active_date` ON `nutrition_meals` (`owner_email`,`deleted_at`,`meal_date`,`occurred_at`);
CREATE INDEX `idx_nutrition_meals_owner_date` ON `nutrition_meals` (`owner_email`,`meal_date`,`occurred_at`);
CREATE UNIQUE INDEX `uq_nutrition_meals_owner_idempotency` ON `nutrition_meals` (`owner_email`,`idempotency_key`);

CREATE TABLE `nutrition_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`meal_name` text NOT NULL,
	`meal_type` text,
	`occurred_at` text NOT NULL,
	`energy_kcal` real NOT NULL,
	`protein_grams` real,
	`carbohydrates_grams` real,
	`fat_grams` real,
	`fiber_grams` real,
	`confidence` text NOT NULL,
	`capture_method` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`claimed_at` text,
	`claim_expires_at` text,
	`claim_token` text,
	`completed_at` text,
	`writer` text,
	`last_error` text,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
, `components_json` text DEFAULT '[]' NOT NULL);
CREATE INDEX `idx_nutrition_queue_expiry` ON `nutrition_queue` (`expires_at`);
CREATE INDEX `idx_nutrition_queue_status_created` ON `nutrition_queue` (`status`,`created_at`);
CREATE UNIQUE INDEX `uq_nutrition_queue_owner_idempotency` ON `nutrition_queue` (`owner_email`,`idempotency_key`);

CREATE TABLE `nutrition_recommendation_feedback` (
	`owner_email` text NOT NULL,
	`meal_key` text NOT NULL,
	`preference` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_email`, `meal_key`)
);
CREATE INDEX `idx_nutrition_recommendation_feedback_owner_updated` ON `nutrition_recommendation_feedback` (`owner_email`,`updated_at`);

CREATE TABLE `order_suppressions` (
	`owner_email` text NOT NULL,
	`order_key` text NOT NULL,
	`suppressed_order_updated_at` text NOT NULL,
	`suppressed_at` text NOT NULL,
	`revived_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_email`, `order_key`)
);
CREATE INDEX `idx_order_suppressions_active` ON `order_suppressions` (`owner_email`,`revived_at`,`suppressed_at`);

CREATE TABLE `readiness_checkins` (
	`owner_email` text NOT NULL,
	`checkin_date` text NOT NULL,
	`feeling_rating` integer NOT NULL,
	`context_text` text,
	`captured_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_email`, `checkin_date`)
);
CREATE INDEX `idx_readiness_checkins_owner_updated` ON `readiness_checkins` (`owner_email`,`updated_at`);

CREATE TABLE `recovery_days` (
	`owner_email` text NOT NULL,
	`recovery_date` text NOT NULL,
	`context_text` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_email`, `recovery_date`)
);
CREATE INDEX `idx_recovery_days_owner_updated` ON `recovery_days` (`owner_email`,`updated_at`);

CREATE TABLE `widget_auth_attempts` (
	`fingerprint_hash` text PRIMARY KEY NOT NULL,
	`window_started_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
CREATE INDEX `idx_widget_auth_attempts_updated` ON `widget_auth_attempts` (`updated_at`);

