# Original Daily complete backend schema

Source version182, commit `9e193554c9c8c7c23a788ed3d2b0582580b76c0f`. Documentation date18 October2026. **31 tables**, reconstructed from original `drizzle/*.sql` schema statements in an empty in-memory SQLite database. Only CREATE/ALTER/DROP/PRAGMA statements were evaluated. All data manipulation/seed statements were excluded; no original or live records were read, copied or written. Original source remains unchanged.

This is migration-derived structure, not a live D1 PRAGMA or proof of deployed migration state. The companion `daily-source-schema.sql` preserves complete final schema-only DDL and explicit index definitions. Each table below lists all columns and all explicit indexes/FKs. SQLite automatic primary-key indexes are reflected by their declared primary keys.

Types are SQLite affinities: TEXT carries dates, timestamps, JSON and identifiers; INTEGER also carries booleans where used in code; REAL carries floating-point measurements. `notnull` is the actual migration-reconstructed flag, and `pk order` indicates primary-key position. Null means no SQL DEFAULT; this differs from a DEFAULT NULL only syntactically. JSON validity and API constraints generally live in source code rather than DB CHECK declarations.

## Source-definition discrepancies

- `coach_experiments` is defined by `drizzle/0015_weekly_review_experiments.sql` and used by `worker/coach-store.js`, but absent from `db/schema.ts`. Using schema.ts alone would miss the31st table.
- `nutrition_meals.apple_health_status` has SQL DEFAULT `'pending'` from its CREATE migration. `db/schema.ts` declares default `'not_exported'`, and current saveMeal explicitly inserts `'not_exported'`. Migration0008 updates existing rows to the new source-of-truth model without changing the physical SQL default. The physical migration default and current API insert semantics are both documented, not silently reconciled.
- The initial health_workouts.location_type column was dropped; activity_identifier was added in0001. It is absent from the final structure below.
- health_raw_objects was rebuilt in0001 to add sanitized_checksum, storage_status and last_error. Original-request checksum remains distinct from sanitized object checksum.
- Manual data seeds exist in source migration files. Their record values are intentionally not reproduced; they are not schema defaults and were not executed during documentation.

## Table inventory

| # | Table | Columns | Source primary key |
| --- | --- | --- | --- |
| 1 | `attention_items` | 13 | `snapshot_id`, `item_type`, `stable_id` |
| 2 | `attention_rule_config` | 4 | `key` |
| 3 | `attention_runs` | 9 | `id` |
| 4 | `attention_source_snapshots` | 10 | `id` |
| 5 | `briefing_runs` | 13 | `id` |
| 6 | `coach_commitments` | 14 | `id` |
| 7 | `coach_experiments` | 19 | `id` |
| 8 | `coach_profiles` | 21 | `owner_email` |
| 9 | `gmail_suppressions` | 6 | `thread_id` |
| 10 | `health_daily_metrics` | 13 | `metric_name`, `metric_date` |
| 11 | `health_ingestions` | 12 | `id` |
| 12 | `health_phone_sync_state` | 5 | `id` |
| 13 | `health_raw_objects` | 11 | `ingestion_id` |
| 14 | `health_sleep_daily` | 14 | `sleep_date` |
| 15 | `health_sync_feeds` | 7 | `feed_kind` |
| 16 | `health_sync_state` | 11 | `id` |
| 17 | `health_workout_heart_rate_minute` | 11 | `workout_id`, `sample_minute`, `metric_name` |
| 18 | `health_workout_metrics` | 11 | `workout_id`, `metric_name` |
| 19 | `health_workouts` | 20 | `id` |
| 20 | `mcp_oauth_codes` | 10 | `code_hash` |
| 21 | `mcp_oauth_refresh_tokens` | 8 | `token_hash` |
| 22 | `mcp_oauth_tokens` | 8 | `token_hash` |
| 23 | `nutrition_favorites` | 18 | `id` |
| 24 | `nutrition_meal_plans` | 15 | `id` |
| 25 | `nutrition_meals` | 26 | `id` |
| 26 | `nutrition_queue` | 24 | `id` |
| 27 | `nutrition_recommendation_feedback` | 5 | `owner_email`, `meal_key` |
| 28 | `order_suppressions` | 6 | `owner_email`, `order_key` |
| 29 | `readiness_checkins` | 7 | `owner_email`, `checkin_date` |
| 30 | `recovery_days` | 5 | `owner_email`, `recovery_date` |
| 31 | `widget_auth_attempts` | 4 | `fingerprint_hash` |

