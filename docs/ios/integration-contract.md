# Jarvis iOS: backend integration contract (draft)

Draft for the native iPhone app, derived from reading the current backend and web client. The code is the source of truth: open the cited file before relying on a detail. Items marked UNVERIFIED were not confirmed from code and need a test on a real device. The owner approved Notes, Voice, Sign-in and Lock concepts on 30 October 2026 and Settings, Health and the Lock Screen tasks surface on 31 October 2026; sections 11–13 reuse existing routes. P15-14 implements Workspaces without a new backend route. APNs backend work remains separate and is not authorized by this client contract.

## 1. Sign-in and session

- Every HTTP and SSE request sends the header `Authorization: Bearer TOKEN`.
- An Entra token is accepted only when the audience is the API client ID, the issuer is v2, the scope is `access_as_user`, and `oid` and `tid` match the owner. Anyone else gets 403.
- Owner session (on in production since 23 October 2026): after Microsoft sign-in the app calls `POST /auth/session` with an optional `deviceLabel` and receives a one-time token shaped `js.ID.SECRET`. Send it as the Bearer token instead of the Entra token. Idle lifetime is 10 days, the absolute cap is 30 days, and at most 10 sessions are active. There is no refresh call: when it expires, sign in again. `DELETE /auth/session` revokes this device and `DELETE /auth/sessions` revokes all of them.
- Native sign-in: MSAL for iOS with authorization code plus PKCE, a public client, scope `access_as_user`, and a mobile redirect URI registered in Entra. The session token lives in the Keychain with the class `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Classes that need an unlocked phone would hide the token when the app wakes in the background, runs a notification action or is used in CarPlay, where the phone is usually locked (the CarPlay developer guide lists them as inaccessible).
- Face ID lock (owner decision, 29 October 2026: on by default, set up at the first sign-in, switch in Settings). It gates the screen, not the token: the app covers its content until `LocalAuthentication` succeeds, with the device passcode as the fallback. It is separate from Microsoft sign-in, needs no backend change and needs `NSFaceIDUsageDescription` in Info.plist. A running voice session is never interrupted by the lock: Mute and End stay on the cover and in the Live Activity. P15-16 uses a 60-second background interval; Settings controls remain out of scope for that issue.
- Backend change needed: probably none for HTTP and SSE.
- Source: `apps/backend/src/auth/hook.ts`, `apps/backend/src/auth/verify.ts`.

## 2. Chat (HTTP plus SSE)

1. `POST /conversation/sessions` with `{channel: "chat", language: "da" or "en"}` returns 201 and `{id, ...}`.
2. `POST /conversation/sessions/:id/turns` with `{text (1 to 20000 characters), attachmentIds (up to 5), screenContext}` answers as a server-sent event stream.
3. Stream events: `user`, `delta {text}`, `acknowledgment`, `food_invitation`, `interrupted`, `done`, `error`.
4. Reattach after a drop: `GET /conversation/turns/active` returns `{turns: [{sessionId, messageId, language}]}`. Keep the `sessionId` and `messageId` of each entry. Reattach with `GET /conversation/sessions/:sessionId/turns/:messageId/events` (a server-sent event stream) and cancel with `POST /conversation/sessions/:sessionId/turns/:messageId/cancel`, which answers `{cancelled: true}`. Both answer 404 when the turn is unknown or the session id does not match it. The web client retries reattaching for up to 15 minutes, 2 seconds apart.
5. History: `GET /conversation/history?limit=50&before=CURSOR&sessionId=ID` returns `{messages, nextCursor}`.
6. Attachments: `POST /conversation/attachments` as multipart, one file up to 20 MB, returns `{id, name, contentType, size, status}`.
7. Tool calls are not streamed as their own events. Read them from `toolCalls` in the final history, or from the confirmation text.
8. Errors: 401 sign in again, 403 not the owner, 429 wait for `Retry-After`, 503 try again later.

## 3. Voice (WebSocket)

- URL: `wss://BACKEND/voice` (English) or `wss://BACKEND/voice/da` (Danish). It is a WebSocket carrying JSON, not WebRTC.
- Auth: two subprotocols, `jarvis.voice.v1` and `jarvis.auth.TOKEN`. UNVERIFIED: whether an `Authorization` header on the upgrade request is also accepted.
- Language: read `settings.voice.defaultLanguage` from the existing authenticated `GET /settings` route for each new session; the default is `da`.
- Audio: base64 PCM16 little-endian, mono, 24 kHz inside JSON messages. There is no Opus.
- The microphone is open (no push to talk). Starting to speak during playback must stop playback at once.
- Client sends: `input_audio_buffer.append {audio}`, `jarvis.microphone.active`, `jarvis.microphone.muted`, `jarvis.session.end`, `jarvis.camera.state`, `jarvis.voice.playback.completed {responseId, audible}`, `jarvis.screen.context`, and `jarvis.screen.context.unavailable`.
- Server sends: `jarvis.session.ready` (with a numeric session id), `jarvis.session.ended`, `conversation.item.input_audio_transcription.completed`, `input_audio_buffer.speech_started`, `response.created`, `response.audio.delta` or `response.output_audio.delta {delta}`, `response.done` or `response.cancelled`.
- Reconnect: exponential backoff, up to 8 attempts, at most 10 seconds apart.
- Camera: post a JPEG to `POST /screen/frames` with `sessionId`, `frame`, `question`, `turnId`, and `mode: "handle"`; use its `frameId` and `capturedAt` in a `jarvis.screen.context` message with `source: "camera"` and the same `itemId`.
- Screen sharing: inspect the latest JPEG through the same authenticated `POST /screen/frames` route without `mode`; send its `description` and `capturedAt` in `jarvis.screen.context` with `source: "screen"`. Report capture failures with `jarvis.screen.context.unavailable`.
- Source: `apps/web/src/voice-client.ts`, `apps/web/src/screen-sharing.ts`, `apps/backend/src/voice/`, `apps/backend/src/vision/screen.ts`, and `apps/backend/src/core/settings.ts`.

