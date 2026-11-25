# Jarvis iOS: backend integration contract

The backend endpoints the native iPhone app uses. Check the [shared client](../../apps/ios/Packages/JarvisCore/Sources/JarvisCore) and the relevant backend route before changing a payload. [PLAN.md](../../PLAN.md) owns device acceptance.

## 1. Sign-in and session

- Every HTTP and SSE request sends the header `Authorization: Bearer TOKEN`.
- An Entra token is accepted only when the audience is the API client ID, the issuer is v2, the scope is `access_as_user`, and `oid` and `tid` match the owner. Anyone else gets 403.
- Checked-in Bicep pins owner sessions on. After Microsoft sign-in, `POST /auth/session` mints the one-time bearer token. Idle lifetime is 10 days, the absolute cap is 30 days, and at most 10 sessions are active. There is no refresh call: when one expires, sign in again. `DELETE /auth/session` revokes this device; `DELETE /auth/sessions` revokes all of them. See the [operator procedure](../runbook.md#owner-session-switch) for the pin and rollback.
- Native sign-in: MSAL for iOS with authorization code plus PKCE, a public client, scope `access_as_user`, and a mobile redirect URI registered in Entra. The session token lives in the Keychain with the class `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Classes that need an unlocked phone would hide the token when the app wakes in the background, runs a notification action or is used in CarPlay, where the phone is usually locked (the CarPlay developer guide lists them as inaccessible).
- Face ID gates the screen, not the token. It uses `LocalAuthentication`, with the device passcode as fallback. A running Voice session stays active; Mute and End remain available.
- Source: `apps/backend/src/auth/hook.ts`, `apps/backend/src/auth/verify.ts`.

## 2. Chat (HTTP plus SSE)

1. `POST /conversation/sessions` with `{channel: "chat", language: "da" or "en"}` returns 201 and `{id, ...}`.
2. `POST /conversation/sessions/:id/turns` with `{text (1 to 20000 characters), attachmentIds (up to 5), screenContext}` answers as a server-sent event stream.
3. Stream events: `user`, `delta {text}`, `acknowledgment`, `food_invitation`, `interrupted`, `done`, `error`.
4. Reattach after a drop: `GET /conversation/turns/active` returns `{turns: [{sessionId, messageId, language}]}`. Keep the `sessionId` and `messageId` of the accepted turn across backgrounding. These two identifiers also suffice to reconnect to older backends. Reattach with `GET /conversation/sessions/:sessionId/turns/:messageId/events` (a server-sent event stream) and cancel with `POST /conversation/sessions/:sessionId/turns/:messageId/cancel`, which answers `{cancelled: true}`. Both answer 404 when the turn is unknown or the session id does not match it. The web client retries reattaching for up to 15 minutes, 2 seconds apart.
5. History: `GET /conversation/history?limit=50&before=CURSOR&sessionId=ID` returns `{messages, nextCursor}`.
6. Attachments: `POST /conversation/attachments` as multipart, one file up to 20 MB, returns `{id, name, contentType, size, status}`.
7. `tool_activity` streams PI progress and tool outcomes. History retains tool receipts separately from the final answer.
8. Errors: 401 sign in again, 403 not the owner, 429 wait for `Retry-After`, 503 try again later.

## 3. Voice (WebSocket)

- The iPhone opens the JSON WebSocket at `wss://BACKEND/voice` for English and Danish. During a Watch call, microphone audio, reply audio and captions travel over WatchConnectivity through the paired iPhone; the Watch does not open the backend socket.
- The iPhone batches adjacent reply audio or caption fragments for Watch delivery. When a call ends, the Watch reads the saved conversation to recover missed captions.
- Auth: exactly two subprotocols, `jarvis.voice.v2` and `jarvis.auth.TOKEN`.
  v1 is rejected during the upgrade and has no alias or fallback.
- Terminal: `jarvis.session.ended` is clean completion only.
  `jarvis.session.failed` carries `retryable` and `closeCode`; clients reconnect
  only when `retryable` is true. If saving the ended session fails, the relay sends
  a retryable failure and closes the WebSocket with code 1011.
- The active Foundry voice agent supplies the voice and instructions.
- Audio: base64 PCM16 little-endian, mono, 24 kHz inside JSON messages. There is no Opus.
- The microphone is open (no push to talk). The relay owns turn boundaries;
  a partial transcript or short backchannel is not a command to stop playback or tool work.
- Client sends: `jarvis.voice.input_audio.append {audio}`, `jarvis.microphone.active`, `jarvis.microphone.muted`, `jarvis.session.end`, `jarvis.camera.state`, `jarvis.voice.playback.completed {responseId, audible}`, `jarvis.screen.context`, and `jarvis.screen.context.unavailable`.
- Server sends `jarvis.session.ready` with a numeric session ID, `jarvis.voice.activity`,
  `jarvis.voice.input_transcript.delta` / `.completed`, `jarvis.voice.output_transcript.delta`,
  and `jarvis.voice.response.started`, `jarvis.voice.audio.delta`, and
  `jarvis.voice.response.completed` / `.cancelled` keyed by `responseId`.
  GPT-Live upstream sends `session.input_transcript.delta`, `session.delegation.created`,
  `session.output_transcript.delta` and `session.output_audio.delta`; this route does not
  send Realtime `speech_started` / `speech_stopped` or `response.done`.
- A response completion marks the end of its audio stream, not a saved reply.
  The client's Speaking status lasts until the matching local playback drains
  or is cancelled, then reflects relay Thinking or Listening. A played buffer
  also confirms all preceding buffers on the same player. The Watch retries a lost
  playback acknowledgement with the same request ID while that call is active. After
  delegated work hands a reply to GPT-Live for speech, the relay remains at
  Thinking until audio starts or the wait expires. Chat refreshes stored rows
  on the existing `now` SSE message.
- Reconnect: exponential backoff, up to 8 attempts, at most 10 seconds apart.
- GPT-Live is audio-only; the presence of legacy camera or screen controls does not establish live visual input. Show unsupported capture honestly.
- Sources: [native Voice client](../../apps/ios/Packages/JarvisCore/Sources/JarvisCore/Voice), [backend Voice](../../apps/backend/src/voice).

## 4. Generated views

- Shape: `GeneratedView`, version 1, in `packages/contracts/src/index.d.ts` with runtime guards in `index.js`. It is JSON, not Zod.
- Renderers: table, list, detail, text (plain or markdown), timeline, chart (line, bar or area, up to 5 series and 1000 points), map, task-card, status, image, html-app, knowledge-graph, code. The iPhone map view carries a lookup reference and optional rerun request, not the MapKit result.
- Actions (up to 10 per view): open-route, open-link, call-tool, window.
- Renderer support varies by surface. Unsupported blocks keep a text alternative; use the native Workspaces surface for user-opened generated apps.

## 5. App control (workspace commands)

- Stream: authenticated SSE at `GET /now/events` with the events `workspace-ready`, `workspace-command`, `workspace-cancel`. The `workspace-ready` event carries a server-issued `sessionId` (a UUID) for this connection. Send it back in every register and acknowledge call, which answer 409 once that connection is gone.
- Register: `POST /now/workspace/state` with the snapshot fields flat beside the id: `{sessionId, windows, contextPanelOpen}` plus optional `device`, `frame` and `view`. There is no `snapshot` wrapper, and a body that nests the fields under one is rejected with 400. `windows` holds at most 32 entries, each with a required `viewId` and `title`. `device` is `{kind, label}` where `kind` is `desktop`, `phone` or `tablet` and `label` is optional. It answers 204, 400 for an invalid snapshot and 409 when the connection is stale. The most recent snapshot marks the active client.
- Acknowledge each command by the `expiresAt` deadline delivered in its SSE event: `POST /now/workspace/commands/:commandId/ack` with `{sessionId, applied}` and optionally `outcome` (`refused` or `error`) and `reason` (1 to 300 characters). It answers 204, also for an identical repeat, 404 when the command is no longer pending, and 409 when the connection is stale. At most 8 commands are pending, and a command id is idempotent by payload fingerprint.
- A foreground iPhone advertises `appleMaps`, `appleMapsNearby` and `appleMapsNearest` in its device capabilities. The receipt carries the match count, local narration status and optional reason. A positive nearby receipt must include the checked radius in nearbyRadiusMeters. A successful nearest lookup returns one match and `nearest: true` after comparing named results from the origin. Places and routes stay in iPhone memory for five minutes. Refresh reruns the saved request.
- A command `target` is `active`, `desktop`, `phone` or `all`.
- UNVERIFIED: replay after an SSE reconnect, which commands are desktop only, version negotiation, and how the phone and the desktop choose the active client.
- iPhone registers as a `phone` client and acknowledges each received command by its deadline. A successful open request is not evidence that the phone was selected.

## 6. Tools

- `GET /tools` lists them. `POST /tools/:toolName` runs one and returns `{tool, outcome: "ok" or "refused" or "error", result, confirmation}`.

## 7. Approvals from the Lock Screen

- `GET /now` lists the pending confirmations as `{id, actionKind, summary, expiresAt}`. `GET /now/events` carries `refresh` and `status` events (kind `approval_pending`) from the same hub.
- `POST /now/confirmations/:id` with `{decision: "approve" or "reject"}` resolves one. The id is a 43-character base64url string. It answers 204 on success, 403 for anyone except the owner, 404 when the confirmation is unknown, expired or already used, and 503 when the service is not available.
- A confirmation expires within five minutes. SQL records the request and decision and consumes an approval once before the action runs.
- The waiting action is process-local. Startup expires pending SQL requests; a stale notification cannot resume the action. The app treats 404 as no longer available.
- The app registers the `jarvis.approval` category with Approve and Decline actions, both marked `.authenticationRequired`. The handler makes one authenticated `POST /now/confirmations/:id` using the existing Keychain session, with an eight-second timeout and no retry.
- The standard system notification permission prompt appears after sign-in and device unlock, before any approval exists. Denial prevents APNs registration; it does not block in-app approval.
- The owner-only `POST /ios/approval-notifications` stores an APNs token, time zone and preview-action preference; `DELETE` removes that device registration. After an approval is persisted/staged, the backend sends one APNs alert with `aps.alert`, `aps.category`, `aps.thread-id`, `aps.sound`, and top-level `confirmationID`. The body contains the bounded server summary and localized absolute expiry. The last registered `showActions` value selects the category; a changed preview setting may not be registered yet. Verify on a device that setting previews to Never and refreshing registration suppresses Approve and Decline.
- There is no local-notification duplicate: `/now` only reconciles old local alerts and stale delivered alerts; foreground remote banners are suppressed while Chat shows the action bar. Own-device decisions dismiss the delivered notification. The backend does not send a second lifecycle push when another device resolves/expires an approval, so a lock-screen alert can remain until refresh; the existing endpoint rejects stale IDs.
- APNs uses `apns-push-type: alert`, the app bundle topic, priority 10 and the confirmation expiry as the delivery expiration. These are actionable user notifications, not approval Live Activities. Existing task Live Activity updates remain separate.

## 8. Reply notifications and Live Activities

Normal reply pushes open the exact committed session and message. Approval and proactive routes are distinct. Factory and durable job Live Activities register per-activity tokens for update/end, not alert or push-to-start tokens. See [the push lifecycle](../architecture.md#reply-push-and-reminders); device receipt and tap routing are separate checks.

## 9. Notes area

The Notes area uses the owner-authenticated vault routes.
The native interface uses English. Voice language is configured separately.

| Screen action | Existing route and contract |
|---|---|
| Load the vault folders | `GET /notes/tree` returns `directories`, `rootNoteCount`, `truncated` and `updatedAt`. |
| Read or change the manual folder order | `GET /notes/folder-order` returns `orders` (`parent`, `folders`); `PUT /notes/folder-order` with `{ parent, folders }` replaces one parent's order. Owner only; display metadata, never a file move. |
| List notes or load a folder | `GET /notes?limit=50&offset=N`, optionally with `directory=PATH`, `folder=NAME` or `query=TEXT`. Use `sort=updated` for the newest-first native library. |
| Read pinned-note titles | `POST /notes/summaries` with `{paths}`; up to 50 exact paths, independent of pagination. |
| Open a note in the editor | `GET /notes/note?path=PATH` returns `path`, Markdown `content`, the current `sha` and a GitHub URL. |
| Create a note | `POST /notes` with `{path, content}` returns `path`, `commit` and `url`. |
| Create an empty folder | `POST /notes/folders` with `{path}` returns the confirmed `path` and `commit`. A safe visible path is required; an existing directory/file returns 409. |
| Save, move or delete a note | `PUT /notes/note` saves content against its SHA. An optional `destination` moves the same filename in one commit. An occupied destination returns 422, a stale SHA returns 409. `DELETE /notes/note` requires the path, SHA and owner confirmation. |
| Load task groups or search tasks | `GET /vault/tasks?state=open|all`, optionally with `q=TEXT`. The response includes task due dates/times, priority, source path/line/version and the backend's `today`. Personal/Work scope is inferred from the source path, as in the web client. |
| Complete or reopen a task | `PATCH /vault/tasks` with the exact source `path`, `line`, `text`, `version` and `done`. A stale version returns `409`; refresh before another write. |
| Edit task text, due date/time or priority | `PUT /vault/tasks` with the exact source identity/version plus `newText`, `due`, `time` and `priority`. |
| Create a task | `POST /vault/tasks` with `{text, scope: "personal"|"work", due?, time?, priority?: "normal"|"medium"|"high"}`. Omission preserves the existing normal-priority behavior. |
| Load the graph | `GET /knowledge/graph` returns the graph nodes and edges. |
| Search note graph nodes | `GET /knowledge/search?q=TEXT` returns matching graph `nodeId`s and snippets. Load the graph first so results can be resolved to note paths. |

The web and iOS Knowledge graph readers use `GET /notes/note?path=PATH`; the Memory API no longer addresses Vault note IDs. The Notes response includes the exact path, content, current SHA and GitHub URL, so Knowledge and Notes remain separate from Personal Memory.

The web Notes and Tasks views call these routes directly; their assistant tools (`vault_search`, `show_knowledge`, `vault_read`, `vault_write`, `vault_task_create`, `vault_task_complete` and `vault_task_edit`) are not screen endpoints and are not invoked by this area. `vault_delete` is confirmation-gated and is not a substitute for a screen delete route.

Empty folders use a `.gitkeep` marker that never counts as a note. An account-bound warm snapshot is not proof of fresh data or an offline write. See the [Vault routes](../../apps/backend/src/vault/index.ts) and [Notes client](../../apps/ios/Packages/JarvisCore/Sources/JarvisCore/Notes/JarvisNotesClient.swift).

## 10. Settings area

Native Settings uses the verified owner session and the shared settings routes.

| Screen action | Existing route and verified contract |
|---|---|
| Load or save General and Models settings | `GET /settings` returns `settings`, `options` and `credentials`; `PATCH /settings` accepts `{settings: partialSettings}` and returns the fresh response. Appearance includes display mode, accents, surface tints, shared finish and `card-glow` with optional `card-glow-color`. |
| Load models and deployments | `GET /models` returns the catalogue and deployment data. `POST /models/deployments` creates a deployment; `DELETE /models/deployments/:name` removes one. |
| Renew a credential | `POST /settings/credentials/:name/renew` is owner-only and supports `codex-login`; it returns `{credential}`. |
| Log meal | Owner POST /health/meals accepts idempotencyKey (UUID), occurredAt (ISO timestamp), energyKcal (>0–10,000) and optional proteinGrams (0–1,000). Retry the identical submission. The receipt confirms the key, energy, protein and Copenhagen mealDate. |
| Today’s nutrition budget | Owner GET /health/nutrition-budget returns the same Copenhagen-day figures used by Chat and Voice. |
| Edit training/nutrition targets | `GET` and `PATCH /health/training-targets` or `/health/nutrition-targets`. A patch is a top-level object of changed values; `null` clears a target. |
| Read Health upload credential state | `GET /api/health/upload-credential` returns state and optional expiry. Minting through `POST` requires an Entra owner token, not an owner-session token; it is separate from native HealthKit sync. |
| Toggle proactive work | `GET /proactive/settings` returns `paused` and a 64-character `revision` among its settings. `PATCH /proactive/settings` accepts `{paused, expectedRevision}`; the revision prevents stale writes. |
| List, view, edit or delete memory | `GET /memory?folder=General&limit=50&offset=N&query=TEXT` returns SQL Personal Memory only in `items`, with `count`, `limit`, `offset` and `hasMore`; numeric IDs identify one memory and `type` is `memory`. The iPhone client preserves raw `count`/computed `nextOffset`, filters legacy Vault rows separately and versions its Memory cache scope so old filtered-page cursors are discarded. `GET /memory/:id` reads one with source-linked history; `PATCH /memory/:id` accepts `{text}`; `DELETE /memory/:id` returns 204 after the committed forget. Vault notes use the Notes API and never appear here. |
| List and delete routines | `GET /routines` returns `{routines}`. The web panel deletes through `DELETE /recipes/:id`, which returns 204. |
| Read account and sign out | `GET /me` returns the validated owner display name. `DELETE /auth/session` revokes the current session; `DELETE /auth/sessions` revokes all sessions. The existing client removes the device's Keychain token only after the server confirms the revocation. |

See [Settings routes](../../apps/backend/src/core/settings.ts) and the [Proactive code](../../apps/backend/src/proactive).

## 11. Health dashboard

The dashboard calls `GET /health/capabilities` with `Accept: application/json;version=6`, then queries only advertised sources. The `daily.*` source names are unchanged. Native HealthKit sync posts to `/health/sync`; it is separate from the [Health upload credential and ingestion contract](../reference/daily/health-ingestion.md).

Opening Health or returning to it in the foreground syncs the current Copenhagen day's permitted weight, body-fat and lean-mass readings. The iPhone skips unchanged readings within the app session and reloads the dashboard after upload. Pulling down runs the full Health sync, including the 30-day body trend.

| Dashboard block or action | Existing endpoint and source |
|---|---|
| Gym and Run rings; recent-session rows | `POST /health/query` with `source: "daily.health.workouts"` and the selected Copenhagen date range. |
| Steps ring | `POST /health/query` with `source: "daily.health.metrics"`, `metric: "step_count"` and the selected date range. Targets come from `GET /health/training-targets`. |
| Nutrition | Today reads calories eaten, allowance and calories left from `GET /health/nutrition-budget`. Period averages and macros use `daily.nutrition.days` from `POST /health/query`. The protein target comes from `GET /health/nutrition-targets`. |
| Sleep value and sleep-night detail | `POST /health/query` with `source: "daily.health.sleep"`; the selected night is queried again for its detail screen. |
| All history | Owner `GET /health/dashboard-history/:kind` returns monthly history for `training`, `steps`, `sleep` or `nutrition`. |
| Open a workout | `POST /health/query` with `source: "daily.health.workout"` and the exact `workoutId`. Optional heart-rate samples use `source: "daily.health.heart-rate"` with that same ID. |
| Open meals | `POST /health/query` with `source: "daily.nutrition.meals"` and the selected date range. |
| Body trend catalogue and detail | `POST /health/query` with `source: "daily.health.metric-catalog"`, then `source: "daily.health.metrics"` with the selected metric name and date range. |
| Freshness status | `POST /health/query` with `source: "daily.sync"`. The authenticated `GET /now/events` stream can trigger a reload. |

See the [Health client](../../apps/ios/Packages/JarvisCore/Sources/JarvisCore/Health/JarvisHealthClient.swift) and [backend module](../../apps/backend/src/health).

## 12. Software Factory area

The Factory area reuses the authenticated web/backend routes. It adds no iOS-specific route or backend behavior. Project administration (other than the existing completion-policy control in task creation), Git graph visualization, backfill, and sandbox routes remain out of scope.

The iPhone selects one project at a time. Board, Needs Dan, and Releases are
scoped to that selected project; Needs Dan does not aggregate across projects,
and the app does not issue a fan-out of board requests to simulate an all-project
view.

| Screen action | Existing route and contract |
|---|---|
| Load active projects | `GET /factory/projects` returns project records with `id`, `name`, `repo`, `default_branch`, `default_agent`, `policy`, and other existing project fields. |
| Load one project's board | `GET /factory/board?project=ID` returns `{project: {id, repo}, fetchedAt, stale, columns}`. The six column IDs are `backlog`, `needs_dan`, `ready`, `in_progress`, `in_review`, and `done`. Cards contain an issue (`number`, `url`, `title`, `taskCode`, `labels`, `worker`, open/closed state, update/close times and `blockedBy` issue numbers), an optional PR (`number`, `url`, `draft`, checks `none|pending|passing|failing`), and an optional task (`id`, task state, agent, activity, attempt count, branch, start time and latest session end reason). The backend requires a project ID; load each project separately rather than inventing an all-project board. |
| Filter board rows | Board placement is server-owned. Agent and task-state filters may be applied to the returned card facts. The separate `GET /factory/tasks` accepts optional `projectId`, `agent` (`codex|copilot`), `state` (`Ready|Running|PauseRequested|Paused|NeedsAttention|Done|Cancelled`), `createdAfter`, `createdBefore`, and `search`, plus bounded `limit` and `offset`. |
| Refresh board live | Authenticated `GET /now/events` emits `board` with `{projectId, version}` when a project board changes. Refresh only the matching project's board. The backend accepts the existing owner-session bearer token for this stream and closes registered streams when that owner session is revoked. |
| Load task details | `GET /factory/tasks/:id?eventLimit=N&eventOffset=N` returns the task record, bounded `events` page and `usage` records. |
| Receive task timeline updates | Authenticated `GET /factory/tasks/:id/events` is an SSE stream. Send `Last-Event-ID` to resume; task events use `event: task`, the persisted event ID and the task event as JSON data. The initial `ready` event marks completion of replay. The existing owner-session bearer token is accepted. |
| Control a task | `POST /factory/tasks/:id/controls` accepts `{action}` for `steer`, `pause`, `resume`, `cancel`, or `recover`; steering also requires `message`, and an explicitly confirmed restart may include `confirm: true`. A `409` body with `confirmationRequired: true` and a reason requires explicit owner confirmation; only then repeat the same action/message with `confirm: true`. Other `409` responses are conflicts, not confirmation prompts. `POST /factory/tasks/:id/retry` is a distinct retry route for a failed start attempt without sandbox history. |
| Create a task | `POST /factory/tasks` accepts `{projectId, submissionId, title, request, agent?, modelOverride?, reasoningOverride?}` and returns the task plus linked issue number and URL. Keep the same generated UUID `submissionId` and exact payload when retrying an uncertain request; the backend deduplicates by that ID and payload fingerprint. Completion policy is a project setting, not a task-create field: the existing `PATCH /factory/projects/:id` accepts `{policy: "deliver_pr"|"complete_without_deployment"}` and is used by the web task-creation control to save the selected project's policy. |
| Load releases and release detail | `GET /factory/projects/:id/releases` returns the project, `releases`, linked `pullRequests`, `workflowRuns`, `deployments`, and nullable `graph`. `GET /factory/releases/:id` resolves a release to its project ID. Release detail is derived from these existing records; task IDs come from linked PR/run records. |
| Show recent commits | When `graph` is present, its flat `commits` array contains `{sha, message, author, committedAt, parents}` and `truncated` indicates incomplete history. There is no separate compact-commit endpoint or DTO. Show a compact list from these commit records; do not render the web-only branch graph. |

Contract verification (31 October 2026): `apps/backend/src/factory/index.ts`, `board.ts`, `projects.ts`, `task-store.ts`, and `release-view.ts`; `apps/backend/src/core/now.ts` and `apps/backend/src/auth/hook.ts`; `apps/web/src/factory/TasksPage.tsx`, `TaskControls.tsx`, `release-data.ts`, and `ReleasePage.tsx`; and `apps/web/src/task-events.ts`. The owner-session stream, task-list agent/state filters, and returned commit record shape are verified in those sources. Production authorization, project selection, and all writes remain on the existing authenticated API.
## 13. Workout lift logs

The web Health area and native Track workout screen use the same owner routes;
there are no iOS-specific endpoints. The source of truth is the backend and
shared contract code cited below.

- Capability version 6 advertises `daily.health.lifts`. Query it with
  `POST /health/query` and `{source: "daily.health.lifts", limit?, cursor?,
  lastPerExercise?}`. `limit` is 1–100 (default 50); replay the exact
  `coverage.next` cursor `{performedAt, id}`. Without `lastPerExercise`, this
  returns recent non-deleted entries. With it true, the result contains the
  latest non-deleted row for each normalized exercise key. The response uses
  the standard Daily `items`, `units`, `freshness`, `coverage` and `revision`
  envelope; weight is `kg`, and reps/sets are counts.
- Create with `POST /health/lifts` and a JSON body containing a UUID
  `idempotencyKey`, `exerciseName` (1–80 characters), `weightKg` (0–1000,
  at most two decimals), `reps` (1–1000), `sets` (1–100), and optional
  `performedAt` ISO timestamp. If omitted, the server records the current
  time. A new row responds 201; a matching retry responds 200 with the prior
  entry and `replayed: true`.
- Correct any subset of `exerciseName`, `weightKg`, `reps` and `sets` with
  `PATCH /health/lifts/:id`. Soft-delete with `DELETE /health/lifts/:id`.
  Successful corrections and deletes return `{entry}`; missing/deleted IDs
  return 404. Bodies are strict and bounded; invalid requests return 400,
  store failures 503. These routes and lift reads are owner-only; the Jarvis
  agent token does not have access.
- Watch free-form lift capture uses `POST /health/lifts/capture` via the phone bridge. iPhone Gym saves a Vault note through `POST /notes`. The [Gym tool](../../apps/backend/src/health/tools/gym.ts) reads the Vault Gym notes as well as SQL lift history. See the [lift routes](../../apps/backend/src/health/routes/lifts.ts).

## 14. Usage, Status and Proactive

Usage charts read dated costs from `healthCostTotals` (UTC days) or `monthlyCostTotals` (all history). The headline covers the selected period, including partial days. Detail rows supply the task breakdown and activity counts and can be truncated. Model costs use list-price estimates.

No new backend route. The pages call `GET /usage?period=`, `GET /status`, `GET /proactive/status`, `GET /proactive/items?state=open|all`, `GET /proactive/runs`, `POST /proactive/runs` (answers 202), `GET`/`PATCH /proactive/settings` (with `expectedRevision`; 409 `settings_changed` re-fetches and rebases the draft), and `POST /proactive/items/:id/feedback` (`seen`, `dismiss`, `snooze` until tomorrow 07:00). 401 and 403 mean sign-in needed, 404 on proactive status means unavailable. "Add to tasks" creates a personal task through the existing Notes task route because proactive has no such route. The settings PATCH does not accept preferences, so the editor shows them read-only.

## Calendar

Home and Calendar read the owner’s primary Google Calendar through `GET /calendar/events`. To create an appointment, `POST /calendar/events` with a stable 32-character lowercase hex ID, subject, start, end and allDay. All-day ends are exclusive. To edit or delete, send the event’s ETag in `If-Match` to `PATCH` or `DELETE /calendar/events/:id`. On conflict, refresh before editing again.
