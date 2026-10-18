# Daily v182 to Jarvis implementation matrix

Source: the pinned [Daily v182 contract](README.md), including its 31 source
tables, 19 published OpenAPI paths and 36 reviewed tools. This matrix separates
the source inventory from the narrower owner-approved Jarvis implementation.
“Existing” means a Jarvis component or SQL object exists; it does not claim
source parity, live records, or production activation.

For implementation evidence below, `implemented` means a local capability is
registered with synthetic tests; it does not imply source HTTP-path parity,
real-SQL execution in this environment, deployment, or owner acceptance.

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
| `coach_profiles` | `daily.coach_profiles` | existing | Physical table reused; selected read/update native operations are implemented; SQL integration test added but requires Database CI. |
| `gmail_suppressions` | No target | excluded | Source-specific Gmail suppression state is not part of the selected Daily port. |
| `health_daily_metrics` | `daily.health_daily_metrics` | existing | SQL Server `date`/`float` and JSON adaptations; preserve source units and day semantics. |
| `health_ingestions` | `daily.health_ingestions` | existing | SQL Server owner-scoped lineage; inbound processor writes succeeded state. |
| `health_phone_sync_state` | `daily.health_phone_sync_state` | existing | Heartbeat evidence only, distinct from processed health data. |
| `health_raw_objects` | `daily.health_upload_inbox` raw bytes, temporarily | implemented | No source object-store duplicate; accepted source bytes remain in bounded SQL inbox under existing limits. |
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
| `recovery_days` | `daily.recovery_days` | existing | Physical table reused; mark/clear capability implemented; SQL integration test added but requires Database CI. |
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
semantics. Runtime defaults the feature off; this branch's authorized backend
deployment environment explicitly enables it. Deployment and endpoint
verification remain outstanding.

## Selected native tools

These are the exact 16 owner-selected capabilities. Native tools use the
existing Jarvis registry, health/nutrition services, owner authorization and
confirmation flow; they do not create another MCP server. The nine new source
operations are grouped into three registry tools to preserve the existing
128-tool limit and eight-tool headroom invariant; this is an explicit name-level
deviation from the latest PR comment, not a claim that nine distinct tools were
registered.

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
| `get_favorites` | `daily_saved_food` (read operation) | existing canonical favorites store | existing |
| `save_favorite` | `daily_saved_food` (save operation) | existing canonical favorites store | existing |
| `set_meal_preference` | `daily_nutrition_history` / `set_meal_preference` operation | `NutritionStore.feedback` and `daily.nutrition_recommendation_feedback` | implemented with Now confirmation; `source-tools.test.ts` |
| `set_recovery_period` | `daily_coach_status` / `set_recovery_period` operation | `daily.recovery_days` store | implemented with Now confirmation; SQL integration added |

## Reuse coverage: five capabilities

| Source capability | Existing Jarvis capability and evidence | Coverage |
| --- | --- | --- |
| `search` | `conversation_search`, `memory_search`, `vault_search`, and `repo_search`; health/meals are separately available through selected Daily operations. Evidence: `core/conversation.test.ts`, `core/memory.test.ts`, `vault/vault.test.ts`, and Daily `source-tools.test.ts`. | Partial; no universal source-Daily search or combined health/meal search. |
| `fetch` | `daily_query`/`daily_show` retrieve Daily records; Factory `get_task` and `get_status_summary` retrieve their own domains. Evidence: `daily/tools/show.test.ts`, `daily/routes/query.test.ts`, `factory/tools.test.ts`, and `core/status.test.ts`. | Partial; no universal cross-domain source `fetch`. |
| `get_daily_overview` | `daily_coach_status` / `get_coach_status`, `get_status_summary` and selected Daily reads. Evidence: `source-tools.test.ts` and `core/status.test.ts`. | Partial; conversational facts are supplied, but source scoreboard/fixed renderer is not reproduced. |
| `get_attention_items` | Factory task tools and Google calendar tools cover their own records; no Daily attention snapshot service is selected. Evidence: `factory/tools.test.ts`, `google/tools.test.ts`, and absence of an attention service in this matrix. | Deliberately partial; source snapshot/rule engine is not ported. |
| `get_calendar_window` | Google Calendar native tools include `calendar_list_events` and `calendar_today_agenda` in `apps/backend/src/google/tools.ts`; evidence: `google/tools.test.ts`. | Reused for ordinary calendar queries; source wrapper is not duplicated. |

