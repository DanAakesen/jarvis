# Daily v182 to Jarvis implementation matrix

Source: the pinned [Daily v182 contract](README.md), including its 31 source
tables, 19 published OpenAPI paths and 36 reviewed tools. This matrix separates
the source inventory from the narrower owner-approved Jarvis implementation.
“Existing” means a Jarvis component or SQL object exists; it does not claim
source parity, live records, or production activation.

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
| `coach_profiles` | `daily.coach_profiles` | existing | Physical table exists; selected read/update API and native capability are pending in PR #1008. |
| `gmail_suppressions` | No target | excluded | Source-specific Gmail suppression state is not part of the selected Daily port. |
| `health_daily_metrics` | `daily.health_daily_metrics` | existing | SQL Server `date`/`float` and JSON adaptations; preserve source units and day semantics. |
| `health_ingestions` | `daily.health_ingestions` | existing | SQL Server owner-scoped lineage; inbound processor writes succeeded state. |
| `health_phone_sync_state` | `daily.health_phone_sync_state` | existing | Heartbeat evidence only, distinct from processed health data. |
| `health_raw_objects` | `daily.health_upload_inbox` raw bytes, temporarily | required in PR #1008 | No source object-store duplicate; accepted source bytes remain in bounded SQL inbox under existing limits. |
| `health_sleep_daily` | `daily.health_sleep_daily` | existing | SQL Server `date`/`float`; offsets normalize through the existing processor. |
| `health_sync_feeds` | `daily.health_sync_feeds` | existing | Per-feed successful processing freshness. |
| `health_sync_state` | `daily.health_sync_state` | existing | Owner-scoped ingestion and processing summary. |
| `health_workout_heart_rate_minute` | `daily.health_workout_heart_rate_minute` | existing | SQL Server date/time text and numeric adaptations; owner/workout key preserved. |
| `health_workout_metrics` | `daily.health_workout_metrics` | existing | SQL Server `float` and JSON adaptations; stable workout identity retained. |
| `health_workouts` | `daily.health_workouts` | existing | Stable source workout ID is the target key; older accepted snapshots cannot replace newer rows. |
| `mcp_oauth_codes` | No target | excluded | No second/parallel MCP authentication runtime. |
| `mcp_oauth_refresh_tokens` | No target | excluded | No second/parallel MCP authentication runtime. |
| `mcp_oauth_tokens` | No target | excluded | No second/parallel MCP authentication runtime. |
| `nutrition_favorites` | `daily.nutrition_favorites` | existing | Existing owner-scoped canonical favorites; selected tool registration is pending in PR #1008. |
| `nutrition_meal_plans` | `daily.nutrition_meal_plans` | existing | Preserve the schema and rows; meal-plan tools are explicitly excluded. |
| `nutrition_meals` | `daily.nutrition_meals` | existing | Canonical named-meal path, not numeric Health nutrient observations. |
| `nutrition_queue` | `daily.nutrition_queue` | existing | Preserve data; optional Apple Health meal write-back queue is excluded. |
| `nutrition_recommendation_feedback` | `daily.nutrition_recommendation_feedback` | existing | Existing food preference persistence; selected preference API/tool is pending in PR #1008. |
| `order_suppressions` | No target | excluded | Coach orders and their suppression lifecycle are excluded. |
| `readiness_checkins` | `daily.readiness_checkins` | existing | Preserve rows/schema; standalone Ready workflow is excluded. |
| `recovery_days` | `daily.recovery_days` | existing | Physical table exists; selected owner-requested recovery API/tool is pending in PR #1008. |
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
| `GET /api/gpt-actions/site/overview` | Existing native Status and Daily query; no source-specific route | pending in PR #1008 |
| `GET /api/gpt-actions/health/summary` | `/daily/query` health/sync sources via `DailyHealthReadModel` | pending in PR #1008 |
| `GET /api/gpt-actions/health/history` | `/daily/query` health/workout history via `DailyHealthReadModel` | pending in PR #1008 |
| `GET /api/gpt-actions/site/attention` | Existing Jarvis tasks/calendar/search; no Daily snapshot endpoint | pending in PR #1008 |
| `GET /api/gpt-actions/site/calendar` | Existing Google Calendar native tools | existing |
| `POST /api/gpt-actions/nutrition/lookup` | Existing `daily_food_lookup` native service; no source path alias | existing |
| `POST /api/gpt-actions/nutrition/log` | Existing `daily_food` native service and owner confirmation flow | existing |
| `GET /api/gpt-actions/nutrition/analyze` | `/daily/query` nutrition history/totals and existing nutrition services | pending in PR #1008 |
| `POST /api/gpt-actions/nutrition/update` | Existing `daily_food` correction service and confirmation flow | existing |
| `POST /api/gpt-actions/nutrition/delete` | Existing `daily_food` deletion service and confirmation flow | existing |
| `POST /api/gpt-actions/nutrition/export-apple-health` | No route; optional outbound meal write-back is excluded | excluded |
| `GET /api/gpt-actions/nutrition/pending` | No route; no Apple Health meal-writeback lifecycle is selected | excluded |
| `POST /api/gpt-actions/nutrition/cancel` | No route; outbound meal write-back cancellation is excluded | excluded |
| `POST /api/gpt-actions/nutrition/retry` | No route; outbound meal write-back retry is excluded | excluded |
| `POST /api/gpt-actions/nutrition/release-claim` | No route; source-specific queue claims are excluded | excluded |
| `GET /api/gpt-actions/nutrition/history` | `/daily/query` nutrition history; existing canonical meal store | pending in PR #1008 |
| `GET, POST /api/gpt-actions/nutrition/favorites` | Existing `/daily/query` and native saved-food service | existing |
| `GET, POST /api/gpt-actions/nutrition/meal-plans` | No ported route; preserve existing SQL without exposing excluded tools | excluded |
| `GET /api/gpt-actions/nutrition/calorie-balance` | `/daily/query` nutrition/health sources; native calculation coverage is pending in PR #1008 | pending in PR #1008 |