## 4. Generated views

- Shape: `GeneratedView`, version 1, in `packages/contracts/src/index.d.ts` with runtime guards in `index.js`. It is JSON, not Zod.
- Renderers: table, list, detail, text (plain or markdown), timeline, chart (line, bar or area, up to 5 series and 1000 points), task-card, status, image, html-app, knowledge-graph, code.
- Actions (up to 10 per view): open-route, open-link, call-tool, window.
- Native decisions still open: html-app (a stored HTML artifact of up to 512 KiB; needs a sandboxed web view), knowledge-graph, and code. P15-14 leaves all three as unsupported cards and does not execute supplied HTML. Its optional web link opens only the configured HTTPS app root because no item deep link is established by this contract.

## 5. App control (workspace commands)

- Stream: authenticated SSE at `GET /now/events` with the events `workspace-ready`, `workspace-command`, `workspace-cancel`. The `workspace-ready` event carries a server-issued `sessionId` (a UUID) for this connection. Send it back in every register and acknowledge call, which answer 409 once that connection is gone.
- Register: `POST /now/workspace/state` with the snapshot fields flat beside the id: `{sessionId, windows, contextPanelOpen}` plus optional `device`, `frame` and `view`. There is no `snapshot` wrapper, and a body that nests the fields under one is rejected with 400. `windows` holds at most 32 entries, each with a required `viewId` and `title`. `device` is `{kind, label}` where `kind` is `desktop`, `phone` or `tablet` and `label` is optional. It answers 204, 400 for an invalid snapshot and 409 when the connection is stale. The most recent snapshot marks the active client.
- Acknowledge each command within 10 seconds (the `workspace-command` event carries `expiresAt`): `POST /now/workspace/commands/:commandId/ack` with `{sessionId, applied}` and optionally `outcome` (`refused` or `error`) and `reason` (1 to 300 characters). It answers 204, also for an identical repeat, 404 when the command is no longer pending, and 409 when the connection is stale. At most 8 commands are pending, and a command id is idempotent by payload fingerprint.
- A command `target` is `active`, `desktop`, `phone` or `all`.
- UNVERIFIED: replay after an SSE reconnect, which commands are desktop only, version negotiation, and how the phone and the desktop choose the active client.
- P15-14 registers its current window snapshot as a `phone` client and acknowledges each received command by its deadline. This does not resolve the active-client choice or replay behavior above; a successful open request is not evidence that the phone was selected.

## 6. Tools

