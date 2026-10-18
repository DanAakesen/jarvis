# Original Daily backend source documentation

Evidence date: 18 October 2026. Source: original Daily Sites project, version **182**, source commit **`9e193554c9c8c7c23a788ed3d2b0582580b76c0f`**. This contract was derived from a read-only cloud working copy of that version. File and function references below always refer to that original source in the pinned source. No live personal records, deployed configuration values, bearer values or phone settings were inspected. The original Site was not edited or deployed.

## Scope and documents

This is documentation of the **entire original Daily backend**, prepared in the original Daily cloud source working copy. It does not define or implement a replacement system, change the Site, or run data transfer. The health, workout and nutrition flows are detailed here; companion documents cover every HTTP route, all 36 MCP tools, all 31 source tables, full published schemas and persistence semantics.

- `daily-source-contract.md`: this source evidence guide and detailed health/workout/nutrition data flow.
- `daily-api.md`: complete route catalogue, all other backend APIs, authentication, MCP transport/tool inventory and state behavior.
- `daily-openapi.json`: exact exported original GPT Action OpenAPI object (19 paths), evaluated without invoking handlers or network.
- `daily-mcp-tools.json`: exact original 36 MCP tool definitions with input/output schemas and scopes, with no private records.
- `daily-schema.md`: all31 migration-derived source tables, every column/type/default/nullability/key/index/FK and source-definition discrepancies.
- `daily-source-schema.sql`: reconstructed schema-only SQLite DDL from original migrations, no INSERT/UPDATE/DELETE or seed values.

Important source observations:

1. The phone health endpoint is `POST /api/health/ingest`; a separate Shortcut calls `POST /api/health/heartbeat`. Source calls the exporter **Health Auto Export**; the installed app/settings were not inspected.
2. Original code accepts sanitized Health nutrient measurements into `health_daily_metrics`, but does not create canonical `nutrition_meals` from them.
3. Named meal logs are saved directly to Sites via `log_food`/GPT Action. Their Health write-back is optional and on demand. Source code cannot establish that phone replay contains every meal, meal name, ingredient or revision.

## Source map

| Source file | Functions / evidence |
| --- | --- |
| `worker/index.js` | Routes phone health and nutrition callbacks before ordinary Sites browser authentication; dispatches GPT Actions; scheduled cleanup callback |
| `worker/health-api.js` | Route constants, `authorizeHealthBearer`, `handleHealthIngest`, `handleHealthHeartbeat`, `cleanupExpiredHealthRaw`, `handleHealthCleanup` |
| `worker/health-normalize.js` | `validateHealthPayloadShape`, `sanitizeHealthPayload`, `sanitizedNutritionGroups`, `normalizeHealthPayload`, `normalizeDailyMetrics`, `normalizeSleep`, `normalizeWorkout` |
| `worker/health-store.js` | `D1HealthStore`, `completeIngestion`, raw/receipt state, `getHealthDashboard`, `getCalorieBalance` |
| `db/schema.ts` | Exact source table/column/type/default/index/relationship definitions reproduced below |
| `worker/nutrition-api.js` | Phone `claim`/`complete`, signed-in dashboard history |
| `worker/nutrition-store.js` | `saveMeal`, queue/claim/completion lifecycle, permanent meals, corrections/tombstones |
| `worker/mcp-data.js` | `executeMcpTool` branches `log_food`, `update_food`, `delete_food`, `queue_apple_health_export`; nutrition component/numeric validation |
| `worker/gpt-action.js` | GPT Action route constants/OpenAPI, bearer auth, owner resolution, JSON/body handling and HTTP handlers |
| `worker/mcp-server.js`, `worker/mcp-auth.js` | `/api/mcp` JSON-RPC tools, OAuth read/write scopes |
| `docs/nutrition-shortcut.md`, root `AGENTS.md` | Source-of-truth decision and optional on-demand `Get Meals` Shortcut |

## 1. Original phone HTTP API

All JSON responses from the health and nutrition handlers have `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`. Path dispatch does not enforce method until each handler. Wrong method returns `405`, `Allow: POST`, and `{ "error": "Method not allowed" }` for these POST endpoints.

### Shared health bearer authentication