## Complete columns, keys and indexes

### attention_items

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `snapshot_id` | TEXT | yes | `None` | 1 |
| `source` | TEXT | yes | `None` | — |
| `item_type` | TEXT | yes | `None` | 2 |
| `stable_id` | TEXT | yes | `None` | 3 |
| `parent_id` | TEXT | no | `None` | — |
| `title` | TEXT | yes | `None` | — |
| `starts_at` | TEXT | no | `None` | — |
| `ends_at` | TEXT | no | `None` | — |
| `due_at` | TEXT | no | `None` | — |
| `priority` | INTEGER | no | `None` | — |
| `is_all_day` | INTEGER | no | `None` | — |
| `state` | TEXT | no | `None` | — |
| `content_json` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_attention_items_snapshot_type` ON `attention_items` (`snapshot_id`,`item_type`)`
- `CREATE INDEX `idx_attention_items_stable` ON `attention_items` (`source`,`stable_id`)`

Declared foreign keys: `snapshot_id` → `attention_source_snapshots.id`, UPDATE NO ACTION, DELETE CASCADE

### attention_rule_config

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `key` | TEXT | yes | `None` | 1 |
| `value_json` | TEXT | yes | `None` | — |
| `source` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

None beyond primary-key enforcement.

Declared foreign keys: none

### attention_runs

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | TEXT | yes | `None` | 1 |
| `idempotency_key` | TEXT | yes | `None` | — |
| `mode` | TEXT | yes | `None` | — |
| `captured_at` | TEXT | yes | `None` | — |
| `received_at` | TEXT | yes | `None` | — |
| `checksum` | TEXT | yes | `None` | — |
| `status` | TEXT | yes | `None` | — |
| `source_status_json` | TEXT | yes | `'{}'` | — |
| `completed_at` | TEXT | no | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_attention_runs_received_at` ON `attention_runs` (`received_at`)`
- `CREATE UNIQUE INDEX `uq_attention_runs_idempotency` ON `attention_runs` (`idempotency_key`)`

Declared foreign keys: none

### attention_source_snapshots

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | TEXT | yes | `None` | 1 |
| `run_id` | TEXT | yes | `None` | — |
| `source` | TEXT | yes | `None` | — |
| `status` | TEXT | yes | `None` | — |
| `captured_at` | TEXT | yes | `None` | — |
| `received_at` | TEXT | yes | `None` | — |
| `item_count` | INTEGER | yes | `0` | — |
| `checksum` | TEXT | no | `None` | — |
| `error_code` | TEXT | no | `None` | — |
| `error_message` | TEXT | no | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_attention_source_latest` ON `attention_source_snapshots` (`source`,`status`,`captured_at`)`
- `CREATE UNIQUE INDEX `uq_attention_source_run` ON `attention_source_snapshots` (`run_id`,`source`)`

Declared foreign keys: `run_id` → `attention_runs.id`, UPDATE NO ACTION, DELETE CASCADE

### briefing_runs

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | TEXT | yes | `None` | 1 |
| `trigger` | TEXT | yes | `None` | — |
| `started_at` | TEXT | yes | `None` | — |
| `completed_at` | TEXT | no | `None` | — |
| `status` | TEXT | yes | `None` | — |
| `preview_text` | TEXT | no | `None` | — |
| `body_json` | TEXT | no | `None` | — |
| `source_snapshots_json` | TEXT | yes | `'{}'` | — |
| `health_status` | TEXT | no | `None` | — |
| `delivery_status` | TEXT | yes | `'not_requested'` | — |
| `delivered_at` | TEXT | no | `None` | — |
| `delivery_evidence_json` | TEXT | no | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_briefing_runs_delivery` ON `briefing_runs` (`delivery_status`,`started_at`)`
- `CREATE INDEX `idx_briefing_runs_started_at` ON `briefing_runs` (`started_at`)`