- `GET /tools` lists them. `POST /tools/:toolName` runs one and returns `{tool, outcome: "ok" or "refused" or "error", result, confirmation}`.

## 7. Approvals from the Lock Screen

Decision (owner, 29 October 2026): approving from the Lock Screen is allowed and must not be blocked.

What exists today, read from `apps/backend/src/core/now.ts`, `owner-interactions.ts` and `index.ts` on 29 October 2026:

- `GET /now` lists the pending confirmations as `{id, actionKind, summary, expiresAt}`. `GET /now/events` carries `refresh` and `status` events (kind `approval_pending`) from the same hub.
- `POST /now/confirmations/:id` with `{decision: "approve" or "reject"}` resolves one. The id is a 43-character base64url string. It answers 204 on success, 403 for anyone except the owner, 404 when the confirmation is unknown, expired or already used, and 503 when the service is not available.
- A confirmation lives 5 minutes and is single-use: the approval is consumed once on the server before the action runs.
- The pending confirmation is held in the memory of the one backend instance (the deployment is fixed at one replica), so a restart ends it. The app treats 404 as no longer available.
- Today the only hook when a confirmation is created is `onConfirmationPending`, and it feeds the in-app event stream, not a push.

Native design (approved in P15-36, 31 October 2026):

- The app mirrors currently pending confirmations from `GET /now` into local notifications while active and refreshes on the existing `/now/events` stream.
- A notification category offers Approve and Decline, both marked `.authenticationRequired`. The action handler makes one authenticated `POST /now/confirmations/:id` using the existing after-first-unlock Keychain session, with an eight-second request timeout and no retry.
- The notification names the exact server-provided `summary` and expiry. It never reports success unless the endpoint returns 204; success or failure is shown in the existing Now activity sheet.
- Only yes/no decisions get actions. Stale notifications are removed on the next successful `/now` snapshot; the server still rejects expired or already-used IDs.
- These are local notifications, not remote pushes. Updates cannot be guaranteed while the app is suspended.

## 8. New backend work the app needs

| Item | Why |
|---|---|
| Device registration endpoint plus a small SQL table | Store APNs device and ActivityKit push tokens per device. |
| APNs sender in the backend, key held in Key Vault | Deliver approval notifications and task Live Activity updates while the app is suspended. |
| Push when a confirmation is created | Publish from the existing confirmation-pending hook, carrying only the ID and required notification content. |
| Update or remove an approval notification when the confirmation resolves or expires | Prevent stale Approve/Decline actions from remaining on the Lock Screen. The route already answers 404 for a stale one. |
| Factory task Live Activity push updates | Publish validated task state/activity and end updates through the existing task event lifecycle. |
| Entra mobile redirect (a registration change, not code) | Native sign-in. |

The approve and decline route itself needs no change.