`worker/health-api.js:authorizeHealthBearer` reads the server configuration **name** `HEALTH_INGEST_BEARER_TOKEN`. If its configured string is shorter than 32 characters, response is `503 {error:"Health ingestion is not configured"}`. Request header is `Authorization: Bearer <configured-secret>`, parsed case-insensitively with `/^Bearer\s+(.+)$/i`; SHA-256 digests are compared. Missing/incorrect bearer returns `401 {error:"Invalid health ingestion credentials"}` and `WWW-Authenticate: Bearer`.

This original token is a shared secret. Its value is not included. This documents the original boundary rather than recommending token reuse by another application.

### POST `/api/health/ingest`

Source: `worker/health-api.js:handleHealthIngest` (lines 166–355).

| Request item | Original behavior |
| --- | --- |
| Authorization | Shared bearer as above |
| Content-Type | Required `application/json`, case-insensitive; optional `;...` parameters accepted |
| `automation-id` | Required string; trimmed; nonempty and at most 200 characters |
| `session-id` | Same validation; identity is the pair `(automation-id, session-id)` |
| `checksum` or `x-payload-checksum` | Optional. `checksum` takes precedence using `a || b`. Trimmed; optional case-insensitive `sha256=`/`sha-256=` or colon prefix removed; hex lowercased. Must equal SHA-256 of original request bytes |
| `automation-aggregation`, `automation-period` | Optional, trimmed identifiers at most 200 characters; invalid/missing stored as null |
| `user-agent` | Optional; first 200 characters retained as request metadata |
| Body limit | 8,388,608 bytes (8 MiB), both declared Content-Length and streaming actual-byte check |
| Body envelope | Object with object `data`, containing array `metrics`, array `workouts`, or both. Empty arrays valid. Root-only `{metrics:[...]}` is not accepted by original shape validation |
| Extra fields | Envelope/point/workout keys are not generally rejected by a closed schema; sanitization and per-item normalization determine what persists |

Minimal valid synthetic envelopes are `{ "data": { "metrics": [] } }`, `{ "data": { "workouts": [] } }`, or both arrays together. No real historical sample is included here.

The source does not impose a historical date-range limit at the upload boundary. Multi-year replay still requires request batching to fit its byte ceiling and runtime; the actual iPhone export selection, chunking and retry behavior are unknown.

#### Validation and status responses

| Status | Body / triggering condition |
| --- | --- |
| 400 | `automation-id and session-id headers are required` |
| 400 | `The JSON body is empty` |
| 400 | `checksum must be a SHA-256 hex digest` |
| 400 | `checksum does not match the request body` |
| 400 | `The request body is not valid JSON` |
| 413 | `{error:"Health payload is too large", maxBytes:8388608}` |
| 415 | `Content-Type must be application/json` |
| 422 | Shape errors: `The JSON body must be an object`; `The JSON body must contain a data object`; `data.metrics must be an array`; `data.workouts must be an array`; `The data object must contain metrics or workouts` |
| 409 | Same automation/session with a different original byte checksum: `{error:"session-id was already used with a different payload",duplicate:false}` |
| 409 | Concurrent first insert lost: `{accepted:false,duplicate:true,retry:true}` |
| 503 | Missing D1/store: `Health storage is not configured`; missing R2: `Health raw storage is not configured`; authentication configuration as above |
| 500 | Caught raw storage/normalization/processing failure: `{error:"Health ingestion failed",ingestionId}`; durable status attempts record fixed failure phase plus bounded message |

Bodies marked as errors above are `{error: <quoted string>}` unless another shape is shown. Some body-reading/store lookup/begin/restart failures occur before the handler's inner catches; do not promise every unexpected exception has this sanitized JSON shape. The source has no explicit route-level 429/rate-limit policy or content-encoding handling in this handler. No additional safeguards are inferred from this handler.

#### Success and retry responses