Declared foreign keys: none

### coach_commitments

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | TEXT | yes | `None` | 1 |
| `owner_email` | TEXT | yes | `None` | — |
| `commitment_date` | TEXT | yes | `None` | — |
| `metric` | TEXT | yes | `None` | — |
| `instruction` | TEXT | yes | `None` | — |
| `target_value` | REAL | yes | `None` | — |
| `unit` | TEXT | yes | `None` | — |
| `comparison` | TEXT | yes | `'at_least'` | — |
| `baseline_value` | REAL | no | `None` | — |
| `due_at` | TEXT | no | `None` | — |
| `status` | TEXT | yes | `'active'` | — |
| `idempotency_key` | TEXT | yes | `None` | — |
| `created_at` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_coach_commitments_owner_date` ON `coach_commitments` (`owner_email`,`commitment_date`,`status`)`
- `CREATE UNIQUE INDEX `uq_coach_commitments_owner_key` ON `coach_commitments` (`owner_email`,`idempotency_key`)`

Declared foreign keys: none

### coach_experiments

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | TEXT | yes | `None` | 1 |
| `owner_email` | TEXT | yes | `None` | — |
| `metric` | TEXT | yes | `None` | — |
| `instruction` | TEXT | yes | `None` | — |
| `target_value` | REAL | yes | `None` | — |
| `target_days` | INTEGER | yes | `None` | — |
| `unit` | TEXT | yes | `None` | — |
| `baseline_value` | REAL | no | `None` | — |
| `baseline_days` | INTEGER | no | `None` | — |
| `starts_on` | TEXT | yes | `None` | — |
| `ends_on` | TEXT | yes | `None` | — |
| `status` | TEXT | yes | `'active'` | — |
| `review_start_date` | TEXT | yes | `None` | — |
| `review_end_date` | TEXT | yes | `None` | — |
| `locked_variables_json` | TEXT | yes | `'[]'` | — |
| `rationale` | TEXT | no | `None` | — |
| `idempotency_key` | TEXT | yes | `None` | — |
| `created_at` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_coach_experiments_owner_status` ON `coach_experiments` (`owner_email`,`status`,`ends_on`)`
- `CREATE UNIQUE INDEX `uq_coach_experiments_owner_key` ON `coach_experiments` (`owner_email`,`idempotency_key`)`

Declared foreign keys: none

### coach_profiles

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `owner_email` | TEXT | yes | `None` | 1 |
| `display_name` | TEXT | yes | `None` | — |
| `primary_goal` | TEXT | yes | `None` | — |
| `current_phase` | TEXT | yes | `None` | — |
| `date_of_birth` | TEXT | yes | `None` | — |
| `deficit_rate` | REAL | yes | `None` | — |
| `protein_minimum_grams` | REAL | yes | `None` | — |
| `protein_per_kg` | REAL | yes | `None` | — |
| `sleep_target_hours` | REAL | yes | `None` | — |
| `steps_target` | INTEGER | yes | `None` | — |
| `gym_target_weekly` | INTEGER | yes | `None` | — |
| `run_target_weekly` | INTEGER | yes | `None` | — |
| `coaching_intensity` | TEXT | yes | `None` | — |
| `profanity_preference` | TEXT | yes | `None` | — |
| `meal_schedule_json` | TEXT | yes | `'{}'` | — |
| `food_preferences_json` | TEXT | yes | `'{}'` | — |
| `restrictions_json` | TEXT | yes | `'[]'` | — |
| `football_preferences_json` | TEXT | yes | `'{}'` | — |
| `revision` | INTEGER | yes | `1` | — |
| `created_at` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_coach_profiles_updated` ON `coach_profiles` (`updated_at`)`

Declared foreign keys: none

### gmail_suppressions

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `thread_id` | TEXT | yes | `None` | 1 |
| `suppressed_message_id` | TEXT | yes | `None` | — |
| `suppressed_incoming_at` | TEXT | no | `None` | — |
| `suppressed_at` | TEXT | yes | `None` | — |
| `revived_at` | TEXT | no | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_gmail_suppressions_active` ON `gmail_suppressions` (`revived_at`,`suppressed_at`)`