P15-49 (#1498) implements the task portion: owner-only ActivityKit token
registration in SQL and APNs task update/end delivery. It covers existing
Factory tasks and durable `/jobs` background work, not approval notification
pushes or push-to-start. The app requests the activity automatically in the
foreground and registers its update token; server execution is independent of
that token or client connection. Protected APNs configuration, the migration,
Push Notifications provisioning and signed-device verification are still release
prerequisites. Disabled activities and unavailable remote updates have explicit
Danish/English in-app recovery; stale activities do not claim current state.

## 9. Unverified (test on a real device)

- Background audio, Bluetooth and route changes, microphone recovery after a lock or a call, and how long a WebSocket survives in the background.
- Any absolute limit on voice session length.
- Attachment type allowlist and rate quotas.
- Tool and error event shapes on the voice socket.
- Starting the microphone from a locked phone (Action Button, a shortcut or a Lock Screen control), and what the Face ID lock does to it.
- Real-device confirmation that hidden Lock Screen previews suppress Approve/Decline when `showPreviewsSetting` is `.never`; local notifications use a no-action category in that setting and require device authentication for visible actions.
- Whether Approve and Decline appear and work on the Apple Watch, including the authentication step.
- The passcode fallback of the Face ID lock on a cold start, on return from the background and in CarPlay.
- Whether App Intents (Action Button, shortcuts, Siri phrases) need no capability tick. About 90 percent sure; confirm when the first one is built.

## 10. Later surfaces (owner intent, not version 1, nothing authorised)

- CarPlay: the voice-based conversational category would use the same voice WebSocket. The phone is usually locked in the car, so everything it needs must be readable after the first unlock (section 1). CarPlay shows no notifications for conversational apps, so nothing in the car can depend on one. The build plan holds the entitlement steps and limits.
- Apple Watch: Live Activities appear on the Watch without extra work. A native Watch app is outside version 1.
- Music: Jarvis can ask Apple Music (MusicKit) or another player to start something. It cannot be the CarPlay audio app, because an app has one CarPlay category.

## 11. Notes area (P15-12)

The Notes area uses the existing owner-authenticated vault routes. No iOS-specific route or payload is needed.
Its Danish/English interface language is an app-owned local preference (`jarvis.appLanguage`), defaulting to Danish; the voice setting is not used for Notes UI copy.

| Screen action | Existing route and contract |
|---|---|
| Load the vault folders | `GET /notes/tree` returns `directories`, `rootNoteCount`, `truncated` and `updatedAt`. |
| List notes or load one folder in the tree | `GET /notes?limit=50&offset=N`, optionally with `directory=PATH`, `folder=NAME` or `query=TEXT`. Results are sorted by path, not recency. |
| Open a note in the editor | `GET /notes/note?path=PATH` returns `path`, Markdown `content`, the current `sha` and a GitHub URL. |
| Create a note | `POST /notes` with `{path, content}` returns `path`, `commit` and `url`. |
| Save an edited note | `PUT /notes/note` with `{path, content, sha}` returns `path`, `commit` and `url`. A stale `sha` returns `409` with the latest `currentSha` and `content`; retain the draft and require an explicit recovery choice. |
| Load task groups or search tasks | `GET /vault/tasks?state=open|all`, optionally with `q=TEXT`. The response includes task due dates/times, priority, source path/line/version and the backend's `today`. Personal/Work scope is inferred from the source path, as in the web client. |
| Complete or reopen a task | `PATCH /vault/tasks` with the exact source `path`, `line`, `text`, `version` and `done`. A stale version returns `409`; refresh before another write. |
| Edit task text, due date/time or priority | `PUT /vault/tasks` with the exact source identity/version plus `newText`, `due`, `time` and `priority`. |
| Create a task | `POST /vault/tasks` with `{text, scope: "personal"|"work", due?, time?}`. The create contract has no priority field. |
| Load the graph | `GET /knowledge/graph` returns the graph nodes and edges. |
| Search note graph nodes | `GET /knowledge/search?q=TEXT` returns matching graph `nodeId`s and snippets. Load the graph first so results can be resolved to note paths. |

The web graph's read-only note preview uses `GET /memory/:id`, with the id derived from the vault path. The iOS graph opens a note through `GET /notes/note?path=PATH` instead, so its editor has the `sha` required for a safe conditional save.

The web Notes and Tasks views call these routes directly; their assistant tools (`vault_search`, `show_knowledge`, `vault_read`, `vault_write`, `vault_task_create`, `vault_task_complete` and `vault_task_edit`) are not screen endpoints and are not invoked by this area. `vault_delete` is confirmation-gated and is not a substitute for a screen delete route.

There is no note delete, rename or move route; no folder create or rename route; no task delete route; no task priority on create; and no offline cache. Do not expose those operations or simulate them locally. A new folder is not independently created: a directory only appears when it contains a note. Search and editor writes must not claim offline persistence. No additional backend work is authorized by P15-12.

Sources checked before implementation: `apps/web/src/notes/notes-data.ts`, `apps/web/src/notes/NotesArea.tsx`, `apps/web/src/notes/NotesTree.tsx`, `apps/web/src/tasks/tasks-data.ts`, `apps/web/src/tasks/TasksPanel.tsx`, `apps/web/src/knowledge/knowledge-data.ts`, `apps/web/src/knowledge/KnowledgeGraphView.tsx`, `apps/web/src/SettingsPage.tsx`, `apps/backend/src/vault/index.ts` (vault route schemas and handlers) and `apps/backend/src/core/settings.ts` (the separate voice-language setting).

## 12. Settings area (P15-20)

The four native Settings sections reuse the existing owner-session bearer token
and the web application's routes. The handlers below use the verified owner
principal; no iOS-only route, authentication path or backend change is part of
this screen.

| Screen action | Existing route and verified contract |
|---|---|
| Load or save General and Models settings | `GET /settings` returns `settings`, `options` and `credentials`; `PATCH /settings` accepts `{settings: partialSettings}` and returns the fresh response. Appearance exposes only the shared `theme` setting; shared design tokens own accent/tint. |
| Load models and deployments | `GET /models` returns the catalogue and deployment data. `POST /models/deployments` creates a deployment; `DELETE /models/deployments/:name` removes one. |
| Renew a credential | `POST /settings/credentials/:name/renew` is owner-only and supports `codex-login`; it returns `{credential}`. |
| Edit training/nutrition targets | `GET` and `PATCH /daily/training-targets` and `/daily/nutrition-targets` use the existing bounded target schemas. A patch is a top-level object of changed values; `null` clears a target. |
| Read Health upload credential state | `GET /api/health/upload-credential` returns the state and optional expiry. Its `POST` explicitly rejects owner-session tokens with 403 and requires Microsoft sign-in. V1 therefore displays state only; it does not create, rotate, revoke or reveal a one-time token. A native HealthKit upload path is not defined. |
| Toggle proactive work | `GET /proactive/settings` returns `paused` and a 64-character `revision` among its settings. `PATCH /proactive/settings` accepts `{paused, expectedRevision}`; the revision prevents stale writes. |
| List, view, edit or delete memory | `GET /memory?folder=General&limit=50&offset=N&query=TEXT` returns `items`, `count`, `limit`, `offset` and `hasMore`. Items may include both `memory` and `vault_note`; the native settings list filters to `memory`, as the web panel does. `GET /memory/:id` reads one; `PATCH /memory/:id` accepts `{text}`; `DELETE /memory/:id` may return 202 when approval is pending. |
| List and delete routines | `GET /routines` returns `{routines}`. The web panel deletes through `DELETE /recipes/:id`, which returns 204. |
| Read account and sign out | `GET /me` returns the validated owner display name. `DELETE /auth/session` revokes the current session; `DELETE /auth/sessions` revokes all sessions. The existing client removes the device's Keychain token only after the server confirms the revocation. |

Remote notifications remain unavailable: the backend supports web push, but APNs
device registration and test delivery are not implemented. P15-36 adds only local
approval notifications and local ActivityKit updates while active. Advanced voice tuning,
retrieval thresholds, timeouts and project administration remain web-only in v1.
The checked-in `docs/ios/design/board.html` does not contain the approved
`screen=settings` frames referenced by the issue; the implementation follows
those owner-approved frames rather than treating the older local board as source
for settings values. The existing screenshot workflow is retained unchanged
under the Mac-run cost guard.

Sources checked before implementation: `apps/backend/src/core/settings.ts`,
`apps/web/src/SettingsPage.tsx` and its panels, `apps/backend/src/core/model-deployments.ts`,
`apps/backend/src/daily/routes/training-targets.ts`,
`apps/backend/src/daily/routes/nutrition-targets.ts`,
`apps/backend/src/daily/health-upload/capability-routes.ts`,
`apps/backend/src/proactive/routes.ts`, `apps/web/src/proactive-data.ts`,
`apps/backend/src/vault/index.ts`, `apps/backend/src/core/recipe-management.ts`,
`apps/web/src/TaskRecipesSettings.tsx`, `apps/backend/src/core/index.ts` and
`apps/backend/src/auth/session/routes.ts`.

## 13. Health dashboard (P15-18)

The approved Dashboard reuses the authenticated Daily API. The iPhone does not upload HealthKit data and adds no backend route or iOS-specific payload. Before querying, it calls `GET /daily/capabilities` with `Accept: application/json;version=6` and only requests advertised sources.

| Dashboard block or action | Existing endpoint and source |
|---|---|
| Gym and Run rings; recent-session rows | `POST /daily/query` with `source: "daily.health.workouts"` and the selected Copenhagen date range. |
| Steps ring | `POST /daily/query` with `source: "daily.health.metrics"`, `metric: "step_count"` and the selected date range. Targets come from `GET /daily/training-targets`. |
| Protein and calorie balance | `POST /daily/query` with `source: "daily.nutrition.days"` and the selected date range; protein, resting-calorie and deficit targets come from `GET /daily/nutrition-targets`. |
| Sleep value and sleep-night detail | `POST /daily/query` with `source: "daily.health.sleep"`; the selected night is queried again for its detail screen. |
| Open a workout | `POST /daily/query` with `source: "daily.health.workout"` and the exact `workoutId` from a workout row. Optional heart-rate samples use `source: "daily.health.heart-rate"` with that same ID. |
| Open meals | `POST /daily/query` with `source: "daily.nutrition.meals"` and the selected date range. |
| Body trend catalogue and detail | `POST /daily/query` with `source: "daily.health.metric-catalog"`, then `source: "daily.health.metrics"` with each selected exact metric name and date range. |
| Protein chart and target line | `POST /daily/query` with `source: "daily.nutrition.days"` and `GET /daily/nutrition-targets`. |
| Freshness status | `POST /daily/query` with `source: "daily.sync"`. Dashboard refresh listens to the existing authenticated `GET /now/events` stream for `refresh` or `now` events, then reloads the same reads. |

`GET /daily/nutrition-targets` is an existing route used by the web nutrition-target client; it was not enumerated in the issue's endpoint list, but is required for the approved protein and calorie targets. It is reused unchanged. P15-39 enables Track workout and plus using the shared lift contract in section 15. History queries use `source: daily.health.lifts`, `limit: 100` and the returned cursor; quick-add chips use `lastPerExercise: true`. New lift sends `idempotencyKey`, `exerciseName`, `weightKg`, `reps` and `sets` to `POST /daily/lifts`, retaining the same submission on explicit save retry. No inline form or new route is added. Last lifts remains omitted from the Dashboard.

Sources checked: `apps/backend/src/daily/index.ts`, `apps/backend/src/daily/query.ts`, `apps/backend/src/daily/health/read-model.ts`, `apps/backend/src/daily/routes/training-targets.ts`, `apps/backend/src/daily/routes/nutrition-targets.ts`, `apps/web/src/daily/client.ts`, `apps/web/src/daily/sections/overview/health-panel/data.ts`, `apps/web/src/daily/sections/overview/useTopCardData.ts`, `apps/web/src/daily/nutrition-targets.ts` and `apps/web/src/daily/sections/workouts/WorkoutDetail.tsx`.

## 14. Software Factory area (P15-19)

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
## 15. Workout lift logs (P15-17 / #1423; verified 30 October 2026)

The web Health area and native Track workout screen use the same owner routes;
there are no iOS-specific endpoints. The source of truth is the backend and
shared contract code cited below.

- Capability version 6 advertises `daily.health.lifts`. Query it with
  `POST /daily/query` and `{source: "daily.health.lifts", limit?, cursor?,
  lastPerExercise?}`. `limit` is 1–100 (default 50); replay the exact
  `coverage.next` cursor `{performedAt, id}`. Without `lastPerExercise`, this
  returns recent non-deleted entries. With it true, the result contains the
  latest non-deleted row for each normalized exercise key. The response uses
  the standard Daily `items`, `units`, `freshness`, `coverage` and `revision`
  envelope; weight is `kg`, and reps/sets are counts.
- Create with `POST /daily/lifts` and a JSON body containing a UUID
  `idempotencyKey`, `exerciseName` (1–80 characters), `weightKg` (0–1000,
  at most two decimals), `reps` (1–1000), `sets` (1–100), and optional
  `performedAt` ISO timestamp. If omitted, the server records the current
  time. A new row responds 201; a matching retry responds 200 with the prior
  entry and `replayed: true`.
- Correct any subset of `exerciseName`, `weightKg`, `reps` and `sets` with
  `PATCH /daily/lifts/:id`. Soft-delete with `DELETE /daily/lifts/:id`.
  Successful corrections and deletes return `{entry}`; missing/deleted IDs
  return 404. Bodies are strict and bounded; invalid requests return 400,
  store failures 503. These routes and lift reads are owner-only; the Jarvis
  agent token does not have access.
- Source: `packages/contracts/src/daily.js`,
  `packages/contracts/src/index.d.ts`, `apps/backend/src/daily/query.ts`,
  `apps/backend/src/daily/routes/lifts.ts`, and
  `apps/backend/src/daily/lifts/lifts.ts`.