- Already succeeded, identical session+checksum: HTTP **200** `{accepted:true,duplicate:true,ingestionId,checksum,counts}`. Counts decoded from stored `normalized_counts_json`.
- Same upload still `processing`, less than 15 minutes old: **202** `{accepted:true,duplicate:true,processing:true,ingestionId,checksum}`.
- Same-checksum failed or processing at least 15 minutes old: reuse ingestion ID, restart receipt, clear failure/counts, process again.
- New ordinary accepted upload: **202** `{accepted:true,duplicate:false,processing:true,ingestionId,checksum,sanitizedChecksum,rawExpiresAt,counts}`. With a runtime `context.waitUntil`, domain completion continues in the background. Without it, code awaits completion but still returns the same 202/processing:true form. Acceptance must not be interpreted as proof of finalized domain writes.
- Special input with **only** `data.workouts:[]` and no metrics property: await completion; success **200** with `{accepted:true,duplicate:false,ingestionId,checksum,sanitizedChecksum,rawExpiresAt,counts}` (no processing field). It does not delete older workouts. Sanitization subsequently inserts an empty metrics array, so completion's feedKinds may include both metrics and workouts; the empty-only response decision is made on the original envelope.

Counts have `metrics`, `sleepNights`, `workouts`, `workoutMetrics`, `heartRateMinutes`, `skippedMetrics`, `nutritionMetrics`, `skippedNutrition` (always zero here), `skippedWorkouts`. Counts are normalized output counts, not a completeness proof against Apple Health.

### POST `/api/health/heartbeat`

Source: `handleHealthHeartbeat` (lines 148–164). Same bearer; D1/store required. No body or Content-Type required; body not read. Optional `shortcut-name` uses the same trimmed max-200 identifier helper, defaults to `Daily Overview heartbeat`. Writes singleton phone sync row ID 1 with server `receivedAt`, shortcut name and `checkedFeeds:["metrics","workouts"]`; **202** `{accepted:true,receivedAt,checkedFeeds}`. Caught failure returns **503** `{error:"Health phone heartbeat failed"}`. It does not upload measurements or advance processed health feeds. It does not need automation/session headers.

### POST `/api/health/cleanup`

Same bearer and POST restriction. Calls cleanup below; success **200** `{deleted:<count>,completedAt:<ISO>}`; caught failure **503** `{error:"Health raw cleanup failed"}`. This is maintenance, not required to replay an upload. Do not accidentally give the new phone ingestion credential broader maintenance authority merely because the old shared token had it.

### Summary/read APIs

`/api/health/summary` is dispatched after ordinary Sites identity checks and returns `getHealthDashboard` with authenticated owner context. Source handler itself takes env/options rather than enforcing HTTP method; index routing owns browser access. Authenticated GPT Action `/api/gpt-actions/health/summary` and `/api/gpt-actions/health/history` reuse the same data layer. `get_health_history` MCP is bounded to 93 days/100 rows per call, not a database export API. These read limits are not phone upload range limits.

## 2. Payload variants and exact normalization

### Daily metrics

Source: `health-normalize.js:normalizeMetricName`, `pointDate`, `metricStrategy`, `normalizeDailyMetrics`.

- Each metric group uses `name` and array `data`; missing/invalid groups increment `skippedMetrics` and are skipped. Name trims, inserts underscores at camelCase boundaries, replaces non-alphanumeric spans with underscore and lowercases. A point must be an object with a date prefix in the first available `date`, `endDate`, `sleepEnd`, `startDate`; otherwise skipped.
- Values: `qty`; averages fall back through `Avg`, `avg`, `average`, `qty`; minima through `Min`, `min`, `minimum`, `qty`; maxima similarly. Unit selection is group `units`, group `unit`, first point with `units`. Samples are grouped by the original date prefix, not converted to a Copenhagen day first.
- Sum strategy: nutrition, step_count, flights_climbed, active/basal/resting/total energy, walking/running/cycling/swimming/wheelchair distances, distance, exercise/stand/move time, strokes, push count. Latest strategy: weight/body_mass/body_weight, height/BMI, body_fat_percentage, lean_body_mass, waist circumference, temperature, blood glucose. Others average. Exact regular expressions are in source `SUM_METRICS`/`LATEST_METRICS`.
- Latest means last numeric `qty` in the supplied array, **not timestamp-sorted latest**. Daily `value`, min/avg/max and sample_count are stored. Numeric rounding is six decimal places. Extra numeric fields get min/avg/max/latest; extra categorical values get up to 12 unique values. Sources and latest point are retained in fields JSON.
- Daily rows are not a complete sample archive: most raw per-sample details expire with the sanitized R2 object. The original code does not generally convert physical units for health/workout stored rows; it stores source values and unit labels. Some energy conversion happens at read time.
- Original helper `finiteNumber` uses JavaScript `Number(value)` for non-numbers; null/blank/boolean may therefore coerce numerically. These are observed permissive semantics, not recommended new validation rules. These permissive source semantics must not be mistaken for strict validation.

