# Original Daily complete backend API

Source: original Daily Sites version182, SHA `9e193554c9c8c7c23a788ed3d2b0582580b76c0f`. Documentation date18 October2026. Source-code evidence only; no live HTTP calls, records, credentials, phone settings or deployment state inspected. No Site changes made.

The full exported original schemas are in `daily-openapi.json` (19 GPT Action paths) and `daily-mcp-tools.json` (36 tools). The generated inventory below preserves every published operation and request/response schema reference. The runtime notes in this document and `daily-source-contract.md` take precedence over a broader/narrower static description where they conflict. Dynamic inner JSON objects declared with additionalProperties:true remain genuinely open in the original schema; this documentation does not invent fields the source does not declare.

## Architecture and dispatch

`worker/index.js` is a fetch/scheduled edge worker. `env.DB` is D1/SQLite; `env.HEALTH_RAW` is R2; `env.ASSETS` serves the UI/build assets. Store factories can accept explicit injected test adapters (`HEALTH_STORE`, `NUTRITION_STORE`, `ATTENTION_STORE`, `COACH_STORE`, `MCP_AUTH_STORE`); those are not evidence that live production uses another database. There is no separate daemon in this source. Health processing may run through `context.waitUntil`; cloud refresh dispatches a GitHub workflow; native phone Health writes happen outside this backend.

Dispatch order matters: public GPT OpenAPI/privacy, widget, bearer GPT Actions, phone ingestion/heartbeat/claim/complete, attention service APIs, OAuth routes and MCP are handled before ordinary signed-in browser access. `/signin-with-chatgpt` and `/signout-with-chatgpt` are delegated to platform assets. Remaining requests require Sites identity and allowlist. `/api/session`, `/api/dashboard`, cloud refresh, preferences, health summary and nutrition browser APIs then dispatch. Unknown paths pass to assets; only GET/HEAD HTML404 for `/`, `/workouts`, `/nutrition`, `/settings` gets SPA index fallback.

### Authentication domains

| Domain | Request / server configuration names | Verified behavior |
| --- | --- | --- |
| Sites browser | `oai-authenticated-user-email`, `oai-authenticated-user-id`, `oai-authenticated-user-full-name`, `oai-authenticated-user-full-name-encoding`; `ALLOWED_EMAILS` | Email trimmed/lowercased; full name optionally percent-encoded UTF8; missing email401 JSON when Accept includes application/json, otherwise302 sign-in; absent/not-in allowlist403 |
| Phone health + nutrition callbacks | `Authorization`; `HEALTH_INGEST_BEARER_TOKEN` | Case-insensitive Bearer regex; secret config min32;401 invalid,503 unconfigured; detailed contract in main document |
| GPT Actions | `Authorization`; `GPT_ACTION_BEARER_TOKEN`, compatibility health bearer; `GPT_ACTION_OWNER_EMAIL`, `ALLOWED_EMAILS` | Owner resolved server-side, never a caller-selected body identity |
| Attention service | `Authorization`; `ATTENTION_INGEST_BEARER_TOKEN` | Config min32; literal case-sensitive `Bearer ` prefix; constant-time text comparison;401 Unauthorized if absent/unconfigured/incorrect |
| MCP private data/tools | `Authorization`, OAuth access token | Token hash lookup, email allowlist/client/resource/scopes/expiry/revocation checks; scoped by read versus food.write |
| Widget | Form `token`; `WIDGET_ACCESS_TOKEN`; Cookie `daily_widget_session` | Separate revocable access code, derived cookie; read-only widget, not an ingestion or GPT credential |

These are source configuration **names**, not values. Platform identity headers are trust inputs from Sites hosting; no separate signed-header verification is implemented inside access.js. This documents original deployment assumptions, not a public impersonation interface.

## Browser and public endpoints