## Field-level mapping and verification evidence

| Source record/fields | Jarvis target and adaptation | Evidence | Status / remaining difference |
| --- | --- | --- | --- |
| `health_daily_metrics`: `(metric_name, metric_date)`, nullable unit/value/min/avg/max, sample count, source timestamps/fields, ingestion and update time | `daily.health_daily_metrics`: owner UUID added to composite key; source TEXT date becomes SQL `date`, REAL becomes `float`, JSON remains validated `nvarchar(max)`. Values/units/nulls and date key are retained. | `daily-schema.md`; migration `0041`; `health/persistence.ts`; `database/daily-schema.integration.test.ts`; processor/read-model tests | Engine/identity adaptation verified. Completeness is unknown; partial batches may replace a supplied metric/date key. |
| `health_sleep_daily`: sleep date/start/end, nullable hour totals/phases, sources/count/ingestion/update | `daily.health_sleep_daily`: owner UUID key; SQL date/float, JSON source list, hour values unchanged. | `daily-schema.md`; migration `0041`; `health/persistence.ts`; health normalization/read-model tests | Field types/units mapped. Source wake-date and DST behavior still need source-compatible integration evidence. |
| `health_workouts`, `health_workout_metrics`, `health_workout_heart_rate_minute`: stable source workout ID, date/time, duration/energy/distance/HR, per-workout metrics and minute samples | Corresponding owner-composite `daily.health_*` tables; source IDs use binary collation, date is SQL `date`, instants remain offset-bearing text, numeric values are `float`/`bigint`, details remain validated JSON. | `daily-schema.md`; migrations `0041`/`0047`; `health/persistence.ts`; `health/processor.ts`; processor and health read-model tests | Stable IDs and empty-export preservation are implemented. Historical partial same-key replacement is unresolved. |
| `nutrition_meals`: stable ID/idempotency key, occurred instant/Copenhagen meal date, named meal/components, nullable nutrients, provenance, revision/tombstone and writeback state | `daily.nutrition_meals`: owner UUID plus canonical idempotency key, SQL `date` meal date, offset-bearing text instant, nullable nutrients and revision/tombstone. Optional Apple Health state remains stored but no outbound write is added. | `daily-schema.md`; migrations `0041`/`0050`; `nutrition/store.ts`; `nutrition/store.test.ts`; database SQL tests | Named meal history is distinct from health nutrient observations. Source-specific duplicate and HTTP response behavior remain open. |
| `nutrition_recommendation_feedback`: owner/meal key, like/dislike, created/updated | `daily.nutrition_recommendation_feedback`: owner UUID, binary meal key, nullable preference plus revision for retry-safe Jarvis writes. | `daily-schema.md`; migrations `0041`/`0050`; `NutritionStore.feedback`; saved-food and `source-tools.test.ts` | Source `null` clears by deleting the row; Jarvis retains a revisioned null row. This preservation-oriented difference is explicit. |
| `coach_profiles`: source goal, numeric target, style and structured preference fields with owner key/revision/timestamps | `daily.coach_profiles`: owner UUID replaces owner email; numeric/structured fields preserve units and meaning; updates lock and revision-check the current row. JSON remains validated `nvarchar(max)`. | `daily-schema.md`; migration `0041`; `coach-store.ts`; `daily-schema.integration.test.ts`; `source-tools.test.ts` | SQL read/update works for existing profiles. No default profile row is invented; missing-profile bootstrap/source configuration defaults remain unresolved. |
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
checked. This PR remains incomplete: source-path HTTP parity, the all-31-table
field matrix, real SQL CI, deployed HTTP/worker proof, endpoint/token handoff and
owner acceptance are not established.