The corresponding inbound phone routes remain `POST /api/health/ingest` and
`POST /api/health/heartbeat`; they retain original headers/body semantics and
are separately gated by the new default-off health-upload switch.

## Selected native tools

These are the exact 16 owner-selected capabilities. Native tools use the
existing Jarvis registry, health/nutrition services, owner authorization and
confirmation flow; they do not create another MCP server. All 16 selected
capabilities belong to the complete delivery in issue #1005 and this same PR
#1008. Unimplemented capabilities remain pending in this PR; they are not
deferred to a separate task or a predetermined later execution.

| Source capability | Native Jarvis tool | Service | State |
| --- | --- | --- | --- |
| `get_health_summary` | `daily_health_summary` | `DailyHealthReadModel` | pending in PR #1008 |
| `get_health_history` | `daily_health_history` | `DailyHealthReadModel` | pending in PR #1008 |
| `get_nutrition_history` | `daily_nutrition_history` | canonical nutrition query | pending in PR #1008 |
| `analyze_nutrition` | `daily_nutrition_analyze` | nutrition totals/trends query | pending in PR #1008 |
| `get_calorie_balance` | `daily_calorie_balance` | nutrition plus Health energy query | pending in PR #1008 |
| `lookup_food` | `daily_food_lookup` | existing food lookup | existing |
| `log_food` | `daily_food` (log operation) | existing canonical meal writer | existing |
| `update_food` | `daily_food` (correct operation) | existing canonical meal writer | existing |
| `delete_food` | `daily_food` (delete operation) | existing canonical meal writer | existing |
| `get_coach_status` | `daily_coach_status` | consolidated conversational data/profile service | pending in PR #1008 |
| `get_coach_profile` | `daily_coach_profile` (read operation) | `daily.coach_profiles` service | pending in PR #1008 |
| `update_coach_profile` | `daily_coach_profile` (update operation) | `daily.coach_profiles` service | pending in PR #1008 |
| `get_favorites` | `daily_saved_food` (read operation) | existing canonical favorites store | existing |
| `save_favorite` | `daily_saved_food` (save operation) | existing canonical favorites store | existing |
| `set_meal_preference` | `daily_meal_preference` | existing nutrition preference persistence | pending in PR #1008 |
| `set_recovery_period` | `daily_recovery_period` | `daily.recovery_days` service | pending in PR #1008 |

Names above identify the intended native capabilities; implementation in this PR
may adjust names to match the existing registry convention while preserving
this one-to-one source mapping.

## Reuse coverage: five capabilities

| Source capability | Existing Jarvis capability and evidence | Coverage |
| --- | --- | --- |
| `search` | `conversation_search`, `memory_search`, `vault_search`, and `repo_search` exist; none is a source-Daily universal search endpoint. | Partial; health/meal discovery remains a pending verification gap. |
| `fetch` | `daily_show` retrieves selected Daily records; factory `get_task` and `get_status_summary` retrieve their own domains. | Partial; no universal source `fetch` equivalent. |
| `get_daily_overview` | `get_status_summary`, Daily capabilities/query and existing chat/voice composition are present. | Gap: no consolidated Daily Status native tool yet. |
| `get_attention_items` | Factory task tools and Google calendar tools cover their own records; no Daily attention snapshot service is selected. | Deliberately partial; source snapshot/rule engine is not ported. |
| `get_calendar_window` | Google Calendar native tools include `calendar_list_events` and `calendar_today_agenda` in `apps/backend/src/google/tools.ts`. | Existing coverage for ordinary calendar queries; source wrapper is not duplicated. |

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

Pending means required work remains in this same PR #1008. Excluded means the
owner did not select that source feature. Existing means present in code/schema,
not verified compatible: acceptance still requires field-level and behavioral
comparison against the pinned Daily documentation, with test evidence. The whole
backend/API/selected-tool implementation and usable endpoint/private bearer-token
handoff remain required before this task can be called complete.