| Path | Methods | Access, request and response |
| --- | --- | --- |
| `/api/gpt-actions/openapi.json` | GET | Public exact GPT_ACTION_OPENAPI JSON,200;405 other methods; Access-Control-Allow-Origin:* |
| `/privacy` | GET/HEAD | Public static HTML privacy page,200;405 otherwise; not live data |
| `/signin-with-chatgpt`, `/signout-with-chatgpt` | Platform delegated | ASSETS/platform handles; source does not implement login protocol |
| `/api/session` | No explicit handler method restriction | Allowlisted Sites identity;200 `{email,fullName,authenticated:true}` |
| `/api/dashboard` | No explicit handler method restriction | Allowlisted Sites identity;200 attention dashboard object from buildAttentionDashboard; exception is not caught locally |
| `/api/health/summary` | No explicit index/handler method restriction | Allowlisted Sites identity;200 normalized health dashboard;503 structured error dashboard on load failure |
| `/api/nutrition/history` | GET | Owner from Sites; fixed today-minus364days through today, limit500;200 `{meals,hasMore,startDate,endDate,timezone,retention:"until_deleted",source}`;503 unavailable |
| `/api/nutrition/favorites` | GET | Owner-scoped; query trimmed/max120; limit default12 clamp1–20;200 favorites+hasMore+source+readOnly;503 unavailable |
| `/api/nutrition/coach` | GET | Owner-scoped; limit default20 clamp1–50; returns favorites, mealPlans, feedback, source, readOnly;503 unavailable |
| `/api/nutrition/feedback` | POST | Owner Sites identity rechecked; max16KiB JSON; body only mealKey/preference; mealKey normalized lower-case `favorite:` or `meal:` token, preference like/dislike/null/empty clear.200 `{saved:true,mealKey,preference,cleared}`;401/403 identity,422 validation/body,503 store failure |
| `/api/preferences/gmail-suppression` | POST/DELETE | Sites allowlist; max64KiB JSON. threadId nonempty/max500. POST requires active waiting-for-you/on-others thread, stores last message/incoming baseline;200 `{hidden:true,threadId}`. DELETE removes local suppression,200hidden:false.422 invalid,404 inactive, errors400/413/415/500 |
| `/api/preferences/order-suppression` | POST/DELETE | Sites identity/allowlist rechecked; normalized orderKey max500, lower-case merchant:order tokens; local owner suppression only. POST requires active nonterminal package;200hidden:true. DELETE removes marker,200hidden:false.401/403/404/422/503 or JSON errors |
| `/api/refresh/cloud` | POST | Signed-in allowlist, sec-fetch-site if present must same-origin; dispatches configured GitHub workflow;202 `{accepted:true,status:"queued",sources:["Gmail","TickTick","Google Calendar"]}`.403cross-site,503not configured,502network/upstream failure |

Cloud refresh server names: `GITHUB_REFRESH_TOKEN`, `GITHUB_REFRESH_OWNER`, `GITHUB_REFRESH_REPOSITORY`, `GITHUB_REFRESH_WORKFLOW`, `GITHUB_REFRESH_REF`. Config defaults are source code choices, not proof of current workflow execution. 202 queued does not mean source refresh completed. Suppression APIs never delete/archive upstream mail/packages. Gmail suppression can revive when later incoming activity changes its baseline. Dashboard reads may persist revival when `reviveSuppressions` is true (default); read routes are therefore not guaranteed completely write-free at the store level.

## Phone and attention service endpoints

Full `/api/health/ingest`, `/api/health/heartbeat`, `/api/health/cleanup`, `/api/nutrition/claim` and `/api/nutrition/complete` details, all error/success variants, samples/units/timezone, persistence and retry behavior are in `daily-source-contract.md`.

### POST `/api/attention/ingest`

Bearer attention auth; D1/store required. Content-Type must start application/json, nonempty valid JSON, actual/declared byte ceiling3MiB (3,145,728). Header checksum is not required; server hashes original bytes. Required envelope: `schemaVersion:1`, runId/idempotencyKey nonempty max200, mode refresh/morning/alarm, capturedAt ISO-like valid Date, and sources containing **all three** gmail/ticktick/google_calendar objects. Every source status is ok/error, capturedAt defaults top-level. Error source requires errorCode max100/errorMessage max1000 and normalizes items to[]; ok source requires items array max20,000. Unknown fields are projected away, not a universal closed-schema rejection.

Base item requires supported type, id max500, title or name max1000. All item timestamp inputs normalize via Date.toISOString. Optional strings become null, booleans must be actual booleans, integers have explicit bounds. Exact fields:

| Source item type | Required / additional fields and defaults |
| --- | --- |
| gmail thread | threadId defaults id; latestMessageId, latestMessageAt, latestDirection incoming/outgoing, semanticState in new_question/direct_request/ambiguous/awaiting_reply/deferral/resolved/none, semanticEvidence max2000. Optional latestIncomingAt, senderName max300, senderEmail max500, senderIsHuman defaultfalse, excludedCategory max80, sentRequestAt, waitingSince, snippet max2000; labels array first30 strings/max100 |
| gmail order_update | company max300, orderNumber max200, status enum received/processing/shipped/ready_for_pickup/delayed/delivered/collected/completed/cancelled/refunded, statusLabel max120, updatedAt; optional deliveryDetail max300 |
| ticktick task | Optional projectId max500, priority integer0–5 default0, dueAt/startAt, allDay defaultfalse, status defaultopen/max60, content max4000 |
| ticktick habit | active defaulttrue, optional target integer1–1000, repeatRule max1000, startDate max20 |
| ticktick habit_checkin | habitId, checkinAt required; finite numeric value else1 |
| ticktick countdown | dueAt required, repeatRule optionalmax1000 |
| ticktick workout_target | habitId defaults id, active defaulttrue, target1–100 default1, repeatRule/startDate optional, workoutClass requiredmax20 |
| google_calendar event | calendarId/name max500, startsAt/endsAt (end not earlier than start); allDay defaultfalse; optional location max1000/status defaultconfirmed |