### Dates and timezone

`normalizeHealthDate` retains `YYYY-MM-DD`; recognizes HAE `YYYY-MM-DD HH:mm:ss +HHMM` (also `T`, optional fraction) and rewrites to `YYYY-MM-DDTHH:mm:ss+HH:MM` (fraction removed in that branch); otherwise uses JavaScript Date and UTC ISO. Invalid values return null. Its date-only and prefix helpers are permissive; they do not independently reject all impossible calendar dates. Daily metric/workout date keys use string date prefix. HR minute buckets use UTC. Dashboard today, nutrition meal dates and analytics use **Europe/Copenhagen**; those are different boundaries. Do not silently replace source date-prefix grouping with a UTC or other day boundary. Compare midnight/DST examples before rollout.

### Sleep variants

`normalizeSleep` handles `sleep_analysis` groups:

| Variant | Fields and behavior |
| --- | --- |
| Aggregated night | `totalSleep`, `asleep`, `core`, `deep`, `rem`, `awake`, `inBed`; `date` then sleep/in-bed/end date for night key; explicit totals retained and phases use max across aggregated points |
| Segment | Numeric `qty` plus `value` and a start/end timestamp; states `core`, `deep`, `rem`, `asleep`, `unspecified` add to asleep/total; `awake` to awake; `in bed` to in-bed |
| Bounds/source | `sleepStart`, `inBedStart`, `startDate`; `sleepEnd`, `inBedEnd`, `endDate`; `source`/`sourceName`; retains segment count/source set |

Night fallback date for segments prefers sleepEnd/inBedEnd/date/endDate. Phase defaults start at zero, so original output does not always distinguish missing phase from zero. The source normalization treats sleep numbers as **hours**, without a group-unit conversion step. Preserve/report this assumption; do not silently treat a seconds/minutes export as hours. Health metric sleep rows can coexist with the dedicated nightly summary.

### Workout variants

Source `normalizeWorkout`:

| Concept | Accepted source fields / rules |
| --- | --- |
| Stable identity | First nonempty `id`, `uuid`; exact source string retained |
| Type | `name`, `workoutType`, `activityType` |
| Activity identifier | `activityIdentifier`, `activityTypeIdentifier`, `workoutActivityType`, `identifier` |
| Start/end | `start` or `startDate`; `end` or `endDate` via normalizeHealthDate |
| Duration | `duration` or `durationSeconds`, numeric; if absent derive seconds from start/end; if end absent derive from start+duration |
| Required usable row | ID, type, start, end, duration; otherwise skipped and counted |
| Source | `source`, `sourceName`, `device`; same within metadata; then first sample source/sourceName/device in any nested array |
| Indoor | Only an actual boolean is retained; other types become null |
| Active energy | Quantity object from `activeEnergyBurned`, `activeEnergy`, `activeCalories`, `workoutCalories` |
| Total energy | `totalEnergy`, `totalEnergyBurned` |
| Distance | Quantity object in `distance` |
| Quantity objects | `{qty:<numeric>,units:<string>}` or `{value:<numeric>,unit:<string>}`; qty then value, units then unit |
| Summary heart rate | Average `avgHeartRate.qty`, `heartRate.avg.qty`, `heartRate.Avg`, numeric `heartRate.avg`; equivalent max fallbacks |
| Numeric array series | Each non-base array summarized using qty/Avg/avg/value and min/max fallbacks into workout metric rows; nonnumeric arrays retained in detail |
| Quantity-valued properties | Additional quantity objects become a single-sample workout metric; retained in detail too |
| Detailed heart-rate series | `heartRateData`/equivalent normalized `heart_rate_data` and `heartRateRecovery`/`heart_rate_recovery` additionally produce UTC-minute buckets with min/mean/max, sources and sample_count |
| Detail | Original type/identifier fields stored under originalIdentity; other non-base nonprivate fields retained; seriesSummary stores numeric summaries |

Separate workouts on the same day remain separate by ID. The source does not explicitly reject duplicate/conflicting same-export workout IDs before persistence; batch/upsert order controls the result. Original missing fields are skipped rather than a universal 422. No stricter validation is inferred from the source.

### Nutrition samples and sanitization

