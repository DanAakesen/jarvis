# Original Daily v182 source reference

Source: original Sites Daily Overview, version **182**, SHA `9e193554c9c8c7c23a788ed3d2b0582580b76c0f`. Evidence date: 18 October 2026. This is the original app, not the DanAakesen/daily refresh-service repository.

Current implementation gaps and endpoint/credential evidence are summarized in the [delivery status report](delivery-status.md).

The source agent completed its documentation and Dan confirmed his validation. This handoff retains the six original delivered files. Original Daily code, credentials and data remain unchanged.

## Source documentation

| File | Coverage |
| --- | --- |
| [daily-source-contract.md](daily-source-contract.md) | Health, workout and nutrition API/data flows, normalization, persistence and historical replay |
| [daily-api.md](daily-api.md) | Entire HTTP backend, authentication, request/response/error contracts and MCP runtime |
| [daily-schema.md](daily-schema.md) | All 31 source tables and 360 columns, types, keys, relationships, indexes and defaults |
| [daily-source-schema.sql](daily-source-schema.sql) | Reconstructed schema-only SQLite DDL; a reference, not an executable SQL Server migration |
| [daily-openapi.json](daily-openapi.json) | Exact published OpenAPI, 19 paths |
| [daily-mcp-tools.json](daily-mcp-tools.json) | All 36 original MCP definitions, input/output schemas, scopes and annotations |

Paths inside these six files refer to the pinned original source, not paths in Jarvis. Their original descriptions document Daily behavior; they do not override the owner's narrower Jarvis selection below.

## Owner-approved Jarvis scope

