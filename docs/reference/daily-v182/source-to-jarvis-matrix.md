# Daily v182 to Jarvis implementation matrix

Source: the pinned [Daily v182 contract](README.md), including its 31 source
tables, 19 published OpenAPI paths and 36 reviewed tools. This matrix separates
the source inventory from the narrower owner-approved Jarvis implementation.
“Existing” means a Jarvis component or SQL object exists; it does not claim
source parity, live records, or production activation. P14-35 evidence is dated
19 October 2026.

For implementation evidence below, `implemented` means a local capability is
registered with synthetic tests; it does not imply source HTTP-path parity,
real-SQL execution in this environment, deployment, or owner acceptance.

## Machine-checked schema classification (19 October 2026)

[`source-schema.test.ts`](../../../apps/backend/src/daily/source-schema.test.ts)
parses the pinned SQLite DDL, asserts the exact 31 table names and 360 columns,
and compares each column against tables created or extended by Jarvis SQL
migrations. It fingerprints ordered source column names and counts, validates
every target table and column, rejects stale source-column classifications, and
fails on an unclassified column.

The test currently finds **248 exact-name column matches, 0 evidence-backed
renames, 91 intentionally excluded columns, and 21 not mapped columns**. The
21 unverified columns are ten `owner_email` fields, ten `health_raw_objects`
lifecycle fields, and `nutrition_queue.claim_token`. The raw-object source table
and Jarvis SQL inbox have different lifecycles; matching `checksum` alone does
not establish row parity. No owner identity rename is claimed without evidence.
These are schema correspondences only, not data, SQL type, or behavioral parity.

## Source tables

| Source table | Jarvis mapping | State | Notes |
| --- | --- | --- | --- |
| `attention_items` | No target; ordinary Jarvis task/calendar/search capabilities remain separate | excluded | Source attention snapshots and fixed action rules are not selected. |
| `attention_rule_config` | No target | excluded | Do not recreate the source rule engine. |
| `attention_runs` | No target | excluded | No Daily attention scheduler or snapshot pipeline. |
| `attention_source_snapshots` | No target | excluded | No Daily source snapshot service. |
| `briefing_runs` | No target | excluded | Fixed/scheduled Daily brief renderer is excluded. |
| `coach_commitments` | `daily.coach_commitments` | existing | Preserve existing rows/schema; commitment and order capabilities are excluded. |
| `coach_experiments` | `daily.coach_experiments` | existing | Preserve existing rows/schema; weekly experiments are excluded. |
| `coach_profiles` | `daily.coach_profiles` | existing | Physical table reused; selected read/update native operations are implemented; SQL integration passed in PR #1008 Database CI. |
| `gmail_suppressions` | No target | excluded | Source-specific Gmail suppression state is not part of the selected Daily port. |
| `health_daily_metrics` | `daily.health_daily_metrics` | existing | SQL Server `date`/`float` and JSON adaptations; preserve source units and day semantics. |
| `health_ingestions` | `daily.health_ingestions` | existing | SQL Server owner-scoped lineage; inbound processor writes succeeded state. |
| `health_phone_sync_state` | `daily.health_phone_sync_state` | existing | Heartbeat evidence only, distinct from processed health data. |
| `health_raw_objects` | `daily.health_upload_inbox` | partial | `checksum` has an exact-name target; the other ten source object-lifecycle columns have no verified mapping to the per-request inbox. No source object-store equivalence is claimed. |
| `health_sleep_daily` | `daily.health_sleep_daily` | existing | SQL Server `date`/`float`; offsets normalize through the existing processor. |
| `health_sync_feeds` | `daily.health_sync_feeds` | existing | Per-feed successful processing freshness. |
| `health_sync_state` | `daily.health_sync_state` | existing | Owner-scoped ingestion and processing summary. |
| `health_workout_heart_rate_minute` | `daily.health_workout_heart_rate_minute` | existing | SQL Server date/time text and numeric adaptations; owner/workout key preserved. |
| `health_workout_metrics` | `daily.health_workout_metrics` | existing | SQL Server `float` and JSON adaptations; stable workout identity retained. |
| `health_workouts` | `daily.health_workouts` | existing | Stable source workout ID is the target key; older accepted snapshots cannot replace newer rows. |
| `mcp_oauth_codes` | No target | excluded | No second/parallel MCP authentication runtime. |
| `mcp_oauth_refresh_tokens` | No target | excluded | No second/parallel MCP authentication runtime. |
| `mcp_oauth_tokens` | No target | excluded | No second/parallel MCP authentication runtime. |
| `nutrition_favorites` | `daily.nutrition_favorites` | existing | Existing owner-scoped canonical favorites; selected `daily_saved_food` operations retained and tested. |
| `nutrition_meal_plans` | `daily.nutrition_meal_plans` | existing | Preserve the schema and rows; meal-plan tools are explicitly excluded. |
| `nutrition_meals` | `daily.nutrition_meals` | existing | Canonical named-meal path, not numeric Health nutrient observations. |
| `nutrition_queue` | `daily.nutrition_queue` | existing | Preserve data; optional Apple Health meal write-back queue is excluded. |
| `nutrition_recommendation_feedback` | `daily.nutrition_recommendation_feedback` | existing | Existing preference persistence; selected preference operation uses it and has synthetic confirmation/owner tests. Null clears to a retained revisioned null row, unlike source delete semantics. |
| `order_suppressions` | No target | excluded | Coach orders and their suppression lifecycle are excluded. |
| `readiness_checkins` | `daily.readiness_checkins` | existing | Preserve rows/schema; standalone Ready workflow is excluded. |
| `recovery_days` | `daily.recovery_days` | existing | Physical table reused; mark/clear capability is implemented; SQL integration passed in PR #1008 Database CI. |
| `widget_auth_attempts` | No target | excluded | Legacy widget authentication/rendering is excluded. |

