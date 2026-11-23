# Daily source-to-SQL mapping (P12-03)

The [owner-scoped SQL schema](../../../db/migrations/0041_daily_owner_schema.sql) retains the source keys below. This is a field mapping, not a live record inventory, backup or import plan. See [Daily integration scope](migration.md).

## Mapping policy

P12-09 migration 0050 adds **target-only** favourite/feedback revisions (initial
value 1) and permits null feedback as a retained, revisioned clear. These are
concurrency metadata, not newly discovered source columns or imported values.
Existing IDs, aliases, nutrients and provenance remain unchanged. Rollback
refuses used revisions, clears and audit evidence for the new connector tools.

Migration 0047 adds attempt, deadline and error-code fields to that inbox. When enabled, the SQL processor writes the mapped health, ingestion and sync tables atomically with the processed inbox receipt under the owner lock. It preserves session identities and refuses incompatible lineage.

P12-04 migration 0046 adds **new target-only** `daily.health_upload_capabilities` and `daily.health_upload_inbox`, not source-import mappings. The existing backend stores original accepted bytes and owner/session/checksum receipts in SQL; these are distinct from the historical `health_ingestions` / `health_raw_objects` ledger. #720 owns processing into mapped domain tables. No legacy capability, source record or secret is seeded; rollback refuses retained inbox/capability evidence. [Bounds and retention](health-ingestion.md#bounds-and-raw-retention).

- Migration `0041_daily_owner_schema.sql` creates empty tables in a separate `daily` SQL schema. No personal seed DML, import, device/login tables, route/tool registration or Daily activation.
- Every row requires server-resolved `owner_object_id`, even for formerly global source records. Source `owner_email` keys map to that owner, not a client email. The mapping does not expose arbitrary table, column, SQL or caller-owner selection.
- Original legacy IDs/composite keys remain explicit columns; the configured owner prefixes keys and uniqueness. Key strings use binary collation; target indexed keys are bounded to 256 UTF-16 code units. Any source-compatible API/schema or replay implementation must reject overlength keys and obtain a reviewed compatible widening; never truncate or hash-replace source IDs. SQL limits fail instead of silently rewriting data. Free-text/JSON uses nvarchar(max), times retain original text/offsets (64 code units), local dates use SQL date, SQLite REAL uses float, SQLite integer storage uses bigint (read without silently narrowing 64-bit values), optional unknowns stay NULL. Device/business validation is downstream.
- Preserve source defaults, nutrition revisions/tombstones/idempotency, ingestion lineage, raw original versus sanitized checksums, retention/deletion/status fields, nullable activity/body/sleep/nutrient values, readiness context, recovery dates, feedback, experiments and suppressions. Recovery rows never overwrite measurements or insert averaged replacements. The raw ledger does not prove raw bytes still exist.
- Composite owner foreign keys follow the supplied explicit source relationships only (workout children and attention children); they cannot attach a child's row to another owner. Hard-delete cascades are intentionally omitted: no source deletion/import service is implemented; retention requires later reviewed handling.
- Mixed attention snapshots/items/config reject a TickTick source discriminator. Runs/briefs with mixed JSON are NOT directly reusable: any future source-compatible ingestion must explicitly exclude TickTick items and sanitize mixed source-status/snapshot/body/rule JSON against verified source semantics; unknown/unclassified payloads fail closed. No database-bundle import, TickTick tools or feed activation is authorized by this mapping.

## Explicit table decisions

| Source table | Active target / decision | Source key retained after owner prefix |
| --- | --- | --- |
| health_ingestions | `daily.health_ingestions`; include in-scope schema | id |
| health_raw_objects | `daily.health_raw_objects`; include in-scope schema | ingestion_id |
| health_daily_metrics | `daily.health_daily_metrics`; include in-scope schema | metric_name, metric_date |
| health_sleep_daily | `daily.health_sleep_daily`; include in-scope schema | sleep_date |
| health_workouts | `daily.health_workouts`; include in-scope schema | id |
| health_workout_metrics | `daily.health_workout_metrics`; include in-scope schema | workout_id, metric_name |
| health_workout_heart_rate_minute | `daily.health_workout_heart_rate_minute`; include in-scope schema | workout_id, sample_minute, metric_name |
| health_sync_state | `daily.health_sync_state`; include in-scope schema | id |
| health_sync_feeds | `daily.health_sync_feeds`; include in-scope schema | feed_kind |
| health_phone_sync_state | `daily.health_phone_sync_state`; include in-scope schema | id |
| nutrition_queue | `daily.nutrition_queue`; include in-scope schema | id |
| nutrition_meals | `daily.nutrition_meals`; include in-scope schema | id |
| nutrition_favorites | `daily.nutrition_favorites`; include in-scope schema | id |
| nutrition_meal_plans | `daily.nutrition_meal_plans`; include in-scope schema | id |
| nutrition_recommendation_feedback | `daily.nutrition_recommendation_feedback`; include in-scope schema | meal_key |
| coach_profiles | `daily.coach_profiles`; include in-scope schema | owner_email maps to server owner |
| coach_commitments | `daily.coach_commitments`; include in-scope schema | id |
| readiness_checkins | `daily.readiness_checkins`; include in-scope schema | checkin_date |
| recovery_days | `daily.recovery_days`; include in-scope schema | recovery_date |
| attention_runs | `daily.attention_runs`; in-scope only after mixed-source exclusion/sanitization | id |
| attention_source_snapshots | `daily.attention_source_snapshots`; in-scope only after mixed-source exclusion/sanitization | id |
| attention_items | `daily.attention_items`; in-scope only after mixed-source exclusion/sanitization | snapshot_id, item_type, stable_id |
| gmail_suppressions | `daily.gmail_suppressions`; include in-scope schema | thread_id |
| order_suppressions | `daily.order_suppressions`; include in-scope schema | order_key |
| briefing_runs | `daily.briefing_runs`; in-scope only after mixed-source exclusion/sanitization | id |
| attention_rule_config | `daily.attention_rule_config`; in-scope only after mixed-source exclusion/sanitization | key |
| coach_experiments | `daily.coach_experiments`; include in-scope schema | id |
| mcp_oauth_codes | Protected-backup/legacy exclusion only; no active target or working Jarvis credential | No active migration |
| mcp_oauth_tokens | Protected-backup/legacy exclusion only; no active target or working Jarvis credential | No active migration |
| mcp_oauth_refresh_tokens | Protected-backup/legacy exclusion only; no active target or working Jarvis credential | No active migration |
| widget_auth_attempts | Protected-backup/legacy exclusion only; no active target or working Jarvis credential | No active migration |

Column-level exclusions: source `owner_email` maps to the existing owner and is not an active credential/identity selector. `nutrition_queue.claim_token` is legacy credential material: protected-backup/excluded only, never a working Jarvis/Shortcut claim token. Queue claim timestamps/status/provenance remain as historical schema fields; fresh future scoped device credentials are separate work.

## Verification and release boundary

Preserve exact source keys, including text padding and signed-64-bit integers. Date keys use exact `YYYY-MM-DD`. Verify key length, index width and SQL uniqueness-padding compatibility rather than rewriting IDs.

The [down batch](../../../db/migrations/down/0041_daily_owner_schema.sql) locks each mapped table for the rollback transaction and refuses to drop nonempty tables. Use the [reviewed rollback procedure](../../../db/migrations/README.md). Database CI uses disposable SQL Server and synthetic data; it does not establish source data parity or authorize record movement.