`isNutritionMetric` recognizes `dietary`, `nutrition`, their prefixes, vitamins and the explicit nutrient set (energy_consumed/dietary_energy_consumed, water, caffeine, protein, carbohydrates, fiber, sugar, fats/cholesterol, minerals and B vitamins). `canonicalNutritionMetricName` removes `nutrition_` then `dietary_`, and maps energy/calories→`dietary_energy`, carbs→`carbohydrates`, fat/fat_total→`total_fat`, fibre→`fiber`.

`sanitizedNutritionGroups` retains at most 100,000 points per nutrition group. Kept point keys are only `qty,date,startDate,endDate,source,sourceName,Min,Avg,Max,min,avg,max`, with string or numeric values; no meal name/components are mapped. Group unit string is capped at 40 characters. Dietary energy in kJ divides by 4.184 and J divides by 4184, sets unit kcal; other unit labels are retained and are not a general conversion guarantee. Normalization then sums these nutrient groups by date into `health_daily_metrics`, counts `nutritionMetrics`, and sets `skippedNutrition:0`.

Deep sanitization strips spatial coordinates/GPS/routes and keys containing dietary/nutrition; it removes nutrition-classified nested objects. It then explicitly re-adds the whitelisted nutrition measurement groups. This preserves numeric nutrient observations without importing canonical meals or arbitrary nutritional objects from workout details. Raw R2 evidence is **sanitized**, not byte-exact original request storage. Original byte checksum and sanitized byte checksum are separate.

## 3. D1 writes, idempotency and historical replay

Source: `D1HealthStore` in `worker/health-store.js`.

1. `health_ingestions` uniqueness `(automation_id,session_id)` prevents duplicate receipt identities. New ID generated server-side; failed/stale same-checksum session reuses it. Same body under a **new** session is another receipt, not a byte-hash-global duplicate.
2. Normalized daily metric conflict `(metric_name,metric_date)` overwrites every derived field; sleep conflicts on `sleep_date`; workouts conflict on workout `id`. This is replacement for each supplied key, **not additive accumulation against previous uploads**.
3. Included workouts have previous metric and minute-heart-rate child rows deleted before inserting the supplied replacement children. Workouts omitted from the upload, including an empty workout export, are retained. No whole-range deletion is inferred from a date range or empty array.
4. `runBatches` executes groups of at most 50 prepared statements. Domain base rows, child deletion/insertion, and final ingestion/sync state are separate batches. The whole original ingestion is **not one transaction across those batches**; a failure can leave partial domain writes before failed receipt status. This is an observed implementation limitation, not an atomicity guarantee.
5. Successful completion updates receipt to succeeded, singleton health_sync_state ID1 and the supplied feed kinds; counts and server receipt time are recorded. `completed_at` is set to ingestion `receivedAt`, not measured background completion time. Failure writes `failed`, phase code (`ingestion_failed`, `normalization_failed`, `processing_failed`) and bounded message (500 characters in store).
6. No source per-key timestamp check prevents an older historical/partial upload arriving later from overwriting an existing day's value. Because totals are replacement snapshots, historical batches should include a complete metric/day's samples; splitting one day over separate uploads can leave only the last partial sum. Overlapping historical replays are not inherently additive or sample-level deduplicated.
7. Success responses/counts do not prove the phone exported all desired dates, metrics or workouts. Verify accepted vs processed status separately and compare date coverage, distinct IDs and totals. No live completeness checks were run for this documentation.

### Raw storage and retention

`handleHealthIngest` calculates original SHA-256 before JSON parsing, sanitizes, calculates sanitized SHA-256, records pending raw metadata, writes sanitized JSON to `HEALTH_RAW` R2 key `health/raw/<ingestionId>-<12 chars original checksum>.json`, then marks stored. R2 metadata names: automationId, sessionId, sourceChecksum, sanitizedChecksum, expiresAt. Raw content length refers to sanitized bytes; ingestion receipt content_bytes refers to original upload bytes.

Expiry is seven days after receivedAt. Failure attempts R2 deletion and deleted metadata; cleanup failure marks orphaned. `cleanupExpiredHealthRaw` deletes up to ten pages of 100 objects per call. Eligible rows are undeleted and expired, orphaned, or pending at least 15 minutes; marks raw ledger deleted and last_cleanup_at. Scheduled callback in `worker/index.js` calls raw and nutrition cleanup, but deployed schedule cadence/execution is not verified. Normalized health tables have no age-based deletion in this ingestion/cleanup path. R2 raw receipts are not a full original sample archive, and metadata does not prove bytes still exist.