Existing SQL objects are defined in migrations `0041_daily_owner_schema.sql`
through `0047_daily_health_processing.sql`; later numbered migrations extend
them without editing applied files. The SQL Server schema is deliberately not
claimed to be byte-for-byte identical to SQLite/D1.

## Published OpenAPI paths

The 19 unique source paths below map to existing Jarvis native services and
contracts, not to duplicated `/api/gpt-actions/*` routes. The general Daily
query API and native tools are only composed when their existing Daily gate is
on. Health upload paths are a separate inbound contract, not among these 19
source OpenAPI paths.

| Source path | Jarvis route/service mapping | State |
| --- | --- | --- |
| `GET /api/gpt-actions/site/overview` | `daily_coach_status` operation `get_coach_status` plus existing `/daily/query`; no source-specific route | partial; native operation implemented, source HTTP shape not |
| `GET /api/gpt-actions/health/summary` | `daily_health_summary` operation `get_health_summary`; uses `DailyHealthReadModel` | partial; native operation implemented, source HTTP shape not |
| `GET /api/gpt-actions/health/history` | `daily_health_summary` operation `get_health_history`; uses `DailyHealthReadModel` | partial; native operation implemented, source HTTP shape not |
| `GET /api/gpt-actions/site/attention` | Existing Jarvis tasks/calendar/search; no Daily snapshot endpoint | deliberate partial; Daily snapshots excluded |
| `GET /api/gpt-actions/site/calendar` | Existing Google Calendar native tools | existing |
| `POST /api/gpt-actions/nutrition/lookup` | Existing `daily_food_lookup` native service; no source path alias | existing |
| `POST /api/gpt-actions/nutrition/log` | Existing `daily_food` native service and owner confirmation flow | existing |
| `GET /api/gpt-actions/nutrition/analyze` | `daily_nutrition_history` operation `analyze_nutrition`; existing canonical nutrition store | partial; native operation implemented, source HTTP shape not |
| `POST /api/gpt-actions/nutrition/update` | Existing `daily_food` correction service and confirmation flow | existing |
| `POST /api/gpt-actions/nutrition/delete` | Existing `daily_food` deletion service and confirmation flow | existing |
| `POST /api/gpt-actions/nutrition/export-apple-health` | No route; optional outbound meal write-back is excluded | excluded |
| `GET /api/gpt-actions/nutrition/pending` | No route; no Apple Health meal-writeback lifecycle is selected | excluded |
| `POST /api/gpt-actions/nutrition/cancel` | No route; outbound meal write-back cancellation is excluded | excluded |
| `POST /api/gpt-actions/nutrition/retry` | No route; outbound meal write-back retry is excluded | excluded |
| `POST /api/gpt-actions/nutrition/release-claim` | No route; source-specific queue claims are excluded | excluded |
| `GET /api/gpt-actions/nutrition/history` | `daily_nutrition_history` operation `get_nutrition_history`; existing canonical meal store | partial; native operation implemented, source HTTP shape not |
| `GET, POST /api/gpt-actions/nutrition/favorites` | Existing `/daily/query` and native saved-food service | existing |
| `GET, POST /api/gpt-actions/nutrition/meal-plans` | No ported route; preserve existing SQL without exposing excluded tools | excluded |
| `GET /api/gpt-actions/nutrition/calorie-balance` | `daily_nutrition_history` operation `get_calorie_balance`; health and canonical-meal reads | partial; native operation implemented, source HTTP shape not |

