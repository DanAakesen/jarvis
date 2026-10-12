# Daily source-to-SQL mapping (P12-03)

Evidence: supplied nonsensitive `db/schema.ts` definitions from original source HEAD `9e193554c9c8c7c23a788ed3d2b0582580b76c0f`, plus manual `coach_experiments` schema-only migration. Coordinator reports complete table identifiers from the Sites overview on 12 October 2026 (projection not truncated, omitted_tables=0). This is source-code/schema-definition evidence, not a complete live column/type/snapshot export or backup. Protected source-schema reconciliation and backup/import acceptance remain open under #717/#721. The historical table count is not an export-completeness assertion.

## Mapping policy

- Migration `0041_daily_owner_schema.sql` creates empty tables in a separate `daily` SQL schema. No personal seed DML, import, device/login tables, route/tool registration or Daily activation.
- Every row requires existing server-resolved `owner_object_id`; formerly global source records are scoped too. Source `owner_email` keys map to that owner, not a client email. The inactive `DailyOwnerStore.forRequest` uses P12-01's authenticated user/hosted-agent resolver, denies runners/other owners and parameterizes exact whitelisted source-key reads. No arbitrary table/column/SQL or caller-owner selection.
- Original legacy IDs/composite keys remain explicit columns; the configured owner prefixes keys and uniqueness. Key strings use binary collation; target indexed keys are bounded to 256 UTF-16 code units. Protected schema/value reconciliation must reject overlength keys and obtain a reviewed compatible widening before import; never truncate or hash-replace source IDs. SQL limits fail instead of silently rewriting data. Free-text/JSON uses nvarchar(max), times retain original text/offsets (64 code units), local dates use SQL date, SQLite REAL uses float, optional unknowns stay NULL. Device/business validation is downstream.
- Preserve source defaults, nutrition revisions/tombstones/idempotency, ingestion lineage, raw original versus sanitized checksums, retention/deletion/status fields, nullable activity/body/sleep/nutrient values, readiness context, recovery dates, feedback, experiments and suppressions. Recovery rows never overwrite measurements or insert averaged replacements. The raw ledger does not prove raw bytes still exist.
- Composite owner foreign keys follow the supplied explicit source relationships only (workout children and attention children); they cannot attach a child's row to another owner. Hard-delete cascades are intentionally omitted: no source deletion/import service is implemented; retention requires later reviewed handling.
- Mixed attention snapshots/items/config reject a TickTick source discriminator. Runs/briefs with mixed JSON are NOT directly importable: the protected importer must explicitly exclude TickTick items and sanitize mixed source-status/snapshot/body/rule JSON against verified source semantics; unknown/unclassified source payloads fail closed before active migration. Historical originals may remain only in the protected excluded backup. No TickTick tools/feed activation.

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

Real SQL Server integration tests apply this migration through the existing transaction/ledger mechanism in a unique loopback test database, check empty mapped tables, existing Jarvis fixture preservation, owner/agent/runner isolation, exact keys, idempotency, revisions/tombstones, unknown values, recovery preservation, raw ledger distinctions, mixed-source denial and guarded rollback. Existing database CI discovers the new integration test. Synthetic data only; passing tests are not production data parity.

The down batch refuses to drop any nonempty Daily table and runs only through the existing reviewed rollback path. It does not grant data-deletion permission. Schema deployment adds empty tables via normal main-only release after independent merge; coding agents never access Azure. Original Daily code/schema/records stay untouched by migration tooling; ordinary authorized source writes continue and it remains canonical before cutover. #717 remains parked with draft #741 and deferred; it is not a dependency of #718 and is not accepted/closed by this schema work.