Declared foreign keys: none

### health_daily_metrics

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `metric_name` | TEXT | yes | `None` | 1 |
| `metric_date` | TEXT | yes | `None` | 2 |
| `unit` | TEXT | no | `None` | — |
| `value` | REAL | no | `None` | — |
| `min_value` | REAL | no | `None` | — |
| `avg_value` | REAL | no | `None` | — |
| `max_value` | REAL | no | `None` | — |
| `sample_count` | INTEGER | yes | `0` | — |
| `start_at` | TEXT | no | `None` | — |
| `end_at` | TEXT | no | `None` | — |
| `fields_json` | TEXT | yes | `'{}'` | — |
| `ingestion_id` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_health_daily_metrics_date` ON `health_daily_metrics` (`metric_date`)`

Declared foreign keys: none

### health_ingestions

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | TEXT | yes | `None` | 1 |
| `automation_id` | TEXT | yes | `None` | — |
| `session_id` | TEXT | yes | `None` | — |
| `checksum` | TEXT | yes | `None` | — |
| `status` | TEXT | yes | `None` | — |
| `content_bytes` | INTEGER | yes | `None` | — |
| `received_at` | TEXT | yes | `None` | — |
| `completed_at` | TEXT | no | `None` | — |
| `request_metadata_json` | TEXT | yes | `'{}'` | — |
| `normalized_counts_json` | TEXT | no | `None` | — |
| `error_code` | TEXT | no | `None` | — |
| `error_message` | TEXT | no | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_health_ingestions_received_at` ON `health_ingestions` (`received_at`)`
- `CREATE UNIQUE INDEX `uq_health_ingestions_session` ON `health_ingestions` (`automation_id`,`session_id`)`

Declared foreign keys: none

### health_phone_sync_state

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | yes | `None` | 1 |
| `last_received_at` | TEXT | yes | `None` | — |
| `shortcut_name` | TEXT | yes | `None` | — |
| `checked_feeds_json` | TEXT | yes | `'[]'` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

None beyond primary-key enforcement.

Declared foreign keys: none

### health_raw_objects

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `ingestion_id` | TEXT | yes | `None` | 1 |
| `object_key` | TEXT | yes | `None` | — |
| `checksum` | TEXT | yes | `None` | — |
| `sanitized_checksum` | TEXT | no | `None` | — |
| `content_bytes` | INTEGER | yes | `None` | — |
| `content_type` | TEXT | yes | `None` | — |
| `stored_at` | TEXT | yes | `None` | — |
| `expires_at` | TEXT | yes | `None` | — |
| `storage_status` | TEXT | yes | `'pending'` | — |
| `last_error` | TEXT | no | `None` | — |
| `deleted_at` | TEXT | no | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_health_raw_objects_expiry` ON `health_raw_objects` (`expires_at`,`deleted_at`)`
- `CREATE UNIQUE INDEX `uq_health_raw_objects_key` ON `health_raw_objects` (`object_key`)`

Declared foreign keys: none

### health_sleep_daily

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `sleep_date` | TEXT | yes | `None` | 1 |
| `sleep_start` | TEXT | no | `None` | — |
| `sleep_end` | TEXT | no | `None` | — |
| `total_sleep_hours` | REAL | no | `None` | — |
| `asleep_hours` | REAL | no | `None` | — |
| `core_hours` | REAL | no | `None` | — |
| `deep_hours` | REAL | no | `None` | — |
| `rem_hours` | REAL | no | `None` | — |
| `awake_hours` | REAL | no | `None` | — |
| `in_bed_hours` | REAL | no | `None` | — |
| `source_json` | TEXT | yes | `'[]'` | — |
| `segment_count` | INTEGER | yes | `0` | — |
| `ingestion_id` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_health_sleep_daily_end` ON `health_sleep_daily` (`sleep_end`)`

Declared foreign keys: none