Tracking issue: [#1005](https://github.com/DanAakesen/jarvis/issues/1005). This section records the completed voice review on 18 October 2026 and is authoritative for the full source/API/schema/tool delivery in this PR; it supersedes any suggestion to port all 36 tools or split off a partial delivery.

- **16 capabilities selected** for implementation as Jarvis native tools, with equivalent components reused when verified. The nine remaining operations are currently grouped into three registry tools to retain required catalogue headroom; the requested nine distinct tool names remain an explicit unresolved mismatch.
- **5 source capabilities** will use Jarvis's ordinary search, item retrieval, tasks, calendar and consolidated status; their actual coverage must be checked, not assumed.
- **15 source tools excluded** from this port. Full source documentation is retained even for excluded features.

The selected native tools must use Jarvis's existing registration, services, owner authorization, confirmation handling and normal chat/voice execution. Copying an MCP list, calling original Daily remotely, or adding a parallel MCP runtime is not delivery. Record a source-to-native-tool/service/API/table/verification matrix; a generic query interface alone does not prove selected tool coverage.

Status is one conversational consolidated capability. Recomp, Ready, Review and meal recommendations are not separate ported tools or keyword workflows. The LLM should reason from selected data tools. Do not port mandatory Daily widget layouts, fixed coaching judgments or coach-order persistence as dependencies of Status. Preserve relevant data/trend access. Recovery markers must be usable by conversational assessments without changing measured records.

## Complete source-tool disposition

| Original Daily MCP tool | Owner decision | Target behavior / rationale |
| --- | --- | --- |
| `search` | Reuse existing Jarvis; verify coverage | No separate Daily tool; verify existing search/tasks/calendar/status coverage |
| `fetch` | Reuse existing Jarvis; verify coverage | No separate Daily tool; verify existing search/tasks/calendar/status coverage |
| `get_daily_overview` | Reuse existing Jarvis; verify coverage | No separate Daily tool; verify existing search/tasks/calendar/status coverage |
| `get_attention_items` | Reuse existing Jarvis; verify coverage | No separate Daily tool; verify existing search/tasks/calendar/status coverage |
| `get_calendar_window` | Reuse existing Jarvis; verify coverage | No separate Daily tool; verify existing search/tasks/calendar/status coverage |
| `get_health_summary` | Selected for Jarvis | Read current health, sleep, activity, workout and freshness facts |
| `get_health_history` | Selected for Jarvis | Read historical measurements, sleep and workouts |
| `get_nutrition_history` | Selected for Jarvis | Read canonical meals with timing, names and nutrients |
| `analyze_nutrition` | Selected for Jarvis | Read nutrition totals, averages and trends |
| `get_calorie_balance` | Selected for Jarvis | Read energy intake and expenditure balance |
| `get_coach_status` | Selected for Jarvis | Provide one consolidated status in ordinary conversation |
| `render_coach_status` | Excluded from this port | No legacy Daily renderer |
| `ready` | Excluded from this port | LLM uses selected data tools and ordinary conversation |
| `set_recovery_period` | Selected for Jarvis | Mark or clear requested sick/recovery dates |
| `get_coach_profile` | Selected for Jarvis | Read goals and preferences |
| `update_coach_profile` | Selected for Jarvis | Update goals and preferences on request |
| `get_coach_commitments` | Excluded from this port | No coach commitment/order/experiment tools |
| `save_coach_orders` | Excluded from this port | No coach commitment/order/experiment tools |
| `get_nutrition_activity_trends` | Excluded from this port | Overlaps selected data/trend capabilities |
| `get_recomposition_progress` | Excluded from this port | LLM uses selected data tools and ordinary conversation |
| `review` | Excluded from this port | LLM uses selected data tools and ordinary conversation |
| `commit_weekly_experiment` | Excluded from this port | No coach commitment/order/experiment tools |
| `get_favorites` | Selected for Jarvis | Read favorite meals |
| `save_favorite` | Selected for Jarvis | Save or update a confirmed favorite |
| `get_meal_plans` | Excluded from this port | Meal plans not selected |
| `save_meal_plan` | Excluded from this port | Meal plans not selected |
| `get_meal_coach` | Excluded from this port | LLM uses selected data tools and ordinary conversation |
| `set_meal_preference` | Selected for Jarvis | Persist food likes/dislikes |
| `render_coach_response` | Excluded from this port | No legacy Daily renderer |
| `lookup_food` | Selected for Jarvis | Look up nutrition for food/ingredients |
| `log_food` | Selected for Jarvis | Record a confirmed meal |
| `update_food` | Selected for Jarvis | Correct an identified meal |
| `delete_food` | Selected for Jarvis | Delete an identified meal after explicit confirmation |
| `queue_apple_health_export` | Excluded from this port | No optional meal write-back to Apple Health |
| `cancel_food` | Excluded from this port | No optional meal write-back to Apple Health |
| `retry_uncertain_food` | Excluded from this port | No optional meal write-back to Apple Health |

## API and schema implementation

Implement the corresponding API in Jarvis and create or complete the corresponding tables and columns from this source contract. Inventory all 31 tables and map source fields, keys, relationships, units, dates and persistence semantics to Azure SQL. Record necessary SQLite/D1-to-SQL Server type adaptations. Inspect existing #718/#719/#720 components on current main, preserve real records, and reuse equivalent behavior rather than create competing storage or APIs. Excluded tools do not authorize dropping existing tables or data.

The source Health upload accepts numeric nutrition observations; named meals use a separate canonical meal path. Historical metric/day uploads replace supplied values rather than add samples to earlier uploads. Preserve complete metric/day batches, retries and stable workout identity, and prevent a partial or older batch from losing newer/full-day records.

Apple Health meal write-back and its queue/cancel/retry tools are excluded. This does not cancel inbound Health history upload. Meal plans, coach orders/commitments/weekly experiments, standalone Ready/Recomp/Review and legacy renderers are also excluded from this port. Cancelled database-export/bundle-import work remains cancelled; #1006 owns its cleanup.

## Verification and limits

The source agent cross-checked 45 distinct exported route constants plus literal browser/index routes, all 19 published OpenAPI paths and 36 MCP schemas/runtime branches. The schema-only DDL reconstructs successfully in an isolated in-memory SQLite database with **31 tables and 360 columns**. Both JSON files parse. Git blob hashes of the six transferred files match their original delivered bytes.

Documented source discrepancies remain explicit: coach_experiments is present in migrations but absent from schema.ts; nutrition_meals defaults differ between migration-derived DDL and current schema/API inserts.

The source documentation and tool selection are complete. The corresponding Jarvis implementation, schema/API verification, CI/review, deployment, private owner credential handoff, physical-phone acceptance and historical data replay all remain part of #1005 / PR #1008; none is complete by this source handoff alone. No live health records or credential values were read. Do not execute the reference SQL against production. No new original-Daily work or source-agent restart is needed.