## 4. Canonical meal intake and optional phone write-back

### Existing food entry routes

`POST /api/gpt-actions/nutrition/log` → `handleGptActionLogFood` → `executeMcpTool("log_food",...)` → `D1NutritionStore.saveMeal`. Alternative: OAuth-authenticated `tools/call` for `log_food` at `POST /api/mcp`, scope `daily-overview.food.write`. `daily-overview.read` does not authorize writes. MCP tool names may arrive namespaced and are canonicalized by the server. The health ingest endpoint is **not** the meal logging endpoint.

GPT Action `Authorization: Bearer ...` tries server setting `GPT_ACTION_BEARER_TOKEN` when at least 32 characters, then original health bearer for backward compatibility. Server owner is `GPT_ACTION_OWNER_EMAIL` only if allowlisted, or the sole allowed email; caller cannot choose owner by adding a body email. The private credential values and owner configuration values are excluded from this document.

GPT Action bodies require nonempty valid JSON, max 32 KiB (declared and actual). Empty/invalid JSON 400, oversized 413, wrong method405; bearer 401 or unconfigured503. Tool validation errors return422 `{error:<message>}`; unexpected failure503 `Daily Food is temporarily unavailable`. GET food history uses same auth, not ordinary browser identity. MCP returns structured tool results/errors through JSON-RPC rather than identical HTTP bodies.

### `log_food` request

Runtime implementation is authoritative where published OpenAPI required fields differ.

| Field | Runtime validation / meaning |
| --- | --- |
| `mealName` | Required nonempty normalized text, max200 |
| `components` | Optional, defaults[]; max25 objects; only name/quantity/preparationMethod allowed |
| component `name` | Required text max120 |
| component `quantity` | Optional text max80; if provided cannot be empty |
| component `preparationMethod` | Optional text max120 or null |
| `occurredAt` | Optional; defaults request time, otherwise JavaScript Date parse; valid and at most five minutes in future; stored UTC ISO |
| `mealType` | Optional; breakfast/lunch/dinner/snack/other |
| `caloriesKcal` | Required actual finite number, 0–10,000 |
| `proteinGrams`, `carbohydratesGrams`, `fatGrams`, `fiberGrams` | Optional actual finite numbers 0–1,000; omitted/null→null; rounded2dp |
| `confidence` | Required accurate/approximate/estimate |
| `captureMethod` | Required voice/photo/text/mixed |
| `userConfirmed` | Must be true |
| `idempotencyKey` | Optional in runtime/MCP, max100 normalized nonempty text. If omitted, first48 hex chars of SHA-256 of canonical owner+name+components+occurredAt+mealType+nutrients+confidence+captureMethod. GPT Action OpenAPI declares it required (and also declares components required) |

Only these top-level fields are allowed. Reuse an explicit stable idempotency key for retries; if occurredAt defaults to a new time, generated keys can differ across requests.

`saveMeal` inserts permanent Sites meal with random ID, owner, key, supplied fields, Copenhagen meal_date, source sites, revision1, provenance `{authority:"Daily Overview Sites",confirmedByUser:true}`, apple_health_status not_exported, expires_at `9999-12-31T23:59:59.999Z`. `INSERT OR IGNORE` plus unique owner/key retains an existing meal unchanged; changed content on same key returns old meal rather than replacing or conflict. Duplicate is determined by whether retained ID differs from proposed random ID.

HTTP200 result is `{mealId,idempotencyKey,status:"saved",duplicate,meal:{name,type,components,occurredAt,nutrients,confidence},source:"Daily Overview Sites",retention:"until_deleted",appleHealthExportStatus,nextStep}`. Logging does not automatically queue a phone write.

Corrections `/api/gpt-actions/nutrition/update` / MCP `update_food` require exact key and true confirmation; only supplied supported fields change, revision increments, and already-written Health becomes out_of_sync (otherwise not_exported). Delete route `/api/gpt-actions/nutrition/delete` / `delete_food` soft-deletes with incremented revision; prior Health samples may remain. These are future API compatibility behaviors, not authorization to change existing meals now.

