# Daily source-to-SQL mapping (P12-03)

Evidence: supplied nonsensitive `db/schema.ts` definitions from original source HEAD `9e193554c9c8c7c23a788ed3d2b0582580b76c0f`, plus manual `coach_experiments` schema-only migration. Coordinator reports complete table identifiers from the Sites overview on 12 October 2026 (projection not truncated, omitted_tables=0). This is source-code/schema-definition evidence, not a complete live record inventory or backup. The database export/import path under #717/#721/#982 was withdrawn as not planned; source-contract-first API/schema and historical ingestion/replay are specified in #1005. Retain this mapping as implementation evidence, not an export manifest or import prerequisite. The historical table count is not an export-completeness assertion.

## Mapping policy

P12-09 migration 0050 adds **target-only** favourite/feedback revisions (initial
value 1) and permits null feedback as a retained, revisioned clear. These are
concurrency metadata, not newly discovered source columns or imported values.
Existing IDs, aliases, nutrients and provenance remain unchanged. Rollback
refuses used revisions, clears and audit evidence for the new connector tools.

P12-05's additive 0047 extends only that target inbox with attempt/deadline/error-code evidence. The inactive processor writes the mapped health domain, ingestion and sync tables atomically with the processed inbox receipt, under the shared owner lock. It preserves exact historical session identities and refuses incompatible lineage; no source import, ID rewrite or raw deletion. [Normalization/read contracts](../apps/backend/src/daily/health/README.md) distinguish code-shaped synthetic coverage from private schema/data reconciliation.

P12-04 migration 0046 adds **new target-only** `daily.health_upload_capabilities` and `daily.health_upload_inbox`, not source-import mappings. The existing backend stores original accepted bytes and owner/session/checksum receipts in SQL; these are distinct from the historical `health_ingestions` / `health_raw_objects` ledger. #720 owns processing into mapped domain tables. No legacy capability, source record or secret is seeded; rollback refuses retained inbox/capability evidence. [Bounds and retention](daily-health-ingestion/README.md#bounds-and-raw-retention).

- Migration `0041_daily_owner_schema.sql` creates empty tables in a separate `daily` SQL schema. No personal seed DML, import, device/login tables, route/tool registration or Daily activation.
- Every row requires existing server-resolved `owner_object_id`; formerly global source records are scoped too. Source `owner_email` keys map to that owner, not a client email. The inactive `DailyOwnerStore.forRequest` uses P12-01's authenticated user/hosted-agent resolver, denies runners/other owners and parameterizes exact whitelisted source-key reads. No arbitrary table/column/SQL or caller-owner selection.
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

Independent review corrections: key metadata selects text/date/bigint validation and SQL binding; caller JavaScript type cannot coerce a text ID. Text predicates additionally compare DATALENGTH, preserving padded stored IDs and refusing a different-length request without trimming. Date keys require a valid exact YYYY-MM-DD; integer keys require exact signed-64-bit values. Any source-compatible implementation must detect key-length/index and SQL uniqueness-padding compatibility; it must not rewrite source IDs to fit.

The down batch takes TABLOCKX/HOLDLOCK on every Daily table while checking emptiness, held by the existing rollback transaction through all drops. Other migrations are unchanged. The concurrent-writer SQL regression observes actual lock blocking at a test-only pause after emptiness checks; either rollback succeeds and the writer cannot commit, or SQL aborts rollback and the writer's committed row remains. A migration app-lock alone is not treated as writer exclusion. These correction checks require fresh exact-head Database/full CI; earlier passing runs did not cover them.

Offline evidence on 12 October 2026: 84 focused Daily/store/module/auth tests, backend lint/build and diff checks passed. GitHub run [38261899841](https://github.com/DanAakesen/jarvis/actions/runs/38261899841) on `29aee5be592766914d875314b9dc479de0a16a5b` passed real SQL Server Database CI and production backend image build/smoke, including bigint/scalar-JSON semantics, owner-composite foreign keys, case-distinct IDs and the actual nonempty rollback guard. Full required final-head CI is recorded in PR #742 before review handoff. Local SQL image pull was forbidden; no local SQL success is asserted.

Initial Database CI exposed an existing test's assumption that 0040 was the last migration. The test now unwinds newer empty migrations in reverse order, preserves its 0040 column/data assertions, restores the full tree and then cleans its fixture; paging assertions remain unchanged. The Daily rollback regression uses the full correct API signature and requires the specific nonempty guard error, not any rejection.

Real SQL Server integration tests apply this migration through the existing transaction/ledger mechanism in a unique loopback test database, check empty mapped tables, existing Jarvis fixture preservation, owner/agent/runner isolation, exact keys, idempotency, revisions/tombstones, unknown values, recovery preservation, raw ledger distinctions, mixed-source denial and guarded rollback. Existing database CI discovers the new integration test. Synthetic data only; passing tests are not production data parity.

The down batch refuses to drop any nonempty Daily table and runs only through the existing reviewed rollback path. It does not grant data-deletion permission. Schema deployment adds empty tables via normal main-only release after independent merge; coding agents never access Azure. Original Daily code/schema/records stay untouched by this cleanup; ordinary authorized source writes continue and it remains canonical. The cancelled export/import issues do not authorize record movement or define prerequisites for #718; source-compatible implementation and replay acceptance remain with #1005.