### health_sync_feeds

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `feed_kind` | TEXT | yes | `None` | 1 |
| `automation_id` | TEXT | yes | `None` | — |
| `session_id` | TEXT | yes | `None` | — |
| `checksum` | TEXT | yes | `None` | — |
| `last_success_at` | TEXT | yes | `None` | — |
| `last_counts_json` | TEXT | yes | `'{}'` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

None beyond primary-key enforcement.

Declared foreign keys: none

### health_sync_state

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | yes | `None` | 1 |
| `last_attempt_at` | TEXT | no | `None` | — |
| `last_success_at` | TEXT | no | `None` | — |
| `last_automation_id` | TEXT | no | `None` | — |
| `last_session_id` | TEXT | no | `None` | — |
| `last_checksum` | TEXT | no | `None` | — |
| `last_error` | TEXT | no | `None` | — |
| `last_error_at` | TEXT | no | `None` | — |
| `last_cleanup_at` | TEXT | no | `None` | — |
| `last_counts_json` | TEXT | yes | `'{}'` | — |
| `updated_at` | TEXT | no | `None` | — |

Explicit indexes:

None beyond primary-key enforcement.

Declared foreign keys: none

### health_workout_heart_rate_minute

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `workout_id` | TEXT | yes | `None` | 1 |
| `sample_minute` | TEXT | yes | `None` | 2 |
| `metric_name` | TEXT | yes | `None` | 3 |
| `min_value` | REAL | no | `None` | — |
| `avg_value` | REAL | no | `None` | — |
| `max_value` | REAL | no | `None` | — |
| `unit` | TEXT | no | `None` | — |
| `source_json` | TEXT | yes | `'[]'` | — |
| `sample_count` | INTEGER | yes | `0` | — |
| `ingestion_id` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_health_workout_heart_rate_minute_time` ON `health_workout_heart_rate_minute` (`sample_minute`)`

Declared foreign keys: `workout_id` → `health_workouts.id`, UPDATE NO ACTION, DELETE CASCADE

### health_workout_metrics

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `workout_id` | TEXT | yes | `None` | 1 |
| `metric_name` | TEXT | yes | `None` | 2 |
| `unit` | TEXT | no | `None` | — |
| `value` | REAL | no | `None` | — |
| `min_value` | REAL | no | `None` | — |
| `avg_value` | REAL | no | `None` | — |
| `max_value` | REAL | no | `None` | — |
| `sample_count` | INTEGER | yes | `0` | — |
| `fields_json` | TEXT | yes | `'{}'` | — |
| `ingestion_id` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_health_workout_metrics_name` ON `health_workout_metrics` (`metric_name`)`

Declared foreign keys: `workout_id` → `health_workouts.id`, UPDATE NO ACTION, DELETE CASCADE

### health_workouts

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | TEXT | yes | `None` | 1 |
| `workout_type` | TEXT | yes | `None` | — |
| `workout_date` | TEXT | yes | `None` | — |
| `start_at` | TEXT | yes | `None` | — |
| `end_at` | TEXT | yes | `None` | — |
| `duration_seconds` | REAL | yes | `None` | — |
| `source_name` | TEXT | no | `None` | — |
| `is_indoor` | INTEGER | no | `None` | — |
| `active_energy_value` | REAL | no | `None` | — |
| `active_energy_unit` | TEXT | no | `None` | — |
| `total_energy_value` | REAL | no | `None` | — |
| `total_energy_unit` | TEXT | no | `None` | — |
| `distance_value` | REAL | no | `None` | — |
| `distance_unit` | TEXT | no | `None` | — |
| `avg_heart_rate` | REAL | no | `None` | — |
| `max_heart_rate` | REAL | no | `None` | — |
| `detail_json` | TEXT | yes | `'{}'` | — |
| `ingestion_id` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |
| `activity_identifier` | TEXT | no | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_health_workouts_date_start` ON `health_workouts` (`workout_date`,`start_at`)`

Declared foreign keys: none