### Phone nutrition export direction

`queue_apple_health_export` / POST `/api/gpt-actions/nutrition/export-apple-health` requires exact valid nonfuture inclusive date range and userConfirmed:true. Eligible nondeleted Sites meals are not_exported/failed/out_of_sync; no maximum period span enforced by this branch. It enqueues snapshots idempotently by owner/key and marks meal pending. Source Sites meal remains canonical. The optional `Get Meals` Shortcut then calls:

| Endpoint | Request / response |
| --- | --- |
| POST `/api/nutrition/claim` | Same health bearer; JSON max16KiB, empty body→{}; optional integer limit1–20 default10. HTTP200 `{accepted:true,claimToken,claimedAt,claimExpiresAt,items,completion:{requiredForEveryItem:true,path:"/api/nutrition/complete",allowedStatuses:["written","failed"],warning}}` |
| POST `/api/nutrition/complete` | Same bearer; max16KiB; required nonempty string id and claimToken max100, status written/failed. Optional writer default Apple Shortcuts/max100, failure error default Phone write failed/max500. HTTP200 `{accepted:true,id,status,writer,completedAt}`; 409 `{error:"The queue claim is missing, expired, or already completed"}` |

Claim items contain `{id,idempotencyKey,mealName,mealType,components,occurredAt,nutrients:{caloriesKcal,proteinGrams,carbohydratesGrams,fatGrams,fiberGrams},confidence,captureMethod,status,createdAt}`. Source docs direct native `Log Health Sample` actions to write dietary energy and available macros at occurredAt. Documentation is not proof of the actual installed Shortcut's behavior or whether every historical meal was written.

Claim token is a new server UUID, five-minute lease; current callback does not accept caller owner selection. Claimed rows returned only for that token. Expired claimed rows transition to uncertain in queue and canonical meal, with token cleared, when claimPending runs. They are **never automatically returned to pending**. Complete succeeds only for exact id/token, still claimed, unexpired; writes queue and meal status/writer/time/error. Completed queue records receive seven-day expiry. Canonical meals are permanent. Explicit retry of uncertain food requires user confirmation after Health readback proves absent; there is a separate guarded release-claim operation. This avoids claiming exactly-once Health writes after a lost completion callback.

Nutrition callback input/body errors are400, other caught failures503 `Nutrition queue is temporarily unavailable`. Claim validates limit explicitly. Body parser does not enforce Content-Type; invalid JSON rejected. The callback can report written but server does not read HealthKit itself, so this is a phone report, not independently verified Health state.

### Nutrition read-model authority and replay consequence

`worker/health-store.js:getHealthDashboard` with ownerEmail replaces nutrition metrics in display rows with totals from Sites `nutrition_meals`. `getCalorieBalance` always sources intake from Sites meals and expenditure from Health active+resting energy. Thus merely restoring Health nutrient measurements may still leave canonical meal history and displayed intake empty. Replayed nutrient measurements must not be double-counted on top of retained canonical meal totals.

Original code distinguishes **sanitized nutrient metric retention** from **meal feedback exclusion**. It retains daily nutrient observations, but it never creates canonical meal identities from them; nested nutrition content is stripped. No canonical meal is inferred from nutrient totals.

| Requested history | What can be established from source code | Remaining evidence |
| --- | --- | --- |
| Sleep, activity, body measurements | Replaying exported supported metric groups can normalize these | Retained phone samples, enabled metrics, units, ranges and complete-date batching |
| Workouts and available HR series | Stable IDs plus workout arrays can reproduce summaries and supplied detail | Selected workout export format/detail and history still on phone |
| Nutrition totals/macros | Original ingest accepts whitelisted nutrient samples and sums daily | Whether every desired sample exists in Health and is selected for replay |
| What was eaten (named meals/components) | Source API stores these directly in Sites nutrition_meals | Phone nutrient replay does not establish retained names/components, every canonical meal, revisions or provenance |

No live completeness claim follows from these source capabilities.

## 5. Full schema and wider backend

See `daily-schema.md` and `daily-source-schema.sql` for all31 source tables, including coach_experiments defined in a manual migration rather than db/schema.ts. See `daily-api.md` for the full route and tool catalogue, all remaining backend APIs, auth, state and retention behavior. These documents distinguish code declarations, migration-derived physical structure and unknown deployed state.