Same idempotencyKey+same original checksum returns200 `{accepted:true,duplicate:true,runId,sourceStatus}`. Changed bytes409. New success202 `{accepted:true,duplicate:false,runId,sourceStatus:{gmail:status,ticktick:status,google_calendar:status}}`. Wrong method405, auth401, no store503. Body400/413/415; source validation usually422 when error contains must/supported, otherwise caught500. Do not infer strict JSON Schema enforcement: exact runtime validators in attention-rules.js implement this contract.

D1AttentionStore inserts run, three source snapshots and successful-source items in one `db.batch`. Snapshot IDs are runId:source; item PK snapshot/type/stable_id. Latest read state uses latest attempt plus latest successful snapshot independently; failed refresh does not erase prior good data. TickTick countdowns can fall back to an older successful snapshot if latest successful set has none. Eighteen-hour source freshness is a dashboard rule; do not treat retained stale data as newly collected. No age cleanup for attention snapshots is implemented in this worker's scheduled callback.

### POST `/api/attention/brief`

Attention bearer; default max64KiB JSON. Requires nonempty runId<=200 and trigger alarm/weekday_fallback/weekend_fallback/manual_test. Although code defaults missing trigger to scheduled, scheduled is not in allowed set, so missing trigger fails422. Optional startedAt normalizes if parseable else server now; healthPending boolean-coerced OR lack of same-day successful health. Loads dashboard, health and completed seven-day balance as appropriate, builds structured coaching brief v2, stores briefing_runs and returns200 `{runId,preview,body,sourceSnapshots,healthStatus,deliveryStatus:"not_requested"}`. Its body contains verdict/coaching/actions/evidence/dataCaveats plus legacy compatibility fields. Data load/build errors return configured status or500. Generating/storing a brief is not a notification delivery.

Brief upsert preserves original trigger/started_at and delivery fields on ID conflict while updating content/status/health evidence. Historical source text can conflict with current nutrition retention: an attention rule row still describes365-day meal history/automatic queue, while current store, docs and AGENTS say permanent canonical meals and optional on-demand Health export. Runtime save/store behavior is the evidence for current source behavior; old display strings are not a new data lifecycle.

### POST `/api/attention/delivery`

Attention bearer; max64KiB JSON. runId nonempty, status delivered/failed. delivered requires truthy object evidence; source does not further validate shape or independently contact notification service. Updates existing briefing_run with server time/evidence.200 `{updated:true,runId,deliveryStatus}`;404not found;422invalid/evidence missing; standard JSON/auth/method errors. Delivery evidence is a caller assertion, not verification that a human saw a notification.

## Widget interface

- GET/HEAD `/widget` is the identity-less read-only HTML surface. Configured `WIDGET_ACCESS_TOKEN` min32 required; no valid cookie returns login page, missing config503; a valid cookie loads bounded health summary from widget-data.js, no write controls. Source summary maps selected live health/coach facts; no raw database API is exposed. HEAD suppresses page body on successful render.
- POST `/widget/session` accepts application/x-www-form-urlencoded max4096bytes, token field max128. Unsupported/oversized/malformed access-code input400HTML. Correct code303Location:/widget and Set-Cookie. Incorrect401, fifth failure429with Retry-After; missing DB/config503.
- Session cookie is `daily_widget_session=<derived-hash>; Path=/widget; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`. It is derived from the configured widget secret; rotating secret revokes existing sessions. No independent session row per cookie.
- Rate key hashes cf-connecting-ip plus user-agent. D1 widget_auth_attempts has five failures/15-minute window; correct login clears failures. This is source's rate scheme, not a proven global abuse threshold. Widget receives no health/GPT/Google/MCP credential values.

## OAuth and MCP transport

### OAuth endpoints

| Path | Method and contract |
| --- | --- |
| `/.well-known/oauth-protected-resource` and `/.../mcp` | GET200resource/authorization_servers/scopes_supported/bearer_methods_supported/resource_documentation; config failure503 |
| `/.well-known/oauth-authorization-server` | GET200issuer/authorize/token endpoints, code+refresh grants, S256, two scopes, public client auth none, CIMD supported;503config |
| `/oauth/authorize` | GET; Sites identity required (otherwise302platform sign-in return_to), allowlist403; query response_type=code, client_id, redirect_uri, resource, code_challenge, code_challenge_method=S256; optional scope/state. Verifies client metadata, stores five-minute hashed code;302callback with code, iss, optional state. Errors400OAuth invalid_request |
| `/oauth/token` | POST form-urlencoded max16KiB; authorization_code or refresh_token grant. Returns200 `{access_token,refresh_token,token_type:"Bearer",expires_in:28800,scope}`. Only hashes stored.400invalid_request/invalid_grant/unsupported_grant_type/invalid_scope;403access_denied when identity removed |