### mcp_oauth_codes

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `code_hash` | TEXT | yes | `None` | 1 |
| `client_id` | TEXT | yes | `None` | — |
| `redirect_uri` | TEXT | yes | `None` | — |
| `resource` | TEXT | yes | `None` | — |
| `scope` | TEXT | yes | `None` | — |
| `code_challenge` | TEXT | yes | `None` | — |
| `email` | TEXT | yes | `None` | — |
| `created_at` | TEXT | yes | `None` | — |
| `expires_at` | TEXT | yes | `None` | — |
| `consumed_at` | TEXT | no | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_mcp_oauth_codes_expiry` ON `mcp_oauth_codes` (`expires_at`,`consumed_at`)`

Declared foreign keys: none

### mcp_oauth_refresh_tokens

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `token_hash` | TEXT | yes | `None` | 1 |
| `email` | TEXT | yes | `None` | — |
| `client_id` | TEXT | yes | `None` | — |
| `resource` | TEXT | yes | `None` | — |
| `scope` | TEXT | yes | `None` | — |
| `issued_at` | TEXT | yes | `None` | — |
| `expires_at` | TEXT | yes | `None` | — |
| `revoked_at` | TEXT | no | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_mcp_oauth_refresh_tokens_email` ON `mcp_oauth_refresh_tokens` (`email`,`revoked_at`)`
- `CREATE INDEX `idx_mcp_oauth_refresh_tokens_expiry` ON `mcp_oauth_refresh_tokens` (`expires_at`,`revoked_at`)`

Declared foreign keys: none

### mcp_oauth_tokens

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `token_hash` | TEXT | yes | `None` | 1 |
| `email` | TEXT | yes | `None` | — |
| `client_id` | TEXT | yes | `None` | — |
| `resource` | TEXT | yes | `None` | — |
| `scope` | TEXT | yes | `None` | — |
| `issued_at` | TEXT | yes | `None` | — |
| `expires_at` | TEXT | yes | `None` | — |
| `revoked_at` | TEXT | no | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_mcp_oauth_tokens_email` ON `mcp_oauth_tokens` (`email`,`revoked_at`)`
- `CREATE INDEX `idx_mcp_oauth_tokens_expiry` ON `mcp_oauth_tokens` (`expires_at`,`revoked_at`)`

Declared foreign keys: none

### nutrition_favorites

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | TEXT | yes | `None` | 1 |
| `owner_email` | TEXT | yes | `None` | — |
| `favorite_name` | TEXT | yes | `None` | — |
| `normalized_name` | TEXT | yes | `None` | — |
| `aliases_json` | TEXT | yes | `'[]'` | — |
| `meal_name` | TEXT | yes | `None` | — |
| `meal_type` | TEXT | no | `None` | — |
| `components_json` | TEXT | yes | `'[]'` | — |
| `energy_kcal` | REAL | yes | `None` | — |
| `protein_grams` | REAL | no | `None` | — |
| `carbohydrates_grams` | REAL | no | `None` | — |
| `fat_grams` | REAL | no | `None` | — |
| `fiber_grams` | REAL | no | `None` | — |
| `confidence` | TEXT | yes | `None` | — |
| `source_meal_id` | TEXT | yes | `None` | — |
| `source_idempotency_key` | TEXT | yes | `None` | — |
| `created_at` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_nutrition_favorites_owner_updated` ON `nutrition_favorites` (`owner_email`,`updated_at`)`
- `CREATE UNIQUE INDEX `uq_nutrition_favorites_owner_name` ON `nutrition_favorites` (`owner_email`,`normalized_name`)`

Declared foreign keys: none

### nutrition_meal_plans

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | TEXT | yes | `None` | 1 |
| `owner_email` | TEXT | yes | `None` | — |
| `plan_name` | TEXT | yes | `None` | — |
| `normalized_name` | TEXT | yes | `None` | — |
| `description` | TEXT | no | `None` | — |
| `items_json` | TEXT | yes | `'[]'` | — |
| `energy_kcal` | REAL | yes | `None` | — |
| `protein_grams` | REAL | yes | `None` | — |
| `carbohydrates_grams` | REAL | yes | `None` | — |
| `fat_grams` | REAL | yes | `None` | — |
| `fiber_grams` | REAL | yes | `None` | — |
| `revision` | INTEGER | yes | `1` | — |
| `deleted_at` | TEXT | no | `None` | — |
| `created_at` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_nutrition_meal_plans_owner_active_updated` ON `nutrition_meal_plans` (`owner_email`,`deleted_at`,`updated_at`)`
- `CREATE UNIQUE INDEX `uq_nutrition_meal_plans_owner_name` ON `nutrition_meal_plans` (`owner_email`,`normalized_name`)`

