# Daily v182 delivery status

Checked 19 October 2026 against [#1005](https://github.com/DanAakesen/jarvis/issues/1005), [merged PR #1008](https://github.com/DanAakesen/jarvis/pull/1008), the pinned [Daily v182 reference](README.md), current code, and the linked CI/deployment runs. The P14-35 evidence update is dated 19 October 2026. This is a status report, not a claim of source-wide parity.

| Requirement | Current behavior | Gap or difference | Evidence | Status |
| --- | --- | --- | --- | --- |
| Backend/schema classification | Jarvis migrations provide exact-name target columns for 248 of the 360 pinned source columns. | The test explicitly classifies 91 excluded columns, 21 not mapped columns (10 `owner_email`, 10 `health_raw_objects` lifecycle fields, and `nutrition_queue.claim_token`), and no evidence-backed renames. These counts establish column correspondence only, not data or behavioral parity. The owner question is whether to keep these fields outside the selected scope or verify additional mappings. | [inventory test](../../../apps/backend/src/daily/source-schema.test.ts), [column dispositions](source-to-jarvis-matrix.md#machine-checked-schema-classification), [pinned schema](daily-source-schema.sql), [proposed question](../../decisions.md#schema-field-mapping-scope) | owner question |
| Sleep dates and DST | Jarvis stores the selected sleep date as SQL `date` and retains offset-bearing start/end instants. Existing synthetic tests cover an overnight sleep and DST offset distinction. | The pinned source documents key precedence, but Jarvis has no source-compatible SQL golden cases for conflicting date/end values, the DST gap/fold, and the persisted wake date. | [source sleep rules](daily-source-contract.md#dates-and-timezone), [normalization tests](../../../apps/backend/src/daily/health/normalize.test.ts), [SQL mapping](../../../apps/backend/src/daily/health/persistence.ts) | owner question |
| Coach profile bootstrap | A missing Jarvis profile returns `not-configured`; updates are revision-checked. | The pinned API reference says source returns a code-default profile at revision 0, but the configured default values are not reproduced or checked against Jarvis. | [source profile behavior](daily-api.md#tool-runtime-and-persistence-notes), [SQL test](../../../apps/backend/src/database/daily-schema.integration.test.ts#L71-L98), [field mapping](source-to-jarvis-matrix.md#field-level-mapping-and-verification-evidence) | owner question |
| Preference clear | Jarvis stores a revisioned null preference row; the pinned source clears by deleting the row. | The difference is deliberate and preservation-oriented, but no owner ruling accepts the differing absent/cleared and revision semantics as the selected contract. | [source preference contract](daily-api.md), [Jarvis store](../../../apps/backend/src/daily/nutrition/store.ts), [proposal](../../decisions.md#p14-35--daily-v182-unresolved-delivery-questions-19-october-2026-1095) | owner question |
| Meal duplicate and response behavior | Jarvis uses its canonical named-meal store and existing confirmation boundary; health nutrient totals remain separate. | The pinned source uses `INSERT OR IGNORE` on owner/idempotency key, returns the retained meal with `duplicate: true`, and responds HTTP 200 with a documented body. Jarvis has no source-path alias contract test for that duplicate/error behavior. | [pinned meal contract](daily-source-contract.md#log_food-request), [Jarvis nutrition tests](../../../apps/backend/src/daily/nutrition/store.test.ts), [route matrix](source-to-jarvis-matrix.md#published-openapi-paths) | owner question |
| API compatibility | Health upload and credential routes are implemented; selected source operations use native Jarvis services/tools, not `/api/gpt-actions/*` aliases. | The 19 source paths remain mapped, not aliased. Existing contract tests cover Jarvis-local shapes; they do not establish the source HTTP request/response/error contracts. | [19-path matrix](source-to-jarvis-matrix.md#published-openapi-paths), [route coverage](#health-route-contract-coverage), [source OpenAPI](daily-openapi.json) | owner question |
| Sixteen selected capabilities | Synthetic tests cover the listed Jarvis service/tool operations, including coach status/profile reads added in this update. | Tests establish Jarvis-local shapes, not full source input/output/error parity. Three grouped registry tools package nine operations. `get_favorites` remains an exact-name/alias lookup, not the source query/limit list contract; source HTTP aliases are absent. | [capability coverage](#selected-capability-test-coverage), [registration tests](../../../apps/backend/src/daily/tools/source-tools.test.ts), [proposed rulings](../../decisions.md#selected-tool-packaging), [favorites ruling](../../decisions.md#favorites-query-contract) | owner question |
| Historical per-key replay | The pinned source specifies replacement of supplied metric/date keys; the SQL integration test asserts later partial replacement and older-replay protection. | The assertion has not yet been executed against SQL Server on this PR head, so replay parity remains unverified. | [integration test](../../../apps/backend/src/database/health-processing.integration.test.ts#L189-L207), [pinned replay contract](daily-source-contract.md#3-d1-writes-idempotency-and-historical-replay) | unverified |
| Complete-day replay protection | Jarvis retains per-key replacement semantics and does not infer a complete day from an accepted batch. | The pinned source defines no complete-day marker. Rejecting partial batches would be a Jarvis-specific behavior, not proven source parity. | [pinned replay limits](daily-source-contract.md#3-d1-writes-idempotency-and-historical-replay), [ingestion limits and replay](../../daily-health-ingestion/README.md), [proposal](../../decisions.md#p14-35--daily-v182-unresolved-delivery-questions-19-october-2026-1095) | owner question |
| CI and deployment baseline | PR #1008 CI passed, including Database / SQL Server integration tests. Its post-merge deployment completed the Bicep and backend jobs. | These prior checks do not establish the current P14-35 head, owner credential authentication, a production upload, history completeness, or phone acceptance. | [CI run](https://github.com/DanAakesen/jarvis/actions/runs/39143420153), [deployment run](https://github.com/DanAakesen/jarvis/actions/runs/39144181370) | verified |
| Five reused capabilities | Jarvis reuses ordinary search, retrieval, overview/status, task/calendar attention, and Google calendar tools. | Exact partial differences are listed below; no single reused path matches all five Daily contracts. The owner should confirm these differences or select additional source-specific behavior. | [reuse matrix](source-to-jarvis-matrix.md#reuse-coverage-five-capabilities), [proposal](../../decisions.md#p14-35--daily-v182-unresolved-delivery-questions-19-october-2026-1095) | owner question |
| Owner-only validation and delivery | Deployment, endpoint derivation and credential lifecycle implementation are documented. | Current credential status, protected handoff, a real upload/processing result, historical completeness, and phone acceptance require owner access and real-device evidence. | [owner checklist](#remaining-owner-only-acceptance-steps), [ingestion gates](../../daily-health-ingestion/README.md), [Settings route](../../../apps/web/src/HealthUploadSettings.tsx) | owner step |
| Issue/plan status | #1005 is closed, #1008 merged, and PLAN marks P12-29 complete. | Administrative closure/completion does not supersede the matrix's unresolved acceptance items; this report records them. | [#1005](https://github.com/DanAakesen/jarvis/issues/1005), [PLAN row](../../../PLAN.md) | verified |
| Excluded source capabilities | The 15 owner-approved exclusions remain omitted; existing schema/data are preserved. | No gap: these were intentionally excluded from this port. | [exclusions](source-to-jarvis-matrix.md#excluded-source-tools), [#1005 scope](https://github.com/DanAakesen/jarvis/issues/1005) | verified |

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
| `get_favorites` | `daily_saved_food` / exact-name or alias lookup; source list shape is not implemented |
| `save_favorite` | `daily_saved_food` / save |
| `set_meal_preference` | `daily_nutrition_history` / `set_meal_preference` |
| `set_recovery_period` | `daily_coach_status` / `set_recovery_period` |

## Health route contract coverage

The request/response contracts below are checked against the [health-ingestion acceptance reference](../../daily-health-ingestion/README.md). Fixtures and payloads are synthetic; a successful `202` proves SQL acceptance only, not completed processing or source history completeness.

| Jarvis route | Documented shape | Test coverage | Remaining limit |
| --- | --- | --- | --- |
| `POST /api/health/ingest` | JSON bytes, `automation-id` and `session-id`; accepted receipt has `storage`, `queue`, `processing`, and `duplicate` fields. | [Backend contract tests](../../../apps/backend/src/daily/health-upload/backend.test.ts) assert receipt and validation/error responses; [SQL integration](../../../apps/backend/src/database/health-upload.integration.test.ts) covers persistence, duplicate and conflict behavior. | SQL processing/replay evidence is separate; source completeness is not established. |
| `POST /api/health/heartbeat` | Bodyless POST is allowed; bounded shortcut provenance and checked feeds are retained. | [Backend contract test](../../../apps/backend/src/daily/health-upload/backend.test.ts) asserts `202`, the exact accepted receipt, no-store, and synthetic provenance bytes. | Heartbeat evidence does not prove measurement ingestion. |
| `GET /api/health/upload-credential` | Owner-authenticated, no-store status response with `state` and `expiresAt`. | [Credential route test](../../../apps/backend/src/daily/health-upload/backend.test.ts) asserts anonymous/foreign denial and the `empty` response shape. | Current production credential status and private handoff are owner-only steps. |
| `POST /api/health/upload-credential` | Owner-authenticated create/rotate/revoke action; one-time token reveal on create/rotate; stable conflict/error shape. | [Credential route test](../../../apps/backend/src/daily/health-upload/backend.test.ts) covers create, rotate, revoke, invalid action, conflict, no-store, and token redaction; [SQL integration](../../../apps/backend/src/database/health-upload.integration.test.ts) covers persistence/revocation. | No fixture contains a real credential; owner-only lifecycle verification remains. |

## Selected capability test coverage

These tests cover the existing Jarvis tool/service request and response shape using synthetic data. Unless a difference is stated, the source tool shape remains unverified; the source HTTP paths are not aliased.

| Daily capability | Existing Jarvis coverage | Difference or remaining limit |
| --- | --- | --- |
| `get_health_summary` | [source tool test](../../../apps/backend/src/daily/tools/source-tools.test.ts), [SQL processing integration](../../../apps/backend/src/database/health-processing.integration.test.ts) | Jarvis returns retained facts with unknown completeness and `targets: null`; the source response is not contract-tested through a Jarvis alias. |
| `get_health_history` | [source tool test](../../../apps/backend/src/daily/tools/source-tools.test.ts) | Jarvis uses bounded per-category pages and explicitly reports unknown completeness; no source HTTP response parity is claimed. |
| `get_nutrition_history` | [source tool test](../../../apps/backend/src/daily/tools/source-tools.test.ts) | Jarvis reads canonical named meals, not numeric Health nutrition observations; source-path response parity is unverified. |
| `analyze_nutrition` | [source tool test](../../../apps/backend/src/daily/tools/source-tools.test.ts) | Jarvis returns bounded known/partial nutrient totals and excludes recovery dates; this is not a source-output contract test. |
| `get_calorie_balance` | [source tool test](../../../apps/backend/src/daily/tools/source-tools.test.ts) | Jarvis leaves unknown energy components null and does not infer expenditure; source HTTP response parity is unverified. |
| `lookup_food` | [lookup tests](../../../apps/backend/src/daily/tools/food-lookup.test.ts), [MCP route tests](../../../apps/backend/src/daily/mcp/routes.test.ts) | Jarvis uses its injected lookup service and reports its own bounded result; source request/response parity is unverified. |
| `log_food` | [food tool tests](../../../apps/backend/src/daily/tools/food.test.ts), [MCP route tests](../../../apps/backend/src/daily/mcp/routes.test.ts) | The source uses `INSERT OR IGNORE`, returns the retained meal with `duplicate: true`, and documents HTTP 200; Jarvis uses its confirmed native writer and has no source-path duplicate/error contract. See the proposed meal/API ruling. |
| `update_food` | [food review tests](../../../apps/backend/src/daily/tools/food-review.test.ts) | Jarvis uses its review/confirmation contract; there is no source HTTP alias or source error-shape assertion. |
| `delete_food` | [food review tests](../../../apps/backend/src/daily/tools/food-review.test.ts), [MCP route tests](../../../apps/backend/src/daily/mcp/routes.test.ts) | Jarvis uses its review/confirmation contract; there is no source HTTP alias or source error-shape assertion. |
| `get_coach_status` | [source tool test](../../../apps/backend/src/daily/tools/source-tools.test.ts) | Jarvis returns a conversational data snapshot; the owner-approved scope excludes the source fixed renderer/scoreboard. |
| `get_coach_profile` | [source tool test](../../../apps/backend/src/daily/tools/source-tools.test.ts), [SQL schema integration](../../../apps/backend/src/database/daily-schema.integration.test.ts) | A missing Jarvis profile is `not-configured`; the source documents a revision-0 code default whose values are not present in the pinned references. |
| `update_coach_profile` | [source tool test](../../../apps/backend/src/daily/tools/source-tools.test.ts), [SQL schema integration](../../../apps/backend/src/database/daily-schema.integration.test.ts) | Jarvis updates require revision checks and its existing confirmation flow; the source request/response contract is not aliased. |
| `get_favorites` | [saved-food lookup test](../../../apps/backend/src/daily/tools/saved-food.test.ts) | The source accepts `query`/`limit` and returns a favorites list; Jarvis's native read is exact-name/alias lookup, not that list contract. This difference needs an owner ruling. |
| `save_favorite` | [saved-food tests](../../../apps/backend/src/daily/tools/saved-food.test.ts) | Jarvis saves a confirmed native definition or owned intake snapshot; source output/error parity is unverified. |
| `set_meal_preference` | [source tool test](../../../apps/backend/src/daily/tools/source-tools.test.ts), [saved-food tests](../../../apps/backend/src/daily/tools/saved-food.test.ts) | Source clear deletes its row; Jarvis retains a revisioned null row. This preservation-oriented difference remains an owner question. |
| `set_recovery_period` | [source tool test](../../../apps/backend/src/daily/tools/source-tools.test.ts), [SQL schema integration](../../../apps/backend/src/database/daily-schema.integration.test.ts) | Jarvis writes owner-approved recovery markers without modifying measurements; full source-path response parity is unverified. |

Five reused capabilities are partial. Exact differences:

- `search`: existing conversation, memory, vault and repository searches do not search Daily health and named meals together with tasks/calendar as one source-Daily search.
- `fetch`: Daily `daily_query`/`daily_show` and Factory task/status reads are separate; there is no cross-domain source `fetch` resolver.
- `get_daily_overview`: Jarvis supplies conversational health/nutrition/profile/recovery facts, not the source scoreboard or fixed renderer.
- `get_attention_items`: Jarvis task and calendar tools return their own records; source attention snapshots, source-status aggregation and fixed attention rules are not ported.
- `get_calendar_window`: ordinary Google Calendar event-list/agenda tools are reused, without a source-specific wrapper/response contract.

See [reuse evidence](source-to-jarvis-matrix.md#reuse-coverage-five-capabilities) and the [proposed owner ruling](../../decisions.md#p14-35--daily-v182-unresolved-delivery-questions-19-october-2026-1095).

The 15 intentionally excluded source tools are `get_recomposition_progress`, `ready`, `review`, `get_meal_coach`, `get_coach_commitments`, `save_coach_orders`, `commit_weekly_experiment`, `queue_apple_health_export`, `cancel_food`, `retry_uncertain_food`, `render_coach_status`, `render_coach_response`, `get_nutrition_activity_trends`, `get_meal_plans`, and `save_meal_plan`.

## Endpoint and credential status

- **Endpoint/deployment:** The service implements `POST /api/health/ingest` and `POST /api/health/heartbeat`. `infra/main.bicep` sets `JARVIS_HEALTH_UPLOAD_ENABLED` to `true`; the post-merge [deployment run](https://github.com/DanAakesen/jarvis/actions/runs/39144181370) succeeded, including Bicep and backend jobs. Deployment is verified. No upload-specific production request was made in this check, so live authentication and processing remain unverified.
- **Exact URL:** The owner can see/copy the configured HTTPS upload URL in the signed-in app at **Settings → Health upload**. The [UI](../../../apps/web/src/HealthUploadSettings.tsx) derives it from configured `backendUrl` plus `/api/health/ingest`; no guessed or private URL is reproduced here.
- **Credential:** Current existence and active/revoked/expired state are **unresolved**: this context has no owner-authorized read of the credential-status metadata. [PR #1008's final status comment](https://github.com/DanAakesen/jarvis/pull/1008#issuecomment-6251393442) said no credential had been created at that time, but does not establish today's state. The owner can check the current status in the same Settings panel, which reads `GET /api/health/upload-credential`.
- **Handoff and use:** No accessible evidence establishes private handoff or successful use of an owner token. The [PR's final report](https://github.com/DanAakesen/jarvis/pull/1008#issuecomment-6251393442) explicitly made no handoff claim; the later deployment and general backend smoke do not establish an upload. No phone acceptance or historical replay is verified.

No bearer value, credential hash, real endpoint URL, or private health data is included in this report.

## Remaining owner-only acceptance steps

- [ ] Check whether an upload credential exists and whether it is active, revoked or expired in the signed-in Settings panel.
- [ ] If required, hand the credential to the phone app through the owner's private channel; never record or paste it here.
- [ ] Make one real Health Auto Export upload and confirm the upload-specific processing result, not merely HTTP acceptance.
- [ ] Compare historical dates, metric coverage and workout IDs against the source device to establish whether the intended history is complete.
- [ ] Complete physical-phone acceptance, including the actual retry/outage behavior needed for the owner's workflow.

These owner-only live steps are not verified by code tests or deployment smoke
checks. No credential, bearer value, private endpoint URL, or personal health
value belongs in this checklist.