Server origin comes from `MCP_PUBLIC_ORIGIN` (exact HTTPS origin) except explicit loopback/.test fallback. Resource is origin+/api/mcp. Authorization parameters may not repeat; default parameter max2048 UTF8bytes, response_type/method20, scope200, challenge128. Requested scope defaults both supported scopes, cannot include unknowns. client_id must HTTPS chatgpt.com `/oauth/.../client.json` with no port/query/hash/credentials; redirect must HTTPS chatgpt.com `/connector/oauth/<token>` no query/hash; metadata client_id and redirect_uris must match and public auth none supported. Metadata fetch deadline5seconds, no redirected metadata accepted, JSON<=64KiB. This is an upstream HTTP call at runtime; documentation extraction did not execute it.

Token exchange requires each required form field exactly once. Code grant: code,client_id,redirect_uri,resource,code_verifier; verifier43–128 allowed RFC characters/S256 and all stored bindings match. Code consume uses conditional update, single use. Access token32random bytes→43base64url characters, TTL8h; refresh48random bytes→64chars, TTL180days. Refresh requires client_id, existing token, matching optional resource, optional scope cannot expand; old refresh token revoked conditionally before issuing pair. Allowlist checked at issuance/verification. Lost token responses are not solved by a source exactly-once recovery protocol. No public revocation endpoint or expired-token cleanup schedule is implemented here; revoked/expired evidence can remain stored.

### `/api/mcp`