Declared foreign keys: none

### nutrition_meals

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | TEXT | yes | `None` | 1 |
| `owner_email` | TEXT | yes | `None` | — |
| `idempotency_key` | TEXT | yes | `None` | — |
| `meal_name` | TEXT | yes | `None` | — |
| `meal_type` | TEXT | no | `None` | — |
| `components_json` | TEXT | yes | `'[]'` | — |
| `occurred_at` | TEXT | yes | `None` | — |
| `meal_date` | TEXT | yes | `None` | — |
| `energy_kcal` | REAL | yes | `None` | — |
| `protein_grams` | REAL | no | `None` | — |
| `carbohydrates_grams` | REAL | no | `None` | — |
| `fat_grams` | REAL | no | `None` | — |
| `fiber_grams` | REAL | no | `None` | — |
| `confidence` | TEXT | yes | `None` | — |
| `capture_method` | TEXT | yes | `None` | — |
| `apple_health_status` | TEXT | yes | `'pending'` | — |
| `apple_health_completed_at` | TEXT | no | `None` | — |
| `apple_health_writer` | TEXT | no | `None` | — |
| `apple_health_error` | TEXT | no | `None` | — |
| `created_at` | TEXT | yes | `None` | — |
| `expires_at` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |
| `source` | TEXT | yes | `'sites'` | — |
| `revision` | INTEGER | yes | `1` | — |
| `nutrient_provenance_json` | TEXT | yes | `'{}'` | — |
| `deleted_at` | TEXT | no | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_nutrition_meals_expiry` ON `nutrition_meals` (`expires_at`)`
- `CREATE INDEX `idx_nutrition_meals_owner_active_date` ON `nutrition_meals` (`owner_email`,`deleted_at`,`meal_date`,`occurred_at`)`
- `CREATE INDEX `idx_nutrition_meals_owner_date` ON `nutrition_meals` (`owner_email`,`meal_date`,`occurred_at`)`
- `CREATE UNIQUE INDEX `uq_nutrition_meals_owner_idempotency` ON `nutrition_meals` (`owner_email`,`idempotency_key`)`

Declared foreign keys: none

### nutrition_queue

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `id` | TEXT | yes | `None` | 1 |
| `owner_email` | TEXT | yes | `None` | — |
| `idempotency_key` | TEXT | yes | `None` | — |
| `meal_name` | TEXT | yes | `None` | — |
| `meal_type` | TEXT | no | `None` | — |
| `occurred_at` | TEXT | yes | `None` | — |
| `energy_kcal` | REAL | yes | `None` | — |
| `protein_grams` | REAL | no | `None` | — |
| `carbohydrates_grams` | REAL | no | `None` | — |
| `fat_grams` | REAL | no | `None` | — |
| `fiber_grams` | REAL | no | `None` | — |
| `confidence` | TEXT | yes | `None` | — |
| `capture_method` | TEXT | yes | `None` | — |
| `status` | TEXT | yes | `'pending'` | — |
| `created_at` | TEXT | yes | `None` | — |
| `claimed_at` | TEXT | no | `None` | — |
| `claim_expires_at` | TEXT | no | `None` | — |
| `claim_token` | TEXT | no | `None` | — |
| `completed_at` | TEXT | no | `None` | — |
| `writer` | TEXT | no | `None` | — |
| `last_error` | TEXT | no | `None` | — |
| `expires_at` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |
| `components_json` | TEXT | yes | `'[]'` | — |

Explicit indexes:

- `CREATE INDEX `idx_nutrition_queue_expiry` ON `nutrition_queue` (`expires_at`)`
- `CREATE INDEX `idx_nutrition_queue_status_created` ON `nutrition_queue` (`status`,`created_at`)`
- `CREATE UNIQUE INDEX `uq_nutrition_queue_owner_idempotency` ON `nutrition_queue` (`owner_email`,`idempotency_key`)`