The corresponding inbound phone routes remain `POST /api/health/ingest` and
`POST /api/health/heartbeat`; the code retains the original headers/body
semantics. Runtime defaults the feature off; the reviewed backend deployment
environment explicitly enables it. Post-merge deployment succeeded, but
upload-specific production authentication/processing and phone acceptance remain
unverified. See the [delivery status report](delivery-status.md).

## P14-35 row dispositions (19 October 2026)

| Delivery row | Status | Evidence and remaining decision |
| --- | --- | --- |
| Backend/schema classification | owner question | [`source-schema.test.ts`](../../../apps/backend/src/daily/source-schema.test.ts) checks 248 exact-name matches, 0 evidence-backed renames, 91 explicitly excluded columns, and 21 individually reasoned not-mapped columns. See the proposed scope question in `docs/decisions.md`. |
| Sleep dates and DST | owner question | [`daily-source-contract.md`](daily-source-contract.md#dates-and-timezone) documents source date precedence; source-compatible SQL boundary vectors are not present. |
| Coach profile bootstrap | owner question | [`daily-api.md`](daily-api.md#tool-runtime-and-persistence-notes) documents a source code-default profile at revision 0; Jarvis missing-profile behavior is covered by [`daily-schema.integration.test.ts`](../../../apps/backend/src/database/daily-schema.integration.test.ts), but the configured defaults are not reproduced. |
| Preference clear | owner question | The source deletes on null; Jarvis retains a revisioned null row. See field mapping and proposed decision in `docs/decisions.md`. |
| Meal duplicate/HTTP behavior | owner question | The source's idempotent insert and HTTP 200 response are documented; no Jarvis source-path contract test establishes equivalence. |
| API compatibility | owner question | All 19 paths are listed above; source requests have not all been exercised against Jarvis request/response/error contracts. |
| Sixteen capabilities | owner question | Capability mappings and registration tests exist; source contract parity is incomplete and three tools group nine operations. |
| Historical per-key replay | verified | The [`health-processing.integration.test.ts`](../../../apps/backend/src/database/health-processing.integration.test.ts) asserts later partial replacement and older replay protection, matching the pinned per-key rule; it runs in the required Database CI job. |
| Complete-day protection | owner question | Neither contract defines a complete-day marker; any stronger Jarvis-only guard needs an explicit ruling. |
| Five reused capabilities | owner question | Exact partial differences are listed in [reuse coverage](#reuse-coverage-five-capabilities); whether to accept or extend them remains open. |
| CI/deployment baseline | verified | Prior PR #1008 CI and deployment runs are linked from the [delivery status](delivery-status.md); they do not verify the current head or live upload. |
| Credential, history and phone acceptance | owner step | The checklist is in the [delivery status](delivery-status.md#remaining-owner-only-acceptance-steps). |

## Selected native tools

These are the exact 16 owner-selected capabilities. Native tools use the
existing Jarvis registry, health/nutrition services, owner authorization and
confirmation flow; they do not create another MCP server. The nine new source
operations were grouped into three registry tools under the former 128-tool
limit and eight-slot reserve; #1204 supersedes that count-based rationale. This
is an explicit name-level deviation from the latest PR comment, not a claim
that nine distinct tools were registered.

| Source capability | Native Jarvis tool | Service | State |
| --- | --- | --- | --- |
| `get_health_summary` | `daily_health_summary` / `get_health_summary` operation | `DailyHealthReadModel` | implemented; `source-tools.test.ts` |
| `get_health_history` | `daily_health_summary` / `get_health_history` operation | `DailyHealthReadModel` | implemented; `source-tools.test.ts` |
| `get_nutrition_history` | `daily_nutrition_history` / `get_nutrition_history` operation | canonical nutrition store | implemented; `source-tools.test.ts` |
| `analyze_nutrition` | `daily_nutrition_history` / `analyze_nutrition` operation | nutrition day totals and recovery markers | implemented with 366-day limit; `source-tools.test.ts` |
| `get_calorie_balance` | `daily_nutrition_history` / `get_calorie_balance` operation | nutrition day totals plus Health energy metrics | implemented; unknown expenditure remains null; `source-tools.test.ts` |
| `lookup_food` | `daily_food_lookup` | existing food lookup | existing |
| `log_food` | `daily_food` (log operation) | existing canonical meal writer | existing |
| `update_food` | `daily_food` (correct operation) | existing canonical meal writer | existing |
| `delete_food` | `daily_food` (delete operation) | existing canonical meal writer | existing |
| `get_coach_status` | `daily_coach_status` / `get_coach_status` operation | conversational health/nutrition/profile/recovery data | implemented as data-only, no fixed renderer; `source-tools.test.ts` |
| `get_coach_profile` | `daily_coach_status` / `get_coach_profile` operation | `daily.coach_profiles` store | implemented; missing profile remains unconfigured; SQL integration added |
| `update_coach_profile` | `daily_coach_status` / `update_coach_profile` operation | `daily.coach_profiles` store | confirmed revision-checked update; SQL integration added |
| `get_favorites` | `daily_saved_food` `lookup_saved` operation | existing canonical favorites store | partial: exact-name/alias lookup, not the source `query`/`limit` favorites list; owner ruling required |
| `save_favorite` | `daily_saved_food` (save operation) | existing canonical favorites store | existing |
| `set_meal_preference` | `daily_nutrition_history` / `set_meal_preference` operation | `NutritionStore.feedback` and `daily.nutrition_recommendation_feedback` | implemented with Now confirmation; `source-tools.test.ts` |
| `set_recovery_period` | `daily_coach_status` / `set_recovery_period` operation | `daily.recovery_days` store | implemented with Now confirmation; SQL integration added |

## Reuse coverage: five capabilities

| Source capability | Existing Jarvis capability and evidence | Coverage |
| --- | --- | --- |
| `search` | `conversation_search`, `memory_search`, `vault_search`, and `repo_search`; health/meals are separately available through selected Daily operations. Evidence: `core/conversation.test.ts`, `core/memory.test.ts`, `vault/vault.test.ts`, and Daily `source-tools.test.ts`. | Partial: no one search combines Daily health/named meals with tasks and calendar; each existing search has its own domain/index. |
| `fetch` | `daily_query`/`daily_show` retrieve Daily records; Factory `get_task` and `get_status_summary` retrieve their own domains. Evidence: `daily/tools/show.test.ts`, `daily/routes/query.test.ts`, `factory/tools.test.ts`, and `core/status.test.ts`. | Partial: there is no cross-domain resolver that accepts a source item/reference and fetches its owning record. |
| `get_daily_overview` | `daily_coach_status` / `get_coach_status`, `get_status_summary` and selected Daily reads. Evidence: `source-tools.test.ts` and `core/status.test.ts`. | Partial: conversational health/nutrition/profile/recovery facts are available, but no source scoreboard or fixed renderer is reproduced. |
| `get_attention_items` | Factory task tools and Google calendar tools cover their own records; no Daily attention snapshot service is selected. Evidence: `factory/tools.test.ts`, `google/tools.test.ts`, and absence of an attention service in this matrix. | Deliberately partial: Jarvis has no source attention snapshot/status aggregation or fixed source attention rules; task/calendar data are not a substitute for those derived items. |
| `get_calendar_window` | Google Calendar native tools include `calendar_list_events` and `calendar_today_agenda` in `apps/backend/src/google/tools.ts`; evidence: `google/tools.test.ts`. | Partial: ordinary event-list/agenda queries are reused, but the source-specific window wrapper and its response contract are not duplicated. |

## Field-level mapping and verification evidence

| Source record/fields | Jarvis target and adaptation | Evidence | Status / remaining difference |
| --- | --- | --- | --- |
| `health_daily_metrics`: `(metric_name, metric_date)`, nullable unit/value/min/avg/max, sample count, source timestamps/fields, ingestion and update time | `daily.health_daily_metrics`: source columns with exact names exist in the migration; source TEXT date becomes SQL `date`, REAL becomes `float`, JSON remains validated `nvarchar(max)`. Values/units/nulls and date key are retained. | `daily-schema.md`; migration `0041`; `health/persistence.ts`; `database/daily-schema.integration.test.ts`; processor/read-model tests; [P14-35 replay test](../../../apps/backend/src/database/health-processing.integration.test.ts) | The inventory checks exact column correspondence, not source semantics or all-column parity. The later-partial replacement assertion remains unverified on this head. The pinned source replaces supplied keys and defines no complete-day marker. |
| `health_sleep_daily`: sleep date/start/end, nullable hour totals/phases, sources/count/ingestion/update | `daily.health_sleep_daily`: owner UUID key; SQL date/float, JSON source list, hour values unchanged. | `daily-schema.md`; migration `0041`; `health/persistence.ts`; health normalization/read-model tests; [P14-35 schema classification](../../../apps/backend/src/daily/source-schema.test.ts) | Selected field types/units are mapped. Source key precedence is documented, but source-compatible SQL evidence for conflicting dates and DST boundaries is still needed. |
| `health_workouts`, `health_workout_metrics`, `health_workout_heart_rate_minute`: stable source workout ID, date/time, duration/energy/distance/HR, per-workout metrics and minute samples | Corresponding owner-composite `daily.health_*` tables; source IDs use binary collation, date is SQL `date`, instants remain offset-bearing text, numeric values are `float`/`bigint`, details remain validated JSON. | `daily-schema.md`; migrations `0041`/`0047`; `health/persistence.ts`; `health/processor.ts`; processor and health read-model tests | Stable IDs and empty-export preservation are implemented. Historical partial same-key replacement is unresolved. |
| `nutrition_meals`: stable ID/idempotency key, occurred instant/Copenhagen meal date, named meal/components, nullable nutrients, provenance, revision/tombstone and writeback state | `daily.nutrition_meals`: owner UUID plus canonical idempotency key, SQL `date` meal date, offset-bearing text instant, nullable nutrients and revision/tombstone. Optional Apple Health state remains stored but no outbound write is added. | `daily-schema.md`; migrations `0041`/`0050`; `nutrition/store.ts`; `nutrition/store.test.ts`; database SQL tests | Named meal history is distinct from health nutrient observations. Pinned source duplicate semantics are `INSERT OR IGNORE` by owner/key and return the retained meal with `duplicate:true`; Jarvis has no source-path HTTP response test. Owner question is in `docs/decisions.md`. |
| `nutrition_recommendation_feedback`: owner/meal key, like/dislike, created/updated | `daily.nutrition_recommendation_feedback`: owner UUID, binary meal key, nullable preference plus revision for retry-safe Jarvis writes. | `daily-schema.md`; migrations `0041`/`0050`; `NutritionStore.feedback`; saved-food and `source-tools.test.ts` | Source `null` clears by deleting the row; Jarvis retains a revisioned null row. This preservation-oriented difference remains an owner question. |
| `coach_profiles`: source goal, numeric target, style and structured preference fields with owner key/revision/timestamps | `daily.coach_profiles`: owner UUID replaces owner email; numeric/structured fields preserve units and meaning; updates lock and revision-check the current row. JSON remains validated `nvarchar(max)`. | `daily-schema.md`; migration `0041`; `coach-store.ts`; `daily-schema.integration.test.ts`; `source-tools.test.ts` | SQL read/update works for existing profiles. Jarvis returns not-configured for a missing row; the pinned API reference says source returns a code-default profile at revision 0, but does not list the configured values. |
| `recovery_days`: owner/date/context/create/update | `daily.recovery_days`: owner UUID plus SQL `date`, context and timestamps; clear deletes markers only. | `daily-schema.md`; migration `0041`; `coach-store.ts`; `daily-schema.integration.test.ts`; `source-tools.test.ts` | Confirmed mark/clear preserves health records. Effects on every other analytical denominator are not implemented by these selected tools. |

This evidence covers the named selected records only. It is not a completed
field-by-field verification of all 31 tables and 19 source paths.

## Excluded source tools

All 15 excluded tools are deliberately omitted; existing tables/data are
preserved and no source compatibility alias or parallel runtime is created.

| Source tool | Disposition | State |
| --- | --- | --- |
| `get_recomposition_progress` | LLM may reason from selected facts; no separate Recomp tool | excluded |
| `ready` | No standalone Ready workflow | excluded |
| `review` | No standalone Review workflow | excluded |
| `get_meal_coach` | No separate meal-coach endpoint/tool | excluded |
| `get_coach_commitments` | Coach commitments/orders excluded | excluded |
| `save_coach_orders` | Coach commitments/orders excluded | excluded |
| `commit_weekly_experiment` | Weekly experiments excluded | excluded |
| `queue_apple_health_export` | Outbound meal write-back excluded | excluded |
| `cancel_food` | Outbound meal write-back cancellation excluded | excluded |
| `retry_uncertain_food` | Outbound meal write-back retry excluded | excluded |
| `render_coach_status` | No legacy fixed renderer | excluded |
| `render_coach_response` | No legacy fixed renderer | excluded |
| `get_nutrition_activity_trends` | No duplicate trend-only tool | excluded |
| `get_meal_plans` | Meal plans are not a selected capability | excluded |
| `save_meal_plan` | Meal plans are not a selected capability | excluded |

Excluded means the owner did not select that source feature. Existing means the
component is present; see the evidence table for fields and semantics actually
checked. The PR #1008 SQL integration CI passed. Source-path HTTP parity,
complete semantic/type/behavior parity across all 31 tables/360 columns,
upload-specific deployed HTTP/worker proof, current credential status/handoff
and owner phone acceptance remain open. The P14-35 schema test checks column
name correspondence but does not prove semantic or behavioral parity. See the
[delivery status report](delivery-status.md).