POST JSON-RPC2.0, Content-Type application/json; max1MiB, nonempty object (not batch array), jsonrpc2.0 and method string required. Accept if present must allow application/json, text/event-stream or */*, else406. Origin if present must equal own configured origin, chatgpt.com or web-sandbox.oaiusercontent.com (plus restricted local test exception); otherwise403. OPTIONS allowed origins204with CORS headers/methods; GET/DELETE and unsupported methods405Allow POST,OPTIONS. No SSE stream handler or HTTP DELETE session implementation is implied by accepting text/event-stream.

Server daily-overview version4.0.10 supports protocol2026-07-28 and legacy2025-11-25/2025-06-18/2025-03-26. Modern requires MCP-Protocol-Version and matching Mcp-Method; tools/call requires Mcp-Name matching requested tool name. Public resource reads permit omitted routing headers for loader compatibility. Conflicting headers/body version400RPC-32020; unsupported protocol400. Legacy initialize negotiates; modern initialize rejected. Responses include protocol headers and no-store.

Public discovery methods: initialize(legacy), server/discover, ping, tools/list, skills/list, skills/get daily-coach, resources/list, resources/read registered UI resources. Notifications/initialized or requests without ID return202no body. Unknown method RPC-32601; unknown tool/skill/resource-32602; invalid JSON-32700; invalid request-32600. Discovery uses resultType:complete, ttlMs300000 and private cache hints. Discovery does not expose personal data.

Private tools/call performs OAuth before executeMcpTool; absent auth returns an isError tool result with mcp/www_authenticate challenge; invalid token401RPC-32001; insufficient scope403RPC-32001. Misconfigured OAuth503. Runtime validation McpToolError returns tool result isError with text; other failures produce a generic temporarily unavailable tool result, rather than invented measurements. Canonical tool names and daily_overview./daily-overview. prefixed aliases are accepted. Tool descriptors are advisory; source runtime validation and scope enforcement decide access/effect.

Registered UI resources: daily-coach-v11, recomposition-v7, weekly-review-v4, readiness-v3 plus explicit legacy aliases in mcp-resources.js, and skill://daily-overview/daily-coach/SKILL.md. Public template content is not private health data. Resource responses attach app metadata and widgets can call scoped tools; a rendered template is not evidence of a data write.

## Tool runtime and persistence notes

Full input/output fields/required keys/ranges/enums for **every tool** are preserved in `daily-mcp-tools.json`; catalogue below gives names, effect, required args and output keys. Full published GPT HTTP fields/responses/errors are in `daily-openapi.json`; wrapper behavior and discrepancies are described here/main document. No tool is omitted because it is outside current migration priorities.

- Search/fetch read only current normalized overview, not arbitrary database tables. Attention kinds waiting_for_you/waiting_on_others/priority_tasks/open_tasks/countdowns; limit<=50. Calendar startDate plus1–31days and<=100items; overlap warnings use timed events.
- Health history defaults30days, max93 inclusive days, <=100per category; future dates rejected. Failure returns status unavailable and empty arrays with explicit hasMore:false. That is an availability result, not proof there are no historical records. Nutrition history accepts any valid nonfuture date range, limit<=100; hasMore indicates truncation but no cursor implementation. GPT HTTP history limit<=20. Chart analytics max400points; auto day<=120days, week<=1095, elsemonth; recovery dates excluded from analytical totals, records retained.
- Calorie balance intake is Sites canonical meals, expenditure active+resting Health; net=intake-expenditure, negative deficit; today in_progress excluded from completed totals. Missing values stay unknown in public contract. Owner-aware health dashboard replaces nutrient observations with canonical meal totals.
- get_coach_status/render_coach_status return eight scoreboard lines/nativeMarkdown plus optional widget; recent body and calorie history can degrade independently. Rendered output is not a new stored measurement. Recomposition14/30/90/365 or custom<=365days; reserved custom1900-01-01 routes legacy clients to weekly review. Review uses previous seven completed days; commit_weekly_experiment requires current proposed key and confirmation, rejects stale proposal.
- ready with no rating reads/reuses check-in/prompt; explicit integer1–10 plus userConfirmed:true upserts owner/day. Context<=280. set_recovery_period requires explicit nonfuture inclusive dates max365days, state sick/clear and confirmation; clear cannot carry context. It changes recovery markers without overwriting measurements.
- update_coach_profile permits only listed profile fields, confirmation and nonempty patch. Runtime numeric bounds: deficit0–.5, protein min0–500, protein/kg0–5, sleep0–24, steps0–100000, weekly gym/run0–50. Structured preference objects are stored JSON; advertised patch schema is intentionally open, but top-level field whitelist enforced. Profile upsert increments revision. Missing profile returns code default profile revision0; defaults are configuration, not observed user measurements.
- save_coach_orders writes1–3quantified actions, batch key<=100 with index suffix for each; metric protein_g/steps/active_kcal/intake_kcal/sleep_hours, target0–100000, comparison defaultsat_least. Source has no userConfirmed field for this write tool; scope still food.write. Store upserts owner/key; does not modify Health or meal records.
- commit_weekly_experiment upserts owner/key after rebuilding and matching proposed review key; prior active experiments marked superseded. This is stored coaching intent, not proof experiment completed.
- Favorites stored by owner+normalized name, aliases<=12, either exact existing meal key or complete confirmed meal definition, not both; repeat name updates. Complete definition requires all five nutrients, components with quantities, confidence, meal type. Meal plans exactly one breakfast/lunch/dinner plus optional snacks, total3–50items, resolved favoriteIDs, complete nutrients; server snapshots and sums, increments revision. Existing names update. No raw measured Health values are inferred from these features.
- set_meal_preference and browser feedback save owner/key like/dislike; null clears by deleting preference row. mealKey pattern is favorite:/meal: lower-case token. They never log food or write Health. Recommendation rank/exclusion does not bypass nutritional fit.
- Lookup calls Danish DTU Frida source via frida-food.js and returns complete/partial ingredient calculations plus explicit unmatched guidance. It never saves. Remote failure remains unavailable; no source-free invented exact nutrients. Input ingredient component schema is preserved in exported contracts.
- Food log/update/delete/queue/cancel/retry and phone callbacks are fully documented in main document. Canonical meals are permanent soft-deletable; queue temporary. cancel only pending queue item; retry uncertain only after explicit absence verification; release-claim requires userConfirmed,shortcutStopped,appleHealthCheckedAbsent alltrue. None automatically deletes Apple Health samples.

Read result containers include structuredContent and text content; selected visual tools have outputTemplate metadata. Some inner result schemas use arbitrary object/array fields: those are source's actual open contracts, not missing invented schema. Schema/runtime mismatches and stale prose must be kept visible.

## Documentation boundaries

This package documents source interfaces and schema, not current deploy health, active connections, row counts, notification delivery or retained phone coverage. No original source, setting, data or credential was changed. API definitions are tied to source182/SHA9e19355 and need refresh if the original Site changes later.


## Complete original route constant inventory

All exported backend path constants are listed, including discovery and browser routes. Method/auth/runtime detail is above or in the detailed health contract and exported OpenAPI.

| Source | Identifier | Path |
| --- | --- | --- |
| `worker/attention-api.js` | `ATTENTION_INGEST_PATH` | `/api/attention/ingest` |
| `worker/attention-api.js` | `ATTENTION_BRIEF_PATH` | `/api/attention/brief` |
| `worker/attention-api.js` | `ATTENTION_DELIVERY_PATH` | `/api/attention/delivery` |
| `worker/attention-api.js` | `GMAIL_SUPPRESSION_PATH` | `/api/preferences/gmail-suppression` |
| `worker/attention-api.js` | `ORDER_SUPPRESSION_PATH` | `/api/preferences/order-suppression` |
| `worker/cloud-refresh.js` | `CLOUD_REFRESH_PATH` | `/api/refresh/cloud` |
| `worker/gpt-action.js` | `GPT_ACTION_LOOKUP_FOOD_PATH` | `/api/gpt-actions/nutrition/lookup` |
| `worker/gpt-action.js` | `GPT_ACTION_OVERVIEW_PATH` | `/api/gpt-actions/site/overview` |
| `worker/gpt-action.js` | `GPT_ACTION_ATTENTION_PATH` | `/api/gpt-actions/site/attention` |
| `worker/gpt-action.js` | `GPT_ACTION_CALENDAR_PATH` | `/api/gpt-actions/site/calendar` |
| `worker/gpt-action.js` | `GPT_ACTION_HEALTH_SUMMARY_PATH` | `/api/gpt-actions/health/summary` |
| `worker/gpt-action.js` | `GPT_ACTION_HEALTH_HISTORY_PATH` | `/api/gpt-actions/health/history` |
| `worker/gpt-action.js` | `GPT_ACTION_LOG_FOOD_PATH` | `/api/gpt-actions/nutrition/log` |
| `worker/gpt-action.js` | `GPT_ACTION_LIST_PENDING_PATH` | `/api/gpt-actions/nutrition/pending` |
| `worker/gpt-action.js` | `GPT_ACTION_CANCEL_FOOD_PATH` | `/api/gpt-actions/nutrition/cancel` |
| `worker/gpt-action.js` | `GPT_ACTION_RETRY_FOOD_PATH` | `/api/gpt-actions/nutrition/retry` |
| `worker/gpt-action.js` | `GPT_ACTION_RELEASE_CLAIM_PATH` | `/api/gpt-actions/nutrition/release-claim` |
| `worker/gpt-action.js` | `GPT_ACTION_HISTORY_PATH` | `/api/gpt-actions/nutrition/history` |
| `worker/gpt-action.js` | `GPT_ACTION_FAVORITES_PATH` | `/api/gpt-actions/nutrition/favorites` |
| `worker/gpt-action.js` | `GPT_ACTION_MEAL_PLANS_PATH` | `/api/gpt-actions/nutrition/meal-plans` |
| `worker/gpt-action.js` | `GPT_ACTION_CALORIE_BALANCE_PATH` | `/api/gpt-actions/nutrition/calorie-balance` |
| `worker/gpt-action.js` | `GPT_ACTION_ANALYTICS_PATH` | `/api/gpt-actions/nutrition/analyze` |
| `worker/gpt-action.js` | `GPT_ACTION_UPDATE_FOOD_PATH` | `/api/gpt-actions/nutrition/update` |
| `worker/gpt-action.js` | `GPT_ACTION_DELETE_FOOD_PATH` | `/api/gpt-actions/nutrition/delete` |
| `worker/gpt-action.js` | `GPT_ACTION_EXPORT_PATH` | `/api/gpt-actions/nutrition/export-apple-health` |
| `worker/gpt-action.js` | `GPT_ACTION_OPENAPI_PATH` | `/api/gpt-actions/openapi.json` |
| `worker/gpt-action.js` | `GPT_ACTION_PRIVACY_PATH` | `/privacy` |
| `worker/health-api.js` | `HEALTH_INGEST_PATH` | `/api/health/ingest` |
| `worker/health-api.js` | `HEALTH_HEARTBEAT_PATH` | `/api/health/heartbeat` |
| `worker/health-api.js` | `HEALTH_CLEANUP_PATH` | `/api/health/cleanup` |
| `worker/health-api.js` | `HEALTH_SUMMARY_PATH` | `/api/health/summary` |
| `worker/mcp-auth.js` | `MCP_PATH` | `/api/mcp` |
| `worker/mcp-auth.js` | `OAUTH_PROTECTED_RESOURCE_PATH` | `/.well-known/oauth-protected-resource` |
| `worker/mcp-auth.js` | `OAUTH_PROTECTED_RESOURCE_MCP_PATH` | `/.well-known/oauth-protected-resource/mcp` |
| `worker/mcp-auth.js` | `OAUTH_METADATA_PATH` | `/.well-known/oauth-authorization-server` |
| `worker/mcp-auth.js` | `OAUTH_AUTHORIZE_PATH` | `/oauth/authorize` |
| `worker/mcp-auth.js` | `OAUTH_TOKEN_PATH` | `/oauth/token` |
| `worker/nutrition-api.js` | `NUTRITION_CLAIM_PATH` | `/api/nutrition/claim` |
| `worker/nutrition-api.js` | `NUTRITION_COMPLETE_PATH` | `/api/nutrition/complete` |
| `worker/nutrition-api.js` | `NUTRITION_HISTORY_PATH` | `/api/nutrition/history` |
| `worker/nutrition-api.js` | `NUTRITION_FAVORITES_PATH` | `/api/nutrition/favorites` |
| `worker/nutrition-api.js` | `NUTRITION_COACH_PATH` | `/api/nutrition/coach` |
| `worker/nutrition-api.js` | `NUTRITION_FEEDBACK_PATH` | `/api/nutrition/feedback` |
| `worker/widget.js` | `WIDGET_PATH` | `/widget` |
| `worker/widget.js` | `WIDGET_SESSION_PATH` | `/widget/session` |

Literal index routes not represented by exported path constants: `/api/session`, `/api/dashboard`, `/signin-with-chatgpt`, `/signout-with-chatgpt`, and SPA `/`, `/workouts`, `/nutrition`, `/settings`. Static asset paths are delegated to ASSETS, not independent JSON APIs.

## Every published GPT Action operation

The exact parameters, body schema and status-specific response schema are in `daily-openapi.json`.

| Method | Path | operationId | Published responses |
| --- | --- | --- | --- |
| GET | `/api/gpt-actions/site/overview` | `getSiteOverview` | 200, 401, 503 |
| GET | `/api/gpt-actions/health/summary` | `getHealthSummary` | 200, 401, 503 |
| GET | `/api/gpt-actions/health/history` | `getHealthHistory` | 200, 400, 401, 503 |
| GET | `/api/gpt-actions/site/attention` | `getAttentionItems` | 200, 400, 401, 503 |
| GET | `/api/gpt-actions/site/calendar` | `getCalendarWindow` | 200, 400, 401, 503 |
| POST | `/api/gpt-actions/nutrition/lookup` | `lookupFood` | 200, 401, 422, 503 |
| POST | `/api/gpt-actions/nutrition/log` | `logFood` | 200, 401, 422, 503 |
| GET | `/api/gpt-actions/nutrition/analyze` | `analyzeNutrition` | 200, 400, 401, 503 |
| POST | `/api/gpt-actions/nutrition/update` | `updateFood` | 200, 401, 422 |
| POST | `/api/gpt-actions/nutrition/delete` | `deleteFood` | 200, 401, 422 |
| POST | `/api/gpt-actions/nutrition/export-apple-health` | `queueAppleHealthExport` | 200, 401, 422 |
| GET | `/api/gpt-actions/nutrition/pending` | `listPendingFood` | 200, 400, 401, 503 |
| POST | `/api/gpt-actions/nutrition/cancel` | `cancelFood` | 200, 401, 422, 503 |
| POST | `/api/gpt-actions/nutrition/retry` | `retryFood` | 200, 401, 422, 503 |
| POST | `/api/gpt-actions/nutrition/release-claim` | `releaseFoodClaim` | 200, 401, 422, 503 |
| GET | `/api/gpt-actions/nutrition/history` | `searchFoodHistory` | 200, 400, 401, 503 |
| GET | `/api/gpt-actions/nutrition/favorites` | `searchFoodFavorites` | 200, 400, 401, 503 |
| POST | `/api/gpt-actions/nutrition/favorites` | `saveFoodFavorite` | 200, 401, 404, 422, 503 |
| GET | `/api/gpt-actions/nutrition/meal-plans` | `searchMealPlans` | 200, 400, 401, 503 |
| POST | `/api/gpt-actions/nutrition/meal-plans` | `saveMealPlan` | 200, 401, 404, 422, 503 |
| GET | `/api/gpt-actions/nutrition/calorie-balance` | `getCalorieBalance` | 200, 400, 401, 503 |

## Every MCP tool

Each row corresponds to its complete inputSchema/outputSchema in `daily-mcp-tools.json`. Tool dispatch source: worker/mcp-data.js:executeMcpTool; declarations/security: worker/mcp-server.js:MCP_TOOLS/requiredScope.

| Tool | Required input fields | Scope | Required output fields |
| --- | --- | --- | --- |
| `search` | query | daily-overview.read | results |
| `fetch` | id | daily-overview.read | id, title, text, url |
| `get_daily_overview` | none | daily-overview.read | generatedAt, timezone, date, sources, priorityTasks, waitingForYou, waitingOnOthers, calendar, countdowns, habits, habitInsight, health |
| `get_attention_items` | kind | daily-overview.read | kind, items, total, limit, hasMore, generatedAt, timezone |
| `get_calendar_window` | startDate | daily-overview.read | startDate, endDate, days, timezone, events, total, limit, hasMore, conflictCount, sourceSnapshot |
| `get_health_summary` | none | daily-overview.read | status, timezone, generatedAt, sync, today, rolling7, weeklyWorkoutCount, targets, recovery |
| `get_health_history` | none | daily-overview.read | status, startDate, endDate, days, timezone, limitPerCategory, sleep, workouts, metrics, hasMore |
| `get_nutrition_history` | none | daily-overview.read | status, startDate, endDate, days, timezone, limit, retention, source, meals, hasMore |
| `analyze_nutrition` | none | daily-overview.read | status, startDate, endDate, days, timezone, granularity, source, retention, summary, series, recovery, visualization |
| `get_calorie_balance` | none | daily-overview.read | status, startDate, endDate, days, timezone, definition, sources, summary, recovery, current, daily |
| `get_coach_status` | none | daily-overview.read | view, period, periodLabel, timezone, generatedAt, metrics, training, recomposition14d, consistency7d, recovery, coach, orders, scoreboardLines, nativeMarkdown, definitions, profile, commitments, accountability |
| `render_coach_status` | none | daily-overview.read | view, period, periodLabel, timezone, generatedAt, metrics, training, recomposition14d, consistency7d, recovery, coach, orders, scoreboardLines, nativeMarkdown, definitions, profile, commitments, accountability |
| `ready` | none | daily-overview.food.write | view, title, periodLabel, date, generatedAt, timezone, nativeMarkdown |
| `set_recovery_period` | startDate, endDate, userConfirmed | daily-overview.food.write | saved, state, startDate, endDate, affectedDays, days, source, effect |
| `get_coach_profile` | none | daily-overview.read | profile, source |
| `update_coach_profile` | patch, userConfirmed | daily-overview.food.write | saved, profile, source |
| `get_coach_commitments` | none | daily-overview.read | date, commitments, accountability, source |
| `save_coach_orders` | idempotencyKey, orders | daily-overview.food.write | saved, date, commitments, source |
| `get_nutrition_activity_trends` | none | daily-overview.read | view, title, periodLabel, startDate, endDate, points, targets, sources, recovery |
| `get_recomposition_progress` | none | daily-overview.read | view, title, periodLabel, startDate, endDate, periodDays, scanCount, requiredScans, ready, status, latestScan, previousScan, scans, metrics, drivers, recovery, goal, definitions, freshness, sources |
| `review` | none | daily-overview.read | view, title, periodLabel, startDate, endDate, generatedAt, timezone, verdict, confidence, body, drivers, days, recovery, inference, experiment, nativeMarkdown, definitions |
| `commit_weekly_experiment` | idempotencyKey, userConfirmed | daily-overview.food.write | saved, experiment, source |
| `get_favorites` | none | daily-overview.read | favorites, hasMore, source |
| `save_favorite` | favoriteName, userConfirmed | daily-overview.food.write | saved, favorite, source |
| `get_meal_plans` | none | daily-overview.read | mealPlans, hasMore, source |
| `save_meal_plan` | planName, items, userConfirmed | daily-overview.food.write | saved, mealPlan, source |
| `get_meal_coach` | none | daily-overview.read | view, status, title, context, todayISO, remainingKcal, remainingProtein, suggestions, projected, source |
| `set_meal_preference` | mealKey, preference | daily-overview.food.write | saved, mealKey, preference, cleared |
| `render_coach_response` | title | daily-overview.read | view, title, subtitle, summary, facts, sections, table, footer |
| `lookup_food` | components | daily-overview.read | status, confirmationRequired, source, components, totals, unmatched, fallbackGuidance |
| `log_food` | mealName, caloriesKcal, confidence, captureMethod, userConfirmed | daily-overview.food.write | mealId, idempotencyKey, status, duplicate, meal, source, retention, appleHealthExportStatus, nextStep |
| `update_food` | idempotencyKey, userConfirmed | daily-overview.food.write | status, source, meal |
| `delete_food` | idempotencyKey, userConfirmed | daily-overview.food.write | deleted, alreadyAbsent, source, meal, appleHealthCopyMayRemain |
| `queue_apple_health_export` | startDate, endDate, userConfirmed | daily-overview.food.write | status, source, destination, queued, startDate, endDate, nextStep |
| `cancel_food` | idempotencyKey, userConfirmed | daily-overview.food.write | cancelled, alreadyCancelled, alreadyAbsent, entryId, previousStatus, meal |
| `retry_uncertain_food` | idempotencyKey, userConfirmed | daily-overview.food.write | retried, alreadyPending, entryId, previousStatus, status, meal, nextStep |