Declared foreign keys: none

### nutrition_recommendation_feedback

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `owner_email` | TEXT | yes | `None` | 1 |
| `meal_key` | TEXT | yes | `None` | 2 |
| `preference` | TEXT | yes | `None` | — |
| `created_at` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_nutrition_recommendation_feedback_owner_updated` ON `nutrition_recommendation_feedback` (`owner_email`,`updated_at`)`

Declared foreign keys: none

### order_suppressions

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `owner_email` | TEXT | yes | `None` | 1 |
| `order_key` | TEXT | yes | `None` | 2 |
| `suppressed_order_updated_at` | TEXT | yes | `None` | — |
| `suppressed_at` | TEXT | yes | `None` | — |
| `revived_at` | TEXT | no | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_order_suppressions_active` ON `order_suppressions` (`owner_email`,`revived_at`,`suppressed_at`)`

Declared foreign keys: none

### readiness_checkins

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `owner_email` | TEXT | yes | `None` | 1 |
| `checkin_date` | TEXT | yes | `None` | 2 |
| `feeling_rating` | INTEGER | yes | `None` | — |
| `context_text` | TEXT | no | `None` | — |
| `captured_at` | TEXT | yes | `None` | — |
| `created_at` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_readiness_checkins_owner_updated` ON `readiness_checkins` (`owner_email`,`updated_at`)`

Declared foreign keys: none

### recovery_days

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `owner_email` | TEXT | yes | `None` | 1 |
| `recovery_date` | TEXT | yes | `None` | 2 |
| `context_text` | TEXT | no | `None` | — |
| `created_at` | TEXT | yes | `None` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_recovery_days_owner_updated` ON `recovery_days` (`owner_email`,`updated_at`)`

Declared foreign keys: none

### widget_auth_attempts

| Column | SQLite type | NOT NULL | SQL DEFAULT | PK order |
| --- | --- | --- | --- | --- |
| `fingerprint_hash` | TEXT | yes | `None` | 1 |
| `window_started_at` | TEXT | yes | `None` | — |
| `attempts` | INTEGER | yes | `0` | — |
| `updated_at` | TEXT | yes | `None` | — |

Explicit indexes:

- `CREATE INDEX `idx_widget_auth_attempts_updated` ON `widget_auth_attempts` (`updated_at`)`

Declared foreign keys: none

## Ownership, relationships and retention behavior

Health, attention, ingestion/raw/sync and Gmail suppression tables are global in the original schema; nutrition, coaching, readiness, recovery and order suppression use owner_email. OAuth tables bind email/client/resource/scope. The schema itself does not turn a client-supplied email into authority: server handlers/OAuth derive it.

Declared cascades: health_workout_metrics and health_workout_heart_rate_minute→health_workouts; attention_source_snapshots→attention_runs; attention_items→attention_source_snapshots. Other same-named ingestion_id/run/meal references are logical unless explicitly shown above. No implicit cascade is assumed.

Health raw R2 evidence expires after7days; its D1 ledger remains with status/deleted_at. Normalized health history is not deleted by that raw cleanup. Canonical nutrition_meals persist until explicit soft deletion and use permanent expiry sentinel; API corrections increment revision. Nutrition queue is transient, seven-day expiry and five-minute claims; uncertain writes are not automatically retried. Favorites/plans persist by owner and normalized name, plans have revision/tombstone. Coach profile writes increment revision; commitments and experiments use owner/idempotency uniqueness; new experiment supersedes older active experiments. Readiness upserts owner/day; recovery mark/clear changes only owner/date markers, not measurements. Attention snapshots retain successful data across later failed refreshes; suppression is site-local and may revive on new activity. OAuth codes are consumed once, refresh tokens rotate/revoke, access tokens are hashed and expiry/revocation checked. Widget attempt fingerprints support five attempts per15minutes.

See detailed persistence behavior in `daily-source-contract.md` and `daily-api.md`. No runtime cleanup/deployed schedule, database row count, historical coverage or currently active credential is claimed by this schema document.
