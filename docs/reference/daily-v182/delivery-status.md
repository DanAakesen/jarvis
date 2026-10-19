# Daily v182 delivery status

Checked 19 October 2026 against [#1005](https://github.com/DanAakesen/jarvis/issues/1005), [merged PR #1008](https://github.com/DanAakesen/jarvis/pull/1008), the pinned [Daily v182 reference](README.md), current code, and the linked CI/deployment runs. This is a status report, not a claim of source-wide parity.

| Requirement | Current behavior | Gap or difference | Evidence | Status |
| --- | --- | --- | --- | --- |
| Backend/schema compatibility | Jarvis reuses owner-scoped SQL tables and maps selected health, meal, profile, preference and recovery records. | Field-level verification covers selected records, not all 31 source tables/360 columns. | [mapping](source-to-jarvis-matrix.md#field-level-mapping-and-verification-evidence), [source schema](daily-schema.md) | unresolved |
| Sleep dates and DST | Sleep date is stored as SQL `date`; sleep start/end retain offsets. | Source wake-date and daylight-saving boundary equivalence lacks source-compatible SQL evidence. | [mapping](source-to-jarvis-matrix.md#field-level-mapping-and-verification-evidence), [`healthDefinitions`](../../../apps/backend/src/daily/health/persistence.ts) | unresolved |
| Coach profile bootstrap | Profile read/update uses `daily.coach_profiles`; updates are revision-checked. | Missing profiles remain unconfigured; source bootstrap/default behavior is not reproduced or verified. | [mapping](source-to-jarvis-matrix.md#field-level-mapping-and-verification-evidence), [source tools](../../../apps/backend/src/daily/tools/source-tools.ts) | unresolved |
| Preference clear | Setting `null` leaves a revisioned null row in Jarvis. | Pinned source clears by deleting the row; this is an intentional preservation-oriented semantic difference, not equivalence. | [mapping](source-to-jarvis-matrix.md#field-level-mapping-and-verification-evidence), [`NutritionStore.feedback`](../../../apps/backend/src/daily/nutrition/store.ts) | unresolved |
| Meal behavior | Health nutrient observations remain distinct from canonical named meals; meal history uses `daily.nutrition_meals`. | Source-specific duplicate handling and HTTP response behavior remain unverified. Nutrient totals are not named meal history. | [mapping](source-to-jarvis-matrix.md#field-level-mapping-and-verification-evidence), [API/source contract](daily-source-contract.md) | unresolved |
| API compatibility | Jarvis has `POST /api/health/ingest`, `POST /api/health/heartbeat`, and owner-authenticated `GET`/`POST /api/health/upload-credential`; selected reads/writes use existing Jarvis services and tools. | The 19 original `/api/gpt-actions/*` paths are mapped to Jarvis services, not replicated as aliases. Original request/response/error shapes are only partially mapped and not fully verified. | [route matrix](source-to-jarvis-matrix.md#published-openapi-paths), [upload routes](../../../apps/backend/src/daily/health-upload/capability-routes.ts) | unresolved |
| Sixteen selected capabilities | Each capability maps to a Jarvis tool/operation in the table below; grouped operations use the existing owner and confirmation flow. | Three registry tools package nine operations. Grouping alone does not demonstrate missing behavior; the distinct-name difference is a packaging mismatch, while source-parity acceptance remains unresolved. | [tool map](source-to-jarvis-matrix.md#selected-native-tools), [registration](../../../apps/backend/src/daily/tools/source-tools.ts), [owner scope](https://github.com/DanAakesen/jarvis/pull/1008) | verified mapping; unresolved parity |
| Historical ingestion | SQL integration covers a synthetic upload through processing, read model and summary, including rejection of an older partial replay replacing a newer value. | A later partial batch can still replace values for the same metric/date key; the source has no verified complete-day marker. | [`health-processing.integration.test.ts`](../../../apps/backend/src/database/health-processing.integration.test.ts), [ingestion limits and replay](../../daily-health-ingestion/README.md) | unresolved |
| Validation and delivery | PR #1008 CI passed, including Database / SQL Server integration tests. A post-merge deployment run completed successfully with Bicep and backend jobs. | CI synthetic evidence and general deploy/readiness checks are not owner credential authentication, upload-specific production processing, history completeness, or phone acceptance. | [CI run](https://github.com/DanAakesen/jarvis/actions/runs/39143420153), [deployment run](https://github.com/DanAakesen/jarvis/actions/runs/39144181370), [acceptance test](../../../apps/backend/src/database/health-processing.integration.test.ts) | verified CI/deployment; unresolved live acceptance |
| Issue/plan status | #1005 is closed, #1008 merged, and PLAN marks P12-29 complete. | Administrative closure/completion does not supersede the matrix's unresolved acceptance items; this report records them. | [#1005](https://github.com/DanAakesen/jarvis/issues/1005), [PLAN row](../../../PLAN.md) | verified |
| Excluded source capabilities | The 15 owner-approved exclusions remain omitted; existing schema/data are preserved. | No gap: these were intentionally excluded from this port. | [exclusions](source-to-jarvis-matrix.md#excluded-source-tools), [#1005 scope](https://github.com/DanAakesen/jarvis/issues/1005) | intentionally excluded |

## Selected capability map

| Daily v182 capability | Current Jarvis tool/operation |
| --- | --- |
| `get_health_summary` | `daily_health_summary` / `get_health_summary` |
| `get_health_history` | `daily_health_summary` / `get_health_history` |
| `get_nutrition_history` | `daily_nutrition_history` / `get_nutrition_history` |
| `analyze_nutrition` | `daily_nutrition_history` / `analyze_nutrition` |
| `get_calorie_balance` | `daily_nutrition_history` / `get_calorie_balance` |
| `lookup_food` | `daily_food_lookup` |
| `log_food` | `daily_food` / log |
| `update_food` | `daily_food` / correct |
| `delete_food` | `daily_food` / delete |
| `get_coach_status` | `daily_coach_status` / `get_coach_status` |
| `get_coach_profile` | `daily_coach_status` / `get_coach_profile` |
| `update_coach_profile` | `daily_coach_status` / `update_coach_profile` |
| `get_favorites` | `daily_saved_food` / read |
| `save_favorite` | `daily_saved_food` / save |
| `set_meal_preference` | `daily_nutrition_history` / `set_meal_preference` |
| `set_recovery_period` | `daily_coach_status` / `set_recovery_period` |

Five reused capabilities are partial: `search` has no universal Daily search; `fetch` has no cross-domain fetch; `get_daily_overview` supplies conversational facts but not the source scoreboard/renderer; `get_attention_items` reuses Jarvis task/calendar data but not the source snapshot/rule engine; `get_calendar_window` reuses ordinary Google Calendar reads without the source wrapper. See the [reuse evidence](source-to-jarvis-matrix.md#reuse-coverage-five-capabilities).

The 15 intentionally excluded source tools are `get_recomposition_progress`, `ready`, `review`, `get_meal_coach`, `get_coach_commitments`, `save_coach_orders`, `commit_weekly_experiment`, `queue_apple_health_export`, `cancel_food`, `retry_uncertain_food`, `render_coach_status`, `render_coach_response`, `get_nutrition_activity_trends`, `get_meal_plans`, and `save_meal_plan`.

## Endpoint and credential status

- **Endpoint/deployment:** The service implements `POST /api/health/ingest` and `POST /api/health/heartbeat`. `infra/main.bicep` sets `JARVIS_HEALTH_UPLOAD_ENABLED` to `true`; the post-merge [deployment run](https://github.com/DanAakesen/jarvis/actions/runs/39144181370) succeeded, including Bicep and backend jobs. Deployment is verified. No upload-specific production request was made in this check, so live authentication and processing remain unverified.
- **Exact URL:** The owner can see/copy the configured HTTPS upload URL in the signed-in app at **Settings → Health upload**. The [UI](../../../apps/web/src/HealthUploadSettings.tsx) derives it from configured `backendUrl` plus `/api/health/ingest`; no guessed or private URL is reproduced here.
- **Credential:** Current existence and active/revoked/expired state are **unresolved**: this context has no owner-authorized read of the credential-status metadata. [PR #1008's final status comment](https://github.com/DanAakesen/jarvis/pull/1008#issuecomment-6251393442) said no credential had been created at that time, but does not establish today's state. The owner can check the current status in the same Settings panel, which reads `GET /api/health/upload-credential`.
- **Handoff and use:** No accessible evidence establishes private handoff or successful use of an owner token. The [PR's final report](https://github.com/DanAakesen/jarvis/pull/1008#issuecomment-6251393442) explicitly made no handoff claim; the later deployment and general backend smoke do not establish an upload. No phone acceptance or historical replay is verified.

No bearer value, credential hash, real endpoint URL, or private health data is included in this report.
