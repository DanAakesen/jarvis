## 31 October 2026 — iOS simulator visual and behavior gate (P15-32 / #1466)

Extend the existing ready-PR Mac job and single iPhone simulator boot with a
`JarvisUITests` smoke flow. Use DEBUG-only synthetic sign-in and voice fixtures,
never a real account, token, microphone session, backend or voice service. Check
sidebar drag/button, every enabled navigation route, Chat attachment-menu
entries, ending Voice back to Chat, and opening Needs you then pressing Done.
Attach every screen in light/dark and Danish/English.

Render the matching frames from the checked-in iOS board HTML with macOS WebKit.
Compare 22×48 cell means for RGB color and luminance structure with a 0.38
tolerance; this is a broad drift gate, not pixel-perfect equality. Missing
screens/references and out-of-tolerance drift fail CI. Upload paired simulator
and board images plus comparison results as a 14-day artifact, and update one PR
comment with a table mapping screens to board renders. A UI PR without these
attachments is not ready for review; do not commit generated screenshots or add
a second Mac job or simulator boot.

The approved navigation shell gains a localized Chat toolbar button to open the
sidebar alongside the existing edge drag. Ending Voice ends the session before
returning to Chat; minimizing remains a separate active-session action. The
DEBUG-only fixture keeps screenshot and interaction checks independent of live
sign-in and voice setup. Xcode simulator, artifact and PR-comment execution
remain unverified until a ready iOS pull request runs on GitHub Actions.

## 1 November 2026 — verify requested iOS screenshot appearance (P15-32)

Every simulator screenshot launch explicitly sets the app's requested light or
dark theme, rather than relying on simulator appearance or persisted app
preferences. The screenshot gate samples edge-background luminance for every
theme-named app and board PNG and fails when it contradicts the filename. This
closes the audit finding where `main-dark.png` showed the light surface.

## 31 October 2026 — bound native Microsoft sign-in (P15-23 / #1445)

Use a two-minute MSAL callback deadline and the existing localized failed/retry
surface rather than leaving sign-in pending indefinitely. Timeout/task
cancellation dismisses MSAL web authentication and settles once; ignore later
callbacks. User sheet cancellation still returns to idle, and denied/offline
states stay distinct. P15-24 / #1447 corrects the normal-level-only selection:
select the top visible controller of the highest eligible visible window in a
foreground-active scene, including the gate hosting controller, never the
privacy-only cover. Keep the gate window alive during interactive authentication
so its sheet remains above the Sign-in screen. Keep the current redirect
formula and keychain group; no identifiers or credentials are copied into docs.

Core recovery tests are local evidence only. Successful build 8 upload does not
prove device presentation, signed keychain grants or the live Entra redirect;
those remain real-device/configuration checks.

## 31 October 2026 — build the approved native iPhone Settings area (P15-20 / #1432)

Implement the four approved Settings segments in the existing SwiftUI
`NavigationStack`, using grouped lists, native editors, pickers, toggles and
confirmation dialogs. Keep route models, local bounds, dirty tracking, memory
filtering and sign-out client calls in pure-Swift `JarvisCore`; use the existing
owner-session routes only and add no iOS-specific backend path.

The app-owned language preference remains Danish by default and selects all
Settings copy; the existing shared theme token owns accent/tint, and the saved
appearance theme updates the app color scheme. Notifications remain disabled
until APNs registration and test-send support exist. Health credential status is
read-only because the existing POST requires fresh Microsoft sign-in and
rejects the stored owner-session token; do not invent a route or persist the
one-time upload token. Advanced voice tuning, retrieval thresholds, timeouts and
project administration remain web-only in v1.

The checked-in design board does not include the owner-approved Settings frames
referenced by the issue. Follow the approved issue concept, do not copy literal
board values, and record visible differences in the pull request. Keep the
existing screenshot workflow and Mac-run cost guard unchanged. Linux Core tests
do not establish SwiftUI compilation or rendered-device acceptance.

## 31 October 2026 — build the approved native iPhone Health dashboard (P15-18 / #1430)

The owner approved the Health concept on 31 October. Build the Dashboard first
with the existing Daily capabilities/query, target and `/now/events` routes; add
no HealthKit upload or iOS-specific backend path. Reuse the web app's existing
`GET /daily/nutrition-targets` route for protein and calorie targets, although
the issue's endpoint list did not enumerate it.

Keep Track workout disabled and omit Last lifts and plus in this Dashboard-only
implementation. The shared lift routes from #1423 are now present on main, so
future native logging can use that contract without adding a route or payload.
Keep calculations and Copenhagen period logic in pure-Swift `JarvisCore`, and
use synthetic-only FixtureTransport previews in both app languages. The
checked-in Health board was a blank placeholder when this screen was built, so
the approved issue—not that local frame—guided its composition. Preserve the
existing simulator screenshot/Mac cost guard; Health screenshot review remains
outstanding.

## 30 October 2026 — share the workout lift contract (P15-17 / #1423)

Store one owner-scoped lift row per exercise entry, with kg, reps and a single
set count; use normalized names for recall/grouping rather than adding an
exercise registry. Keep create idempotent, corrections partial, and deletes
soft. Expose history and latest-per-exercise reads through the existing Daily
query/capability contract and owner-only write routes; service identities do
not gain access. The web Track workout section and Dashboard Last lifts block
are the v1 surfaces. iOS reuses the same routes in a separate screen issue;
there is no iOS-specific backend path, chart, or coaching tool.

## 30 October 2026 — build the approved native iPhone Voice screen (P15-11 / #1401)

Use the approved Voice concept as a visual reference, not a source of literal
values. Keep protocol/session logic in pure Swift `JarvisCore`, and implement
audio, camera, screen capture and SwiftUI in thin Apple targets. Read the existing
`voice.default_language` through `GET /settings`, use the same voice socket and
vision routes as web, and add no iOS-specific backend path. The ReplayKit
extension passes bounded screen JPEGs through the registered App Group. Keep the
session active when the screen is minimized; do not make Face ID locking change
voice lifecycle. Background audio, Bluetooth, route changes, call interruption
handling, microphone recovery after device lock, microphone recovery after a
phone call, CarPlay, Live Activity and Action Button remain unverified and are
separate follow-ups requiring a real phone. Linux protocol/contract tests do not
establish Apple target compilation or device acceptance. The current shell has no
native sign-in UI, so the screen fails closed when the owner-session token is not
already present; do not expand this screen into an unapproved auth implementation.

## 30 October 2026 — localize the iOS Notes area from app preference (#1420)

Use the app-owned `jarvis.appLanguage` preference for Notes, Tasks, List, Graph,
editor/sheet copy, accessibility strings and date formatting. Danish is the default;
the Notes screen does not infer its language from the device locale or the separate
backend voice preference. Keep both language catalogs in JarvisCore so Linux tests
can validate coverage and date formatting without adding an Apple-only test target.

## 30 October 2026 — stabilize the GitHub chat acceptance read (#1415)

Judge `chat_github_read` by a successful `github_read` / `issue_get` receipt for
issue 700 with a nonblank title, not by whether the model repeats that title.
Retry `github_issue_unavailable` once through the existing pacing/deadline wrapper;
share the two-attempt limit with rate-limit recovery. Keep the final safe failure
reason and aggregate failure visible in existing acceptance/release evidence.
Deploy 41130636015 showed this isolated read assertion failing; deterministic
regressions cover recovery and genuine failures. Repeated live acceptance after
deployment remains unverified.

## 30 October 2026 — keep the voice protocol in JarvisCore (P15-06 / #1391)

Use the web client's `/voice` and `/voice/da` routes and its
`jarvis.voice.v1` plus `jarvis.auth.TOKEN` subprotocols. Keep the WebSocket
replaceable for Linux tests; do not add an iOS backend route or Apple framework
to `JarvisCore`. The core models known client/server messages, retains unknown
server JSON, and owns only protocol state and PCM16/base64 conversion—not audio
capture or playback. Speech during a response immediately emits an interrupt
action and an inaudible playback-completion message.

Reconnect after drops with a fake-clock-testable 1, 2, 4, 8, then capped
10-second backoff, for at most eight attempts. A user-ended session is terminal.
The exact acceptance of an Authorization header during upgrade and the shapes
of tool/error messages remain open; neither is guessed or implemented here.

## 30 October 2026 — keep generated-view models in JarvisCore (P15-07 / #1392)

Decode the existing version-1 web contract into typed renderer data and actions
inside the Linux-testable pure-Swift core. Keep rendering and HTML execution out
of scope; retain the raw JSON for unknown renderers and unsupported versions.
The parity test reads `packages/contracts/src/index.js` directly, so no web
contract export or backend route is needed. The runtime `isGeneratedView` guard
accepts source status `running` although the TypeScript declaration and JSON
schema omit it; follow runtime behavior and leave the web contract unchanged.

## 30 October 2026 — synthetic fixture replay in JarvisCore (P15-08 / #1393)

Implement fixture replay through the existing HTTP and streaming transport seam
and reuse `ChatClock` for deterministic delays. Keep the hand-written JSON sample
scenarios in the test target's resources: the current app does not consume them,
so no public `JarvisCoreFixtures` target or app/project change is justified.
Never derive fixtures from real sessions. Test fixture files for sensitive
patterns and non-example hosts as well as exercising their client behavior.

The merged HTTP/chat prerequisites contained no approvals client. Add only the
small approvals slice needed to load pending confirmations and resolve a
decision through the web application's existing `/now` routes, sharing the
authenticated HTTP client. No backend route or screen is added. Linux replay
evidence is separate from owner live verification; #1393 stays open until that
verification.

## 30 October 2026 — keep chat streaming in JarvisCore (P15-04 / #1389)

Reuse the web application's conversation routes and event payloads; do not add
an iOS-specific backend path. Keep SSE parsing byte-oriented, preserve unknown
event names, and expose server error events as typed failures. A default
streaming adapter keeps existing `HTTPTransport` fakes source-compatible. Retry
reattachment only for transient failures, at the web client's two-second
interval and within its 15-minute window; inject the clock for deterministic
tests. The Linux-testable core owns the chat client and multipart encoding;
Apple transport implementations remain in the app target.

## 30 October 2026 — keep approvals and workspace control in JarvisCore (P15-05 / #1390)

Reuse `GET /now`, the confirmation decision route and the authenticated
`/now/events` plus workspace registration/acknowledgement routes already used
by the web app. Never retry a confirmation decision; treat 404 as no longer
available. Workspace acknowledgements are single-send and use the server event's
expiry to bound the request timeout. Reconnect with a capped, injectable backoff,
clear the old session ID, and do not assume event replay or re-register state.
Keep this issue headless: no push, notifications, screen, backend route or
Apple-only dependency.

## 30 October 2026 — keep iOS networking in the pure-Swift core (P15-03 / #1388)

`JarvisCore` owns the HTTP client and platform replacement seams for transport,
token storage and access-token acquisition. It reuses the backend's owner-session
and tools routes without adding a backend path or dependency. Session tokens are
stored only through `TokenStore`; the Apple Keychain and Entra/MSAL adapters stay
in the app target. A 401 clears the stored token and asks the access-token
provider for sign-in; there is no refresh flow. Retries are bounded and limited
to idempotent requests after transient failures, so tool and session mutations
are sent at most once.

## 30 October 2026 — iOS Sign-in and Lock gate (P15-16 / #1417)

Build the owner-approved Sign-in and Face ID Lock frames as native SwiftUI; the
board is a visual reference, not a source of literal values. `JarvisGatePolicy`
in `JarvisCore` owns the cold-start and 60-second background lock decision and
routes missing/expired sessions and denied accounts. The app uses MSAL 2.17.0
for tenant-specific delegated `access_as_user`, `JarvisClient` for the existing
owner-session route, and the device-only Keychain store for its opaque session
token. Use `LocalAuthentication` for Face ID and the system passcode fallback.
Keep app content blurred and inaccessible while locked, with an opaque privacy
cover while inactive. Put auth configuration in protected build configuration,
not repository files. No backend route or TestFlight upload is added. Linux
tests pass; the Mac app-target build and physical-device auth remain unverified.

## 30 October 2026 — bounded managed-policy causes (#1373)

Keep existing closed failure reasons and add optional `providerCause` rather than
encoding provider text into the reason. Allow only HTTP status integers 100–599,
provider code/parameter matching `[a-z0-9_.]{1,48}`, and bounded exception-class
identifiers. Revalidate at each stream, logging, status and browser boundary;
discard unknown fields and never copy messages. This preserves current consumers
and claim safety while making a future provider rejection diagnosable.

Do not treat the synthetic 400 fixture as a live diagnosis. The original rejected
parameter and successful real Copilot turn remain unverified. Leave the request
shape and conservative blocking policy unchanged until evidence supports a
correction; non-blocking definitive 4xx recovery remains an owner decision.

## 29 October 2026 — preserve managed failure and claim outcomes (#1350)

The owner requested repair after real Copilot test replies failed. A successful
minimal canary does not qualify user context, claims, shared policy or tool rounds.
The pinned OpenAI SDK 3.24.0 and its
[function-call model](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_function_tool_call.py)
define function-call status as optional. Accept omission/null only after the
parent response is explicitly completed; explicit unfinished/unknown statuses and
the final-only no-tool boundary still fail before dispatch. This corrects a
reproduced contract mismatch, not a proven attribution of the owner's failure.

Known failures before inference and before any backend tool call may finish a
claim as failed, while the source remains permanently consumed. Unknown inference,
cancellation and possible tool effects retain the claim. Show fixed failure codes
and actual blocked-state guidance; do not silently clear claims, resend messages,
change model/settings or switch the production default.

## 29 October 2026 — use the documented optional identity status (#1350)

The [Foundry governance contract](https://learn.microsoft.com/en-us/azure/foundry/control-plane/govern-agent-infrastructure-entra-admin)
defines effective agent `state` separately from optional Entra identity `status`.
Provisioning may accept unset status only alongside enabled effective state and
a valid principal UUID, retaining that principal across endpoint readback.
Explicit disabled/unknown states remain blocked. This corrects a schema mismatch;
it does not prove the exact field behind live `agent_identity_unverified`, enable
an identity, grant access or authorize a replacement resource. Reconcile and reuse
the existing exact single-version candidate before another handoff.

## 29 October 2026 — first runtime comparison boundaries (#1350)

The owner subsequently declined extra exclusion from search, recent context and
rolling summaries. Jarvis is a personal side project not yet in use; do not add
multi-user architecture or additional isolation features. This does not authorize
deletion or a context reset. Runtime/source binding still prevents duplicate work
and preserves the existing authentication boundary.

The owner approved retaining the Python bridge temporarily to preserve voice
fallback, starting with existing Jarvis tools with extra harness shell/web/subagent
tools disabled, and keeping test conversations out of normal chat history. These
extend the approved chat-menu selector and fresh labelled conversation; they do
not authorize new identities, role grants, production default changes or removal
of the old runtime. Actual target/model/region support and persistent access
changes require specific evidence and applicable owner authorization.

## 29 October 2026 — whole-Jarvis diagnostic scope supersedes backend-only (#1341)

The owner confirmed all logs belonging to Jarvis: backend, hosted agents, coding
runners, deployments and supporting services, excluding unrelated projects. Stop
the Foundry Reader removal proposal; it was never approved or applied. Preserve
that assignment. Earlier backend-only grant approval does not authorize broader
persistent permissions. Keep the existing issue and disabled reader state.

Map actual source stores/readers and ownership first. A shared workspace is not
assumed entirely owned. Independent metadata preparation admits only exact known
infrastructure IDs with ownership tags and records known table plan/resource-field
metadata privately. Unknown sources and missing collection remain gaps. Propose
one condition-restricted workspace Data Reader assignment only after the exact
resource/table manifest and provider support are verified; reuse existing GitHub,
SQL and Blob access. Exact grants and final qualification remain unapproved.
Source adapters replace/expand one existing capability, with redaction, bounded
reads and honest availability. No security, retention, collection or credential
change is authorized merely by the scope confirmation. See [design](jarvis-logs.md).

## 29 October 2026 — tests use the owner's selected role settings (#1350)

The owner clarified that the visible chat setting is not none and explicitly
requires tests to use the same settings. A closed UI selection is not a verified
database readback. The candidate removes the smoke-only effort/token-budget
overrides, preserves saved values and records effective request settings. It does
not assert ordinary chat is broken from a forced-none test failure. Synthetic
regressions pass; the owner approved publication with #1353. Review, qualification
and live acceptance are pending. No screenshot or
private configuration record is included. See [local report](smoke-settings-1350.md).

## 29 October 2026 — preserve Terra settings while distinguishing its rejection (#1350)

Deploy 40840605441 passed backend/agent/readiness and failed live conversation
acceptance with model_bad_request_reasoning. Smoke forces none, but Microsoft's
Terra announcement and OpenAI's model contract explicitly support that effort;
the Azure reasoning guide lists Terra reasoning/Responses support. The documented
contract and live result conflict without identifying the service's rejection
code/subfield. Preserve saved settings and request construction, retain fixed
reasoning distinctions, and separately classify the existing research runner
boundary. Do not assume a shared root cause or use a parameter removal/effort
fallback as a fix. All new diagnostic outputs are application-owned constants;
provider text and worker events remain private. Live correction is unresolved.
See [migration evidence and primary sources](main-chat-harness-migration.md).

## 29 October 2026 — distinguish Foundry table errors from log permission evidence (#1341)

The first actual Foundry probe returned 400 while querying `AppTraces`.
[Cognitive Services supported logs](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-logs/microsoft-cognitiveservices-accounts-logs)
use `AzureDiagnostics`. Use that fixed aggregate and request the
[resource API's permission metadata](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/azure-resource-queries).
Classify resource/data-source/deny-table metadata only in bounded backend memory;
return fixed states separately from the HTTP verdict. A 400, empty response or
absence of an explicit table denial does not prove isolation or clear existing
grant concerns. No roles, access mode or activation changes are authorized here.

Use the documented ARM [assignedTo filter](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-list-rest)
for the verified backend service principal at workspace, verified Foundry and
existing subscription scopes. It includes transitive group grants without new
directory access. Paginate within the fixed existing budget, otherwise report an
incomplete scope. Preserve raw conditions only in the private report. The real
foreign-workspace requirement stays unchanged pending any explicit owner-approved
qualification change. The separate migration task owns chat failure diagnosis.

## 29 October 2026 — controlled main chat harness migration (#1350)

Dan approved one migration issue with staged draft PRs: fix the baseline, build a
temporarily switchable managed path, compare identical test scenarios, then cut
over with evidence and authorization before retiring replaced runtime code.
Preserve native voice, identity, tools/approvals, durable memory/artifacts and
separate subscription-backed Factory workers. Dan subsequently approved Test
agent runtime in the chat menu, Current/Copilot choice and a separate labelled
conversation without switching midway. Provide manual test questions, with no
new question-button feature implied. These are confirmed scope/design decisions;
model/region, persistent access grants and parity thresholds remain open. The
first candidate only retains fixed rejected-field diagnostics; it does not prove
the live error fixed or authorize cutover. See
[migration evidence and open decisions](main-chat-harness-migration.md).

## 30 October 2026 — preserve the optional Copilot target in infrastructure deploys (#1350)

The explicit comparison provisioning flow remains the only way to create or pin
the separate managed agent. Ordinary Bicep deploys may carry forward only the
existing backend's complete, validated agent name/version/definition fingerprint;
partial or malformed tuples fail before deployment. An absent tuple stays absent.
This prevents infrastructure updates from silently removing a selected comparison
target without adding credentials/grants or changing the production runtime default.

## 29 October 2026 — observe actual backend authorization before a log grant (#1341)

The corrected main preflight passed but surfaced an existing resource-log grant
requiring review and no foreign-workspace control. The ordinary deployment
succeeded for backend/web/agent/readiness, while live model acceptance remained
unhealthy. Preserve these distinct facts; no grant or activation is inferred.
Prepare fixed aggregate reads as the verified backend identity through the
existing deployment smoke route. Keep private target values inside the same job's
preflight/parameter files and runtime configuration, and emit only fixed verdicts.
Use bounded work, exact principal matching, no caller queries, no log text,
nonblocking cancellation, explicit missing/partial/error states and one-process
caching with timestamps. Empty negatives are not exclusion proof; a grant change
needs fresh post-change observations and positive controls. No role mutation,
new credential, route/auth allowance, UI or reader enablement is included.

## 28 October 2026 — correct the backend-log preflight ARM role shape (#1341)

The first main preflight (#40761349594) failed closed before Bicep because the
role verifier read `properties.roleType`, the CLI model field. The raw ARM REST
2022-04-01 schema uses `properties.type`. An ARM-shaped fixture reproduced the
failure before correction. Read the documented ARM field while retaining exact
built-in identity/actions/dataActions and empty exclusions. Reject custom-role
and CLI-only shapes. Fifteen preflight tests, scoped Ruff and byte compilation
pass; actual role permissions/inventory/enforcement still await the normal main
rerun. No assignment, access-mode change, new credential or activation occurred.

## 28 October 2026 — approved backend-only log grant; executable preflight first (#1341)

The owner explicitly approved persistent access to Jarvis's backend log records
and basic logging-workspace metadata, excluding other apps and all writes,
deletion, new credentials and extra permissions. Use the documented built-in
Log Analytics Data Reader with the restrictive workspace/table/app condition;
this avoids custom-role creation and new operator privileges. No new sign-in is
needed for the existing main-only OIDC route. The original custom-role plan below
is historical, not a request for more owner approval.

The first follow-up release supplies bounded metadata-only ARM reads in that
normal path before any activation assignment: compare actual principal/runtime
identity, workspace and schema, exact built-in actions, access mode and assignment
inventory, and find a real negative workspace candidate if one is visible. Keep
private IDs/GUIDs in runner-temporary storage and emit only fixed verdicts. Group
membership and provider enforcement remain explicitly unverified at this stage;
no assignment or feature enablement is inferred. Main-chat instructions and tool
descriptions must reflect configured/unavailable log state and retained ingestion
lag. Existing permission boundaries and the requirement for real backend-identity
positive/negative proof before activation remain.

## 28 October 2026 — Eight review fixes and mobile Settings replacement (#1343)

Dan approved the eight reviewed fixes and explicitly approved issue/draft-PR
publication. For Settings, he replaced the proposed unsaved-draft fix with a
sticky mobile heading and Save at the top. Preserve desktop behavior and do not
add Settings guards, autosave or draft persistence.

Use persisted delivery identity, independent of active task state, to prevent
old label replays from starting work again. Save issue conversation origin before
publishing the worker label. Commit task-status messages and deduplication keys
atomically; a failed transaction remains retryable. Surface a too-large worker
prompt as a retained Now alert tied to the existing issue. Keep uncertain Gmail
writes uncertain and approval cards explicit about changed values/units.

For chat reload recovery, reuse tab-local storage, isolate backend/account scopes
and restore queued messages for review before sending. These are unsent drafts,
not approval to repeat a completed or uncertain server action. No optional audit
feature, Azure log permission, paid worker, real email send or health write is
included. Draft delivery remains subject to independent review and coordinator release.

Review follow-up: use the same per-entry validator on write and read, matching
the backend's 512 KiB UTF-8 partial-reply limit. Reject invalid entries separately
so a bad warning cannot discard unrelated queued drafts. Under the existing
snapshot bound, prioritize unsent messages and uncertainty warnings over partial
context; report incomplete saving through the existing recovery feedback.

## 28 October 2026 — prepare scoped backend-log chat reads (#1341)

Dan approved starting read-only chat access to Jarvis's own backend logs,
including retained history, with secrets filtered and other apps excluded. New
Azure log-read permission still requires action-time owner approval. Use existing
Log Analytics console history and the authenticated sensitive read-tool registry;
no UI, arbitrary KQL, repair action or retention change. Reapply logging allowlists
and omit free text/identifiers from historical output. Keep the implementation
disabled until the deployed schema and Azure isolation are proven. Microsoft's
current granular RBAC docs support the proposed restrictive table/row condition;
that is documentation evidence, not proof of an effective deployed grant. The
exact unapplied proposal and validation/rollback gates are in
[backend-logs.md](backend-logs.md). No role/assignment/access-mode/credential change
is authorized by this code preparation.

## 27 October 2026 — Prepare Terra as the main-chat default (#1337)

Dan requested GPT-6.1 Terra for main chat, both selectable and default, and
explicitly approved the issue and draft PR. Prepare the existing Foundry
GlobalStandard deployment path for `gpt-6.1-terra` / `2026-10-26`. On 28 October,
resume with requested capacity 150 in the committed parameters, following the
existing chat allocation and recorded 50K-TPM throttling evidence (#1232/L91).
This is a throughput request for pay-per-token GlobalStandard, not a reserved
PTU commitment or an observation of actual available quota. The normal main-only
Deploy already authenticates through OIDC and can validate Azure acceptance;
do not require a new owner sign-in just to prepare the request. No merge,
deployment or paid inference is performed by this preparation.

Prefer Terra only when it is in the deployed chat catalogue; retain Luna before
provisioning or during ARM fallback. Preserve saved `roles.chat.model`, legacy
`jarvis.model` and explicit sessions rather than silently migrating them. Rollout
must observe the owner setting and apply the existing chat-only Settings update
to fulfill the requested owner default. Danish `/voice/da` uses the realtime
voice role when `options.connect` is configured; only the `connectDanish`
hosted-agent fallback inherits chat settings. Approval interpretation and
proactive summarization already consume chat settings. Other role defaults and
subscription-backed coding/image tools stay unchanged.

Terra's documented reasoning default is medium. Send explicit none only for
Terra when the existing setting is none; preserve other model requests. Expose
its intersection with the existing enum, without minimal or a broad max/ultra
change. Microsoft's public Global Standard price table is verified through its
indexed model catalog tag page and recorded in `infra/README.md`. Account rates,
Azure context-tier billing rules, actual quota/capacity, live selection and paid
acceptance remain unverified. Dan approved USD 20/month and declined a new
spending guard, accepting existing alerts. Keep safeguards and alerts intact;
no runtime price or budget implementation is added. Normal review/qualification
and the existing authenticated deployment remain required; stop on an Azure
allocation rejection rather than silently changing capacity, region or access.

## 27 October 2026 — Compact screen-share Stop control (#1333)

Replace the composer's screen-sharing status row with an icon-only red square
Stop recording button in the empty grid cell beside Dictate. A visually hidden status keeps "Screen shared
with Jarvis" announced; the button opts in to `data-preserve-typing-focus`. The
earlier unpushed implementation was not recoverable, so this is new work. Capture
and background-watch behavior are untouched.

## 27 October 2026 — Preserve composer focus on later mouse-down (#1315)

Owner iPhone metadata reports an uncancelled mouse-down after cancelled Send
pointer-down, followed by blur/movement and a missed click; Plus/Dictate share the
sequence. Guard only primary mouse-down on opted-in phone composer toolbar controls
while textarea is focused. Preserve native click activation, menu focus and scroll.
Browser sequence replay is distinguished from native Chromium and physical iOS.

## 26 October 2026 — Local passive Send collector

Owner approved content-free in-memory tap/focus/viewport diagnosis, not the
speculative mouse fallback. Collect a bounded allowlist using passive listeners;
add no storage or telemetry. Later owner approval permits an explicit phone Plus
copy action and clipboard writing only, with safe feedback and no clipboard reads.

# Decisions

## 2026-10-26 — Preserve transcript fade with bubble frost (#1324)

Use the lighter shared 16px blur on Plus, bubbles and header. Correct only shown
mobile composer corners; desktop and hidden-state borders remain as before.
A masked transcript and a backdrop-filtered window each block child backdrop
sampling. Bubbles remain in scroll flow; move the window blur to its content's
background pseudo-element and move the existing 64px fade to individual painted
items. Track viewport-relative mask offsets on scroll, resize and content change.
No popovers or list markup changes. Synthetic fade comparison and pixel evidence
are in `docs/ui/screenshots/chat-bubble-frost/`. Physical Safari remains unverified.
## Whole-number meal estimate lists (#1327; 26 October 2026)

Display kcal and all nutrient grams rounded to whole numbers in one canonical
meal-estimate list. Retain protein, calories, fat, carbohydrates and fiber; keep
unknown distinct from zero. Calculations, stored values, approval fingerprints
and idempotency retain full precision. Chat and voice consolidate existing
nutrition bullets using server presentation; acknowledgment-only replies still
receive the complete list. Validate with synthetic fractional nutrition fixtures.


## 26 October 2026 — Defer phone outside-touch dismissal until tap release (local)

The viewport hook blurred the composer on touch-down before a transcript pan
could be recognized. Track the press until release; abandon it after movement,
scroll or cancellation. Do not prevent native scrolling or button/link actions.
The local Chromium comparison and limits are recorded in
`ui/screenshots/mobile-chat-scroll/README.md`. No release authorization is implied.
## 2026-10-26 — Show actual Health meal estimates (#1321)

Use server-derived nutrition lists for estimates and proposal presentation, including
protein, calories and fat with units. The lookup description's absolute committed-only
reporting instruction conflicted with its estimate instruction; remove that conflict
and reserve committed-only wording for claims of logging. No production trace proves
which model decision caused the reported symptom. Generic completed tool chips do
not expose nutrition, so successful lookup results also reach the saved conversation
independently of the model's acknowledgment. Keep legacy HTTP compatibility while
advertising Health; do not migrate storage or the separate Daily Assistant service.

## Composer Plus readability (#1319; 26 October 2026)

Follow the clarified bottom-up order: Attach nearest Plus, Voice above it, remaining actions, Language at the top. Keep DOM and visual ordering aligned rather than reversing CSS flow. Reuse the app waveform icon for Voice, with the microphone reserved for Dictate. Strengthen only composer menu blur, retaining the existing translucent fill. Manual native popovers let that blur sample the underlying chat instead of stopping at the composer backdrop root; preserve DOM ancestry, picker anchoring and shared menu behavior.

## 26 October 2026 — Preserve phone composer focus on Send (#1315)

Use a guarded pointer-down default prevention on the existing Send button only
while the phone textarea is focused. The native click remains the sole submit
path. Controlled Chromium reproduced blur, simulated keyboard expansion, dock
movement and a missed click without the guard; with it, focus and geometry stay
stable and one tap submits once. This evidence does not establish physical iOS
behavior. See `docs/ui/screenshots/1315/README.md`.


## Desktop composer parity (#1309; 26 October 2026)

Apply the approved composer geometry and controls to desktop as requested,
including Voice under Plus and Dictate beside Send. Keep the existing isolated
workspace and dock stacking hierarchy: elevate the fixed outer stack, not its
inner child. Do not extend the mobile Chat-only visibility rule to desktop.

## Route-scoped phone composer (#1303; 26 October 2026)

Use the `/` route plus closed Workspaces pane state: the full-width Workspaces
browsing pane is a distinct user-facing screen even though it retains the URL. Hide the phone
typing slot rather than unmounting its conversation/session owner, so drafts and
ongoing turns survive navigation. Disable the chat viewport hook off Chat and
prevent hidden-input focus. Desktop is unchanged. Voice sessions remain mounted; their composer controls
are also visible only on Chat.
Menu remains an overlay and does not hide its anchor composer.

## Continuous draft dictation (#1305; 26 October 2026)

Keep browser dictation toggled on across natural recognition endings and silence,
streaming interim hypotheses into the draft without duplicating finalized text.
Use a fresh recognizer per automatic restart to isolate result indexes and stale
callbacks. Explicit Stop allows trailing results but prevents restart. Permission,
audio/service and unexpected abort errors remain visible and terminal; no-speech
alone is a normal pause. Preserve typed draft edits and keep realtime voice,
composer geometry and colors unchanged. Synthetic verification is separate from
physical iPhone speech-service acceptance.

## 26 October 2026 — Preview controls (#1304)

The owner requested existing app styling for preview controls and removal of Live/camera-direction badges. Reuse shared chrome glass tokens; preserve named switch/close actions and unframed movement. A reported changed preview after switching/typing motivates preserving valid geometry through stream replacement and updating it when playback resumes. The exact private-device lifecycle remains unverified.

## Preserve the native attachment source (#1306; 26 October 2026)

Source inspection confirmed that every More action closed the menu and focused
its trigger before calling its handler. The attachment handler then clicked a
clipped 1px input elsewhere in the form. Keep only the file-input action open,
place its input beside the row, and close on selection after the existing file
handler runs. This preserves native picker choices, cancel/retry, plus toggling,
and unrelated actions without timers or a custom picker. Chromium verifies the
DOM lifecycle and matching input/row bounds; exact iOS popover placement remains
unverified on a physical iPhone. The private reference transfer failed and no
private image is committed.

## 26 October 2026 — Keep recovery within the no-Stop-button scope (#1311)

The recovery draft initially interpreted preserving explicit cancellation as
permission to add a visible Stop reply button. That was incorrect: Dan's P8-35
choice on 5 October explicitly removed that control, and no later authorization
was found. The parent confirmed removal before qualification. Keep the explicit
cancellation endpoint and client mechanism, with owner-only authorization, while
retaining steering and the existing visible controls. Browser-disconnect recovery
is accepted for this scope; process-restart durability is not claimed.

## 26 October 2026 — Preserve accepted chat execution across transport loss (#1311)

Accepted: detach HTTP transport from the existing single execution, retain bounded
SSE replay and discover active turns by original identity. Keep completed replies
in SQL conversation history. Do not resubmit messages, retry meal writes, extend
proposal expiry, or infer approval from reconnection. Explicit cancellation and
shutdown retain the original abort path. This avoids introducing a queue or durable
proposal executor for a browser-disconnect fix. Current deployment has one replica;
restart and multi-replica continuation are outside this change.


## Stable menu material and shared chrome (#1301; 26 October 2026)

Voice-mode follow-up: the typing composer is hidden and its wrapper is
intentionally transparent. Runtime QA found the visible replacement voice bar
still used the old 90% fill/24px blur; it now shares the chrome-glass material.
The header already retained the shared material in voice mode. Actual-room
SwiftShader and synthetic voice-state evidence are in the #1301 QA folder.

Measured in the actual App: mobile menu wrapper and sheet opacity both rose
from partial opacity to 1 while fill alpha stayed constant. The phone cascade
selected 24px blur over the intended 10px; the header retained 90% fill. The
scene already covered the header and dock, so no scene/layout relocation is
needed. Use translation-only menu entrance and shared dedicated chrome-glass
tokens, replacing local overrides of inherited `--surface-translucent`.
The owner's explicit follow-up includes the header and removes selected dock
boxes; preserve ARIA state and visible keyboard focus, highlighting only icons.
Private reference materialization failed; synthetic App pixels were inspected.


## Startup focus is not keyboard evidence (#1299; 26 October 2026)

Actual-App synthetic startup reproduced a focused composer and hidden navigation
with unchanged 844px layout/visual viewports. Existing startup and restoration
effects call focus programmatically. Require observed shrink or a measurable
inset before hiding navigation; keep the earlier height across resize-before-focus.
A fresh short viewport with no prior measurement is ambiguous, so keep navigation
available. Preserve autofocus and existing controls; no physical iPhone browser
mode is inferred from the screenshot. This corrects the focus-only #1295 choice.

## Reserve phone typing space when geometry is inconclusive (#1295; 26 October 2026)

The owner reports navigation still above the iPhone keyboard after #1294.
Equal-height layout/visual viewports defeat the released gap-only detector;
the previous synthetic fixture kept layout height fixed and missed that case.
Use composer focus as a fallback, including already-focused mount, and restore
navigation on focus departure or observed viewport expansion. Do not infer a
particular iOS browser mode or claim physical acceptance from synthetic tests.

## Preview movement and menu glass (#1296; 26 October 2026)

Use pointer capture on the camera video for both touch and mouse movement,
excluding overlay controls and scrollable feedback from gesture initiation.
Keep movement local to the preview, without altering workspace or keyboard
layout logic. Prevent an open plus trigger's pointer press from blurring its
menu before click; then close and restore trigger focus. Scope the requested
transparency to conversation/navigation/menu surfaces, preserving header and
icon colors. These are synthetic-browser-verified choices, not physical-device
acceptance. Private reference downloads failed and no private image is published.


## Dictation stop lifecycle (#1293; 26 October 2026)

An explicit stop is distinct from a failed start. Suppress only cancellation
and no-speech errors during requested stop, retain final text until end, and
ignore callbacks from retired recognizers. Keep genuine failures visible and
leave the unsent draft intact. The owner device error code remains unobserved;
controlled event-order tests cannot establish physical WebKit acceptance.

The same correction implements the owner's explicit space requirements: full-width
message row, second-row borderless icon controls, external errors, no keyboard
clearance for covered navigation, six-item menu pages with three dots, clear
backdrop and shared translucent chrome. The parent/coordinator inspected private
references; this executor could not download them and makes no source-pixel claim.

## Phone navigation and draft-only dictation (#1287; 25 October 2026)

Use the approved dark phone composition with the compact composer above a
bottom Chat/Health/Workspaces/Menu navigation. Workspaces opens the renamed
saved-window pane, distinct from the Software Factory page. Highlight the current
destination by color only; the page sheet uses horizontally swipeable pages and
keyboard Previous/Next controls. Keep message times below bubbles and preserve existing
attachment and visual-capture actions. Voice remains the existing realtime
assistant session under the plus menu.

Dictate is a separate browser `SpeechRecognition` action that appends finalized
transcript text to the persisted unsent draft; it never submits or starts
`BrowserVoiceClient`. This reuses a platform speech API rather than adding a new
backend transcription route. Browser support and permission errors remain
visible; audio processing follows the browser's speech-recognition
implementation, which may use its provider. No new API or storage contract.

## Resolve project references against the active registry (25 October 2026; #1263)

- Resolve explicit project IDs and full repository names exactly; normalize
  display names conservatively and match natural references only against current
  active registered-project candidates. Never select the first plausible match.
- Ask one short natural-language question before a write when the reference is
  ambiguous or absent. A missing project in the active-only list does not prove
  that it was archived; registry read failures remain distinct from project and
  GitHub App permission failures.
- Pin the selected project ID and repository and revalidate them before issue,
  label, comment, task or generic GitHub App writes. Do not fall back from a named
  non-self project, register/unarchive projects or change permissions to make a
  request succeed.
- Keep `create_issue` as the code-change path and reuse existing approval and
  tool replay ownership. This change adds no confirmation, execution or replay
  loop of its own.
- For a one-project clarification, accept only an immediate clear affirmation
  bound to the same verified session and unchanged issue request; ambiguity,
  denial/uncertainty (including replies that also name a candidate), intervening
  replies, changed targets and stale registrations fail closed. A clear named
  selection remains valid when multiple candidates were listed.
  The shared pending-action lifecycle owns clarification reply eligibility,
  expiry, cancellation and one-time selection; selecting a project is not issue
  approval.
  Explicit raw-repository issue comments remain supported without registration.
- **Verification:** synthetic resolver and canonical dispatch tests cover English
  and Danish requests, ambiguity, no-write refusals, permission denial and project
  archive/rename races at factory and GitHub App write boundaries. Provider,
  production and physical voice acceptance remain unverified.

## Base vault-index freshness on successful sync evidence (#1288; 25 October 2026)

Use the vault module's existing synchronization outcome rather than the newest
changed chunk to establish index freshness. This allows a successful no-change
run to refresh evidence, keeps a failed latest attempt degraded, and retains
incomplete embedding coverage as degraded. Report the latest attempt and last
successful sync separately; label `latestIndexedAt` as content-index time only.
The outcome is process-local, so restart or no verified sync reports unknown
until a sync completes. Do not infer success from retained chunks or introduce
new persistence or active model/runner probes. Status-page refresh reads the
existing status endpoint; its check timestamp does not advance sync evidence.

## 2026-10-25 — Share confirmation transitions, retain tool authorization (#1281)

Use `core/pending-action.ts` for exact immutable proposals, later-owner
reply/session eligibility, expiry, cancellation, one-time consumption and
execution. Google, Factory/GitHub and browser owner interactions adapt to it.
Keep SQL browser approval consumption and tool-specific permission, presence
and revision checks; consolidating lifecycle logic must not broaden authority.
Receipt acknowledgments and project clarification are not action approval.
Browser-only proposals have no conversational source binding and cannot be
approved by spoken/text agreement. Preserve #1278's opt-in food-estimate
owner-interactions API and immediate persisted-reply guards, adapting them to
the shared lifecycle rather than creating a second food approval path. Keep
its call-site wiring, language handling and timing work in that PR.
Project clarification (#1264) selects/revalidates a target and does not consume
action approval. Acknowledgment delivery (#1259) does not require affirmative
playback receipts; actual delivery failures and explicit cancellation remain
dispatch stops. These are compatibility constraints, not new product policy.
synthetic regressions verify the boundary; live voice/model/device acceptance
and combined-head qualification are separate.

## Bound deployment-status responses at 4 MiB (25 October 2026; #1267)

The GitHub Actions deployment reader requests up to 100 workflow runs. Allow
4 MiB instead of 1 MiB so the reported 1,215,280-byte response fits with headroom,
while retaining a finite per-request memory bound. Enforce the cap on both the
declared content length and actual streamed bytes; retain the 100-run validation
and 10-second request timeout. Synthetic regression tests cover the reported
size with and without a content-length header, acceptance at the cap, and
rejection/cancellation above it. A lookup error is not a failed deployment.

## Mobile browser food logging is not telephone-call logging (25 October 2026; #1290)

Clarify food tool guidance and trusted runtime instructions, not permissions:
mobile/desktop browser chat and browser voice are supported; actual telephone
calls remain denied. Current runtime context overrides device wording and earlier
refusals, without granting approval. Require the actual `log_estimate` tool call
before inviting confirmation; a prose estimate or lookup creates no proposal.
With no pending proposal, obtain a new confirmation after staging, never reuse
historical affirmative text. Preserve the current shared one-time approval service
on the merged #1282 `PendingAction` lifecycle.

Review follow-up: the blocking tool cannot deliver its invitation after returning.
Publish the exact persisted review through the existing authenticated Now feed
and a session-bound, internal voice presentation event while it waits. Permit
only that food invitation to speak during pending tool work; retain response,
settings, speech and presence gating and discard obsolete queued presentations.
This adds no second confirmation state or authority. #1259 acknowledgement
delivery remains distinct from the estimate/invitation.

Typed-chat review follow-up: an unopened Now popover is not a delivered chat
invitation. Forward the same persisted proposal over the active conversation
stream, bound to its session and source message, and render it in the existing
live bubble before the tool returns. Use plain text and existing reply/steering
controls; retain expiry, withdrawal and shared approval/duplicate guards.
Synthetic HTTP and rendered-client checks verify delivery before a new reply.
Scratch Chromium at 1440px and 390px verified the visible invitation and synthetic
reply receipt without Now, overflow or browser errors; this is not live-provider
or signed-in production acceptance.

Synthetic HTTP and English/Danish WebSocket tests exercise discovery, staging,
public review/invitation delivery, new natural replies and committed receipts
with isolated in-memory storage. Voice fixtures forward synthetic transcript and
audio frames to the browser socket before injecting the new owner reply.
They do not establish live-provider, real-SQL or physical-device acceptance.
The hosted tool catalogue has a 60-second TTL; no browser-cache cause was established.

## Natural food-estimate confirmation reuses one-time browser approval (25 October 2026; #1277)

Only pending `log_estimate` reviews accept the owner's next later reply in the
same text/browser-voice session. Bind the exact summary, source message and
confirmation server-side; use the existing bounded approval interpreter and
one-time persisted consumption. Unrelated or conditional replies remove this
conversational authority; Now remains the fallback. Multiple pending estimates
in one session fail closed. Corrections, deletions and unrelated approvals are
unchanged. Never restage from a yes or claim success before the original tool's
committed receipt.

Use the existing 240-second ingress ceiling for the browser stream and reuse the
210-second food read budget for the backend Foundry reader, leaving hosting
headroom. Keep food's 180-second operation and 120-second approval limits,
and ordinary browser requests' 120-second deadline. Sanitize transport-read
failures and direct the owner to check status before retrying. Synthetic checks
do not establish live provider, microphone, device or deployment acceptance.
## Compact camera preview and attachment menu order (#1265; 25 October 2026)

Keep the existing Camera preview workspace identity and lifecycle, but make the
live video the only visible window surface, use its existing refracted glass rim,
and overlay the camera-switch and close controls. Keep its accessible heading,
workspace commands and media teardown; retain touch-only switching and the
established preview recovery behavior. Use **Enable video** consistently for the
camera-on action. Put **Attach file or photo** first in the typing More menu,
reusing the existing validated upload/picker flow. This does not change camera
capture, permissions, or image-input behavior.
## Generic text questions use an active screen share (#1266; 25 October 2026)

Text submission and turn execution resolve generic English/Danish visual
questions against the active screen share before requiring the camera. Keep
camera-specific wording and active camera-conversation priority unchanged.
Screen inspection still supplies bounded, untrusted context through the existing
chat path; visual asks queue rather than steer without that context. Voice
routing is unchanged. Local tests and synthetic Chromium checks at 390 and
1280 px pass; live display capture and authenticated phone acceptance remain
unverified.

## Research completion is independent of Workspace delivery (25 October 2026; #1237)

After a validated research artifact, its owner-scoped Folio entry, and the
job's durable result reference are saved, the job is complete regardless of
whether a Workspace tab is connected or acknowledges presentation. Persist
delivery separately as pending, unknown, failed or delivered; only an applied
Workspace acknowledgement permits delivered. That acknowledgement means the
client applied the command, not that the owner viewed the report.

Use the existing Folio and job records plus a single stable research view ID.
The owner-only open-result route reuses the Folio reader and Workspace broker;
reconnect/reload offers the existing artifact and never calls the provider
again. Real artifact/Folio/job persistence failures remain failures. This is
the approved delivery-boundary item only; the separate research-concurrency
race is out of scope. Validation uses synthetic data; physical iPhone behavior
remains a separate owner acceptance step.

## Reuse the stream for a natural first reply before tool work (25 October 2026; P9-124 / #1258)

- For a tool-backed request, Jarvis should give one short, truthful first-person
  sentence in the captured conversation language, then continue the same turn and
  deliver the actual result. Direct questions stay direct and do not incur an
  additional model request or artificial delay.
- Keep the acknowledgment an ordinary user-facing intent statement, not internal
  reasoning. Do not claim a check or action has already succeeded, invent an ETA,
  repeat it in the final answer/history, or narrate later tool calls.
- Reuse the existing streamed text and add a typed boundary at the first tool
  handoff. The same model-stream lifecycle serves hosted chat and hosted voice;
  their adapters respectively emit a transient SSE segment and a separate
  `ResponseOutputTextDone` item. The AgentServer transport send orders model
  continuation but has no client/provider speech receipt, so it does not prove
  the user heard the item before tool work.
- Realtime voice uses the same bilingual intent policy through its provider
  adapter. Tool work proceeds after the initial response's terminal event is
  delivered, even if playback confirmation is missing or negative. Explicit
  cancellation/barge-in, required approvals, authorization and genuine terminal
  delivery failures remain authoritative. First tool-only responses and later
  silent tool rounds do not require playback receipts. Browser receipts do not
  prove physical-speaker output.
- Fixtures cover streamed intent before tool work, final result afterward, direct
  turns without a boundary, missing/negative playback receipts, cancellation,
  stale receipts and silent rounds. No live latency or physical audio playback is
  claimed. Owner acceptance remains separate; this task authorizes no merge or
  deployment.

## Simplify proactive controls end to end (24 October 2026; P13-22 / #1252)

- Keep one immediate switch for automatic proactive suggestions and a compact
  ordinary-language summary/editor in Settings; do not expose a category/source
  matrix or build another dashboard.
- Use one backend capability source for the UI examples, the chat/voice help
  operation and the supported preference intent mapping. Reads and changes use
  the owner-bound `ProactiveStore.settings`; only persisted, read-back values
  may be confirmed. Unsupported or ambiguous wishes are not stored as enforceable
  preferences.
- Settings and chat/voice share the explicit-first preference resolver. For
  non-canonical wording, only a single target among existing capabilities can be
  proposed to the bounded preference interpreter; the interpreter must approve
  the exact candidate change. This keeps natural phrasing flexible without
  allowing source/budget edits, unsupported topics or multiple changes.
- The production preference-interpreter prompt explicitly covers pause/resume
  of automatic suggestions and keeps owner-requested reminders separate; source
  management, ambiguity and bare agreement remain refusals.
- Guard Settings writes with a revision of the full existing settings record.
  Preserve budget, cadence, quiet hours, sources, feeds, guidance, authorization
  and other advanced values when changing a preference; a stale write reports a
  conflict and does not erase an unsaved UI draft.
- Pause/source changes cancel in-flight automatic work and the effective pause
  and source policy are rechecked before automatic task writes and push delivery.
  Do not cancel or rewrite explicitly requested reminders. Per-item “Wrong” and
  “Useful” feedback remains per-item feedback, not a lasting learning policy.
- Refresh open Settings and Proactive views immediately after successful
  chat/voice preference-tool completion, and retain focus/reconnect recovery.
  Dirty Settings text is preserved and surfaced as a revision conflict rather
  than silently overwritten. Do not add Health sources, arbitrary preference
  learning, migrations or production setting changes.
- **Verification:** synthetic backend/UI tests cover shared help/state, stale
  writes, UI draft retention/reload, failure handling and pause/source
  cancellation. Database integration, full aggregate checks, browser/device
  behavior and live provider acceptance are reported separately; fixture success
  is not deployment acceptance.

## Workspace content stays within its allocated width (25 October 2026; Refs #1260)

- Wrap repository text by default and provide an accessible “Wrap lines” checkbox
  to restore original horizontal code layout. Keep source text, line numbers,
  highlighted ranges, search marks and link behavior unchanged.
- Let prose and long values wrap in their window. Keep intentional table/chart
  exploration inside named, focusable local regions; show full chart labels and
  retain all source values. Fit images to the frame without distortion.
- Bound only the host container and first-party Jarvis report document. Do not
  claim control over arbitrary external documents, execute them for inspection,
  or weaken the report's scripts-only sandbox, CSP or validated bridge.
- Keep the document from forcing a 280px minimum width below that CSS width at
  high zoom. This preserves the surrounding workspace and foreground-window
  transitions while preventing page-level horizontal overflow.
- **Evidence:** `scripts/check-workspace-content-browser.mjs` reuses the web
  Vite setup with the synthetic fixture in
  `apps/web/browser-tests/workspace-content.fixture.tsx`. It checks 320×700,
  375×812 and 390×844 portrait; 844×390 touch landscape; a 160 CSS px viewport
  at DPR 2; 1440×1000 desktop; a 520px allocated Workspace container; and
  resizing open windows through 1024×900. It checks exact selected-code
  clipboard text, wrapping/original lines, highlights/search marks, local
  focusable table/chart scrolling and values, and verifies chart marks are visible
  at the initial scroll position at each phone width. The 520px capture closes the
  other desktop windows, resets page scroll and checks the README window heading
  inside the viewport crop. It also
  checks page overflow, theme changes, foreground switching and close/reopen.
  Durable captures and the reproduction command are in
  `docs/ui/screenshots/workspace-content/README.md`. Component
  suites cover list/detail/timeline/image renderers and sandbox/CSP/bridge
  contracts; those were not exercised in this browser fixture. DPR 2 is not
  actual 200% browser zoom, and Chromium emulation is not physical iPhone or
  iOS Safari acceptance. Dark mode was exercised but not captured. Voice/chat
  transitions and live services were not tested. Physical iPhone acceptance
  remains with the owner; keep #1260 open until it.

## Owner-requested reminders reuse proactive delivery (#1239; 23 October 2026)

Accepted for the direct owner request in #1239:

- **Keep explicit schedules separate from automatic due reminders.** Persist
  owner-requested schedules with their own time, cadence, repeat-until-done
  choice, state, idempotency key and delivery lease. Never derive or modify the
  task deadline from a requested reminder time.
- **Reuse the existing ticker, Proactive item, push subscriptions and encrypted
  Web Push sender.** A small `owner_requested` item marker bypasses only
  automatic finding category/scope filters. It does not alter proactive
  settings. Suppress an automatic reminder only for the same stable task
  identity within five minutes of an explicit occurrence.
- **Verify task identity conservatively.** Prefer an Obsidian task ID so wording
  and path changes survive sync; otherwise use normalized task text and stop
  when identity is missing or ambiguous. Completion cancels future occurrences;
  dismissing a notification never completes the task.
- **Preserve quiet hours.** Refuse a direct request for a quiet-window time
  instead of moving it without consent. Report provider acceptance separately
  from actual device display or acknowledgement.
- **No activation or default schedule.** Migration 0065 adds durable structures
  only. Schedule creation requires a verified runtime owner request; no
  production settings, owner tasks or schedules are changed by implementation.
  Rollback refuses to discard schedule or explicit-reminder item data.

## Azure budget warning deduplication follows recurring months (#1238; 23 October 2026)

- The ARM budget's `timeGrain: Monthly` defines recurring calendar-month periods;
  `timePeriod.startDate` remains its activation date and is not reused as each
  month's warning key. Use the current UTC `YYYY-MM` for the 80% activity key.
- Keep the existing `budget-80:YYYY-MM` format so an October 2026 warning written
  with the old logic remains the October warning; November and later months create
  distinct rows without rewriting alert history. SQL's unique alert-key index keeps
  polling, restarts, concurrent checks and dismissal from creating another row for
  the same month.
- Reject unsupported budget grains and invalid or future activation dates instead
  of reporting a successful threshold check. The budget amount, resource, threshold,
  polling, ARM permissions and infrastructure are unchanged.
- **Evidence:** Azure [budget tutorial](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets);
  deterministic unit tests and isolated SQL integration coverage. Live Azure
  polling and a future-month production warning have not been verified.

## Shared conversational task writes and versioned note replacement (23 October 2026; #1236)

Use the existing vault task parser and marker-preserving edits in one service
for the Tasks API and chat/voice tools, not a second task store. Existing task
writes require path, line, text and version; ambiguous names must be clarified.
Explicit owner tasks stay in Personal/Work and do not use proactive generation
or Factory rules. Refresh the index after commit and the open panel after a
successful task-tool activity.

Require the blob SHA returned by `vault_read` for replacing an existing note
through `vault_write`. A replacement conflict stops without retry; unversioned
content is create-only. Only append and task line operations can rebase once on
a confirmed conflict. Unknown outcomes instruct a reread rather than a blind
retry. Synthetic checks cover these boundaries; physical iOS/Obsidian sync and
live speech acceptance remain separate owner checks.

## Pace live chat acceptance and retry only rate limits (#1232; 25 October 2026)

- **Decision.** Keep capacity at 150. Pace only acceptance hosted calls at eight
  seconds between starts with at most three active calls, including approval
  follow-ups and retries. Normal chat and retained Status reads are unchanged.
- **Recovery.** Retry a check once only for `rate_limit_exceeded`. Wait a full
  minute after rejection without a hint; use SSE `retry_after` seconds or HTTP
  `Retry-After` when present, bounded to 30–60 seconds. Retry through the same
  queue; the second result is final. Other failures never retry.
- **Evidence.** The 25 October release failed both attempts at capacity 150,
  with four throttled spans each. Thirteen agent calls started in about 2.6
  seconds, and retries within the same minute were rejected again despite only
  about 66K input tokens against a 150K/minute limit. This supersedes the earlier
  wait-and-watch choice below; it does not authorize another capacity increase.
- **Reporting and bounds.** Allow `rate_limit_exceeded` in smoke, aggregate
  canary, log and artifact reasons without retaining provider messages or private
  values. Eight hosted calls / roughly 15 model calls span at least 56 seconds;
  expect 60–90 seconds normally. Use a 240-second suite deadline, 25 seconds per
  active call and a 250-second deploy HTTP timeout within the existing five-minute
  job. Keep the 60-second result cache.
- **Verification.** Fake-timer tests cover spacing, concurrency, retry bounds,
  non-retry failures and named second throttles. Production acceptance remains
  unverified until two consecutive releases pass on their first attempt with
  zero `rate_limit_exceeded` spans checked after each deployment. This change
  does not deploy, merge or close the issue.

## Chat model rate limit raised for live acceptance (#1232; 23 October 2026)

Decided as a reversible rate-limit change that follows the 5 October capacity
decision:

- **`gpt-6-astra` capacity goes from 50 to 150 (Global Standard) in
  `infra/main.bicep`.** Global Standard bills per token, so capacity is only the
  rate limit and adds no standing cost. The subscription quota for this model in
  the account region is 250 units, with 50 in use before the change.
- **Reason.** The live conversation acceptance run sends about 15 Chat model calls
  in one minute, with 57,625 to 66,460 input tokens in the busiest minute, against
  a limit of 50,000 tokens per minute. Foundry Responses API spans for the failed
  checks carried `error.type` `rate_limit_exceeded` (4, 1, 2 and 2 spans in four
  attempts of one release), backend tool callbacks all returned 200, and no other
  model traffic ran in those minutes. Each attempt failed a different pair of
  `chat_*` checks, and earlier releases showed the same pattern with the owner
  session switch off. The run was throttling itself: these were not flaky agent
  checks and not an authentication problem.
- **Not decided here.** Pacing the acceptance chat checks, or backing off once on a
  rate limit, stays a follow-up if the next release still fails. The other
  50-capacity deployments (`gpt-6-luna`, `gpt-6.1-sol`) are unchanged; raise them
  the same way if the Chat model setting moves to one of them.
- **Verify.** The next release applies the new capacity in its infrastructure
  stage before live acceptance, so it should pass on the first attempt with no
  `rate_limit_exceeded` spans. To roll back, set the capacity back to 50.

## Owner session switch enabled in production (#1217; 23 October 2026)

Decided, on the owner's explicit approval on 23 October 2026:

- **Enable `JARVIS_OWNER_SESSION_ENABLED` in production.** The `infra/main.bicep`
  pin and its pin test change from `false` to `true` in one reviewed change. The
  code default stays `false`, so local runs, tests and other environments are
  unchanged. Migration 0064, the backend (#1217), the web client (#1220) and the
  four follow-up fixes (#1222 to #1225) were deployed with the switch off first.
- **Accept the documented residual risks.** The session secret is forwarded to the
  hosted chat agent as its delegated authorization, exactly as an Entra token is.
  Because it lasts days rather than an hour, Foundry retention of the invocation
  body is the main residual risk and cannot be verified from code; a derived
  short-lived delegation token remains the follow-up option. There is no
  Content-Security-Policy by design, so a script-readable token in `localStorage`
  would be exposed to script injection (a report-only policy is a later item). A
  leaked Entra access token can mint a session without a further sign-in step. A
  push endpoint registered with a session survives that session's revocation.
  Limits are per replica.
- **Rollout and rollback.** A device that last tried to mint a session while the
  switch was off waits up to six hours before its next attempt; an explicit Sign
  in clears the wait. Roll back by setting the pin and its test to `false`: from
  the next request every session token is refused, and the next backend start
  attempts to revoke every stored session. Settings and `DELETE /auth/sessions`
  revoke sessions at once without a deployment.

Not verified: minting, restore and revocation on a real device with the switch
on, and Foundry payload retention, remain owner acceptance gates (#1217).

## Web owner-session wake and fallback (#1225; 23 October 2026)

Decided:

- **Cue the work that actually depends on session verification.** Reuse the
  authenticated `GET /database/status` probe and the cold `/me` session restore
  as wake signals after three seconds pending. Do not infer waking from a long
  chat or other API request; keep the existing cue markup and styling.
- **Keep the session-authenticated probe.** Do not acquire an Entra token just
  to poll status. The server verifies the session against SQL before the probe
  can return, so delayed probe and restore are both observable using one shared
  cue state.
- **Bound only when Entra recovery is available.** After about 25 seconds of
  transient session-restore failures, use the existing silent Entra path when an
  MSAL account or prior-device marker is present. Preserve the stored session
  and prefer Entra for the rest of the page load until a session-authenticated
  request succeeds. Without a known account, retain the existing retry loop.
- **Keep revocation confirmation authoritative.** A revoke-all timeout may leave
  the local token stored; the next API 401 still clears it only after a second
  `/me` 401 with that same token. Share concurrent confirmations, and best-effort
  revoke a newly minted session if browser storage cannot save it.
- **Do not lock during an active mint cooldown.** The cooldown already prevents
  a mint, so taking the cross-tab lock first adds no coordination value.

The backend, infrastructure and switch default remain unchanged. Browser tests
use synthetic responses; live Microsoft sign-in and the enabled production
switch remain unverified.

## Close owner-session connections on revoke (23 October 2026; #1223)

The owner-session backend now enforces revocation for already-open privileged
connections, not only the next HTTP request.

Decided:

- Track only session-authenticated `/voice`, `/voice/da`, `/now/events` and
  `/factory/tasks/:id/events` connections in a replica-local registry keyed by
  session id. Each entry holds only the session id and close callback, never a
  token, secret or hash.
- Close matching connections after a successful local revoke; close all tracked
  session connections after revoke-all. Voice uses WebSocket close code 1008 with
  a generic reason; SSE responses end cleanly. Entra connections are not tracked.
- Recheck each distinct open session about every five minutes with jitter through
  a read-only store lookup that does not extend idle expiry or use lookup
  admission. Close only when the session is definitely revoked, expired or
  missing; store errors retain connections until the next check.
- Clear the unref'd timer and registrations during server shutdown. When the
  switch is off, the registry is not composed.

Revocation takes effect on open connections within seconds on the replica that
handles it and within about five minutes elsewhere. Voice and stream route tests,
registry tests with a controlled clock/store, and web voice expiry tests cover the
change; live multi-replica timing remains unverified.

## Revoke owner sessions on off-mode startup (23 October 2026; #1224)

Turning the owner-session switch off stops verification from the next request.
With SQL and the owner id configured, each off-mode process start makes one
background, best-effort call to the existing `revokeAll` store method after SQL
initialization; without SQL, there is no boot revoke. It is bounded to about a
minute and never allowed to delay or fail startup. This may wake a paused
serverless database; it does not poll or retry. A deployment overlap can let an
off revision revoke sessions minted by an on revision, in which case the owner
signs in again. Infrastructure pins the switch to `false`; enabling requires the
owner's explicit approval and a matching pin-test change.

## Health credential and owner-session hardening (#1222; 23 October 2026)

An owner session is revocable and shorter-lived than the 365-day Health upload
credential. Allowing that session to create, rotate or revoke the credential
would let a stolen session outlive its own revocation boundary. The status read
does not reveal a secret and remains available to keep Settings useful.

Decided:

- Only an Entra owner token may create, rotate or revoke the Health upload
  credential. Owner sessions may read its state and expiry; the backend rejects
  their three POST actions before touching the capability store.
- Settings keeps the existing session-first token for status, and obtains an
  Entra token for mutations. If Microsoft requires interaction, the UI displays
  that a fresh sign-in is needed before starting the redirect.
- Treat the exact `js.<22 base64url>.<43 base64url>` owner-session token as a
  secret in every existing content scrubber. Newly created session ids enter the
  verified admission set only after the store write succeeds.
- Keep `JARVIS_OWNER_SESSION_ENABLED` default-off and preserve the Entra-only
  flow when no session is held.

Not verified: live Microsoft sign-in and the enabled production switch remain
owner acceptance gates.

## Web owner-session client (#1220; 23 October 2026)

The backend owner session is now consumed by the web client while
`JARVIS_OWNER_SESSION_ENABLED` remains off by default. The browser change must be
safe to deploy before the switch: 404 on mint keeps the existing Microsoft-only
experience, and 401 from session use must not be confused with temporary
admission or database failures.

Decided:

- **Session first; Entra fallback and only mint source.** Keep
  `useSignIn.getAccessToken` as the one provider used by API, profile, history,
  attachment and voice paths. A valid session avoids MSAL silent renewal and its
  iframe/redirect behavior; Entra is used only when no usable session remains.
  Mint after a successful Entra acquisition in the background so sign-in and
  requests do not wait on session creation.
- **One best-effort minter per device.** Single-flight within the tab and use
  Web Locks across tabs where available, rereading storage inside the lock.
  Persist only nonsecret wait metadata so cooldowns survive tabs and reloads;
  clear them on interactive sign-in. Validate the response before storing it.
  A 404 waits six hours; 401/403 wait one hour; transient 429/503/network
  failures use growing one-to-ten-minute backoff.
- **One origin-scoped storage record.** Keep the versioned backend origin, id,
  opaque token and expiry times in a single `localStorage` key, synchronize
  removal through the existing storage event, and remove malformed or expired
  records. This adopts the script-readable `localStorage` tradeoff already
  accepted in #1217; storage failures preserve Entra-only behavior. Never put
  the token in a URL, DOM, log or error, and send it only to the configured
  backend in the bearer header or voice subprotocol.
- **Confirm verdicts; preserve temporary failures.** Restore a stored session
  with `/me` before mounting panels. Clear a session on 401 only after a second
  `/me` 401 with the same still-current token; retain it on 429, 503 and network
  errors. Retry boundedly with jitter for GET/HEAD temporary failures and any
  method on admission-control 429. Apply the same confirmation to voice failure.
  There is no verdict cache: each request costs one backend database read, so
  the web client must not poll just to keep the session warm.
- **Revoke best-effort on sign-out.** Attempt current-session revocation with a
  short timeout, but always clear local state. Offer all-device revocation in
  Settings only when the device has a session, with explicit confirmation and
  accessible busy, success and error feedback.
- **Keep the dark-switch path harmless.** Do not change backend, CORS, infra or
  enable the switch. A 404 on mint is not repeatedly probed before its wait;
  session 401 after kill-switch disable falls back to Entra.

Not verified: live Microsoft sign-in, the enabled production switch, and a real
device. The accepted database-read cost and script-readable storage risk remain
those recorded in #1217.

## Admission control for session lookups (23 October 2026; #1217)

Review of the owner session found a way for a caller with no credentials to
start database work. With the switch on, any well-formed `js.` token for an
unknown session id reaches the store, whereas a garbage Entra token is rejected
by its signature with no SQL. Each lookup is a database read that also retries
while a serverless database resumes, for up to 90 seconds. A flood of random
tokens could therefore keep the database awake (cost is a stated product
requirement), use up the connection pool and pile up pending requests. The
creation limiter guards only authenticated creation. The repository rule is to
bound external work before authorization, as the Health upload path does.

Decided:

- **Admit before the SQL read, in process, per replica.** The check runs in the
  verifier before the store is touched. Like the creation limiter it counts per
  replica. A shared counter would cost a SQL round trip, which is the work being
  limited, or a new service, for a bound that only has to be roughly right.
- **A budget for ids the replica has not recently verified.** 30 lookups per
  minute, a sliding window, spent last, so a request that a cap refuses uses none.
  A malformed token never reaches it or the store.
- **Caps on lookups in flight.** 8 for unfamiliar ids and 64 for all, so a known
  id cannot queue without limit either, and known sessions keep at least 56 slots
  while a flood fills the unfamiliar lane.
- **A small recently verified set.** At most 32 ids, least recently verified
  dropped first, each kept 30 minutes after its last successful verification. Such
  an id skips the budget and the unfamiliar cap, so chat, Now polling, event
  streams and voice never throttle themselves. An id enters only by verifying
  with its valid secret, so a caller cannot put one there. It leaves on any
  refusal (revoked, expired, wrong secret, another owner or unknown) and then
  falls back to the budget.
- **Still no verdict cache.** The set decides admission only. A recently verified
  id gets the full store read and the constant-time secret comparison on every
  request, so a revocation applies from the next request, as the opaque owner
  session entry below requires. After a revoke, the next request with that token
  is the definite 401 with the reason `revoked`. The revoke path does not edit
  the set: dropping the id at that moment would turn that request into a 429
  during a flood and tell the client nothing.
- **Not keyed on the client address.** `buildApp` sets no trusted proxy, so the
  address is the ingress, and a forwarded header is chosen by the caller. The key
  that cannot be forged is the one the replica verified itself.
- **A throttled request is a 429, never a 401.** A 401 would make a client drop a
  good session. The answer carries `Retry-After` (the time the budget needs, 1 to
  60 seconds, or 5 for a cap), the body `{"error":"Too many requests"}` and no
  reason, in the same family as the 503 for a store outage. The audit reason is
  `throttled`, with no session prefix because no lookup ran.
- **The database wake retry is bounded by the caps, not by a shorter deadline.**
  At most 8 unfamiliar reads per replica can wait in the retry, and the budget
  limits how fast new ones start. A shorter deadline for unfamiliar ids would fail
  the owner's own first request after a restart or a database pause, and the retry
  is shared database code that this change leaves alone.

Alternatives not taken:

- A per-client limit: the address cannot be trusted here, as above.
- A verdict cache with a short lifetime: a revocation would lag.
- A fail-fast read for unfamiliar ids: see the last decision above.
- A token that carries a server-keyed MAC, so the backend could reject a forged
  token with no SQL. It needs a server-held key and a rotation plan that this
  change does not add. Revisit it if the residual risk below matters in practice.

Residual risk, accepted:

- A flood from many places can still use up a replica's budget. A session that
  replica has not verified yet then gets a 429 with `Retry-After` until the window
  slides, up to a minute. Sessions it already knows keep working, and the owner
  can sign in with Entra again, whose tokens never reach the session lookup.
- The budget bounds the load, not the wake-up: a steady stream just under 30 per
  minute per replica can still keep a paused serverless database awake.
- A replica that has just started throttles a burst of more than 8 parallel first
  requests, which succeed on retry. A new session is not pre-marked as verified,
  so its first request spends one unit of budget.
- A token revoked elsewhere and replayed while this replica still holds its id as
  recently verified can start at most 64 concurrent lookups, once, before the
  first revoked verdict removes the id.
- A caller who knows a full session id can evict it from the set with a wrong
  secret, and it then waits for budget like a new session. The id is 128-bit random
  and only its first eight characters are ever logged.
- A 429 against a 401 shows only the state of the budget, not whether a token is
  valid.
- The numbers are per replica, so the totals grow with the replica count.

Not verified here: the tests use an injected clock and an in-memory store, so a
flood against a deployed replica, a paused database and several replicas are not
exercised. The SQL Server integration tests in CI are unchanged.

## Opaque owner session for a 10-day sign-in (22 October 2026; #1217)

The owner asked to stop signing in many times a day on web, phone and localhost.
Microsoft caps refresh tokens for a browser app at 24 hours (#1214 keeps what it
allows), so the backend can now exchange one Entra sign-in for its own revocable
session. This is the backend half. It ships behind `JARVIS_OWNER_SESSION_ENABLED`,
default off, which stops verification at once and triggers a background revoke
at the next process start; the web half is a separate change.

Decided:

- **An opaque server-side token in the `Authorization` header, not a cookie and
  not a JWT.** The static web app and the API are cross-site origins, so
  third-party cookie blocking (Safari and iOS today, Chrome later) would break a
  cookie, and CORS allows only two origins. A self-contained signed JWT could not
  be revoked. The token is `js.`, a 128-bit session id and a 256-bit secret,
  base64url encoded; the server stores only the SHA-256 of the secret. The three
  dot-separated segments let the voice WebSocket subprotocol parser accept it
  unchanged, and the prefix cannot be mistaken for an Entra token, which starts
  with `eyJ`.
- **Lifetimes.** 10 days idle, extended on use at most once an hour so a request
  does not write every time; a 30-day absolute cap, so a forgotten or stolen
  session cannot live for ever; at most 10 active sessions per owner, where one
  more revokes the least recently used. A session cannot create sessions, or the
  cap would mean nothing.
- **Owner only, never a service identity.** A session yields the same plain owner
  principal as an Entra owner token and never satisfies a service route. It is
  also refused on `GET /status/smoke`: that route exists for the deployment
  identity, the web app does not call it, and an Entra owner token is still
  accepted there. To allow sessions there later, remove the one line in
  `auth/hook.ts` that refuses them.
- **No positive cache.** Every request with a session token reads one row, so a
  revocation applies from the next request and there is no lag to document. If
  measured load ever needs a cache, cap it at 60 seconds and invalidate it on
  revoke in the same process.
- **Fail closed, without signing the owner out.** Every rejection is the same 401
  with no reason in the response; the log carries a reason category and the first
  eight characters of the token. A store outage is a 503 with `Retry-After`, so a
  client keeps a good session and retries, and it is never an allow. With the
  switch off the hook has no verifier, so even a row still in the table is a 401;
  the next off-mode process start attempts to revoke active rows.
- **Contract and limiter.** The response shape stays in the backend; nothing is
  added to `packages/contracts` until the web half consumes it. The creation
  limit (5 per minute, 30 per hour) is in process, so it is per replica; it
  guards against a runaway client and is not the security boundary.
- **Rollback.** The down script drops `dbo.owner_sessions`. That is the same as
  revoking every session, so it is safe: the owner signs in again.

Tradeoffs accepted:

- The web client will keep the token in `localStorage`, where script can read it
  if XSS ever happens. The existing Content Security Policy, the owner-only scope,
  the 30-day cap and revocation (one session or all) limit that.
- A disabled Microsoft account keeps working until its session expires or is
  revoked, because verification does not call Microsoft. The switch and
  revoke-all are the controls.
- iOS Safari can purge script-writable storage after 7 days without interaction,
  while an installed Home Screen app is counted separately. A purged device
  simply signs in again.
- The session secret is forwarded to the hosted chat agent as the delegated
  authorization, as an Entra token is, so the agent can verify the owner through
  `/me` and the stored conversation. It is as sensitive as an Entra token for the
  same period and stays out of logs and errors.
- Browser code cannot read `Retry-After` from a 429 or 503 because CORS does not
  expose it; the web half should back off on its own. Exposing the header would
  be a CORS change, which this slice excludes.

Not verified here: live sign-in, the web client, real devices and production
enablement. The SQL Server integration tests run in CI.

## One owner identity across chat and voice (22 October 2026; #1210)

Use one versioned identity contract and owner-editable `identity.description`
across hosted chat, Danish and English realtime voice, hosted voice and reduced
English voice. Keep identity and role separate from tone and response style.
Composition precedence is the fixed truthfulness/security kernel, shared Jarvis
product identity, owner description, style, current mode, then
situational/project context; mode and owner text cannot grant permissions,
override backend policy or manufacture capabilities.

Persist the new description through the existing owner-bound settings store.
Missing values use a broad personal-assistant default and do not rewrite legacy
personality or mode preferences. Carry the contract version and a composition
revision through agent settings. Active voice updates wait for the in-flight
response and provider acknowledgement; stale refresh reads are ignored, and a
failed update or timeout closes the relay for reconnect. “Saved” is persistence
feedback, not provider/device acceptance. Synthetic tests and builds do not
establish live chat, voice-provider or real-device acceptance; keep the issue
open for that separately authorized acceptance.
## Health tool read coverage (22 October 2026; #1197)

Extend the existing sensitive `daily_query` tool rather than add catalogue
entries. Capability version 5 exposes the existing owner-scoped training-target
store only when its reader is composed; version 1–4 source lists stay stable.
`daily_health_summary` uses that same store. Unset values stay null and listed
as missing; zero is configured, and the stored update timestamp is not Health
feed freshness. No target write tool or alternate store is added.

Project retained metric `fields_json`, sleep `source_json`, and minute
heart-rate provenance into allowlisted typed values and at most five source
labels, rather than return those JSON columns. Reuse workout detail summaries
and expose only normalized workout metrics not already represented there. Cap
that additional list at 100 and mark the result partial on truncation; do not
expand the separate pagination work with a new detail cursor.

The source-linked [read coverage matrix](daily-health-read-coverage.md)
distinguishes storage/schema correspondence from actual tool reachability.
Unresolved pinned-source parity and excluded source operations remain ruled by
the existing matrix and owner decisions. Synthetic tests do not establish live
records, production availability, or English-voice tool registration.

## Bounded retained-history continuation (22 October 2026; #1201)

Keep the existing keyset readers and source-specific cursor validation.
Grouped history tools return a scope-bound continuation, not a fetch-all
operation. Health advances one at-most-93-date window/page per call and skips
independently exhausted categories. Nutrition keeps its whole requested
meal-date filter because splitting it into date windows would change the
creation-time order of backdated meals. Page sizes, owner/connector boundaries,
units, byte/deadline limits and the finite agent tool budget remain unchanged.
Retained exhaustion is not evidence of source ingestion completeness; partial
or interrupted reads must be disclosed. Verification uses synthetic records
only; live ingestion/device completeness, merge and deployment are outside
this correction.

## Catalogue count is not a global limit (22 October 2026; #1204)

There is no fixed global tool-count ceiling or reserved-slot requirement.
Counts are not a security control; each tool still relies on its existing
schema, owner authorization, permission and confirmation policy, feature gate,
dispatch validation and audit behavior. The backend and agent retain every
valid descriptor. Existing description limits, the 1 MiB serialized catalogue
and `/tools` response bounds, context/payload bounds, result limits, deadlines,
and finite per-turn/tool-round budgets are unchanged. Smoke-only and voice
advertised-subset behavior remains explicit; a count must never authorize a
tool or silently remove a capability.

The configured routes that can receive tools are distinct:

| Route | Configured surface and repository path | Primary reference | Numeric tool/payload/context maximum |
| --- | --- | --- | --- |
| Foundry OpenAI Responses | Default chat deployment `gpt-5.6-luna`; `responses.create` with the catalogue's `tools` in `agents/jarvis/model_client.py` (`responses_base_url`, `model_client.py:240-263,1005-1017,1094`). | [Azure AI Foundry Responses API](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/responses) | Unknown for this route/model. |
| Foundry Anthropic Messages | Claude-prefixed selected chat models; `messages.stream` with converted tools in `agents/jarvis/model_client.py:279-292,1018-1035`. | [Foundry Anthropic models](https://learn.microsoft.com/en-us/azure/ai-foundry/foundry-models/how-to/use-foundry-models-anthropic); [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) | Unknown for this route/model. |
| Azure Voice Live | English `gpt-realtime-2.1` / `gpt-realtime-2.1-mini`; `session.update` in `apps/backend/src/voice/realtime.ts:237-291`, connected by `apps/backend/src/voice/relay.ts`. The configured API version is `2026-07-15`. | [Voice Live](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live); [Voice Live API reference](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-api-reference-2026-06-01-preview) | Unknown; the linked preview reference is not the configured API version. |
| Foundry hosted Voice Agent | Danish route `/agents/jarvis-voice-mai/endpoint/protocols/voice`, `api-version=v1`, `VoiceAgents=V1Preview`, in `apps/backend/src/voice/relay.ts:314-341`. | [Voice-first hosted agent](https://learn.microsoft.com/en-us/azure/foundry/how-to/voice-first-with-hosted-agent) | Unknown for this distinct route. |

These links identify route-specific primary documentation, not proof of a
particular maximum. Direct retrieval of current provider documentation was
unavailable during this review, so no numeric per-request definition, payload
or context limit is marked verified. Do not project a Chat Completions limit
onto Responses, Anthropic Messages, Voice Live or the hosted Voice Agent. The
historical #1188 full/subset startup probes are diagnostic observations, not a
provider ceiling; its bounded fallback and advertised-subset checks are
unchanged. No live paid/provider probe was authorized or performed. Provider
acceptance remains open; if a route-specific restriction is later verified,
enforce it at that request/session boundary with capability-preserving
discovery or an explicit failure, never silent pruning.

This decision supersedes only earlier count ceilings and eight-slot reserves,
including L131's recommendation to merge tools to remain below 128 and its
unverified claim that 128 is a model API maximum. L131's observed historical
application rejection remains useful evidence; its count-based remedy does not.
This decision does not approve new tool capabilities such as assistant writes
to Daily training targets, and it does not relax the safety or
bounded-execution rules.

## Tasks are edited in place: words, date, time and priority (23 October 2026; #1085)

The owner asked for an edit pencil at the top right of a task row with inline editing,
then said a one-line field is unusable and that date and priority must be editable too.
The row now opens a wrapping, auto-growing text area with a date, a time and a
Normal/Medium/High choice, saved with Enter or the Save icon. Edits go through a new
`PUT /vault/tasks` so that `PATCH /vault/tasks` stays tick-only. The route uses the same
version check as a tick (409 before any write) and changes only what was sent: the words,
the due date and time markers, and the priority marker; other Dataview markers and the
checkbox stay as written. Clearing the date clears the time; a time without a date means
today. The result is re-parsed and refused unless text, tick state, date, time and
priority read back as intended. Completed rows have no pencil. The backend must deploy
before the web client, which would otherwise call a route that does not exist yet.

## Ticking a task proves the line is unchanged (22 October 2026; #1085, #1216)

`PATCH /vault/tasks` compared only the visible text of the line, so a reordered file or a
line whose date or priority changed between read and write could tick the wrong task
without a conflict. Each task now carries an opaque `version` (SHA-256 of the exact raw
line). The write requires it and answers 409, before anything is written, when the line
no longer hashes to it; a missing or malformed version is a 400. Responses return the
line's new version, which the web client reuses for Undo. Separately, the All task view
names Personal or Work in words on each row, since two Inbox notes read the same and
colour alone must not carry scope.

## Notes map shows note categories only (22 October 2026; #1085)

On the owner's request the Notes map lists and draws only the note categories (People,
Work, Personal, General). Notes in the vault root or in system folders (`_agent-log`,
`Templates`, anything else) are dropped in the browser when the graph loads: no stars,
links, search matches or legend entries, with link counts and the Tasks count recomputed.
The vault and the backend response are unchanged.

## Persistent Microsoft browser sign-in (22 October 2026; #1214)

The owner requested one sign-in per device rather than repeated sign-in in new
tabs, browser restarts, the installed phone app and the fixed localhost dev
origin. This supersedes the cache-in-session-storage part of P0-09: MSAL now
uses `localStorage` to share its cache across tabs, with an identity-free
device marker, silent SSO and a five-minute cooldown for one automatic
top-level redirect. Account selection is reserved for the explicit
**Use a different account** action; Settings provides **Sign out**, which
clears the MSAL cache and marker.

This does not create a Jarvis session or extend Microsoft tokens. SPA refresh
tokens have a fixed 24-hour lifetime. Persistence across a full browser restart
depends on the Microsoft session and its **Stay signed in** choice; since MSAL
v4, the local cache's encryption key otherwise lives in a session cookie.
Conditional Access can shorten the experience. The owner ticks **Stay signed
in** once per device; live web, phone and localhost acceptance remains
unverified until the owner checks it.

## Azure Speech partial-recognizer token configuration (22 October 2026; #1190)

Construct the custom-endpoint `SpeechConfig` with `SpeechConfig.fromEndpoint(endpoint)`
without an auth argument, then set `authorizationToken` and the selected `da-DK` or
`en-GB` recognition language. The installed SDK rejects an empty-string auth
argument even though its typings describe that usage. Keep Azure Speech optional:
startup or cancellation failure remains visible as `voice.partials_unavailable`
and does not disable Voice Live final-transcript handling. Existing reflex
confidence, completion, confirmation, target, authorization, audit, duplicate and
final-reconciliation checks remain unchanged.

`npm test --workspace @jarvis/backend -- --run src/voice/speech-recognizer.test.ts src/voice/relay.test.ts`
passed all 194 tests (11 recognizer and 183 relay). The recognizer tests exercise
the installed SDK's Danish/English config, recognizing and canceled event
objects, blank hypotheses, startup failure and abort cleanup. The relay test
`relays an installed SDK recognizing event into the partial reflex path` proves
the callback reaches the existing partial action and increments its metric.
Backend build and lint also passed. The network start/stop callbacks were
simulated; these checks do not prove acceptance of a live microphone or Azure
provider session. The spoken-session acceptance in the runbook remains pending
a separately authorized deployment.

Refs DanAakesen/jarvis#1190.

## Deadline notification details (27 October 2026; #1335)

The owner approved correcting generic deadline notification lines to show task
names and deadlines. Deterministic findings now use the bounded task name as
their stored title; bundled alert lines include the existing Copenhagen due-time
label. The ordinary finding upsert refreshes recurring generic records without
a migration. Item identity, states, alert ledger and delivery policy are retained.
Only stored titles and due times enter the encrypted payload; source bodies and
private telemetry remain excluded. Physical iPhone appearance remains unverified.

## Push notifications carry bounded details (22 October 2026; P13-21 / #1194)

The owner confirmed that proactive todo reminders and alerts should say what
they concern. This supersedes the generic-push/no-todo-or-finding-text rules in
P13-01, P13-02, P13-12, P13-13 and the P13-15 rollout below. Delivery policy,
quiet hours, caps, deduplication, the alert ledger and retries are unchanged.

The backend composes final Danish/English v2 headlines and bodies from up to
three todo or stored-item titles and Copenhagen due times, plus an overflow
count. Titles are capped at 60 code points, bodies at 240 and each line at 80;
controls are removed and truncation uses an ellipsis on a code-point boundary.
Alert detail reads must not mark an item loaded or seen; unavailable details
fall back to the count headline without dropping the alert. The worker clamps
v2 text defensively and uses generic headlines with empty bodies for legacy
payloads, preserving existing notification tags, data and click behavior.

Our notification title must never be `Jarvis`. iOS adds `from Jarvis` from the
Home Screen app name; a web app cannot remove or change that line. Payloads are
already encrypted end to end to the device with `aes128gcm`, so the push service
cannot read them. Details will be visible on the lock screen unless the owner
hides previews in iOS Settings → Notifications → Jarvis → Show Previews.
Todo and finding text must still never enter logs, metrics, errors or job
output, and the payload must not be stored.

The test push uses fixed, content-free text: `Test notification` /
`Push notifications are working on this device.` Real-device appearance is
unverified until the owner uses the existing Settings button after deployment.
CI cannot establish iOS lock-screen appearance.

## Vault mirror write-back switched on (22 October 2026; #1083)

Refs DanAakesen/jarvis#1083, Refs DanAakesen/jarvis#1084.

Both conditions of the entry below were met on the morning of 22 October: the
fixed image from #1192 was running (first run on it at 06:30 UTC) and the
affected note on GitHub had been restored. The runs at 06:30 and 06:40 UTC in
`dry-run` were stable, with no growth and no guard trip, and the owner asked for
two-way sync, so write-back was switched on at 06:45 UTC. The cap was set to
three changed files for the first runs, so that one unexpected bulk change could
not rewrite more than three Obsidian files; deletes stayed at three. The
repository variables and the job's environment were set together, because the next
Deploy re-applies the variables and resets the schedule, and both hold the same
values.

Evidence: the first run with write-back on (06:50 UTC) wrote one note to
Obsidian, uploaded it and cleared its pending record, with no deletions. The next
run (07:00 UTC) wrote nothing, so a written note does not echo back. At 07:04 UTC
another writer committed a repair to the vault repository's default branch that
removed a duplicated task fragment the old merge defect had left in the same note;
the run at 07:10 UTC wrote that change to Obsidian once, and the run at 07:20 UTC
wrote nothing. The cap went back to the default of 25 at 07:16 UTC. A written
note is checked by hash in the working copy, but only a second device shows that
an upload reached the Obsidian service.

One other note, written by Jarvis, still has an edit conflict that began on
21 October 16:40 UTC. While it exists each run ends `needs-attention`, the Status
page says so and Azure lists those executions as failed. The existing 24-hour rule
resolves it in Obsidian's favour at about 16:40 UTC on 22 October, replacing the
GitHub version; earlier versions stay in the repository history.

Two plan conditions were not met as written. P14-30 keeps the caution cap until
one clean day has passed and expects a first dry-run with zero conflicts. The cap
went back to 25 after three runs because exceeding a cap aborts the whole run: at
three, an ordinary burst of phone edits would stall sync in both directions, while
a trip never writes, and earlier versions of every mirrored note stay in the vault
repository history. Across the 280 runs that logged a summary since 20 October the
largest push was four files (once) and no run wrote more than one file back, so a
cap of three would have aborted that one ordinary run. The zero-conflict condition
failed because of the one edit conflict above, which predates write-back and is an
ordinary overlap of edits. The cap can be lowered again by changing the repository
variable and the job's environment together, then dispatching Deploy.

The scheduled task on the owner's computer was unregistered at the owner's request
on 21 October, before the three clean days planned in P14-31 and instead of the
planned disable-first step, so the mirror is the only vault sync route. If the
mirror misbehaves, set write-back to `dry-run` in both places (uploads to GitHub
continue and Obsidian is no longer written) or pause the job's schedule in Azure to
stop every run. Re-registering the desktop task, if ever wanted, is a manual step
on the owner's computer. #1083 and #1084 stay open until two-way sync has run clean
for a full day.

## Vault mirror line merge repeated content and was not idempotent (22 October 2026; #1083)

Refs DanAakesen/jarvis#1083, Refs DanAakesen/jarvis#1090.

With write-back in `dry-run`, the mirror still uploads clean merges to GitHub
but never advances the base or writes Obsidian, so the same three-way merge is
recomputed every ten minutes from an unchanged base. One private note that had
been edited on both sides grew by 38 lines on every run from 21 October 17:10
UTC until the job was paused on 22 October 05:24 UTC, repeating its frontmatter,
headings and tasks about 140 times. Replaying the six consecutive bot commits
through the previous merge reproduced their sizes exactly.

Two defects in `src/runner/merge.ts` caused it. First, the edit script gave a
pure insertion that followed unchanged lines a stale end position before its
start, so the output cursor moved backwards and earlier base lines were emitted
again. The existing unit test only used replacement edits and could not see it.
The stale end also hid overlap, so two insertions at the same place were merged
as independent and both were duplicated. Second, an insertion touching the end
of the other side's replacement counted as independent while one touching its
start conflicted. After the first merge such a pair re-diffs as a single hunk,
so a retry applied the insertion again, which broke the README contract that a
retried merge is idempotent.

The merge now records an explicit start and end for every edit, refuses to merge
when either side's edit script cannot rebuild that side exactly, and treats
edits that overlap or touch as a conflict. Edits separated by at least one
unchanged base line still merge, identical edits count once, and the result is
the same whichever side is ours. Two insertions at the same place, for example
two tasks added at the top of one list, now conflict instead of being ordered
arbitrarily, and the existing 24-hour rule resolves them in Obsidian's favour.
A union merge of same-place insertions was rejected because it is not idempotent
while the base is stale, which is the case in `dry-run` and after a partially
applied write-back.

Review found a third case. When ours inserts a copy of lines that already sit
beside the insertion point, diffing the merged text again can align the repeated
lines differently, so a retry sees the copy as a new edit and applies it a second
time. The merge now trusts a clean result only when retrying either side against
it (ours with the merged text, and the merged text with theirs) reproduces the
same text, and reports a conflict otherwise. The check costs one extra diff of
the merged text. Some merges of notes with many repeated lines now conflict where
they were previously combined, and the 24-hour rule resolves those in Obsidian's
favour; that is safer than a merge that changes when it is repeated.

Evidence: the regression tests cover a task-shaped note, the review's
counterexample, every pair of single edits over a repeated-structure note and over
a note whose edits copy repeated lines (symmetry, no repeated or dropped line,
retries reproduce the merge exactly), and a runner test that runs `dry-run` three
times and then write-back on. Randomized replays of the real merge over
repetitive notes (150,000 pairs, and 400,000 pairs with copied-line insertions)
found no repeated line, no lost line, no asymmetry and no retry that changed or
refused a clean merge. Without the stability check, about 5% of retries over
100,000 of the copied-line pairs changed or refused the merge.

Still open: in `dry-run` a stable merged note is committed to GitHub again on
every run with an identical tree. Skipping unchanged blobs is a follow-up.
Write-back stays in `dry-run` until the fixed image is deployed and the
affected note on GitHub is repaired. Both conditions were met the same morning;
see the entry above.

## Historical English startup measurement (21 October 2026; superseded 25 October)

Refs DanAakesen/jarvis#1184, Refs DanAakesen/jarvis#1177.

The 21 October production measurement showed that an R0 frame (122 tools,
129,098 frame bytes) stalled at 8,001 ms while the then-current R1 frame (111
tools, 107,755 frame bytes) became ready in 1,341 ms. These are historical
observations, not proof of a provider limit or the readiness of today's frames.
The English-only rung ladder and its background probes were subsequently
removed. The 25 October correction uses direct full-registry schemas followed
by a capability-preserving discovery representation for both Voice Live
languages; see the current decision below.

## Route proactive tasks to Personal/Work and exclude project work (21 October 2026; #1186)

P13-20 replaces the suggested-todo destination and selection behavior from
P13-11/#931 and P13-15/#936. Preserve proactive observations, alerts and
reminders, but create a task only when its scope and source/action identity are
known safely. Exclude Factory evidence and software-project, pull-request,
build/check and engineering follow-up suggestions using both task text and all
cited source facts, independent of source or finding category.

Route clearly Personal and non-project Work tasks only to the corresponding
existing `Personal/Inbox.md` or `Work/Inbox.md`. Do not create a file or use root
`Task.md`/`Tasks.md`; do not append to, migrate or otherwise change any existing
`Suggested by Jarvis` section. If scope, stable source identity, destination or
writability is uncertain, do not write and retain the finding with a
content-free reason.

Every new proactive task is a native checkbox whose visible text begins exactly
`(proactive)`. Hash stable source/action identities into existing receipts and
markers, excluding observation time, elapsed time, model wording, finding
category and destination. Check both inboxes and existing root task files for
duplicates; preserve durable receipts after completion/removal and existing
legacy receipts/markers. Keep the caps, pause/source gates, bounded add-only
writes, conflict retry and recovery. Ordinary user-requested task creation,
07:00/18:00 Copenhagen cadence, catch-up and quiet hours remain unchanged.

Refs DanAakesen/jarvis#1186

## Historical English tool-budget fallback (21 October 2026; superseded 25 October)

Refs DanAakesen/jarvis#1177, Refs DanAakesen/jarvis#1153, Refs DanAakesen/jarvis#1182.
Production logs from 21 October showed nine English sessions in which Voice Live
accepted the socket and sent `session.created` but did not answer the then-current
122-tool, approximately 129 KB `session.update`; Azure Monitor showed nine
`onHandshake` calls and no `VoiceLive_SessionDone`. That incident motivated
bounded recovery, but did not identify a tool-count, schema-size or context
limit.

The English-only reduced catalogue and fallback ladder described in the
historical implementation were replaced on 25 October. The current recovery
preserves the canonical registry: both Voice Live language paths try full direct
schemas, then compact paged discovery and guarded dispatch over the same
registry. See the current shared capability decision below. Production
responsiveness still requires an owner browser voice attempt after deployment.

## Historical readiness-gated Health access (22 October 2026; superseded 25 October)

Refs DanAakesen/jarvis#1184, DanAakesen/jarvis#1177.

This interim approach made Health access conditional on Voice Live accepting a
Health-capable full frame or a background probe/update. It is superseded by the
25 October shared discovery transport, which retains access to the canonical
catalogue during bounded fallback and requires no active-session promotion.
The production Health workflow and its approval boundary are unchanged; a live
owner verification is still required.

## Capability-preserving Voice Live discovery for Danish and English (25 October 2026; #1188)

Refs DanAakesen/jarvis#1188.

Both Danish and English browser Voice Live paths use the canonical backend tool
registry. R1 advertises its full configured schema set directly. If startup
times out, errors or closes before readiness, R2 advertises bounded paged
discovery and execution wrappers backed by that same registry. Discovery pages
are limited to eight schemas and 1 MiB; execution requires prior discovery and
delegates to the existing realtime validator/dispatcher. The transport does not
maintain a reduced capability whitelist or a second approval policy.

Only a provider-acknowledged `session.updated` selects a representation for the
current session and process-local reconnect memory. There are two bounded
attempts on fresh sockets, no background probes, and no active-session
promotion. If discovery cannot return a schema within its bound, it reports an
explicit error rather than silently dropping it. Danish hosted-agent fallback
retains its provider-owned configuration and readiness contract, distinct from
Voice Live.

Direct exact/favourite food logging and the browser Now review for estimates and
corrections remain unchanged; spoken agreement is not approval. The same
backend authorization, validation, identity and session-isolation logic remains
authoritative. Local synthetic tests cover real relay selection, compact
discovery/dispatch and food approval/denial, but do not establish live provider,
browser-audio or physical-iPhone acceptance. The 21 October timings remain
historical evidence only and do not prove a provider schema or context limit.

## Notes Tasks panel: tick to complete with Undo, quick add to Inbox (22 October 2026; #1085)

On the owner's request the Tasks panel can complete tasks and add them. Ticking is
optimistic: the row stays for about four seconds with an Undo pill, so there is no
confirmation dialog, and a failed write rolls the tick back with a visible message. **+**
opens one bordered add block (text, Personal / Work, optional date and time pickers; a time
alone means today). New tasks go to
`Personal/Inbox.md` or `Work/Inbox.md` instead of guessing a note. The backend gains
owner-only `PATCH` and `POST /vault/tasks`; each write is SHA-checked, refuses a line that
changed since it was read, and is one vault commit. This supersedes the read-only wording in
the entry below and in earlier P13-19 notes for the panel; the chat and voice `vault_search`
tool stays read-only. Shipping needs a backend deploy as well as a web deploy.

## Notes Tasks panel: due-date list, Personal / Work switch, no refresh (22 October 2026; #1085)

On the owner's request the Tasks panel on the Notes page lists open tasks by due date only.
Completed tasks are not listed; they appear (under Done) only while a search is typed, so the
panel asks for `state=open` and switches to `state=all` for a non-empty query. A three-way
All / Personal / Work switch replaces the Completed toggle; All is the default so nothing is
hidden without a choice, and the switch is full width with 44px targets on a phone. The split is
made in the browser: Work is a `Work/` path, or, for the root task file, a heading starting with
Work; everything else is Personal. The refresh icon, the read time and the priority star are
removed; high priority is a small tinted "High" pill (word plus tint). Retry stays on the error
state. No backend change.

## Bound voice startup and summarize every session (21 October 2026; #1177)

Refs DanAakesen/jarvis#1153. Accepted upstream WebSockets were followed by no
readiness event and no useful relay diagnosis. Keep the existing payload and
permissions; do not assume undocumented tool/schema limits or provider degradation
caused the production stall.

Use separate 15-second upstream-connect and readiness watchdogs. Readiness matches
the client: English `session.updated`, Danish `session.created` or `session.updated`,
including the realtime Danish route. Close with application code 4010 and a fixed
retry message without waiting for session persistence. Bound settings/catalogue,
away-mode and project-context reads to five seconds with existing defaults, and
session creation to ten seconds with connection failure. Ignore late read results;
end a session created after its caller disconnected rather than leaving it active.

Record request-relative stages and exactly one terminal `voice.session_summary`
outside cancellation/end-request log gates. Only fixed stage/event vocabularies,
server-owned tool names, counts, serialized UTF-8 sizes and timings are exported.
Explicitly report failed/not-open sends rather than silently discarding them.
Socket-send completion is not a service acknowledgement.

No applicable numeric Voice Live schema size, nesting, keyword, description,
tool-count or combined instruction/tool-context limit was verified for this API
version. Microsoft's [SDK contract](https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/voicelive/azure-ai-voicelive/azure/ai/voicelive/models/_models.py)
documents `session.updated` as the update acknowledgement; SDK types do not
establish unlimited server acceptance. No speculative payload reduction is made.
Fake sockets/timers cover normal, silent, connecting and early-close paths,
fallbacks and privacy filtering. Production cause and acceptance remain open
until the owner makes a real attempt after deployment and inspects its summary.

## P14-58 — Health pages live in the shell sidebar, not in a row on the page (21 October 2026; #1116, #1175)

The owner asked for the row of section tabs on the Health page to go, and for the pages to
be listed in the sidebar that opens from the Health icon in the rail. Choices: (1) the
area publishes its own page list to the shell (`area-sections.ts`), so the list stays
filtered by the capabilities the backend serves and is not duplicated in the shell; (2) the
sidebar lists them as links in a labelled navigation landmark, the current one marked with
`aria-current="page"`, and shows a loader until the list is known instead of a list that
changes; (3) a pick closes the panel and moves focus to the page, as every other area's
sidebar already does, and the owner can have it stay open later if wanted; (4) selecting
the rail icon of the open area toggles the panel and keeps the page the owner is on,
instead of reloading the first page; (5) phones have no rail, so the "Go to" sheet lists
the same pages indented under Health; (6) the page address, `?section=<id>`, is unchanged,
so links, back and reload still keep the page, and nested switches (Nutrition views, Body &
sleep views, Health panel tabs) stay tabs; (7) a press outside the open sidebar closes it, as
a rule of the shell sidebar and not of any one panel: it applies to the area navigation and
to the Folio alike, but only when the press both starts and ends outside the panel and the
rail, so a resize drag or a cancelled touch never closes it. No read, endpoint or backend
change.

Follow-up, same day, on the owner's request: the "Hey <first name>" greeting is gone from the
Health header and `daily/greeting.ts` with it, along with the `profileName` prop that only fed
it, so the profile name no longer reaches any area. The header instead shows the name of the
current page ("Overview", "Workouts" and so on, from the section label, "Health" while the
list is still loading) as the page's `h1`, in the shared title size, beside the freshness
pill; `--type-health-display` is removed because nothing uses it. The freshness pill is
smaller (12px text, a slimmer pill, a smaller dot and info icon); its label, dot colours and
"Last sync" panel are unchanged. The Overview period is no longer a row of pills above the
cards: it is a dropdown (a native select named "Overview period") at the end of the Training
card header. It is still one shared choice that drives the Training, Health and Body cards,
so the Overview shows one period, and the Overview section still has no period control of its
own above the cards.

Second follow-up, 22 October 2026, on the owner's request: the Overview period dropdown moves
from the Training card header to the end of the page title row, level with the page name, and
the freshness pill moves to a status row above the title, aligned to the right, and gets much
smaller (11px muted text, no outline until it is hovered, focused or open, a 1.5rem target,
smaller dot and icon; the outline returns under `prefers-contrast: more`). The page owns an
empty slot in the title row and publishes it through a React context; `TopCards` keeps the
period state and portals its select into the slot, so the page stays ignorant of Overview
internals, and a section mounted without a title row renders the select in place. The title
row keeps the height of a control, so the dropdown arriving never moves the page. The
Overview tile "Lean mass" is renamed "Muscle mass" (the internal key is unchanged); the
Body & sleep metric label "Lean body mass" is left as it is until the owner asks for it.
Same day, after review: the first pass left too much space above the status and title and the
dropdown did not match the title row, and a second pass made the dropdown too big. The page's top
padding is now `--space-3`, the status row is as tall as the pill (the wrapper is a flex box, so no
extra line box), and the dropdown is a compact field: the shared 38px field height, 14px text
(set through `--type-body` on the select, because the shared field rule sets the whole font
shorthand with a specificity a class rule cannot beat) and a fixed 7rem `width` (the same rule also
forces `min-width: 0`), centred on the title row. The pill's right margin is slightly negative so
its icon, not its padding, lines up with the dropdown's edge.

## P14-55 — Training targets have one shared read (20 October 2026; #1116, #1155)

The owner-set gym, run and step targets (P14-45) are read once per visit to the Health
area and shared by every view that compares against them: the Overview Training card,
the Health panel, the Workouts rings and the Rules & sources editor. Choices: (1) the
read starts only when a view needs it, so a section with no targets never asks; (2) a
failed read says "Targets unavailable" and never "No target set", which is reserved for
a successful read with an empty field, and a configured 0 is a real target that reads
"of 0" or "0 sessions" in every view, never "No target set" (a ring with no target and
a recorded value offers the Settings link, and a target of 0 draws no division);
(3) the Rules & sources editor shows the shared read instead of reading again: it
starts from the shared state, refreshes from it while the owner has no edits in
progress and hands the server's answer to every save back to it, so the cards update
without a reload, and a save cancels any read still in flight so a late answer can
never replace a newer save; (4) the global Settings editor, which sits outside the
Health area, keeps one read of its own and the next Health visit picks its save up;
(5) a read that is not served at all offers no Retry, because retrying cannot change
it.

## P14-46 — Overview cards report a failed refresh and keep honest figures (20 October 2026; #1116, #1143)

Review of the Overview cards found five places where a card could read better than
its data. Choices: (1) a read that fails after returning values keeps them and adds
"Could not refresh" with Retry in the card header, which already reserves its height,
so the failure is visible and recoverable without a skeleton or a layout change;
(2) a per-day average divides the known amount by every logged day, so a day without
the nutrient keeps it a lower bound (80 g and one unknown day is 40 g at least) and
the calorie bounds follow; (3) a body trend uses the latest reading's unit only, so
units never mix; (4) last night's sleep stands in only for Today, and Yesterday or
another single past day needs an exact date match or reads "Not recorded"; (5)
Calories and Duration keep separate lower-bound flags.

Refs #1116, #1143

## P14-56 — Health follows the original look (20 October 2026; #1116, #1155, #1156, #1157)

The owner reviewed the rebuilt Health pages and ruled that they must look like the
original Daily app: the neutral, flat bordered panels do not match it. This
supersedes "original components, Jarvis styling" of P14-41, and its rule that Health
adds no Daily-only skin or tokens, for the Health area only. The rest of the
application keeps the shared Jarvis design language.

Unchanged: Health stays one page with sections and is called Health wherever it is
visible; the recorded non-migrations stay out (task, habit and countdown surfaces,
meal plans and the live meal coach, coaching and recomposition automation, the widget
and football); no interface is shown on synthetic data; loading, not set, not
received, unavailable and error states stay visible and distinct; card heights stay
stable; AA contrast, 44 px targets, keyboard focus and reduced motion still apply, and
meaning never rests on colour alone.

Changed: Health gets its own look from documented, Health-scoped tokens, with a light
counterpart at AA contrast. It is delivered in three steps: P14-55 connects the
owner's training targets to every surface that shows them, P14-56 builds the shared
look and applies it to the header, overview cards and Health panel, and P14-57 applies
it to the other sections. P14-52 is built in the new look after P14-56. The comparison
source is the owner's private reference set, which is never committed.

Documented tokens (P14-56). The look lives in one stylesheet, `daily/health-look.css`,
whose custom properties are declared on the Health shell only and swapped for the dark
theme, so light and dark share one structure and nothing outside Health changes:
type (`--type-health-figure`, `-ring`, `-micro`; the display size was removed in P14-58); surfaces
(`--health-page`, `-glow`, `-edge`, `-tile`, `-tile-edge`, `-disc`, `-popover`, the
three card gradients `-card-training|health|body`, `-card-shadow`); ring tracks
(`--health-track`, `-track-strong`); selection (`--health-selected-bg`, `-bg-hover`,
`-fg`, `-edge`); and class colours (`--health-gym`, `-run`, `-activity`, `-protein`,
`-flame`, `-heart`, `-body`, `-amber`, `-ok`, `-pending`, `-dot-active`). Radii, spacing,
motion and the remaining type sizes still come from the shared Jarvis tokens. Section
tabs and period choices are a deliberate Health-only exception to the shared control
contract: they use pill geometry (`--radius-pill`) and the Health selection tokens
instead of `--radius-control` and `--state-selected-*`, because the owner's reference
shows them that way; other areas are unchanged. The
gradient and glass are surfaces only: numerals and text are solid colours, class colour
always comes with an icon and a word, and the `prefers-contrast: more`,
`forced-colors` and reduced-motion branches flatten or remove the glass and motion.
Measured contrast of the overview text is at least 4.5:1 in both themes. This replaces
the "no separate skin" wording in `PRODUCT.md` and `DESIGN.md`; it narrows it to "no
second shell, window manager or voice, and no Health token outside the Health area".

Other sections (P14-57). Workouts, Nutrition, Body & sleep, Briefs, Data and Rules &
sources take the same look from a second stylesheet, `daily/health-look-sections.css`,
imported right after `health-look.css`. It adds no token: it reuses the documented
`--health-*` and `--type-health-*` properties and the shared radii, spacing and type
roles. A section's lead block is a glass card (Workouts Training, Nutrition today and
trend, Body & sleep measurements and last night), lists and records are panel cards
(Workouts inventory and history, Nutrition meals, the nights, Briefs, Rules & sources
groups, Data records), and figures sit on the dark tile. Class colour (Gym, Run,
Activity) tints a card, a ring or a history glyph only together with its word and an
icon. Actions in these sections keep the shared control radius; pill geometry stays the
Health-only exception for tabs and period choices recorded above. The change adds decorative, `aria-hidden` icon chips to headings and `data-class`
or `data-metric` attributes for styling; reads, values, states, section ids and fixed
heights are unchanged, and the waiting lists and calendar agenda stay with P14-52.

Refs #1116
Refs #1155
Refs #1156
Refs #1157

## P14-51 — Serve Health attention and calendar feeds behind a flag (20 October 2026; #1133)

Read-only Gmail attention and bounded calendar reads are composed only when both
the existing Health module and `JARVIS_DAILY_FEEDS_ENABLED` are exactly `true`.
The feed flag defaults off and is not set by infrastructure. Browser actions remain
owner-only and reviewed; no provider writes, new infrastructure, or scheduled
refresh is part of this change. Google Calendar enumeration also depends on the
owner completing the existing consent flow for the calendar-list read permission;
this was not performed or verified here.

A scheduled refresh is a proposal, not an approved implementation. A future task
could add a managed timer that invokes the existing bounded refresh for an
explicit range, with per-owner exclusion, idempotent run IDs, and observable
partial/source failures. Each run would still spend Google API quota on calendar
enumeration/event reads and Gmail scanning, plus SQL and compute; Gmail may also
make up to 50 existing model classifications (up to 1,024 output tokens each)
at the configured rates. Repetition scales these reads and model usage with
schedule frequency. No dollar estimate is claimed; frequency, operational
ownership, and budget limits require a separate decision.

Refs DanAakesen/jarvis#1116
Refs DanAakesen/jarvis#725
Refs #1133

## P14-45 — Owner-set gym, run and step targets (20 October 2026; #1116, #1132)

The original Daily's weekly Gym/Run session targets and daily step target came
from a task source outside the approved Jarvis scope. Use owner-set values
instead: nullable whole numbers stored in a new owner-keyed Daily table, with
server-owned bounds and no seed or target defaults. Settings routes are signed-in
owner-only. The assistant gets no training-target write tool. The former eight-slot
catalogue rationale is superseded by #1204; that decision does not approve this
new capability. Clearing the final value leaves the owner with no stored row.
Settings adds a separate `#training-targets` section and a validated
`useTrainingTargets` contract for follow-up consumers.
Overview, Workouts and Health panels remain unchanged in this slice; their
real-data presentation and owner-session UI checks are deferred to the tasks
that consume the hook. The migration rollback refuses to discard saved targets.

Refs DanAakesen/jarvis#1116, #1132

## P14-50 — Rules & sources uses served evidence (20 October 2026; #1116, #1141)

Add the original Rules & sources composition as the final discovered Health
section, without shell changes or a period control. Reuse the nutrition editor
and existing authenticated profile reader; the latter needs one `/me` read
because the section receives the session token supplier, not the shell profile.
P14-45's training editor is not present and is explicitly unavailable pending
its merge. `daily.sync` serves health processing evidence only: do not infer
nutrition sync, mail/calendar connectivity, or source freshness from it.
Retained health evidence is labelled Stale after a failed refresh, not by an
invented age threshold. Nutrition sync stays Not connected with an explanatory
coverage gap; existing nutrition records remain usable. Real owner-session
verification and training-editor integration remain outstanding.

Owner naming update (20 October): new owner-facing copy uses Health and human
source labels. The back link is route-relative, ready for #1147's route move;
internal identifiers remain unchanged for #1146. Existing shared copy is left
to #1147.

## P14-46 — The Health panel opens from the Health card (20 October 2026; #1116, #1143)

Merging the Health panel (P14-47) into the cards-only Overview left two Health
surfaces: the card and an always-open panel below it. The original keeps one: the
Health card's chevron expands the panel on the same page. Choices: (1) the panel is
closed on arrival and the Health card title is a button with `aria-expanded` and
`aria-controls` that opens and closes it, kept in the address as `panel=health` so a
link or reload reopens it, with `healthTab` unchanged; (2) the panel mounts only while
open, so the landing view makes no panel reads and no tile appears twice; (3) closing
it returns focus to the card button; (4) Training and Body titles stay links. The
panel's own Collapse button still writes `panel=closed`, which also reads as closed.

Refs #1116, #1143

## P14-46 — Overview top cards follow the original: Training, Health, Body (20 October 2026; #1116, #1143)

The owner asked for parity with the original Overview, checked on the owner's own
data. The Today block is replaced by a period control (Today, Yesterday, 1 week,
2 weeks, 1 month) and three cards: Training (Gym, Run and Activity rings, Protein,
Calories left and, for one day, the meals strip), Health (Sleep, Protein and a
cumulative protein line with a target) and Body (Sessions, Calories, Duration and
four measurement sparklines). Choices: (1) every number comes from a served source
and each source states its own state, with "Not recorded" for a served source that
holds nothing, "Unavailable" for one Jarvis does not serve, and "No target set"
where an owner-set target is missing (weekly gym and run targets and the daily step
target arrive with P14-45; nothing is defaulted); (2) body measurements are asked
for only when the metric catalogue serves them, and no weight, fat or lean metric
is invented; (3) the owner ruled the Overview is the cards only, so the old
summary tiles, the collection list with its Open buttons, the "About this data"
notes, the manual Refresh button, the "Today" heading and the Health Auto Export
prompt are removed and nothing else sits on the page; data still reloads on focus,
when the page becomes visible, on the shared refresh stream and with each card's
Retry, and a card whose source holds nothing says so itself; (4) every ring, tile, chart and strip
reserves its size, so no state changes the layout (P14-44); (5) the recomposition
status, coaching, energy estimates and task or habit surfaces remain out, as ruled.
New text says Health, never Daily.

Refs #1116, #1143

## The Daily area is named Health (20 October 2026; #1116, #1147, #1146)

The owner ruled that the area built as Daily is called Health and that the word
"Daily" must not appear anywhere the owner can see or hear it. P14-53 renames
everything visible: the route (`/health`, with `/daily` redirecting and keeping the
query string and hash), the navigation and mobile menu labels, headings, accessible
names, notices, document titles, owner-facing API labels and messages, the assistant's
navigation target (`health`, with `daily` kept as an alias) and the display of raw ids
such as `daily.metrics`. "Daily" used only as an adjective is reworded ("per day",
"today's"). New owner-visible copy in the parallel P14-45 to P14-52 tasks says Health
from the start.

Internal identifiers keep the old name for now: folders, component, hook and CSS class
names, API paths (`/daily/...`), tool names, query source ids, the module id and
storage keys. The owner's phone uploader and connectors may be configured against the
current paths, so P14-54 renames them after the other tasks have merged, with aliases
for every deployed path and key and an owner-run check before an alias is removed.
Until then "Daily" in code, issue titles and the documents below means the Health area.

The navigation command that reaches open browser tabs still carries `daily` for this
page: the backend accepts `health` from the assistant and maps it before delivery,
because a tab opened before the deploy only knows `daily` and would reject `health`.
P14-54 drops the mapping once those tabs are gone. Stored nutrition text is shown as
saved; only a provenance `source` value is relabelled for display.

Refs #1116

## P14-41 — Daily matches the original, except the recorded non-migrations (20 October 2026; #1116)

The owner ruled that Daily is built to match the original screen for screen, on the
owner's production data, and not staged behind gaps in what Jarvis serves: what the
original showed is built, and a source is added where Jarvis has none. The
exceptions are the things already decided not to migrate in
[the migration scope](daily-migration.md), which stay out: task, habit and countdown
surfaces and their source, meal plans and the live meal coach, coaching and
recomposition automation including the baseline status, energy estimates, the widget
and football. This replaces the earlier requirement that each unbuilt item wait for
its own ruling: anything the original shows and those exclusions do not cover is
built. Workouts and Nutrition remain sections of the one Daily page.

Where the original read a weekly session target or a daily step target from the
excluded task source, the owner sets the targets in Jarvis (P14-45). Until a target is
set the interface says "No target set"; no default is shown. The Gmail waiting lists
and the calendar agenda stay under #725: P14-51 serves them read-only and dark behind
a flag, P14-52 shows them, and they are not claimed live until the owner's Google
consent, deployed-model and device acceptance gates are met.

Verification changes with it: no component merges on synthetic data alone. Each task
is checked against the owner's production data in the owner's local session, at
desktop and 500 px widths and against the original screenshots, before its pull
request merges. Tests keep clearly synthetic values, and the original's screenshots
and values stay out of the repository.

Refs #1116

## P14-44 — Overview tiles hold their size; reads on focus wait a minute (20 October 2026; #1116, #1129)

The Daily Overview summary tiles and Today cards jumped while loading: each tile
swapped its skeleton, a "Refreshing…" row, a "Load more" row and the freshness line in
and out, auto-load published every page as its own render, and every window focus
read all sources again. Decisions: (1) each tile and card has a body and a status
slot that are always mounted, with a per-tile minimum body height measured from the
loaded tile (larger at 380 px and below), so height does not change between
loading and loaded; (2) a refresh keeps the previous values on screen; (3) an
auto-loading tile opts in to `settle` and publishes once, after its last page, so
a tile that reaches its page cap says "partial" in its freshness line and adds no row
(it has no Load more), and the "Showing the first N" row with "Load more" shows only
after a read failed part-way, beside its error row; (4) the shared
`useDailyPages` hook skips a focus or visibility refetch when the last successful read
began less than 60 seconds ago (`focusRefreshWindowMs`), while a failed read is retried
on focus and the Refresh button, a changed `refreshVersion` and Retry stay
immediate. The window is a trade-off: the freshness pill and the data may be up to a
minute old after returning to the tab, in exchange for a calm page. Sleep leads with
total sleep and falls back to asleep, because staged exports report asleep as 0.
A week without workouts is 0 minutes, not unknown. Unmapped snake_case metric keys
read in words (`metricLabel`); unmapped names of any other shape stay verbatim. The
tiles' loading semantics and wording otherwise stay as they were.

Refs #1116, #1129

P14-53 (#1147) applies the 20 October naming ruling: the owner-facing area and
route are Health and `/health`, with legacy `/daily` UI links replaced to the
matching Health URL. The internal area id, `dailyEnabled` options, API paths,
tool/source ids, query contracts, settings keys, environment variables and log
event names stay unchanged until #1146.

## P14-49 — Nutrition parity uses only served freshness and meal fields (20 October 2026; #1116, #1139)

The Nutrition Today view uses the served Copenhagen day total and the existing
owner-target loader. Trend averages and charts use the selected period's
`daily.nutrition.days`; the meal list pages through `daily.nutrition.meals`.
Partial nutrient values retain lower-bound wording, with calorie balance
described as an upper bound when energy is partial. The meal query does not serve
an export state, and the query contract sets staleness to `unknown`; therefore
the UI says “Not recorded” and “Staleness unknown” instead of inferring either
value. Existing Plans and Favourites remain unchanged; meal coaching stays out
of scope.

Refs #1116, #1139

## P14-41 — Today cards read served sources and say so when one is not (20 October 2026; #1116)

The Daily Overview now opens with Training this week, Protein today, Calories left
today and a Meals today strip. Training shows count rings only, because weekly
session targets are not served; protein and calories draw an arc only when the
owner has set a nutrition target. Nutrition targets load only once a day with meals
exists, so an empty day makes no extra request. A source that is not served renders
an explicit unavailable line, never an empty or loading look. The existing summary
tiles stay below the cards for now; whether to merge them is the owner's call.
Tasks, countdowns, habits and mail attention rows are still not built.

Refs #1116

## P14-32 — Same focus rim on every field; slim select chevron (20 October 2026; #1085)

The owner chose a thin tinted rim plus the soft glow on every entry field and
dropdown. The shared field rule's `:is()` list out-ranked the focus rule, so
fields in shared containers kept a grey rim and showed only the glow. The shared
rule now reads its border colour from `--field-rim`, which the focus rule sets to
`--field-focus-rule`, so the tint no longer depends on specificity. The glass
dropdown's picker icon is drawn as the slim chevron the closed selects had, not
the browser's solid triangle.

## P14-41 — Freshness pill reports the last processed upload (20 October 2026; #1116)

The pill's primary label is the newest `accepted_evidence_at` across the served
sync feeds, worded as an upload time. The phone heartbeat is written only by the
separate Shortcuts route, so an uploader that uses the ingest route never has one
and the pill wrongly read "No phone contact yet" while uploads were processed. The
heartbeat is now an optional details row. Waiting or processing uploads with no
processed time read "Upload being processed"; "No uploads yet" appears only with
neither. The served sync item now includes `inbox.processing` (previously
dropped by the projection) so the processing state is real rather than inferred.
No new source is read.

Refs #1116

## P14-42 — Expose retained health upload usage in Daily sync (20 October 2026; #1120)

Add owner-scoped `retained_bytes`, `byte_limit` and `row_limit` to the existing
sync inbox and shared query projection. Sum stored byte counts for every
retained row, independent of processing status, and reuse the upload store's
exported limits. Empty stores still return zero bytes and both limits.
This is read-only capacity visibility; ingest, processing and retention remain
unchanged. The Daily freshness pill's details panel now shows the figures in a
"Stored" row (`{MiB} of {limit} MiB · {n} of {limit} uploads`), adding the words
"nearly full" at 80% or more of either cap. A missing or non-finite figure reads
"Unknown" and is never flagged. Cleanup or compaction requires a separate owner
decision.

Refs #1120

## P14-32 — One subtle focus style for entry fields (20 October 2026; #1085)

The owner rejected the 3px outline on fields. All text entry fields now use one
treatment: a thin tinted border plus a soft glow underneath, defined by the
`--field-focus-rule` and `--field-focus-glow` tokens, with the outline kept only
as a forced-colours fallback. The per-component outline rules were removed so
the shared rule is the single source. Non-text controls are unchanged. A
zero-specificity catch-all covers fields outside the shared containers, and
field selects now opt into the glass dropdown list (`appearance: base-select`)
that the shared field system had overridden with `appearance: none`. Range
sliders keep the solid 3px outline, and increased-contrast mode swaps the glow
for a separated solid ring because the tint then equals the resting border.

## P14-41 — Daily shell: freshness pill and short periods (20 October 2026; #1116)

The Daily shell shows a freshness pill built only from the served sync source
(last phone contact and upload counts); it never states a time Jarvis does not
serve. The shared period gains Today, Yesterday and Last 14 days beside the
existing presets, so the original short ranges are available without removing
any current one. A greeting with a person's name is not added: no served source
or area prop carries it.

Refs #1116

## P14-41 — Daily UI rebuild: original components, Jarvis styling (20 October 2026; #1116)

The owner ruled that Daily is rebuilt with the original app's components and
data presentation, in Jarvis styling. The earlier P12 line "no separate Daily
skin" still holds and is read as: no second theme, shell or token set. It no
longer means recomposing the original layout. Components may therefore follow
the original composition, restyled with existing Jarvis tokens, shared
components, themes, density and motion.

Data limits are unchanged: only what Jarvis serves is shown. Served sources get
loading, empty and error states. A component whose source is not served shows an
explicit unavailable state, never an empty one (which would imply a successful
read), and is listed as a gap. Values are never invented.
This ruling does not by itself lift earlier scope exclusions (task, habit and
countdown source, coaching and recomposition automation, separate Workouts and
Nutrition pages); each needs its own owner ruling before it is built. The
[audit](ui/p14-41/audit.md) lists the components and gaps. The original source
code was not available, so the audit works from screenshots only.

Refs #1116

P14-47 follow-up (#1136): Health panel state belongs to `panel` and `healthTab`
search parameters. Its read window is the current Copenhagen day plus six preceding
days; weekly targets count Monday through today. Retained-record completeness is
still unknown. Catalogue units keep series separate; categories are used only
when served, with uncategorised metrics retained in All data rather than inferred
from a personal metric list. The current catalogue has no category field or
retention policy. A complete workouts read with no sessions reads as zero; total
sleep leads and asleep is only a fallback; `active_energy` is accepted as the
active-calories series. Gym/Run targets remain a nullable prop pending P14-45 (#1132);
no parallel targets client is introduced.

## P14-32 — Notes tree beside Show tasks (20 October 2026; #1085)

Dan asked for a tree of all notes he can preview and edit. An icon-only button
beside Show tasks opens a lazy folder-and-note tree; the task panel and the tree
share one place, so only one is open. Notes open in the existing popup rather than
a second editor. The tree uses only existing endpoints: `/notes/tree` for folders
and `GET /notes?directory=` per opened folder. Notes at the vault root and in
folders outside People, Work, Personal and General were hidden by the backend
index until #1113 (P14-40) removed that filter; the tree lists them without a
client change.

## P14-40 — Full indexed-note scope in the Notes graph (20 October 2026; #1113)

The graph, its folder filters, and note search follow the owner's P9-77 ruling:
all indexed safe Markdown notes are in scope, including vault-root notes and
notes in any normal folder. P7-43's four-folder SQL predicate only reflected
the original map layout; it also caused shared graph-file callers to drop valid
notes from graph, search and `/notes`. Remove that predicate and retain path
validation, hidden-folder and redaction exclusions, and existing result bounds.

Refs #1113

## P14-32 — Result pills and a text-free loader (21 October 2026; #1085)

Search results used coloured dots, a separate Tasks heading and raw snippets
that leaked front matter and task markup. Each result row now carries a
coloured pill at its top right with the folder name (or Tasks) and a note or
task glyph; matching tasks lead the list and "Show all N tasks" opens the panel.
Dots are gone everywhere, including the legend, which uses the same pills.
Snippets are cleaned to one plain line by `cleanSnippet`. The Notes loading
state is a small constellation without a card, still under reduced motion. Pills and legend entries use the graph colour itself, so they match the stars, with dark text (white in the light theme) from `--pill-ink`; the contrast audit checks every pair at 4.5:1.

## P14-32 — One size scale for controls (20 October 2026; #1085)

Controls in the same row had drifted to different heights (the Notes search bar
measured about 53px next to a 44px button, with 36, 32 and 28px neighbours
elsewhere). Three tokens now define the scale: `--control-size` 44px for a
standalone control or bar, `--control-size-inset` 36px for a control nested in a
44px bar, and `--pill-size` 28px for pills. The Notes top row, the legend, the
top-bar icon buttons and the Tasks panel controls use them. Inset controls keep a
44px hit area through an invisible extension rather than growing the bar. Other
stylesheets still hold ad-hoc heights and move onto the scale as they are touched.

## P14-32 — Rail icons light in their own tone and name themselves on hover (19 October 2026; #1085)

Each left-rail icon now lights in its own tone when its page is selected, and
hovering or keyboard-focusing a rail control shows its name in a small label to the
right. Tones are fixed per icon at one lightness per theme, so the rail looks even
rather than a rainbow; they feed the existing selected-state roles on the rail link
only, so the app-wide selection tokens, the tile tint and the stroke weight are
unchanged and colour is never the only marker. The label is a flat portal on the
document body rather than a child of the rail, because the rail is deliberately
tilted in 3D, clips its children and sits under menus. The label is hoverable,
dismissible with Escape, press or resize, hidden from touch and from assistive
technology (it repeats the accessible name), and replaces the native tooltips on
Folio and the chat orb. A single shared tone remains a one-token change if the
per-icon colours prove too busy.

## P14-39 — Remove the Tasks legend partial label (19 October 2026; #1107)

Keep the additive `taskCountsPartial` API field unchanged, but do not surface it
as text in the Notes map legend. The Tasks count means notes currently on the map
with open tasks; if no count is available, show an em dash, disable the toggle
and explain that task marks are unavailable right now. The accessible name
retains the count's meaning.

Refs #1107

## P14-32 — The send icon is a paper plane that moves (19 October 2026; #1085)

The composer send action stays a bare icon, with no fill, border or shadow in any
state, but is no longer a plain arrow. It is a paper plane with two short speed
lines. It rests dim while there is nothing to send and lights up in the focus
colour, sliding into place, once there is. Hover and keyboard focus warm it, lean it
along its flight path and draw the lines in; press shrinks it; each accepted
message makes it fly out and glide back in once. The focus colour is used rather
than the theme accent because a bare stroke needs guaranteed contrast. The
take-off runs on a wrapper that remounts for each message, so sends in quick
succession each play it. All motion is finite, transform and opacity only (plus the
line draw), and reduced motion keeps only the colour change. `stylesheets.test.tsx`
pins the bare icon and the finite, reduced-motion-safe animation.

## P14-34 — Notes map open-task marks (19 October 2026; #1094)

`GET /knowledge/graph` adds optional per-node open-task counts, the number of
marked graph notes, and a partial flag. The backend reuses `readVaultTasks`, the
same bounded parser as the task panel; it returns counts only, never checkbox text.
Task-file scan limits or tasks on notes outside the capped graph are made visible
as partial. The web client accepts older graph payloads without these fields.

The folder legend adds a default-on, `aria-pressed` Tasks toggle. It switches
marked stars between their folder colour and the dedicated `--graph-tasks` token,
and makes marked stars larger; it does not hide notes or change the task panel.
Hover labels include the open-task count. Theme values and the contrast audit
remain in `apps/web/src/styles.css` and `apps/web/src/contrast-audit.test.ts`.
The toggle is not persisted because the map does not currently persist its other
filters.

Refs #1094

## P14-35 — Daily v182 unresolved delivery questions (19 October 2026; #1095)

**Proposed only; owner ruling required.** This entry records evidence gaps and
options; it does not change runtime behavior or mark source parity complete.

### Schema field-mapping scope

**Question:** Should the 21 source columns without an exact migration-column
match remain individually marked not mapped, or should additional mappings be
verified before the schema row is accepted?

- **Option A — retain scoped unknowns:** keep the 31-table/360-column inventory
  with 248 exact-name matches, 0 evidence-backed renames, 91 explicitly excluded
  columns, and 21 individually reasoned not-mapped columns. This preserves the
  approved feature scope without claiming data or behavior parity.
- **Option B — map every field:** document source-to-Jarvis column mappings
  and SQL adaptations for the 21 unmatched columns, including source
  `owner_email`, raw-object lifecycle fields, and `nutrition_queue.claim_token`.
  This expands analysis beyond the selected capabilities and still must not
  change or delete existing owner data.

**Recommendation:** Option A, with every not-mapped field visible and no claim
of semantic parity. Evidence: [`source-schema.test.ts`](../apps/backend/src/daily/source-schema.test.ts)
and the [P14-35 schema inventory](reference/daily-v182/source-to-jarvis-matrix.md#machine-checked-schema-classification).

### Sleep date and DST oracle

**Question:** When a sleep record's explicit source date and its end timestamp
fall on different calendar dates, which should Jarvis use at DST boundaries?

- **Option A — source precedence:** use the pinned source's documented key
  precedence (`date`, then sleep/in-bed/end date fields) and verify the result
  with synthetic SQL boundary vectors. This favors source compatibility.
- **Option B — Jarvis day rule:** derive the key from Jarvis's existing
  Copenhagen/wake-date behavior. This may differ from source selection.

**Recommendation:** Option A, but do not change persistence until tests
demonstrate the pinned precedence for overnight, DST-gap and DST-fold records.
The reference documents the source helper rules but the current Jarvis SQL
tests do not prove cross-boundary equivalence.

### Missing coach-profile bootstrap

**Question:** Should a missing Jarvis profile stay `not-configured`, or should
Jarvis return the source code-default profile at revision 0?

- **Option A — remain unconfigured:** never present configured source defaults
  as this owner's profile; updates remain revision-checked against an existing
  row.
- **Option B — reproduce source default:** return a revision-0 profile using
  the exact pinned configuration values. The pinned reference documents the
  revision-0 fallback but does not list those values, so they must first be
  verified from the allowed source reference.

**Recommendation:** Option A until the exact source default values and their
owner-facing meaning are established. The source fallback is documented, but
Jarvis has not reproduced or tested it.

### Preference clear semantics

**Question:** Should clearing a meal preference delete its row like Daily v182,
or retain Jarvis's revisioned row with a null preference?

- **Option A — delete:** matches the source's absent-row semantics but removes
  Jarvis revision history for that key.
- **Option B — retain null:** preserves Jarvis's revisioned write history and
  distinguishes an explicit clear from no prior row, but differs from source.

**Recommendation:** Option B, preserving existing data and retry semantics.
Do not describe the two behaviors as equivalent.

### Meal duplicate and HTTP response contract

**Question:** Should Jarvis expose a source-compatible HTTP contract for
`/api/gpt-actions/nutrition/log`, including duplicate replay and response
fields, or keep this capability native-tool/service only?

- **Option A — compatibility endpoint:** add a selected-path alias and tests
  for the pinned owner/idempotency behavior (`INSERT OR IGNORE`, retained meal,
  `duplicate:true`, HTTP 200 response), plus documented error fields.
- **Option B — native only:** keep Jarvis's existing tool/confirmation
  contracts and do not promise source HTTP compatibility to external callers.

**Recommendation:** Option B unless an owner-approved external caller requires
the old endpoint. The source contract is specific; current tool mapping alone
does not demonstrate its HTTP response parity.

### Published API paths

**Question:** For selected source operations mapped to Jarvis services, should
the original `/api/gpt-actions/*` paths be aliased, or should the source-path
difference remain intentional?

- **Option A — selected aliases:** implement only owner-selected paths (never
  restore the 15 excluded tools) and contract-test documented requests,
  required response fields and errors against each equivalent service.
- **Option B — native-only:** retain the existing Jarvis routes/tools and
  explicitly accept that clients cannot call source paths.

**Recommendation:** Option B, consistent with the approved reuse/native-tool
design. In either case, tests must not imply parity for the 19 paths until
their documented shapes have been exercised or intentionally ruled out.

### Selected tool packaging

**Question:** Keep the nine selected source operations grouped into three
registry tools, or register nine distinct names?

- **Option A — nine names:** matches source names directly.
- **Option B — three grouped tools:** remains a name-level mismatch.

**Historical recommendation:** Option B was selected under the then-current
count/reserve policy. #1204 supersedes that rationale, but does not change the
selected API shape or resolve the name-level mismatch. Keep the mismatch
visible; grouping is not proof of request/response/error parity.

### Favorites query contract

**Question:** Should Jarvis add a native `get_favorites` query/limit operation
that returns the source favorites-list shape, or keep the current exact-name/
alias lookup as a deliberately partial mapping?

- **Option A — source-shaped list:** accept the source's bounded `query` and
  `limit` inputs and return a favorites collection with `hasMore` and `source`.
  This fills the selected capability's search/list gap but adds a new tool
  contract.
- **Option B — exact lookup only:** retain Jarvis's existing lookup by exact
  saved name/alias and do not claim it implements the source list operation.
  This keeps the current native tool contract but leaves `get_favorites`
  partial.

**Recommendation:** Option B unless the owner requires a favorites-list
workflow. The pinned MCP schema documents `query`/`limit` and a list response;
the existing Jarvis test covers only exact-name lookup.

### Historical partial replay

**Question:** Should Jarvis keep source-compatible per-key replacement, or
introduce a Jarvis-only rule that rejects partial metric/day batches?

- **Option A — per-key replacement:** a later batch replaces each supplied
  metric/date key; this matches the pinned source and permits corrected values,
  but cannot establish full-day completeness.
- **Option B — require a completeness signal:** reject batches without an
  explicit complete-day marker. The pinned source contract defines no such
  marker, so this would be a Jarvis-specific restriction and needs a trusted
  signal contract first.

**Recommendation:** Option A, with no claim that accepted history is complete.
The authored synthetic SQL test asserts later replacement and protection from
an older replay and runs in the required Database CI job. Neither result
establishes source-device completeness.

### Partial reuse boundaries

**Question:** Are these exact partial differences acceptable for the five
reused capabilities, or should the port add source-specific behavior?

- `search` has separate conversation, memory, vault and repository indexes;
  it does not combine Daily health/meals with task/calendar search.
- `fetch` reads Daily or Factory records through separate resolvers; there is
  no cross-domain source-reference fetch.
- `get_daily_overview` supplies conversational facts, not the source
  scoreboard/fixed renderer.
- `get_attention_items` has no Daily source snapshots, status aggregation or
  fixed attention rules; ordinary tasks/calendar are not those derived items.
- `get_calendar_window` reuses event-list/agenda reads without the source
  window wrapper or response contract.

- **Option A — accept reuse boundaries:** preserve the existing general
  tools and explicitly label this coverage partial.
- **Option B — extend parity:** add only the missing source behaviors approved
  by the owner, with contract tests.

**Recommendation:** Option A unless an owner workflow depends on a named
missing behavior. Do not add a second cross-domain registry merely to imitate
source naming.

## P14-37 — Deploy the vault mirror image when its source changes (19 October 2026; #1099)

Treat the mirror Dockerfile and all its local copy inputs, plus `.dockerignore`,
as infrastructure fingerprint inputs. This keeps the image build in the existing
infrastructure job and preserves exact-tree qualification, deployment receipts
and acceptance. A separate mirror deployment component would require expanding
the release plan, receipt schema and workflow; it is not justified for this
change. The existing infrastructure invalidation rule therefore re-applies
backend, web and agent alongside infrastructure, which is the accepted redeploy
cost. The image build and mirror resources remain opt-in; documentation-only
changes remain excluded.

## P14-32 — One Notes page, a livelier map and quieter copy (19 October 2026; #1085)

The Tasks page is gone. Notes is the one page: a Show tasks button beside its
search bar opens the read-only task panel beside the map, and `/tasks` redirects to
`/notes?tasks=1` (keeping the search), so old links and the Notes search task
group still work. The address is the source of truth for the panel: opening pushes
a history entry so Back closes it, and a link to a task search on the same page
opens it and applies the search. Those parameters do not count as leaving an
unsaved note draft. This is the interim step before the design-led one-page layout
tracked in #1085.

The Notes search bar is compact (380px at most) and holds only the search, Reset
view and Create. It shows no note total; a match count appears only while
searching. The jobs chip in the top bar is vertically centred with its neighbours.

The knowledge map opens centred on the mass of the notes and fitted to the window,
follows the layout while it settles, and stops at the first pan, zoom or search
flight; Reset view returns to the same fit. Its idle motion is stronger (drift, a
swell through the cloud, brighter breathing, pulses along links, flaring notes);
the constants are at the top of `knowledge-scene.ts`. Picking and label positions
mirror the drift, so a star and its label are found where they are drawn. Reduced
motion keeps it still.

Copy that restates a heading, a label or a visible state is removed, along with
reassurance about what is not stored, unless it is consent, a destructive-action
warning or recovery guidance; success is quiet. `copy-cleanup.test.ts` now scans
every non-test source file for the removed strings. Data-honesty markers are not
filler: freshness, stale, partial, failed-refresh and estimated states keep a short
visible note (for example "Showing the last loaded records." and "This page only").
Health upload guidance keeps the enforced limits.

## P14-36 — Match Azure application alert types (19 October 2026; #1097)

Use `replace()` with an explicit placeholder in each application alert query;
Bicep does not interpolate multi-line strings. The three `appAlertTypes` match
the backend's `jarvis.alert` trace `alertType` property: `credential_expiry`,
`deployment_failure` and `sandbox_crash`. The additional backend type
`budget_threshold` has a separate Azure Consumption budget notification path.
No other affected multi-line strings were found in `infra/`. Reject literal `${`
in compiled scheduled-query rules in the existing infrastructure CI check.

Keep thresholds, evaluation frequency, action group and all other resources
unchanged. Restored matching may notify that action group for previously silent
alerts. Azure Monitor read-back of the three concrete type filters remains
required after the normal Deploy; offline validation is not live acceptance.

## P14-33 — Harden the first live vault-mirror run (19 October 2026; #1090)

Keep the engine and `@jarvis/contracts` status schema unchanged. Each `ob` call
uses the remaining 420-second run budget less a fixed 90-second reserve for
snapshotting, planning, GitHub writes, state upload and status persistence; the
Container Apps replica timeout remains 480 seconds. A child-command timeout
does not abort the run deadline, so the runner persists the stopped workspace
and the matching Headless state before reporting `timeout`. The next invocation
always begins in `pull-only` and lets the CLI reconcile that checkpoint before
planning or writing back. The pinned package writes each downloaded file before
recording it in its local state database; recovery ordering is inferred from
source and remains **not yet verified against the live service**.

Reduce the state archive limit from 200 MiB to 64 MiB. This bounds the expanded
input buffers and generated archive produced by the synchronous `fflate` ZIP
implementation within the job's 1 GiB memory limit; archive encoding is
preflighted before GitHub or Obsidian writes, including pending retries and
planned write-back. On Node 22.23.3, encoding a 63 MiB incompressible file
produced a 63.01 MiB archive with a measured peak RSS of 315 MiB, below the
1 GiB job limit. Oversized and corrupt archives use the existing fixed
`state-corrupt` reason and `needs-attention` outcome, which the current Status
page already explains. The shared schema cannot distinguish the two archive
causes; keep that contract unchanged.

The pinned `obsidian-headless@0.0.14` package source confirms `sync-config`
supports `--file-types`, `--excluded-folders` and `--configs`. Its empty
`--file-types` argument deletes `allowTypes`, which restores the package defaults
of image, audio, PDF and video. An empty `allowTypes` array is truthy in the
package's filter constructor and disables all attachment categories, so after
each per-device `sync-config` command the runner sets only this device's
`config.json` `allowTypes` to `[]`. `--configs ""` clears synced vault settings;
policy excluded prefixes become the CLI's excluded-folder list. Source checks
show rejected files are removed from the sync queue and accepted without
deletion in both pull-only and bidirectional branches. These command, filter,
configuration-file and recovery behaviors are **not yet verified against the
live service**.

Key Vault and GitHub errors are `auth` for HTTP 401/403, missing (404) or blank
required Key Vault secrets, or the Obsidian CLI's explicit invalid/expired-token
result. Missing optional passwords remain allowed; a missing policy secret
remains `policy-missing`; an inaccessible private repository remains
`repo-not-private`. Other 404s, rate limits, server errors, timeouts and
network failures are failed outcomes.
Windows-incompatible file names are counted as skips.
After an Obsidian upload, verify only the paths this run applied; unrelated
remote edits pulled by that bidirectional sync do not invalidate its result.
Build `better-sqlite3` from source in the isolated CLI image stage; the runtime
remains slim and non-root.

## P14-27 — Azure vault mirror runner and Headless CLI wrapper (19 October 2026; #1078)

Add a one-run runner around the P14-26 pure planner; do not add infrastructure or
change the shared status/policy contract. The existing desktop task remains and
this image is not deployed or connected to the live vault. Azure access uses the
job's user-assigned managed identity for Key Vault and private Blob containers.
The `vault-mirror-state/state.zip` blob is the single-flight lease; verify its
SHA-256 metadata and archive limit after leasing, then update it once at the end
with both its original ETag and lease ID. P14-33 supersedes this decision's
original 200 MB cap with 64 MiB. Status is a separate
`vault-mirror-status/status.json` blob. A missing state blob is initialized only
with an `If-None-Match: *` create.

The GitHub App token is minted for only `DanAakesen/vault` with `contents:write`.
Every run verifies the repository is private and its default branch is `master`
before taking the state lease. Read the branch ref and recursive tree once per
snapshot; reject truncated/incomplete trees. Build Git blobs/tree/commit and
update the ref with `force:false`, using the fixed message `Update vault mirror`.
If the ref update rejects a moved branch, read the new snapshot and replan once;
a second rejection is `push-rejected`. Omit explicit author/committer so the
GitHub App installation identity is used for the commit.

Keep runtime I/O outside `src/engine`. The runner persists the working copy,
Headless CLI configuration, common-base text, conflict first-seen times and
pending write-back paths together. The working copy and config home use the same
fixed per-user absolute paths below the OS temp directory on every invocation.
After taking the state lease, the runner removes and recreates those directories
with mode 0700, then restores their archived contents; this preserves `ob`'s
configured `vaultPath` while avoiding reliance on repeating `sync-setup`. The
paths are private to the single-purpose non-root job/container. It checks the
lease before each external or local write. GitHub changes happen atomically
before local write-back. Local write-back uses a same-directory temporary file
and rename, then compares the entire working-copy diff with the planned O-side
paths before upload; a mismatch restores the prior copy and reports
`guard-tripped`.

At run start, the runner best-effort reads `status.json` with a 5-second timeout,
a 32 KiB cap and strict schema validation. Invalid, absent or unavailable status
is ignored. Until the state archive is loaded, its previous success timestamp
and failure count seed early outcomes; once loaded, the later success timestamp
and larger failure count from status and state are retained. A busy run carries
both values unchanged. Early failures increment the carried failure count, and
successful `ok`/`ok-noop` runs reset it; both success outcomes advance
`lastSuccessAt`.

Failed/unconfirmed O writes and deletes remain pending and do not advance the
base. Before retrying in `on`, compare each pending target with both its prior
base and intended result. Apply only when it still matches the base; clear an
already-landed write/delete without another upload; if it differs from both,
drop the stale retry and let normal planning reconcile the newer edit. Upload
only if at least one pending mutation was applied. In `dry-run`, pending paths
are excluded from planning and remain pending; no bidirectional mode is
requested. Fresh state and guard trips still suppress O writes.

The wrapper pins official `obsidian-headless` **0.0.14** in the isolated
`apps/vault-mirror/tools` lockfile, invokes `ob` with an argv array, supplies
`OBSIDIAN_AUTH_TOKEN` only in its child's environment, captures bounded output
without printing it, and terminates the child process group on timeout. Runner
logging is restricted to run ID, outcome, fixed reason, duration and counts;
paths appear only in private conflict status. `dry-run` is the default and only
an explicit `on` value enables write-back. The image uses a pinned Node 22 base
and runs as non-root; CI builds but does not publish it, then smoke-tests
`ob --version` and a fake service run. The optional vault password is passed in
the `ob sync-setup` argument array because this CLI provides no password
environment-variable or stdin input; the job's single-purpose non-root
container limits other local process exposure.

All assumptions below are **not yet verified against the live service**:

- The pinned package README says `sync-setup` needs a password only for
  end-to-end encrypted vaults, but the inspected 0.0.14 CLI source appears to
  exit with code 2 when `--json` is used without any password (unless the
  service response supplies one). A first setup without the optional password
  secret may therefore fail even for a standard vault. This source/documentation
  discrepancy has no verified workaround and must be checked before live use.
- The npm package source/README advertises `sync-setup`, `sync-config --mode
  pull-only|bidirectional`, one-shot `sync`, `--json` on setup/config commands,
  and `OBSIDIAN_AUTH_TOKEN`. The runner assumes these commands and option
  semantics are accepted by the owner's service/account.
- Repeating `sync-setup` for the configured vault is treated as idempotent. The
  inspected source rewrites local setup configuration rather than creating a
  remote vault, but this has not been confirmed against the live account.
- `ob sync` has no documented JSON mode. A successful zero exit is treated as
  confirmation of all pending uploads; a non-zero exit is unconfirmed and keeps
  every pending path. The CLI does not document per-file upload receipts, so
  partial-success behavior is unknown.
- CLI error text is inspected only in memory to classify auth failures; other
  failures map to fixed pull/upload reasons. Exact service error strings and
  exit-code behavior may change; neither is logged or exposed.
- On Linux the inspected source puts `state.db`, `config.json`, and `sync.log`
  below `$XDG_CONFIG_HOME/obsidian-headless/sync/<vault-id>`. The archive
  preserves this directory. It also preserves the derived encryption key that
  `ob` stores in its config for an end-to-end encrypted vault; the raw password
  is supplied only to `sync-setup` when present and is not archived by the
  runner. The official source does not state an auth-token lifetime or refresh
  behavior, so the runner reads the Key Vault token every invocation and does
  not attempt an undocumented refresh.
- The official CLI documentation describes `pull-only` as ignoring local
  changes and `bidirectional` as uploading and downloading; those protections
  and the timing/meaning of an upload's success need live verification.

The official package README and bundled source inspected were npm
`obsidian-headless@0.0.14`; the official Help Center page was unavailable during
research. No Obsidian credential, password, policy or vault content is included
in source or fixtures.

## P14-29 — Quiet mirror freshness and owner findings (19 October 2026; #1081)

Consume the merged runner status contract rather than changing it. Add a
separate strict reduced-view schema for authenticated Status consumption.
Read through the backend's managed identity with a five-second/32 KiB bound
and a 30-second single-flight cache, including missing/error results. Missing
container/blob is not set up; all other failures expose only read error.
Keep private conflict paths out of tools, proactive data and logs.

Needs-attention/failed outcomes retain their state ahead of stale; otherwise
success older than 30 minutes, or no successful sync yet, is stale. No-op and
busy outcomes are healthy only while the last success remains fresh.
Dry-run stays visible without expansion and remains the runner's default.
Details are opt-in through one keyboard-operable compact Status row.

Use existing proactive scheduling and persistent finding deduplication for one
normal-urgency finding per Copenhagen day and fixed reason, after one hour
without success or immediately for needs-attention. Failed runs alert only
with no last success or one older than an hour; stale views with no last
success report that the mirror has not succeeded yet. Recent transient
failures stay quiet. A mirror finding never clears the proactive run's
`no_sources` reason or turns failed reads into a successful background job.
Keep one disclosure instance across loading and loaded snapshots so expansion
and keyboard focus survive. A successful snapshot without a mirror field is
not set up (including older backends); fetch/backend read errors remain errors.
No push, new flag, tool,
migration or write-back change. Missing/read-error status creates no finding.
Live Azure and Obsidian behavior is **not yet verified against the live service**.

## P14-28 — Opt-in Azure vault mirror deployment (19 October 2026; #1080)

Deploy `job-jarvis-vault-mirror` in the existing Container Apps environment on
the ten-minute schedule, with one replica, one completion, no retries, an
eight-minute timeout, 0.5 vCPU and 1 GiB memory. The small 2:1 memory/CPU
allocation is a starting point for the Node process and the contract's 200 MiB
state-archive limit; it is not a live workload benchmark. The Bicep switch
defaults off, and the deployment requires both the repository opt-in and a
digest-pinned image before it creates the job, identity, roles or containers.
The deploy flow skips visibly when the Dockerfile, image digest or required
non-secret App ID is unavailable; that does not block the core infrastructure
deployment.

Use a dedicated user-assigned identity with exactly `AcrPull` on the registry,
`Key Vault Secrets User` on the vault, and `Storage Blob Data Contributor`
scoped separately to `vault-mirror-state` and `vault-mirror-status`. Both
containers are private. The backend already has account-scoped Storage Blob
Data Contributor on this storage account, so it can read the status container
without another role assignment. The job reads secrets through the SDK at run
time, so absent owner-provisioned secrets do not affect infrastructure
deployment. Setting the repository switch explicitly false and manually
dispatching Deploy deletes the job, dedicated identity and its role assignments;
it retains the private data containers to preserve state and status for
recovery. A separate authorized backup/teardown
is required before deleting those containers.

Keep write-back at `dry-run`, with defaults of 25 changed files and 3 deletes.
These values are non-secret repository variables and Bicep parameters; the
owner changes write-back only after reviewing dry-run execution history and
status. The setup script never changes the enable switch and initializes
write-back to `dry-run`.

Cost estimate assumptions for one 30-day month: 4,320 scheduled runs; 0.5 vCPU
and 1 GiB per run; a 120-second expected run (and 480-second configured ceiling);
one state read and two data writes plus two lease operations per run; one 200 MiB
state archive plus negligible status data. At the estimated active rates of
$0.000024/vCPU-second and $0.000003/GiB-second, compute is about $7.78/month
before grants and $2.38 after the monthly 180,000 vCPU-second and 360,000
GiB-second grants are fully available. At the full eight-minute ceiling, the
corresponding figures are about $31.10 before grants and $25.70 after grants.
The grants are shared across the subscription, not reserved for this job.

The assumed Hot LRS storage rate is $0.020/GiB-month, or about $0.004/month for
200 MiB. Assuming $0.004 per 10,000 reads and $0.05 per 10,000 writes, 4,320
reads and 17,280 writes/lease requests cost about $0.09/month. Add this to the
compute figures above: about $2.47 expected monthly total if all grants remain,
$7.87 if none remain; at the eight-minute ceiling, about $25.80 with grants or
$31.20 without. The run time, archive size, request counts, Sweden
Central compute/storage/transaction prices, and grant remaining balance are
assumptions or estimates not verified against the live subscription or current
regional price sheet; ACR build/storage, Key Vault calls, logging, egress and
taxes are also excluded. Microsoft documents the Consumption free grants in
[Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing);
the approximate rates here are explicitly unverified.

The shared Azure vault-mirror contract is unchanged. The runner and status-page
reader are separate contract consumers; this decision covers their Azure
hosting and owner setup only. The Obsidian CLI is open beta and its live-service
behavior is not yet verified against the live service.

## P14-32 — Kanban is silent when it works: one board strip, a bare refresh icon, a small red notice on failure (19 October 2026; #1085)

The owner asked for the Kanban status text to go and called always-on “all is
well” lines a trend to avoid. While the board works the page now shows no
repository line, no fetch time and no “connected” message. Only a fault shows,
as a small red dot with “Board not connected”, and the detail (failed refresh,
cached board, GitHub unavailable, last fetched time) sits in its tooltip and
the screen-reader text, so the words, not the colour, carry the meaning. A
failed refresh with a board already loaded shows only that notice, and the
refresh icon is the retry path; the full error with “Retry board” appears only
when there is no board to keep. The header lost its Refresh board button. A
slim glass strip directly above the
board holds a bare refresh icon (no fill, border or shadow in any state, like
the composer send icon; it spins and is named “Refreshing board…” while a read
is pending) with Create project and Create task. The filter form reflows by the
width of the board rather than the viewport (5, 4, 2, then 1 column), which
fixes fields running past the right edge. The repository link and the
“closed in the last 14 days” line left with the status lines; the Done toggle
keeps the 14-day wording as a tooltip. The trade-off is that freshness and the
live channel are no longer visible at a glance; they surface when something is
wrong. The live-status line that P14-12 measured on `--surface-translucent` no
longer exists; the strip uses the same surface (`--board-slab`) and the red
notice is part of the contrast audit.

## P14-32 — The composer is quiet: no hover rim, a slim focus rim, a bare send icon (19 October 2026; #1085)

The owner asked for three changes to the composer, directly. Hovering it no
longer starts the rim sweep or the pointer glow, and the resting idle lap is
unchanged. Focus is slim again: the solid 2px focus-colour ring that P14-04
added on 18 October is gone, and the focus sweep is back to a 2px rim (P14-10
had doubled it to 4px), so typing shows one thin travelling light as the design
always intended. Under reduced motion the same 2px rim is steady. This reverses
those two choices for the composer only; other controls keep the shared 3px
focus outline. The send action is a bare arrow icon with no
fill, border or shadow in any state: hover warms it to the focus colour and
lifts it 2px, press settles it, disabled dims it. It keeps a 36px target (44px
on coarse pointers), the “Send” name and a visible keyboard focus outline, and
it no longer aliases the shared primary button. This is a scoped exception to the
shared primary alias rule for this one control.

## P14-26 — Pure vault mirror policy, reconcile and status contract (19 October 2026; #1077)

Implement only the offline decision boundary in `apps/vault-mirror`, not a
runner or deployment. The existing desktop task remains. Obsidian Headless Sync
and Azure integration are **not yet verified against the live service**.
The private policy is required, strict Zod-validated and fails closed with fixed
errors; regex compilation uses `i` and invalid patterns report `policy-missing`.
Paths compare after NFC and conservative Unicode caseless collision checks;
file/descendant collisions also skip, including approved descendants blocked
by an excluded ancestor file.
Content compares as SHA-256 of UTF-8 with CRLF converted to LF. Policy-approved
root/nested paths still require regular non-executable mode `100644`, bounded
bytes and no outgoing credential-pattern match. Skips never reveal a match.

| O / G / B | Decision |
| --- | --- |
| O equals G | Record common base if missing/stale; otherwise no action |
| Both absent | Forget base if present |
| O only, no B | Create G |
| O only, equals B | G deletion: delete O, subject to write-back gating |
| O only, differs from B | Preserve edit: recreate G |
| G only, no B | Create O, subject to write-back gating |
| G only, equals B | O deletion: delete G |
| G only, differs from B | Preserve edit: recreate O, subject to write-back gating |
| Different present O/G, no B | Conflict: skip |
| Different present O/G, B equals O | Write G back to O |
| Different present O/G, B equals G | Push O to G |
| Different present O/G, B equals neither | Injected three-way merge; clean writes identical text to both, otherwise skip |

Unresolved conflicts never modify O. Persist first-seen conflict times separately
when no base exists. At 24 hours, a still-conflicting path resolves in O's favour
by pushing O to G only, counted separately; GitHub retains the other version in
history. Apply writes before their common-base action, stop on failure and replan
fresh snapshots after crashes. The injected merge must be lossless/idempotent.

Any per-direction change/delete cap breach, deletions of more than 10% of
distinct base paths, an empty side against at least ten approved files, or more
than 20% of base paths missing on either side empties the whole plan, including
state actions. Proposed changes include deletes and are counted before gating.
Caps default to 25 changes / 3 deletes; hard maxima are 100 / 10. The owner may
raise a cap for one complete first-run snapshot, then restore it; ratio/empty
guards have no override. Per-path invalid/oversized/non-regular/collision/content
failures skip and count; credential matches flag `needs-attention/secret-match`.

Write-back remains `dry-run` by default, also suppressed for freshly initialized
state and all guard trips. Pending O writes never advance/forget the base.
Two acceptance-property phrases are interpreted according to the explicit
shared contract: dry-run forbids **O writes**, not G uploads; opposing-direction
writes are forbidden **except identical clean-merge output**. These are explicit
clarifications, not a change to the shared decision table or default.

The shared strict status schema uses exactly the contract's fields and enums,
nonnegative integer counts, at most ten conflict paths, run IDs ≤128 characters,
paths ≤1024 and ISO timestamps ≤64. `lastSuccessAt` is required and nullable
until the first success. These bounds/null representation settle unspecified
status details for later issues. Plans contain private text/paths and are never
log data; only counters and fixed reasons are log-safe. No live vault fixtures,
Obsidian credentials, network calls or clock reads are part of this workspace.

## P14-24 — Plan todo reminders after default-branch vault pushes (19 October 2026; #1073)

A verified push to the vault repository's default branch starts a bounded,
todos-only reminder-planning pass without waiting for a scheduled check. The
webhook and notes-index refresh use the same push predicate, with a late-bound
callback so startup ordering stays unchanged. The pass reuses the existing
todos source and reminder planner, writes `planned_run_id = null`, and creates
no proactive run, findings, model request, alert, todo write or Background work
entry. It runs only with the existing reminder gates enabled, when proactive
work is not paused, todos are enabled and the time is outside the Copenhagen
quiet window. Pushes during quiet hours are not queued. Concurrent or rapid
triggers collapse to one trailing pass, starts are at least 60 seconds apart,
and shutdown or a 60-second timeout aborts the pass. Existing reminder-key
deduplication keeps a later scheduled check from inserting a duplicate.

## P14-25 — Recognize every high-priority task marker and surface undated tasks (19 October 2026; #1074)

Treat `🔺`, `⏫`, `[priority:: highest]`, `[priority:: high]`, and their
parenthesized forms as high priority, case-insensitively with flexible spacing.
Keep the legacy `priority:: P1 - High` form. `🔼`, `🔽`, `⏬`, medium, low,
lowest, plain prose and missing priority remain normal. The shared todo parser
strips these markers from displayed task text; the existing two-level
high/normal contract stays unchanged.

For open high-priority tasks without a due date, create one deterministic digest
finding per Copenhagen day and unchanged normalized task set, listing the count
and up to five titles. Use the existing `todo` category with `normal` urgency and
no due time: it fits a task digest, remains outside the time-critical alert
mapping, and requires no schema migration. The digest is deterministic and adds
no model call; reminder rules and deadline alerts are unchanged.

## P14-23 — One shared web date-time format (19 October 2026)

Use `apps/web/src/format/date-time.ts` for user-visible web date-time, date-only
and time-only values. Default to `en-GB`, medium date plus short 24-hour time,
and the browser timezone for instants; date-only strings are calendar dates and
format as UTC so their day never shifts. Use `hourCycle: 'h23'` so midnight
stays in the 00–23 hour range. Optional locale and timezone arguments preserve
deliberate content-language and display-zone choices for instants. Return an en
dash for missing or invalid values by default so rendering never throws; callers
may supply a display fallback for valid-but-unparseable legacy values. Keep
relative times, chart/calendar labels, data values and non-web formatting
outside this presentation helper. Daily brief timestamps remain verbatim
because their timezone is unknown. Daily and Proactive wrappers remain thin to
preserve their explicit Europe/Copenhagen zone and Danish content behavior.

## P14-17 — Empty and loading messages share the error surface, with a scoped reset list (19 October 2026)

`StateMessage` gave only its error variant a surface, so the empty and loading
variants were faint muted text directly on the 3D scene (A22), and the wrapper
around every skeleton loader was a grid item of the shrink-wrapping message, so
the `rows`, `lines`, `image`, `panel` and `cards` placeholders collapsed to their
content (A49). The surface now belongs to the empty and loading variants too
(`--surface-translucent` fill, 1px `--rule` border, `--radius-panel`, `--space-3`
inline padding), declared inside `:where()` so its specificity is zero and a
component's own surface (`.usage-empty`, `.project-empty`,
`.workspace-pin-feedback`) wins without an override.

Inside a container that already has a surface the message must stay flat or a
card sits inside a card. The issue proposed a reset for two containers
(`.settings-section`, `.jobs-popover`) on `.state-message`. That selector would
also strip the error variant's own surface, and a census of the 68 call sites
found fifteen more surfaced containers that host an empty or loading message:
chat windows and bubbles, Folio, release sections, the task card and release
bar, the memory detail, the context panel, the knowledge note, the Proactive
page, Kanban columns, modals and the Create-project dialog parts. The reset
therefore names 17 containers and only the `--empty` and `--loading` variants.
The list lives in `styles.css` next to the default; a container that gains a
surface and hosts a state message has to be added to it, and a stylesheet test
pins the list. `.jobs-popover` has no call site today and stays on the list
because the issue named it. The `partial` variant sits beside existing content
and is not surfaced.

The wrapper gets a class, `state-message-skeleton`, instead of a
`:has()` selector on its `aria-hidden` attribute: the class is stable, can be
asserted in tests and keeps the markup's accessibility attributes unchanged.
The `image` placeholder keeps its own `min(320px, 100%)` cap, which the loader
sets on purpose for a fixed 4:3 slab, so it fills the width of a narrow message
but not of a wide one. The `.knowledge-loader` overlay covered the whole graph
pane, so a surface on it would have hidden the pane; it is now a compact card
centred like `.knowledge-status`, sized to its content (`width: max-content`,
`max-width: min(420px, 90%)`), because an absolutely positioned box at
`left: 50%` otherwise shrink-wraps to half of the pane. The `cards` loader hid
every column at 700px and narrower because `.skeleton-column:nth-child(n + 2)`
counted the visually hidden label as the first child; sibling combinators skip
it, and no breakpoint was added.

## P14-15 — Nested section titles wrap, the save row has no frame, touch targets in the task window (19 October 2026)

The whole-app pass found five small CSS defects in Settings and the task window
(A44 to A47, A50). The choices worth recording:

- A nested collapsible section's title wraps rather than being cut, and nested
  toggles use `--type-subsection` (17px) instead of the 22px of top-level titles.
  The whole title stays readable on a 320px phone, the chevron keeps its place,
  and a nested section reads as a child of the section around it.
- The padding under an open section applies to that section's own inner only. A
  folded section nested in an open one is as tall as any folded top-level
  section; the dead space under it came from a selector that also matched
  descendants, not from a design choice.
- "View event payload" and the project and branch chips in the task window are
  44px on coarse pointers only, following the DESIGN.md rule that compact
  controls return to 44px on touch. Fine pointers keep the compact chip and the
  caption-size disclosure.
- Save settings stays a plain end-of-page row (P9-98). The leftover 1px frame
  came from the base `.settings-save` block and is removed rather than
  replaced with new chrome.
- The News feeds row stretches its controls to one height, and "Add feed" keeps
  its content width at the start of the row.

Not verified: the News feeds row and the Save row at 1440px (the harness captures
stop at 1600px), and real touch devices.

## P14-16 — Phone top bar drops Settings and, on narrow handsets, presence (19 October 2026)

At 320px the phone top bar needed 353px of the 300px its content box leaves
(brand 47px, background-work cluster 122px, then windows, presence, Menu and
Settings at 44px each), so every route scrolled sideways by 45px. The row is
made of 44px touch targets that must not shrink, so a control has to leave the
row rather than be squeezed. Settings is already a row of the Menu sheet, so the
gear is hidden at every phone width with one `display: none` on
`.app-shell[data-phone="true"] .settings-link`. Hiding it only at 320px would
give the header a different set of controls per phone width and leave 321px to
380px one control short of the same overflow whenever the database-wake mark
(32px) or longer counts appear; a landscape phone also loses the gear but
keeps the Menu. Presence is the second control with a copy in Settings
(Settings, Presence), so it is hidden at 380px and narrower and shown above.

The query is `max-width: 380px`, not the 360px the issue proposed:
`styles.test.tsx` pins the stylesheet breakpoints to 380, 700, 900 and 1200px,
a 360px query adds a fifth value and fails that contract, and 380px is the
documented narrow-handset exception. The cost is that 361px to 380px phones
lose the presence chip too. The DOM is unchanged, so accessible names, the tab
order of the remaining controls and every handler are as before; `display: none`
takes the hidden controls out of the tab order and accessibility tree. The header
focus fallback (`focusHeaderFallback`, used when the last attention item is
dismissed and its trigger unmounts) looked up `.jobs-summary`,
`.presence-chip-trigger` and `.settings-link` in turn, and focusing a hidden
element does nothing, so on a narrow phone with no background-work summary focus
would have fallen to the page. It now tries the Menu button before the Settings
link and takes the first control that accepts focus.

The phone Menu takes a `proactiveEnabled` flag (default off) and lists Proactive
after the first area, the order of the rail (`appAreas`): after Daily when Daily
is on, after Jarvis otherwise. `MobileShell.tsx` keeps its own short list rather
than importing `areas.ts`, which would pull the whole app tree into the shell
module; `App.test.tsx` compares the phone Menu with the rail so the two cannot
drift. Open risk: the 320px row with the database-wake mark has about 3px to
spare, and counts of three digits in the background-work cluster add roughly 3px
per pair.

## Header focus fallback must not override newer focus (19 October 2026; fix-main)

The Attention popover returns focus to a header control through
`focusHeaderFallback()` when its trigger has left the page (for example the
popover unmounts while open). That call queues a `requestAnimationFrame`, and
the frame callback looked up a header control and focused it without checking
where focus was by then. A frame queued by one test's teardown could fire during
the next test, after that test's popover had taken focus, and move focus to the
new trigger. The popover then never held focus and the wait ran to its 4 s
budget. This is the "closes on Escape and returns focus" failure seen on CI. It
was not a slow worker, so the `asyncUtilTimeout` headroom recorded on
18 October 2026 (fix-main) could not fix it.

The frame callback now acts only when focus has fallen to the page
(`document.body` or nothing); focus that something else has already taken is
left alone. The legitimate rescue still runs: when the focused item is removed
and focus drops to the page, focus still moves to the header. Two regression
tests pin both sides. The first queues the fallback from an unmount, opens a
newer popover and runs the stale frame, and fails on the previous code with the
CI signature. The second checks that the fallback still moves focus to the
header. Under 16 busy processes on a 12-core machine the original tests failed
1 run in 80 before the change and 0 in 400 after. No assertion was loosened,
retried or skipped, and the timeouts are unchanged.

## P12-40 — Field clearance through custom properties (19 October 2026)

Fix select arrow and search icon overlap at the shared field rule, not per page.
That rule's `:is()` list takes the specificity of its most specific entry, so
its `padding` shorthand out-ranked every per-control padding override and the
clearance never applied. The shared rule now reads `--field-padding-start` and
`--field-padding-end` with the previous 12px default; selects set the end value
to `--space-6` and ellipsise the selected text, and the Tasks board search sets
the start value to `--space-7`. Custom properties cascade independently of the
competing shorthand, so no selector needs to out-rank the shared rule and
neither the rule's specificity nor any other field style changes. The Body &
sleep picker stacks to one column at 520px and narrower. No markup, copy,
route, token, dependency or data read changes.

## P12-38 — Daily visual QA corrections (18 October 2026)

Use the shared date-time helper for displayed Daily dates and times, retaining
the existing Europe/Copenhagen display timezone where it is known. Daily brief
timestamps have no known timezone and remain verbatim. Keep `dailyLocale()` for
number and duration formatting, not dates.

Standardize section presentation through the shared title → controls/filters →
freshness → “About this data” slot order, with the embedded Overview navigation
action beside the title so keyboard order still reads heading, Overview, then
filters. Use the established pill-tab class for
Data’s Table/Chart choice while preserving its button-group semantics, selected
pressed state, names and keyboard behavior. Align every value within a numeric
column alike, including “Not recorded”: a column is numeric when its schema says
so (a declared unit or an explicit flag), with observed numbers as a fallback, so
a page that records none still aligns. Text labels such as confidence stay
left-aligned. Use the shared secondary button for record-detail actions.

For sparse Body metric charts, keep one series and legend entry per metric/unit,
plot every recorded value, connect readings no more than three calendar days
apart, and start a new line segment after a wider gap. State that rule and that
values are not interpolated in the chart text alternative. This presents
short-interval readings without disguising larger missing-data gaps or creating
observations; existing summaries, routes and contracts remain unchanged.

## P12-37 — Daily accessibility and keyboard audit (18 October 2026)

Keep Daily's routes, visible copy, reads and switch behavior unchanged. Give
sparkline images a bounded, value-bearing text alternative: up to seven slots
list each observation and preserve gaps as “Not recorded”; longer series state
the recorded count, first, last, lowest and highest values, so a 366-day period
cannot produce a multi-thousand-character name. Dated values remain in the
section tables and the Data section. Table first cells are row headers, and
each record-detail trigger's `aria-controls` continues to reference a labelled
region while that region is closed. Keep record details nonmodal and preserve focus entry,
Escape/close, and focus return without trapping the background. Add focused
Testing Library and reduced-motion guards; record audit evidence and browser
limitations in [`ui/p12-37/audit.md`](ui/p12-37/audit.md). No new dependency,
API, route, token or data read is introduced.

## P14-12 — Shared colour tokens and contrast (18 October 2026)

Resolve contrast at shared token roles, not route-specific CSS. Tie the
text-bearing stage slabs to `--surface-translucent`, give chart series a
dedicated warm token, and adjust only the light graph marks and failing
success/error colors plus the dark error surface. Keep status and selection
meaning available through labels, icons, state text, line patterns and data
tables; allow low-opacity chart fills only as secondary cues with explicit
reasons.
Kanban page-level helper and live-status text uses `--surface-translucent`
instead of relying on scene-dependent contrast; empty-state text stays within
the existing `--board-slab`.

Normal text must measure at least 4.5:1 and large text/meaningful non-text at
least 3:1 over both stage extremes. Keep disabled states legible and distinct.
Shared layout and state coverage stay the same across themes; the dark-only
stage animation is decorative. More-contrast and forced-colors modes strengthen
focus and controls with system-aware colors, and system reduced motion disables
the active voice-status glyph animation. The reproducible 796-measurement
before/after matrix, token values and exceptions are in
`docs/ui/p14-12/contrast-table.json`; synthetic Chromium captures are in
`docs/ui/p14-12/screenshots.md`.

## P12-36 — Daily responsive and consistency polish (18 October 2026)

Keep this audit presentation-only: preserve the existing owner-only reads,
loaded data, URLs, accessible names, behavior and section ownership. Reuse the
Daily kit's space/type/surface tokens and shared primitives rather than
normalizing content-specific empty states, freshness placement or chip meaning.
Use a conditional edge fade for the overflowing Daily shell tabs without a
native scrollbar; keep Nutrition view tabs in their contained horizontal scroll
region.
At narrow widths, choose readable controls, equal-height Body shortcuts and
wrapped stat notes without clipping or fabricating values.

`DailyChart` stays in measured CSS-pixel geometry. Reserve y-axis space for the
actual formatted ticks, and reduce categorical tick density instead of shrinking
or overlapping its date labels. Keep the established pixel-sized SVG text
exception and do not add scale-ratchet allowlist entries. Guard table wrappers,
fixed-width styles, narrow grid rules and stat-note wrapping with existing web
tests. Synthetic captures and the complete audit matrix live in
`docs/ui/p12-36/`; they are not live-data or original-site acceptance.

## P12-34 — Daily Data presentation (18 October 2026)

Keep the existing record-browser state machine and reads; replace only its
presentation with the Daily kit. Use a sticky table at 700px and above and
compact record cards below it, rather than requiring sideways table reading on
phones. Put all fields and units in a labelled inline detail region, preserving
null as “Not recorded” and zero as zero. Keep raw JSON nested and collapsed,
and return focus to the row control on close or Escape. Workout and brief
drill-down actions remain available inside the record detail.
Preserve detail selection across same-query refreshes by record identity,
including refreshed ordering; recover focus if the selected record disappears.

Keep one freshness line beside the collection picker and Refresh; move loaded
period, processing time and unknown-completeness evidence to the existing source
disclosure. Reuse `DailyChart` without changing plot choices or observations.
State unavailable pagination directions in text. Keep sync facts and brief
bodies readable without nested panel boxes. No new dependencies, tokens,
backend behavior, real-data acceptance or original-site cutover follows.

## P12-32 — Daily Body & sleep presentation (18 October 2026)

Keep the rebuild presentation-only: Body and Sleep use the existing parent-owned
period, `?metric=`, `?view=` and `?night=` state, existing `useDailyPages`
requests and five-page cap. Do not prefetch other metrics to draw shortcut
sparklines; the catalogue has dates and counts, not values, so an unloaded
metric is labelled as loading on selection. Do not infer a Sleep source where
the query projection omits `source_json`. Preserve unknowns, per-unit separation,
missing-night gaps, refresh state and focus return.

Use the kit's “About this data” disclosure and `DailyChart` data-table disclosure
instead of visible record-browser status/caveat blocks and tables under every
chart. The shared chart's optional `dataTable` argument only replaces its
disclosed generic table for that consumer; existing chart consumers retain the
default. The period control moves into Body & Sleep while the same period state
and callback remain in `DailyHome`. Synthetic-only visual captures are in
`docs/ui/p12-32/`; they do not establish original-site parity or live-data
acceptance.

## P12-31 — Nutrition presentation and phone-safe kit (18 October 2026)

Compose Nutrition from the existing Daily kit without changing its reads, URL
state, paging or configured-target calculations. Present calories and macros
as text-backed meters, retain unknown totals rather than zero, and qualify
lower bounds beside the value. Keep the calorie comparison explicitly a
baseline before activity, not a full allowance. Do not infer carbohydrate or
fat targets. Group expandable meal rows with their subtotals and put unknown
secondary nutrients in one closed disclosure rather than empty tiles.

Use per-macro trend charts and chart-local data tables, with compact weekly
averages retaining their known-day counts. Preserve gaps and all record details.
Make shared chart geometry container-width-aware, use matching line-pattern
legend marks, and fill the last phone statistic row. No new dependency, token,
backend behavior or original-site cutover is part of this change.

## Share overlay stacking and modal lifecycle (18 October 2026; P14-09 / #992)

Keep the existing React overlays and controls; add no UI library. Name stacking
roles once in `styles.css`, isolate workspace depth, and share modal focus,
inert-background, viewport and scroll-lock handling. Keep dialog actions in
their existing order contract and associate footer submit buttons with their
original forms. Protect edited forms from implicit dismissal without removing
explicit cancel/close actions. Keep nonmodal menu keyboard behavior separate.
Exit copies are inert and hidden from accessibility; persistent sheets become
inert immediately on close, without waiting for their visual transition.

Portal workspace pin feedback into an in-flow shell host before route content.
The previous fixed workspace placement overprinted page headings and could
intercept the Factory Create project action. Persistence, alert copy and retry
behavior are unchanged. Synthetic browser evidence is not live-provider or
physical on-screen-keyboard verification.

## Separate read-only vault tasks from Notes (18 October 2026; P13-19 / #1015)

Personal to-dos remain checkbox items in the proactive reader's shared scope:
recursive `Personal/` and `Work/` notes and the root `task.md` or `tasks.md`,
excluding hidden paths and Archive segments. Jarvis exposes them in an owner-only
Tasks view, Notes task-search group, and the read-only tasks kind of `vault_search`.
The same parser and direct vault read model serve the proactive engine and these
surfaces. At the time this design was recorded, tasks shared `vault_search`
through a flat `kind` argument to preserve the then-required eight-tool
headroom. #1204 supersedes that count-based rationale; the existing API shape
remains and no new capability is implied.
Jarvis never creates, edits, completes, reorders or deletes the owner's tasks;
the owner completes them in Obsidian. Software Factory remains the separate
agent-work board.

## #1005 Daily v182 API, upload and selected native tools (18 October 2026)

Keep this delivery on the existing backend, SQL pool, owner authentication and
tool/confirmation flow. Do not create a parallel API, store, auth service, MCP
runtime, Azure resource, or revive the withdrawn Daily export/import route.
`JARVIS_HEALTH_UPLOAD_ENABLED` remains false by default in code and is set to
the exact string `true` in the reviewed backend deployment environment; rollback
sets that value to `false` and changes the pin test in the same commit. Existing
credential hashes and accepted data remain untouched by rollback.

The owner creates the upload credential in Settings after deployment. SQL stores
only its hash; plaintext is revealed once through the owner-authenticated,
no-store response. The endpoint comes only from configured backend origin, never
forwarded headers. A private handoff, deployment, and phone acceptance are not
claimed from source changes or synthetic tests.

Retain all 16 owner-selected Daily v182 capabilities and exclude fixed status
renderers, coach commitments/orders/experiments, meal plans and Apple Health meal
write-back. Use the existing owner authorization and confirmation flow for
writes, and preserve unknown values as unknown. The nine remaining source
operations were grouped into three native registry tools under the then-enforced
eight-tool catalogue reserve. #1204 supersedes that count-based rationale; the
grouping still does not meet the explicit request for nine distinct tool names
and must remain reported as a mismatch rather than described as complete.

Historical batches must preserve complete source metric/date groups, remain
within 8 MiB ingress, 10,000 normalized rows/8 MiB output and 256 MiB/10,000
retained inbox rows per owner. These limits do not establish source completeness
or exporter UI behavior; mark the latter unverified and do not claim replay or
physical-phone acceptance. Evidence and unresolved field/HTTP differences are
tracked in `docs/reference/daily-v182/source-to-jarvis-matrix.md`.

## P12-33 — Daily Overview as a today dashboard (18 October 2026)

Reuse the Daily kit and existing readers rather than create another dashboard
data layer. Put the latest workout, logged nutrition day, measurement, sleep
night and brief in one responsive grid; keep each section link, honest state
and compact read timestamp. Use the already-loaded nutrition baseline only,
not an invented activity allowance. Null readings remain gaps and different
measurement units never share a sparkline. Break same-day workout ties by
recorded start time. Keep meter positions within their accessible range while
announcing the actual over-target total and any lower-bound qualification.

Replace repeated collection-purpose paragraphs with one “About this data”
disclosure and compact labelled coverage rows. Errors and Retry stay inline;
empty health coverage links to Settings upload without claiming that older
records do not exist. Preserve refresh, probes, query limits, navigation, focus
return and the live-region summary. Refresh must retain both populated and
empty cards rather than return them to skeletons. The embedded view has no
second page heading. This is presentation-only; original Daily remains
canonical, and Nutrition/Body & sleep section ownership is unchanged.

Synthetic Chromium evidence is saved in `docs/ui/p12-33/`; it verifies local
fixtures and responsive/keyboard behavior, not live records or physical devices.

## P12-35 — Daily Briefs as a reading experience (18 October 2026)

Keep brief history and detail on their existing owner-only readers and make the
stored record readable without changing its meaning. Group by the date text as
stored, not by a timezone-adjusted calendar date; keep unknown values labeled.
Use one full-row control per openable history item and keep status/delivery
meaning in text. Render structured body values as readable lists, with original
JSON available only on demand. Adjacent navigation is constrained to already
loaded history and moves focus to the new reading heading; Back restores focus
to the opener. No new reads, dependencies or tokens are introduced.

Synthetic browser captures are in `docs/ui/p12-35/`; they verify the local
synthetic presentation, not live data, original-site parity or physical devices.

## P12-30 — Daily presentation kit and Workouts (18 October 2026)

Move long retained-data caveats into the native “About this data” disclosure,
but keep partial/lower-bound meaning beside the displayed value and keep unknown
distinct from zero. Keep every chart’s raw values available through a disclosure
attached to that chart rather than rendering a table below every visualization.
Charts retain responsive geometry, direct series labels, explicit data gaps and
keyboard point inspection. Workouts uses the shared kit in one responsive
history list with a disclosed table; URL, paging, sorting, filtering and focus
return stay owned by the existing section. These are presentation changes only;
the original Daily remains canonical and no new data reads or dependencies are
introduced.

Daily svg sizing rules must out-rank the shell’s `.app-shell svg` icon size
(specificity 0,1,1, emitted after the Daily stylesheets in the production
bundle); an equal or lower specificity rule silently loses and the chart
collapses to a 21px sliver. Prefix such rules with `.app-shell` (or size the svg
inline); `svg-cascade.test.ts` enforces this for every Daily stylesheet.

## Share non-Daily loading, empty, error and partial states (18 October 2026; P14-11 / #994)

Use one `StateMessage` component around the existing Loader for non-Daily
loading, empty, error and partial states. Keep one plain sentence, optional
detail, and at most one shared-button recovery action. Loading, empty and
partial states announce politely; errors use alerts. Reserve a 10rem minimum
block size for loading, empty and error states (partial notices reserve none),
use skeletons only for known final layouts, and keep error copy
free of raw exception text, identifiers and codes. Daily retains `DailyState`
until its separate follow-up; this avoids crossing the parallel page boundary.

## Consolidate web viewport breakpoints (18 October 2026; P14-05 / #973)

Use one non-Daily viewport set: phone through 700px, tablet above 700px through
900px, desktop above 900px, and wide from 1200px. Keep 380px only for narrow
handset chat, voice and control fit; preserve the task-board 1099px and task
detail 720px thresholds as container queries because they respond to allocated
component width. Daily's existing 640px and 760px media rules are untouched
because that page is being built in parallel. The responsive probe and every
boundary comparison are recorded in `docs/ui-audit.md` under "Pass 3:
responsive and overflow".

## Discover vault tasks in source notes using native Tasks markers (18 October 2026; P13-18 / #999)

Read safe Markdown notes under `Personal/` and `Work/` recursively, including
their inboxes, and the existing root `Task.md` or `Tasks.md` dashboard.
Exclude Archive path segments (case-insensitive), hidden paths and unsafe note
paths. Preserve ambiguous-root detection, but allow scoped notes without a root
dashboard. This supersedes the root-only read scope of P13-07.

Treat native `⏫` as P1 - High alongside legacy `priority:: P1 - High` and
`priority: P1 - High`. `🔼` is P2 - Medium; no priority is P3 - Normal.
Neither those values nor `🔽`/`⏬` qualifies for findings or reminders.
Assumption: `🔺` is outside the supported priority scale and is not high.
Parse `🕒 HH:mm` independently of its position around `📅 YYYY-MM-DD`,
using Copenhagen local time. Preserve trailing date/time and legacy due fields;
date-only tasks remain due at 23:59. Strip clock/time, priority and the existing
Tasks metadata emoji and their recognized date, recurrence, ID and
completion-action payloads from reminder/finding text, and ignore fenced examples.

Share parsed-task caching by vault client, path and tree blob SHA between the
source and ticker. Bound each scan to 256 files, 4 MiB total content, 256 KiB per
file and four concurrent reads, retaining the 20-second deadline. Unknown blob
sizes reserve 256 KiB. A skipped oversized file, cap, failed read or tree/content
SHA race makes the whole scan unavailable, not empty or partially successful;
the ticker retains its bounded verification retries and suppression policy.
Only complete scans replace the cache. Reminder identity stays normalized text
plus due instant, independent of path, and duplicate facts are collapsed before
the fact cap, preserving explicit-time eligibility across duplicates.
The 30-second ticker cadence and existing one-hour reminder lead
time, flags and release controls are unchanged.

This writer destination and selection rule was superseded by P13-20/#1186 below.
At the time, the root-only, add-only "Suggested by Jarvis" behavior was retained.
Limitation: suggestion deduplication still checks the root file and durable
receipts, not all source notes. Widening it would couple writes to scan limits,
failures and snapshot freshness; defer that write-path change.
Validation uses synthetic notes only, not private vault content or live delivery.

## Use one refined button hierarchy across the web app (18 October 2026; P14-03 / #969)

Keep the existing class names and route behavior while making button intent
visible in the shared stylesheet. This decision's flat primary fill and lack of
button rims are superseded by P14-07 below; its hierarchy, route behavior,
control radius, semantic state tokens, and no-new-palette constraints remain.

Buttons no longer carry layout margins. Shared action groups own spacing,
wrapping, phone stacking and primary-last ordering. Busy controls keep their
disabled state and accessible name while the shared inline Loader overlays a
label that still reserves the button's width. This is a presentation-only
change, not a change to actions, confirmation boundaries or API behavior.

## Redesign primary and secondary button surfaces (18 October 2026; P14-07 / #990)

Dan's direct instruction on 18 October 2026 authorizes a button-only appearance
change, superseding the flat primary fill and no-glow constraints in Shared
control geometry and P14-03. Primary and filled danger use token-based tonal
gradients, a real tinted border and one calm accent-colored shadow; hover
strengthens the shadow and pressed state darkens the fill. Secondary and
unfilled danger use visibly bounded tinted surfaces, while ghost stays
text-only. Focus uses a two-band ring so its inner page-colored separator
contrasts with the button and the outer `--focus` outline contrasts with the
page. More-contrast and forced-color modes remove decorative gradients/glows;
reduced motion removes state transitions and press movement.

The composer send and Factory job “Open” controls retain their specialized
classes and dimensions but share primary styling and states. Factory task
creation and Settings save were already shared; the Factory “Create project”
action now keeps shared secondary styling. “Jump to latest” stays a contextual
utility with a surfaced neutral boundary and shared radius/focus. The voice orb
remains specialized because it represents voice-mode entry rather than a
primary action. Button behavior, handlers, accessible names, routes, size
system, action-group spacing and confirmation boundaries are unchanged.

## Notify only on P1 - High vault tasks (18 October 2026; #996)

Proactive todo findings and reminders are eligible only for open vault tasks
explicitly marked `priority:: P1 - High` or `priority: P1 - High` (extended to
native `⏫` by P13-18 above). Missing and
lower priority values are not notification-worthy. Re-check priority at reminder
delivery; if the vault cannot establish the current priority after bounded
retries, suppress rather than send an unverified reminder. This reuses the
existing parser, proactive sources and reminder lifecycle without a migration.

## Discover Daily sections from folders (18 October 2026; P12-20 / #964)

Daily keeps one destination and discovers section definitions from
`sections/*/index.tsx`, not a shared hand-maintained registry. Definitions are
loaded from the lazy glob's small entry chunks because the tab switcher must
know each label, order, period behavior and source requirements before a section
is selected. Each entry lazy-loads its actual content component and queries.
Required-source filtering prevents dead tabs, and `?section=` preserves the
selected section across reloads.

One page-owned Copenhagen period is shared only with sections that opt into it.
The shipped set stays Overview, Briefs and Data; future Workouts, Nutrition and
Body & sleep folders register without changes to the shell. There is no new API,
query semantics, navigation destination or generated-view renderer.

## Withdraw the Daily database export/import approach (18 October 2026)

The offline P12-22/#968 bundle validator was a delivered synthetic-only
prototype; it did not read source records or establish data parity. The owner
cancelled the Sites database-export/bundle-import approach. Its tools and
dedicated documentation were removed under #1006. PRs #741 and #987 remain
closed and unmerged; #717, #721 and #982 are not planned and are not migration
prerequisites.

Use the source-contract-first direction in #1005 for the original Daily API and
schema, the corresponding Jarvis API/SQL schema, and supported historical
ingestion/replay. Retain [Daily source-to-SQL mapping](daily-schema-mapping.md)
as implementation evidence, not as an export manifest or authorization to
import a database bundle. Permanent health upload/processing, SQL migrations
and original Daily are outside this cleanup.

## Give asynchronous test waits headroom on loaded CI runners (18 October 2026; fix-main)

Web tests such as the attention popover focus return and the workspace pin
loading recovery failed intermittently in CI at about 1.0 s, the Testing
Library `asyncUtilTimeout` default, and passed on rerun with no code change.
Each assertion was about to hold; a loaded runner had stalled the worker for
longer than the budget. The web test setup now sets `asyncUtilTimeout` to 4 s,
and Vitest's `testTimeout` is 15 s so that a wait which does fail reports its
own assertion rather than a generic 5 s test timeout.

No assertion, retry or skip was added or loosened. A wait whose condition never
holds still fails, after at most 4 s instead of 1 s. This is a unit-test wait
budget only; it does not change the release, acceptance-evidence or
worker-start timeouts recorded elsewhere.

## Preserve attention dismissals across backend restarts (18 October 2026; P9-123 / #962)

Policy-blocked reasons are de-duplicated transactionally against task event
history, including overlapping backend revisions. The same reason is recorded
again only after a task state change; a different reason is recorded immediately.
No existing rows are migrated or removed, and feed selection is unchanged.

PC bridge persistence changes only when the status title changes. Startup allows
two minutes for reconnection before recording offline, and shutdown records
nothing. Live socket status remains immediate. This separates restart noise from
real attention changes without hiding an offline bridge indefinitely.

## Draw slim desktop scrollbars and keep glass rings off scrolling surfaces (18 October 2026; fix-main)

`.luminous-glass::before` is a 1px ring drawn at `inset: -1px`. Inside a scrolling
container that overhang counts as scrollable overflow, so the Notes search results
and every modal showed vertical and horizontal scrollbars even when their content
fitted. A glass surface that scrolls now drops the ring (`.knowledge-results` keeps
a hairline border instead) or stops being the scroller (`.modal` no longer sets
`overflow`; a card taller than the viewport scrolls with its backdrop).

Chromium and Safari add arrow buttons to the standard thin scrollbar and ignore
`::-webkit-scrollbar` while `scrollbar-width` or `scrollbar-color` is set. With a
fine pointer the standard properties are therefore reset and the bar is built from
its parts: 10px wide, no arrow buttons, transparent track and a pill thumb that
lights cyan while the main scroll surfaces or the thumb are hovered. Touch screens
and Firefox keep the standard thin overlay bars. The Notes reader keeps its
stronger resting thumb, and the deliberately hidden scrollbars (tab strips, job
tabs, kanban pulse, phone legend) are unchanged. The hovered scroller also sets an
empty custom property, the documented workaround for Safari not restyling the
hovered thumb otherwise. `styles.test.tsx` pins the
approach. Checked in headless Edge before and after, in dark and light themes, and
with phone emulation; not checked on a physical phone or in Safari.

## Decide what Dan's approval means on the server, never with a word list (17 October 2026; P11-10 / #894)

**Confirmed user decision, awaiting Dan's live re-test.** After he approved two
bookings in his own words, Jarvis answered with a hard-coded list of approval
words and asked him to say one. Dan wants Jarvis to understand naturally when he
has approved, without any hard-coded approval words. Cause: "yes please, book
both" is not a whole-message match, so the relay did not intercept it, the
realtime model called the confirm tool itself, hit the refusal and read the list
out.

Two jobs that one word list used to do are now separate.

- **Provenance stays exactly as strict and stays deterministic.** Only a verified,
  later, Dan-authored message in the same session as the stage, inside the
  ten-minute window, for that specific pending action can approve it. The staging
  request never approves. The model, tool output, email text and any model-supplied
  flag never approve. Newly enforced: every Google stage is bound to the session
  that staged it (required field plus a runtime guard), so a message from another
  session, or without one, can neither see nor confirm it.
- **Meaning is decided by one bounded, fail-closed step** (`core/approval-interpreter.ts`).
  A plain full reply such as "yes" or "nej" is decided deterministically with no
  model call. Anything else goes to one small-model call that sees only Dan's single
  message and the exact staged summary (as untrusted data in random-nonce
  delimiters) and answers `{verdict: approve | decline | neither, confidence}`. The
  Foundry chat-role model runs at its lowest supported reasoning effort. The parse
  is strict, below 0.85 confidence counts as `neither`, the call times out after
  five seconds, and it is limited to 20 a minute and 4 at once. Results are cached
  by session, message, action and a hash of the summary and reply (ten minutes, 30
  seconds for a failure). Usage is recorded under the existing chat role. A named log
  event records family, verdict and path, never the words. Any error, timeout,
  garbage, low confidence or missing model means `neither`: nothing changes and Dan
  gets one short natural question. No refusal, tool description or instruction lists words.

One implementation covers Google calendar and Gmail writes, Software Factory
archive and issue creation, and GitHub App writes.

Routing is pending-driven. A probe runs on any follow-up turn with a calendar
proposal in the last two messages instead of matching a phrase. The classifier sees one
message and the summary, not the turns between, so a stray "yes" meant for
something else while a change is staged can approve it. That is bounded by the
same-session, later-message and ten-minute rules.

Rejected: a longer phrase list (it is the bug); the Decision providers (Jev,
Microsoft-Decision-1), which would send email-derived summaries to a third party and
record no usage; letting the realtime or chat model decide and pass a flag, which
is the model-supplied approval that provenance forbids; classifying the whole
conversation instead of one message.

Degradation: with no model configured, a non-chat role model, a failing model or a
failed usage write, plain one-word replies still approve through the fast path and
everything else gets the natural question. An unpriced model is allowed and its
usage is recorded as unverified.

Accepted gaps. (1) The `pr_merge` failing-checks override gate (`saysProceed`,
`hasExplicitProceed`) still matches a phrase list; it overrides a check rather than
approving a staged action and is unchanged here, a possible follow-up. (2) In chat,
a reply the backend judged unclear, answered by a model that falsely claims success
without calendar words or a recognised opener, slips past the Python claim guard;
the backend still refuses every unconfirmed write, so nothing changes.

Offline tests drive the real tools and interpreter with a fake model, so they prove
plumbing, provenance and fail-closed behaviour, not model judgment. Real model
quality is unverified until Dan's live re-test, which closes #894. This supersedes
the whole-message-match safeguard of 12 October and the "plain approval" wording of
P11-01 and P11-03; every other safeguard there stands.

## Version Daily read-model additions without changing the page (18 October 2026; P12-21 / #966)

The owner-fixed source names and shapes are implemented additively through the
existing `DailyQueryService`. Capability v1 and v2 responses keep their original
source lists and serialized capability response bodies; only an explicit
version-3 Accept negotiation advertises the new source IDs in Daily
capabilities. The web client requests v3 but validates each version against its
own allowlist.

Metric filtering is exact by retained metric name. The catalogue aggregates
only retained health measurements inside the requested period and exposes at
most five sorted non-null units per metric. Per-day nutrition totals aggregate
only retained, non-deleted meals: all-null nutrient sums stay null, partial
totals are marked lower bounds, and dates without meals remain absent. These
totals are derived evidence, not retained source records. Completeness and
freshness remain unknown.

Both reads reuse the current owner authorization, SQL connection and query
limits. No table, index, migration, refresh event or visible Daily Overview
row/layout is added; a measured query-plan need would be reviewed separately
before changing indexes. The existing generated-view tool can render these
version-3 results, and the nutrition-only MCP connector exposes per-day reads
under its existing read scope. No real health/food data, activation or change
to original Daily is included.

## Show Daily data on demand through the existing workspace (18 October 2026; P12-16 / #731)

**Builder decision inside Dan's "ship all daily if possible. You can take decisions
as I would", not an activation and not acceptance.** The overview page shows what
Daily holds; Dan also wants to ask Jarvis for it in chat or voice, so the answer
appears on screen the way other generated views do.

- One tool, no new surface. `daily_show` is the seventh Daily tool. It reads through
  the same owner-authorised read model as the page and `daily_query` and publishes
  through the existing workspace view lifecycle. It adds no endpoint, renderer,
  page, widget, GenUI engine, migration, account, consent, grant, secret, RBAC,
  resource or import, and no provider, device or private read or write.
- One bounded page, nothing calculated. A request is one page (at most 366 days and
  200 rows) with no cursor; brief history and single-record detail stay with
  `daily_query`. Stored values pass through with their units and dates, and a
  missing value is unknown, never zero.
- Provenance stays visible. Every table, chart and detail carries a footnote with the
  source, period, read time and "completeness and freshness are not established", and
  an empty read says so with its own read time. The renderer prints it beneath
  those three kinds only; list and text views keep their own note. Table cells keep
  whole words and numbers and a wide table scrolls inside its window.
- Refresh in place. View IDs are stable and keyed by what is shown, not by the date
  window, so asking again updates the same view instead of adding another.
- Owner and tab gates. The tool is sensitive and phone-denied, refuses a connector or
  a non-owner before SQL, and refuses before reading when no workspace tab is
  connected, pointing Jarvis to `daily_query` for a text answer. A 25-second
  deadline sits under the agent's 30-second read timeout, and a late success after
  it is a failure.
- Same switch as everything else in Daily. With Daily off, Jarvis is unchanged; with
  it on, the catalogue gains one tool. The former 128-tool limit is superseded by
  #1204. This change sets no
  flag. The reserved Status, Recomp, Review and Ready view IDs stay unused and #723
  stays withdrawn.
- Evidence and limits. Synthetic unit tests, the web renderer tests and a headless
  Chromium check at 390×844 and 1280×800 in both themes (DESIGN.md). That check
  caught two defects, split table values and an empty read without a read time, both
  fixed. It is not live data, a physical phone, keyboard or reduced-motion coverage,
  provider acceptance or Daily acceptance. Rolling back means reverting this change.

## Intent-led Health answers in chat and supported voice (23 October 2026; #1243)

Owner-approved follow-on to #731 and the shared read/target coverage delivered in
#1197/#1198. “nummer 6 skal være med sprogforståelsen og ikke være båndet til tabel
eller chart” means Health assistance should understand the question before choosing
its answer, rather than hardwire nutrition to tables or measurements to charts.

- The existing model interprets Danish or English requests and conversational
  follow-ups, choosing a source, period, metric and response form from intent.
  Straightforward facts and explanations stay in the conversation; explicit table
  or chart requests are honored where supported, and a useful trend may use a
  visual. The shared tool descriptions keep this behavior consistent across chat
  and supported browser voice.
- The model's choice is not an authorization or a renderer contract. Existing
  `daily_query` schema validation, `daily_show` source/date/selector/page checks,
  owner and channel guards, generated-view validation and Workspace acknowledgments
  remain authoritative. Missing target, unknown values, partial pages and
  lower-bound nutrition totals stay explicit; the model cannot infer a cause from
  differences alone.
- Reuse `daily_query` for actual saved step targets and requested-period history.
  Reuse existing per-day nutrition totals for a chart of one selected nutrient;
  the chart does not sum values, fill missing dates or imply full-period coverage.
  No new model pipeline, read tool, store, renderer, target write or Workspace
  lifecycle is introduced.
- Verification uses synthetic records, including selected nutrient charts,
  unknown/partial values, explicit table preference, and configured/unset targets.
  It does not establish live provider behavior, real Health data or physical-device
  acceptance; preserve unsupported phone restrictions.

## Switch proactive todo additions, alerts and reminders (milestones 3 and 4) on in production (18 October 2026; P13-15 / #936)

Dan said "Ship all proactive if possible, you can take decisions as I would, as
good as you can, we can always change it". That delegates the decision and
authorises switching milestones 3 and 4 on once they shipped dark; #936 records it.
The gate is that the todo writer (P13-11), alerts (P13-12) and reminders (P13-13,
#954) are merged and deployed with their switches off, and that the P13-14 checks
deployment is accepted, before this change merges. The Dispatcher merges it. This
supersedes the "dark" and "default-off" decisions below for todo additions, alerts
and reminders in production only; the code defaults stay off.

Two lines do it. `infra/main.bicep` sets `JARVIS_PROACTIVE_TODO_WRITES_ENABLED` and
`JARVIS_PROACTIVE_ALERTS_ENABLED` to `'true'` in the backend container app, beside
`JARVIS_PUSH_ENABLED` and `JARVIS_PROACTIVE_ENABLED`. There is no web flag,
parameter, secret, resource, identity, dependency or application code change.
Reminders ride the alert flag, so they add no flag of their own. The existing pins,
`todo-writes-default-off.test.ts` and `alerts-default-off.test.ts`, are updated in
place (names kept, as `daily/default-off.test.ts` was when Daily went on) from
"named nowhere" to "named once, in `infra/main.bicep`, with the exact value
`'true'`". `config.test.ts` still proves both default off in code.

What Jarvis may now do, and the limits that stay:

- Todos (destination and selection superseded by P13-20/#1186): add new lines
  under a `## Suggested by Jarvis` heading in the owner's
  existing todo file, each ending with a small hidden marker. It never edits or
  deletes an existing line and never creates the file. At most 3 lines per check and
  5 per Copenhagen day. It follows the pause and Todo list source switches.
- Alerts: send a push only for a time-critical finding (a todo due within 24 hours,
  or a calendar clash starting within 48 hours) found by the 07:00 or 18:00 check or
  its catch-up; at most one push per check, at most 3 a day, never between 22:00 and
  07:00, never for "Check now". Everything else waits on the Proactive page.
- Reminders (generic copy superseded by P13-21/#1194): one push about an hour before a todo with an explicit time is
  due, at most 8 a day; the todo title and due time sit in the private Proactive
  item it opens. A reminder due in the quiet window is held until 07:00 and shown as
  due soon or overdue.

Dan can switch it off without a deploy: Settings → Proactive → "Pause proactive
checks" stops all of it, including reminders already planned; the "Todo list" source
switch stops todo additions and new reminders; Settings → Notifications → "Turn off"
stops pushes on that device. Rollback by deploy: revert the whole P13-15 change (removes the gate lines
and the pin test updates together), or set the value(s) to `false` AND update the
pin tests in the same commit. Removing only a line would fail the pin tests in CI
before Deploy could run. Either way no todo is added and no alert or reminder is
sent; lines Jarvis already added stay in the todo file, and findings, feedback,
settings and send history stay in SQL.

CI proves this wiring only. Whether a todo line is added, and whether an alert or
reminder push reaches the iPhone, is for Dan's test on the deployed app. Open,
unchanged here and already noted in the P13-14 entry: Dan's 17 October decision
("Quiet hours and language", #926) says quiet hours also apply to manual checks, but
the shipped engine lets "Check now" run at any time, so the writer can add todo
lines on a manual check at night. Pushes never go out between 22:00 and 07:00.
Making manual checks respect quiet hours would be a separate code change that Dan or
the Dispatcher decides.

## Switch proactive checks (milestone 2) on in production (18 October 2026; P13-14 / #935)

Dan asked for all of proactive assistance to ship and authorised switching
milestone 2, the read-only checks, on once the slices (P13-05 to P13-10) shipped
dark; #935 records both. The gate is that those slices are deployed with the
switch off and accepted before this change merges, and that web push (P13-03) is
live. This supersedes the "dark" and "default-off" decisions below for checks in
production only; the code defaults stay off.

Two lines do it. `infra/main.bicep` sets `JARVIS_PROACTIVE_ENABLED` to `'true'` in
the backend container app, beside `JARVIS_PUSH_ENABLED`, and the web build step in
`deploy.yml` sets `VITE_PROACTIVE_ENABLED=true`. There is no new parameter,
secret, resource, identity, dependency or code change. Startup cannot newly fail:
the owner object ID the proactive routes need is already validated when the
backend starts. Two pin tests (`apps/backend/src/proactive/enabled-switch.test.ts`
and `apps/web/config/proactive-switch.test.ts`) pin both values and fail if
anything else sets a switch. The alert and todo-writes flags kept their own pins
(`alerts-default-off.test.ts`, `todo-writes-default-off.test.ts`), and this change
set neither; P13-15 (the entry above) switched them on.

Scope does not grow in this change. Milestones 3 and 4 (todo additions, alerts and
reminders) stay off here and are switched on separately by P13-15, so a check here
only reads its sources and stores findings: it writes no todo and sends no push.
Estimated spend keeps its decided limit: 100 DKK
a month by default, a warning at 80% and a stop at the cap, which Dan can change in
Settings. The first scheduled check runs at the next 07:00 or 18:00
Europe/Copenhagen slot, or once as a catch-up when the latest slot is under 12
hours old and the clock is outside 22:00 to 07:00; "Check now" runs one at any
time.

Rollback: revert the whole P13-14 change (removes the two gate lines and the pin
tests together), or set both values to `false` AND update the pin tests in the same
commit. Removing only the two lines would fail the pin tests in CI before Deploy
could run. Either way the routes and scheduler are not registered and the Proactive
page and Settings section drop out of the web build; stored findings, feedback and
settings stay in SQL.

CI proves this wiring only. Whether scheduled and manual checks run, what they find
and whether each source reads correctly in production is for Dan's test on the
deployed app. Open, unchanged here: Dan's 17 October decision ("Quiet hours and
language", #926) says quiet hours also apply to manual checks, but the shipped
engine and route let "Check now" run at any time, as `PRODUCT.md`, the architecture
notes and #935 state. Making manual checks respect quiet hours would be a separate
code change that Dan or the Dispatcher decides.

## Switch Web Push milestone 1 on in production (18 October 2026; P13-03 / #934)

Dan confirmed turning milestone 1 on: a user-started test notification that opens
an owner-protected item. His gate was met first: the P13-01 backend (PR #918) and
the P13-02 web client (PR #920) are merged and deployed, and live acceptance
passed. This supersedes the "dark" and "default-off" decisions below for
production only; the code defaults stay off.

Two lines do it. `infra/main.bicep` sets `JARVIS_PUSH_ENABLED` to `'true'` in the
backend container app, and the web build step in `deploy.yml` sets
`VITE_PUSH_ENABLED=true`. There is no new parameter, secret, resource,
dependency or code change: the VAPID key pair is generated on first use and stays
in SQL. A scan test pins both values and fails if anything else sets either
switch.

Scope does not grow: no scheduler, no proactive sends and no Teams path. CI does
not establish iPhone delivery; Dan's Home Screen device test is the acceptance
step. Rollback is reverting the whole P13-03 change, which removes the two gate
lines and the pin test together, or setting both values to `false` and updating
the pin test in the same commit. Reverting only the two lines would fail the pin
test in CI before Deploy could run. Stored subscriptions and the key stay in SQL
and, with the routes off, nothing can send to them.

## Open Daily on an overview behind a build-time switch (18 October 2026; P12-15 / #730)

**Builder decision inside Dan's "go with the daily", not an activation and not
acceptance.** Dan could not see what Daily holds ("I have no idea what is built
and cannot see anything"), so the page now opens on an overview.

- Overview first. The page lists each retained collection the backend exposes with
  one plain sentence on what it is for, and a status from a read-only,
  one-record check: has records, none returned or could not read. It uses only
  `GET /daily/capabilities` and `POST /daily/query`, so it adds no endpoint,
  writer, calculation, migration, provider call, account, consent, secret or
  import.
- Honest by construction. "None returned" never says the original source is
  empty, the sync summary alone does not count as records, and the overview shows
  no count, total or estimate. A failed read says so and offers Retry. A settled
  result stays visible while the next read runs, except a failure that is being
  retried.
- Gentle on the backend. Reads run two at a time because the SQL pool is shared
  with chat, and the overview does not refresh on window focus.
- One build-time switch. `VITE_DAILY_ENABLED` is read by the Vite build only:
  absent or `false` is off, `true` is on, and any other value, including an empty
  one, stops the build. It is baked into the bundle and never read from the URL,
  storage or runtime configuration. This change sets it nowhere, and
  `daily/default-off.test.ts` scans for it.
- Enabling is a separate change. Dan pre-authorised switching Daily on for his own
  account: "Yes, switch it on once it's live and checked." That change sets
  `JARVIS_DAILY_ENABLED` and `VITE_DAILY_ENABLED` after this page has been merged,
  deployed and checked in a real browser. Rolling back means reverting it or
  leaving the switches off.
- Evidence. A headless Chromium check against synthetic responses at phone,
  small-phone, tablet and desktop widths. It is not live data, a physical phone,
  provider acceptance or Daily activation.

## Proactive checks use an in-process fixed schedule (17 October 2026; P13 / #926)

Dan chose 07:00 and 18:00 Europe/Copenhagen and a manual “Check now” request at
any time. On Dan's behalf, the dispatcher chose a small in-process loop and an
atomic slot claim: the idle loop must not touch the database, which would wake
serverless SQL, and replicas must not claim the same slot. Dan can change either
choice.

## Quiet hours and language (17 October 2026; P13 / #926)

Dan decided that proactive work and delivery stop from 22:00 to 07:00
Europe/Copenhagen, with no emergency exception, and that output follows the
language of his last chat message. This keeps the quiet window clear without
restricting interactive requests; quiet hours also apply to manual checks. Dan
can change either choice.

## Sources are read-only and untrusted (17 October 2026; P13 / #928)

Dan decided that todos, Factory, weather, calendar, mail headers, calendar-derived
travel and news are read-only sources. Their content is data, never an
instruction, and system runs inherit no approvals; this prevents source content
from changing policy or authorising actions. Dan can change this choice.

## Monthly proactive budget (17 October 2026; P13 / #924)

Dan set a 100 DKK monthly hard stop and an 80% warning. The warning leaves room
to adjust before the limit; spend is an estimate and must be labelled as one so
it does not imply a settled bill. Dan can change the limit or warning.

## Todos are canonical and add-only (17 October 2026; P13 / #927)

Dan decided the vault todo file is canonical and Jarvis may add todos under its
own heading, but never edit, complete, reorder or delete existing todos. The
name remains open (`task.md` or `Tasks.md`); the resolver accepts exactly one
matching file and never guesses. This protects Dan's entries; Dan can change
the policy or settle the name.

## Only time-critical findings may buzz the phone (17 October 2026; P13 / #932)

Dan chose alerts only for a deadline within 24 hours, a calendar clash or a
travel disruption, plus a reminder about an hour before a todo is due. Quiet-hour
reminders wait until 07:00 and appear as due soon or overdue; each run sends one
bundled push within daily caps. This limits interruptions; Dan can change it.

P13-12 implements only scheduled/catch-up time-critical run alerts. The bundle
contains only the most urgent item ID, kind, count and language; the worker uses
fixed localized copy, never payload title/body text. A maximum of three sent
bundles is counted per Copenhagen day, and an item alerts once per class/key
unless its first send failed, in which case it may retry once. Manual checks,
paused settings, quiet hours and non-new items do not notify. No per-class
settings are added now; Dan may choose per-class toggles as a later addition.

## Show every proactive run in Background work (17 October 2026; P13 / #930)

Dan decided every scheduled or manual proactive run appears in the header
Background work popover, first as running and then done or failed. This makes
background work and its outcome visible; Dan can change this choice.

## Enable proactive milestones one at a time (17 October 2026; P13 / #939)

Dan chose exact-`true`, default-off flags: push (`JARVIS_PUSH_ENABLED`,
`VITE_PUSH_ENABLED`), checks (`JARVIS_PROACTIVE_ENABLED`,
`VITE_PROACTIVE_ENABLED`), todo writes
(`JARVIS_PROACTIVE_TODO_WRITES_ENABLED`), and alerts/reminders
(`JARVIS_PROACTIVE_ALERTS_ENABLED`). The order is push (#934), checks (#935),
then todo writes, alerts and reminders (#936); the dispatcher enables each only
after the previous deployment is accepted, so rollback stays isolated to that
milestone. Rollback is switching its flag off or reverting the enabling change.
Dan chose the staged rollout; the dispatcher owns each switch-on on his behalf.

## Put attention in a conditional header popover (17 October 2026; P9-120 / #913)

Remove the Now and Backend sections from web Settings. Keep the existing
shell-owned Now feed, stream, side effects and backend sleep API unchanged.
Publish only the already-loaded feed items in the attention, credential and
alert categories, plus pending browser confirmations, to a yellow bell/count
in the header background-work cluster. Its independent popover retains the
existing item links, timestamps, dismiss endpoint and confirmation handlers.
Running tasks stay with background work; releases/deployments and away-mode
changes are not attention. The background-work control is empty only when there
are no non-dismissed jobs and no attention items. Keep it visible while its
popover is open so the empty-state note remains reachable after the last
dismissal. Interrupted historical jobs remain reachable through the control and
show a neutral, labelled history mark when no running/done/failed counts apply.

This implements issue #913's request to remove Now and Backend from Settings
and show attention from its own header icon. Reusing the existing feed snapshot avoids a
second connection or request; `/operations/sleep` and shared navigation
contracts remain unchanged. Offline focused UI tests cover the count, popover,
unknown web anchor, permanent server-synced dismissal and empty-state behavior.
Live provider behavior and human visual acceptance remain unverified.

## Keep the first Web Push proof dark and user-triggered (17 October 2026; P13-01 / #917)

Milestone 1 proves a visible Web Push notification can point to a durable,
owner-protected item; a push never approves an action or carries private data.
The feature is disabled unless `JARVIS_PUSH_ENABLED` is exactly `true`; these
changes do not set it. Disabled startup does not register routes or access push
storage, signing keys or providers.

The backend generates and stores its VAPID key pair on first use, serving only
the public key. Keep RFC 8030 delivery, RFC 8291 `aes128gcm` encryption and
RFC 8292 VAPID in a small `node:crypto` module without a new dependency. Store
subscriptions and durable items separately from Now/activity. The original
generic-only push-text rule is superseded by P13-21/#1194; bounded titles and
due times now belong in the encrypted payload only. Provider acceptance is not delivery evidence, and `opened_at` means
loaded, not read. Dan decided no Teams messages are ever sent; push is the only
delivery path, keeping notification and alert delivery on one route.

The test send is user-started, so quiet hours do not block it. Do not add the
22:00–07:00 Europe/Copenhagen guard or an emergency exception now; all later
system-started sends must pass that guard. Actual iPhone delivery remains an
unverified physical-device acceptance step.

## Keep the proactive foundation and engine dark and bounded (18 October 2026; P13-05, P13-06)

The server gate `JARVIS_PROACTIVE_ENABLED` and its todo-write and alert
capability gates are exact-string `true`, default off. The foundation registers
owner-bound settings, status, item and feedback routes only under the main gate.
It adds no scheduler, source read, model call, timer or proactive delivery; no
deployment setting turns a flag on. Status remains available before any run and
reports each source in a fixed order.

When later engine work is enabled, scheduled slots are 07:00 and 18:00
Europe/Copenhagen and quiet hours are 22:00–07:00 with no exception. Time
conversion uses the IANA zone and handles both DST transitions. Catch-up is at
most once for the latest missed slot, only inside the allowed window and under
12 hours old. Sleep remains unchanged.

The monthly budget defaults to 100 DKK, warns at 80% and refuses further work
at 100%; all displayed spend is estimated and unknown model rates use the
highest known token rates. Findings use the language of recent user messages,
detected deterministically without a model. Todo writes, when separately
enabled, are add-only. Alerts are restricted to time-critical deadlines,
calendar clashes, travel disruptions and the due-soon todo reminder; quiet-hour
reminders wait until 07:00. Teams is never a proactive channel.

The `proactive` background-job kind makes runs visible in the
existing Background work control. Existing embedding result-window exclusions
remain specific to embedding jobs.

P13-06 implements these bounds in the existing composition and stores. Slot
memory, not SQL polling, gates scheduler work; persisted claims and manual rate
limits serialize under the existing owner lock. The engine limits sources to
20 seconds each, the tool-less Foundry call to 45 seconds, and the run to three
minutes. Deterministic detection remains available when summary generation fails.
Model evidence must reference the bounded input; text, links, urgency and schema
are validated before persistence. Reported token usage is recorded even when
output is rejected. Source text is never job or log content.
Finding persistence checks the claim inside its transaction and participates in
run cancellation; the engine awaits commit or rollback, not merely an aborted
wait, before finalizing the run.

Future todo, alert and reminder slices attach ordered `onFindingsStored` hooks
instead of changing the engine. Hooks receive transient facts and suggested
todo text only in memory; suggested todo text is not persisted by this slice.
Hooks run after item upserts and before finish, never after cancellation or
lease loss, and hook failures are isolated. No flag, source provider or proactive
send is activated.

## Keep proactive todo reminders behind the shared alert gate (18 October 2026; P13-13)

Use the existing proactive, push and alert flags; introduce no reminder setting
and enable nothing in this slice. A planner records only explicit-time todos
within 48 hours, at due time minus one hour, and only after a successful todo
read. Existing reminder rows are never reopened, and the bounded fact list is
not evidence for plan-time cancellation.

At send time the ticker re-reads the todo file, observes pause and subscription
state, suppresses recently alerted deadlines, and enforces eight reminders per
Copenhagen day. Quiet-window work remains pending until 07:00. Each reminder
gets an idempotent private finding. The original generic-payload rule is
superseded by P13-21/#1194: encrypted pushes carry bounded titles and due times,
while logs still contain only IDs, counts, durations and reason codes. Verification
failures retry twice at five-minute intervals; a third failure sends as
unverified. Delivery is at-least-once: a process crash between push acceptance
and state persistence, or a short overlap of deployment revisions, can produce
a duplicate reminder; this is accepted.

A todo added after the last check is covered from the next check on; "Check
now" covers it immediately.

## Keep the Proactive web client dark and private (18 October 2026; P13-10)

The web client uses its own exact-string `VITE_PROACTIVE_ENABLED` build gate;
this slice leaves it off. Route, navigation, Settings and the terminal
Background work Open link follow that gate. When push alone is enabled, the
M1 `/proactive/:id` target remains unchanged; with the web gate on it renders
the full item and links back to the list.

Use the shared authenticated contract, with no new dependency or contract
change. Keep item text, feed URLs and guidance in memory only; render
source/model content as plain text and map server reason codes to fixed copy.
Manual checks are visibility-aware and bounded, and optimistic dismiss/snooze
roll back with visible retry on failure. These choices do not enable backend
work, change permissions, or settle outstanding source, todo-write or delivery
decisions.

## Keep news reads dark, public-address-pinned and content-minimal (18 October 2026; P13-09)

The registry's news source is a read-only RSS 2.0/Atom adapter over editable
settings, defaulting to the GitHub changelog and OpenAI news. It can only use
validated HTTPS hostnames and public DNS answers; mixed public/private DNS
answers, redirects, non-XML responses, compressed bodies, oversized responses,
and DTD/entity declarations fail closed. Per-feed work is limited to ten
seconds and 2 MiB. Facts contain only sanitized, bounded titles, publication
times, and the host; feed URLs, query strings and source payloads are never
logged. The source remains dark: this change registers it without scheduling a
read or enabling any proactive flag.

## Keep P13-07 sources read-only and dark (18 October 2026)

The todo filename remains unsettled, so the reader resolves exactly one
case-insensitive root `task.md` or `tasks.md` and fails closed when absent or
ambiguous. It only calls vault `tree` and `read`; it never creates or mutates a
note. One shared parser/sanitizer serves todo facts and later todo consumers.
It preserves task order, removes due markers from sanitized text, resolves local
due times with the Copenhagen time zone, and prioritizes facts in the
24-hours-before/72-hours-after window before the 40-fact cap.

Factory reads use a narrow SQL task-status snapshot rather than event histories,
prompts or logs. Weather uses only saved home coordinates and a bounded HTTPS
Open-Meteo request; no default location or geocoding is allowed. Each source is
registered, but no source is invoked and no proactive flag is enabled by this
slice.

## Keep suggested todos add-only and dark (18 October 2026; P13-11 / #931)

The writer uses the existing todo-file resolver/parser and may append only
sanitized, safe model suggestions under its own heading. It preserves every
existing byte and refuses missing, ambiguous, oversized or unwritable files.
Deduplication markers contain only a short finding hash; SQL receipts retain
codes and identifiers, never todo text. Pause/Todos settings, quiet hours for
scheduled work, and the three-per-run/five-per-day caps are enforced before
vault access. The independent exact-`true` writer flag remains off, and the
main proactive flag is still required.

## Keep P13-08 sources read-only and dark (18 October 2026)

P13-08 adds only read-only, bounded calendar and Gmail-header sources and a
travel source derived exclusively from the calendar. Calendar uses the existing
primary-calendar view path, expands recurring instances, and reads at most 50
events over two pages within 48 hours. Gmail searches at most 15 unread primary
inbox messages from the last two days and requests only From, Subject, Date,
List-Unsubscribe and Precedence metadata, with no body, snippet or attachments.
Travel reads seven calendar days, filters with deterministic exported keywords
and route syntax, and omits events already inside the calendar window. It makes
no flight, rail, traffic or disruption-provider request. No OAuth scope,
consent, secret, cloud setting, flag activation, engine behavior or entry-point
change accompanies these sources; source text remains untrusted and is never
logged.

## Keep web push default-off and notification taps owner-authenticated (17 October 2026; P13-02)

Implement the web half of the delivery proof behind the exact-string
`VITE_PUSH_ENABLED === "true"` gate; the build default remains off. The service
worker's original fixed-copy rule is superseded by P13-21/#1194: it validates
v2 title/body text and uses generic headlines for legacy or malformed pushes.
It retains only a
validated UUID for a same-origin item path. It never trusts a payload URL, and
the item page remains behind the normal sign-in and owner-protected API.

Permission is requested as the first awaited operation in the user's explicit
opt-in action. The UI distinguishes unsupported, server-off, not-yet-asked,
denied, on-device, changed-key/lost-subscription and recoverable failure states.
No backend or deployment flag is changed here. Mocked browser checks are not
evidence of iOS permission prompts, lock-screen delivery or physical tap-through;
those require the separate enabling change and device test.

## Compose Daily only behind one exact server switch (17 October 2026; P12-09 / #724)

**Builder decision inside Dan's "go with the daily", not an activation and not
acceptance.** It is the last invisible Daily slice, built under these conditions.

- One switch. `JARVIS_DAILY_ENABLED` is read once at startup. Absent or `false`
  is off, exactly `true` is on, and any other value stops startup with an error
  that does not echo it. The repository ships no value: no workflow, Bicep,
  infrastructure, environment or deploy file sets it, a scan test enforces that,
  and turning it on is a separate reviewed change (made by the next decision
  below, for the owner's production only).
- Off means unchanged. The composition returns no module, validates nothing and
  touches no pool, so the route table, tool catalogue, capability instructions,
  voice session, health response, startup, jobs and timers stay those of Jarvis
  without Daily. Tests compare each of them with a Daily-free application.
- On means the smallest module. One owner-bound module over the existing
  nutrition data: the capabilities, query and nutrition-targets routes and six
  tools. The old 128-tool ceiling is superseded by #1204. It adds no MCP
  connector, Frida lookup, Google or Gmail feed, health upload, job or timer.
- Fail closed. Missing SQL or an owner that is not a UUID stops startup. Every
  data accessor, and the targets and health readers that the composition wraps,
  re-check the signed-in owner against the composed owner, so a mismatch is
  refused before any SQL read. A connector or runner is refused on every Daily
  route. Nutrition target changes still require the nutrition tool's exact
  browser Now approval; training-target writes are Settings-only and have no
  assistant tool.
- Unchanged and out of scope: accounts, consent, grants, secrets, RBAC,
  resources, imports, provider, device and private reads or writes, and live
  probes. Rollback is leaving the switch off.

## Switch Daily on for the owner's production (18 October 2026; P12-15 / #730)

**Dan's instruction, not acceptance.** Dan pre-authorised this: "Yes, switch it
on once it's live and checked", and later "Yes, ship all daily if possible. You
can take decisions as I would, as good as you can, we can always change it."
The visible Daily page must be deployed and checked before this change merges.

- Two switches, two reviewed files. `JARVIS_DAILY_ENABLED` is `'true'` in the
  backend container environment in `infra/main.bicep`; `VITE_DAILY_ENABLED` is
  `'true'` on the web build step of `.github/workflows/deploy.yml`. The code
  default stays off, so local runs, tests and every other environment are
  unchanged. A wrong value is loud, not silent: the backend refuses to start and
  the web build fails.
- Scan test. `daily/default-off.test.ts` now allows exactly those two files to
  mention a switch, and checks that each sets only its own switch, once, to the
  exact string `true`, with the web switch on the web build step.
- What turns on is the owner-only nutrition slice and its page: the capabilities,
  query and nutrition-targets routes, six tools, the "What Daily holds today"
  overview and the Nutrition targets section in Settings. No MCP connector,
  Frida lookup, Google or Gmail feed, health upload, job or timer comes with it.
- Both switches change the release plan, so one deploy applies infrastructure,
  backend, web and agent together; the backend applies its migrations at start-up
  as in every deploy. The live check belongs to that deploy, not to this entry.
- Unchanged: original Daily stays canonical; no import, provider, device or
  private read or write, no new account, consent, grant, secret, RBAC or
  resource. Stored-grant and CalendarList parity (#725), physical-phone
  acceptance and cutover stay unverified and are not claimed.
- Rollback: revert the whole change, which removes the two values and the scan
  test's new expectations together, or set both values to `false` and update the
  scan test in the same commit. Reverting only the two values fails the scan test.
  The next deploy re-applies all four components. Stored Daily data is not deleted.

## Link every web-created Factory task to a GitHub issue (17 October 2026; P10-08 / #902)

The Create task dialog and `POST /factory/tasks` reuse the chat path's
issue-first helper, with explicit dialog title, agent, overrides and priority.
Chat defaults remain unchanged. Create the issue without an executor label:
the route queues the linked task itself, so label pickup does not race it.
Later explicit Jarvis-label pickup reuses the active task by issue number.
The issues-only board resolves the task overlay directly by issue number even
before a PR exists; ordinary issue status rules still place the new issue in Ready.
Delivery retains the existing `Fixes #N` behavior.

Use a client-generated submission UUID, retained with a payload digest for
retries in the browser tab, and a durable SQL claim before any GitHub write.
The server rejects reuse with different fields and replays recorded outcomes.
Claims survive restarts; an interrupted or uncertain operation requires
repository inspection rather than another automatic write. Known partial
failures return the issue number and URL for manual recovery. Completed
failure responses are also replayed, not blindly retried. Migration 0052
retains this retry evidence and refuses rollback when records exist.
No GitHub Projects integration, automatic backfill, chat behavior, merge
policy or approval-flow change is included. Offline fake-backed tests cover
creation, failures, deduplication, board placement and PR closure; live GitHub
writes remain unverified. Synthetic Chromium inspection at 1440×900 and
320×900 verifies success links, retained form/error states, one pending POST
on double-click and stable retry IDs. Existing background release content
overflows at 320px; the dialog itself fits and its actions remain accessible.

## Do not read successful action details back aloud or recap them in chat (17 October 2026; P11-11)

After a verified successful write, voice and chat give one short confirmation and
at most a count for multiple items. Do not repeat the approved titles, times,
places, names, addresses, amounts, references or codes. The full written and
on-screen record remains available, and details may be provided when explicitly
requested. Keep staging summaries unchanged; report failures, partial writes and
unverified outcomes briefly with the affected item and next step.

A live voice test showed that repeating full calendar details after successful
approval was redundant. Concise acknowledgements reduce needless spoken
disclosure without removing the record or hiding an incomplete outcome.

## Use text rather than orbs for loading (17 October 2026; P9-118 / #896)

Dan's issue supersedes the 7–8 October loading-orb rule. Page loading uses
plain Loading with fixed-width decorative dots; both reduced-motion settings
show static dots and accessible status stays stable. Sign-in distinguishes
outgoing Redirecting, returning Signing you in and first-visit Loading using
a non-sensitive per-tab marker, not an authentication signal. Preserve the
living stage, input/voice orbs, working cores and glass skeletons.
Local Chromium fixtures cover both requested sizes/themes and reduced-motion
mechanisms; Dan's visual acceptance and live Microsoft sign-in remain pending.

## Compute the suggestion budget from stored active energy and Jarvis-logged meals (17 October 2026; P12-09 / #724)

**Builder decision inside Dan's ruling, not a user-confirmed choice and not
acceptance.** It implements the budget formula recorded in the entry below with
the least inference the repository allows.

- Burn is read only from the exact `active_energy` metric of today's stored
  Health data. Resting, basal and total energy are never read, so the owner's
  resting target is not counted twice. The metric name and its daily-total
  semantics are not verified against a live export. Verifying them needs a real
  export and stays an open check, not something this change assumes.
- Freshness comes from the row's `updated_at`; `start_at`/`end_at` are not a
  reliable last-sample time. A missing, duplicated, negative or non-kcal reading
  is unknown with a reason code, never zero.
- Eaten energy and protein count only meals logged in Jarvis; food eaten but not
  logged is invisible, and the report names that source. A meal with unreadable
  energy blocks energy left; a meal without protein makes protein left a
  flagged upper bound. A partly read day (pages exhausted) is reported as
  incomplete rather than treated as the whole day.
- Candidates are the owner's saved favourites only, passed to the unchanged
  `suggest` calculation and the persisted dislikes. Nothing invents a meal or a
  quantity, and an unknown energy left applies no energy filter and says so.
- The tool is read-only, sensitive and phone-denied, behind the default-off Daily
  gate; only the default-off composition can reach it. Daily off leaves Jarvis
  unchanged.

## Use owner-configured nutrition targets for the daily food budget (17 October 2026; P12-09 / #724)

**Confirmed user decision, not a proposal or completed acceptance.** Dan ruled
that the resting energy burn, the daily deficit and the protein target are
settings he enters and Jarvis reads: "Put this in settings and read from there."
They are owner-entered configuration, not defaults in code, tests or documents.

This is an explicit, narrow reversal of the earlier no-maintenance-maths rule
for one formula only. Allowance today is the owner's resting burn plus the
active energy burned so far today (stored Health data) minus the owner's
deficit. Energy left is that allowance minus what has been eaten so far, and
protein left is the owner's target minus what has been eaten so far, with no
projection of the rest of the day. Still excluded: any BMR/TDEE estimate from
weight, height or age, activity factors, and all coaching, recovery or
recomposition automation. #723 stays withdrawn.

Keep each target as an owner-namespaced Daily row in the existing `dbo.settings`
table (global scope), not in core `Settings` and not in a migration. An absent
row means "needs configuration": no default, estimate or fallback. The signed-in
owner edits them through `GET`/`PATCH /daily/nutrition-targets`; chat and voice
use the sensitive `daily_nutrition_targets` tool, whose changes need the exact
browser Now approval. Tool audit redacts the values. They are personal health
data in a public repository, so no source, fixture, document, PR text or log
carries real figures; tests use synthetic values and Dan enters his own.

Everything stays behind the default-off Daily gate: Daily off leaves Jarvis
unchanged and only the default-off composition can reach it. The budget adapter (recorded
in the entry above) reports unknown burn or unknown meal macros as unknown, never
zero, and counts only the exact active-energy metric so resting energy is not
double-counted. The Settings section ships as its own web slice over the same
route, and the default-off composition is a further separate slice. No provider,
device or private access, live probe, activation or acceptance follows from this
record.

## Restore green/yellow/blue presence, rename Task recipes to Routines and keep Save above the composer (17 October 2026; P9-102, P9-103, P9-98)

Dan asked for three small web fixes and speed over ceremony, so they ship as
one PR (#798, #797, #792). The blocked-by chain between them only existed to
avoid same-file collisions and is ignored.

Presence: Present is green, Away yellow and On the move blue in both themes.
The 7 October two-accent palette had drifted from `docs/architecture.md` and
the P6-23 decision, which already say green/yellow/blue. Dark fills measure at
least 4.11:1 on every surface. The light fills alone fail 3:1 on pale glass, so
light dots carry a 1.5px ring of their own hue darkened (tone mixed 55% with
black), measured at least 3.06:1. The label stays beside every dot and the orb
is unchanged. Known limit: the phone top-bar chip hides its label at 700px and
below, so colour is the only visible cue there (the accessible name keeps the
mode), and green against yellow can be hard for some colour-blind users. A shape
cue is a follow-up if Dan wants one.

Routines: every visible, announced and tested string says Routines. The
`/recipes` API alias, file and component names, storage key and response key are
unchanged, so there is no contract change. The copy-cleanup guard now rejects
"Task recipes".

Save above the composer: on phones, non-Home pages scroll with the window while
the chat composer is fixed above the dock and grows with its draft, attachments
and errors, up to 174px. Page-end clearance was a fixed 100px, so any composer
above 68px covered the last control, and a real tap on Save hit the composer's
More options button. Clearance now follows the measured composer height (the
existing `--conversation-composer-height`), floored at the nominal 100px so a
one-line composer looks as before. The rule is phone-only, non-Home,
voice-inactive and signed-in. Save remains a plain static row (Dan, 8 October),
not a sticky bar, and no new shell, keyboard estimate or focus-scroll workaround
is added. The same rule also clears the last control on other phone pages:
Kanban's Retry board was hidden behind a tall composer before.

Evidence is headless Chrome with stubbed sign-in and a fake backend at 320×700,
390×844 and 1440×900 in both themes, plus unit tests. It is not a physical
iPhone/Safari check. Exact-head CI and live acceptance remain.

## Treat a model-issued voice call as Jarvis only inside the relay's call scope (17 October 2026; P11-09)

Dan's live test showed Jarvis refusing to put views on screen in voice with
"only the workspace owner can create or update views", then explaining it
wrongly. Cause: the guard accepted the agent identity, or the owner for
reflex-only operations, but a realtime tool call runs on the owner's WebSocket
upgrade request, so it looked like the browser. Chat already passes as the agent
identity. A separate path dumped raw Google JSON, including message bodies, on screen.

Mark exactly the relay's model-issued calls with an in-process async scope (never
an argument, header, claim or browser message) and treat them as Jarvis only for
the signed-in workspace owner. Owner-only authorisation, the specific operation
and the broker stay authoritative; the browser, an owner token over HTTP,
reflex and other users are unchanged. Rejected: letting the owner create views
for every caller (the browser could then create what Jarvis could not), a
model-supplied actor field, and marking the whole socket (reflex work would
inherit it). Present Google results only as bounded readable summaries, or nothing.

This corrects the demonstrated voice cause. Chat's refusal comes from
generated-view validation and is handled in a separate PR (specific refusals,
model guidance), then an offline find, show, stage, confirm test. Dan's live
re-test closes #885; source tests are not acceptance.

## Name the failing field in workspace_command refusals and mark incomplete Google results partial (17 October 2026; P11-09)

After the voice fix, Dan's chat test still showed "Workspace command: Refused"
twice and an answer blaming an "invalid" summary. Ajv names only the top-level
property for a failure inside `view`, and the hand validators returned one
generic sentence, so the model could not correct itself and misdescribed the cause.

A refused workspace command now says which field is wrong and why, and that
nothing was changed or shown, in the same words in chat and voice (`Invalid
arguments: <field>: <problem>. Nothing was changed or shown by this call. Retry
with arguments matching the tool schema.`). It uses only static wording,
enumerations, counts and key names from known property sets, so a refusal never
echoes a model-supplied value. The `tool.invalid_arguments` log payload and every
authority check are unchanged. Tools opt in through an optional
`explainInvalidInput`; when it finds nothing the old message stays. Guidance for
the model sits in the tool description because the shared capability instructions
have about 34 code points of headroom. Rejected: deriving hints from Ajv's error
list (a `oneOf` reports a misleading first-branch error) and relaxing validation
so the model's guess passes.

From Codex's P1 on #888: a Google result the tool marks truncated, or that the
presenter cuts to fit, carries a static value-free note in the view and a
`partial` source with the same reason, because free time computed from an
incomplete event list can show busy time as free. Dan's live re-test closes #885.

## Label backend-side chat failures and retry a thrown acceptance check once (17 October 2026; #820)

Three consecutive main deploys failed different chat checks with the bare
`agent_error`: 39043117488 (`705af7c7`) `chat_capabilities`; 39046081711
(`665fb152`, agent v110) `chat_github_read` and `chat_navigation`; 39049389385
(`c00818b7`, agent v111) `chat_navigation` and `chat_plain_approval`, with
`chat_github_read` passing. None of #884's 36 hosted origin codes surfaced and
the failing set moves between builds. The cause is not established and no
historical root fix is claimed; #820 and #880 stay open and #884 stays frozen.
Dan's direction is speed over clean deploys: small, reasoned, reversible fixes,
with the next deploy's evidence driving the follow-up.

- **Labels.** A bare `agent_error` can come from several backend-side failures.
  `ChatAgentInvocationError` now tags them with 18 fixed `agent_*` reasons
  (token unavailable, request failure, fixed HTTP statuses or `agent_http_other`,
  invalid response, stream failure, stream ended without completion). The cause
  stays in-process; no message, status text or payload reaches a report. A hosted
  error event with no code or an unlisted code becomes `agent_error_code_missing`
  or `agent_error_code_unlisted`, which refines #884's "unknown stays
  `agent_error`" for `ChatAgentError` only. Everything else stays `agent_error`,
  and cancellation is never relabelled. The Python formatter mirrors the set with
  a parity test.
- **One bounded retry.** A conversation check whose first attempt threw one of
  these failures (bare `agent_error`, hosted origin or backend label) runs once
  more, concurrently, only when the first wave ended within 25 seconds of the
  suite start and under a 25-second window, so it finishes inside the unchanged
  55-second suite deadline. The retry replaces the first result only when it
  passes. Assertion failures and timeouts are never retried; smoke prompts are
  read-only or no-op, so repetition has no side effects. This is a deliberate
  gate-tolerance change in line with Dan's direction, not a proven fix. It cannot
  rescue a persistent failure, and a rescued first failure leaves no trace in the
  artifact. Remove the retry wave in `runSuite` to revert it.
- **#816 is not the cause by code path.** Smoke invocations never set a chat
  session, so the invocation-scoped coordination client is never opened and no
  steering or phase hook is installed. A new agent test pins that. The deploy
  evidence agrees: the backend image was unchanged between 39046081711 and
  39049389385 and `chat_github_read` recovered. No revert.
- **Degraded reasons stay off HTTP.** Open web clients accept reasons only for
  down checks (14 October decision), so degraded identity and no-timestamp
  entries remain `not_reported_or_redacted` in artifacts. Their reasons exist
  only in the `system.smoke_check` log events.

No model, prompt, assertion, timeout, credential, workflow or #816 lifecycle
change. Synthetic tests cover each label, the missing/unlisted buckets, redaction,
single-retry behaviour, the retry bound and unchanged assertion failures; normal
CI and review remain required.

## Preserve fixed hosted error origins in existing acceptance evidence (17 October 2026; #820)

Deploy39043117488 retained `chat_capabilities=agent_error`, accepted=false and
successful exact qualification/readiness/component reuse. It does not establish
a pipeline implementation defect or the underlying hosted-turn cause.
Source tracing demonstrates that `ChatAgentError` preserves the hosted SSE code,
then the canary collapses all codes except `catalogue_unavailable`.

Preserve an explicit finite allowlist of existing hosted backend/settings and
exception-class origin codes in the existing per-prompt `reason`. Reuse the
status sanitizer and smoke/immutable release evidence rather than add fields,
telemetry services, a workflow or raw-log collection. Code-shaped text alone is
not trusted: unknown values and non-agent errors retain `agent_error`, and
assertion reasons cannot masquerade as hosted origins. Keep Python/backend
allowlists equal with a deterministic regression.

This evidence-only choice preserves statuses, aggregate failure, prompts,
receipts, deadlines, authentication and nonblocking exceptions. It changes no
model, settings, retry or connection lifetime and does not absorb #816 or Daily.
Synthetic fixtures cover fail-closed acceptance and original producer identity;
normal exact-candidate CI/review and main-only release remain required.
#820's original historical attribution and #880's failed release disposition
are not satisfied by this source change or by a later unrelated successful turn.

## Isolate stale draft events from ready qualification (17 October 2026; #880)

The first integrated #881 ready event admitted CI39041201026, then a delayed
synchronize event carrying draft=true admitted39041201353 in the same concurrency
group, cancelled qualification and skipped itself. Preserve both outcomes.
Recover once by rerunning the cancelled non-draft event at exact520c9ba8;
do not rerun green CodeQL/review, bypass impact selection or claim a Daily fix.

Separate draft snapshots with a concurrency suffix. Ready candidates retain
their existing supersession group and fail-closed result gate. A skipped draft
aggregate also needs a distinct unqualified check name, because GitHub can
treat a skipped required-name context as satisfying branch protection.
The first recovery exposed an attempt-sensitive test fixture: explicitly pin
the first-attempt case and cover the previous-attempt API shape separately.
Keep the failed attempt2 evidence; do not relabel it a Daily failure.
This surgical
workflow change needs no scheduler, access, dependency or new worker. Synthetic
admission-order/key coverage and normal exact-candidate qualification apply.
The full118-case script suite passes locally with GITHUB_RUN_ATTEMPT=2.
Separately, #882's normal main-only Deploy39041096612 completed successfully:
its verified immutable receipt records all four parts applied, accepted=true,
backend341 and agent109. First-baseline acceptance is not proof of a historical
agent_error cause or a later compatible-reuse/readback path.

## Use continuous pipeline-led delivery (17 October 2026; #880)

Dan selected operating model 2: the responsive coordinator owns intake, GitHub
backlog/dispatch and mechanical integration conflicts, not development, tests,
log investigation or reproductions. At most two builders own code, regression
tests and pipeline failure repairs. Pipeline evidence routes to the existing
builder; completion events replace the old timer. This supersedes earlier
coordinator removal, one combined batch and routine human release-sign-off rules.

Extend existing workflows rather than introduce a delivery service or image
promotion platform. Ready PRs select affected components and actual contract/data
dependencies; shared/unknown inputs keep full qualification. The aggregate gate
fails closed and retains exact tested-tree/source/run/attempt/PR evidence.
Main-only Deploy consumes that successful immutable receipt before Azure access.
Build/apply remain on the existing authorised identities; no new registry,
credentials, grants or external worker is needed.

Retain verified applied-component identities independently of acceptance.
Reuse requires exact source-input/recipe/configuration fingerprints, valid
digest/version identities, trusted main-run provenance, compatible ancestry and
an immutable artifact checksum. Never search past newer missing/failed partial
state for an older green receipt. Bicep invalidates downstream configuration.
Manual dispatch honours supersession. Reused artifacts keep original producer
source/run/attempt; the new release SHA is not falsely stamped onto them.
The budget-contact secret is never hashed into public/downloadable fingerprints.
For candidate infrastructure reuse, compare the existing action-group recipients
in memory after exact qualification using the existing main-only deployment
identity. Mismatch invalidates downstream state; unavailable readback blocks.
This avoids a low-entropy secret hash without adding a key, role or manual
version-marker dependency. Supersession follows verified applied state, not
an unrelated newer docs-only main commit.
Grant the read-only plan job GitHub pull-request read permission for the
commit-association endpoint. Keep backend image origin distinct from revision
origin: an agent identity update produces/re-proves its backend revision under
that agent job's original attempt, including an acceptance-only retry. It does
not rebuild the image or transfer image provenance to the new source.

Deterministic code/permission/contracts and runtime readiness remain distinct
from live model conversation acceptance. All are still required where selected:
probabilistic does not mean optional. A failed conversation check leaves the
run failed and applied components reusable; unknown/missing required checks
cannot become green. Only the pre-existing PC-bridge/identity/timestamp exceptions
remain nonblocking. Fixed check/status/reason codes are retained, not raw logs,
reports or provider/tool/user content. Historical failures are not reclassified.
The old generic `agent_error` has no proven cause.

Status: initial43aa CI39038876598 passed all12 jobs and all four CodeQL
analyses; review found the secret-derived fingerprint issue, corrected with
synthetic comparison/redaction fixtures. ca9a CI39039891173 and its four
analyses passed; exact-head review additionally identified the plan read scope
and backend revision attribution corrections above. Successor exact-candidate CI/review
and the integration owner's main-only release remain
separate gates. Remote-enabled runtime state is not exposed here and is not
claimed. Private Daily/provider/device/access boundaries remain unchanged.

## Keep a rolling, owner-bound conversation summary ahead of a wider window (17 October 2026; P9-105, #800)

Chat history kept only the newest 20 messages, so a decision from message 5 was
gone by message 40. Dan asked for a rolling summary on 3 October, and his 17
October priority starts it before #794/#816 settle. Keep messages untouched and
append versioned summaries to a new owner-bound `dbo.conversation_summaries`
(migration `0051`; the issue's `0046` was already taken). Each row records the
message range it covers, its version, the model and the creation time, and the
backend keeps the newest 200 versions. This is not `core/memory.ts`, which stores
durable memories.

The agent writes the summary after a finished chat reply (never a smoke or errored
turn) in one single-flight background task, using the chat model, or
`JARVIS_SUMMARY_MODEL` when set, and the existing `chat` usage role. Each refresh folds
the not-yet-covered older messages in order into the previous summary, so earlier
versions are carried forward rather than rewritten. The model returns two sections,
`SUMMARY` and `OPEN ITEMS`, which keep decisions, commitments, preferences and open
tasks. The prompt then carries that summary followed by up to 40 raw messages after
the covered range, and the newest 20 messages never fold; a refresh starts once 30
messages are uncovered. Without a summary the window is the old 20 messages.

Secrets and file contents stay out in three places: messages are scrubbed of
credential shapes and clipped to 1,500 characters before the model sees them; the
instructions forbid both; and the answer is scrubbed again on the agent and by the
backend's existing `redactWorkContent`. The summary reaches the model as labelled
untrusted background, and Jarvis may say it works from a summary of older messages.

Cost is bounded three ways: the setting `global.conversationSummaryDailyLimit`
(integer 0 to 48, default 24, 0 turns the feature off), a rolling 24-hour attempt
cap inside the agent, and a server-side 429 once the day's versions reach the
limit. Each call is one tool-free request with at most 40,000 characters in and
6,000 tokens out, and its tokens go through `/usage/foundry`. The 40,000 covers the
whole prompt: the carried summary and open items are charged against it before any new
message is added, and a prompt still over it is refused as `prompt_too_large` before the
model is called or an attempt is counted. At the default a long
chat can fold roughly 240 messages a day; beyond that the summary lags and the
window is still never worse than before.

Any failure returns the plain window and logs a named, content-free event:
`chat.memory_summary_failed stage=<fetch|history|summarise|save|schedule|refresh>
code=<code>`, `chat.memory_summary_skipped reason=<reason>`,
`chat.memory_summary_gap pages=<n>` and `chat.memory_summary_saved`. A failure pauses
refresh for 10 minutes; a stale-version conflict or a reached limit does not.
Both routes are owner-only and run on Dan's delegated token, which the refresh task
holds in memory for at most about 90 seconds and never logs.

Deferred on purpose: a dedicated usage role and settings model role (they need a
check-constraint migration and a deploy-order step), history older than the 400
messages a first summary can reach (logged as a gap), and a forward-cursor history
API. Verified offline with a fake agent over a recorded 331-message conversation;
live behaviour is unverified until deploy, and the chat canary and
`conversation.reply_failed` stay the live checks.

## Reuse retained feed services through one inactive tool (17 October 2026; P12-09)

Dan requires equivalent tools for retained Daily capabilities. Bind the existing
snapshot/attention/suppression/manual-refresh services through optional
`DailyData.feeds`, rather than duplicate Google dispatch, expand the nutrition
connector or change the strict versioned query-source advertisement.
Production remains default-off and existing callers retain their signatures.

Prefer the existing browser-only Now approval for visibility changes and manual
provider/model refresh over model-confirmation booleans or a new action queue.
Reuse verified current chat/voice context; bind actual target/suppression hashes
under the existing owner lock so later mail cannot be dismissed by an old
proposal. Received is Daily visibility, not evidence of physical receipt.
Return actual run/error/limit states and separate source times; the old store
does not retain calendar range, so it remains explicitly unknown.

Review5558345536 identified that read bounds alone let suppression1001 poison
attention/listing and reviewed restoration. Enforce the existing1,000-per-type
active limit under the owner transaction before additions; keep updates allowed.
Restore through exact-key lookup/recheck rather than reading the whole set,
including recovery from already oversized imported evidence. No migration,
automatic deletion or widened read limit is needed.

Reuse the nutrition commit-notification pattern: publish only after acknowledged
new commits, keep replay/no-op/failure quiet and isolate listener failure.
The shared owner resolver intentionally permits nutrition connectors; all feed
entrypoints therefore explicitly deny that narrower principal. Existing Google
authentication/token handling is unchanged. No stored-grant guard was present
at the assigned base; actual CalendarList grant/provider parity stays an OPEN
#725 acceptance gap, not a claimed preserved implementation. Synthetic source
qualification does not authorise consent, live data, activation or cutover.

## Expose safe smoke reason codes through existing CI (17 October 2026)

Required chat acceptance failed twice on different actions after qualified878
components were applied. Status-only CI logs cannot distinguish a timeout,
agent error or failed receipt predicate. Passive owned browser attempts were
signed out; do not log in, borrow credentials, weaken checks or bypass the
project's prohibition on direct agent Azure access.

Prefer a small fixed-code formatter in the existing Deploy workflow over a new
diagnostic account/service/workflow. Preserve every status/deadline/gate and
print no raw report or user/model/provider/tool content. Unknown reasons get an
explicit redacted marker. This diagnoses failure; it does not claim its cause
or repair the underlying canary. The workflow edit follows the unchanged full
deployment policy; no resource/identity/IaC changes are included.

## Extend the shared Daily query for retained briefs (17 October 2026; P12-14)

Historical brief data already has an owned canonical table but no read/tool/page
path. Extend the current query sources rather than add a parallel API/tool
protocol; a separate history screen conflicts with the confirmed one-page scope.
Separate small metadata pages from bounded exact body reads, omit provider and
delivery snapshots, and reuse the existing pool/query cancellation rather than
the health processor's exclusive transaction lock.

Legacy timestamp columns are stored text. Preserve them verbatim and describe
the actual stored-text/ID ordering instead of inventing a timezone, current
freshness or a new delivery. Unknown import completeness remains unknown. The
nutrition connector has narrower authority than the human/hosted agent: reject
it explicitly for briefs at both service and reader, without broadening MCP.
No notification or schedule implementation is required to read history. This
decision authorises no private import, provider access, activation or cutover.

Review identified that even inactive source must preserve the existing strict
v1 capability consumers. Negotiate capability v2 explicitly through standard
Accept with plain-JSON fallback; retain the exact v1 source set for old clients.
Do not merely filter unknown sources after breaking the old advertisement.
The updated client accepts older v1 servers; no new CORS header or URL selector
is needed. The query/native-view version stays unchanged.

## Prepare the single Daily page without activating migration (17 October 2026)

Continue the confirmed one-page scope under Dan's standing autonomous migration
mandate while he is unavailable. This is reversible source preparation, not an
affirmative private-data/provider/activation waiver. Use a trusted default-false
App composition prop rather than an externally switchable URL/public flag.
Production bootstrap remains unchanged; both client and backend guard navigation.
Keep #730 and its native #724/#725 dependencies open.

Reuse the delivered owner-authorised query service, existing Now connection,
shared controls and ChartView. Preserve every returned observation, unknowns,
units, provenance and partial coverage; a page of rows is not imported-source
acceptance. Chat/voice query and general workspace/GenUI tools are the equivalent
workflow, not a new tool per button. Navigation opens Daily but does not set local
filters; requested filtered results are shown in an acknowledged shared view.
Native reviewed writes and all private/export/device/cutover gates are unchanged.
Local synthetic UI checks do not qualify actual providers or a physical iPhone.

## Bind public Frida lookup as an optional read capability (17 October 2026; P12-09)

Retained Frida lookup exists in the canonical adapter and external MCP boundary
but was absent from the internal tool composition. Add an optional data
capability bound to the configured owner, not a sixth module argument, another
provider implementation or automatic network call. Existing data and module
callers remain source-compatible. Shared component validation keeps external
MCP behaviour and explicit unknown quantities unchanged.

Use the adapter's20second budget inside the existing ordinary30second caller
path; no approval wait or long-running exception is appropriate for this read.
Keep attribution, cached retrieval timestamps, unknowns and partial totals.
No conversation/history/credentials or caller-selected endpoint enter the
provider interface. No reference result authorises intake. Live-provider
acceptance remains unverified, and personal suggestions must not invent an
authoritative remaining budget (Dan later ruled the owner-configured allowance
inputs; see "Use owner-configured nutrition targets for the daily food budget").
This is inactive source integration only.
Qualified a8 passed its first normal CI, four actual CodeQL analyses and
automatic source review without findings. #876 merged9334d3ed with the same
6da17b0c tree; Deploy39012842333 released backend0000337 only. Actual routine
smoke13/15ok retains PC bridge down and recurring chat identity degraded,
without attributing either to this source. No live provider proof is implied.

## Group internal saved-food integration without changing released callers (17 October 2026; P12-09)

Continue the retained migration with one `daily_saved_food` tool for owned
lookup/preferences and native-reviewed favourites/aliases, plans and canonical
preferences. An additive fifth factory keeps the released fourth-argument
composition source-compatible and avoids enabling new capabilities implicitly.
Reuse the canonical store and shared external schema instead of a second writer
or provider. Internal new IDs derive from the verified human source; proposed
definitions stay estimates. Freeze actual before/after and source evidence,
bind revisions/fingerprints under existing SQL locks and recover only matching
real receipts without retrying writes. Preference changes use the existing
favourites invalidation after commit, with no replay notification.

Full pre-publication tracing found another transport deadline: the browser
voice relay aborted ordinary calls after30seconds before the tool's own bound.
Give only the two native-reviewed food tools180seconds at that wrapper; preserve
session cancellation and other tools. Hosted-agent reads remain210seconds and
cards120seconds. No extra runtime setting, transport, background mutation queue,
schema, dependency or production activation is needed. Actual caller/SQL/relay
qualification passed first normal CI; #875 merged as195bc89c with the qualified
c12eca94 tree and Deploy39010283459 released backend0000336/agent107. Actual
routine smoke14/15ok retains only the existing PC bridge warning. This does not
complete activation, source/private reconciliation or client/device acceptance.

## Reuse browser-only Now approval for internal food proposals (17 October 2026; P12-09)

Continue Dan's authorised migration with the existing Now confirmation service
rather than a new nutrition proposal queue or model-supplied acceptance. Add a
trusted optional browser-only delivery selector; existing callers retain their
current-channel routing. Food review always selects browser-only, so a race in
presence cannot send sensitive meal summaries into Teams. Require present mode
before review and again in its exact action callback.

The optional internal review tool handles estimates, corrections and soft
deletion against the existing owner/session/message and canonical SQL store.
Freeze model proposals before display; show actual before/after values and
dates, reject oversized reviews and serialize pending reviews per target.
Food cards have an explicit two-minute expiry shared by SQL, the visible card
and timer, with the whole operation bounded to three minutes from entry.
Existing callers retain the default five-minute confirmation lifetime.
Native approval is owner-bound and consumed once before the action. Neither
origin alone, spoken text nor caller confirmation flags are write authority.
Exact-label and actual saved-favourite direct requests keep their one-step path.

Initial real HTTP-schema qualification found Ajv converting unknown nutrient
nulls to zero through a numeric-first union. Generate a single nullable numeric
type while retaining canonical bounds and strict domain validation. Independent
review also found that the hosted agent's ordinary 30-second read timeout would
cancel a pending food approval. The first 390-second read correction passed
CI, but a further review identified the actual externally ingressed backend's
[240-second HTTP ceiling](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview#http),
verified against current first-party documentation on 17 October.
Use an explicit shorter food-card profile and a tool-specific 210-second read
budget instead of pretending that a longer client deadline bypasses ingress.
This keeps existing approval lifetimes and unrelated tool deadlines unchanged,
makes the real food expiry visible, and avoids a new background mutation queue
or writes that survive cancellation. No infrastructure or paid-resource change.

Further review found the generic phone approval ran before food's own context
refusal, allowing an impossible five-minute approval to consume the HTTP budget.
Use an explicit tool capability, `denyOnPhone`, checked by the existing dispatcher
after active-session validation and before any approval or execution. Set it on
both internal food tools; do not special-case names or change other phone tools.
The existing Now UI already displays the actual returned `expiresAt`; no new
frontend control or hardcoded review duration is needed.

New nutrient/component proposals stay estimates and cannot retain a whole-meal
verification claim. Preserve unchanged exact nutrient provenance and nulls.
Existing SQL revision/range locks prevent stale correction/deletion, including
historical records. Recover uncertain results only from matching actual
source/proposal/revision receipts; a read tombstone is labelled already-deleted,
not a new mutation. No Health export or new persistence is introduced.
This is browser-reviewed internal source work, not full conversational/spoken,
photo-evidence, client/device acceptance, production activation or cutover.

Final source `d17fe622` was independently qualified and reviewed without
findings, then released through #874 / `f1d410b1` with the same `c0f112bf` tree.
Deploy39006050135 selected backend and agent, not infrastructure/web; revision
0000335 and Foundry version106 passed routine readiness/smoke. Keep this release
separate from activation or actual private/client/device acceptance.

## Ground direct internal intake in the verified human request (17 October 2026; P12-09)

Use one optional sensitive internal food tool, separate from MCP enablement,
without changing production composition. Accept only an operation; derive the
saved name or exact-label quantities from the verified current Dan message.
Message origin alone, model classification, caller nutrients and confirmation
booleans are not write authority. Start with complete explicit command shapes;
refuse unsupported wording rather than silently narrowing or estimating it.
This is a bounded first integration, not a replacement conversational policy
or completion of retained nutrition parity.

Explicit saved-favourite selection accepts that existing saved portion without
another confirmation, preserving its confidence and unknowns. New estimates
remain outside this direct path. Derive one owner/session/message operation
key, retain a source fingerprint and recover actual committed rows before
looking up mutable favourite data. Refuse source edits and deleted intake
instead of duplicating it. Check the selected favourite snapshot under SQL
locks before first commit. Reuse the existing store, refresh and sensitive
message-backed audit; no new ledger, dispatcher or schema is needed.
After independent review's overlapping favourite-edit race, also read back the
same operation key on a known conflict/uncertain result and validate its source
binding. Never retry the write or replace absent evidence with success.

## Bind saved-food review to committed source snapshots (17 October 2026; P12-09)

Group retained favourite/alias, plan save/soft-delete and canonical preference
writes in one native-reviewed connector tool, with a separate read-only
preference tool. Reuse existing owner-bound handlers and transactions.
Use one pure plan builder for display and persistence, plus source revision
or shared DTO fingerprint checks under SQL locks. Never review IDs alone
and then silently resolve different quantities at commit.

Add target-only favourite/feedback revision counters in new 0050, keeping
deployed 0049 immutable. Preference clears retain null/version evidence;
old retries must not resurrect a superseded preference. This includes initial
clears: persist revision 1 rather than leaving revision 0 available to an old like.
Return actual rows,
preserve normalized-name ID reuse and omit repeat updates/notifications.
The migration also extends the constrained existing audit allowlist; guarded
rollback refuses used revisions/clears/new audit rather than erasing them.
Production composition, original Daily and account/device/cutover gates stay
unchanged. This does not supply internal trusted-message authority.

## Reuse saved-food lookup without expanding connector authority (17 October 2026; P12-09)

Extend the existing `lookup_food` with an exclusive `savedName` alternative;
preserve its original Frida component input and five-tool audit allowlist.
Use the existing owner-bound favourite/alias-before-history resolver and shared
query DTO projection, not a second search algorithm or raw SQL-row response.
Missing/ambiguous/oversized records stay explicit; never fall back to a provider
or write intake. No migration, permission or confirmation change is required.
Keep historical names valid through 2000 characters even when they cannot form
a 256-character favourite key; skip only that impossible favourite match.
Favourite-key validation and its existing normalization stay unchanged.

## Isolate the inactive hosted nutrition connector (17 October 2026; P12-09)

Continue Dan's authorised Daily source work after the completed releases,
without treating missing account/device acceptance as a reason to rebuild or
park eligible inactive implementation. Use maintained split MCP v2 packages
inside existing Fastify composition and reuse the existing query service,
typed nutrition handlers, SQL idempotency/revisions and commit refresh hub.
No second persistence system, host, model or consent/credential creation is needed.

One separately configured delegated Entra client receives only nutrition
scopes and a distinct principal restricted by the root hook to the exact MCP
route. Do not promote it into ordinary `access_as_user` authority or trust
client/model confirmation booleans. Native form acceptance must match
SDK-signed, expiring owner/client/purpose/payload state. All external writes
require native review until an actual trusted exact-intent integration is
accepted; internal exact logging retains its existing one-step contract.

Modern 2026-07-28 only and process-local confirmation keys are deliberately
inactive constraints, not demonstrated ChatGPT/fleet compatibility. Unsupported
clients fail closed; restart/replica changes require new review. Account
linking, OAuth scopes/grants, fleet policy and real client/phone acceptance need
their actual gates. No alternate screen, broad OAuth fallback or activation
follows from this source decision. Initial dependency restore failures remain
failed evidence: one package-download timeout, then stale cached client
metadata reporting ETARGET; fresh registry metadata reports client 2.3.1.
Neither result is a compiler/test failure or a successful installation.

Independent review identified that a UUID HTTP request ID cannot be inserted
as the existing required conversation-message FK. Extend the existing
tool-call store/table with a separate constrained UUID connector correlation
(0049), preserving normal audit identity and refusing rollback over retained
connector rows. Do not invent a conversation or introduce a second audit
store. Restore the existing message index around the down script's nullability
change; SQL Server will not tighten nullability under that index. Register fixed
failure events; raw food/provider diagnostics stay out.
Also remove the route's misleading browser-origin allowance: this adapter is
server-to-server and rejects every Origin rather than broadening shared root
CORS. Synthetic clients must explicitly negotiate modern protocol; the SDK's
default legacy connection is deliberately rejected.
The native form wire grammar cannot express `additionalProperties`; use its
supported object schema for the question, then strictly validate the returned
content before accepting `confirm: true`. Do not weaken approval validation or
fall back to a model-supplied confirmation.

## Scope Web checks without reducing CI coverage (16 October 2026; P11-08)

The Web workflow invoked root npm scripts, which run contracts, frontend and
backend sequentially. The separate Backend job already owns the same backend
checks. Explicitly select contracts then web for Web's three commands; retain
the existing backend, container, SQL, image, Python and CodeQL jobs and aggregate
gate unchanged. Do not save time by omitting contracts, adding path skips or
weakening tests. Root dependency installation stays unchanged.

Clean Daily CI `38975315146` recorded Web at 8m19s and Backend at 6m01s.
The workflow and root scripts establish duplicated execution; one run's timings
do not establish a general speedup. Actual successor CI must demonstrate all
remaining checks rather than borrow the earlier green result.

## Reuse presentation for ordinary realtime tools (16 October 2026; P11-07)

Source tracing confirmed that ordinary realtime execution bypassed the existing
voice work-presentation hook. Connect that executor rather than add a display
tool, renderer or relay-specific branch. Reuse successful returned summaries
and prefer text/list for readable dates; reserve charts/timelines for requested
representations. Calendar staging and later verified approval stay separate.
This corrects a demonstrated missing path, not a claim that the unavailable
original rejected payload or live provider session has been reproduced.
Review identified that the internal pending lookup on an approval/decline turn
could race the final receipt. Suppress that internal presentation; ordinary
explicit pending reads still present normally. Do not add ordering state or
change Calendar approval semantics to solve a presentation-only race.

## Batch the ready follow-ups after the priority hotfix (16 October 2026)

P11-06 / #863 shipped first as `6192574e`; normal Deploy `38953446877` passed
web and smoke. Qualify the already-reviewed header #862 and Factory parity #861
in one PM-owned follow-up PR rather than two successive full CI/deploy cycles.
The source boundaries do not overlap; shared documentation retains both sets
of requirements, evidence and task rows. Preserve published histories through
ordinary merges, never force/rebase them. Bind all source blobs to their
immutable reviewed heads and run complete normal CI/CodeQL on the integrated,
current-main candidate. This is integration ownership, not permission to waive
acceptance, close all of #811, resume protected export or claim native-phone
proof. The actual qualification and release receipts belong on the integrated
PR and linked issues; this source checkpoint does not claim a follow-up pass.

## Mobile composer focus hotfix (16 October 2026)

P9-117 (17 October 2026) retains this desktop/phone ownership boundary: add an
in-window phone height grip, sharing the existing resize limits and gesture
handling but saving its preference under `jarvis.conversation-layout.phone.v1`.
The eight desktop borders were explicitly excluded on phones, not broken
pointer-event handlers; their outside-edge targets are also unsuitable for
a full-width dock. Apply only phone height, without enabling desktop placement
or its composer-anchor path. Physical iPhone and Safari acceptance remains
Dan's; Chromium touch emulation is not native-device proof.

Confirmed with JarvisPM for P11-06 / #860: suspend desktop manual conversation
geometry under the existing phone layout policy, preserving its persisted value
for desktop restoration. Do not patch focus scrolling, invent a keyboard inset
or add a replacement layout. A CSS-only inline-position override would retain
the competing measurement path; rescheduling that path would still fit desktop
geometry into a phone dock. Deriving no phone manual layout removes that
ownership conflict at its source and matches existing phone geometry-command
semantics. Remove desktop-only Move/resize controls on phones as part of that
boundary. Controlled released-source reproduction and a failing regression
support the decision; native-device cause and acceptance remain unverified.
PM's independent source review of `5b3a5933` found no blocker. The unchanged
production source subsequently passes focused regressions, web lint/types/build
and controlled rendered phone/desktop restoration checks. Final head `315c85b6`
passed full normal CI `38952176445` and all four actual CodeQL analyses in
`38951934641`. #863 merged as `6192574e`, tree `52bc3fe6`; normal web Deploy
`38953446877` and smoke passed. Public `main-BHyATt-B.js` matches that web build
and returns HTTP 200. The disconnected PC bridge remains a nonblocking warning;
`chat_identity` is ok in this run. Issue #860 stays open with `needs-decision`
for native-phone acceptance. A deployed controlled-browser correction does not
establish the cause or result on Dan's physical iPhone.

## Account-owned background-work dismissal (17 October 2026; P11-12 / #905)

The explicit cross-device requirement supersedes the P11-05 / #859 decision
below that dismissal is a scoped device preference. Store dismissal separately
from jobs, keyed by the authenticated owner and UUID. Only the configured owner
can access these jobs. Dismiss-one and Dismiss all finished never change a job,
its events, results or lifecycle; running work is not dismissible.
Keep existing list fields compatible with deployed clients. Import at most
1,000 validated legacy UUIDs, retain local hides on failure, and remove the
browser copy only on confirmation.

The popover explains kind, start time and recorded failure reason, and groups
equivalent finished entries for one dismissal. Derive the neutral wording
“Interrupted by a restart” from the existing stored restart reason without
rewriting historical failed rows or changing Status/Usage/audit calculations.
Do not infer a specific trigger or restart from a generic failure.

Source inspection confirms that embedding runs can start on model changes and
at startup with missing vectors, and that reconciliation records
`interrupted by restart`. No stored production rows are available in this
checkout; the reported cluster's timing and cause remain unverified.

## Filter header background work instead of retaining hidden rows (16 October 2026)

Dan reported that Recent jobs kept dismissed indexing/research entries visible
and questioned its purpose. P11-05 / #859 chooses the smallest existing-surface
repair: name it Background work, distinguish it from Factory tasks, and render
only the store's already-filtered jobs. A new active/history split adds
unrequested navigation; removing the control would lose existing progress,
failure and result recovery. The stable trigger and empty state preserve focus
after the last dismissal. Raw history and backend tools keep saved records;
dismissal remains a scoped device preference, never cancellation or deletion.
This supersedes the earlier header contract's visible hidden-history rows,
not its persistence, truthful failure or unavailable-retry rules.

Evidence: the released 18-case header baseline passed, while a new regression
reproduced the exact retained-row/disappearing-cross failure. The candidate's
22 focused tests, changed-file ESLint and declared web types passed. An
intervening forks-worker startup timeout remains a failed run; the unchanged
selection passed with isolated thread workers and unchanged assertions/timeouts.
Real desktop Chromium inspected list removal, refresh/reload, empty/focus,
Escape and storage/network errors using synthetic jobs and no job mutations.
The first phone attempt stopped at a fixture CDP navigation race; it was not
counted as acceptance. After yielding to the mobile-composer hotfix, one
explicitly allocated phone-only run on unchanged reviewed source passed at
390 by 844 in light appearance with reduced motion. It covered dismissal
through refresh/reload, empty/focus, Escape and storage/network errors, with
44px dismiss targets, contained scrolling and no horizontal overflow, runtime
errors, external requests or job mutations. The fixture and owned browser
were stopped immediately; the signed-in released preview stayed unchanged.
Independent runtime/test source review found no blocking issue. Keep this
candidate draft/not-ready for PM-controlled current-main integration and normal
CI; local fixtures are not live, physical-device or deployment acceptance.

## Release active work together after its gates (16 October 2026)

Dan directed one combined deployment when all active work is ready, followed
by the handoff, and approved the normal combined-release PR/CI/commit/push/merge
pipeline after CI. The parent alone owns publication and deployment; source
integration grants no child publication or extra worker. Preserve immutable
producer inputs and qualify the exact combined source rather than assembling
independent green receipts into a fictional combined pass.

Include the inactive Daily read slice without activation, private migration,
protected exports, device changes or new coaching. Keep failed Daily v3b and
blocked root/pinned gates explicit. No split release, repeated restore, unrelated
#816 transport or withdrawn mail extraction is authorised by this integration.
Historical private itinerary deletion hunks remain internal evidence, not
publishable patch attachments. Ordinary production application approvals remain
separate from approval to release code.

## Reuse the authorised release identity for Foundry checks (16 October 2026)

Dan explicitly selected keeping permissions unchanged and using the existing
release workflow's Foundry checks after the local approved-tenant identity was
denied agent-read access with HTTP 403. Stop local Foundry data-plane reads;
do not grant roles, switch credentials or create an environment to work around
the denial. The existing production deployment identity already has its
required project/account roles and performs the normal hosted-agent checks
only after release gates pass. Local current-agent metadata and routing were
not verified; do not present management-plane project existence as that proof.

## One approval for an explicitly listed calendar proposal (16 October 2026)

Dan selected **one approval for both explicitly listed events** through the
coordinator. Add `calendar_create_events` for 2–10 creations rather than replace
the existing single-event API, silently drop later bookings or reinterpret an
already-issued single-event approval. Validate all inputs before staging and
show every full subject/local-time/zone/attendee summary. A later approval
authorises only that captured list; cancellation discards the entire pending
proposal without writing.

Reuse the existing process-local, ten-minute, single-use confirmation owner;
do not introduce a durable queue or imply transactionality across Google
writes. Execute sequentially, stop on failure/cancellation, preserve per-item
success and distinguish a known rejection from an unknown write outcome.
Never replay successes or unknown outcomes automatically. Retain only the
current proposal's source-session-bound receipt until its original expiry;
restart means unavailable evidence, not proof of no write.

For explicit multi-create intent with the batch tool available, refuse an
isolated single-create before backend staging rather than hide a partial
proposal during continuation. All concurrent single-create arguments must
reach whole-list validation together. Preserve older unrelated pending state,
but do not approve/relabel it when the newer batch failed or stayed incomplete:
the latest request's canonical server-verified message ID must equal the
existing staged source ID in trusted backend pending/receipt evidence. Retain
IDs as optional, backward-compatible, non-prompt `ModelMessage` metadata;
never infer identity from prose/labels/counts or accept a model-supplied source
argument. Preserve current-request/history/steering/caption identity and enforce
the same origin guard for model-dispatched confirmation. Missing, truncated or
mismatched origin fails closed; ordinary single-event callers remain compatible.
The coordinator authorised only the necessary runtime metadata assignments,
not PR #816 connection reuse. No cancellation, new persistence or retry machinery
is added.

Direct coordinator review authorised a narrow v2 correction: contextual
"Add those two." uses recent calendar routing, with Notes/mail isolation, but
approval still binds the actual latest verified creation/calendar mutation ID
to trusted stage evidence. Do not skip that request or a newer other-workflow
creation to find an older matching source. Keep bare cancellation as a reply.
Add `put` to the same claim policy, not a second classifier. The final narrow
correction recognises Danish demonstrative "de/disse to" without making English
`to` a quantity. Final selected checks passed 444 Python cases, Ruff8 and 58
qualified Node cases with unchanged Node identities. Preserve earlier patches
and passing/failed receipts immutably; these are not full pinned CI or release.

The released agent's topic-based final guard reproduces 22 failures among
27 new synthetic controls. Restrict it to affirmative action/approval claims,
including calendar requests without the recovery tool. Preserve ordinary
conversation, explanations, incomplete requests and explicit tool errors.
Normal chat uses labelled CommonMark records with blank lines rather than
unsupported pipe tables; this does not give the model a live UI preview.
The missing third-booking email is no longer a defect: Dan confirmed it was
not in Gmail. No Gmail extraction, live account action or release is part of
this local candidate.

The coordinator also authorised a narrow correction to catalogue-wide chat
buffering. Reuse the existing calendar scope/claim policy to release only
completed ordinary sentences while retaining incomplete/action/calendar text
for final grounding. Do not simply stream every non-calendar-request response:
later chunks can still claim an unsupported calendar action. Refresh scope on
steering, retain provider cleanup, and verify irreversible-yield ordering with
Event-held synthetic providers. This does not establish historical latency
causation or production savings, and does not duplicate PR #816's separate
runtime connection reuse.

## Resume only the inactive Daily read integration (16 October 2026)

Dan selected the existing Daily session under coordinator ownership to continue
the partly integrated project. The coordinator released the nonprivate #724
API/read-tool/committed-invalidation slice on exact main `2823585`; the old
general engineering pause no longer blocks that slice. It is not permission for
#717/draft #741 exports, #727 devices, private migration/cutover, new coaching or
production activation.

Use one `DailyQueryService` over accepted #720 health and #722 meal-history
interfaces for HTTP and the existing sensitive tool dispatcher. Preserve
canonical values, nulls, dates, provenance and owner resolution. Reuse the
existing refresh event instead of widening global SSE/chat contracts.
Publish invalidation only after an acknowledged SQL commit; query-content
fingerprints and refetch-on-reconnect/refocus recover missed local hints without
claiming a durable replay log or atomic multi-query snapshot. Retained duplicate
operations do not publish a new intake/domain change.
Acknowledged inbox completion/quarantine/retry-exhaustion transitions notify
sync only, including a pending retained-lineage replay; they cannot advance
processed health freshness. Keep notification failure in the existing event
boundary, not the SQL retry/result boundary.
Nutrition uses the same listener-error boundary even for a directly supplied
sink, so a failed hint cannot reject an acknowledged insert/correct/delete.
Read fingerprints sort validated DTO keys independently of nutrition's unchanged
write node/depth limits. Enforce the response byte limit, including the final
64-byte fingerprint, before hashing; valid full pages and retained nested
provenance must not fail because of an unrelated write budget.

Keep hosted ChatGPT food writes explicitly unfinished until their scoped
connector authorisation and trusted intent/proposal-acceptance contracts are
approved and implemented. Internal Jarvis reads are not a substitute for that
requirement. No maintenance/TDEE, completeness, expiry or readiness rule is
invented, except the one owner-configured allowance formula Dan later ruled (see
"Use owner-configured nutrition targets for the daily food budget"). Full #724,
live/provider/device/source-parity and release acceptance
cannot be inferred from synthetic checks.

16 October continuation after #866 deployment: extend this existing read
service to retained favourites and plans rather than inventing another API.
Use their existing ID-keyset store pagination with exact `{id}` cursors, no
calendar period and a 100-row bound. Keep plan snapshots/tombstones and raw
display aliases; they are not intake. Publish the actual collection source
after acknowledged favourite/plan commits through the existing safe event hub.
The public contract remains additive version 1. Hosted connector authority,
production activation and all private/live migration gates are not granted by
this continuation.

## Bound chat format support and avoid double keyboard compensation (16 October 2026)

Keep `react-markdown` and add standard `remark-gfm`, not another rich-text
system. Enable it only for chat; shared Notes/Knowledge readers stay unchanged.
Preserve raw-HTML refusal and safe links. Prefer labelled reservation
records in normal-chat guidance (calendar/agent owner); historical well-formed
tables receive semantic headers and contained keyboard scrolling. Do not infer
records or date/timezone values from a flattened malformed table.

Released-source actual-App Chromium reproduced the ugly pipe paragraph even
with correct source newlines. A controlled stale `innerHeight=844` with a
430px fixed viewport reproduced a composer at top -62px and a 2px transcript;
ordinary resize/pan alone did not. Publish visual-viewport top/height directly
instead of subtracting metrics from different viewport coordinate systems.
This establishes a failure mode and correction target, not the exact metric
sequence on Dan's iPhone. Physical Safari acceptance stays unverified.

Actual-App held-open SSE exposed a separate partial-table following race in
the first candidate. Follow content before paint rather than relying on
completion/refocus or adding a delay. Final production-source readback
measured tail gaps 0/0 across two held-open growths; an explicit history
scroll stayed at 100 through two more growths (gaps 866/1182).
The desktop browser also exposed the prose cap clipping table columns despite
available space. Widen only table-bearing replies, retaining contained phone
scrolling and ordinary prose measures. Newly authored tests use wholly
synthetic hotel/stay/price records; supplied-itinerary receipts remain private
evidence, not publication assets. These browser results do not relabel earlier
unit/static/build receipts as final-source passes.

## Reuse one existing control contract across Jarvis (16 October 2026)

Dan rejected mixed action shapes and decorative coloured boxed/bevelled tab
borders. The coordinator accepted CSS-only consolidation within Jarvis's
existing visual direction. Reuse the current control radius, primary/quiet/
selected surface roles and focus outline across routes. Reserve capsules for
status and genuine semantic exceptions; preserve neutral structure, accessible
state and touch targets. Prefer editing existing selectors to a new React
control library, parallel token system or blanket reset. Durable guidance lives
in this repository's agent context and product-ui skill, not global templates.

Header/job behavior remains a separately owned companion correction: recent
history consolidates terminal/hidden jobs; account/backend-scoped UUID
dismissal only hides local header state. It neither cancels server work nor
deletes history. Indexing Retry cannot be advertised as actionable without a
supported operation, and past interruption is not present health. No live
mutation or publication is authorised by these local UI changes.

## Keep Factory cache ownership project-local through invalidation (16 October 2026; local)

Dan authorised local fixes and regressions, not publication, deployment or
live/private probes. Parent accepted one pending source owner per project;
automatic updates mark it dirty without replacing it. Coalesce at most one
immediate follow-up. A follow-up invalidated again settles explicitly stale and
expired, allowing the next event/request to refresh without an unbounded drain.
Preserve validated fallback and original typed errors; failure is not a retry
signal. Check entry freshness at waiter settlement and keep cancellation with
the shared owner, not an individual waiter.

Ordinary task/webhook publication invalidates only its project. Resolve task
ownership first and log a safe lookup failure rather than silently clearing all
projects or replacing the original error. Keep intentional explicit global
invalidation support, complete GitHub reads, auth, validation, per-read bounds,
SSE versions and the existing client lifecycle unchanged.

Reuse first-error-preserving `readTogether` for the outer source/task/release
branches rather than releasing ownership on the first rejection while siblings
remain active. Await all started branches without an individual waiter's signal
or a new retry/deadline policy. This can delay error settlement until existing
branch cleanup; it is not a lower-error-latency claim.

The selected frozen-`2823585` direct-cache control actually failed at duplicate
ownership: expected one source call, observed two (12 collected, 1 selected,
11 skipped). A separate fresh-process v1 candidate run passed the complete
12-case direct-cache suite and four real-Fastify route lifetime controls, with
zero skips. Exact baseline board/app blobs, config/source identities and actual
output remain in the owned session artifacts. This qualified snapshot uses
Vitest 5.0.2/Vite 8.3.1 rather than current pins; Fastify 5.12.5 is exact.
Original buildApp/publication/auth suites and pinned lint/types/build remain
UNRUN/blocked by missing real dependencies; component checks do not replace
them. #809/#812/#814/#831/#842 are already delivered. This local successor
neither republishes their history nor establishes historical #811 cause,
quantified live latency improvement or #813/#811 completion.

Subsequent review found an LRU settlement edge: 32 other project completions
can evict a just-loaded entry before its waiter resumes, making a later
invalidation unable to mark that waiter-held object. Expire/mark evicted objects
stale before removal, without dirtying owners or creating capacity-driven
follow-ups. This deliberately treats evicted outstanding snapshots as stale
even without another publication. The new fixed-clock/gated control actually
failed at its freshness assertion on frozen v1 (13 collected, one selected,
12 filtered). Current v2 passed all 17 component cases, with zero skips.
Retain the exact v1 source and 16-pass receipt separately; only the new result
covers the eviction correction. Full-app/pinned and live limitations remain.

## Preserve the current source behind an interrupted reply (16 October 2026)

Direct tracing of the existing chat loop exposed a compatibility defect in
the new guard: steering persists an interrupted Jarvis partial after the Dan
message that identifies the next round. Synthetic registry controls against
the unchanged published guard reproduced four failures out of five new
controls; the completed-reply refusal already passed. Keep that red evidence.

Resolve one same-session predecessor only for an explicitly interrupted
Jarvis row, then require the exact source ID and Dan role. Reject other
sessions, stale/missing/non-Dan sources and completed-reply reuse. Retain
cancellation after each lookup and surface read failures. Do not add a broad
history scan, source-text cache or new persistence method. Fresh exact-source
CI and release remain required; a green earlier batch would not prove this
previously untested steering behavior. No Web source or test is changed.

## Resolve Gmail intent before discovery-dependent fallback (16 October 2026)

The exact released guard allowed a synthetic hosted `pc_open` Chrome dispatch
for a stored current Gmail request when no Google module existed: zero source
lookups and one dispatch. The native request with its verified message refused.
Retain that baseline failure; #848's post-mail tests did not cover this case.

Reuse the existing current-Dan-message history boundary before hosted computer
dispatch rather than rely on model instructions or wait for an unavailable
mail tool to run. Refuse stale/missing/non-Dan sources, propagate read failures,
and check cancellation after the read. Keep the existing independent-intent
rules, request-scoped nested exception, bounded identifier-only ledger and raw
observed-site guards. No new routing service, consent or permission is needed.

This is a local source decision and synthetic regression proof, not full
integration/build/CI, release or real private-account acceptance. Keep #837
open until its actual remaining acceptance is met. Do not consume or simulate
Dan's genuine later product-write approval to validate this correction.

## Accept the released clean Factory lifecycle (15 October 2026)

Accept PR #856's exact reviewed source `6e702e7a` after fresh full CI,
219 passing real-SQL cases, four CodeQL analyses and normal backend/four-runner
release. Fresh native Task 19 then delivered a new exact artifact in
`DanAakesen/jarvis-test-target#6`; current-generation commit-bound stopped-writer
proof preceded automatic Done at 23:49:53 UTC. Full reload retained Done and
Status reported zero tracked sessions. Existing no-CI grace and all policy
checks remained; no manual completion, cancellation or merge supplied success.

Keep artifact durability, owned-writer teardown, logical session accounting and
physical cloud deallocation distinct. The last remains unverified under the
existing Foundry 403 boundary. This clean run neither proves the cleanup-failed
live branch nor explains Task 18's historical failure. Preserve those open
qualifications and the earlier failed trials/SQL batches. The held entries
below remain historical evidence, not the current clean-path release state.

## Fence recovery before provider start (15 October 2026; implemented locally, held)

Independent V2 review reproduced policy Done and an approved merge using the
previous invocation's proof after recovery was claimed but before its
replacement session was persisted. Use a task/session execution generation,
advanced atomically when claiming work, with the existing policy lock and a
no-start-lease condition. Match the generation on backend proof as well as the
latest session and invocation. A failed start does not restore the old value.

Use dedicated additive columns rather than the retry counter (which can reset)
or event timestamps/IDs (task events can be archived while a task is active).
Normal dispatch and recovery both advance the generation; late start/failure
callbacks also carry it. Zero preserves the existing task/session association
for fresh verification only; do not backfill historical completion proofs.
Normal migration/SQL/build/Linux gates and independent pinned review remain
required. These changes do not identify Task 18's original cleanup failure.

Dan authorised workers, normal delivery and bounded live testing overnight, then
continuation with the next eligible board task after shutdown acceptance. This
does not release the specifically held Daily scope or bypass the Foundry 403.

Durable delivery, policy completion and runtime release remain separate facts.
The desired artifact-plus-authoritative-stop/fence completion path must not
discard a valid delivered PR merely because graceful finalization failed.
V3 received an independent source-only PASS at tree `7303f6e5`; real SQL,
Linux/build/release and the alternative completion path remained held.
Preserve that snapshot. V4 adds independently recorded successful-work and
successful-owned-provider-stop facts, not a timeout or absent-owner inference.
Only final failed snapshots with both facts and exclusively post-provider
credential/event/publisher cleanup failures can enter normal delivery policy.
Keep runner failure and sanitized diagnostics visible; require the same
generation/session/invocation and GitHub/policy gates. No external deletion or
cloud deallocation is inferred. This resolves the source contract, not its
unexecuted SQL/Linux/live acceptance.

Independent V4b review then found that a no-commit question turn also used the
generic completed outcome. Failed question delivery could therefore mint work
proof and reuse an existing PR. Preserve the held V4b pin. V4c derives successful
work only from the verified delivery-work branch and additionally rejects a
question-bearing snapshot. Actual worker controls must cover delayed question
delivery failure, not just direct-finalizer synthetic outcomes.

Independent V4c review confirmed that correction but held the candidate because
a new local commit did not prove it was pushed. Preserve V4c and its qualified
142-pass/11-POSIX-skip offline results. V4d binds runner work to its actual
verified commit SHA and requires the remote branch and delivered PR to match
it. Require the same binding for clean completion, not only the alternative
cleanup-failed path; otherwise clean teardown could still accept an old PR.
Unbound legacy snapshots remain readable but require fresh current-runtime
verification before Done or merge. Do not backfill or infer a commit identity.
The locked SQL policy gate compares proof commit with the expected candidate
head, including after deferred approval. A mismatched or unpublished commit
must not complete the task or obtain an approved merge. An unbound completed
snapshot produces verification attention without inventing a runner failure.
Exact-source review, real SQL/Linux/build gates and fresh live acceptance remain
outstanding; this does not establish the original shutdown cause.

Independent V4d review confirmed commit binding but found that verification
attention reused crash cleanup. With a running saved turn and no early result
event, a clean completed snapshot without commit binding became Crashed/failed.
Preserve V4d. V4e retains the observed completed invocation in both direct
cleanup and the state-change subscriber, since either can run first.
Use the existing invocation-completed SQL argument; do not infer work proof,
backfill events, invoke delivery or mark the task Done. Genuine failure keeps
its existing classification. Offline controls reproduced both incorrect
cleanup flags; added SQL controls must verify Ended/done/completed lifecycle
alongside task attention and denied policy. SQL/Linux/release/live remain held.

V4e received source-only PASS and normal ready PR #856, but its first genuine
automatic SQL run failed with collation error 468. Preserve that failure rather
than rerunning it unchanged: JSON proof text inherits the database default,
while Foundry session IDs use explicit binary collation. V4f applies explicit
`Latin1_General_100_BIN2` to proof-identity comparisons. Do not alter database
collation, rewrite stored IDs or relax the identity gate. Case-only changes to
opaque session/invocation IDs must be refused; add real-SQL controls alongside
the matching positives. V4e's full backend build and Python component step
passed, but neither those component passes nor its CodeQL success accepts
changed V4f source. Exact new-head review/SQL/CI/release/live gates remain.
That failed SQL batch also blocked three existing rollback controls because
their shared fixture now held used execution generations. Keep 0048's refusal:
give rollback controls disposable fresh databases, and explicitly test that
unused rollback succeeds while a used generation, its columns and ledger remain
intact after refusal. Never clear generation history or weaken the production
down migration merely to pass a fixture.

V4f2's first genuine SQL batch passed those identity and rollback controls, but
still failed nine tests. Keep that failure. V4g corrects the observed fixture
boundaries without changing runtime: advance the existing reconciliation
observation clock rather than persist a heartbeat older than its session;
derive session start/heartbeat/end from one SQL timestamp; and exercise the
saved absent-runtime cancellation snapshot after a legitimate recovery rather
than deadlock by requesting recovery inside the cancellation policy lock.
Retain actual dispatcher cancellation of the recovered runtime. Register
synthetic tasks before fallible fixture setup and cancel them in `finally`;
the previous helper could strand a Running task when an insert failed, consuming
global capacity. Do not relax constraints, raise concurrency, remove cases or
increase timeouts. Fresh real SQL must establish that all remaining failures
clear before normal release or live acceptance.

## Fail closed on explicit runner failure and finalization deadlines (15 October 2026; implemented locally)

Independent read-only source reproductions showed that early result events
could misclassify a later failed runner as idle expiry, refresh its heartbeat
and leave the last reconciliation scan too early. Give the explicit current
runner failure precedence; do not treat a prior completion/question event as
finalization proof.

For the reproduced freshness gap, admit already-ended eligible sessions
immediately rather than introducing another five-minute eligibility timer.
Keep the active-session freshness guard, latest-generation fences and five-row
batch bound. Additional source controls reproduced three failures in the first
candidate: coalesced expiries beyond five rows, starvation behind five failed
rows, and an earlier task expiring during an in-flight scan.

Advance a stable task-ID keyset through bounded batches, scheduling another
yielding pass when a batch is full even without tracked sessions. Keep pending
expiry wakes until the sweep completes, then rescan from its beginning. Do not
refresh an ended session's heartbeat merely to manipulate ordering or use an
offset that skips rows as state changes. SQL scan and row-operation failures are
visible and retry at the existing interval; successful idle sweeps stop. Add stop and outage
controls alongside the three before/after reproductions. This revision remains
unreleased pending independent exact-patch review and normal Linux/SQL gates.

Use one 60-second finalization work budget, ten-second IO caps and one-second
cancellation joins. Timeout is an unknown/failed outcome, not successful
cleanup. Retain unsettled asynchronous owners and refuse unsafe retries,
including a queued turn that acquired its lock after an earlier timeout.
Do not begin another credential write after the shared deadline expires.
Process-local fencing does not survive process restart and does not establish
cloud deallocation. No new access grant, provider workaround or Daily scope
is authorised by this correction.

Local actual-source controls cover blocked IO, cancellation resistance and
ownership races. They do not establish the historical Task 17/18 cleanup phase,
real SQL correctness, Linux process behaviour, release success or live shutdown.
Freeze the source and obtain independent read-only review before publication.

## Require current runtime proof before GitHub policy completion (15 October 2026; implemented locally)

Normal source `5c5be688` recovered backend revision 323 and passed required
release smoke; advisory chat identity remains degraded. The one subsequent
Factory trial, Task 18, delivered the exact new 47-byte artifact in
[DanAakesen/jarvis-test-target#5](https://github.com/DanAakesen/jarvis-test-target/pull/5),
but emitted `ACPShutdownError` and never automatically reached Done. Supported
cancellation later reached Cancelled. Neither that nor idle expiry proves
physical deallocation. Its cleanup phase and GitHub refusal's HTTP status were
not exported.

Offline source reproduction demonstrates that descendants can retain pipes
after their ACP leader exits. Isolate and stop the owned POSIX group rather
than extending deadlines or killing unrelated processes. Check live Linux
members, not unreaped zombie presence, and retain explicit process/reader
failure. New group ownership and phase diagnostics remain unaccepted until
normal gates and a fresh released trial.

Source and permission-faithful offline controls also demonstrate that the
policy evaluator's write token lacks its checks/statuses read capabilities,
and its merge method was POST rather than PUT. Reuse existing scoped helpers;
do not add installation permissions or mint write credentials before approval.

Repairing reads must not enable a green PR to bypass runner cleanup. Record a
backend-only, current-session/invocation proof from the dispatcher's verified
terminal snapshot, using existing event storage and coordination locks. Require
it for Done and merge, including after deferred approval. Early runner events,
expired sessions, absent runtimes and historical evidence are not substituted
for this proof. Do not backfill completion or weaken no-check grace, branch
protection, cancellation fencing or Daily holds. Existing nonterminal tasks
without proof remain fail-closed pending fresh runtime verification.

## Register attachment cleanup before Fastify listens (15 October 2026; source correction)

Own the existing conversation-attachment cleanup job in `buildApp`, with its
hooks registered once during construction. Start it in `onReady` and stop
its interval in `onClose`, independently of embedding configuration or
re-embedding requests. Preserve the existing hourly interval, immediate bounded
100-item cleanup, retention policy and content-free failure event.

Exact `e17cbb0` source incorrectly registers these hooks inside
`onEmbeddingModelChanged`, which startup can invoke after `app.listen`.
Real Fastify 5.12.5 rejects late hook registration with
`FST_ERR_INSTANCE_ALREADY_LISTENING`; the same callback is also reachable on a
later embedding-model change. Remove that registration from the callback rather
than extending readiness timeouts, suppressing startup failures or changing
production configuration.

Backend revision 322 repeatedly exited after `database.ready` and two generic
events; revision 321 remained healthy. The fatal catch discarded the exception,
so the reproduced source defect is not proof of the precise historical live
exception. Offline regression, normal reviewed release, new backend readiness
and required smoke remain separate evidence. No new Factory shutdown trial,
Daily activation, private-record query or manual Azure change belongs to this
correction.

## One balanced stage, not quality tiers (15 October 2026; local)

Dan approved the stage-performance review but rejected tiers and choices.
Use one fixed rendering budget, bounded ambient/voice/mirror cadence and
cheaper geometry/shader detail. Keep the room mounted across routes but
hold its last frame behind work pages, preserving the agreed one-room feel.
Remove adaptive resolution changes rather than tuning their oscillation.
Coalesce real size changes before drawing and never clear the buffer after
rendering a frame. Keep the actual mirror, cyan shell/open amber core,
truthful audio/activity, reduced motion and context recovery.

Dan said the changed stage still looks good. That accepts the local visual
direction, not measured machine-power savings, physical-phone performance
or absence of production flicker. This work is separate from the frozen
header/cancellation release and the unresolved mobile composer report.

## Retain model-round maxima without changing first samples (15 October 2026; source candidate)

The diagnostic turn exposed a visibility gap: `model_request` retains the first
Responses create observation, so a slower later tool round is not represented
by that field. Add only optional content-free `model_auth_max` and
`model_request_max` in the existing turn-local timing collector. Instrument
the shared model-token provider and both providers' awaited stream setup;
finalize on success, error and cancellation without changing propagation.
Keep existing first-observation fields, bounded finite durations, model
arguments, retries, deadlines, settings, permissions and resource lifecycle.

Log the new diagnostics at the backend but do not widen the legacy browser
reply's timing field set; mixed agent/backend deployments remain optional-field
compatible. There are no timing-phase constants in baseline `6e2c1b95`'s
contracts package, so no new public contract is introduced. Maxima can describe
different attempts and token time overlaps setup. The underlying delay remains
unknown; SDK retry, token refresh, throttling and provider queueing are not
proved causes. This candidate does not fix latency or accept the release,
Factory task cancellation, or the separately owned physical mobile composer.
No new live/model/tool/job call belongs to this source/test handoff.

## Bound owned ACP teardown without early terminal success (15 October 2026)

The source has an unbounded post-kill process wait and an unbounded stdout
reader join; stderr previously had no retained task owner. Deterministic
owned-process/reader controls reproduce these lifetime risks separately from
the parent's real artifact-delivered/automatic-finalisation-failed trial.
Bound each shutdown phase, retain and join both readers, share stop work across
callers and preserve cancellation after teardown. Report sanitized explicit
failure if exit or reader cleanup cannot be verified; never silently treat a
reader exception, timeout or attempted kill as successful cleanup.

Remove only a successfully stopped matching client. Retain failed ownership
to prevent another turn sharing an unverified provider, without removing a
replacement client. Keep accepted terminal-after-teardown/event delivery,
delivery verification and cancellation confirmation contracts unchanged.
This is a local implementation choice pending independent review and exact
head gates, not a proved diagnosis or retroactive repair of the live runtime.
Task 17's later supported cancellation success does not change that distinction.
No publication, extra live action, access workaround or resource change is
authorised by this record; historical freezes remain immutable.

## Exclude new Daily coaching, preserve core integration (15 October 2026)

**Confirmed user decision, not a proposal or completed acceptance.** Dan:
"Also i dont know what that coaching is, but you dont need to add that, you can take that out of scope."

Withdraw NEW P12-08/#723 coaching/recovery/recomp automation from the planned
scope and combined release. Retain the first and waist-corrected unmerged
source freezes byte-exact as archived evidence, not accepted/merged work.
This does not remove existing main Daily health, nutrition, workout/tracking,
integration capabilities or retained readiness/recovery/measurement records.
No original application, schema or data change is authorized.

Core P12-09/#724 API/tools work excludes new coaching; a deliberately excluded
optional feature and its missing maintenance/TDEE, completeness, expiry or
readiness interpretation must not remain semantic completion prerequisites.
Do not invent those rules or activate #724. Existing core validation remains.
Dan's later ruling narrowly permits only the owner-configured allowance formula;
see "Use owner-configured nutrition targets for the daily food budget".
Keep one Daily page plus existing on-demand GenUI, no widget, extra
Workouts/Nutrition pages or mandatory four native views. Parent owns native
issue/dependency/board reconciliation after this source update. The coordinator
verified that plan-status derives native dependency links from PLAN, so update
only P12-09's dependency cell from `P12-08` to completed `P12-05, P12-07`
(#720/#722), not an empty or bypassed dependency. All 381 row positions,
309 task IDs, every Status cell and the other 380 rows remain byte-exact;
retain #723's row. Conflicting older scope descriptions are historical.

Protected backup/export, authoritative-original-source/parity,
real-device/provider, final-delta, rollback and cutover evidence remain
required for retained core scope. Original Daily stays canonical before
cutover. The coordinator reports that original-repository identity matches
GitHub main, but collector metadata is not proof of the earlier health-schema
source or live parity; this docs-only lane performs no further source search.
This scope decision alone is not code removal, a release or acceptance proof.

## Cancel attention after a failed pre-start without inventing ownership (15 October 2026)

Complete review after published `0b4e79c2` passed ten CI jobs / SQL 176 tests
and four CodeQL analyses found that a valid pre-start failure has no session
end reason. Refusing all such tasks prevents supported owner cancellation.
Permit only the trusted getter's existing-task/all-four-null runtime generation,
preserving unknown/partial/mismatched refusal and provider-free absent handling.
Keep the atomic expected-state and expected-generation terminal guard: a first
runtime appearing after capture must roll back without cancellation events or
replacement cleanup. Add controller/actual-transition and real-SQL positive/race
controls; this new finding blocks release until exact-diff review and fresh
complete CI/SQL/CodeQL. Prior freezes/green evidence remain historical, and
neither this correction nor standing delivery authority grants another live job.
Implementation/tests were published as `e6a41696`; final gate and deployment
evidence is tracked in PR #853.

## Standing authority for guarded delivery (15 October 2026)

Dan explicitly approved V5 continuation, then stated that committing,
pushing, merging and deploying authorised Jarvis work need no repeated
permission question. Record standing delivery authority rather than
reinstating candidate-specific consent gates from historical sections.
Independent source review, exact current-main/ownership checks, complete
fresh CI/CodeQL and serial guarded merge/deploy/smoke acceptance still apply.
Normal publication must preserve the user's checkout and owned history.
This does not authorise extra jobs/provider turns, private/device/access/model
scope, resource creation, shared settings changes or bypassing authentic
product-action confirmation. Release ownership remains with the coordinator.

## Shrink header tabs before native scrolling (15 October 2026; combined candidate)

Dan requested Chrome-like shrinking followed by horizontal scrolling,
without covering Presence or Settings, and inclusion in the next deploy.
Use the reviewed bounded flex containers and 140px minimum tab widths rather
than measured-width JavaScript. Keep window/job groups separate and job details
outside their scrolling child. Hide scrollbar tracks to preserve the compact
header. The phone sheet resets the desktop flex basis and keeps 44px rows.
Remove only duplicated runtime header feedback; chat, voice and backend-waking
feedback retain their owners. Preserve V5 runtime/fixture source exactly.
Fresh combined review, SQL/CI/CodeQL and release remain pending. The physical
mobile-composer report is separate and unresolved.

## Allow safe cancellation of attention tasks (15 October 2026; local candidate)

The coordinator observed a genuine-owner cancellation of the existing isolated
task 9 return HTTP 409 at 03:37:35 UTC while it was NeedsAttention with a null
latest session end reason. Its earlier authorised recovery produced a real
provider turn but a `session_question`, not verified Done. Existing public
artifact content is not evidence of a newly produced delivery. Earlier release
and rejection receipts remain historical and immutable; this work grants no
new live job or cleanup action.

Extend the existing cancellation lifecycle and shared confirmed Cancel control,
not recovery, automatic question answering or completion classification. Keep
the policy lock and merge guard, require an authentic owned-invocation cancel
acknowledgement, and reject replaced targets after the request. Add an optional
expected-state and expected-runtime check to the existing terminal transaction.
Runtime identity includes the latest session across all statuses and its latest
turn, even if the control target is absent or the turn already completed. Keep
the task update lock and session/turn range locks through terminal persistence.
A replacement must cause rollback before task mutation, event publication or
cleanup. Await existing session accounting and
deletion; preserve explicit failure and unknown-runtime outcomes. No new
service, state, migration, dependency or permission is needed.

Independent review rejected V2's state-only guard: recovery can return a new
runtime to NeedsAttention before the cancellation row check. Eleven deterministic
actual-dispatcher/actual-transition controls reproduce that defect against V2
and pass with the revised guard. V2 and its receipts stay immutable, not PASS.
The added real-SQL generation/recovery cases remain unexecuted locally.

V4 was published as `428555d5`; its two new actual-SQL fixture setup failures
did not reach replacement assertions. V5 corrects completed-invocation fixture
accounting without changing production guards and has independent source-only
PASS. The combined header candidate still requires exact-tree review and fresh
SQL/CI/CodeQL/release gates. No live cancellation or deallocation is claimed.

## Compose reviewed runner delivery after genuine recovery acceptance (15 October 2026)

Exact reviewed #852 normally reached main `5765d882` / tree `c5831563`.
Its automatic Deploy `38666983966` actually passed all six jobs and required
smoke `116203572330`; ready backend320 and the owner's retained fifteen OK
smoke entries corroborate current health. This clears the ordinary main release
hold, not original Google acceptance, historical attribution or physical capacity
proof. Preserve both C0's incomplete reply and BCE's whole-suite timeout.

Normally integrate that accepted source into the existing #850 branch, retaining
the V2 runner/test blobs and every main entry outside its eight reviewed paths,
including all PLAN table lines. Earlier `467cb5d` passed actual ten/four gates
and pinned runner204/agent398; require fresh gates for the composed head,
then normal Deploy plus actual exact-released-SHA Runner deploy. No new PR,
task, worker, permission or live fixture/job is authorised by composition.

Earlier decisions below remain historical; their then-pending release statements
do not supersede this actual acceptance or waive the remaining delivery gates.

## Integrate tested recovery source without prematurely accepting its release (15 October 2026)

Existing #848's independently reviewed `0519d12d` passed all ten actual CI
`38656025688` jobs/four CodeQL `38656025581` analyses and normally squashed
into main `bce6e02a`, exactly tree `6c0c9aa7`. Its normal Deploy `38658184723`
is still running. Keep ordinary main merges and approved live acceptance held
until the required smoke passes; a source merge alone does not clear C0's failure.

Published-ready Factory `99fdb727` independently passed its normal documented
full dispatch `38656814220` and four CodeQL `38656417765` analyses, including
actual pinned Linux runner204/agent335 with neither component skipped.
The earlier ready event executed zero steps and does not count. Normally compose
tested BCE source in the owned Factory surface while release runs, preserving
the exact V2 runtime/tests and every outside-eight-path main entry/task row.
The composed head requires its own full gate; normal Deploy and exact-SHA Runner
deploy remain necessary before the one eligible authentic owner job.

## Reuse the empty initial-plan draft for reviewed runner delivery (14 October 2026)

PR #850's head `4d57c6ba` adds no source bytes to its `51bda5cb` parent.
Its original direct-Gmail implementation is consolidated separately through
existing #848, while #837's real acceptance remains open. Reuse this otherwise
empty draft for the independently reviewed V2 runner lifecycle correction;
remove native closing references instead of accidentally closing #837.
No new PR, issue, worker or live job is created by this publication decision.

Normal current-main integration first produced exactly `c0d0aeef`'s tree.
Preserve all source outside the eight reviewed runner/context paths and every
main PLAN task-table line. The parent V2 PASS is bounded source/synthetic proof,
not full Linux CI, release, actual provider delivery or physical deallocation.
Main's newer required capability smoke is broken; ordinary runner merge stays
held until that separate demonstrated correction clears the gate.

## Factory runner terminal publication follows teardown (14-15 October 2026; local)

The frozen `202ead5b41af3247b51c893c59964fef716f5442` runner publishes and
persists `completed` before provider shutdown and awaited final event delivery.
Nine initial bounded synthetic cases reproduce an observable premature
`completed` poll or cancellation response while teardown is still pending,
including event delivery that later fails. This establishes an ordering defect,
not the historical cause of an existing production task.

Retain the existing lifecycle owner and public statuses. Stage the turn outcome,
shield owned finalization from cancellation, drain the current event-chain tail
before closing its publisher, and retain the session lock until cleanup settles.
Late stop requests affect the final status without appending to a closing
publisher. A failed cleanup remains failed, including on cancellation; a
sanitized 503 reaches the existing Foundry-client/control failure path. No
scheduler, task-state bypass, artifact shortcut or new dependency is introduced.

Independent parent review rejected the first local correction: disconnecting an
actual cancel request propagated a second cancellation into an unshielded
cleanup wait, and a late stop deadline appended `stop_timeout_forced` during
publisher close. Both parent tests reproduced locally. Shield the handler's
worker join and every cleanup wait, keeping the lock until the owned finalizer
settles even under repeated cancellation. Guard all control-event paths,
including a delayed ACP-cancel acknowledgement; deadline-driven termination of
the owned process remains effective without appending during finalization.

Thirty-nine lifecycle/control cases and 22 existing token/helper/deployment
contracts pass locally, as do the two unchanged parent tests. The original 18
regressions remain red against the exact baseline; 17 of 21 additional control
cases fail against the first local correction, with four timeout-contract cases
already passing. Tools are Python 3.12.10, pytest 9.1.1 and Ruff 0.16.10. The lifecycle
fixture uses real local Git commit/ancestry checks and child processes, but
in-memory metadata and synthetic provider/event delivery. Existing task/workspace
tests hit Windows' missing POSIX `os.fchmod`; no permission shim was added.
The full pinned Linux suite, image checks and live delivery remain separate.
The coordinator owns review, exact-head CI and both Deploy and Runner deploy,
followed by the single authorised authentic owner-facing acceptance job.
## End the backend chat response at application done (15 October 2026)

The existing Invocations consumer marked application SSE `done` as completion,
but continued awaiting HTTP EOF. Exact-baseline actual-module tests reproduce
the stalled lifetime with ordinary and smoke completion, a split frame and a
real loopback HTTP server that deliberately never ends its response. A separate
control exposes duplicate metadata and trailing-frame consumption after `done`.

Treat `done` as the terminal application frame: consume its existing bounded
metadata once, stop reading later frames and await disposal of the owned reader.
Do not extend deadlines, synthesize replies, relax canary receipts or change
the separately owned hosted runtime. Retain partial deltas, pre-terminal errors,
caller abort, missing-completion failures and legacy EOF parsing.
The original five defect cases fail on exact BCE source; five preservation
controls already pass. Corrected transport and unchanged canary checks pass
71 cases on existing Windows snapshot tools, not pinned Linux CI.

This fixes an independently reproduced transport contract defect, not proven
exclusive production causation. BCE's normal release failed with a whole-suite
timeout after five successful deployment jobs. Its unchanged global catch
replaces individual results, so the retained report cannot establish which
prompt stalled or shared-rule failure. Preserve C0's distinct incomplete-reply
evidence and #820's unresolved original attribution. Independent review, fresh
exact-head full CI/CodeQL and normal required release remain delivery gates;
Factory merge and approved live fixtures/job remain held.

## Require complete tool-grounded capability overviews (14 October 2026)

The new C0 reference release failed its required capability reply check, not
discovery: a genuine owner read of the retained 22:54 UTC report displayed
"Capabilities reply incomplete". The deployed canary source requires successful
discovery and a complete Notes/Calendar/GitHub receipt before that branch.
The precise omitted category and exclusive cause are not retained.

Use one generic category-summary instruction in the shared model builder for
chat, voice and smoke. Smoke omits the broader backend capability block; a rule
only there would miss the failing path. Name categories from successful discovery
instead of hard-coding categories, synthesizing success text or loosening the
canary. Preserve failure/refusal reporting, untrusted-data handling, existing
tokens/tool limits and saved model settings.

Synthetic actual-handler regressions verify instruction delivery across both
model rounds and unchanged output even when the fake provider omits GitHub.
The existing Windows Python 3.12.10 snapshot passed all 398 agent tests; the
fifteen new cases fail on the asserted exact baseline model blob. They do not
demonstrate real model compliance or resolve #820's earlier
historical failure. The candidate remains subject to independent review, exact
changed-head full CI/CodeQL and the normal required release smoke.

## Accept current recovery separately from historical attribution (14 October 2026)

The reviewed diagnostic tree reached main through #831 as `51bda5cb`.
Its exact-head full CI passed all ten actual jobs and CodeQL all three
analyses. Normal Deploy `38622011802` passed backend/web and actual smoke;
the ready revision's bounded enum-only telemetry positively reports
chat canary, capabilities and GitHub read `ok`. This clears the current
release blocker for the already-approved non-Daily queue.

Do not infer the previous capability failure's cause from this green run,
close #820 automatically, or substitute it for original phone/voice/Google
acceptance. Factory #842 preserved its accepted runtime blobs and all
309 main task rows, passed its integrated head's ten CI jobs and three
CodeQL analyses, and merged as `36d72090`. Normal Deploy `38629181064`
passed Web/deep-link and backend health/smoke. Accept that release without
claiming the original production trigger, performance or human navigation
acceptance; issue #813 remains open.

Inactive Daily #818 preserved every reviewed health blob and main task cell
after current-main integration. Its `af5ac2e7` head passed all ten actual
CI `38631864211` jobs and three CodeQL `38631863844` analyses, then merged
normally as `5939fb54`. Normal Deploy `38633353086` passed backend image
deployment, health and actual smoke at 20:43:27 UTC; unchanged web,
infrastructure and hosted-agent deployment were skipped. Accept that inactive
correction release, not activation, original data access or cutover. Google's
`F3BD79DA` also failed targeted re-review on three residual approval-scope,
quoted-query intent and native-window faults. Both it and `3073B943` remain
unapproved and immutable. The same reviewer also rejected `CEC84A7A`,
then passed replacement `3AF653B5` / `139ca8f7` / `05c77007` for the exact
two residuals and coupled controls. The coordinator's normal `5064afe4`
integration is conflict-free. Full pinned CI, normal release and actual
Google acceptance remain pending; the bounded PASS is not those gates.

Subsequent actual pinned CI `38644147405` at published #848 head `f2afaca9`
failed four calendar receipt-flow HTTP fixtures and one paused-PC fixture.
The frontend's 75 files passed before its root workspace command repeated
the same backend failures; do not create a separate UI owner or retry this
unchanged head. The same author produced six-path harness correction
`568666e1` with explicit internal fixture-route opt-in, an unmarked-route
403/zero-execution negative, exact two-read paused identity checks and zero
capture/action/model dispatch. The same reviewer passed that bounded
disposition at exact head `568666e1`: unchanged production/auth blobs and
all original receipt/approval assertions were verified; the real synthetic
connection reproduced the exact paused/resumed sequence. Its HTTP import
was still blocked on a missing local package, not a passing HTTP test.
Normal corrected-head full CI and release remain required.
Previous immutable PASS/FAIL receipts remain unchanged.

## Accept original inactive health code without private activation (14 October 2026)

The independent #720 lane found no demonstrable code/synthetic gap. Original
#808 and reviewed #818 already delivered its implementation. The coordinator
hashed the no-change receipt and verified 63 source/schema/auth/runtime/lock
inputs against actually tested #841 head `eea9a06f`, accepted `202ead5b`
and later main. Tested and accepted trees both equal `b05a2380`; actual
CI `38636782270` passed all ten jobs, including health-processing SQL 18,
health-upload SQL 12, normalization 45, read-model 2, upload 15 and lint/build.
Normal Deploy `38638073176` already accepted that tree.

Close original #720 code acceptance without a dummy PR or repeated release;
retain closed #718/#719 dependency links. The lane did not rerun npm locally
because of proxy/TLS failures. This does not accept or authorise activation, source-compatible historical
ingestion, HAE/physical-phone/source parity, backup/cutover or deployed health
capacity. Those downstream gates remain separate; the database export/import
approach was later withdrawn on 18 October 2026.

## Consolidate the existing maintenance review queue locally (14 October 2026)

Dan directed local implementation and coordinator ownership of both boards,
including GitHub publication and release. Consolidate the six already-reviewed
deliveries into existing #841: reference-only urllib3/multidict/PyJWT pins,
fake-CDP teardown tests, live PR-title validation and production C# CodeQL.
Preserve the reviewed source and unrelated current-main blobs; do not create
another PR, restart cloud coding workers or alter main task-table cells.

Individual Python 3.13.16 compatibility receipts remain individual evidence.
The combined three-pin manifest needs its separate baseline/candidate receipt.
Local Python 3.13.15 installation failed before tests on a genuine TLS failure,
also reproduced with default system TLS; do not disable verification or claim
combined compatibility. Add conditional reference validation to the existing
agent CI job, not another coding worker or workflow: separate baseline/candidate
environments, all pinned distributions checked, pip check, offline fixture tests
and synthetic HS256 readback. Use the reference's existing Python 3.13 major and
record the actual patch version; production Python pins and model-free agent
image checks are unchanged.
Require one normal integrated-head full CI wave and four actual CodeQL
analyses, with traced production C# extraction, before guarded normal release.
Reconcile the six issues/cards only after confirmed delivery. This does not
establish blanket dependency-advisory clearance or close the separate #830
advisory/compatibility acceptance.

Accepted outcome: #841 merged as `202ead5b` after ten actual CI
`38636782270` jobs and four CodeQL `38636782376` analyses. Actual
Python 3.13.16 baseline/combined environments each verified all 90 pins,
clean pip check, 42 offline tests and HS256 readback. Normal Deploy
`38638073176` passed all six selected jobs, including infrastructure and
hosted agent; none was skipped. All six original issues completed and
superseded review PRs closed after acceptance. This leaves separate
advisory dispositions qualified, not blanket cleared.

## Parallel overnight delivery and bounded live acceptance (14 October 2026)

Dan directed a ten-hour local-first delivery push with sensible parallel
subsessions and selective Copilot cloud work. Keep one owner per lane:
Google implementation/review, Factory lifecycle and inactive Daily acceptance
remain local; existing #830's reference compatibility is cloud-owned.
The coordinator handles current-main integration, existing PRs, review,
normal CI/releases and both boards. This supersedes the earlier blanket
no-cloud direction, not publication, privacy, access or release protections.

Dan explicitly approved one live acceptance run after review, normal CI
and release: one synthetic Gmail draft, never sent; one calendar event
named `Jarvis acceptance test` without attendees or notifications; readback
and cleanup of only these newly created fixtures; and one isolated sandbox
delivery job using existing resources and delivery PRs. Use genuine owner
authentication, preserve unrelated pending actions, and report missing
access rather than scraping tokens, bypassing consent or forging approval.
No personal emails, original Daily/data migration or activation, new
resources/permissions, extra jobs or private/device acceptance is implied.

Dan subsequently completed Microsoft sign-in/MFA himself in the shared
browser panel. Jarvis uses MSAL and backend `/me` verification; the SWA
`/.auth/me` response is not its session authority. Use the existing verified
UI/client, not token extraction, forged caller fields or a substitute
service principal. Successful sign-in does not itself accept any live
Google write, sandbox job, cleanup or physical platform-stop result.

## Coalesce automatic board updates behind scoped reads (#813, 14 October 2026)

Preserve an in-flight same-scope board read and queue at most one automatic
follow-up instead of repeatedly aborting it. Keep the 150-ms idle debounce,
full contract validation, explicit Refresh/Retry, retained snapshots and
visible failures. An update during the follow-up can queue the next read.
The request effect owns its timer/queue, so project/backend/token-callback
replacement, explicit reload and unmount cancel obsolete work together.
No unconditional retries, longer TTL, lost-update shortcut or separate
stream/cache is introduced.

The issue resolver reads that same owner's pending/queued/timer state before
definitively refusing a missing issue or requested task link. Actual-context
fixtures reproduced both refusals in the 150-ms settlement gap and ordinary
idle debounce. Wait for the known read within the existing navigation budget;
do not fetch speculatively or act after the bounded wait expires. Failed reads
return the visible error rather than an unconfirmed task-link miss.

Actual-component fixtures demonstrated cancellation under repeated updates
with valid deferred 10-second reads. That controlled proof justifies this
local correction; it does not identify the original production trigger.
No production acceptance, release or backend change is implied. The separate
Status snapshot/limits below remain historical evidence; #798 stays held.

## Keep consolidated recovery diagnostics compatible with live Status clients (14 October 2026; local)

Combine current main `81580919` and the existing #831/#832 diagnostics locally;
no new micro-ticket or independent publication. PR #832 retains allowlisted
degraded reasons internally, but already-open web clients accept HTTP reasons
only for down checks. Keep both HTTP routes legacy-compatible with a
non-mutating projection. Retain safe degraded reasons in the cached report and
export `system.smoke_check` through the existing event/field allowlists only
when an authorised smoke run actually executes. Reject unknown/cross-check
reasons and provider, prompt, tool or personal payloads at both log outputs.
No validator weakening, extra probes or release-gate/budget/approval change.

The 17:32–17:34 UTC existing-workspace query selected only exact-format numeric
model-round metadata and returned no matches. Prior smoke logs record only
IDs/statuses. Source tracing confirms that `get_system_health/list_capabilities`
returns the three required categories and that receipt extraction preserves
them; normal-chat capability instructions are not supplied to the smoke role.
That absence is a candidate, not a verified failing predicate or root cause.
Do not change smoke/model instructions or claim recovery without that evidence.
Local regression checks and the coordinator's normal release remain distinct
from historical attribution and accepted green production.

The independent review passed the frozen diagnostic code. Qualified local
validation passes 169 tests in four backend suites, 42 contracts tests and
affected-file/contracts lint plus contracts build. Five app suites and the
full backend build remain blocked by absent snapshot dependencies; no missing
declarations are stubbed and no gates or pins are changed. Local tooling differs
from the manifest's pinned CI versions. Keep those blocked checks and the
unknown live failing predicate explicit; neither review nor this local evidence
clears publication/release or establishes recovered main.

## Reviewed non-Daily release clearance (14 October 2026)

Dan's direct "yes you may" clears the merge and normal-deployment hold for
independently reviewed, green non-Daily changes, including #846, #845, #842
and #847. Use the existing serial production pipeline and verify the actual
deployment; a published PR, successful coding run or green CI is not a release.
Daily/P12, protected-data, extra live/model/device tests and downstream
acceptance remain separate. Earlier publication-only holds below are historical,
not a request for the same approval again.

Factory recovery #846 reached production on `f545976` through Deploy
`38575246180` at 13:58:22 UTC. Backend and smoke jobs passed; infrastructure,
web and hosted-agent deployment were correctly skipped. Revision `0000313`
is ready. Content-free lifecycle evidence at 14:02:53 UTC shows task 12/#837
in NeedsAttention and task 14/#838 running with an active sandbox. This proves
the stale Running slot was reconciled and ordinary queued work resumed, not
that the original Gmail issue was fixed. No manual task-state/capacity override,
restart, replay or new coordinator-created model turn was used.

## Mobile/Status review publication (14 October 2026)

Dan's "Approved", relayed by the coordinator, authorises commit, push and
a separate review PR for the accepted fourteen-file mobile/Status patch.
This supersedes its earlier local-only publication restriction, not any
merge, deployment, live/device or downstream-work hold.

Keep the eight accepted code/test/CSS files byte-exact. Rebase only additive
documentation onto actual main and retain every original document byte and
generated PLAN cell. Use a separately scoped app publisher rather than the
mixed UI branch. Reuse the qualified clean-main runtime and lint receipts;
publication preparation is not a new implementation or validation loop.
Factory #842 remains separate. Neither publication nor these local fixtures
identify Dan's original production trigger or establish phone/voice acceptance.

## Check the deadline when page application completes (14 October 2026; local)

Review found that route commit and the synchronous page/pane fast return
could acknowledge success after the captured deadline but before the
timeout callback ran. Six final actual-App probes replayed against the
reviewed `759B8BDA` source confirm four late false-success cases; the two
pre-deadline controls pass. Hold only the expiry callback and advance the
clock independently: expiry is tested at the boundary, inside the 250-ms
reserve and after command expiry, without a longer product timeout.

Recheck the captured deadline only when settling success. Reuse the
deadline refusal, preserve cancellation/supersession/disposal and keep
the original deadline and reserve. The router may still commit the late
page; no rollback is promised. This is a locally reproduced completion
edge, not attribution of Dan's original production turn or live acceptance.

## Acknowledge page commands after shell route commit (14 October 2026; local)

Four offline actual-App cases from home/Settings, on desktop and phone,
posted `applied: true` before Status's heading and selected rail entry
existed; two already-on-Status cases passed. Wait for the existing shell's
route commit rather than treating `navigate` dispatch as completion.
Keep the six-second ceiling, command expiry and 250-ms reserve; cancellation,
supersession and unmount dispose the waiter. No extra read, retry, health
probe, timeout expansion or draft/stream replacement is introduced.

Ten new actual-context cases cover first-ack state and held-route lifecycle.
This proves and locally corrects a UI edge, not the cause of Dan's original
turn. The origin/session/target/model decision and acknowledgement sequence
were not captured. Coordinator-reported active-session routing and stale
Status capability wording remain separate backend possibilities, not
attribution or permission to edit another owner's source.

## Keep phone chat joined to the visible viewport (14 October 2026; local)

Use one shell-scoped VisualViewport inset owner for both phone typing
surfaces, not a keyboard-open flag derived from focus. Actual Workspace
regression evidence showed that viewport pan alone did not update the fixed
composer anchor. Insets update before its coalesced measurement, and unchanged
coordinates do not republish shell state. Keep existing normalized geometry,
draft ownership, voice layout and two-pixel seam; never save viewport fitting.
Outside touch dismisses only Message Jarvis without preventing the action.
Controlled browser geometry is not physical-iPhone/iOS acceptance.

## Status first-turn report supersedes the absent-human-turn gate (14 October 2026)

Dan reports that the ordinary Open Status turn claimed completion without
visible navigation, then "I dont see it" recovered. The human turn happened;
first-turn visible acceptance did not pass. This is evidence of the symptom,
not its cause. Trace application/acknowledgement locally in controlled actual
contexts after the mobile handoff; do not substitute another live/model turn.
Earlier unavailable-user notes below remain historical. #798/#797/#792 and
merge/deployment remain held. Frozen Factory publication is coordinator-owned
and isolated; its approval does not authorise mixed mobile/Status publication.
## P9-116 completed-expiry reconciliation (14 October 2026)

Use the existing bounded Factory reconciler for completed `idle_expired`
sessions. It selects the task's actual latest session and latest turn, rechecks
the session/invocation before processing late provider results, and wakes once
from the committed backend expiry event when heartbeat no longer tracks a
session. No recurring idle SQL scan, new service, restart, or replay is added.

Expiry after a confirmed completed turn remains a sandbox lifecycle outcome,
not a crash or task success. Reconciliation reuses GitHub delivery and project
policy: refusal or missing verification keeps the existing reasoned
NeedsAttention path; an awaiting-policy task remains Running and consumes
capacity until the existing policy outcome changes its state. Only that
verified policy path can mark Done. Deterministic dispatcher regressions and
isolated loopback SQL regressions are added; run the SQL suite only with the
disposable loopback service. The original missed-delivery cause and any live
recovery of #837 remain unconfirmed and are not claimed.

Full CI exposed `current` as a reserved SQL Server alias in the new identity
fence. Quote it as `[current]`, retaining the typed result and predicate.
The corrected revision must pass the real isolated SQL suite and full CI;
mocked dispatcher tests did not exercise that SQL parser.
## Repository C# CodeQL uses a traced production build (14 October 2026)

Add C# to the existing advanced CodeQL matrix in manual build mode. Initialize
CodeQL before the SHA-pinned setup action selecting .NET 10.x and Release build of the production
`Jarvis.PcBridge` application; its project reference brings
`Jarvis.PcBridge.Core` into the same traced build. This preserves the existing
CodeQL policy and avoids relying on test-only builds or an untraced prior build.
Only source compiled by the traced production build is in scope; generated
source is covered only when surfaced to that compiler invocation. Local
validation should report both production assemblies. Verify a remote extraction
from the C# database's nonempty relations/source archive and its extracted-file
and code-metric diagnostics, then confirm a successful `/language:csharp` upload.
Associate each result with its PR source head and analyzed merge SHA; neither an
upload nor zero alerts proves complete generated-code coverage or no defects.
## 2026-10-14: P9-113 live PR-title validation

- Validate current same-PR title/body from the API, bound to the event's PR
  number/repository/head, instead of replaying immutable event text. Reuse the
  existing normalizer and first same-repository linked-issue lookup.
- Fail closed on API/schema errors and changes observed by a final metadata
  read. Keep token permissions unchanged and trigger validation on head pushes.
- Do not automatically write normalized titles: GitHub title edits do not
  provide an atomic title/head compare-and-set guard. Fail with the canonical
  suggestion so a stale job cannot overwrite a concurrent edit. This deliberately
  replaces automatic correction, not normalization rules or missing-ID failures.
  The final read cannot atomically fence subsequent GitHub check publication;
  later edits/pushes require their own gate evidence.
- Evidence: the offline test executes the workflow's actual gate entry with an
  old unusable event and a canonical same-head API fixture. It fails against the
  old workflow and passes with live reads. Fixtures also cover invalid current
  metadata, API failures, identity/head mismatch and observable races without
  allowing any title-write request. Live exact-head CI/CodeQL evidence is tracked
  in the PR, separately from local proof.

## P14-43: bound larger Factory board source pages (20 October 2026)

Refs #1127. Raise the GitHub reader's per-response ceiling from 1 MiB to 4 MiB,
enforced against both declared length and streamed bytes. Keep 100 items per
page, 10 pages (1,000 items) per list, eight concurrent GitHub reads and the
25-second source deadline. This accommodates the reproduced 100-item page with
12 KiB synthetic bodies without multiplying requests as smaller pages would.
REST list responses include full bodies; changing API/field selection is a
larger integration change. The limit remains finite: 40 MiB source JSON per
list, at most 30 primary-list requests / 120 MiB source JSON per read, plus
parsing/copy overhead. At most eight response streams consume bytes concurrently
(32 MiB at their ceilings). Dependency lists retain the same finite per-list
bounds and shared limiter. These are source-byte bounds, not a measured RSS cap;
no request, item, timeout, cache or dependency budget is raised.

Pagination headroom was re-checked using GitHub indexed counts at about
11:37–11:38 UTC on 20 October: closed issues updated since
`2026-10-06T11:37:23Z` = 263; closed PRs updated since that cutoff = 424.
Queries used `repo:DanAakesen/jarvis is:issue is:closed updated:>=…` and
`repo:DanAakesen/jarvis is:pr is:closed updated:>=…`. The REST issues endpoint
includes PRs and `since` filters updates, not closure dates, so both counts
matter, including older closures updated within the window. The combined
687 items require seven pages, leaving 313 item slots (31.3% of capacity,
about 46% growth over the observed count) before the unchanged 1,000-item cap.
This indexed snapshot is not an atomic REST/production-App read; indexing lag
and concurrent updates remain limitations. It supports retaining the cap now,
not a guarantee of future headroom. Continue to fail closed with `result_limit`
if a list grows beyond it.

The public board output remains capped at 1 MiB. Contract, columns, UI, repository
validation, duplicate/truncation rejection and stale-cache behavior are unchanged.
Synthetic regressions exercise a >1-MiB page through the actual route, exactly
4 MiB with/without declared length, and rejection/cancellation above 4 MiB even
when length is absent or understated; the declared-length rejection test uses
4 MiB + 1 byte. Existing pagination boundaries remain covered.

The separate `factory.board_task_event_failed` subscriber only resolves the
task's project through `taskStore.get` and publishes an invalidation; it never
calls the GitHub reader. `kind: internal` does not establish its production
cause, and this source-limit change does not claim to fix that warning.
Production acceptance remains pending: an authorized post-deploy read must
return a fresh complete HTTP 200 board and its observation window must have no
new `response_too_large` warnings. Keep #1127 open until observed.

## #813 bound Factory board source reads (13 October 2026)

Use one eight-request limiter for every GitHub source request in a board snapshot,
including the three primary lists, their pagination pages, and dependency lists.
Fetch offset pages concurrently only when page 1 provides a consistent bounded
range; cursor pages, including `page` plus `after` links, remain sequential and
preserve provider order. Validate backward `prev` links and their `before`
cursors, but never follow them. Treat Link URLs as untrusted: validate their
origin, selected endpoint, query, page size, and pagination state, then
reconstruct requests against the configured `/repos/{owner}/{repo}` endpoint
using only the page number or opaque forward cursor. A failed page/dependency
read cancels siblings, including queued requests.

The synthetic offset-page fixture demonstrates reduced request waves for that
provider pagination form, and a separate provider-shaped cursor fixture proves
complete ordered results without requesting the numeric `/repositories/{id}`
Link URL. The authorized closed-issues endpoint was observed to use a next-only
cursor, so its pages remain serial; these tests do not establish a speedup for
that endpoint or the production baseline. Actual latency and cache-hit
attribution remain post-deploy operator checks. The 2026-10-13 baseline of 90
successful requests (median 10.065 s, p95 12.915 s, maximum 19.211 s) included
cache hits and is not a cold-only cohort. This is not a diagnosis of #811's
separate historical 502s.

## #813 Factory board diagnostic follow-up (14 October 2026)

The released latency acceptance for backend `75a3cbe` / Deploy `38507005838`
failed: two completed board reads took 9.661 s and 10.365 s, with no accepted
improvement against the prior mixed-cache median of 10.065 s. One actual rail
entry had 14 client fetch starts, two HTTP 200 completions, and twelve aggregate
abort errors. API/header/rendered placement and the 100-card Done cap reconciled
separately; those checks do not establish a latency improvement.

Add diagnostics only; do not change caching, generations, source concurrency,
retry, client behavior, or the 502 contract. Log bounded monotonic durations at
the existing project, token, source, task, release, and response work
boundaries, correlated by request ID. Concurrent source/task/release durations
are independent wall times and overlap. The summary cache elapsed measurement
covers the actual awaited cache operation: lookup for a hit, wait for a shared
caller, and the complete load for its owner; interpret it with `cachePath`, not
as a separate phase. Phase events indicate that their instrumented boundary
executed; an absent event cannot establish skipped work because telemetry may
be missing, sampled, cropped, or outside the observed window. The summary's
outcome and reply status describe the handler/source-computation decision, not
HTTP completion or client receipt; correlate the separate `request.completed`
server-side `onResponse` observation, which also does not prove client receipt.
Durations over 60 seconds omit the value and set a censored marker instead of
clipping; invalid clock values are marked unavailable. An observed cache path
plus stale state distinguish cache hit, shared wait, source load, and stale
fallback. Keep phase/event fields explicitly
allowlisted and omit content, credentials, URLs, query strings, and arbitrary
errors. At the existing publication boundary, log only bounded
invalidation origin, project/version when known, and webhook request ID when
available; task-event prelookup invalidation has only its `all_projects` scope.

The bounded production window (03:49:30–03:51:10 UTC, healthy revision 312) after
#814 had 546 allowlisted rows, two board HTTP 200 completions at 9.661 s /
10.365 s, 49 webhook HTTP 202, 40 Now HTTP 200, and 62 database-status HTTP 200
responses. Thirteen GET starts were route-unclassified with no completion in
the window; they do not prove receipt of every client fetch start. No selected
request/Factory failure event appeared, which does not establish that client
aborts did not occur. No captured SSE versions, matching invalidation reasons,
or per-attempt abort times were available. The separate app-scoped query
returned zero matching rows. A validated-update/debounce/reload/abort path and
overlapping backend cache generations remain possible mechanisms, not
established historical causes. Browser/backend clock domains are not assumed
synchronized. The diagnostics have not yet been deployed or observed in
production; this follow-up is not evidence that performance is fixed and does
not diagnose #811's historical 502.

## Status reads recorded evidence without running canaries (14 October 2026)

P9-101/#799 uses the existing owner-only `/status` contract and shell
navigation. Show reported status, reasons, check times and safe details,
including visible PC connection/pause state; do not invent overall health.
Foundry configuration is not a live model test, the commit belongs to the
backend image, and last_error is historical.

Manual Refresh never calls `/status/smoke`: that endpoint invokes real models.
Validate the full eleven-entry snapshot and optional shared smoke contract,
bound reading to 30 seconds, cancel on backend replacement/unmount, retain
explicitly previous data on failed refresh and offer Retry. Mark evidence
older than five minutes stale without background probe requests.
The smoke contract has no deployment ID/SHA association; use Recorded smoke
check with its timestamp, not a claim that the latest release passed.
No backend, contract or dependency change. Local synthetic browser
checks are not authenticated production or physical-phone acceptance.

The coordinator accepted the bounded signed-in read-only snapshot on
`1590a1c3`, normal Deploy 38497362534: real Settings-to-Status rail navigation,
HTTP 200 initial read and ordinary Refresh, accepted HTTP 204 `status`/
`page-status` metadata/readback and one persistent session/stream. All 26 rows
rendered; retained smoke was 15/15 OK at 2026-10-14T01:55:08.275Z with stale
labels, not a new probe or a deployment association. Missing PC versions
remained "Not reported"; original Note/native Chrome/drafts/settings were
untouched. [Exact evidence and limits](agent-context.md#read-only-status-page-14-october-2026).
Dan subsequently performed the ordinary Status turn: it claimed success
without visibly navigating, then "I dont see it" recovered correctly.
First-turn live navigation acceptance failed; no cause is established.
This is no longer an absent-human-turn gate. Recovery does not establish
acceptance, and an agent-created turn must not substitute for Dan's evidence.
Broker/voice and physical-phone acceptance remain unproven; #799 remains open
and #798 held, followed separately by #797 and #792.
The original failed smoke turn's cause remains unconfirmed under #820;
diagnostic-only #821 and the subsequent green run are not proof of a repair.

## P9-107 smoke reason retention follow-up (14 October 2026)

The prior Status-page decision above records its original UI-only scope. This
follow-up preserves fixed per-check smoke reasons for down/degraded results.
The allowlist includes shared `agent_error` and `timeout` outcomes for each
chat acceptance check, while rejecting arbitrary provider text and reasons
belonging only to another check.

Local proof on this branch: exact-reader tests cover real missing-agent,
controlled stream failure and timeout results, ordered complete report shape,
contract validation, privacy, and timeout aborts. Backend and contracts checks
are run for the current head; full exact-head CI and CodeQL status must be
confirmed on the corrected commit. The original deployed failure cause remains
unknown, and no production recovery is claimed.

The coordinator authorised the smallest coupled release-gate correction in
#815 after the title bot truncated P9-101 to P9-10. Normalization, linked-issue
extraction and PLAN row/issue/dependency parsing preserve full task numbers
with at least two digits and an ID boundary. Retain two-digit formatting,
WIP/bracket/fix-main/docs behavior and all existing status/ownership policies;
the separate reopened-issue policy is addressed by #817. Existing
Python CI discovers the title and PLAN regressions; no other workflow change
or new tooling. The correct title was restored after pushing the fix and
exact-head gates passed before #815 merged.
Cap each dependency-range expansion at 1000 tasks and fail with an actionable
ValueError before iteration. This replaces the old incidental two-digit
resource bound without capping valid ID width; no established script bound
was present. Boundary/over-limit and intercepted huge-range tests cover it.

## Reopened issue completion precedence (#817, 14 October 2026)

For PLAN reconciliation, a merged linked PR does not complete an open or
reopened issue. The open issue is In progress when it has an open linked PR or
recognized worker label; otherwise it is Not started. Preserve a manual
Blocked status unless the issue is closed as completed. Existing unmerged
not-planned and missing-issue fallbacks remain unchanged. This corrects PLAN
reporting only: merge proves code integration, not satisfaction of live
acceptance gates, so open acceptance issues remain open and their status cells
stay workflow-owned.

## P12-05 inactive SQL health processing (13 October 2026)

**14 October release authority:** in DailyMigrationMain, Dan approved releasing inactive PR #818 after updating to latest main and passing required checks and review. He also directed that routine CI/CD should flow without repeated release approvals. Already-authorized inactive P12 scopes and corrections may therefore proceed through independent review/merge and normal main-only deployment without a fresh human clearance per PR. Keep exact-head checks, latest-main containment, branch protections, no own merge and issue/dependency truthfulness. Both cloud workers remain idle; this grants no new worker/scope, activation, source/private-data/credential access, paid resource or device change. Existing protected-backup, parity, final-delta and rollback/cutover gates are unchanged.

14 October follow-up to [automatic review finding 4265321733](https://github.com/DanAakesen/jarvis/pull/808#discussion_r4265321733): #808 merged with a reproduced body-fat unit fallthrough. Move its existing `%`/`percent`/`fraction`/`1` representations into the shared strict known-dimension mapping, preserving absent-unit unknowns, zero/missing values and generic unknown dimensions. Add synthetic normalization and SQL canonical-readback/quarantine regressions; no schema, composition, source/data/device or activation changes. This is a separate #720 follow-up from fresh main, not a rewrite of merged #808; exact-head CI and independent review remain required.

[PR #818 review 4271913189](https://github.com/DanAakesen/jarvis/pull/818#discussion_r4271913189) found non-string declarations disappearing through text fallback. Validate raw body-fat group/sample/workout `units` and `unit` before sanitization or alias selection, including empty groups and shadowed units. Numeric `1` is malformed, not the string unit `1`; null/undefined/blank remain missing. Synthetic normalization and atomic SQL quarantine regressions cover the correction; fresh exact-head CI/review still gate release. Other metric dimensions and runtime/activation boundaries are unchanged.

The [local coordinator release for #720](https://github.com/DanAakesen/jarvis/issues/720#issuecomment-6154043444) follows #805's independently reviewed, CI-tested and deployed inactive SQL acceptance. Reuse that inbox/pool/owner lock. A committed claim generation bounds retries; normalization occurs outside the transaction, then domain rows, ingestion lineage, applicable feed freshness and processed receipt commit together. Heartbeat is a separate signal. Retain raw evidence and quarantine rather than deleting poison inputs or retrying forever. No timer, dispatcher, production registration or credential change.

Pure original Site code at `9e193554c9c8c7c23a788ed3d2b0582580b76c0f` establishes shapes, not private-data parity. Preserve distinct workout IDs/detail/minute HR, exclude nutrition feedback and spatial derived details, and correct missing-number-to-zero and array-order assumptions with explicit unknowns and timestamp ordering. Copenhagen days and supported physical-unit conversions are explicit; ambiguous units, malformed timestamps and oversized identities quarantine without truncation. Accept-time ordering prevents stale retries from overwriting newer arrivals but does not prove source-event ordering. [Bounds, reads and live gates](../apps/backend/src/daily/health/README.md).

[PR #808 review](https://github.com/DanAakesen/jarvis/pull/808#issuecomment-6157206506) exposed a synthetic unit defect: summary quantities bypassed conversion and accepted `Hz` as unitless BPM. The correction uses the strict BPM alias mapping for summaries and known rate series, rejects unsupported declared units before writes, and validates fallback units too. Only the source code's existing summary slots retain implicit BPM; absent series units stay unknown and heart-rate variability keeps its separate dimension. Native synthetic checks and isolated SQL readback/quarantine regression cases cover this boundary; exact-head CI and independent review still gate release. No new units, source mutation or live acceptance are inferred.

## Factory issue-number navigation uses the page snapshot (13 October 2026)

The user added issue-number navigation acceptance after #793's board release
merged as #806. Resolve the requested issue against the selected project's
existing validated board, clear local filters, unfold the column and reveal
the real card before acknowledgement. Do not copy GitHub placement rules,
fetch a second board in the shell, invent a task, or treat route-only navigation
as success. Keep task-ID anchors and the Notes draft guard.

Bound waiting to six seconds and the broker-provided expiry, with cancellation
and explicit refusal reasons. Keep the Now stream mounted in the shell and
portal its visible panel into Settings: the backend declines a pending command
when its workspace disconnects, so remounting the stream during navigation
would invalidate a truthful asynchronous acknowledgement. No backend,
contract, dependency or workflow change is needed for this navigation path.
Review follow-up in #810: bind queued commands and their acknowledgements to
the epoch/session that received them, rather than replaying an old queue after
reconnect. Publish the contract's existing Factory issue selector from actual
visible card focus, clearing it on other focus, card removal/collapse or route
changes. This avoids a sticky app-level selection and conflicting stale
foreground-window selectors.

Released as #810 at `b4915164`, Deploy 38479582927. Authenticated production
chat navigation received an applied HTTP 204 ack and HTTP 204 state selecting
#792, with its real title focused in Ready and no stale window selector.
Settings-to-Factory retained one session/stream. Collapse and route changes
cleared the current issue selector with accepted state updates. Pure
focus-away-only clearing remains fixture-only: the background production
canvas changes activeElement without emitting native focus events.
The coordinator independently corroborated the broker/state and board reads.
Positive board placement/recovery evidence does not diagnose the earlier 502.

## #811 backend board failure attribution (13 October 2026)

Preserve board authentication, canonical columns, `.sssZ` timestamps and
existing budgets. Correct the reproduced loss of diagnostic cause in both
cache rejection paths and silent stale-refresh failure; export only bounded,
allowlisted stage/reason/status/stale fields through the existing logging
boundary. Validate a complete shared board before caching it. Token lifetime
and permission validation stay unchanged; their failures become distinguishable.

The existing deployment principal is restricted to `/status/smoke`, so do not
grant it board access for a new acceptance check. #811's complete production
board and #790/#792/#793 rendered-placement gates require an authorized
post-deploy readback, coordinated with #810. The short production failures and
successful CLI reader are not evidence of a particular App/SQL/source defect.
Production cause and sustained recovery remain unverified; see the operations runbook.
This backend-only addition leaves #810's UI decisions and documents unchanged.

## P9-99 chat latency attribution and session affinity (13 October 2026)

Issue #794 reports 45 production turns with median first token 14.4 s and nine
agent measurements with median `model_first_delta` 4.0 s; six of eleven session
starts were cold. These unequal cohorts do not establish a same-turn 10.4 s
pre-model delay. Code inspection also shows that `model_first_delta` starts at
the text-emitting model round, excluding earlier tool-only rounds and tool work.

Keep fresh settings/history/context, the existing 60-second catalogue cache,
the 3600-second idle timeout and all saved model/reasoning choices. Add bounded,
content-free elapsed preparation/model/first-text timings and a backend-computed
dispatch/transport residual to the existing completion contract and log allowlist.
Correct affinity to random 32-hex IDs held in a 256-entry owner/conversation LRU,
as requested in [#708's correction](https://github.com/DanAakesen/jarvis/issues/708#issuecomment-6119205761)
and already used by voice. This supersedes the UUIDv5 and generic 4xx fallback
choice in the historical P9-84 entry below. Without a verified pre-execution
routing error code, fail visibly rather than replaying a possibly executed turn.
No scheduled warming, new infrastructure, tool, dependency or migration.

The affinity mismatch is confirmed; its contribution to production cold starts
is not. Offline regressions validate the timing decomposition, bounded reuse,
no replay, both providers and tool-first turns. Coordinator acceptance remains:
deploy, query at least ten turns, median first token below 5 s and warm turns
below 3 s, with no `conversation.reply_failed`, tool-calling or canary regression.
The product's ≤2.5 s target remains; no measured improvement is claimed here.

### Follow-up after #802 live acceptance

The coordinator's 13 October sample attributes the remaining delay as follows.
These are reported production observations, not independently queried here.
Medians from different cohorts must not be added. The coordinator's 14 October
content-free correlation refresh identifies original baseline turn 1 as cold
and turns 2–10 as warm, with affinity on 10/10 and no fallback. Ten unique
sequential event/span associations and eight exact captured model timings
support this evidence; classification is not inferred from elapsed time.

| Observation | Duration | Interpretation |
| --- | --- | --- |
| First post-release turn, backend first text | 13.968 s | Session residual 6.289 s + agent preparation 0.492 s + model-to-first-text 7.128 s; remaining 0.059 s is outside those reported phases |
| Ten sequential turns, backend first-text median | 3.646 s | Overall <5 s gate met in this sample; no reply failures reported |
| First of those ten, backend first text / session residual | 10.978 s / 6.538 s | Correlated turn 1 is cold; residual alone is not proof |
| Warm nine, backend / UI first-text median | 3.370 s / 3.467 s | Only 3/9 below 3 s: warm gate FAIL |
| Subsequent nine, model-to-first-text median | 2.790 s | Dominant remaining measured interval; prompt processing versus reasoning is not separately exposed |
| Warm nine, session residual range | 0.089–0.346 s | Turns 2–10 are warm by correlated telemetry, not duration |

Code inspection finds a new `httpx.AsyncClient` for every steering GET and
phase POST, including the two steering reads bracketing each model transition.
Reuse one client **within a single verified invocation**, across model/tool
rounds and the final steering check. Keep every request sequential: parallelizing
or removing either guard would change steering race handling. Keep delegated
authorization on each request, the configured timeout, disabled redirects,
cursor validation and visible failures. An async exit stack closes the model
generator before its coordination client on completion, failure or cancellation.
No client, cookies, authorization or history is shared between invocations.

Controlled offline measurements (30 alternating samples per variant, actual
invocation handler, HTTP/1.1 loopback backend, three guard requests, no model or
Azure calls) reduced TCP connections per turn from three to one and median
connected-to-first-text from 53.48 ms to 16.77 ms. Separate default-client
construction/close measurements were 34.25 ms for three versus 11.40 ms for one.
These demonstrate a bounded local saving, not production TLS/network cost or a
sub-three-second guarantee. Preserve model/reasoning, providers, auth, prompts
and real first-text timing. No package, resource, scheduler or live canary change.
Refs DanAakesen/jarvis#794: coordinator post-deploy acceptance and broader #801
acceptance remain open. No resume or post-fix improvement is established. The
release/UI temporary snapshot hold is settled, but release is distinct from the
failed baseline warm-speed gate and pending real post-deploy acceptance.

## P12-04 reuses the existing backend and SQL (13 October 2026)

Dan asked, "I want data to be in the same sql as we have on jarvis. I dont see why we need infra for this?" ([coordinator record on #719](https://github.com/DanAakesen/jarvis/issues/719)). In DailyMigrationMain he directly confirmed "Yes—use the existing backend and SQL" after being told that SQL outage returns 503 for the phone to retry. This supersedes the dedicated-host/Blob/Queue design and its outstanding resource, idle-recovery and budget questions. It is not approval for production activation, new grants or secret delivery.

The inactive route factory reuses the existing pool and owner. Migration 0046 adds a raw inbox and hashed capability records; 202 follows the SQL commit, exact retries reuse receipts, changed payloads conflict, and rotation is atomic within SQL. #720 owns processing. Raw JSON remains bounded to 8 MiB and retained without automatic deletion within a 256-MiB owner ceiling; future compaction requires verified processing and protected retention/rollback approval. Phone retry, ingress, live capacity and private/device gates remain unverified.

Dan also explicitly moved Jarvis migration implementation into the existing local DailyMigrationMain session. Both cloud workers stay idle. Use a current-main isolated Jarvis branch/worktree, preserve concurrent work and normal review/check/release gates; this exception does not authorize Daily source/data edits or transfer Cloud credentials locally. [Local claim and direct approval](https://github.com/DanAakesen/jarvis/issues/719#issuecomment-6152431889).

## Danish voice is Jeppe (13 October 2026)

Dan chose the native male Danish voice Jeppe (`da-DK-JeppeNeural`). It is already the live Danish voice: since P5-08 (6 October) `/voice/da` uses the same backend-owned Voice Live realtime session as English, with `DANISH_REALTIME_VOICE = 'da-DK-JeppeNeural'` (`apps/backend/src/voice/realtime.ts`, asserted in `relay.test.ts`). The provisioned hosted-agent bridge (`jarvis-voice-mai`, Harper) is used only when Voice Live is not configured, so it was left unchanged. #396 was filed from stale documentation (see L134).

P9-97/#790 aligns the Settings default and sole option with Jeppe, and shows
it read-only with an explanation rather than pretending the unused preference
switches the live voice. Retired Harper storage falls back to Jeppe on read
without a migration; old API payloads remain loadable by the web page, and
saving an editable preference does not emit a Danish-voice patch.

## Remaining UI release approval (13 October 2026)

Dan's "Deploy everything. so i can test live." authorises the remaining
chat/composer, Notes/graph and report refinements in one release. Earlier
local-only holds and the camera/loading/window split no longer gate these
drafts; those three releases are already deployed. Preserve the agreed plain
border resizing, following composer, graph-first immediate note draft and
one-surface report design. No backend support or dependency change is needed.

The current candidate passes types, zero-warning scoped lint/build, 368
affected tests and desktop/phone Chromium fixture workflows, including
desktop WebGL graph continuity. An unchanged local locale assertion remains
excluded without source changes. CI and the merge's deployment are still
release gates; fixtures are not real-device, live voice or vault-write proof.

## Daily reuses Jarvis's single Google grant (13 October 2026)

Dan confirmed that Daily uses the same Google access as Jarvis, because it is the same site and one grant. There is no second login. Listing all calendars needs one extra read-only scope on that grant, `calendar.calendarlist.readonly` (L125: `calendar.events` cannot list calendars). `infra/setup-google.ps1` and the setup docs now request it. Nothing changes live until Dan reruns the script once and clicks Allow in the browser, which also replaces the Key Vault refresh token. #725 stays open for that consent and the remaining acceptance gates.

## P12-02 backup route chosen: paged double read (13 October 2026)

Dan chose to stop waiting for a provider export route and approved a paged-read backup of the Daily D1 data (25-row pages, every table read to exhaustion twice, per-table counts and checksums compared between passes). He lifted, for P12-02 only, the earlier rule that real records must not pass through a Codex sandbox. The backup is labelled a paged-read backup, not a provider-signed snapshot, and R2 coverage is reported as far as the tools allow. Unchanged limits: the repository is public, so no row content, personal data or credentials enter Git, PRs, issues or CI logs; the data goes only to private encrypted storage owned by Dan; original Daily stays running and its source and schema are untouched. The OpenAI support request stays available as a parallel fallback. The #717 release comment holds the acceptance standard.

## P12-04 offline proposal Queue sender mapping (13 October 2026)

The coordinator's narrow #719 release corrects the unreferenced proposal's Queue sender DataAction to Microsoft's documented `Microsoft.Storage/storageAccounts/queueServices/queues/messages/add/action` ([official sender role](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/storage#storage-queue-data-message-sender)). Keep empty management actions and the existing queue-only assignment scope; add no consumption, update/delete, Blob delete or capability write. An offline source contract locks exact permission/scope sets and default-off/unreferenced/max-one behavior, alongside separate Bicep build/lint. Neither compiler nor Shared-Key emulator proves Azure RBAC; live identity propagation, resource/cost approval, operator access/secret custody, activation and device/private migration acceptance remain unverified. No role is granted or deployment wiring changed.
## P9-96 backend connection draining (13 October 2026)

Drain long-lived connections in Fastify `preClose`, after stopping the HTTP
listener and before `onClose` cleanup. Local SIGTERM reproduction with an open
Now SSE and WebSocket confirmed that the SSE kept HTTP shutdown waiting:
the previous implementation timed out at 5,005 ms, never reached `onClose`,
and exited 1. With explicit SSE EOF/reconnect and WebSocket 1012 close frames,
the same run reached cleanup and exited 0 in 6 ms. Preserve ordinary in-flight
requests and the existing telemetry-warning/server-failure distinction.
Do not replay cancelled chat turns automatically: they may have performed
side effects. Existing task/Now/voice clients reconnect without changes;
ACS phone media follows existing call teardown, not browser reconnection.
Injected real close failure and timeout still exit 1 with named error events.
Production log acceptance remains the coordinator's post-deploy check.

The same two-revision scripted run reproduces the WebSocket plugin warning by
pipelining a health request and upgrade on the new revision. Register it as
`connection.upgrade_failed`, retain warning severity for the real protocol
failure, and export only the safe error kind. Rejected/pending upgrades are not
WebSocketServer clients and need separate socket cleanup; without it the new
revision also waits until the shutdown deadline. With cleanup it exits 0 in
2 ms. This identifies a local producer of the unnamed warning, not a confirmed
match to the production incident.

Settle every connection drain and retain failures for a final `onClose` rejection:
Fastify otherwise discards `preClose` errors. Close voice transports before
awaiting persistence, and start idempotent ACS hang-up/session finalization in
the early drain rather than waiting for unrelated HTTP/WebSocket completion.
Focused tests cover resource disposal despite a drain rejection, failed voice
persistence, and phone hang-up/persistence before `onClose`.
Phone answering publishes the known connection ID before SQL activation;
answers arriving after teardown starts are hung up, and a session created while
stopping is finished/rejected without answering. Race tests hold answer and
activation across shutdown and verify one finalization.

## P12-04 protected capability lifecycle preparation (13 October 2026)

[Release 6138056083](https://github.com/DanAakesen/jarvis/issues/719#issuecomment-6138056083) authorizes an inactive injected-client library and synthetic/Azurite evidence after merged #772, not production credential issuance. Use 256-bit standard cryptographic randomness and the existing v1 owner/device/scope/expiry/revocation contract. Retain the same prepared secret operation across conditional-create retries; refuse unrelated or malformed records. ETag revocation never writes an active record. A conditional private rotation reservation selects one replacement; revoke the old credential before issuing that replacement, preferring a truthful availability gap over overlapping automatic credentials. SDK/response/cancellation ambiguity requires exact-operation retry and protected reconciliation, not a distributed atomicity claim. Prepared handles redact JSON/inspection; no bearer or body enters diagnostics. Separate operator write access, durable secret storage/delivery and recovery after handle loss remain explicit approvals; upload identity/read-only verifier, human auth, resources/composition and source stay unchanged.

## P12-04 dedicated host and recovery preparation (13 October 2026)

[Coordinator release 6136243434](https://github.com/DanAakesen/jarvis/issues/719#issuecomment-6136243434) continues #719 after merged inactive #761. Prepare a separate default-off host with named managed identity, bounded serial recovery and durable owner-local lease/cursor; keep existing Jarvis startup/human auth and #720 processing untouched. The cursor must survive repeated bounded invocations to avoid first-page starvation; at-least-once pointers remain explicit. A process timer does not wake scale-to-zero: minimum-instance or external job invocation reliability/cost needs separate approval. Put the self-contained Bicep/runbook under `docs/daily-health-ingestion/`, never watched `infra/`, and do not alter the planner/workflows. Resource/role definitions are proposed, not executed grants; no price or suggested spending ceiling is approved. Synthetic SDK/host/crash/lease tests and offline Bicep compilation are separate from private Azure/identity/device/activation acceptance.

Coordinator's CodeQL alert 19 review identifies a real sequential-cost gap in the original concurrency/body-only guard. Use maintained request-rate protection before credential/storage calls, with independent bounded client/instance stores and explicit narrow proxy trust. Per-process limits do not prove deployment-wide or edge protection. The necessary exact plugin dependency keeps normal lockfile deployment consequences; no suppression, planner bypass or new shared-rate resource is authorized.

## P12-04 inactive durable upload boundary (13 October 2026)

The [coordinator release](https://github.com/DanAakesen/jarvis/issues/719#issuecomment-6135270257) authorizes only dedicated upload/heartbeat, revocable owner/device capability and private Blob/pointer Queue code. A conditional Blob manifest is the acceptance outbox so Queue/SQL/agent outage cannot discard acknowledged uploads. Queue pointers do not expire and may repeat; no exactly-once processing claim follows from HTTP 202. Raw bytes retain source format/units/timezone, including empty workouts. A separate unregistered factory preserves existing human authentication and default-off composition. Synthetic SDK/Azurite and killed-process tests are distinct from Azure/iPhone verification. Provisioning, identities/roles/secrets, activation, private source migration and #720 processing remain gated; original Daily stays canonical and untouched by migration tooling.

## P12-10 reviewed inactive implementation (12 October 2026)

Correction review hold: the ready-triggered canonical node-budget finding supersedes release readiness for the affected serialization boundary. Convert all source serialization guard failures into sanitized independent errors; compose the fixed two-source run from individually guarded canonical trees instead of imposing nutrition's smaller single-tree aggregate budget. Preserve prior canonical bytes/checksums and leave shared nutrition guards unchanged. Require focused, real isolated SQL and full exact-head CI plus independent correction review; no activation or live acceptance follows from the earlier intermediate code review.

Verified pure consumer semantics at original HEAD 9e193554c9c8c7c23a788ed3d2b0582580b76c0f and public producer files pinned at cc526f9d9bf158a70b17e4f7668b7d72f083852a remove the missing-source-rule blocker. Implement exact seven-state selectors/Danish holidays, producer versus consumer identity distinction, raw-number grouping versus punctuation keys, terminal Received and incoming-only revival; preserve imported keys. Reuse mapped owner-bound snapshot/suppression tables with per-owner transactions, retained-success freshness and independent errors. Only trusted explicit intent can dismiss/clear; mail has no action authority. Coordinator subsequently verified the existing configured Foundry chat-completions/managed-identity boundary: reuse its endpoint validation, canonical chat model/settings/catalogue and usage accounting in an inactive tool-free semantic factory. json_object is not strict provider-schema proof; validate exact fields/source timestamps locally and fail closed. No browser typing/image/runner relay, source credentials or guessed semantic fallback. Stage bounded Gmail work with account/history/model generation checks; process loss/change/cancellation cannot establish completeness. Independently enforce item/UTF-8 source budgets before combined ingestion so oversized calendar results cannot discard healthy Gmail. No new schema/resource/model/consent, original-source change, schedules, catalogue registration or activation. Coordinator accepted 895b7c3/full CI 38310725882 for an inactive intermediate release, with final documentation/exact-head CI before PR readiness. Refs #725 keeps the issue and native dependencies open. Manual CalendarList owner consent, deployed identity/model and Google/provider parity, source-compatible Daily ingestion and physical-device acceptance remain unverified; no activation, permission or resource change is authorized.

The first checkpoint reused server owner/Google client for inactive calendar reads with explicit denied/partial/stale coverage. Current consent documents calendar.events and L125 records calendarList denial. Coordinator verified primary CalendarList:list fields/tokens and maxResults up to 250; calendar.calendarlist.readonly is the least-privilege additional scope. Owner consent stays a separate manual gate; no scope/credential changes or sandbox tokens. Only complete synthetic-tested snapshots enter the owner/range cache. The expanded services above resolve source-rule evidence while full model/live acceptance stays open.

## Workspace handlers and confirmed pins (12 October 2026)

Ship #430 whole after chat-only #751, as directed by Dan through the coordinator.
Keep the agreed smart-fit/region/manual model, independent stacking order and
first-named-window-frontmost cascade. Phones focus instead of applying desktop
geometry. Preserve merged camera preview ownership and chat loading.

Pin/unpin acknowledgements wait for storage; competing requests do not invent
success. Pending controls are disabled, stale reads cannot resurrect later
unpins, and updates persist the newest view before their save is acknowledged.
Close keeps saved pins; only Unpin removes them. Restore safely as tabs.
Bound transient GET recovery and expose sign-in errors rather than replacing
them with generic storage failures. The original idle error's transport/auth
cause is still unproven. Eight scoped suites (237 passes), types, scoped lint,
build and desktop/phone synthetic workflows pass; live voice/device acceptance
remains after #621. Earlier local-only/pending-check statements are superseded.

## Chat loading and release split (12 October 2026)

Dan requested a visible chat window before messages finish loading, rather than
an empty stage followed by a window appearing later. Keep one shell-hosted frame for
loading, empty history, first-load Retry and ready messages; preserve existing
messages during refresh. Loading placeholders belong inside the transcript.
This supersedes earlier hidden initial-history loading descriptions.

The coordinator confirmed the release split after camera #750 merged:
chat-only correction first; all saved-pin infrastructure and its bounded
idle/HMR recovery with #430 next. The pin failure exists in the local #430
draft, not on main, so adding pin infrastructure to PR2 would expand its scope.
The isolated chat candidate passes types, scoped lint/build, 122 relevant tests
and desktop/phone synthetic workflows. One unchanged Windows-locale test is
excluded locally; CI remains the release gate. Live outage causes are unproven.

## Camera UI release (12 October 2026)

Dan authorised shipping #695 at 21:20, relayed by the coordinator, after accepting
the camera conversation and live chat image input. This supersedes earlier
release/activation holds below. Enable deployed #713 upload-only camera handles;
do not require or invent a caption, and never cache/replay a frame-only result.
Legacy caption-first inspection remains compatible. Camera preview, direction,
composer clearance and ten-minute user-idle shutdown ship without #430, Notes,
report appearance or movable-chat drafts. Local scoped types/lint/build and
synthetic desktop/phone chat/EN/DA workflows pass; live voice and physical-phone
acceptance remain unverified. The coordinator merges this scoped PR on green CI.


Confirmed choices, their rationale, evidence, and status. Requirements live in [PRODUCT.md](../PRODUCT.md); the resulting system in [architecture.md](architecture.md). Keep decision (#) and learning (L#) numbers stable; add new ones at the end.

## Decision areas

The nine design areas and where each stands. **Confirmed** = Dan's requirement or choice; **Proven** = shown in a prototype; **Decided** = chosen design, not built; **Open** = still to resolve.
| # | Topic | Current position / remaining work |
| --- | --- | --- |
| **1** | Driving experience | **Confirmed:** open browser is sufficient; English voice Ryan HD (British butler), Danish voice Harper, toggled in the UI. **Proven:** browser client protocol tests cover warm-up, interruption, and reconnect, and the Danish voice prototype demonstrated interruption (see [voice](architecture.md#voice)). **Decided:** browser Voice Live traffic uses an authenticated backend WebSocket relay. **Open:** real browser audio-device and live Voice Live interoperability. |
| **2** | Autonomy | **Confirmed:** configurable per project. Merge requirements, overrides, and Done are Dan's policy choices, set per project; not a blocker. |
| **3** | Execution ownership | **Confirmed:** the Azure SQL task record is the source of truth; sandboxes are disposable and report events to the backend; a sandbox restart mid-turn moves the task to Needs attention. **Decided (option A):** the task table is the queue. A backend dispatcher picks Ready rows within the concurrency limit and owns retries (attempt count and next-attempt time, then Needs attention). Live updates: the runner pushes sandbox events, GitHub sends webhooks, the backend pushes to the board with SSE. **Decided (keep-awake):** the backend runs with a minimum of 1 replica (always on, ≈ 30 DKK/month at the idle rate), so the sandbox heartbeat never stops; the board has a sleep switch that sets the minimum to 0 (scale to zero, wakes on the next request) and is refused while tasks run. Idle dispatcher and archive timers skip SQL; stale-task reconciliation performs one startup scan and resumes every five minutes only while a sandbox is tracked. Daily Codex renewal and request-driven accesses can still touch SQL while idle. |
| **4** | Task controls | **Confirmed and proven:** steer and pause stop the turn with ACP cancel; resume reloads the conversation after an idle shutdown. **Not** after a crash: recovery restarts from the task branch (L22). **Open:** provider switching. |
| **5** | Parallel changes | **Confirmed:** one sandbox and branch per task isolates work (proven with parallel runs). **Open:** conflicts between PRs in one repository. |
| **6** | Memory | **Confirmed (6 October 2026):** Dan's private GitHub vault is the source of truth for durable knowledge; Jarvis automatically saves clearly stated preferences, people, projects, decisions and unfinished tasks there and searches it on request. SQL stores only a derived searchable index/cache; Foundry embeddings and lexical fallback support retrieval. Never save secrets or credentials; save banking or health details only when Dan explicitly says “remember”. Conversation source records remain separate from the vault. |
| **7** | Cost | **Confirmed:** minimum cost; cold starts acceptable. **Measured:** about 0.89 DKK per sandbox-hour plus about 33 DKK per month fixed. **Estimated:** voice ≈4 DKK per 30-minute day (billed meters to confirm). |
| **8** | Subscriptions | **Confirmed:** Codex uses a Jarvis-only ChatGPT Pro login, with no API key; coding tasks and image generation share its allowance. The Copilot seat may be used for Jarvis. **Proven:** both subscriptions in the sandbox, including parallel Codex, and Codex login renewal. **Implemented offline:** daily Codex renewal is serialized against task starts; a Codex usage-limit failure is reported clearly, and the P6-05 CI load test shows that this releases dispatch capacity. Live Key Vault renewal, real Codex limits, and image-generation availability remain to verify. |
| **9** | Build and release | **Confirmed:** full builds, tests, releases, and deployments run in GitHub Actions; the sandbox runs targeted builds and tests only. The board shows a task view and a release view fed by GitHub webhooks. **Measured:** disk (6 GiB writable), not CPU or memory, limits builds in the sandbox; full-solution builds belong in GitHub Actions (L23). **Researched 3 October 2026:** Microsoft documents a per-session disk budget of *up to* 20 GiB at 1 vCPU or more (less below), about 20 % reserved for the system, the rest shared by the image, `$HOME`, and other writable paths; there is no setting to choose or raise it. The prototype got 6.0 GiB at both 1×2 and 2×4. Plan for 6 GiB; the runner reports disk per session (P6-07); Container Apps Jobs stays the fallback for a project whose builds don't fit. |

## Decision log

12 October 2026, standing Daily migration direction (historical): Dan authorized completion of approved migration work through coordinator dependency/gate releases without generic re-confirmation. At that time #717 remained protected-export blocked; the owner withdrew the database-export/import approach on 18 October and #1005 is now the source-contract-first direction. No independent downstream dispatch or own-PR merge. All migrated React/rich UI must fully reuse current Jarvis layout/styling, DESIGN.md, canonical styles.css tokens, shared components, themes/density/motion and phone/workspace patterns. Legacy Daily capabilities/data survive through recomposition, not a separate navy/plum/card theme. Generated views receive safe existing-bridge theme context without expanded permissions. Browser/mobile visual acceptance is mandatory in #730/#731/#732/#726; #718 starts no frontend work.

18 October 2026, P12-29 / #1005: keep the complete source documentation, API, Azure SQL mapping and selected Jarvis capabilities in one issue and PR. The upload routes, owner-created credential and bounded SQL processor reuse the existing backend, pool, authentication and confirmation boundaries. The runtime flag defaults off and infrastructure explicitly sets it true; deployment, credential issuance, private handoff and phone acceptance remain unverified. The old #717/#721 export/import route is withdrawn. Preserve complete metric/date groups and published size limits in historical upload guidance; the source contract does not prove exporter UI behavior or complete-history delivery. Synthetic tests are not live evidence. The nine requested tool names remain grouped into three registry tools; #1204 supersedes the former catalogue-headroom rationale, while the name-level mismatch remains unresolved.

P12-03 (#718, 12 October 2026): additive empty tables use separate SQL schema `daily`, configured server owner prefixes legacy keys/uniqueness, and only the supplied explicit relationships become owner-composite foreign keys. Existing auth resolves the user/hosted agent; runners cannot construct the inactive store. Nullable unknown values, original/sanitized raw checksums, source timestamps/local dates, revisions/tombstones and recovery measurements remain distinct. Legacy OAuth/widget/claim credentials have no active target. Mixed attention data requires explicit source/JSON exclusion in any future source-compatible ingestion. [Mapping and compatibility limits](daily-schema-mapping.md) remain source-code/schema evidence, not a database export or proof of replay. The 18 October source-contract-first API/schema and historical-ingestion direction is tracked in #1005; the #717/#721 export/import approach is withdrawn. No personal seed, source mutation or Daily activation.

P9-89 (#736, 12 October 2026, user-directed): make presence behavior salient
on every chat and EN/DA voice turn, not merely when asked. Share short,
first-person built-ins in `agents/jarvis/presence-instructions.json`: On the move
is voice-first and hands-free, Away queues screen-dependent work, and Present
allows richer answers and summaries on return. Fetch needed content with tools
or identify missing permissions; never insist on manual sharing. Keep custom
style text alongside fixed mode rules; empty stored values resolve to built-ins
without rewriting saved settings. Refresh presence during hosted turns and after
successful mode tools while retaining session model/reasoning choices. Realtime
updates and response overrides carry the current mode. Single-word confirmations
never bypass exact sensitive-action approval phrases. Offline regressions,
backend lint/build, Python Ruff and the unchanged instruction budget pass.
Live model/voice acceptance remains pending; no web, schema or migration change
(L120/L121).

P9-87 (#714, 12 October 2026, user-directed): classify visual observations in
prompt builders using the build-time clock and turn/question correlation.
Fresh observations answer directly without volunteered capture times; reused or
older observations are labelled as earlier with an ordinary-language age, and
missing frames/descriptions are reported plainly with an offer to look again.
When asked, provenance and `visualPath` determine truthful answers about capture
time and image-versus-description delivery; never claim continuous video.
Preserve stored provenance, logs and untrusted-data quoting; do not rewrite
generated text or change the UI. Keep shared capability guidance within
`agents/jarvis/limits.json`. No migration or schema change (L120/L121).

P9-88 (#735, 12 October 2026, user-directed): expose the GitHub App's live,
installation-specific permissions and let Jarvis use the corresponding backend
tools across repositories where the App is installed. Read permission grants
from GitHub and cache them briefly; do not treat the manifest or a saved list
as current authorization. Ordinary writes run when Dan asks; closing issues,
merging pull requests, public-repository publication and default-branch file
writes require a later simple approval word, never a generated phrase. Secret
scan outgoing text, bound provider responses and label returned content
untrusted. No web, schema, migration or dependency change. The implementation
and focused tests are offline evidence; coordinator live permission/issue-read
acceptance remains pending.

P9-88 redo (12 October 2026, user-directed): the first design (#737) registered about
25 GitHub tools, pushed the catalogue past the then-enforced application count
limit and broke every chat turn (reverted in #744). The contemporaneous claim
that 128 was a hosted-agent/provider maximum is unverified and superseded by
#1204. GitHub capability is now three tools:
`github_capabilities`, `github_read` and `github_write`, each of the latter with an
`operation` enum, a plain root object schema and per-operation validation in the
handler. A test fails when `githubAppTools` has more than three tools; no limit in
`agents/jarvis/limits.json` was raised.

P9-85 (#710, 12 October 2026, Dan-directed): remove the sequential caption call
from camera turns. `POST /screen/frames` accepts additive `mode: "handle"` and
returns `frameId`, receipt-time `capturedAt`, `question` (echo or null) and optional
`turnId`, without a description. Chat `visualContext` and camera-on
`jarvis.screen.context` accept a handle without a description; legacy clients
keep caption-first behavior. Do not change the selected chat model, low reasoning
effort, hosted-session affinity or the unverified image-budget hold.

Keep a single-use image resolution plus one same-message caption fallback within
the original 60-second private frame lifetime. Only real image delivery failure
may invoke the vision model; missing/expired frames or failed captions require
explicit no-image guidance, never a made-up caption. Preserve owner/session/turn
binding, frame pacing/caps, budget accounting, the voice one-response hold and
content-free `visual.path` events, adding `captionMs` for fallback work. Image-only
history records are not cached visual evidence. Release image holds only for
confirmed pre-inference refusal; retain them for unknown failures, timeout or
cancellation. Upload-only capture has zero inference cost; fallback captions
reserve/account their own usage without another frame count. No migration is needed: 0040
already stores bounded JSON metadata; 0041 remains free (L120). Schema alternatives
are validated in code with plain root objects (L121); shared capability
instructions and their limits are unchanged. Offline checks do not establish live
provider acceptance or latency; the UI switch and deployed verification belong
to the coordinator/separate web session.

P9-86 (12 October 2026, user-directed): Jarvis speaks as himself in the first
person in chat and voice, in English and Danish. When discussing
`DanAakesen/jarvis`, he owns its code, PRs, issues, deployments and Software
Factory tasks as his own implementation; other repositories remain the user's
projects. Keep existing tone settings, tool permissions, untrusted-content
handling, confirmation gates and truthful action reporting unchanged.

P9-83 (#705, 11 October 2026) supersedes P9-82's unset realtime budget callback
and unresolved Danish architecture notes below. Production `/voice` and
`/voice/da` both use the same backend-owned Voice Live realtime connector and
configured voice deployment (`gpt-realtime-2.1` by default), not a Danish
transcribe → chat → TTS pipeline. Preserve the L103 session shape and #702's
item-correlated, single `response.create` hold. The provisioned hosted Danish
bridge is only a fallback when that connector is absent; it remains honestly
caption-only.

The relay sends an original `input_image` only after private-handle binding and
budget admission. A matching item acknowledgement selects `image_accepted`;
correlated rejection or the 1.5-second acknowledgement deadline selects
`image_rejected` or `image_timeout`, deletes the image item and supplies caption
observations. Late results cannot create another reply. Capture budget denial
and image admission denial surface as turn-correlated `budget_exhausted` with
typed unavailable feedback; unknown admission is `budget_unavailable`.
Buffers are zeroed after sending, and image history remains text-only.

Reuse the shared UTC-day vision ledger and its conservative pending allowance;
capture counts once toward the 300-frame cap. Chat reserves at authorized
frame resolution and reconciles the first image request's provider totals
without double billing. Voice records provider-reported image token quantities,
never prices audio/text totals as image tokens. No realtime image tariff is
hardcoded: the provider image-token quantity is actual, while both realtime
models retain their conservative unverified allowance charged to the daily
budget until the coordinator verifies Azure pricing. A web-search list-price
claim was not adopted because direct source retrieval was unavailable and it
did not establish the deployed Azure tariff. Missing provider
usage after inference also keeps that hold; missing usage is not evidence of
zero cost. Known no-inference rejections/cancellations release the reservation.

`visual.path` is allowlisted to path, bounded reason, channel and latency only.
It strips content and all identifiers, including request logger bindings.
The coordinator must inspect `chat`, `voice-en` and `voice-da` events after
deploy and confirm acceptance with a non-private fixture. Offline request,
acknowledgement, fallback and accounting tests are implementation evidence,
**not a live capability probe**. Cloud agents have not accessed Azure or
verified selected-model image support, provider billing, microphone timing or
deployed SQL behavior. No new migration, tool schema or capability instruction
is required; L120/L121 and `agents/jarvis/limits.json` remain unchanged.
Final offline evidence: 114 relay tests, 119 logging/conversation tests, 143
accounting tests and 246 Python tests passed, alongside backend build and scoped
ESLint/Ruff checks. A compiled private-frame smoke verified owner binding,
single-use consumption and zeroing. Secret scanning found no secrets. The final
automated validation request could not run because its time limit had been
reached; this is not a successful automated review or full final CodeQL result.

P9-82 (11 October 2026): camera-on consent includes sending the actual frame to
the answering model, not just a vision caption. Keep #702's question-aware
caption as the fallback. Frames belong in bounded process memory only, with a
60-second, owner/session/turn-bound, single-use handle; no image history,
SQL/Blob storage, logs or telemetry. No migration is needed.

Capability evidence at implementation start: the configured default chat
deployment is `gpt-5.6-luna`; its existing adapter uses Foundry Responses.
L112 records a successful live JPEG probe against the separate `gpt-6-luna`
vision deployment, not the selected chat model. This does **not** verify image
acceptance by the chat deployment. Earlier decisions claiming realtime cannot
accept images are not evidence for `gpt-realtime-2.1` on the deployed Voice Live
API. Both deployed acceptance probes remain unverified: cloud agents must not
access Azure (`docs/agent-context.md`, Development workflow). Offline provider
request tests must be distinguished from a live probe. The coordinator must
probe a small non-private fixture with the selected deployment/API and record
acceptance or rejection before claiming deployed direct-image support.

The Danish production relay currently shares English's realtime path (L103);
the hosted Danish agent is a fallback only. Do not silently replace that
architecture with the issue's assumed transcribe/chat/TTS pipeline. Cover the
hosted chat adapter in both languages and report the realtime limitation.
Realtime direct-image injection has an offline-tested acknowledgement/error
handshake behind explicit budget admission; the production callback remains
unset. The deployed EN/DA result is therefore still the caption path, reported
as `visualPath: "caption"`, not evidence that image input is unsupported.
P9-82 remains in progress until the coordinator verifies both selected-model
acceptance and the intended Danish answering architecture. No instruction or
tool-schema change is needed; existing capability limits remain unchanged.
Image admission uses the existing allowed `input_tokens` metric with a tagged
zero-quantity conservative cost reservation, included in the shared vision
budget. Actual model usage is recorded by the existing chat reporter and the
agent reports first-image-request totals. Separate image token attribution and
reservation reconciliation remain incomplete; do not describe zero reserved
quantity as actual usage or duplicate billed chat tokens. No new SQL metric or
migration was introduced.
Final offline validation: 262 targeted backend tests, 173 Python tests,
backend build, targeted ESLint/Ruff and bounded resolver/privacy smoke checks
passed. Secret scanning found no secrets. The read-only fallback review found
no remaining blockers after handle-validation and steering-image replay fixes.
Automated review was unavailable because its configured model was missing;
CodeQL completed Python with zero alerts but timed out before all languages
finished. These checks do not replace the unresolved deployed acceptance,
realtime budget admission or image-token reconciliation checks.

P9-81 follow-up (11 October 2026, Dan's decision on #701): camera on is consent
to look on every chat and voice turn; camera off sends nothing. This supersedes
the earlier explicit-request-only camera contract, not screen sharing or watch
mode. Keep the existing three-second session rate limit and daily frame cap;
return typed pacing errors rather than silently dropping images or closing a
voice call. Retain the answered question alongside bounded visual provenance,
and label cached observations by their original question and server receipt
time. Never reuse an old answer as the answer to a new question.
Camera-enabled voice waits for the matching transcription item’s result,
unavailable reason or a roughly twelve-second deadline, then creates exactly
one normal reply; reflex-completed actions are not delayed. Existing realtime
English and Danish configurations already disable automatic response creation;
keep that baseline while adding the correlated wait. UI capture remains owned
by the separate session; this PR changes backend/agent contracts only.
Question bounds count Unicode code points before trimming and reject anything
above 500 with HTTP 400. Echo normalized question and caller correlation;
capture time is recorded at the server request hook, before parsing/settings/model
work, not after inference.

P9-81 (11 October 2026): on-demand vision accepts an optional bounded question
as untrusted data, with trusted model instructions asking for precise counts,
text and colours. Generic inspection and continuous watching keep their existing
prompts and limits. The capture time is the backend frame-acceptance time, not
an asserted device timestamp. Retain only the bounded visual description,
source, answered question and capture time in conversation turn metadata under
the turn's retention; never persist image bytes or log questions. Restored context labels
the observation as a real image while keeping its contents untrusted.
New/detail questions without a fresh image ask for another look; an earlier
real observation must not be called ungrounded. Legacy clients remain supported.
Migration 0040 has a paired down batch (L120); schemas remain plain root
objects (L121), and shared guidance stays within `agents/jarvis/limits.json`.
Focused vision/backend/agent tests, build, lint and secret scanning passed
offline; a read-only review found no blocking defects. Final automated
validation reached the session time limit. Isolated SQL integration execution
and UI/live acceptance remain unverified. Direct hosted-voice bridge translation
of realtime conversation items also remains unverified; DA/EN realtime paths
and hosted text-history grounding have offline regression coverage.

P9-80 (11 October 2026): Dan directed full backend access to the private
`DanAakesen/vault` repository. Owner Notes routes, vault tools, indexing, search
and graph cover safe Markdown paths at the root and at any depth; folder and
routing-rule gates no longer restrict access. The additive `/notes/tree` is
derived from the complete Git tree and cached with the vault index; Git's
implicit-directory model means writing the first note creates its parent path.
Writes, edits and deletes reject any dot-prefixed segment (including `.git` and
the skipped `.github`, `.obsidian`, `.codex` and `.vscode` trees);
note content stays untrusted data, never instructions. Owner auth, safe-path
validation, 256 KiB writes, secret checks, stored-Dan-message checks for agent
writes, SHA conflict protection and confirmed deletion remain. Contracts add
directory metadata and tree shape; logs expose only the four legacy folder
names or `other`, never paths or content. No migration or web change. Implemented
and tested offline; live vault access remains unverified.

Clean border resize and movable chat (12 October 2026, Dan; local, unreleased):
the later request supersedes the fixed-width, mounted-session height-only
refinement below. Dan explicitly rejected visible corner brackets: use invisible
edge/corner resize regions on the existing glass border, directional cursors
and keyboard focus, with no separate top resize grip. Keep Move beside Maximise.
Dan selected leaving the composer at its placed position when messages minimise.
Persist validated device-local position/size with reference canvas dimensions,
preserving preferred pixels across composer wrapping and clamping smaller
viewports without overwriting the saved preference. Keep the composer and
voice client in their existing React tree; the shell shares their pixel anchor
and measures the footer footprint. Seed first pointer interaction from the
visible opening rectangle before freezing its scale to avoid the reported jump.
Keep workspace move/resize commands and manual-placement snapshots consistent
with that same saved geometry.
Dan's scrollbar correction places side hit regions outside the transcript and
cuts the inward quadrant out of corner regions. The native scrollbar has its
own uninterrupted lane; scrolling cannot change saved window geometry.
Suppress the unhosted initial-history skeleton in the empty room while retaining
accessible status, standalone loading and error/Retry. Compact message type
remains. Local automated/browser evidence is recorded in agent-context;
physical-device acceptance, camera activation, commits and release remain separate.

Upload-only deployment and activation boundary (12 October 2026, coordinator
at 11:01 local): #713 (P9-85, closing #710) is merged/deployed with backend,
agent and smoke green, including the 400,000-byte text-part ceiling. Capture
`mode: 'handle'` returns a private handle/provenance with no description or
vision call; omitted mode preserves caption-first compatibility. Chat and
EN/DA realtime accept handle-only context, with same-frame backend caption
fallback and explicit no-image guidance if it fails. Correlation, single
response, sixty-second lifetime and owner/session/turn binding remain.
Final shapes are recorded in `docs/architecture.md`. The local opt-in stays
off until Dan accepts the camera UI release; this deployment is not permission
to flip it or proof of model image acceptance. Live-feel wording is now
identified as separate P9-87/#714, superseding its earlier #713 scope placement.

Live camera/latency follow-through (12 October 2026, coordinator at 10:54
local): Log Analytics for Dan's 07:52-07:53 UTC turns reports cold then warm
`chat.agent_session` records with `sessionIdUsed: true`. First text delta
(`agent_first_byte`) falls from 12.2 s cold to 5.2 s and 4.5 s warm, compared
with the earlier 12-18 s range. Session reuse now has reported live evidence;
this is not a local end-to-end timing or proof of the 2.5 s target.
Both camera turns still report `visual.path: caption` with
`reason: image_context_limit`, because request text exceeded a 28,000-byte
ceiling. The coordinator raised the ceiling to 400,000 bytes on #713; CI was
running at this update, so neither deployment nor answering-model image
acceptance is established. #713 also owns upload-only input. The current UI
still posts the caption-compatible request and validates a real description;
wait for final deployed shapes before enabling handle-only capture.

Chat height and density (12 October 2026, Dan; initial local refinement,
superseded above): make the typing transcript
taller by dragging its top grip, not by moving the dock or composer. Extend
the existing workspace gesture handling with per-view session height,
viewport clamps, cancellation and a keyboard alternative; keep free movement
and width resizing unavailable. The grip stays clear of window actions and
has a larger phone touch target. The chosen height survives minimise/reopen
and maximise/restore, but is not persisted across refresh. Correct scoped
message paragraphs from the inherited 18px lead style to the existing 14px
small-type role, tighten padding/speaker gaps, and keep the composer at 16px.
Desktop and touch Chromium fixtures verify the behavior and increased visible
message capacity; physical phone acceptance remains unverified. No backend,
camera-polish, commit or release change is authorised by this request.

Natural camera replies (12 October 2026, Dan; implementation pending): Dan
asks "Stop it from saying when the image was captured, i need this to feel live".
For fresh observations, answer conversationally without unsolicited capture
timestamps or snapshot-versus-live boilerplate. Preserve internal provenance,
ordinary age warnings for stale/reused observations, explicit unavailable
feedback and truthful answers to direct timing/input-path questions. Do not
claim continuous video access. The coordinator owns chat/EN/DA voice grounding
instructions; no UI message stripping, timestamp-field removal or cadence
change. Backend deployment/live wording verification remains pending.
The coordinator reports the change is scoped into #713, including code-owned
freshness (this turn's own observation within sixty seconds), ordinary age for
earlier/reused observations and fresh/earlier/unavailable chat/EN/DA coverage.
That earlier scope report was not deployment or local verification evidence.
The latest 11:01 local update confirms #713's input deployment but identifies
fresh-answer wording separately as P9-87/#714, still pending. No UI message
stripping or timestamp-field removal is needed.

Runtime status update (12 October 2026, coordinator report): #707 is deployed.
The coordinator changed live `roles.chat.reasoning_effort` from medium to low
to target model first-token latency; it is reversible in Settings. This
session made no settings/default/model change. At 06:53 UTC, the observed
browser Resource Timing buffer contains no new completed turns after the
budget-fix merge, so neither a latency improvement nor actual image input
is measured. #708 session reuse and #710 upload-only input remain pending.

Camera experience and chat latency (12 October 2026, Dan; open investigation):
Dan rejects the slow snapshot-per-turn camera experience and prioritises
natural visual conversation and faster general chat. Camera-window polish is
deferred until that experience is proved. Two live chat camera turns reported
caption-only input with `budget_unavailable`; Dan reports the finger count was
wrong. Existing signed-in browser Resource Timing measures ordinary chat
request-to-stream-completion at 18.416 s and 12.437 s, and camera inspection
plus chat at 19.694 s and 23.494 s. The latter include 1.773 s and 4.747 s of
inspection before chat. These are not time-to-first-token measurements:
cross-origin request/response timing details are unavailable. The UI starts
chat within 2-4 ms of inspection settling and consumes text deltas immediately;
history refresh is after completion. The coordinator owns deployed budget and
agent-latency diagnosis. This supersedes the earlier no-live-traffic acceptance
status, not image/audio acceptance: actual image input remains unproved.
No replacement cadence, continuous upload or release is approved.

Backend diagnosis follow-through (12 October 2026, coordinator): Log Analytics
reports first tokens at 17.6/12.2/16.6/16.1 s, with backend work under 0.5 s
and a 6.5-7.2 s no-callback gap before hosted-agent work. #708 investigates
query-parameter session reuse and debug-latency evidence; the gap alone is
not proof of provisioning, and #344/#356's failed reuse must not be repeated
without distinguishing the provider contract. The image resolver rejected
`gpt-6.1-sol` because it was absent from the pricing table. #707 merged at
06:41:02 UTC to admit unpriced models with an existing conservative,
unverified 0.1 DKK hold; deployment and real image acceptance remain unproved.
This is an admission correction, not removal of the serial caption stage:
the browser still awaits `/screen/frames` and its real description before
chat. A caption-free direct-input contract is separate proposed work.
No changes to the selected model, reasoning effort, camera cadence or UI.

Backend next-step scope (12 October 2026, coordinator; proposed, not deployed):
#708 now distinguishes #344's rejected `chat-<id>` sessions from the random
32-hex format already accepted by the voice path. Its chat plan is a
conversation-owned in-memory ID map with cold/warm debug-header evidence,
longer supported idle lifetime and recovery only for an explicit
pre-execution routing rejection, never a generic invocation failure.
#710 (P9-85), blocked by #708 for file overlap, proposes upload-only
`/screen/frames` `mode: 'handle'` and handle-only chat/voice context.
Only failed direct-image delivery would run a caption model inside the
answering turn; failed caption fallback must report unavailable.
Final field names and compatibility are pending that PR. The local UI keeps
its current deployed contract; camera cadence remains unresolved.

Deployed realtime image alignment (12 October 2026): #706 merged at
22:39:33 UTC on 11 October (55ee8e4b), closing #705. The coordinator confirms
backend, agent and smoke green and no relevant upstream/settings failures.
Final contract matches the prepared implementation: original budget-admitted
images precede one item-correlated EN/DA realtime response; acknowledged
delivery or caption fallback uses the existing visual-result event.
`budget_unavailable` is relay-to-client only, not a browser-send reason.
Hosted DA fallback remains caption-only. Image-budget accounting and
content-free `visual.path` diagnostics are deployed. No live camera traffic
has exercised this deployment, so actual model acceptance is unverified and
#703 stays open. The 320-test combined local suite passes with two known
unrelated baselines excluded; synthetic image-reported desktop/phone checks
exercise chat and both voice languages without claiming model acceptance.
This supersedes the earlier open/deployment and voice-caption-only statuses
below. The UI stays local until Dan reviews; no release or live upload approved.

Camera budget feedback (12 October 2026, local; deployment status superseded
by realtime alignment above): UI capture parsing and voice
receipt were dropping `budget_exhausted`, either forwarding generic
`vision_failed` or ignoring the relay notice. Preserve the typed capture
failure and current-item relay feedback; only rate/frame-cap refusals can
reuse a caption, never a budget denial. Do not echo server notices or infer
image delivery. #706's proposed `budget_unavailable` gets distinct receive-only
feedback; the browser does not send this new reason before deployment.
Nine failing regressions reproduced the gaps; all 128 tests in the four
affected files pass after correction, as do types/scoped lint/build.
Synthetic desktop/phone checks exercise both voice languages and history
recovery. #706 is open, and deployment/live acceptance remain unconfirmed.
No backend edits or UI release.

Camera evidence wording (12 October 2026, local): #704 implements image input
but live model support remains unverified. The previous shared copy conflated
`image_input_unverified` with disabled legacy-agent input. Use "Model image
support has not been verified" for the former and retain "Direct image input
is not enabled" for `legacy_agent`. Both still report caption-only input for
that turn. A regression reproduced the inaccurate wording before correction;
chat history and current-item voice use the same helper. No backend protocol,
image capability, layout or release policy changes.
The 114-test helper/chat/voice subset passes with the known locale baseline
excluded, alongside types/scoped lint/build. Synthetic desktop/phone checks
verify corrected wording and recovery in chat and both voice languages.

Deployed image contract alignment (11 October 2026; voice-caption-only status
superseded by realtime alignment above): #704 merged at 21:46:10
UTC (e5c83dbc); the coordinator confirms backend, agent and smoke green with
no voice upstream-event or agent-settings failures. Its implementation
matches the prepared draft. Keep the local consumers and forward fresh
optional handles with the correlated voice item; do not infer image input
from a handle or Live playback. Synthetic desktop/phone fixtures now use
32-character server-shaped handles and verify caption-only feedback and
recovery. Chat/Danish-text image input is implemented but live model acceptance
is unverified; EN/DA voice remain caption-only. #703 stays open; #705 (P9-83)
owns remaining voice images, image-budget accounting and content-free
`visual.path` diagnostics. This supersedes the draft/pending deployment state
below, not the outstanding actual-image/audio acceptance or Dan's review
requirement. No UI commit or release is authorised.

Voice visual-source interlock (11 October 2026, local): the deployed camera-on
relay requires item-correlated context/unavailable events. The old Look at
screen action could supersede a camera request or send an uncorrelated failure,
closing the socket with 1008. Disable that action while camera conversation is
on, with an accessible explanation; keep shared screen capture and independent
watch controls intact. Camera activation and stream/state changes cancel
in-flight legacy inspection, and its abort signal reaches capture. Three
regressions cover camera-turn preservation and late screen success/failure.
The 108-test voice/client/App subset passes, with the known stale Notes test
excluded; synthetic desktop/phone checks exercise the disabled row in both
voice languages. Direct image and live-audio acceptance remain pending.

Visual evidence recovery (11 October 2026, local): tracking the failed history
request's latest/older source is necessary for the existing Retry control.
Two regressions reproduced no request without a cursor and the wrong older
request with a cursor; both now pass, along with an older-cursor recovery
regression. The history/transport subset passes 79 tests (known locale test
excluded), types/build/scoped lint pass, and synthetic desktop/phone checks
exercise malformed evidence retry, restored history metadata and
stale/duplicate/uncorrelated voice events. The design-hook gradient-text
finding remains the previously accepted typed-phrase light sweep, documented
in DESIGN.md, not new evidence styling or a heading. No suppression or
unrelated visual change was added.

Camera input evidence (11 October 2026, local preparation; draft status
superseded by deployed alignment above): use only backend-reported
`visualPath`/`visualReason` to distinguish actual image input from caption-only
fallback. Do not infer it from the preview's Live label or an uploaded reference.
Prepare the current draft #704 done/history/voice shapes; do not call the server
resolver from the browser. Show ordinary chat body text on the matching user
message and the existing voice toast only for the current item. Invalid
evidence is a visible failure, not success; missing legacy evidence adds no
label. Discard raw visual metadata from UI history. Camera replacement,
on/off, session replacement and reconnect invalidate pending evidence; retain
the separate bounded transcription deduplication set. Synthetic desktop/phone
checks found and fixed phone preview limit-copy clipping with an open transcript.
The 307-test targeted suite, scoped lint, types and build pass; actual model
image capability and both voice image paths remain unfinished in draft #704.
No UI release is authorised.

Local camera activation (11 October 2026): #702's backend, Jarvis agent and
smoke checks succeeded in Deploy run 38172562500 for de3eb935. Enable
`cameraConversationDeployed` locally for question-aware caption conversations;
the direct-image task #703/#704 is additive and does not need to block that
deployed stage. The UI sends fresh optional references only if supplied by
the backend, never a cached handle. Physical-camera/live relay acceptance,
actual answering-model image delivery and Dan's UI release approval remain
outstanding. No commit or UI deployment is authorised.

Coordinator confirmation (11 October 2026; image dependency status superseded
by deployed alignment above): #702's final deployed contract
supports the locally enabled caption stage. Migration 0040 applied, deployment
checks found no voice upstream-event or agent-settings errors, and both voice
paths have item-correlated twelve-second holds with settled-item late results
ignored. The Danish hosted path disables automatic response creation while
camera-on. Relay ordering and legacy hosted-voice gateway translation are
offline-tested only; live audio acceptance is still outstanding. Keep the UI
local until Dan reviews. Direct image/frame references remain pending #703/#704.

Merged camera contract alignment (11 October 2026, before deployment; activation
above supersedes this gate state): #702 merged at 20:31:21 UTC; deployment and
live ordering were then unconfirmed. Read-only
review of its actual validators found three differences from the proposal:
generic capture returns `question: null`, question bounds count Unicode code
points, and correlated unavailable accepts `vision_failed`/`timeout` rather
than `inspection_failed`. Accept the generic null as absent, keep exact
500-code-point/no-truncation behaviour and use the actual relay names; the
proposed failure name would close the socket with 1008. Item/turn identifiers
use the merged ASCII pattern. Voice supplies optional frame `turnId` and
requires a matching echo. Show valid relay-originated limit events only for
the current turn, without echoing them back. The App gate was false pending deployment; actual image-path acceptance remains
outstanding and no release is authorised.

Camera caller implementation (11 October 2026, before deployment; gate state
superseded by local activation above): implement Dan's
every-turn requirement against the coordinator's proposed contract without
activating unsupported production payloads. App's `cameraConversationDeployed`
gate was false pending deployed contracts and both voice response holds. Camera-on chat queues rather than steering and inspects
when its turn runs. Voice synchronises camera state and reconnect, captures
the item's question, aborts superseded work and emits unavailable by ten
seconds. Repeated transcription IDs are suppressed in a bounded session set.
Only typed limits reuse a same-stream/session caption labelled with age and
original question; single-use frame references never enter that cache. Known
pacing survives stop/switch, while cached content is cleared. Limit notices
use preview body text and the existing toast stack, including while docked.
This reuses the existing window/composer geometry and independent watch mode.
Local synthetic tests and desktop/phone Chromium checks support UI behaviour,
not live relay ordering, actual model image delivery or release approval.

Direct camera image (11 October 2026, user-directed via coordinator;
proposal/deployment status superseded by deployed alignment above): Dan
requires actual image input to the chat and voice answering models, not only
a caption. The coordinator is sequencing an additive opaque frame reference
after #702: at most sixty seconds in memory, single-use owner/session-bound
consumption and `visualPath: image | caption` metadata. Prepare preservation
of optional `frameId` in the UI capture result without claiming image delivery.
The coordinator later proposed 1–128 characters from `[A-Za-z0-9_-]`,
one chat `visualContext { source, capturedAt, description, question, frameId? }`
and the same fields beside voice `itemId`. Local send adapters now prepare
that shape using shared bounds and strip unknown fields, including frame
bytes; gated callers now use it, while normal app behaviour remains unchanged
until deployment.
Chat captures when the queued turn executes; voice
forwards the reference before releasing the same item's held reply. Final
deployed fields and backend implementation are pending; no deployment is
authorised here.

Camera conversation (11 October 2026, user-directed via coordinator): Dan wants
a conversation about the camera in both chat and voice. Camera on therefore
requires a fresh bounded frame with the question on every user turn; explicit
phrase matching and watch-mode dependence are superseded. Camera off sends
nothing. Respect rate/daily limits with visible, age-labelled reused context,
never treating an old observation as a fresh answer. Exact deployed question,
provenance and voice response-ordering contracts await #701/#702.

Dan selected ten minutes without a user turn for idle shutdown instead of
the hard five-minute cutoff. Locally, chat submission and speech/final voice
turns reset the capture owner's timer; dock/render activity does not. Expiry
stops tracks and restores the preview with an explanation and retry. Hide the
inactive empty picture so recovery fits phones. Explicit stop/unmount cancels
the timer. This does not authorise UI shipping.

Camera follow-up evidence (11 October 2026): the coordinator reports exactly one
successful live `POST /screen/frames` at 19:23:33 UTC (200, 2.9 s), grounding
Dan's scene description. The later finger-count question triggers no capture
in the current UI, even without its typo. Missing current image context does
not invalidate the prior observation. The coordinator identified transient
turn-only vision context and a generic question-free vision prompt, and is
preparing question-aware requests, capture time and retained visual provenance.
These contract additions are pending, not implemented here; keep the UI capture
path unchanged until exact deployed fields arrive.

Camera contract preparation (11 October, local): prepare optional question
forwarding and response parsing against the coordinator's proposed shape,
without changing live caller routing before deployment. Reject questions over
500 characters instead of truncating them. Legacy responses carry no invented
capture time; a question-specific result needs valid server time and a matching
echoed question. Preserve only recognised typed 429 limits for future cached
fallback; ordinary/unknown failures remain explicit. These proposed fields
are not a claim that #702 or every-turn vision is deployed.

Voice camera protocol preparation (11 October, local): the coordinator found
that existing visual context creates a separate voice reply and rapid context
events can close the socket. Prepare explicit camera-state signalling with
reconnect replay and transcription-item correlation for context/unavailable,
without enabling these events against the old production relay. An opted-in
camera-on adapter requests context for every non-empty transcript, not a
phrase match. The backend must hold one normal reply, release it for the same
item's context/unavailable or its deadline, and ignore stale/late results.
Normal app callers remain gated pending the confirmed deployment; local
opted-in callers now implement that orchestration.

Camera preview (11 October 2026, local): Dan supplied desktop/phone references
for a separate preview instead of modifying the composer. Reuse one local
capture and the existing workspace window/tab/command lifecycle, named
`Camera preview` with ID `camera-preview`. Dan confirmed Close turns camera
off; minimise/dock keeps capture on. Phones keep a compact preview alongside
the foreground view; desktop starts upper-right and supports normal move/resize.
Switch is mobile-only; the live preview never uploads by itself. Reopening by
Jarvis uses already-granted permission and the default camera, rather than
requiring desktop facing metadata. Permission refusal, cancellation and
playback failures remain explicit. Local scoped tests (96), typecheck/build
and synthetic desktop/phone/landscape browser workflows pass, including a
fresh frame while docked. Lint retains the pre-existing pin-loading effect
error. The coordinator confirms #700 deployed the matching backend capability
instructions, including permission-checked reopening without a schema/tool
change; backend smoke checks are green and logs clean. Physical-camera/live-model
acceptance and Dan's UI release approval remain outstanding; the UI is local.

P9-79 (11 October 2026, local): Dan requested camera status outside the phone
typing area, actual Front/Back indication and switching, then explicitly rejected
Look now buttons in favour of simple wording and icons. Reuse one compact status
row in chat and voice with switch/off icons initially; the Camera preview
decision above supersedes that placement. Inspection remains wording-driven.
The client trace found voice callbacks retaining the camera's old sharing state,
chat recognising fewer phrases than voice, and visual requests being steered
without a frame during an active reply. Fix those paths, verify actual facing,
and bound frame readiness/token acquisition using the existing cancellation
pattern. Synthetic Chromium traffic proves the local upload/context path, not
the root cause of every reported live turn or physical-camera/model acceptance.
No backend route, provider, dependency or persisted camera permission is added.

P9-78 (11 October 2026): use the generated view's existing `source.updatedAt`
to invalidate a mounted HTML artifact load when its ID stays the same. Keep
the artifact React key and existing window system, rather than remounting the
whole window or adding a contract field. Hide obsolete HTML during the load,
abort/ignore superseded responses and reuse the existing retry state. This closes
P9-53's renderer refresh gap without changing the approved design or the six
locally reserved UI tasks. Focused tests, web lint/build and Chromium fixtures at
1280×900 and 390×844 in light/dark, including reduced motion, pass offline;
production refresh remains unverified. No new dependency or permission.

P9-67 (10 October 2026): issue attachments default to fenced descriptions and
transcribed text from P9-66's private store. All issue/comment writes are staged
and checked for secrets. Public publication is one image at a time, requires an
acknowledged private chat preview, warns that anyone can read it, and requires a
later confirmation naming the file. GitHub has no issue image-upload API: reuse
Contents write for EXIF-free, content-addressed images on the never-merged
`issue-attachments` branch and embed raw GitHub image URLs in comments. Public
Git history is not governed by private attachment retention. No migration,
new dependency, App permission or web change; live acceptance remains pending.
Workspace acknowledgement confirms preview creation only; image-load/visibility
acknowledgement remains a web limitation for #649, outside this backend task
(#649 now shows the image with a public-repository note in chat; it still cannot
acknowledge on-screen loading to the backend).

P9-66 (10 October 2026): keep conversation uploads in the existing private
`artifacts` Blob container under `attachments/`, with SQL-owned metadata and
owner-only short-lived read URLs. Re-encode images with Sharp to remove metadata;
use pdfjs-dist for bounded PDF text, fast-xml-parser for bounded OOXML text, and
the existing fflate for Office ZIP containers. The multipart plugin enforces
request/file parsing limits. Store only bounded extracted text or image
descriptions, mark extraction failures on the attachment, and expose content to
the agent solely as explicitly untrusted context or through sensitive,
redacted-read tools. Use 24-hour expiry for unsent uploads and configurable
1–90-day retention (default 30) for sent files. Offline route, extraction,
migration, retention and tool-parity checks pass; live model and Blob behavior
remain unverified.

P9-59 (10 October 2026): register the sensitive `renew_credential` tool in the
always-present core module and reuse the route's forced Codex-renewal callback
and credential-status store. Require `runConfirmed('other', ...)` before any
renewal side effect; refuse unknown names and missing renewal, status, or Now
services. Relay persisted status and only static outcome-specific next steps,
including the sign-in instruction on definitive failure. Keep audit arguments
and results redacted, and name this tool in shared instructions only because
core always registers it. No contract, migration, App permission, or web change
is required. Focused tool, refusal, confirmation, parity, and redaction tests
pass offline; live Now/Foundry and human sign-in acceptance remain unverified.

P9-57 (10 October 2026): reuse `WorkspacePinStore.list` and the existing
acknowledged workspace broker for owner-scoped saved-pin discovery and restore.
Keep the tools read/restore-only: pin/unpin remain page-owned. Return bounded
oldest-first metadata, resolve exactly one view ID or unique case-insensitive
title query, and ask Dan to choose ambiguous matches. Revalidate stored views
with `isWorkspaceCommand` and current registered tools before create/update,
then focus; refuse when no owner workspace is connected. Use plain root object
schemas (L121), one tool-name-free shared instruction, untrusted title markers
and redacted audits. No migration, App permission or web change is required.
Acceptance paths are verified offline; live model/browser use remains unverified.
P9-58 (10 October 2026): keep `set_theme` as a compatibility tool, but route its
flat appearance tokens through the shared `applySettingsPatch` validation and
write path used by `update_settings`. Colour `null` clears one override and
`reset: true` clears all three. Preserve the existing settings rows and omit
cleared colours from effective settings; no migration, App permission, contract,
or web change is required. Backend tool and HTTP tests verify the behavior
offline; live model use remains unverified.
P9-74 (10 October 2026): hide note front matter rather than introduce a YAML
parser or property editor. Strip delimited metadata after leading comments,
whitespace and BOMs, including malformed YAML. Keep the note path, Markdown and
connections in one scroll region with a bottom fade and labelled scroll control.
Exclude documented tooling patterns from graph/count presentation only; preserve
indexing and Jarvis search.

P9-56 (10 October 2026): reuse the Folio route stores for Jarvis rename,
pin/unpin and removal, preserving the existing index-only deletion semantics:
source artifacts and history remain available, but Folio no longer lists the
entry. Deletion uses the existing item-naming Now approval service and fails
closed without verified present status; recheck presence and title after
approval. Keep action alternatives in execution code, not root schema
combinators (L121). The shared instruction names no optional tool; returned
titles are untrusted and audit content is redacted. Acceptance paths are tested
offline; live model/Now use remains unverified.

P9-55 (10 October 2026): reuse `settingsOptionsForCatalogue` for settings-tool
discovery parity with `GET /settings`, and derive field guidance and numeric
bounds from the existing patch schema. Filter settings, options and fields
together for the requested area. Keep existing update validation and Now gates;
generate bounded refusal hints from known fields and catalogue values, never
submitted values. Both settings tools remain sensitive and always registered,
so one shared discovery instruction can name them. No migration, App permission,
dependency or web change is needed. Verified offline; live model use remains
unverified.

P9-52 (10 October 2026): keep generated window readback in the existing
owner-scoped, bounded workspace command records, not SQL. Register `read_window`
in core even when HTML storage is unavailable, prefer page-reported content,
and expose only bounded untrusted text through a sensitive tool. Reuse parse5
and the existing owner-authorized HTML artifact store for static report text;
never execute scripts or fetch resources to read a report. Preserve the
existing chart contract: units are returned when supplied in series names or
point labels, not invented as a new field. No migration or App permission is
needed. Backend/contracts verified offline; UI reporting (#640), live model
use and dynamically rendered report text remain unverified.
P9-53 (10 October 2026): revise HTML apps/reports through owner-scoped,
agent-only read/update tools using the existing artifact history table and
workspace update contract. Archive previous content and increment its version
inside a row-locked SQL transaction; retain all history on this path and preserve
omitted metadata, Folio records and pins. Read historical versions to support
rollback by submitting their HTML/title/sources as another revision. Keep tool
names in tool descriptions, with one tool-name-free shared instruction bullet
because the HTML module is conditionally registered. Applied broker commands
provide a bounded research-window/artifact mapping; canonical HTML windows need
no mapping. Tests cover tools, redacted audits and SQL persistence. Backend-only
scope is preserved: the current web iframe does not refetch same-ID updates,
so visual refresh acceptance remains blocked on separately authorized web work.
No migration, new dependency or App permission is needed.
P9-54 (10 October 2026): keep pull-request and CI inspection read-only. Reuse
the registered-project resolver and repository-scoped GitHub App tokens, and
expose bounded diffs, resolved review-thread state, check summaries and
sanitized failed-job log tails. Do not add persistence or App permissions;
changes remain with the confirmed issue or running-task flow. Fake-backed
offline tests cover responses and redaction; live GitHub acceptance remains
pending.

P9-43 (8 October 2026): reuse the workspace broker's latest connected-owner
snapshot for per-turn model awareness; do not persist screen or view content.
Keep `view` optional for old clients, validate current/previous destinations,
and provide one bounded metadata line through the existing chat turn-context
API and voice response instructions. Treat escaped window titles as untrusted
data. Resolve “go back” from `view.previous`, asking when absent rather than
guessing. Folio navigation opens a pane over the current page; Status remains
unavailable until its page exists. Backend/contracts are validated offline;
the UI session owns snapshot publication and live acceptance remains pending.

P9-42 (8 October 2026): return invalid tool arguments as safe `refused` tool
results, not generic execution failures. HTTP body-schema refusals use status
200 because the existing hosted chat client discards non-200 bodies; other HTTP
errors keep their existing status. Share the validation formatter with direct
voice execution and guide retries through the existing capability prompt.
Refuse unknown root fields before Fastify strips them; never execute or audit
invalid input. Emit only the tool name, validator keyword and bounded property
identifier as `tool.invalid_arguments`. Keep tool schemas plain root objects.
`repo_search` aliases use the existing active-project resolver; conflicting
selectors refuse rather than searching an unintended repository. Incomplete or
empty searches suggest `repo_list`/`repo_read`. No migration, new dependency,
workspace broker or web change is needed; live model/provider acceptance is
pending.

P10-02 (8 October 2026): use GitHub issues as Jarvis's single backlog and source
of truth, with the Software Factory/Codex as the default executor. An active
Factory task links to at most one issue per project; a duplicate issue start
reuses that task. Treat issue content and Dan's comments as untrusted request
data, include the repository's own agent rules, and publish only content-free
progress comments. `create_task` creates a linked issue; old unlinked task rows
remain readable. Migration 0037 follows the 0036 Folio migration and L120.
Offline fake-backed route, tool, webhook, delivery and progress tests cover
behavior; live GitHub issue access awaits P10-01's App permissions.

P10-03 (8 October 2026): create new code-change issues through the shared GitHub
App issue client, with no new persistence migration. The tool stages the draft
and requires an exact confirmation from a later Dan message; the authenticated
Factory endpoint creates directly for Dan. Allocate the lowest available
`P11-NN` in the target repository by reading its existing issue titles and
rechecking when confirmed. Use `enhancement` by default and `bug` only for
titles explicitly prefixed `[Bug]`, `Bug:`, or `Regression:`. Add the Jarvis
worker label only after opening the issue so P10-02 receives the label event;
assign Copilot and post a bounded scope comment when selected. Reject likely
secrets before sending content to GitHub. Focused fake-backed tests cover
allocation, confirmation, labels, assignment and route authorization; live
GitHub writes remain pending P10-01.

P9-10 (7 October 2026): store memory retrieval settings in the existing global
`dbo.settings` store and expose their shared bounded contract through Settings.
Keep defaults at the existing similarity thresholds (`0.35` embedding and
`0.12` TF-IDF), five search results, and automatic capture enabled. The
embedding threshold applies to application and SQL graph edges; top-k is capped
at eight. Automatic captures are marked in the shared vault tool and refused
server-side when disabled, while Dan-requested writes stay available. No
migration or web change is needed; focused contract, settings, vault and voice
tests cover the behavior.

P9-11 (8 October 2026): store timeout controls in the existing global settings
store and expose them through the shared contract and agent-only settings route.
Keep defaults at 30 seconds for ordinary tools, 320 for long tools and 10 for
agent HTTP, bounded respectively to 1–120, 30–320 and 1–60 seconds. Reuse the
existing bounded research timeout setting and add no migration or web change.
Use safe defaults when an older backend omits timeout fields. Do not add
automatic retries for timed-out tool actions because completion may be
uncertain. Contract, settings, and agent tests cover the bounds and use; live
propagation remains unverified.

P9-35 (8 October 2026): call saved PC/browser action sequences Routines and
expose a safe display-name rename without changing their content-derived IDs or
replay steps. Write new records under `routine.<hash>` while reading, migrating
and deleting legacy `recipe.<hash>` records in the existing settings store; no
database migration is needed. Expose `task_routines` and `/routines`, retaining
`task_recipes` and `/recipes` as one-release aliases. The web UI remains outside
this backend change.

P9-62 (10 October 2026): make self-diagnosis read-only and cache-only for
integration probes. Keep a last status snapshot separate from its refresh TTL;
mark subsystem, smoke and work evidence older than five minutes unknown. Use
fixed safe reasons rather than returning arbitrary source detail or private
text. Reuse credential/job/release stores, with a cancellable job-failure
aggregate that returns no private text; cache only work verdicts and bounded
hourly tool-event counts in process. Return 26 fixed-order components, nullable
missing timestamps and registry-gated existing recovery actions; renewal also
requires its runtime callback and Now approval service. Do not infer
delivery from recorded deployment status, auto-repair, add a migration or expand
App permissions. Focused offline tests verify statuses, expiry, missing/stale
sources, no probe calls, sanitisation, ordering and recovery gating; live model,
SQL and provider acceptance remain pending.

P9-20 (7 October 2026): expose one owner-authenticated, cached `/status`
snapshot using the shared contracts; reuse it in `get_status_summary`. Keep
status probes bounded and return only allowlisted metadata, never provider
errors, tokens, or vault content. Use existing database index timestamps for
vault freshness/coverage and the built image's commit metadata; add no migration
or web changes. Report unknown where the existing Foundry/runner signals do not
prove runtime health, and leave bridge versions null until its protocol reports
them. Focused offline tests cover caching, authorization, status details and
sanitized failures; production provider health and UI acceptance remain pending.

P9-39 (8 October 2026): use an authenticated, uncached `GET /status/smoke` to
refresh the existing read-only probes and run bounded embedding and research
checks. Permit Dan and only the configured deployment service principal, with
the latter restricted to an Azure Resource Manager audience and this route.
Return only allowlisted IDs, statuses and timestamps; keep the latest report in
the existing in-memory status snapshot so the status page can display it without
a migration. Research uses a temporary invocation with best-effort cleanup and
does not persist its result. Deploy prints only the six status values, treats
the disconnected PC bridge as informational, and fails on other degraded/down
checks. Offline tests cover contract bounds, authentication, refresh, recording
and secret sanitization; live provider behavior remains pending.

P9-14 (7 October 2026): persist each background-job state and step transition in
SQL, and publish job events only after the state transaction commits. Keep jobs and
step history for 30 days. Jobs are not resumed automatically: startup marks running
jobs `failed` with `interrupted by restart`; do not repeat external research or
artifact side effects without a user request. Evidence: migration 0029 and focused
lifecycle tests, with SQL persistence and schema coverage in Database CI.
Cross-replica live acceptance remains unverified.

P9-30 (8 October 2026): expose bounded persisted job details through `get_job` and
allow `retry_job` only for failed research jobs with saved topic and selected depth.
Store that input for the same 30-day retention, redact it from tool-call audit
records, and create each retry as a new job. A transaction claims at most one retry
from a failed attempt, preventing duplicate research work across replicas.
Evidence: migration 0034 and focused contract, retry, and store tests; live
SQL Server and cross-replica behavior remain unverified.

P9-24 (7 October 2026): search the existing conversation message store instead of
creating a second transcript index or changing retention. Use SQL full-text search
when available, with an optional startup setup batch and a substring fallback;
index message timestamps for date-filtered reads. Expose one bounded result
contract to the owner-authenticated API and shared `conversation_search` tool,
and redact tool queries/results from the durable tool-call audit. Offline
route/store tests cover filters, date boundaries, result limits, the fallback,
and the full-text query path; production SQL indexing remains unverified.

P9-01 (7 October 2026): use the existing `dbo.settings` key/value store for
per-role model and reasoning-effort preferences; do not add a migration.
`jarvis.model` and `jarvis.reasoning` remain compatible aliases for `roles.chat`.
Read live Foundry deployments from ARM using backend managed identity with a
Foundry-account-scoped Reader grant, cache for five minutes, and identify
configured defaults as `source: 'fallback'` when ARM is unavailable. Validate
each role's model and effort against deployment capabilities; keep Codex and
Copilot on their provider defaults until provider catalogues are verified.
Offline route, settings, dispatcher, agent, research, vision and voice tests
cover the implementation; live ARM permissions and deployment selection remain
unverified.

P9-02 (7 October 2026): apply role settings at the next relevant turn or session.
Use the vision role for screen/camera, browser text reasoning, and PC-act vision;
offer only image deployments with known cost rates. Snapshot research model and
reasoning effort at job start and pass both through the existing Codex runner.
Build the English Voice Live URL with the selected realtime deployment at
session start; allow `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`, and expose
only Voice Live-supported `mai-transcribe` for transcription. Add the mini model
to the existing Bicep deployment chain without a settings migration. Offline
runtime and runner tests cover these paths; deployed Azure interoperability and
billed cost remain unverified.

P9-03 (7 October 2026): persist the deployment name with each memory and vault
embedding and never compare vectors unless their model names match. Keep vector
dimensions at 1,536 by setting the embeddings request `dimensions` field, so
the existing SQL vector schema supports both small and large deployments.
Treat legacy or different-model vectors as missing; on a role change, a
cancellable durable background job re-embeds bounded memory batches and invokes
the existing paced vault synchronization. Startup checks for remaining missing
vectors and resumes the job. Evidence: migration `0031_embedding_model_identity.sql`,
model-filtered SQL/JSON search, and focused model-switch/backfill tests. Live
Foundry and SQL Server acceptance remains unverified.
P9-04 (7 October 2026): give Codex and Copilot provider-specific model and
reasoning allowlists in the settings options, and apply the selected role
defaults when a Factory task starts. A per-task model or reasoning override
continues to take precedence; the runner applies Codex choices through ACP
configuration and Copilot choices through CLI arguments, then persists them
with the ACP session for resumed turns. Reuse the existing settings and task
columns without a migration. Keep `JARVIS_CODEX_TOOL_MODEL` scoped to isolated
Codex tools. Offline catalogue, dispatch and runner tests cover the path; live
provider/account availability remains unverified.
P9-05 (7 October 2026): persist bounded voice tuning in the existing global
settings store and expose its limits through the shared contracts and
`/settings`; no migration is needed. Preserve the current server-VAD defaults
(threshold 0.7, 300 ms prefix padding, 600 ms silence), enable barge-in by
default, and cap replies at the existing provider default of 4,096 output
tokens. Apply settings when building a realtime session; keep English semantic
VAD's existing 0.6/300/500 ms configuration. The live Danish hosted agent has
separately provisioned turn detection and is not changed by this session
settings API. Offline contract, settings, relay and session tests cover the
backend behavior; live Voice Live behavior remains unverified.
P9-06 (7 October 2026): persist the default research depth, maximum collected
sources and per-runner-invocation timeout in the existing settings store and
shared contracts; add no migration or web changes. Preserve the current quick
and deep plans (two and five searches), add standard with three, and keep one
report-generation pass. Default to quick, 50 collected sources and a 305-second
invocation timeout; explicit request depth overrides the saved default, report
generation remains capped at 12 sources, and configured timeouts are bounded at
320 seconds to fit the long-tool timeout. Focused contract, settings and
background research tests cover validation and use; live Codex/Foundry behavior
remains unverified.
P9-07 (7 October 2026): manage model deployments only from models present in the
live Foundry account catalogue. Generate deployment names from model and version;
require the existing one-time `model_deployment` Now confirmation for both
create and delete, including the chat/voice tool. Recheck every resolved role
setting after approval before deletion and refuse deployments still in use.
Return 202 from Dan-only deployment routes while confirmation is pending. Grant
the backend identity Cognitive Services Contributor scoped to the Foundry
account. Keep deployment state in ARM without a migration. Use explicit
Incremental Bicep deployments: runtime-created deployments absent from the
template remain untouched, while Bicep-declared deployments continue to be
reconciled. Offline ARM/route/tool tests verify the contract; live role
propagation and Foundry provisioning remain unverified.
P9-12 (8 October 2026): expose the existing non-secret Settings model through
the shared chat/voice tool registry, reusing its validation and persistence
contracts. Require the existing Now confirmation before changing model-role
settings or the daily vision budget; never return credential records. Keep
`set_jarvis_model` as a compatibility alias for chat-role updates. No migration
or web change is needed. Offline tool and alias tests cover the behavior; live
hosted-agent and Now integration remain unverified.

P9-34 (8 October 2026): keep home city and nullable coordinates in the existing
`dbo.settings` store and shared settings contract; leave them unset rather than
guessing a home location. Use Open-Meteo's fixed HTTPS geocoding and forecast
endpoints without an API key, with bounded requests and validated normalized
results. Track weather retrieval with the existing persisted job registry, save
a static escaped report through the workspace HTML artifact store, and open it
through the command broker. No migration or web change is needed. Offline
settings/provider/workspace tests cover the flow; live provider and signed-in
workspace acceptance remain unverified.

P6-22 (6 October 2026): Jarvis runs in Dan's personal tenant, without Microsoft
365 or Teams. Keep away mode manual and do not read Graph presence. Route
notifications and confirmations through the web app and active browser voice
sessions; do not provision Teams Bot, Teams channel, or separate Speech F0
resources in production. This supersedes earlier P7 Teams-call, Graph-presence,
and Teams-routing choices. P10-10 later removes the optional Teams messaging
implementation entirely; that design is superseded below.

P6-23 (6 October 2026): replace boolean away mode with Present, Away, and On
the move (`present`, `away`, `on_the_move`), with green, yellow, and blue as the
UI colour contract. Keep the existing JSON settings row and read legacy booleans
as Away/Present; normalize removed `teams_presence` values to manual. Persist
base instructions under the unchanged `personality.customInstructions` key and
individual 2,000-character mode instructions under
`personality.modeInstructions.<mode>`. Dan-only presence changes are manual;
Jarvis changes are announced and require no confirmation. Preserve the derived
`away` boolean and one-release `set_away_mode` alias for existing consumers.
Evidence: API, tool, settings, state migration, and agent-awareness regression
tests; live Voice Live and UI integration remain unverified.

P9-44 (8 October 2026): allow device-originated `/presence` updates, but ignore
them for two hours after a manual change. Voice/chat presence tools are manual;
manual same-mode updates refresh the precedence window. The existing persisted
source and timestamp are sufficient, and ignored updates do not publish or
announce a change.

P6-21 (6 October 2026): project task summaries from existing PR, workflow,
usage and PR-opened event records without live GitHub reads or a schema change.
Unknown state, token metrics and costs stay null; recorded costs can be partial.
Keep pre-start Retry separate from Recover: reset the dispatcher attempt budget
under the existing sleep/task locks and publish a committed `state_changed` event.
Require a confirmed pre-start refusal; sandbox history, ambiguous start outcomes
and archived event history refuse Retry rather than risk duplicate remote work.
Focused API/dispatcher and real SQL Server tests verify the contracts;
deployed behavior and UI consumption remain unverified.
P6-20 (6 October 2026): maintenance workflow cancellations are not failed
deployments. Match deploy workflows by file (`deploy*.yml`/`deploy*.yaml`), retain
real GitHub release deployments, and collapse same-project/workflow failures over
a rolling hour, including dismissed alerts.
Resolve workflow IDs and cancellation with a bounded Actions-read App request
when a run URL is supplied, so grouping does not depend on webhook arrival order.
Preserve workflow history and dismiss
historical board alerts with migration 0024 (renumbered to avoid #462's 0022 and
#459's 0023); its down batch must not resurrect
owner dismissals. Durable deployment failure receipts keep collapsed failures
idempotent even before a release exists. Evidence: webhook mapping and SQL schema
regression tests.

P7-35 (6 October 2026): reuse the existing global JSON settings store for bounded,
value-free task routines rather than add a table or rewrite occupied migration
0020. Jev selects by app/site, verifies each fresh stable target, and falls back
on drift; low confidence asks Dan. Dan's any-app access and irreversible-only
confirmation decision also applies during replay. Deletion is available through
Settings and a sensitive tool. Offline checks establish the contracts; real
Windows/Chrome/Jev speedup remains live acceptance.

| Date | Decision | Rationale and evidence | Status |
| --- | --- | --- | --- |
| 2026-10-31 | The secondary accent of the iPhone app is stone, replacing the cyan. The token `accent-2` is `#c9bfae` in dark mode and `#6f6551` in light mode, and the focus ring uses the light value. The orb keeps its cyan rim. Native screens must use one shared secondary token and no per-screen copies; the Health secondary token is updated to stone and Voice listening keeps its cyan orb colour. | Dan picked option 5, Stone, from five candidates shown in dark and light with a chat mock. It supersedes the cyan wording in the next row. The concept board and the system surfaces page are republished with the new token; the web palette is recorded separately. | Confirmed by Dan |
| 2026-10-31 | The iPhone app uses orange as the primary accent and cyan as the secondary accent. Primary orange is `#ffb45c` with dark text `#1d1200` in dark mode and `#b45f06` with white text in light mode. The secondary cyan is the token `accent-2`: `#52dcfa` in dark mode and `#14768d` in light mode. Dan wants the cyan replaced by a better colour later, so builders use only the token and never the literal value. The orb is unchanged: the real web orb with a dark glass sphere, a cyan rim, an orange and amber glowing tangled centre, and no orbit ellipses or tilted circles. | Dan: orange as the primary colour and the current cyan as the secondary, to be improved in time. The web app is not changed by this decision and keeps its own palette. The concept board and the system surfaces page are republished as `docs/ios/design/board.html` and `docs/ios/design/surfaces.html` with this palette. | Superseded by the stone secondary above |
| 2026-10-31 | The web app shares the orange primary and stone secondary palette: `#ffb45c` with `#1d1200` control text in dark mode and `#b45f06` with white text in light mode; stone is `#c9bfae` in dark mode and `#6f6551` in light mode. Light-theme focus and link text use a deeper orange for 4.5:1 contrast. Existing per-user `--theme-accent` overrides remain supported. The orb's cyan glass edge and listening/voice colors stay unchanged; orange fills remain limited to primary controls and soft tints. | Dan's P15-21 decision on 31 October 2026 aligns web interaction, selection, progress and quiet secondary roles with the approved palette while retaining the separately owned orb and voice appearance. | Confirmed by Dan |
| 2026-10-31 | Dan approved all concept board screens: Health, Factory, Settings, Notes and Workspaces, together with the Chat, Voice, Sign-in, Face ID lock and App locked screens approved earlier. The approved frames are the visual reference only, and the native iOS standards row still governs how they are built. Builds for Health, Factory and Settings are tracked in #1430, #1431 and #1432. | Each screen has its own builder issue and the owner approves each pull request before it merges. Settings is built after the Sign-in and lock gate, which is merged. The published board is `docs/ios/design/board.html`. | Confirmed by Dan |
| 2026-10-31 | The system surfaces page `docs/ios/design/surfaces.html` has five surfaces that are still marked To agree and are not approved: the Lock Screen hands-free session, the Dynamic Island, Lock Screen tasks and decisions that need APNs, and Connection lost. They must not be built until Dan approves them. | Approval of the board screens does not cover these surfaces. APNs push is a known backend gap and needs its own decision before any push surface is built. | Open, to agree with Dan |
| 2026-10-31 | The iPhone screens contain no explainer, helper, hint or privacy text. Only labels, titles, values, status lines, button text and error messages that need an action appear in the UI. | Dan dislikes descriptive paragraphs inside the phone screens and had them removed from the surfaces page. Builders must not add them back. | Confirmed by Dan |
| 2026-10-31 | The Chat look is unified. Only the user bubble has a background: a soft orange-tinted glass pill. Jarvis replies, tool rows and status lines such as Writing it up are unboxed plain text. No solid orange fills are used anywhere: large orange areas are too harsh on the eyes, so orange is used for small accents, tints and strokes. | Dan approved this final Chat look on 2026-10-31 after reviewing the board. It applies to every surface that shows conversation text. The build is tracked in #1400 and the rule is repeated in #1430, #1431 and #1432. | Confirmed by Dan |
| 2026-10-31 | On the Factory board every column is collapsible. Each column header shows a chevron, the title, a count pill and a one-line status detail, and Done starts collapsed. The build is tracked in #1431. | Dan changed the concept board after the first publish. The header is a disclosure button with a VoiceOver label that includes the count and the expanded or collapsed state. | Confirmed by Dan |
| 2026-10-30 | Dan approved the Workspaces concept. The reference page is `docs/ios/design/workspaces.html`, published beside the concept board. The build is tracked in #1425. | The approved page is the visual reference only, and the native iOS standards row still governs how it is built. | Confirmed by Dan |
| 2026-10-30 | Notes version 1 is approved by Dan: four tabs (Notes, Tasks, List, Graph), a fixed bottom search and plus control, and creation bottom sheets for new notes and tasks. Builds are tracked in #1420. | This supersedes the earlier row that held the Notes concept frames as a proposal. The approved frames are the visual reference only, and the native iOS standards row still governs how they are built. The board is `docs/ios/design/board.html`. | Confirmed by Dan |
| 2026-10-30 | Dan approved the Sign-in and Lock (Face ID) concept frames on the board as the reference for their build. The Notes concept frames (Notes, Tasks, Graph, editor, new note sheet, and new task sheet) are a proposal pending his review and are not yet approved. | The approved frames guide their build as a visual reference only; the native iOS standards row still governs how they are built. The Notes frames must not be built until Dan approves them. The board is `docs/ios/design/board.html`. | Sign-in and Lock confirmed by Dan; Notes proposed |
| 2026-10-30 | Dan approved the Chat, Voice, and sidebar concept frames on the board as the reference for the first iOS screen builds. Notes, Workspaces, Settings, and the other areas are placeholder pages in version 1 of the build. | The approved frames guide the first builds as a visual reference only; the native iOS standards row still governs how they are built. The board is `docs/ios/design/board.html`. Each screen still needs its own issue and the owner's approvals before it merges or ships. | Confirmed by Dan |
| 2026-10-30 | The iPhone app follows the native iOS standards and does not hardcode values per screen. It uses system components and styles first: standard SwiftUI controls, `NavigationStack`, sheets with detents, Liquid Glass materials and system glass button styles, SF Symbols, Dynamic Type, system colours and semantic tokens, and system pickers and permission flows such as the ReplayKit broadcast picker and AVFoundation capture. Scrolling uses the system behaviour: native `ScrollView` and `List`, momentum and rubber-band bounce, overlay indicators, iOS 26 scroll edge effects under glass bars, interactive keyboard dismissal, and system scroll position and pull to refresh, with no custom scroll implementations or fake scrollbars. Anything custom goes through one shared design-token and component layer (colours, spacing, radii, typography, glass modifiers, button styles, icons), with no per-screen hardcoded values or one-off styling. Each custom component needs a stated reason why no system one fits. The concept board is a visual reference only, not a source of literal values, and its scrolling is only an approximation. | Dan: it is key that everything built follows the iOS standard way as much as possible and does not hardcode values each time something is built; the same goes for scrolling. System components give appearance, accessibility, reduced motion, and reduced transparency behavior for free, and a shared layer keeps custom work consistent. See `docs/ios/build-plan.md` (Native iOS standards). | Confirmed by Dan |
| 2026-10-30 | Jarvis is one unified backend and middle layer with several frontends: the web app and the iPhone app now, CarPlay and Watch later. The iPhone app reuses the methods the web app already uses against the backend (same routes, streams, tools, and artifacts); there are no iOS-specific backend paths. An iPhone screen that needs something the web app does not already use is raised as an explicit decision before the backend changes. Anything an iPhone design needs that the backend does not already provide is flagged to Dan, who decides whether that backend build starts then. | One backend keeps behavior, permissions, and tests in one place, and keeps every frontend consistent. Backend work for a single frontend starts only on the owner's decision. See `docs/ios/build-plan.md` and `iOS app.md`. | Confirmed by Dan |
| 2026-10-17 | P10-10 (#909): Jarvis never sends Teams messages, cards, notifications, replies, or audio-card notes from any code path or configuration. Remove the bot, sender, card/audio implementation, runtime wiring, and Teams-specific configuration. Away does not change confirmation routing: staged-action and phone approvals wait in the same authenticated browser app as Present; phone call/media code remains. Task status stays in the app and active browser voice updates remain. | The former away confirmation, general notification, voice-note, Teams bot reply, and away task-status paths all reached the removed sender. Browser approvals and Now-only notification delivery continue through `OwnerInteractionService`; existing conversation/confirmation database tables and stored rows are retained without a migration. Regression coverage checks Away approvals, task PR-opened/Done/NeedsAttention/Cancelled events, ignored Teams environment variables, and phone configuration independent of Teams messaging. | Implemented offline; live deployment behavior remains unverified |
| 2026-10-13 | P9-100 extends the hosted-chat smoke role into seven named acceptance checks; the catalogue happened to contain 128 tools at that implementation snapshot. | Reuse existing tools through smoke-only `get_system_health` operations; allow only fixed issue-700 read, bounded job counts, and a Settings navigation refusal. Keep the confirmation scenario in-memory and no-op until an exact later `yes`; persist no chat or tool audit. One 55-second deadline, two model rounds, one tool call and 256 output tokens per round bound runtime and usage. At 10,000 input tokens per round and published GPT-5.6-Luna rates, the conservative list-price estimate is $0.03692; other unpriced deployments remain unverified. No migration, new tool, web change, or root schema combinator (L120/L121). | Implemented with offline tests; deployed model behavior and actual usage require post-deploy confirmation |
| 2026-10-13 | P9-92 uses the existing hosted-chat invocation path for one backend-identity canary turn, with user history/context, persistence, and model tool execution disabled; catalogue validation remains enabled and usage is labelled `smoke`. | The smoke flag accepts only the fixed canary message. Migration 0045 extends `CK_usage_role`; the paired down batch refuses rollback while smoke usage rows remain so usage attribution is not rewritten or deleted. No tool schema, web surface, or deploy workflow changes. | Implemented and tested offline; deployed hosted-agent/model acceptance remains pending |
| 2026-10-12 | P9-84 reuses Foundry hosted chat sessions with a deterministic UUIDv5 derived from authenticated owner + Jarvis conversation session, query-only affinity, and one content-free no-affinity retry for HTTP 4xx. Set the deploy-time idle timeout to 3600 seconds; continue loading verified backend history on every invocation. Preserve Dan's selected chat model and reasoning effort. | The issue's 5–10 s first-delta model interval and ~15,000-character prompt do not reveal a time split between prompt processing and reasoning; provider timings report only the aggregate. Fixed-name, bounded `chat.agent_session` and `chat.latency` events provide the next production evidence. No capability instruction or tool schema is changed; a future prompt experiment may remove only proven duplicate prose, preserving capabilities and L120/L121. | Implemented and tested offline; Foundry cold/warm behavior and latency improvement require coordinator verification after deploy |
| 2026-10-11 | P9-64 (#641) handles the shared `workspace_command` operation `session` in the web UI: `language` (da/en), `voice` (end) and `camera` (front/rear/off). The shared contract gains only the additive `session` operation, `action` values and `value` field, matching the reviewed #667 specification, so this UI ships before that backend PR. Commands never prompt: the camera starts only when `navigator.permissions` already reports `granted` (otherwise refused with a reason), and facing reuses the one camera capture (`selectFacing`, which backs the existing front/back switch). The acknowledgement waits for the actual action (stream restart, voice stopped within 5 s); failures carry a bounded refusal reason. | Language and voice owners register narrow handlers in `session-commands.ts`; the camera comes from the existing shell capture state. No new controls, windows or second capture system. Unit, panel and capture tests cover each action, unknown values and each permission state. | Implemented offline; desktop/phone browser and live backend acceptance pending #667 |
| 2026-10-10 | P9-73 uses one additive phone dock gap above the safe area, enables edge-to-edge viewports and adds a minimal standalone manifest reusing the app icon. | `max(gap, inset)` leaves no gap above a nonzero inset. Chromium/WebKit fixtures measured 16px with zero inset and 50px with 34px inset; desktop geometry is unchanged. Root ownership lets body-portalled toasts share the phone token. | Implemented and browser-checked with fixtures; physical iPhone and installed Home Screen acceptance remain unverified |
| 2026-10-10 | P9-49 adds owner-only REST access to list, read, create and edit Markdown notes in the private GitHub vault. Creates refuse existing paths; edits compare the loaded Contents SHA and return 409 with the latest note when stale instead of retrying or overwriting. | Reuse the vault's routing, path, 256 KiB and secret-safety checks, but do not require a stored chat message for the owner's direct edit. Commit to `master`, log only outcome/folder, and synchronize the derived index after writes. No migration or web change; the Notes UI is separate. | Implemented and tested offline; live GitHub access and Notes UI acceptance remain pending |
| 2026-10-10 | P9-50 reconciles issue, task, PR and merge-commit deployment through a read-only Factory tool. Require closed issue, merged PR and matching successful deployment for “delivered”; preserve partial results and warnings on failed reads. Recover/resume of closed, merged or superseded legacy work requires `confirm: true` on the Dan-only controls route. | Issue #627 records duplicate recovery caused by an unlinked legacy task. Reuse task/release stores, existing GitHub readers and permissions; do not silently link legacy matches, infer delivery from an unrelated SHA, or allow the resume tool to bypass the gate. No migration or web change. Focused tests cover explicit body supersession, ambiguous queries, partial failures, qualified closing references and exact-SHA deployment; unverifiable restart safety returns 503. | Implemented offline; live acceptance pending |
| 2026-10-10 | P9-51 treats completed-turn delivery as known runtime state, not runtime unavailability. Cancel/pause recheck state and pending merges under the existing policy lock; never cancel a completed invocation. Derive finishing activity from persisted turns and relay safe control reasons to HTTP and tools. | Issue #628 reproduces a Running task after its turn/session finished. Preserve the pending-merge guard and terminal states, retain pause's idle session, refuse pause with finishing 409 when no resumable session remains, and distinguish invocation failure from cleanup failure. Reuse P9-50 readers and existing contracts; no migration, App permission or web change. | Implemented offline; live SQL/Foundry acceptance pending |
| 2026-10-10 | Windows open on their own only in voice; typed chat answers inline and opens a window only when Dan asks. Dan's rule, applied to every tool through one parameter on `startWorkPresentation` (`chat` presents nothing, `voice` presents as before), not per-tool exceptions. | The Calendar window showed escaped JSON (`&quot;`) beside a chat answer that already read well: the backend HTML-escaped plain text that the renderer escapes again. Chat already has the tool chip and the written answer; voice has no visible answer. Plain text is no longer escaped and calendar results render as an agenda. An explicit "show me" still uses the view tools; the capability instructions say so. | Implemented; verified by backend tests, live check pending |
| 2026-10-10 | `gpt-6-astra` and `gpt-6.1-sol` are deployed in Foundry (Global Standard, capacity 50, also in `infra/main.bicep`) so they appear in the Chat and Research pickers, and the Codex list is replaced by Codex's own current catalogue (`gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol/terra/luna`, plus `default`). Defaults and Dan's saved choices are unchanged; he picks per role. | Dan: luna for every role is not good; wants Astra and GPT-6.1 for research and voice, and the Codex models were old. Chat and Research options come from live Foundry deployments, so deploying is the change; the Codex list was hard-coded (`gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`). English speech-to-speech stays on `gpt-realtime-2.1`, the newest realtime model; the Danish voice answers through the Chat model. Codex reasoning efforts stay at the shared enum (up to `xhigh`); Codex also offers `max` and `ultra`, not exposed yet. | Deployed and Succeeded; live chat with each model not verified from here |
| 2026-10-10 | Decisions are scored by a selectable provider: Jev (default) or Microsoft-Decision-1, chosen by the `decisions.provider` setting for reflex, browser, recipe and PC decisions together. Dan can switch in Settings or by asking Jarvis; nothing switches provider automatically. | Dan wants to test Microsoft's new decision model against Jev himself. The two accept the same request (`model`, `state`, typed questions), so one target resolver replaces the fixed Jev key. Microsoft's speed and accuracy figures are vendor-run and disputed, our measured Jev time is about 274 ms (voice) and 398 ms (chat) p50, and the confidence thresholds are tuned for Jev, so the setting defaults to Jev and the providers are compared on our own `reflex.decision` logs (now with `provider`). Deployment `decision-1` (name cannot contain "microsoft"; quota 60 requests a minute) is in Bicep; Foundry host for the route is tried in two forms until one answers. | Implemented; live check on both providers pending |
| 2026-10-12 | Image budget admission no longer requires a published price for the chat model. | Dan's live camera turns on 12 October all fell back to the caption path (`budget_unavailable`): `reserveImage` refused any model missing from the pricing table and `gpt-6.1-sol` is not in it, so the direct-image path could never run. An unpriced model is now admitted on the same conservative unverified 0.1 DKK hold; a known price above the hold is still refused and only a known cost replaces the hold. | Implemented; live image acceptance still unverified |
| 2026-10-12 | User-directed: every tool confirmation (Google calendar/mail, issue creation, project archive, public screenshot) completes on a plain approval such as yes, approved, confirmed, go ahead (Danish equivalents too). No exact phrases or codes are spoken or typed. Safeguards stay: only Dan, only a later message, whole-message match (a reply that asks for anything else is not approval), 10-minute expiry, and only the latest pending action per scope can be approved. | Dan was on the move and Jarvis demanded 'confirm 74483420' by voice; this was a generic backend problem, not a Google one (closes the intent of #601, also relevant to #725). | Partly superseded by P11-10 (17 October 2026): the whole-message match gives way to the server-side meaning step; every other safeguard stands |
| 2026-10-12 (superseded by #1204) | The backend tool catalogue was capped at 128 tools and reserved eight slots, alongside 4,000-character descriptions and a 1 MiB serialized catalogue. | #737 added about 25 GitHub tools and pushed the catalogue past the then-enforced application count gate, so the agent rejected the catalogue and chat turns failed (reverted in #744). This did not verify a provider/API maximum. The description and byte bounds remain; the global count and reserve do not. | Historical; count policy superseded |
| 2026-10-13 | The production database relies on Azure point-in-time restore (about seven days, locally redundant backup storage). A restore to a temporary copy was drilled and verified (P6-04, #65): 67 of 67 tables, counts match except rows written after the restore point; documented in docs/runbook.md. No long-term retention or geo-redundant backup is configured, which is an accepted risk for now and a candidate for Dan to revisit. | #65 was closed on 3 October with no drill performed; the drill was run for real on 13 October and the gap is now documented. | Active |
| 2026-10-08 | P9-33 exposes explicit vault-note deletion through the shared sensitive tool registry. Reuse the GitHub App Contents-write client and require a present-mode Now confirmation naming the exact path; recheck the note SHA after approval, then remove its index rows and invalidate the graph cache. | Existing Contents API SHA protection, `OwnerInteractionService.runConfirmed`, and `VaultIndexStore.deleteFiles` cover the provider, approval and cleanup boundaries. No migration or web change is needed; focused fake-GitHub tests cover approval gating, concurrent edits, commit metadata, index removal and graph invalidation. | Implemented offline; live GitHub App access remains unverified |
| 2026-10-08 | P9-31 adds `get_usage` through the existing agent-only tool registry and usage store. Reuse the shared usage period/entry contracts, support the current UTC day, and group spend by role/source and model without hiding estimated or unverified costs. Redact the financial result from durable generic tool-call audit records; add no migration or web changes. | `UsageStore.list` already bounds and groups persisted usage, including active sandbox estimates and cost coverage. Backend tests cover today’s UTC interval, per-area/model aggregation, cost status, tool registration and sensitive audit redaction. | Implemented offline; live provider billing remains unverified |
| 2026-10-07 | P9-22 exposes owner-authenticated `/phone/status` and a 20-call history through the existing shared contracts and `phone_sessions` table. Keep phone calling dormant unless Dan provisions Teams/ACS and a Teams Phone number; status configuration is not a provider health check. Do not return caller or call IDs, and do not add a migration or web changes. | P6-22 keeps Teams unprovisioned in production; P7-01 records that no phone number was purchased. Backend tests cover owner auth, unavailable history, sanitized failure, bounded history and status mapping. No Azure CLI/live Azure access was available, so current number, ACS resource and callback delivery remain unverified. | Implemented offline; production setup and live callbacks unverified |
| 2026-10-07 | P9-18 puts `/now/events` event names and payloads plus task-event stream messages in `@jarvis/contracts`, with strict type guards. Route both streams through one typed backend SSE formatter while preserving authentication, replay IDs, heartbeat behavior, and `sseHeaders`; do not add a migration or change the web client. | Existing shared activity, background-job, workspace-command, and task-store contracts supply the payload types. Contract tests cover all Now event names and task-event shapes, and backend tests cover frame formatting and existing stream behavior. | Implemented offline; UI parser migration remains separate |
| 2026-10-07 | P9-29 reuses the existing Jarvis tool registry, task/release stores and contracts for retry and release lookup. Deployment status comes from the latest default-branch `deploy*.yml`/`deploy*.yaml` Actions run using a repository-scoped `actions:read` App token; do not add persistence or web UI. | Issue #523's gap audit requests backend-only tools. Existing retry lifecycle checks and webhook-backed release records remain authoritative; bounded fake-provider tests cover Actions run selection, input validation and sanitized failures. | Implemented offline; live GitHub access unverified |
| 2026-10-06 | P6-16 treats zero GitHub check runs and zero commit statuses as no CI only after two minutes from PR creation; recheck through the project-policy evaluator and record no-CI completion as task activity. Any present pending or failed check still blocks. | Reuse the persisted PR open time, current GitHub check APIs and existing policy flow without a migration. Focused tests cover empty checks after grace, checks appearing during grace, and failed checks. | Implemented offline; live test-repository acceptance pending |
| 2026-10-06 | P6-17 preserves background failure event names and exports only fixed error kinds and bounded HTTP statuses. Retain `ENTRA_JARVIS_AGENT_OBJECT_ID` in Bicep. | Callback errors now reach the logger without exporting messages or provider data; logging and monitor tests exercise the sanitized diagnostics. `apps/backend/src/auth/config.ts` still reads the agent object ID to authorize the hosted identity, so the setting is not unused. | Implemented offline; live failure identification awaits deployment |
| 2026-10-06 | P7-38 continuously watches only the screen/camera Dan independently shares and speaks only for useful observations. Reuse transient frame handling, the dedicated `gpt-6-luna` deployment, existing usage rows and the voice status announcer; default to a shared USD 1 UTC-day budget. Watch instructions/summaries remain session-local in memory, image text is untrusted, and no sensitive-content pause or web edit is added. | Dan's decisions and API contract in #440 supersede request-only inspection for the new watch path. SQL admission reserves a conservative pending cost to bound concurrent spend; unknown-cost failures keep it until UTC rollover. Fake model, route, store, logger and voice tests cover quiet/noteworthy frames, refusal, dedupe, and delivery; the existing on-demand route remains available. | Backend implemented offline; separate UI, live SQL/model/billing and useful-comment acceptance pending |
| 2026-10-06 | P7-39: Dan chose an offline wake word on his PC, exactly "Wake up Jarvis". Use the Microsoft Speech SDK on-device `KeywordRecognizer` with a Speech Studio basic custom keyword `.table` model, not a third-party engine. No audio leaves the PC before detection. The bridge sends `wake_word { at }`, and the backend publishes `voice.wake` on the activity hub as a separate `voice-wake` SSE event, leaving `apps/web` and existing activity semantics unchanged. The bridge pauses during voice sessions through backend `voice_state` messages, sent only to bridges that report `wakeWord: true`, so older bridges and backends stay compatible | Microsoft-first and privacy requirement from Dan. Fake-recognizer tests cover toggle, pause, one event per detection and the 3 s debounce; backend tests cover bridge-only acceptance, strict validation and publication | Implemented offline; keyword model and live acceptance pending |
| 2026-10-06 | P6-15 preserves credential status and dates on uncertain Codex renewal, retaining the lease until expiry; retry after 15 minutes with doubling backoff capped at one hour, resetting to daily after a known outcome. Export allowlisted renewal outcomes/error kinds/status codes and dispatcher start-failure reasons. | A timeout or unavailable invocation does not prove credential failure. Focused fake-client/timer and log-export tests cover preservation, retry timing and redaction. | Implemented offline; live Foundry/Azure acceptance remains unverified |
| 2026-10-06 | P5-13 keeps task/PR correctness while removing idle SQL polling: acknowledge signed unsupported/untracked webhooks without storing them; retain mapped tracked events in their existing serializable transaction; skip dispatcher reconciliation and event-archive checks with no tracked sandbox; cache unchanged away-mode state in the existing process-local store. Run one startup stale-task reconciliation and resume periodic checks when work is tracked. | Source audit found webhook delivery inserts for ignored events, five-minute empty stale-task scans, hourly empty archive scans, and Graph presence persistence attempts every minute. The backend is configured for one replica, and task/project mutations update the in-memory active-repository cache. Focused tests cover the no-SQL branches; production SQL idle duration and free-tier usage still require post-deploy measurement. Delaying archival while idle preserves rows and only postpones retention work. | Implemented offline; live Azure measurement pending |
| 2026-10-06 | Dan decided full PC access means opening any installed app by name and using Windows UI Automation on any foreground app. Keep websites on Chrome and never launch Edge; expose no raw shell/command tool. Ask for confirmation only for irreversible actions; never type passwords, payment-card numbers or one-time codes. Add fixed Windows media-key controls for play/pause, next/previous, volume up/down and mute. | Reuses the authenticated PC bridge and bounded command protocol. Offline tests cover Start-menu/UWP name matching, ambiguity/refusal, Edge exclusion, media-key mapping, all-app UIA validation, safe reflex targets and confirmation-free reversible settings; live Windows, voice, Jev and approval behavior remains unverified. | Implemented offline; live acceptance pending |
| 2026-10-06 | Dan approved model-written HTML/JS for generated research reports, executed only in a sandboxed iframe (`sandbox="allow-scripts"` with no same-origin, navigation, popup, form or network permissions). Load via `srcdoc` with restrictive CSP; validate the host bridge and accept only HTTPS `open_url`, bounded `ask`, `pin`/`unpin`, and bounded `resize`. Keep ordinary generated views declarative, artifacts owner-authorized and bounded, and report content untrusted. | Enables interactive reports without running generated code in the Jarvis page or exposing host credentials/DOM. P7-37 stores the report and requests the shared `html-app` view; P8-41 owns renderer/bridge integration and remains open, so browser acceptance is pending. | Decision confirmed; backend implemented offline; renderer integration pending P8-41 |
| 2026-10-06 | P7-36 uses transient screenshot fallback only when a fresh UI Automation snapshot has fewer than three actionable elements. Reuse the authenticated bridge and existing Foundry vision client; accept only bounded normalized candidate boxes, let Jev select the visual target, and permit coordinate click/scroll but no visual typing. Block capture while control is paused or a sensitive field is focused; require existing approval only for irreversible clicks. | Games and canvas-drawn apps may expose no useful UIA/DOM tree, but an image can contain private content. A one-use, 30-second capture reference and bounded foreground window are sufficient for fixed point input; image data stays transient and sensitive tool audit remains redacted. Fake capture/model, coordinate-boundary, pause and confirmation tests pass; real Windows/Foundry/Jev behavior remains unverified. | Implemented offline; live acceptance pending |
| 2026-10-06 | P7-34 adds bounded keyboard sequences and focused typing to the existing `pc_act` and `browser_do` paths. Accept at most four chords with Ctrl/Alt/Shift/Win and one named key or printable character; refuse Win+L, Ctrl+Alt+Delete, Alt+F4 without explicit close intent, and all keyboard input when a sensitive control is focused. Only irreversible keyboard actions require P7-03 approval. Jev receives closed-set Choice options, including common shortcut hints for recognized apps, while execution remains generic. | `SendInput` is contained in the authenticated Windows bridge and guarded by snapshot/foreground freshness and UI Automation sensitive-focus checks; Chrome uses only a fixed value-free focus probe. Fake-provider tests cover accepted/refused sequences and Jev mapping, and sensitive tool/step logs remain redacted. No Foundry computer-use, raw shell, or migration is introduced. Live Windows, Chrome, Jev and approval acceptance remain pending. | Implemented offline; live acceptance pending |
| 2026-10-05 | P7-15 image generation uses Dan's existing ChatGPT/Codex subscription through a new `codex-tool` mode on the Foundry hosted runner. Use the built-in `image_generation` feature; default to configurable `gpt-5.5`. Do not check out a repository, pass prompts as shell text, retain temp workspaces, use a paid image API, or fall back when Codex refuses. Validate a bounded PNG/JPEG, upload it to the existing private `artifacts` Blob container, persist only owner-scoped metadata and a safe artifact ID, and open it in the workspace and conversation. Keep the invocation bounded/cancellable, expose usage-limit errors, and show daily UTC tool-call counts. Video is deferred indefinitely to a separate issue; artifact retention remains unresolved. | Dan verified locally with codex-cli 0.157.1 on his ChatGPT login on 5 October; `gpt-6.1-sol` is not accepted with that login. Offline runner/backend/store/contracts/UI tests cover the implementation, but live Codex generation, subscription limits, Azure Blob upload, and deployed artifact rendering remain unverified. This reuses subscription entitlement without adding a pay-per-call service or monthly cap. | Implemented offline; live acceptance pending |
| 2026-10-05 | P7-27 keeps window control on the existing WorkspaceCommand broker. Publish only a bounded, owner/session-bound snapshot of open titles/IDs and context visibility; Jev chooses fixed reversible UI operations, including voice partials, without confirmation. Keep generated-view creation/update agent-only. Ignore delivery command IDs for semantic duplicate detection, cap task discovery at 150 ms when workspace targets are available, and allowlist one transcript-free `reflex.decision` event per attempted classification. | Window/layout control should not wait for the main model or SQL task discovery. Reusing the current controller, schema, acknowledgements and audit avoids another executor or persistence layer. Tests cover snapshot bounds/stale sessions, fixed targets, chat replay with a new delivery ID, partial-before-final workspace control, final duplicate suppression and log privacy. Context `open` without a view is idempotent and preserves existing content; agent-closed windows retain at most eight client-only entries for contradiction undo through `restore`. Manual close still discards generated content. Enlargement updates tiled spans as well as layered geometry. | Implemented offline; coordinator under-1.5-second chat acceptance pending |
| 2026-10-05 | P7-30 keeps cross-session history in numeric message order, adds only each prior Jarvis turn's bounded audited tool-name/outcome summary to its context, and puts reference JSON before conversation history. Record per-turn context count, included ID range, previous Jarvis inclusion, and character count without text. | The backend already returns the newest 100 messages across sessions in ascending ID order with tool-call outcomes; the agent had ignored these outcomes and inserted reference JSON between the latest exchange and the follow-up. Regression tests cover the Danish `pc_open` refusal followed by English “try again” in a new session, telemetry without content, and retry tool selection. The exact live sequence remains for coordinator acceptance with Dan. | Implemented offline; coordinator live acceptance pending |
| 2026-10-05 | Dan accepted the corrected centred 3D stage: live room and persistent transparent cyan orb/open amber core only on Jarvis; light appearance re-lights the same room. Shared glass styling extends to current pages without 3D. Preserve mirror, stable viewpoint, explicit voice/microphone rules and existing workspace logic. | Selected image 3 for orb/stage and image 2 for glass windows; corrected live prototype accepted in this chat. P8-30 traced the reported transition flicker to the document-wide View Transition snapshot and removed it; normal-rate hardware verification remains open. Source, immutable standalone and labelled captures are in `docs/reference/ui-stage-prototype` and `docs/ui/centred-stage`. | Design confirmed; P8-28 (#375) and P8-31 (#376) merged; P8-29 implemented offline in PR #377; P8-30 direct-state fix in PR #386; P8-32/33 and live/device acceptance remain |
| 2026-10-05 | P7-01 uses ACS Call Automation with Teams Phone extensibility (preview), not the Foundry-managed telephony binding. Authenticate the Event Grid callback, validate Dan's Teams Entra object ID before answering, then create a backend-owned phone session; reject unknown callers without creating one. Relay ACS media to Voice Live and the hosted Jarvis agent, correlate tools through stored session state, and route phone-session personal-data/action approvals to P7-03 Teams cards. Do not accept caller phone number alone as Dan's identity. | Dan approved the alternative ACS design in PR #326. Microsoft documents the preview and service-number requirement ([Foundry telephony channels](https://learn.microsoft.com/azure/foundry/agents/how-to/voice-agent-telephony-channels), [Teams Phone extensibility](https://learn.microsoft.com/azure/communication-services/concepts/interop/tpe/teams-phone-extensibility-overview)). The approved caller check is now limited to exact allow-listed Teams Entra object IDs. The installed ACS SDK exposes bidirectional PCM/WebSocket envelopes, but the existing Voice Live relay uses a different protocol; an integrated media bridge, authenticated callback, tool-session policy and Bicep wiring are not implemented. Dan reports estimated Danish service-number costs of 15–20 DKK/month and ACS usage at 0.01–0.03 DKK/minute; these are estimates, not official quotes. No number was purchased and no live Azure/Teams test was possible. | Design accepted; implementation and live acceptance pending |
| 2026-10-05 | P7-24 keeps `mai-transcribe` as the Voice Live final-transcript model for English and Danish, and runs Azure Speech continuous recognition in parallel on microphone PCM from the same Foundry AIServices resource. Use `da-DK`/`en-GB`, fixed product phrases plus bounded running-project names, and the existing P7-20 safe stable-clause/ledger/undo rules; stop on mute, end or disconnect. No raw audio or interim text is persisted. The backend uses its Entra managed identity and an account-level `Cognitive Services User` role. | The 5 October live comparison below showed that Voice Live returned no partials with MAI and too-late partials with `gpt-4o-mini-transcribe`, while Azure Speech emitted usable Danish and English hypotheses during speech. Fake recognizer tests prove action-before-final, contradiction undo, failure fallback and mute stop. Local backend/web checks pass; live RBAC, speech delivery and Dan's PC timing remain unverified. Azure retail price API reference: $1.00 per audio hour for Speech-to-text S1; billed usage is not yet verified. | Implemented offline; coordinator live acceptance pending |
| 2026-10-05 | P8-25 keeps typing available during a chat turn but disables Send, language changes and voice entry; do not queue a next message. Clear only the submitted draft on acceptance, preserve later edits, and merge refreshed history by saved numeric ID. | A next draft must not be sent accidentally or removed by completion/interruption. A labelled, reduced-motion-safe thinking indicator covers the first-delta wait without implying a tool call or reducing backend latency. | Implemented offline; Chromium turn sequences verified in dark/light at desktop/phone widths; live Foundry unverified |
| 2026-10-05 | P7-23 starts the hosted chat agent before Jev reflex work; run reflex target discovery and classification concurrently with an 800 ms classification budget, discarding late results. Keep the existing reflex safety/confirmation rules, tool-call audit and activity events; reuse an identical same-turn reflex result instead of executing duplicate tool arguments. Retain its bounded result in process memory for at most 120 seconds so the agent can answer read-only reflexes with their actual data; never log or persist it. Keep the existing 60-second tool catalogue cache; fetch it alongside live task context and validate `/me` alongside stored history. Record only stage durations/outcomes in backend logs and agent spans. | Issue #327 baseline (Application Insights/backend logs, 09:03–09:06 UTC): backend turns 11.0, 11.7, 11.9 and 16.8 s; hosted agent invocations 3.1, 4.8 and 5.4 s; model calls 0.35, 0.79 and 1.36 s. Focused offline tests cover a reflex over budget, failure, action plus reply, cancellation, duplicate prevention, and concurrent agent setup. No post-change deployed measurements are available because this environment has no Azure access; the ≤2.5 s first-token / ≤4 s short-reply target remains for post-deployment verification. | Implemented offline; live latency acceptance pending |
| 2026-10-05 | P7-20 streams English and Danish Voice Live partial transcriptions to the backend relay. Jev receives stable clauses and the per-turn execution ledger; only complete, high-confidence, reversible safe actions may run on partials. Final transcripts update any early source message, reconcile contradictory actions with supported undo, and hand truthful results to Jarvis. | The relay tests use timed fake deltas and a fake Jev client to prove action-before-final, duplicate suppression, confirmation gating, contradiction undo, message replacement and latency recording. Metrics are allowlisted without transcript content. Live Voice Live event delivery, Jev network latency, and physical audio timing remain unverified. | Implemented offline; live verification pending |
| 2026-10-05 | P8-23 applies the existing Concept B/C aurora and orb to voice mode: show only workspace windows, keep Arrange in each window's overflow, present actual runtime/audio state with one quiet detail line, and group named voice actions beneath the orb. Reuse the composer-orb/workspace transition and leave P8-16 event plumbing unchanged. | The treatment extends P8-20 tokens and P8-22 chrome without changing voice behavior or inventing tool activity. Focused web tests and Chromium verify atomic status details, the ready-state phone dock, both Escape steps, End voice, responsive bounds, hidden-tab pause and reduced motion. Screenshots are labelled local fixtures, not live voice or tool-event evidence. | Implemented offline; draft PR review pending |
| 2026-10-05 | P8-31 applies the accepted smoky glass to the existing shell, conversation composer, temporary workspace, contextual panel, Factory and Settings through the existing semantic tokens. Use sans headings, keep current page content and controls, and do not add the 3D room outside Jarvis or copy the reference's illustrative data. | The light/dark glass tokens live in `apps/web/src/styles.css`; tests calculate primary text, muted-text, current-color icon and focus contrast on both glass surfaces over black/white backdrops. Follow-up review found the earlier dark captures were taken before the 420ms appearance transition settled, so dark captures and computed-style evidence were regenerated after the actual dark colors appeared. Conversation Markdown now uses the primary text role, and the light muted-text token meets AA on the glass surface. The integrated foreground was visually checked over the stage in P8-29; see its evidence for limits. | Merged in #376; live/device verification remains pending |
| 2026-10-05 | P8-32 reuses the existing persisted `light`/`dark`/`system` preference and approved token allowlist. System mode follows OS changes, and the same mounted Jarvis room reads semantic CSS stage roles for its materials, lighting, exposure and atmosphere. Keep the empty prompt on smoky light glass in the app sans font, clear of the orb; supporting explanation stays body text. | The existing settings API remains the persistence boundary; no new setting, provider call or executable theme tool is added. Web regressions cover pending/rejected saves, token validation, OS-following system persistence and scene activity/audio continuity. Scratch-fixture Chromium confirms same-canvas system switching and records reduced-motion light desktop/phone captures under `docs/ui/screenshots/p8-32-*`. The captures are local-render evidence only; live settings, hardware GPU, physical devices, Safari and P8-30 flicker remain unverified. | Merged in PR #387; live settings/device acceptance remains unverified |
| 2026-10-05 | P8-29 keeps the accepted orb mounted through typing, voice entry, playback and voice exit. Drive awake appearance only from existing authenticated runtime activity, explicit voice state and decoded response-playback PCM; keep visual dormancy independent from backend sleep/readiness, and start microphone capture only after explicit user enablement. Do not add demo selectors or infer activity from local submits. | Reuses the existing Now SSE, `useJarvisActivity` and decoded `BrowserVoiceClient` audio-level callback without another backend contract or DOM wrapper. Focused tests cover scene persistence, activity/audio forwarding and microphone rules. Scratch-fixture Chromium verified desktop/phone dark/light, connecting/ready/audio response, a schema-valid activity event, reduced motion, no phone overflow and no browser/shader errors after the shader fix. Fixture data is not live delivery; actual audio devices, live Entra/Foundry, hardware GPU, physical phone and P8-30 flicker acceptance remain unverified. | Implemented offline in PR #377; live acceptance pending |
| 2026-10-05 | P8-30 keeps voice entry/exit on the mounted scene: update the existing voice state directly rather than starting a document-wide View Transition, preserve the current-state orb spring and temporary workspace controls, and never introduce a backend window store. | Baseline Chromium showed `document.startViewTransition` wrapping the full Jarvis page, including the live WebGL stage/mirror; `ready` took about 348 ms and `finished` about 1.2 s. This full-document snapshot is the identified flicker mechanism, though no distinct mirror flash was independently isolated. A workspace FLIP overlay remained pending in the integrated browser and held a stale transform, so it was removed rather than risking a stuck intermediate state. Scratch fixtures covered 73 desktop and 32 phone CDP frames at 390×844 across empty/windows/minimised, natural/manual/failure exits, reversal, reduced motion, draft/focus and truthful workspace acknowledgements; the same canvas remained mounted and only orb placement/scale changed with content. The integrated SwiftShader page produced about two animation frames per 500 ms, so these traces do not establish smooth normal-rate or hardware no-flicker acceptance; live voice/audio and physical-device behavior remain unverified. | Implemented offline in PR #386; normal-hardware flicker acceptance pending |
| 2026-10-05 | P8-15 delivers one validated `workspace_command` tool through the existing Jarvis-only authenticated tool registry and the signed-in `/now/events` stream. Keep its queue, command-id deduplication and acknowledgements in process memory; require the owning session's authenticated client to acknowledge after applying or refusing each command. | Reuses the existing authenticated event path and the P8-06/07 `WorkspaceCommandContext`, while keeping generated views/layout transient and avoiding generated code execution. Contract, broker, route, SSE, renderer and workspace tests cover malformed commands, bounds, duplicate IDs, unavailable/stale clients, cancellation, timeout and local application. Live Entra/Foundry delivery remains unverified. | Implemented offline; live acceptance pending |
| 2026-10-05 | P7-12: speak only fixed status phrases for committed task completion/attention events, signed GitHub ready-for-review and failed-deployment events; merge repeated kinds over 500 ms and wait for Dan, Jarvis and tools to be idle. Retry a queued update when Dan stops speaking. Register `get_status_summary` as an authenticated backend tool returning bounded Now-feed counts only and applying Away-mode visibility. | Task event publication follows SQL commit. GitHub status kinds are published only after signed delivery persistence and existing mapping processing; duplicate deliveries do not create duplicate status events. Fake event-hub, webhook, tool-route and relay tests cover event selection, safe wording, deferral and counts. No new service, schema or dependency is required. | Implemented offline; live voice acceptance pending |
| 2026-10-04 | P7-13 originally stored source-linked preferences, project facts, decisions and unfinished tasks in Azure SQL with vector/full-text/substring search and inspect/correct/forget tools. | Dan's 6 October P7-40 decision supersedes SQL as the knowledge source and standalone capture path. Existing tables remain for compatibility and are not deleted; current captures and searches use the GitHub vault and its derived SQL index. | Superseded by P7-40 |
| 2026-10-05 | P7-14 uses the existing Foundry hosted runner and Dan's ChatGPT/Codex subscription for live web research; do not use Bing grounding or a pay-per-call API. Add `codex-tool`/`web_research` with a configurable ChatGPT-supported model (`gpt-5.5` default), `web_search=live`, a temporary workspace with no repository, bounded calls/cancellation, and an explicit usage-limit refusal. Disable Codex's `shell_tool`; read-only sandboxing alone permits credential-file reads. Treat query/page text as untrusted, cite only returned HTTPS URLs, report empty/limited results, and return typed source metadata (backend receipt time). Count calls from existing `tool_calls` and show the daily UTC count in Usage; no new schema or provider resource. | Dan's 5 October decision supersedes the earlier Bing scope. The pinned Codex CLI supports `--disable shell_tool`, protecting the file-backed login from prompt-injected page text; fake tests cover the runner, backend, contract, timeout, partial results and cancellation. No query/result content is retained in the generic audit. The live Codex login, search and Azure invocation were not exercised. | Implemented offline; coordinator live acceptance pending |
| 2026-10-04 | Add long-term knowledge, source-linked web research, image/video generation and editable personality to the plan | Dan explicitly selected these four capabilities from the supplied transcript. P7-14–P7-16 cover capabilities; P8-19 implements the Personality settings UI. P7-13 initially resolved storage, capture and retention in issue #263; the 6 October P7-40 decision later made the GitHub vault authoritative and SQL a derived index/cache. | Accepted scope; P7-40 supersedes P7-13's standalone capture path |
| 2026-10-04 | P7-03 phone notifications and approvals through a Dan-restricted Teams bot, with speech notes on F0 and fail-closed approvals | Personal-chat and confirmation state use P7-03's SQL migration; bounded audio is transient. Offline bot, persistence and project-policy tests pass; live bot registration and phone acceptance remain unverified. | Implemented offline; live verification pending |
| 2026-10-04 | Shared typing shell and fullscreen voice workspace; temporary dynamic windows with tabs; persisted theme values; orb driven by runtime state; optional minimise-on-voice toggle defaults off | Dan confirmed these behaviours in the UI design conversation and reviewed the static wireframes. See [ui.md](../ui.md) for details and unresolved styling/control choices. | Requirements confirmed; P8-04 shell, P8-10 desktop voice transitions, P8-11 phone view switching, and P8-13 theme controls implemented offline |
| 2026-10-05 | Implement P8-10 on the client without waiting for agent-delivered workspace commands or tool events: voice entry and exit use P5-04 runtime/workspace state; expose typed client workspace controls; consume P8-16's transient tool-call activity when available; persist the default-off minimise preference through P8-17 and mirror it locally for immediate shell reads | Coordinator decision on PR comment #5986233839. The original composer-orb shared transition was superseded by P8-29's persistent stage; P8-30 avoids a full-document snapshot and preserves immediate reduced-motion behavior. Voice shares the same mounted workspace controller used for signed-in agent commands. | Implemented offline; original visual transition superseded by P8-29/P8-30 |
| 2026-10-04 | P8-06 starts with tiled desktop views, offers layered overlap, raises the active layered view, and reflows to a single column at 900px and below; view/order/geometry state is memory-only | Tiling gives new views a predictable reading order while overlap remains available; the narrow layout keeps each view inside the viewport. Component tests and Chromium checks cover arrangement, pointer/keyboard controls, recovery states, and desktop/phone bounds. P8-14/P8-15 provide typed temporary data and Jarvis-directed controls. | Implemented offline |
| 2026-10-04 | P8-07 adds minimise/maximise/close title-bar actions, an animated active-workspace tab strip, and an in-memory `WorkspaceCommandContext`; arrangement controls stay behind Arrange disclosures | Minimising keeps view content mounted and does not persist or delete it. Tab restore returns focus to the view title; command dispatch is typed and idempotent for repeated minimise/restore. Nine component tests and Chromium checks at desktop/phone widths in both appearances cover lifecycle, focus, reduced motion, and bounds; screenshots use labelled local fixtures. P8-15 connects authenticated Jarvis delivery. | Implemented offline |
| 2026-10-05 | P8-11 uses one foreground view at 700px and below, with horizontal touch swipes, named keyboard controls and the existing focus/restore command; background views remain mounted, hidden and inert. Dock active voice only while non-minimised content remains, reserve content space above it, and return the orb to the centre otherwise. Move camera/sharing into a phone disclosure. | Builds on P8-10 and Concept B/C without a new command API, runtime integration or dependency. Swipe ignores controls, horizontal scrollers, vertical gestures and cancellation. Component regressions and touch-emulated Chromium at 390/320/280px in both appearances verify switching, retained state, focus, dock clearance, overflow and reduced motion. | Implemented offline; physical-phone and live P8-15 acceptance pending |
| 2026-10-04 | P7-05 inspects shared screens only on Dan's request, through authenticated backend `POST /screen/frames`; use the existing configured `gpt-5.6-luna` Foundry deployment and managed identity, inject only a bounded untrusted description into the active chat/voice response, and never retain/log frames. Enforce one inspection per session per three seconds and a configurable 300-frame/day default cap. Record frame/token usage and estimate DKK only for known Global Standard rates. | `gpt-realtime` does not accept images, so the backend vision bridge is required. This reuses the existing Foundry service and avoids putting provider credentials in the browser. The 2 October 2026 price snapshot lists short-context `gpt-5.6-luna` Global Standard rates of 1.3157 DKK/input million and 7.8941 DKK/output million; estimates are rounded to four decimals and labeled estimates. Focused offline tests and scratch Chromium checks at 390/1280 px pass; live model image support, deployment SKU, rates, real display capture and billed usage require coordinator access. | Implemented offline; live Foundry acceptance pending |
| 2026-10-04 | P7-08 enables the webcam only after Dan's top-bar action and permission, then sends one requested JPEG through P7-05's authenticated `POST /screen/frames`. Share the existing three-second session interval, daily cap, `screen_frames`/token/cost usage and Foundry model; stop camera tracks when voice/app session ends or after five minutes. | Reusing the bridge avoids another credential, route, provider call path, usage metric or migration. Fake camera/model tests cover transient request context and track cleanup; desktop/phone screenshots use Chromium's fake camera. Live hardware, deployed image support and billed cost remain for the coordinator. | Implemented offline; live camera/model acceptance pending |
| 2026-10-04 | P3-08: fetch the project commit graph from GitHub on demand with a repository-scoped `contents:read` token; keep webhook records in SQL and display them if the graph read fails | Avoids duplicating Git history, keeps credentials server-side, bounds branch/commit work and preserves useful persisted state during GitHub outages. Focused backend/UI tests and Chromium checks at 390 and 1280 px pass with mocked GitHub/API data; live GitHub, Entra and Azure SQL behavior remains unverified. | Implemented offline |
| 2026-10-04 | Away mode activates by voice/chat or ten continuous minutes of Teams Away/Offline; explicit return commands and active, visible browser use switch it off. Route new approvals to Teams while away and the authenticated Now panel while present; passive feed reads do not change presence. | Dan confirmed the trigger and return behavior in issue #200. Backend state and approval IDs use existing SQL tables; the browser queue is bounded and in-memory, each decision remains owner-authenticated, single-use and expiring. Offline backend/web tests cover both routes; Graph consent and live Teams delivery remain unverified. | Implemented offline |
| 2026-10-04 | P8-17 stores approved appearance tokens and the default-off minimise-on-voice preference as validated global scalar settings; `set_theme` writes through the same settings store | Existing settings rows and transactional partial writes avoid a migration; optional tokens are included in the SQL read whitelist, and API/tool tests cover allowlists and truthful refusal/error outcomes. Generated views and window arrangement remain temporary. Database CI passed the SQL Server integration suite; P8-13's live application of tool results remains unverified. | Implemented offline and SQL Server CI-tested; client integration pending |
| 2026-10-01 | Coding sandbox: Foundry Hosted Agents, one session per task; Container Apps Jobs as fallback behind the same runner contract | Proof of concept: all nine checks passed for Copilot and Codex ([report](reference/coding-sandbox-prototype/REPORT.md)) | Proven |
| 2026-10-01 | ACP for both agents: Copilot CLI `--acp`, Codex via `codex-acp`; Python adapter in the sandbox image | Steer, pause, and resume proven over ACP; Foundry hosted agents support only Python or C# | Proven |
| 2026-10-02 | Codex uses a Jarvis-only ChatGPT Pro login, renewed by Jarvis; no API key | Renewal proven through Codex's own client; Dan's own login untouched (L6, L12) | Proven |
| 2026-10-02 | Danish voice: Voice Live voice bridge with MAI Transcribe and `gpt-5.6-luna` | V1–V7 passed; Azure Speech `da-DK` misheard English names (L15) ([voice report](reference/voice-prototype/REPORT.md)) | Proven; Dan's live test (V8) pending |
| 2026-10-02 | Voices: English Ryan HD (`en-GB-Ryan:DragonHDLatestNeural`) with a British butler persona; Danish Harper (MAI-Voice-2, `da-DK`); language toggle in the UI | Chosen by Dan from samples; MAI-Voice-2 has no British or Danish voices, and its American male voices were rejected | Confirmed |
| 2026-10-02 | English voice runs as `gpt-realtime-2.1` speech to speech; warm-up before the microphone opens and automatic reconnect | Faster first audio; warm-up and reconnect prevent the bridge drop (L21) | Decided |
| 2026-10-03 | The backend owns the English realtime session: pin `gpt-realtime-2.1`, Ryan HD and the British butler instructions; expose registered tools to the model and execute calls only in the backend | Browser-supplied session overrides or tool outputs could bypass the chosen persona or falsely claim an action. Offline mock tests verify schema validation, backend execution and the P4-05 result/confirmation contract; P0-16 Azure setup and P5-04 browser audio remain unverified. Voice history is left to P4-03/P5-06. | Implemented offline; live verification pending |
| 2026-10-02 | Build and release run in GitHub Actions; the sandbox runs targeted builds and tests only; failed checks steer the same task with the failing log | Disk, not CPU or memory, limits sandbox builds (L23); matches Dan's normal workflow | Confirmed |
| 2026-10-02 | Sandbox crash recovery: detect by HTTP 424/404/5xx; restart from the task branch; the agent pushes often; never trust `completed` without GitHub evidence | Restart test lost files and conversation (L22) | Decided |
| 2026-10-04 | P2-10 recovery starts a new leased sandbox session from the task branch with the original request, saved steering and bounded event summary; provider completion marks Done only after GitHub confirms both branch and PR | The forced-crash fake test exercises recovery; the GitHub verifier fails closed when either record is missing. A separate atomic recovery operation preserves existing task-store contracts. SQL Server/live GitHub/Foundry acceptance remains unverified; P2-13 (#195) supplies the required repository/default/task branch checkout contract. | Implemented offline |
| 2026-10-03 | The backend heartbeats registered Foundry invocations immediately and about once a minute; persist `last_heartbeat_at`; after a qualifying HTTP error, confirm with another poll after 30 seconds. Keep active sessions in memory and reload them once at startup to avoid SQL reads while idle. | P2-06 tests recorded healthy and missing-invocation responses; the NeedsAttention transition is transactional. Live Foundry and Azure SQL verification remain open. | Implemented offline |
| 2026-10-04 | Report writable disk at task-turn start and check every 15 seconds; below the configurable 1 GiB default, stop the turn and atomically move the task to NeedsAttention with reason `disk_low`. Display recorded disk readings on task detail. | P6-07 uses fake-filesystem runner tests and the P2-03 runner event path; backend transition and detail rendering have offline coverage. Live Foundry measurement and SQL Server integration remain unverified. | Implemented offline |
| 2026-10-02 | Queue: the Azure SQL task table, with a backend dispatcher owning dispatch and retries | Cheapest option for one user; Service Bus and Durable Functions rejected | Decided |
| 2026-10-02 | Board updates with server-sent events over `fetch`; the runner pushes sandbox events; GitHub webhooks for build and release | No extra service; Web PubSub kept as an idea | Decided |
| 2026-10-02 | Backend on Container Apps, always on (minimum 1 replica, ≈30 DKK/month) with a sleep switch that sets minimum 0 and is refused while tasks run | Keeps the sandbox heartbeat running; a KEDA SQL scale rule would stop the database from pausing | Decided |
| 2026-10-02 | Settings page controls models and reasoning for Jarvis and the coding agents; changes apply to new sessions and tasks only | Nothing hard-coded; Dan wants to switch models | Confirmed |
| 2026-10-02 | Sign-in: Entra ID with Dan's Microsoft account only; no passwords in Jarvis | Single user; built-in Azure sign-in | Confirmed |
| 2026-10-02 | App structure: Jarvis is the app and main page; areas are modules with their own pages and Jarvis tools; one backend with a core and a module per area | Later areas (Banking, Health and fitness, Calendar) plug in without rework | Confirmed |
| 2026-10-02 | Data model v1: one continuous conversation split into sessions; every runner event stored; one release per merge to `main` (no tags); commits fetched from GitHub on demand; usage per task and project; no settings history | Sparring with Dan ([data model](data-model.md)) | Confirmed |
| 2026-10-03 | Keep one conversation across chat and voice sessions; expose stored history with an ID cursor, default 50 messages and maximum 100 per page | Existing group-one SQL tables support the lifecycle without another migration; bounded pages keep the main-page read finite while retaining the full message record | Implemented; disposable SQL Server integration-tested; Azure SQL writes remain unverified |
| 2026-10-03 | P3-01 prepares a private GitHub App manifest with contents and pull-request write, checks/Actions/deployments read, and `check_run`, `deployment_status`, `pull_request`, `push`, and `workflow_run` subscriptions. Dan's live setup is a separate P3-10 task | P3-02 needs repository writes; P3-03 needs only read access to checks, Actions, and deployments. The App private key belongs in Key Vault and is backend-only; selected-repository installation follows least privilege. See `docs/github-app-manifest.json` | Preparation complete; P3-10 is marked complete in `PLAN.md`; the P3-02 production token flow remains to verify; webhook URL waits for P3-03 |
| 2026-10-04 | P3-02: the backend mints one-hour GitHub App tokens scoped to an active task's repository, using `GITHUB_APP_ID` and the private key read from Key Vault with the backend managed identity. A runner-only route authenticates the runner identity and requires its Foundry session to match the active task before resolving the repository server-side; the Git credential helper requests tokens per Git credential lookup and refuses host/path mismatches. App-token mode is an explicit Runner deploy opt-in, default off | Keeps the signing key outside the sandbox, binds issuance to the requesting sandbox session, and preserves `jarvis-github` until the post-merge live push check. The runner retries only a 404 session lookup with bounded delays to cover backend persistence ordering. No schema change is needed. Issuer, route, runner, and deployment contracts are covered offline; production Key Vault access, GitHub issuance, and sandbox push remain unverified | Implemented offline; live check and legacy credential cleanup follow after merge |
| 2026-10-03 | Stack: monorepo layout, Fastify, `mssql` with a migration runner, Bicep, MSAL flow, Vitest/pytest/Playwright, SQL free offer | Accepted by Dan; Fastify for schema validation, a plugin per area, and SSE | Decided |
| 2026-10-03 | Project knowledge moved into the scaffold documents; prototype Azure resources and test repository deleted; prototype code and reports kept in [reference/](reference/) | One source of truth; no running prototype cost | Done |
| 2026-10-03 | One production environment; the local web app (`npm run dev`, `http://localhost:5173`) uses the production backend | Single user; no cost or upkeep for a second environment | Confirmed |
| 2026-10-03 | Migrations run in the backend at startup under a SQL app lock; CI tests the database against SQL Server in a container | GitHub runners can't reach Azure SQL without opening its firewall | Decided |
| 2026-10-03 | Static Web App resource in West Europe | No Static Web Apps region in Sweden or Denmark (checked with `az`); files are served globally | Decided |
| 2026-10-03 | The dispatcher sends no SQL queries while there is no work | Otherwise the free-offer database never pauses | Decided |
| 2026-10-03 | Browser Voice Live traffic uses an authenticated backend WebSocket relay; provider credentials stay server-side | Offline backend tests verify authentication, credential separation, and bidirectional forwarding against a local mock upstream. Production provider/endpoint wiring, browser audio, and real Azure Voice Live interoperability remain unverified. | Chosen; mock-tested |
| 2026-10-04 | Browser voice uses Web Audio to capture and play mono 24 kHz PCM; wait for session readiness and Danish `/diag` warm-up before opening the microphone; stop playback on speech start and reconnect after relay closure | Focused web tests verify warm-up ordering, interruption, reconnect, and next-session language selection. The language API stays separate from the P5-05 toggle/settings UI. Real microphone, speaker, and Azure interoperability were not available for this offline check. | Implemented offline; live verification pending |
| 2026-10-03 | Bootstrap script `infra/bootstrap.ps1` creates the deploy identity, sign-in apps, backend identity, SQL admin group, and repository; run and verified the same day | The deploy workflows can't create their own identity or Entra objects | Done |
| 2026-10-03 | Required checks on `main` need GitHub Pro (Dan's account is on Free); until then Jarvis merges only when checks pass | GitHub Free has no branch protection on private repositories | Pending Dan's choice of GitHub Pro |
| 2026-10-03 | Remote-only development: agents work in Copilot cloud agent or Codex cloud and deliver through PRs; local work needs Dan's permission; GitHub `main` is the only source of truth | Any agent can continue from the repository alone; both cloud agents work on Dan's personal repository and push only to their own branches | Confirmed |
| 2026-10-03 | One GitHub issue per plan task; worker labels `Codex`, `Copilot`, `Dan`, and `Jarvis` identify the worker, and `.github/workflows/plan-status.yml` reconciles Issue links and Status from issues, worker labels, and PRs, creates issues for new plan rows, and links dependencies | Assignees no longer identify the worker because Codex previously claimed with Dan's token. Cloud agents can't push to `main`; the workflow uses a serialized `GITHUB_TOKEN` run, commits only Issue and Status cells, and rebases/retries once after a rejected push. Offline fixtures pass; live writes and protected-branch behavior await a post-merge dispatch | Implemented; live verification pending |
| 2026-10-03 | P2-09: prepend every coding-agent prompt, including resumed and recovered turns, with instructions to commit and push small work-in-progress changes to the existing task branch after each meaningful step; never force-push or push to `main` | Offline runner tests cover new, resumed, and recovered prompts. A deployed test task is needed to prove intermediate commits; P2-07 now owns that end-to-end acceptance | Implemented; live acceptance pending P2-07 |
| 2026-10-04 | Runner events use a separate `Jarvis.Runner.Events` app role and a runner-only `POST /factory/sandbox-events`; task IDs travel with Foundry invocations and events flow through P1-05 `recordEvent` | Keeps runner authorization distinct from Jarvis tools and preserves transactional activity/hub publication without a schema change. Offline signed-token, route, invocation, and runner transport tests pass; Azure role assignment and live delivery remain unverified | Implemented offline; live identity setup and delivery pending |
| 2026-10-03 | PRs merge automatically, without approval, when checks pass against the latest `main`; while `main` is red only `fix-main:` PRs merge; one PR per task overrides the template's "no PR required" | Dan doesn't want to approve PRs; agents must never start from a broken `main` | Confirmed |
| 2026-10-03 | Deploy on every change to `main`, only for the changed parts; documentation-only changes skip deploy; one deploy at a time; manual redeploy available. `docs:` PRs merge automatically like task PRs | Saves deploy time and cost; avoids overlapping deploys; documentation fixes need no task | Decided |
| 2026-10-03 | Agents claim their task's issue as their first action using its worker label (`Codex`, `Copilot`, `Dan`, or `Jarvis`); Codex uses an issues-only token `GH_TOKEN`; an open worker-labeled issue or open linked PR means In Progress | Dan starts tasks in the agents' own apps; assignees do not reliably identify the worker because Codex previously claimed with Dan's token | Confirmed |
| 2026-10-03 | P0-01 uses npm workspaces for `apps/web` and `apps/backend`, one root lockfile, and shared strict TypeScript settings. Pin Node.js 22.23.3, npm 10.9.9, TypeScript 7.0.2, and the Python 3.12.14 baseline | Fits the agreed monorepo without another build orchestrator. Empty app modules compile; React/Vite, Fastify, and Python runtime code remain in their later tasks. Reference prototypes stay read-only | Implemented and build-verified in Codex cloud |
| 2026-10-03 | Repository licence: MIT | Dan selected MIT while assigning P0-01; upstream reference notices remain intact | Confirmed |
| 2026-10-03 | P0-01 may use the existing `GH_TOKEN` to open its linked PR despite the issue-only usage rule | Dan explicitly authorized this task-specific exception; PR #78 creation succeeded. Other tasks retain the issue-claim restriction | Confirmed; PR creation verified |
| 2026-10-03 | Bicep resource names use `uniqueString(resourceGroup().id)` for globally unique resources and stable names within `rg-jarvis`; the budget and SQL database use fixed names | Avoids collisions without changing names on repeat deployments; those resources are scoped to this resource group or SQL server | Decided; first deployment pending P0-16 |
| 2026-10-03 | P0-04 monitoring, secrets, and storage SKUs: Log Analytics `PerGB2018` with 30-day retention, workspace-based Application Insights, Standard RBAC Key Vault, Standard_LRS Hot StorageV2 with private Blob containers, and Standard ACR with admin user disabled | Provides the selected services using standard tiers; LRS and hot tier minimize storage cost, and managed identity replaces shared access | Decided; first deployment pending P0-16 |
| 2026-10-03 | Azure SQL uses a General Purpose serverless Gen5 1-vCore database with 32-GB maximum, 0.5 minimum capacity, 60-minute auto-pause, and the free-limit `AutoPause` behavior; `jarvis-sql-admins` is the Entra administrator | Implements the free offer and lets the database pause while idle; the existing bootstrap group contains Dan and the backend identity | Decided; first deployment pending P0-16 |
| 2026-10-03 | Backend Container Apps uses 0.25 vCPU / 0.5 GiB, exactly 1 replica, and the existing `id-jarvis-backend`; Static Web Apps uses Free in West Europe; ACR uses Basic | Minimum 1 keeps the dispatcher heartbeat alive; maximum 1 because the SSE hub is in memory (several copies need Web PubSub); Basic ACR is the ≈33 DKK/month the cost estimate assumes; selected low-cost app tiers and the previously chosen West Europe static-site region | Decided; first deployment pending P0-16 |
| 2026-10-03 | Assign the backend identity AcrPull on ACR, Storage Blob Data Contributor on the Storage account, and Key Vault Secrets User on the vault; set a monthly resource-group budget to 300 from 1 October 2026 with actual-cost alerts above 80 % and 100 % | Grants the app access to the image registry, its Blob data, and vault secrets; the 80 % alert warns before the limit (P6-02); a fixed start date because Azure rejects changing it on redeploy | Decided; first deployment pending P0-16 |
| 2026-10-03 | A `Copilot PR ready` workflow marks a draft Copilot PR ready when Copilot requests review and the title has no `[WIP]`; the merge workflow (P0-12) also checks that no Copilot session is still running | Copilot cloud agent never marks its own PR ready, and Dan won't click it; a follow-up session on a ready PR must not be merged mid-work | Decided |
| 2026-10-03 | PR titles are exactly `<task ID>: <summary>` (or `fix-main:` / `docs:`); a `PR title` workflow normalises deviations such as `[P0-05] …`, takes a missing ID from the linked issue, and fails otherwise | Copilot titled P0-05 `[WIP] [P0-05] …`; the merge workflow and status tooling match on the task ID | Decided |
| 2026-10-03 | P0-02 uses React Router for browser routes, ESLint flat configuration, Vitest 5.0.3 and Testing Library; a focused web CI checks lint, tests and root builds | Implements the skeleton acceptance checks; P0-10 extends the existing web job to monorepo CI | Implemented; local checks verified |
| 2026-10-03 | Replace the P0-01 TypeScript 7.0.2 pin with 6.0.3 | typescript-eslint 8.71.0 declares support for TypeScript below 6.1; retain supported dependency resolution instead of forcing peers or suppressing parser warnings | Implemented; builds and lint verified |
| 2026-10-03 | Vite injects only bootstrap tenant/web IDs, API scope and a validated production backend origin; `apps/web/config.json` holds the origin, with a public environment override | The bootstrap has no backend hostname before P0-16. The skeleton opens without extra setup and reports deployment pending; P0-16 records its output URL. Owner/deploy metadata is excluded from the browser | Implemented; production connectivity pending P0-16 |
| 2026-10-03 | Use a fresh checkout of latest `main` for each Codex task, including a separate Git worktree when the task continues in the same cloud session | Dan explicitly requested this workflow while starting P0-02 | Confirmed |
| 2026-10-03 | Keep Global Standard capacity 1 independently for the Luna and realtime deployments; increase only if testing shows rate limits | Dan accepted this initial allocation after discussing PR #79's review finding. Exact model-specific limits and available quota have not been checked against Azure | Confirmed; runtime validation pending P0-16 |
| 2026-10-03 | Persist and reuse the required `foundryNameTimestamp` for ordinary Foundry redeployments; normal deployment keeps the existing resources | PR #79 added the required input but omitted it from the deployment docs. Changing it changes both resource names. The deleted-name precaution in L2 concerns recovery only | Documented; first deployment pending P0-16 |
| 2026-10-03 | Production runner: small Node/Python base and separate .NET SDK image, both 1×2 and 2×4; lock Python hashes and CLI/npm versions; deploy ACR digests from main only; read secret-specific credential scopes and write only `codex-login`; delete each probe session even on failure | Issue #28 port and local ACP/probe lifecycle tests; preserves L13, L14, L23. Static Git-token retrieval remains the prototype bridge until #40 | Implemented locally; container CI and live Azure acceptance reported in the PR; deployment pending #11 |
| 2026-10-03 | P0-03 uses Fastify 5.12.5, @fastify/cors 11.3.0, Pino 10.4.0 and isolated manual Application Insights 3.16.0 traces; the final log output allows only safe event names and request metadata. CORS rejects unexpected origins; production requires the Static Web App origin. A pinned, non-root backend image is built and smoke-tested in GitHub Actions | Keeps request headers, URLs, bodies, tokens and provider error text out of stdout and telemetry, including child logger bindings. Missing telemetry configuration explicitly selects stdout-only offline operation; no Azure credentials are needed in tests or image builds | Implemented; offline tests and process verified; container checks in CI; live Azure ingestion pending P0-16 |
| 2026-10-03 | The backend Foundry client uses native fetch with an injected token provider and explicit runtime/administration project endpoints; retries, heartbeat and session lifetime remain with their owners | Issue #30 ports the prototype wire contract without a runtime SDK dependency. Bounded requests and sanitized typed failures preserve crash observations; 55 offline contracts use local runner response recordings from #28 with ACP stubbed | Implemented and checked offline; live Azure envelopes and authorization remain unverified |
| 2026-10-03 | P0-14: cloud agent environments share `scripts/setup-dependencies.sh` (exact Node.js/npm/Python checks, npm pin, `npm ci`, a per-package `.venv` for `runner` and `agents/jarvis` installed only with `pip --require-hashes` from `requirements-dev.txt` or `requirements.txt`, and a check that no tracked file changed). Copilot provides the toolchain with `setup-node`/`setup-python` in `copilot-setup-steps.yml`; Codex runs `scripts/codex-setup.sh`, which uses the image's nvm and pyenv (uv fallback) | One dependency path for both agents and the hash-locked pattern of PR #86's runner. Lint and tests stay out of setup so session start stays short and CI (P0-10) owns gates. The `Copilot Setup Steps` workflow passed on the PR. In the Copilot session, setup with Python 3.12.14 (from uv) installed `runner/.venv`, then `npm run lint`, `npm test` (17 web + 98 backend tests), runner ruff and pytest (36 tests) passed; a temporary clone proved the hash-locked `.venv` install, a missing-lock failure and an unhashed-lock rejection. The Codex image's pyenv path and a real Codex task are unverified (P0-15) | Copilot verified; Codex pending P0-15 |
| 2026-10-03 | P0-10: one aggregate `CI` workflow (PR, `main` push, `workflow_dispatch`) calls the existing web, backend and Foundry workflows as reusable workflows, adds Python checks for present components, and ends in a single `CI result` gate | One workflow and one gate check give P0-12 a single `workflow_run` target and Dan one check to require; reusable calls keep the existing checks unchanged without running them twice. Absent Python components are reported as skipped so a pass never implies tests ran. `runner-ci.yml` (#86) is called the same way; its lint/test job moved into the Python job with the same hash-pinned install, ruff and pytest commands. Verified locally with actionlint 1.7.7 and `python-ci.sh` (runner: 36 tests passed; absent `agents/jarvis` skipped) | Implemented; first Actions run on this PR is the live check; required-check enforcement awaits GitHub Pro |
| 2026-10-03 | Sandbox disk: plan for the measured 6 GiB, not the documented "up to 20 GiB"; the runner records disk per session and stops a task with `disk_low` before a build fills the disk (P6-07 rewritten from "ask Microsoft") | Microsoft's docs give an upper bound with no setting; the prototype measured 6.0 GiB at 1×2 and 2×4 | Decided |
| 2026-10-03 | Worker labels `Codex`, `Copilot`, `Dan`, `Jarvis` show who has taken a task: a label on an open issue means taken; ready = open, not blocked, no worker label. Codex sets its label with `GH_TOKEN`; the `Worker label` workflow sets `Copilot`; agents no longer assign issues | Codex claimed with Dan's token and showed up as Dan; GitHub's assignee list can't show Dan's ChatGPT Codex | Decided |

| 2026-10-03 | Issue #16: trusted backend modules contribute isolated Fastify route plugins and internal Jarvis tools through one composition contract; `core` owns health and the per-app read-only tool catalogue, while `factory` reserves projects/tasks registration | A third-module regression proves routes and tools can be added without changing core. Duplicate identities fail startup; schemas are snapshotted/frozen; inherited root hooks and Fastify resource cleanup are preserved. Domain APIs and SSE remain separate tasks; P4-02 adds authenticated tool dispatch | Implemented; module and tool dispatch contracts are checked offline; container verification belongs to CI |

| 2026-10-03 | #7 uses pinned `mssql` 12.7.2 with Tedious managed identity, a backend-owned pool and immutable SQL batches checked against a SHA-256 ledger under a transaction-owned app lock. Initialize before listen with a 300-second overall deadline; cancel requests, roll back and close owned resources on failure/shutdown | Prevents overlapping replicas applying twice or serving against unfinished schema. Tedious supports the selected managed-identity authentication and delegates token acquisition to Azure Identity. SQL fixture checks cover the real transaction/lock contract; Azure token exchange remains #11 | Implemented; 118 offline backend tests and real SQL Server CI passed; live Azure identity/deployment acceptance remains #11 |
| 2026-10-03 | P0-08: root backend authentication uses jose 6.2.12 for RS256 Entra v2 delegated `jarvis-api` tokens; exact issuer/API audience, time claims, tenant, Dan's object ID and `access_as_user` scope are required | Single-user API boundary rejects ID/app-only tokens, duplicate headers and unverifiable credentials. Install before CORS so business OPTIONS handlers cannot bypass authentication. Expose only the verified identity fields required by routes; bound JWKS retrieval and retain sanitized 401/403 responses | Implemented with offline RSA/local JWKS and socket tests; service identities and live Azure remain unverified |
| 2026-10-03 | P0-09: use `@azure/msal-browser` with a tenant-specific popup to request only `jarvis-api/access_as_user`; cache in session storage and call protected `/me` with its access token | The backend remains the authorization boundary and returns only the validated, bounded display name; other object IDs receive 403. Local tests cover scope/token forwarding, `/me`, and refusal, but no Azure tenant or deployed backend was available for live verification | Implemented and checked offline; live Entra sign-in pending P0-16 |
| 2026-10-03 | The separate Project board sync from #108 is restored; its workflow, script, tests and existing project-board environment are retained | Dan clarified that only the Jarvis coordinator should be removed. The prior cleanup removed too much. Restore the board integration without recreating or deleting its environment | Restored |

| 2026-10-03 | #12's Jarvis coordinator is removed, including automatic issue assignment, PR merging and conflict-repair dispatch | Dan requested coordinator removal and explicitly retained the separate Project board sync | Coordinator withdrawn; Project board retained; deployment integration remains #11 |
| 2026-10-03 | P3-09 provides copyable managed-project workflows: read-only PR checks, then release build/tests and artifact upload before a `main`-only Azure OIDC deploy using the `production` environment | Copying lets each project adapt its own runtime and deployment without coupling it to Jarvis's active workflows. `id-token: write` is limited to the deploy job; OIDC identifiers are Actions variables, not stored credentials | Templates and offline structure checks implemented; adoption and live Azure federation/deployment unverified |
| 2026-10-03 | P0-11: one `deploy.yml` on push to `main` and `workflow_dispatch`. It diffs against the head of the last successful Deploy run, skips superseded commits, ignores `*.md`/`docs/`, and shares `jarvis-production-deploy` with Runner deploy using `queue: max`. Bicep deployment is always `jarvis-infra`; `foundryNameTimestamp` is fixed at `20261003200000` in `infra/main.parameters.json`; `backendImage` is optional so the first pass can create ACR before the backend app; images deploy by digest; Bicep sets the backend's SQL managed-identity, Application Insights and Static Web App origin settings plus `/health` probes; bootstrap IDs come from the committed `infra/bootstrap.output.json` | Diffing from the push's `before` commit would lose changes from a failed or dropped run. The bootstrap federated subject is the `main` ref, so deploy jobs use no GitHub environment. Without the Bicep settings the production backend would refuse to start (`STATIC_WEB_APP_ORIGIN` is required in production). Offline tests, Bicep build/lint and actionlint pass | Implemented; first live run and post-deploy setup completed in P0-16 |
| 2026-10-03 | P1-07: the web shell lists areas in `apps/web/src/areas.ts`. Each area mounts at `/<path>/*` and owns its nested routes. App-level sign-in state gates every shell route. Unbuilt main-page features show disabled actions with explanations, not sample data. The activity panel takes a typed `NowFeed` built from the `tasks` and `activity` fields, accepts only `task:`, `release:` and `project:` links, and shows the unavailable state in production until P1-13 supplies the backend feed | PRODUCT.md requires later areas to plug in without reworking the shell. The project rules forbid invented data and dead controls. The acceptance criterion asks for the page's data points and actions before their APIs exist | Implemented; offline web tests and a headless Chromium layout check pass; live data awaits P1-13 |
| 2026-10-03 | P1-11 stores settings as whitelisted global key/value rows, validates updates against one backend catalog, and applies them only as defaults for future sessions and tasks. The Codex/Copilot model catalogs still expose only provider defaults; P2-11 verified runner configuration, not available-model catalogs | Reuses the existing `settings` schema without history or a migration; transactional partial writes avoid overwriting unrelated settings. Unavailable voice playback, sleep, and credential actions remain explained and disabled until their services exist | Implemented and covered by offline API/UI tests; Azure SQL integration and future session/task consumers remain unverified |
| 2026-10-03 | The hosted Jarvis agent reads effective model and reasoning settings from an agent-only backend route at session start and retains the values for that session | A per-session request argument avoids mutating the shared model client across concurrent sessions. If the backend settings read is unavailable, log a warning and use the established defaults (`gpt-5.6-luna`, reasoning `none`) so startup remains available; tests verify isolation and fallback | Implemented and covered by offline backend and agent tests; live deployed-agent settings verification remains pending |

| 2026-10-03 | P4-02 dispatches tools through per-tool Fastify routes generated from the composed registry; each request supplies `X-Jarvis-Message-ID`, and the backend stores its arguments, result and outcome in `tool_calls` | Fastify validates each request against the module's schema; a new module therefore exposes its tools without changing core or agent code. SQL writes use the existing process-owned pool. The table migration belongs to P1-01 (#15); only offline endpoint and parameter-binding tests ran | Implemented offline; database/Azure writes and service-identity authorization remain unverified |
| 2026-10-03 | P0-07's live check (a deploy applies a new migration once) moved into P0-11's acceptance; P0-07 closed as Complete | P0-11 depends on P0-07, so P0-07 could never close; a deadlock that blocked the first deploy and with it P3-10 | Decided |
| 2026-10-03 | P1-01 (#15): groups 1–3 in one migration, `0001_core_tables.sql`. Fixed values use binary-collated `nvarchar` with checks; JSON is `nvarchar(max)` with `ISJSON(..., VALUE/OBJECT)`; one supporting index per foreign key. Every migration ships a reverse script in `db/migrations/down/`, run only by `revertMigration` (latest applied migration, same app lock and transaction as startup, ledger row removed with it); startup stays forward-only | Case-insensitive default collation would accept `ready` for `Ready`. The CI SQL Server 2022 image has no native `json` type, so `nvarchar` keeps CI and Azure SQL identical. A lock-guarded revert keeps schema and ledger consistent and cannot overlap a starting replica | Implemented; 25 SQL Server container tests (up, constraints, down, re-up) and 161 offline backend tests passed locally; first production deployment completed in P0-16 |
| 2026-10-03 | P1-03 (#17): expose project list/create/update/archive through authenticated factory routes; list active rows and archive by setting `active = 0` without releasing the unique repository | Preserves task references and keeps an archived repository from being registered twice. Parameterized SQL and offline route tests cover validation; SQL Server-container integration tests execute persistence and archive behavior | Implemented and container-tested; deployed Azure CRUD remains unverified |
| 2026-10-03 | P1-04 (#18): board task writes and server-owned state changes use a process-shared SQL task store; task creation and lifecycle events commit atomically. Expose create/list/detail APIs, but no client state mutation; verified completion is required to enter Done | Prevents arbitrary client state edits and preserves the policy/GitHub evidence required for Done. Bounded list/event pagination, 1 MiB API responses, explicit 4 KiB event-payload truncation and parameterized filters keep requests controlled. All backend unit tests and SQL Server integration tests passed locally against the disposable SQL Server 2022 container; Azure deployment and live writes remain unverified | Implemented and locally verified; deployed Azure writes remain unverified |
| 2026-10-03 | P4-05: tool responses carry an `ok`/`refused`/`error` outcome and a backend-built `confirmation`; a tool refuses by throwing `ToolRefusal` with a reason safe to show Dan | L16: the model claimed an action it did not take. The confirmation comes from the recorded result, so a refused or failed call cannot be reported as done; unexpected errors stay sanitized. Confirmations are English and derived, not stored | Implemented offline; the hosted agent relaying them is P4-01 |
| 2026-10-04 | P4-10 registers the Factory project/task tools as adapters over the existing stores and task controller; `create_task` derives its required task title from the first prompt line, and `get_task` omits event payloads | This keeps the HTTP API authoritative for persistence and lifecycle transitions, supports a prompt-only create call, and prevents event payloads from entering model tool results | Focused backend tests verify all eight tools and refused transitions; live chat/voice calls and Azure SQL writes remain unverified |
| 2026-10-03 | P0-16: the deploy identity trusts GitHub's immutable-ID OIDC subject `repo:<owner>@<owner ID>/<repo>@<repo ID>:ref:refs/heads/main`. `infra/bootstrap.ps1` reads both IDs from `gh api repos/<repo>` and adds the federated credential `github-main-ids`; the old name-only `github-main` credential is left in place | Deploy runs 1 and 2 on `main` failed at `azure/login` with `AADSTS700213` for subject `repo:DanAakesen@68902534/jarvis@1403065900:ref:refs/heads/main`. GitHub uses this format for repositories created or renamed since 15 July 2026. IDs survive renames, so a reused name can't match the credential. Checked offline: the script parses in PowerShell 7 and builds exactly that subject from the GitHub API response shape | Implemented; subsequent main Deploy runs succeeded |
| 2026-10-03 | P4-01: the hosted Jarvis agent calls the backend with an app-only token from its own platform identity. `jarvis-api` gains the application role `Jarvis.Tools`. The backend accepts that token only when its `oid` equals `ENTRA_JARVIS_AGENT_OBJECT_ID`, it carries the role, has no delegated `scp`, and `idtyp` is absent or `app`. Only routes with `config: { jarvisAgent: true }` (`GET /tools`, `POST /tools/{name}`) accept it; elsewhere it gets 403 | `jarvis-api` already requires role assignment, so Entra issues no token without the role; the pinned object ID and the per-route opt-in keep every other route Dan-only by default. The agent principal is kept apart from `request.principal`, so Dan-only handlers cannot mistake it for Dan. Real RS256 tokens with a local JWKS test acceptance, each refusal and the route opt-in; a mutation that removed the opt-in check failed the tests | Implemented offline; the main Deploy/bootstrap setup is complete; live tool calls remain in P4-09 acceptance |
| 2026-10-03 | P4-01 ports the voice-prototype agent to `agents/jarvis` with its runtime unchanged. The tools come only from `GET /tools` (60-second cache) and run through `POST /tools/{name}`; the backend result reaches the model unchanged. Each failure is returned as `outcome: "error"` that states whether nothing was done (never sent) or the action may have happened (timeout or connection lost after sending). An unavailable catalogue fails the turn before the model is called. The English instructions (P5-03) and the Azure Table tool log were not ported, because the backend's `tool_calls` is the record | Keeps tool definitions in one place (P4-02) and keeps L16's rule that replies follow tool results. The prototype tests passed unchanged on the new pins (41) before the tools were replaced; 100 agent tests and a local real-backend check (signed agent token, catalogue, validated call recorded with its message ID, `/me` refused) pass | Implemented offline; live factory-tool acceptance remains with P4-09 |
| 2026-10-03 | P4-08 deploys the Jarvis image by digest from the main-only Deploy workflow, publishes a Foundry hosted-agent version with the backend URL, and updates the backend's agent object ID. Bootstrap assigns `Jarvis.Tools` and persists the ID as a GitHub Actions variable for later Bicep deployments | Reuses the existing queued production deploy and Foundry data-plane contract. The workflow and offline deployment planner are implemented; run 37166007619 succeeded on main, including the Jarvis agent; end-to-end chat/tool-call acceptance remains with P4-09 | Implemented; deployed successfully; end-to-end live acceptance pending |
| 2026-10-03 | The agent sends `X-Jarvis-Message-ID` from a per-turn context value and refuses tool calls locally while it has none; it never invents an ID. The caller that runs a stored turn must set the value; P4-03 stores messages, but no caller passes the ID to the agent yet | The backend needs a real `messages` row for `tool_calls`, which P4-03 creates; a fabricated ID would break the record or attach the call to the wrong message | Decided; caller wiring open |
| 2026-10-03 | P2-01 (#27): `0002_sandbox_operations.sql` adds data-model groups 4 and 6 with checked lifecycle vocabularies, parent indexes, unique Foundry session IDs, and an idempotent webhook delivery key. Reversing the migration drops dependent tables first; credential rows contain status and dates, never secret values | Keeps the schema aligned with the data model while allowing webhook deliveries to be recorded before processing; the existing runner verifies a reverse batch for every migration. Offline tests pass; isolated SQL Server validation awaits CI, and the first production application completed in the P2-01 Deploy run | Implemented; CI passed and the production Deploy run succeeded |
| 2026-10-03 | P2-08: the backend renews the Jarvis Codex login daily through a pollable runner invocation when no Codex task runs and the access token has at most 3 days left. SQL `credential_status` lease acquisition and Codex task starts share the credential row lock; uncertainty keeps the lease until expiry. Settings exposes only secret-free dates/status; Copilot expiry/update dates come from Key Vault metadata. Bicep retains its single `Foundry User` assignment for the backend identity | Avoids the race where a task starts after a read-only active-task check. Runner renewal metadata is allowlisted for persistence; auth documents and token values remain in Key Vault/private files. Backend, runner, Settings and Bicep checks pass; live Azure SQL, Key Vault and Codex renewal remain unverified until P0-16/Dan's credential setup; P2-05 must use `TaskStore.transition` | Implemented offline; live proof pending |
| 2026-10-03 | P1-05 (#19): task creation, accepted state transitions, and `TaskStore.recordEvent` write `task_events` and a matching `activity` row in one SQL transaction; the process-local hub publishes only after commit | SQL remains authoritative and a failed transaction cannot appear live. Synchronous in-process publication fits the single production replica; P1-06 owns authenticated SSE streaming, heartbeats, and replay | Implemented; local tests verify persistence and sub-second hub delivery; live Azure latency remains unverified |
| 2026-10-04 | P6-03 (#64): archive `task_events` older than 90 days in bounded batches to the private `task-events` Blob container; task-detail pages read older events from Blob on demand | A 90-day cutoff keeps recent events in SQL while preserving complete task history. Upload deterministic per-task blobs before transactionally deleting their SQL rows and recording `task_event_archives` indexes; unindexed blobs from failed transactions stay invisible. A transaction-owned application lock serializes archive writes with detail reads, without changing `recordEvent`. Fake-Blob unit and SQL Server integration tests cover paging, upload failure, deletion, and restore | Implemented offline; live Azure archive/restore verification is a post-merge step because coding agents cannot access Azure Storage |

| 2026-10-03 | P4-04 loads a bounded snapshot of running tasks and their latest events for each model turn: at most 20 tasks, three events per task, and 400 characters per event summary. Task requests and event payloads are excluded; existing in-session history stays bounded to 12 messages / 24,000 characters | Status answers can use current facts without spending a model round on `list_tasks`. Keep this read on the backend behind the Jarvis agent role, and fail the turn when a fresh snapshot is unavailable rather than use stale status. Offline endpoint and agent tests pass; local SQL integration awaits the isolated SQL Server configuration | Implemented offline; live Azure SQL and deployed identity remain unverified |

| 2026-10-03 | P1-10: keep project management in the existing Software Factory area and use its authenticated project CRUD API; derive running counts from the bounded Running-task list and leave last release unavailable until release data is connected | Reuses existing APIs and avoids a second aggregate store or fabricated release value. Counts refresh on demand until live updates exist; the form mirrors server rules for feedback while the API remains authoritative. Vitest and Chromium with scratch-only auth/API mocks verify list, create, update, archive, and responsive layout; live Azure CRUD remains unverified | Implemented offline; production data remains unverified |
| 2026-10-04 | P1-09 uses the task detail API's bounded event pages and the authenticated task SSE client; events merge by persisted ID. The originating conversation message uses a single-row history read. Task controls stay disabled until P2, while missing PR/check/artifact data is reported unavailable. The page reserves Usage for P2-12 | Reuses existing reads from P1-04, P1-06, P6-03, and conversation history without a write route or schema change; a 100-event page keeps the initial response bounded while users can request later pages. Focused Vitest tests cover pagination, live events, filters, payload expansion, links, and disabled controls; local-browser checks cover responsive interactions. Live Entra, Azure SQL/Blob and deployed streaming remain unverified | Implemented offline; production behavior unverified |
| 2026-10-03 | P5-02 provisions `jarvis-voice-mai` as a hosted-agent voice bridge to `jarvis`; the backend relays browser traffic through authenticated `/voice/da`, and the agent uses MAI Transcribe (`da`, phrase list) with Harper locked to `da-DK` | Keeps provider credentials server-side and provisions the agent from a successful Deploy or manual dispatch. Bicep supplies the Foundry project endpoint and grants the backend identity `Foundry User`; the provisioner SDK is hash-locked | Backend mock, settings tests, SDK definition, Python CI, and Bicep build/lint pass; live provisioning and browser round-trip await P5-04 and Azure access |
| 2026-10-03 | P1-12: the authenticated sleep API reads and sets the backend Container App's minimum replicas (1 awake, 0 asleep) through ARM using `id-jarvis-backend`; the target resource ID comes from Bicep, which grants only Container App read/write at that app | Sleep refuses while Ready, Running, or PauseRequested tasks exist. A transaction-owned exclusive SQL application lock spans the task check and bounded ARM request; task creation and transitions take the matching shared lock. ACA state is authoritative, so no SQL state or migration is added. Offline API, refusal, ARM-client and SQL-lock tests pass; P2-07 adds SQL coverage for PauseRequested; live managed-identity/RBAC/ARM behavior remains unverified | Implemented locally; live validation pending deployment |
| 2026-10-03 | P4-06 streams chat through the authenticated backend to the hosted Jarvis agent | Reuse the existing Responses/tool loop and conversation schema; the backend persists Dan's source message before dispatch, relays deltas, and stores only completed replies. P4-09 selects the public Invocations protocol instead of assuming a custom `/chat` route exists. | Implemented and tested offline; hosted-agent route and backend configuration are P4-09 |
| 2026-10-04 | P4-09 routes chat over Foundry Invocations: `POST {project_endpoint}/agents/{agent_name}/endpoint/protocols/invocations?api-version=v1`; the backend authenticates with its managed identity, while the delegated user authorization and stored source-message ID travel in the application payload. The agent exposes its chat handler through `@app.invoke_handler`, verifies `/me` and the stored history, and returns its existing application-defined SSE stream | Microsoft documents Invocations as the hosted-agent protocol endpoint with an application-defined request/response contract and SSE support ([runtime contract](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/hosted-agent-contract)); it does not promise arbitrary custom routes. This keeps the delegated identity check, source-message linkage, stream, completed-reply persistence, and tool-call recording without a schema change. Bicep and main Deploy configure the agent name; Foundry access uses the existing project endpoint and backend identity | Implemented and contract-tested offline; live Azure streaming and `tool_calls` linkage are a coordinator post-merge check |
| 2026-10-04 | P1-06 streams each task's committed events from `task_events` over an authenticated `fetch` SSE route. Subscribe to the in-process hub before replay and buffer publications until the persisted cursor is caught up; suppress event IDs already replayed. Send a comment heartbeat every 25 seconds. The browser helper owns reconnects and the last delivered ID because native `EventSource` cannot set the bearer header. | SQL remains the replay source of truth while the existing hub serves live updates; buffering across the replay/live handoff closes the reconnect race without changing event writers or adding a table. Focused backend/web tests cover overlap, resume, duplicate suppression and heartbeat framing. | Implemented offline; SQL Server integration and deployed streaming remain unverified |
| 2026-10-04 | P6-05 parallel load test: run it in CI as a SQL Server integration test with a fake Foundry client. Three competing dispatchers run 15 tasks across three projects (limits 2/2/1, global limit 4); tasks alternate Codex and Copilot, and every second Codex task ends in Needs attention, as after a Codex usage-limit failure. The dispatcher sends `task_id` in every start and resume invocation. The runner reports the Codex usage-limit ACP error as `Codex usage limit reached` (reason `codex_usage_limit`). Dan runs the live load test as P6-08. | Agents have no Azure or production access, so the live test could not run here. CI run 37181040894, `Database` job: passed. All 15 tasks started exactly once, with one sandbox session and one sandbox usage row each. At most 4/4 tasks ran at once, and per project at most 2/2, 2/2 and 1/1. All three dispatchers started tasks, with no dispatcher errors. After the 4 simulated Codex limit failures, capacity was released and the other 11 tasks finished. Wall time was 3.3 s for 500 ms simulated runs; the ideal at 4-way concurrency is 1.9 s. While preparing the test, we found that the dispatcher omitted `task_id`. The deployed runner therefore rejected every start and resume with HTTP 400 (L59). The codex-acp 2.1.1 source shows that a usage-limit turn rejects `session/prompt` with `data.codexErrorInfo = "usageLimitExceeded"`; the runner previously reported this only as `RuntimeError`. Not verified: real Foundry sandboxes, start latency, Codex Pro allowance used per task, Copilot premium requests, and Azure SQL. | Offline load test passed in CI; live run pending (P6-08) |

| 2026-10-04 | P1-08 builds the Factory board on the existing filtered Tasks API and task-scoped SSE client. Subscribe only to nonterminal task cards, use event timestamps for freshness, and refresh the task snapshot after committed events. | This keeps P1-08 within the existing authenticated API and avoids broadening persistence or inferring missing data. Up to 100 newest matches are shown; PR/check/usage stay "Not reported" until P3-03/P3-04 and P2-12. Vitest and scratch Chromium/API mocks verify the flow; live Entra, SQL, and deployed SSE remain unverified. | Implemented offline; production behavior remains unverified |
| 2026-10-04 | P3-11 stores New projects defaults as validated JSON scalar keys in the existing global `dbo.settings` scope; project creation remains a Jarvis/backend operation, not a Projects-page form. | Reuses transactional settings persistence and keeps the project POST route available for P3-12. Settings and project UI tests cover saved defaults and removal of the form; live Entra/Azure SQL behavior remains unverified. | Implemented offline |
| 2026-10-04 | P3-13 lists repositories from the App installation for the configured New projects owner with a five-minute backend cache and on-demand refresh; existing-repository registration uses the actual GitHub default branch, configured agent/policy/task-limit defaults, and detected tech. The Projects action and `manage_repository` share one backend operation. | A contents-read installation token keeps discovery and tech detection server-side; registration first verifies the repository is in that installation. File markers take precedence over normalized primary language, with `unknown` when neither identifies a supported tech. Reuses the existing projects schema. Focused backend and UI tests pass; live GitHub, Key Vault, Entra, and Azure SQL behavior remain unverified. | Implemented offline |
| 2026-10-04 | P3-12 creates repositories only in the backend with `jarvis-repo-admin`, registers a chat-linked scaffold task using New projects defaults, and recognizes an explicit runner clarification marker as NeedsAttention. New projects start with the `node`/`1x2` base values until their stack is established. | Keeps the admin token outside task/sandbox data, reuses existing project/task/message tables, and makes missing description details visible instead of guessing. Focused backend/runner checks and the runner image smoke verify offline behavior; private repository/template access and the end-to-end PR remain the coordinator's post-merge live check. | Implemented offline; live check pending |

| 2026-10-04 | P3-03 exposes only `POST /github/webhooks` as a public integration route, verifies GitHub's SHA-256 HMAC over raw JSON bytes with the backend-only Key Vault secret, and records delivery IDs atomically in the existing operations table | A route-level opt-in preserves the backend's default Entra protection. The existing primary key plus a serializable insert suppress concurrent duplicates; no payload or event mapping is added before P3-04. Route/config/store tests pass offline; the SQL concurrency contract is authored for database CI. Live Key Vault and GitHub delivery remain Dan's post-merge setup. | Implemented offline |
| 2026-10-04 | P3-04 maps only allowlisted GitHub fields into group 5 in the same serializable transaction as the delivery row. PRs use project/number, workflow runs use project/run ID, and deployments use the GitHub deployment ID. A push to a project's default branch creates a release by SHA; its `Release` workflow run supplies the version number. | Keeping the raw payload out of storage and logs limits retained data; committing delivery and mapping together makes a retry safe after partial failure. `release` webhooks are not subscribed because releases represent default-branch merges, not GitHub tags. Mapper/route/store tests and the full 57-test SQL Server integration suite pass locally; CI is rerunning after the test assertion fix. Live test-repository delivery remains unverified. | Implemented; local SQL Server integration passed |
| 2026-10-04 | P3-07: treat a matching `Release` workflow run on the configured default branch and a push to that branch as idempotent ways to materialize the same release by project/SHA; reconcile earlier workflow runs when the push arrives later. | Webhook delivery order is not guaranteed. The existing group-5 schema is sufficient: workflow runs and deployments retain SHA-based release links, and the run number is available when a `Release` run arrives first. Fake SQL contracts and the disposable SQL Server integration suite pass; live test-project webhook delivery remains unverified. | Implemented; local SQL integration passed |
| 2026-10-04 | Add P7 (Jarvis everywhere) and P8 (Jarvis UI). P7 tasks are headless; P8-01 designs the full UI with Dan. Microsoft services and free tiers only, Jev excepted. Original P7-01 proposal (superseded 5 October): calls start free from the Teams app through Foundry voice-agent Teams Phone extensibility; a paid number is deferred. Phone confirmations use a Teams bot; Telegram is dropped. Computer use on Dan's PC uses Windows UI Automation through a local bridge, not Foundry `computer-use-preview` | Dan accepted the features from a reviewed Jarvis demo video, except animated eyes and hand gestures. Microsoft Learn: Foundry voice agents support Teams Phone extensibility (preview) but need a Teams service number on a resource account ([telephony channels](https://learn.microsoft.com/azure/foundry/agents/how-to/voice-agent-telephony-channels)). `gpt-realtime` takes no images, so screen and camera need a vision-model bridge. Microsoft advises a sandboxed VM for `computer-use-preview`. Unverified: Teams VoIP reach without a number, ACS per-minute cost, Jev endpoint | Accepted; P7-01 number/cost direction superseded by the 5 October decision below |
| 2026-10-04 | P1-14: bound SQL wake retries to 90 seconds at connection acquisition and explicitly read-only queries; never replay executed writes or transactions. Report concurrent waits through an authenticated, SQL-free status endpoint and show “Waking Jarvis…” in the signed-in shell only while data requests are pending. | Preserves SQL store contracts and avoids ambiguous duplicate writes. Pool and read retries share one deadline; late acquisitions are released. Status polling does not prevent SQL auto-pause. Task SSE emits `ready` after replay, including empty replay, so heartbeat comments do not hide a wait. Fake-time SQL tests, route tests and scratch Chromium checks cover recovery and the visible state; live Azure auto-resume remains unverified. | Implemented offline; production auto-resume check pending deployment |
| 2026-10-04 | P2-13 prepares the repository in the runner, not through an agent prompt. Dispatch persists `jarvis/task-<id>` in `tasks.branch` and sends repository/default/task branch in the Foundry start contract. Resume and recovery keep that branch. An `end_turn` with no new task-branch commit reports the last message as `session_question`; the backend moves Running or PauseRequested to NeedsAttention transactionally. | Production task 2 reached ACP in an empty session folder and asked for its repository and branch. Explicit workspace preparation and commit evidence prevent a question from looking like successful work. Keep the Git credential-helper interface compatible with P3-02; a commit never substitutes for verified GitHub completion. | Implemented with local Git/ACP and backend contract coverage; coordinator live Copilot/Codex pushes and question acceptance remain post-merge |
| 2026-10-04 | New P2-13 checkouts use repository-local `github-actions[bot]` Git author defaults, matching the project's existing automation convention; resume leaves existing author settings unchanged. | A session-local empty HOME has no Git author configuration. A real Git test commits with author/committer environment variables removed. These defaults enable commits without inventing human authorship; push authentication still belongs to the credential helper. | Implemented and locally verified; live provider pushes remain post-merge |
| 2026-10-04 | P2-14 correlates confirmed Foundry expiry with persisted invocation completion: completed-turn expiry ends only the sandbox session as `idle_expired`; active-turn failures retain the P2-06 crash transition. Continue after expiry reuses P2-10 recovery on the task branch. | A completed provider invocation can remain in an active session until Foundry expires it. Persisting the matching turn's terminal status and keeping `session_question` sessions monitored lets heartbeat distinguish that idle timeout from a crash without inferring from event gaps or changing task state. Focused fake-Foundry/backend/web tests pass; SQL Server CI and live Foundry expiry remain unverified. | Implemented offline |
| 2026-10-04 | P2-14 follow-up: guard every NeedsAttention session-cleanup path with current task state and latest-invocation completion evidence; persist heartbeat-observed completion, reconcile early runner events, and log every heartbeat decision with IDs and HTTP status only. Steering after expiry reuses branch recovery. | Reopened #226 reports task 4 marked Crashed about 30 seconds after completion. Code inspection found generic dispatcher cleanup marked active sessions Crashed regardless of persisted completion. Fake-Foundry/store tests cover a first failing poll without a completed snapshot and distinguish the committed expiry/crash outcomes; SQL contracts cover generic cleanup, early events, and delayed cleanup after recovery. | Implemented offline; SQL Server CI and coordinator live check pending |
| 2026-10-04 | P3-06: evaluate policy after persisted signed GitHub webhooks; `deliver_pr` completes on a verified green PR without merging, while `complete_without_deployment` requests an App-token squash merge only for a green, non-draft, up-to-date and mergeable PR. A task-scoped SQL application lock serializes cancellation with automatic merge; accepted merges are recorded before releasing the lock, so cancellation remains refused until the merge webhook arrives. GitHub rate limits remain retryable. Treat the merge response as provisional and mark Done only from the persisted merged-PR record plus current GitHub verification. | Keeps runner reports outside the completion trust boundary, lets GitHub enforce required checks and branch protection, and makes duplicate webhook retries safe. Fake-backed backend tests cover both policies, cancellation serialization, and refusal cases; live test-repository/App merge acceptance remains unverified. | Implemented offline |
| 2026-10-17 | P10-09: selecting `complete_without_deployment` is approval for its guarded App squash merge; ask for no additional confirmation and send no message. Re-evaluate live project policy at startup, every minute, and immediately after a policy PATCH so the persisted two-minute no-check grace survives restarts. Preserve existing safety guards, the cancellation lock, task events, `deliver_pr` behavior, and the signed merge webhook as the only source of Done. Bound transient GitHub retries to three attempts with 1/2/4-minute backoff; record and suppress repeated permanent merge refusals. This supersedes any project-policy merge-confirmation behavior; manual GitHub-tool merges and all other confirmation gates remain unchanged. | Choosing the policy is Dan's explicit approval for this one automatic project workflow. Fake-backed tests cover direct merge, no-check restart recovery, live policy changes, sweep idempotency, refusal visibility, bounded retry, and the existing verification guards. | Implemented offline; live GitHub App acceptance remains unverified |
| 2026-10-04 | P3-06 specified App-token PR creation on completed work, but that step was absent from the backend; P3-14 implements it at completed-turn handling. The backend reuses an open PR or creates one only when the task branch is ahead of the default branch, records `pull_request_opened`, and leaves Done to the persisted-webhook policy. Missing commits and GitHub failures record a reason and move the task to Needs attention. The task policy lock rechecks Running immediately before the bounded create, reconciles ambiguous create responses, and records the PR event before release, so cancellation cannot win midway through the side effect; GitHub preflight reads stay outside the lock. | The original P3-06 row overstated the implementation: its webhook policy only consumed PR records. Moving creation into the completion verifier prevents pushed work from being stranded, while reusing the App issuer, webhook policy and existing task-event store keeps the trust boundary unchanged. Fake GitHub and dispatcher tests cover create/reuse, duplicate completion, no-ahead refusal, API failure and the Needs attention event; the live `jarvis-test-target` check remains unverified. | Implemented offline; coordinator live check pending |
| 2026-10-04 | P6-02: persist each alert as one `activity` row keyed by a unique condition, and publish the notification only after its source transaction commits. Use hashed Application Insights trace dimensions and stateful Azure Monitor log rules for deployment, sandbox and credential alerts; the Azure Budget 80% rule calls the same email-only action group. Poll actual budget spend with the backend identity for the Now feed. | Reuses the authenticated Now feed and existing source-of-truth records while making webhook retries, repeated credential metadata and budget polls idempotent. Backend tests use fakes for ARM/telemetry; SQL Server integration tests confirm migration and condition deduplication; deployed email, monitor behavior, and the `JARVIS_BUDGET_CONTACT_EMAILS` secret remain to verify. No SMS or voice action is configured. | Implemented offline; live Azure delivery pending |
| 2026-10-04 | P7-06: build a .NET 10 WinForms tray companion using Entra device-code sign-in and an outbound authenticated WebSocket; accept only Dan's delegated API token from the configured public-client ID. Limit PC actions to HTTP(S) URLs, four named apps, folders under `C:\Repo` in VS Code, active-window title, and exact-title focus. | The backend routes registered `pc_open` and `pc_active_window` tools over a bounded, correlated protocol; the PC independently enforces the allow-list. No arbitrary commands, inbound listener, message-content logging, or schema migration. Core policy and fake-bridge tests pass offline; actual Entra sign-in, Windows actions, and deployment remain the coordinator's post-merge verification. | Implemented offline; live PC check pending |
| 2026-10-04 | The Project board has a **Needs Dan** column between Backlog and Ready. Open, unclaimed issues labelled `needs-decision` go there, so Ready means "can start now" | Dan saw 13 Ready cards that were all waiting for his decisions. The Status option was added with the existing option IDs preserved (no card lost its status); `project_board.py` maps the label, with tests | Implemented |
| 2026-10-04 | P7-09 originally used app-only Microsoft Graph and Exchange mailbox-scoped RBAC. | Superseded by the 2026-10-05 provider decision in P7-22: Dan does not use Outlook; Jarvis uses Gmail and Google Calendar only. | Superseded |
| 2026-10-05 | Jarvis uses official Gmail API v1 and Google Calendar API v3 over HTTPS with OAuth for Dan's personal `danaakesen@gmail.com` account. Store OAuth client ID, client secret, and refresh token only in Key Vault; use `gmail.readonly`, `gmail.compose`, `gmail.send`, and `calendar.events`. Preserve the existing mail/calendar tools and later-message confirmation. Confirmed replies create drafts for Dan to send himself; explicitly confirmed `mail_send` sends through Gmail. | Dan's decision on issue #321 supersedes the Outlook provider. Gmail draft creation requires `gmail.compose`; Google does not offer a draft-only scope, so this is necessary to preserve `mail_draft_reply`. `gmail.send` remains scoped to the separately confirmed send tool. The backend caches short-lived access tokens in memory and records a P6-02 credential-expiry alert on `invalid_grant`. | Implemented offline; Dan's OAuth setup and live Google API acceptance pending |
| 2026-10-05 | P7-28 adds reflex-safe, redacted calendar range and next-event reads while retaining `calendar_today_agenda`. Date-only range endpoints use Dan's configured time zone and include both dates; explicit date-times use an exclusive end. Listing is capped at 100 events/62 days; next-event lookup searches 60 days and skips Dan-declined events. All-day dates stay date-only. | This extends the confirmed P7-22 Google provider without changing its OAuth or write-confirmation boundary. Fake Google client tests cover local-week paging, next event on a later day, empty and over-limit ranges, and multi-day all-day events; live account behavior still requires coordinator acceptance. | Implemented offline; live "this week" and next-appointment acceptance pending |
| 2026-10-07 | P9-26 adds `calendar_update_event` for supplied title, time, location, attendees, and description fields, plus `calendar_delete_event`; both use the existing `calendar_confirm_change` exact later-message approval. | PATCH requests contain only supplied fields, and empty location, description, or attendee values clear those fields. The existing in-memory ten-minute confirmation state and `calendar.events` grant are sufficient, so no migration or contract change is needed. Fake-client tests cover confirmation, validation, redaction, and Google API DELETE handling; live Calendar acceptance remains pending. | Implemented offline; live update/delete acceptance pending |
| 2026-10-07 | P9-27 adds bounded Gmail draft listing, full replacement of simple plain-text drafts, confirmed draft deletion, archive, label add/remove, and retains exact confirmation for sending. All mail mutations use the existing ten-minute, later-message confirmation state. | Draft replacement requires the full recipient/subject/body and refuses attachments or CC/BCC to avoid silently losing data. `gmail.modify` is the least-privilege additional scope for drafts and labels; Dan must add it in Google Auth Platform and rerun `infra/setup-google.ps1` to replace the Key Vault refresh token. No migration or contracts change is needed; fake-client tests cover tool requests, confirmation, redaction and refusal. | Implemented offline; Dan's re-consent and live Gmail acceptance pending |
| 2026-10-08 | P9-28 adds nullable project descriptions and registers `update_project`, `archive_project`, and `confirm_project_archive` over the existing project store and shared tool registry. Archive requires a one-time exact confirmation from a later Dan message; updates change only fields supplied. | Migration 0033 preserves existing rows with null descriptions, and `create_project` saves its supplied description. Reusing the active-project store keeps tool writes consistent with the `/factory/projects` routes. Confirmation codes are process-local, bounded, and expire after ten minutes; restart or failed confirmation leaves the project active. Focused backend tests cover the contracts; SQL integration and live Azure SQL/tool acceptance remain unverified. | Implemented offline; live acceptance pending |
| 2026-10-04 | P7-09 keeps pending calendar/mail confirmations in process memory rather than adding SQL state. | Bicep keeps the backend at one replica. Pending codes expire after ten minutes and are lost on restart, which fails closed; scaling out requires moving this state to shared durable storage before changing the replica limit. | Implemented; scaling constraint documented |
| 2026-10-04 | P7-03: use Azure Bot Service F0 with its Teams channel and the backend's user-assigned managed identity; send Dan-only personal chat notifications and five-minute, single-use Adaptive Card confirmations. Speech voice notes use Azure Speech F0 only and fall back to text when unavailable or exhausted. Always gate merge, delete, mail, calendar changes, repository creation, computer use outside the browser, and spending money on Dan's explicit approval. | The identity and confirmation decision comes from Dan's issue comment. SQL stores only a validated conversation reference and confirmation state; fakes cover approve/reject, replay, unknown identity, expiry, audio links and action gating. The Teams SDK's incompatible internal JWT declaration types require `skipLibCheck`; backend source remains typechecked. Bicep build/lint and offline tests do not verify Azure deployment, role ID, F0 quota, Teams installation or a phone round trip. | Implemented offline; coordinator's live Azure/Teams check pending |
| 2026-10-06 | P6-19 posts committed Done, NeedsAttention, Cancelled, and PR-opened updates into the task's originating conversation. Persist one claim per task/state; include the verified PR URL when available, speak through the active voice status announcer, and use the existing Teams route while away. | `create_task` now records its source message. A dedicated SQL key avoids mixing notification deduplication with user-visible activity; event subscribers run after task-event commits. Focused tests cover conversation routing, voice wording, away routing and claim survival across store recreation. Live voice and Teams delivery remain unverified. | Implemented offline; live acceptance pending |
| 2026-10-04 | P7-10 searched Dan's configured OneDrive notes folder with Microsoft Graph keyword search. | Superseded on 6 October by P7-40; OneDrive configuration, setup script and `notes_search` were removed. | Superseded |
| 2026-10-06 | Dan's private `DanAakesen/vault` GitHub repository on `master` is the source of truth for durable knowledge. Jarvis automatically captures clearly stated preferences, people, project facts, decisions and unfinished tasks; SQL is an index/cache, not a second memory. Writes commit directly to `master` with a reason and Jarvis co-author trailer. | Reuses the existing GitHub App with Contents read/write on the vault, signed push webhooks, existing embedding deployment and SQL memory infrastructure. Writes verify stored Dan messages, enforce routing and size bounds, refuse secrets/credentials, and require the literal “remember” for banking/health details. Fake API tests cover indexing, search, retry, refusals and webhook signatures; App installation/live access remain unverified. | Implemented offline; Dan must install the existing App on the private vault before live acceptance |
| 2026-10-06 | P7-42 exposes the existing durable memories and GitHub vault notes through a Dan-only Settings API; no web UI changes or migration. Vault-note corrections commit to `master`; irreversible forget requests require the existing browser confirmation while Jarvis is present. | Issue #469 authorizes read/correct/forget for Settings, reuses the SQL history and vault index, and preserves GitHub App access. Bounded API tests cover pagination, source links, correction commits, browser approval gating and status. | Implemented offline; live GitHub and browser acceptance pending |
| 2026-10-07 | P7-43 adds a Dan-only graph/search API over the vault index and a `show_knowledge` workspace tool. Persist parsed link targets and per-note index timestamps in migration 0027; derive similarity from mean chunk embeddings with a 0.75 cosine threshold and cache the bounded graph until a successful sync. | Reuses the vault's indexed content and embeddings, keeps note IDs stable as SHA-256 path hashes, and caps responses at 2,000 nodes/8,000 edges. The shared renderer contract is backend-only here; browser rendering remains a separate UI task. | Implemented and tested offline; live vault and renderer acceptance pending |
| 2026-10-07 | P7-44 stores embeddings as JSON when SQL Server has no `vector` type, ranks them with application cosine similarity, and keeps lexical search as fallback. Backfill missing vault vectors in resumable sync batches. | Azure SQL's missing vector support must not disable semantic retrieval. Bound each sync to 4,096 embedding requests, persist complete note replacements, and log Foundry input-token usage without note content. | Implemented offline; production schema and Foundry billing remain unverified |
| 2026-10-07 | P9-23 records provider-reported Foundry chat/voice tokens, vision input/output tokens and memory-embedding input tokens by model and role. Add USD and DKK estimates only for known Foundry list rates; keep unknown rates, Codex research/image-generation charges and unsupported meters visibly unverified. Report daily UTC and monthly UTC totals, and count research/image calls from the existing tool-call audit. | Migration 0030 extends `dbo.usage`; migration 0029 is reserved by P9-14. Usage events contain no prompt, image, embedding text or tool arguments. The fixed 6.5785 DKK/USD conversion matches the existing vision estimate; values are not invoices. Offline tests cover route authorization, store idempotency, provider usage capture, embedding counts and period totals. Deployed Foundry/SQL data and billed amounts remain unverified. | Implemented offline; UI integration and live billing validation pending |
| 2026-10-07 | P7-45 adds Dan-only read access to Jarvis's own registered tools, feature list, repository files, code search, and issues/PRs. Use repository-scoped GitHub App installation tokens, default to `DanAakesen/jarvis`, and resolve any explicit project only from active registered projects. Treat all returned repository and issue content as untrusted; never expose tokens or persist tool arguments/results. | Reuses the shared tool registry and App issuer; bounds file/list/search/issue results and caches overviews by repository commit. No write capability or user PAT is added. | Implemented; Dan granted Issues read on 7 October, so issue summaries request it |
| 2026-10-07 | P9 ([#495](https://github.com/DanAakesen/jarvis/issues/495)–[#533](https://github.com/DanAakesen/jarvis/issues/533)): Dan approved a 39-task backlog from a gap audit. Models are chosen per role from the live Foundry catalogue with per-role reasoning effort; runtime deployment management and Claude as the chat model are in scope. | Dan wants full control of models and every tunable in Settings, and Jarvis must reach what it already has. The board runs at most four Copilot tasks at once to limit conflicts in shared settings code. | Planned |
| 2026-10-07 | The place where generated reports, apps, images and graph views are kept and reopened is called the **Folio**; task recipes are renamed **Routines**. | Dan asked for better names than "windows", "research" and "recipes". Old recipe tool and route names stay as aliases for one release. | Folio remains with #519; P9-35 implements the routine names and aliases offline ([#529](https://github.com/DanAakesen/jarvis/issues/529)) |
| 2026-10-07 | Declined from the audit: verbosity and max-token settings, notification preferences, an effective-config view, settings history, arbitrary local-folder and browser-history access, and outbound notifications. | Dan's choice on 7 October. Do not file these again without a new request. | Declined |
| 2026-10-04 | Autopilot decisions by the coordinator at Dan's request ("take decisions as you think I would"; only truly Dan-only items stay in Needs Dan). P8-12: Escape ends voice and a labelled End voice control sits by the orb (DESIGN.md). P8-18: initial renderer, action and theme-token allowlists (ui.md); no generated code runs. P3-08 waits for the new shell and visual system | Unblocks the UI track; recorded on each issue for Dan's review | Decided on autopilot; Dan to review |
| 2026-10-04 | P8-14 keeps the version-1 generated-view JSON Schema, TypeScript union, and runtime validator together in `@jarvis/contracts`. The authorized tool route validates tagged view results before returning or recording them; the signed-in Now panel uses the same contract for its bounded list fixture. Views and their source metadata stay transient; renderers receive data as React text/approved links, never executable markup. | One shared package prevents backend and browser allowlists from drifting. The 256 KiB envelope, per-renderer bounds, source/page status, registered-tool references, and configured Blob host are checked offline; no persistence or new data integration is needed. | Contract, backend route, and signed-in UI tests pass; live Entra and Azure source behavior remain unverified |
| 2026-10-04 | Autopilot decisions for P7 (Microsoft paths first): away mode by voice plus Teams presence (Graph); Teams bot confirmations with Speech F0 and a fixed confirmation list (merge, delete, send mail, calendar changes, repository creation, computer use outside the browser, spending money); screen/camera vision on the existing Foundry account with a 300-frame daily cap; .NET 10 tray PC bridge with an allow-list; Windows UI Automation for computer use; Google Gmail and Calendar APIs using OAuth for Dan's personal account; notes folder and SQL memory were initial implementations. | Each choice is on its issue. Vision and embeddings are pay-as-you-go Foundry usage like chat, with caps. P7-14's separate provider decision is recorded above; it uses the existing subscription, not a new API service. | Google mail/calendar confirmed in P7-22; P7-40 supersedes notes-folder search and SQL as the durable knowledge source |
| 2026-10-04 | Left for Dan (Needs Dan column): Teams calling's per-minute ACS cost (P7-01), paid image generation and video (P7-15) | These needed a new paid service approval or information only Dan had. Dan's 5 October decisions approved existing-subscription image generation, rejected a paid image API, and deferred video indefinitely. | P7-15 provider decision resolved; P7-01 and artifact retention remain open |
| 2026-10-05 / 2026-10-06 | P7-04 uses Jev from TypeSafe AI at `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest` (pin `jev-1.13.0` after confidence tuning). The API key is `jev-api-key` in Key Vault, read only by the backend managed identity; Dan provisions it after merge with his external `set-jev-key.ps1`. Only a high-confidence, addressed, non-confirmation action may execute a registry tool marked `reflexSafe`; all other requests go to the main agent. Use TypeSafe's calibrated Choice confidence (minimum intent/route confidence, gate 0.9), not a self-rated Score; address/complete-command use 0.9 and confirmation uses 0.5. Log provider failure type through the allowlisted `reflex.decision` event without keys or transcripts. English Voice Live uses semantic VAD with automatic response disabled so the backend can classify and act before requesting speech. | Dan confirmed endpoint/model/key placement and the $0.042 per million input-token cost (output tokens free) on 5 October 2026; P5-12 follows the TypeSafe [llms.txt](https://docs.typesafe.ai/llms.txt), [confidence guide](https://docs.typesafe.ai/confidence.md), and [function-calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling). Fake-provider tests cover confidence gates and typed, content-free failures. No new Azure role was needed because the backend identity already has Key Vault Secrets User. | Implemented offline; Dan's Key Vault provisioning and live Jev/Voice Live checks remain |
| 2026-10-04 | Visual direction: Concept B (living aurora) as the dark default and Concept C (daylight studio) as the light appearance; P8-20 (#282) builds the shared visual and motion system | Dan asked for a stunning, animated UI that feels alive, especially in voice mode, and for decisions on autopilot. B's audio- and state-driven fluid orb carries information through motion; C proves the light theme keeps the same states. Concepts and screenshots in docs/ui/concepts | Decided on autopilot; Dan to review |
| 2026-10-04 | P8-05 separates voice entry from microphone permission: the input orb starts a relay, readiness and reconnect keep capture off, and Enable microphone is an explicit action. Keep draft/language in the mounted conversation component; hide history/input during voice and restore focus on terminal states. | Meets the agreed typing-default and no-automatic-listening boundary without changing backend protocols. Existing neutral tokens remain until P8-20; fullscreen/window transitions and final voice-end behavior stay with P8-10–P8-12. Focused web tests cover keyboard, draft restoration, send failure, partial replies, permission denial, stop during activation and reconnect. | Implemented offline; physical audio and live Azure remain unverified |

| 2026-10-04 | P8-13: persist `appearance.theme` as the validated `light`/`dark` setting through P1-11, defaulting to light. Apply semantic CSS variables only after the settings API accepts an update; leave custom/Jarvis-directed variable editing disabled until P8-17 implements the validated path using P8-18's allowlist. | Reuses the existing global settings key/value store without a migration, and prevents rejected updates from replacing the last accepted client theme. API/client tests and scratch Chromium checks cover persistence, rejection/retry, reload, keyboard focus, contrast and responsive layout; live Entra/API/SQL behavior remains unverified. | Implemented offline |
| 2026-10-04 | P8-20: keep both appearances and shared visual/motion tokens in `apps/web/src/styles.css`; use a CSS-only aurora, and drive the orb only from observed runtime activity and decoded playback PCM. Track chat and voice work as separate client activity sources; pause CSS animation in hidden tabs and reduce movement to fades/static shapes under reduced motion. | This reuses browser/runtime data and needs no network assets, dependencies, or persistence. Focused Vitest, lint/build, Chromium checks and contrast calculations pass; the local speaking capture uses a scratch WebSocket relay and PCM fixture, so live voice, Entra, API and SQL behavior remain unverified. P8-16 now supplies tool-call events; workspace window feedback follows applied P8-15 create/update commands rather than inferred state. | Implemented offline |

| 2026-10-05 | P8-21: reuse P8-20 tokens for a floating, auto-growing composer, inline DA/EN pressed buttons, divider-free speaker-specific messages and relative metadata. Keep keyboard arrangement behind Arrange; titles/edges provide direct pointer manipulation. | Presentation-only polish preserves draft, voice-entry permission, history and workspace contracts. Metadata stays visible on touch/reduced motion; state changes do not wait for animations. Tool shimmer is gated on explicit tool-call state, never inferred from thinking. Local fixtures are labelled separately from production evidence. | Implemented offline; live auth/voice and agent-delivered windows remain unverified |
| 2026-10-05 | P8-22: show Jarvis once on home and add the area plus most-specific registered page on deeper breadcrumbs; expose each window's keyboard Arrange actions from an accessible ellipsis disclosure while keeping the workspace-level tile/layer control. | Removes repeated brand text and title-bar clutter without losing keyboard movement, resizing or Escape focus return. Chromium checked 1440×900 and 390×844 in both appearances, 44px targets, bounded overflow, the deep breadcrumb and reduced-motion state. Screenshot-only fixtures add their footer outside the app; the production bundle and rendered shell omit it. Phone voice layout remains P8-11. | Implemented offline; live auth and agent-delivered windows remain unverified |
| 2026-10-05 | P8-16: publish typed, ephemeral `listening`, `thinking`, `tool-call-started`/`tool-call-finished`, `speaking`, `interrupted`, `reconnecting`, `failed`, and `ended` events through the existing owner-authenticated `/now/events` stream. Include only activity ID, source, state and, for tools, name plus normalized `ok`/`refused`/`error` outcome. | A strict shared validator rejects unrecognized fields; the in-memory hub introduces no persistence. Chat tool events follow recorded outcomes, while realtime voice events reflect observed relay events and output audio (including P7-12 announcements), avoiding duplicate announcements. Listening is gated on relay readiness and observed microphone audio. Mocked contract/backend/web tests cover transitions, cancellation/disconnect, payload privacy and SSE consumption. Local browser acceptance is recorded in `docs/agent-context.md`; live Entra, Foundry and physical audio remain unverified. | Implemented offline |
| 2026-10-05 | P7-17: run browser work in the backend through `browser_do`; reuse P7-04 Jev credentials/routing, P7-18's observed indexed actions and P7-03 confirmation, and P8-15/16 for transient workspace progress/activity. Bound a run to 20 steps and 30 seconds; use the existing `gpt-5.6-luna` deployment with reasoning off for TYPE JSON and independent DONE verification. | Model output never supplies selectors, coordinates, scripts or commands. The bridge remains the freshness/occlusion and high-impact-action boundary; sensitive input is refused. No new dependency or persistence is needed. Fake-based tests cover operation/target decisions, typing, fallback, stop, bounds, verification, redaction and risky-click approval; fake median step latency is 0.07 ms excluding page loads. Live Jev, Foundry, Chrome and approval delivery remain unverified. | Implemented offline |
| 2026-10-05 | `DanAakesen/jarvis` is public so GitHub Actions minutes and Copilot agent runs are free; the Actions budget is set to $20 with "Stop usage" enabled | October's private-repo Actions usage (about 18,000 minutes, about $96) broke the free-services rule (L89). Before switching, the full history was scanned: no secrets reached GitHub (the App key existed only in a local Copilot checkpoint). Public exposure is limited to non-secret IDs, resource names and code. Verified: CI run 37267827742 succeeded after the budget was exhausted | Done by Dan |
| 2026-10-05 | Browser work uses the Jev browser agent (P7-17), Dan's Chrome through the PC bridge (P7-18), and shared-tab flow (P7-19); browser-use/jev-ultrafast is inspiration only, not a code source. P7-07 separately controls allow-listed Windows apps through UI Automation in the existing bridge and Jev, with no Foundry computer-use. Websites always use the Chrome path, including the disconnected-extension fallback. | Dan's current P7-07 scope in issue #205: reuse the authenticated bridge, Jev and existing approval outcomes; keep website navigation in Chrome and do not use Foundry computer-use. | Accepted; P7-07 implemented offline, live acceptance pending |
| 2026-10-05 | P7-18 keeps Chrome automation inside the existing .NET PC bridge. It is off by default behind a persisted tray toggle and uses a single fixed-action executor that snapshots DOM nodes once per step; the executor retains node references and refuses stale, hidden, covered, or sensitive targets. Fixed actions only—never model-provided script, selectors, or coordinates. Risky clicks use P7-03's single-use `computer_use` confirmation; browser tool arguments/results are redacted from generic tool-call auditing. The transport was initially loopback CDP; P7-25 adds the extension transport and preserves CDP only as fallback. | Reuses the authenticated Dan-only bridge without another backend service, credential, persistence layer, or dependency. Fake-CDP and backend tests cover the original offline protocol; real Chrome/profile and local-page desktop verification still need Dan's Windows PC. | Implemented offline; live Chrome check pending |
| 2026-10-05 | P7-25: drive Dan's normal Chrome profile through a Manifest V3 extension and Chrome native messaging, registered under HKCU by the bridge installer. Prefer the extension when connected; retain loopback CDP as fallback. The tray toggle remains off by default. The native host relays to the running bridge over a current-user-only named pipe; the extension does not accept external messages, Chrome displays its debugger notice while attached, and the executor detaches after each completed action with a 30-second idle fallback. | Chrome 136 ignores `--remote-debugging-port` on the default user-data directory, so CDP cannot attach to Dan's normal profile. Reuse the existing C# CDP executor through the extension debugger API rather than duplicating its safety checks; preserve indexed freshness/occlusion checks, sensitive-input blocking, and P7-03 confirmations. Dan loads the unpacked extension once in `chrome://extensions`; a private Web Store release is a later option. Fake-extension/CDP contract tests and a Windows-target build pass; “open google.com” and “search for X” in Dan's normal profile remain live acceptance. | Implemented offline; live acceptance pending |
| 2026-10-05 | P7-26 routes validated website URLs through the connected Chrome extension when its existing automation toggle is on. Open a new active tab and focus its Chrome window with `drawAttention`; only a disconnected extension uses the installed Chrome executable directly, never the Windows default browser. If the extension is connected but automation is off, refuse the request. For launched apps and VS Code folder opens, use Windows `AllowSetForegroundWindow` to grant the launched process foreground eligibility. | Reuses P7-18/P7-25's authenticated bridge, native-messaging port and executor contract, while P7-20 URL reflexes and `browser_do` navigation converge on `pc_open`. Fake extension and disconnected-fallback tests, reflex/browser-agent tests and the Windows-target build pass; Dan's normal-profile foreground-tab acceptance remains unverified. | Implemented offline; coordinator live acceptance pending |
| 2026-10-05 | P7-07 controls only allow-listed VS Code and File Explorer foreground apps through the existing authenticated bridge. `pc_act` uses one Jev decision per fresh, bounded UIA snapshot; typed values must be explicitly quoted and non-sensitive, and destructive actions reuse P7-03 approval. No Foundry computer-use, screenshot, new persistence, or migration is added. Website work stays on the Chrome-only P7-17–P7-19 path. | Reuses the bridge command/audit contract and existing Jev key. Fake-tree/backend tests cover app allow-listing, stale/sensitive controls, cancellation, bounds, redaction and approval; live Windows UIA, Jev and physical approval checks remain unverified. | Implemented offline; live acceptance pending |
| 2026-10-06 | P7-32 expands `pc_act` to any foreground installed Windows app through the existing bounded UI Automation bridge; retain Jev per-step decisions and sensitive/stale/bounds/redaction protections. Confirm only irreversible send, delete, pay/payment, purchase, post, push, or overwrite actions through existing P7-03 `runConfirmed`. Add a persisted **Pause Jarvis control** tray toggle that refuses PC control actions while paused and reports the state in the existing Now activity row. Keep websites on Chrome and do not add raw shell or Foundry computer-use. | Reuses the authenticated bridge, settings, and status activity row; no migration, credential, or new service. Fake-tree and backend protocol tests cover non-allow-listed app control, pause/resume, status, and approval; live Windows UIA, Jev, and physical approval remain unverified. | Implemented offline; live acceptance pending |
| 2026-10-06 | P7-33 opens VS Code repo files/folders only beneath `C:\Repo`; Codex launches through P7-31's installed-app matcher and prompt entry/submission reuses P7-32's `pc_act` and pause-gated UI Automation path. Use Factory `create_task` for tracked repository work and local Codex for quick edits. | `RepoPathResolver` rejects traversal, missing/wrong-kind paths and reparse-point escapes. Codex input is redacted, sensitive content remains blocked, typing is not approval-gated, and incomplete submission does not report success; irreversible actions reuse `runConfirmed`. No second launcher, UI Automation path, app allow-list, Edge, raw shell or migration is added. | Implemented offline; live Windows/Codex/approval acceptance pending |
| 2026-10-05 | P7-19 resolves Dan's shared Chrome tab using only the current vision description and selected display label against live bridge tabs, then runs the existing P7-17 agent via P7-18. Ask Dan when no unique tab matches; keep the context transient, and route shared voice intent away from focused-tab reflex. | Reuses existing screen sharing, bridge, agent, confirmation and workspace contracts. No new bridge, persistence, dependency, or key is needed. Fake tests cover resolution, ambiguity, offline fallback, execution, stop, and confirmation. Live form, Jev/Foundry, Voice Live and physical approval remain unverified. | Implemented offline |
| 2026-10-05 | P7-01 spike: Dan selected Teams Phone extensibility and the cheapest available Danish Teams service number; Dan will purchase the number. Microsoft Learn says a Teams Phone service number assigned to a resource account is required (Calling Plan, Operator Connect, or Direct Routing), so the original no-number/free-first path isn't documented as supported. The guide requires an ACS project connection, a Foundry telephony binding using the resource-account GUID, and an authenticated Event Grid `IncomingCall` subscription to the binding's service-generated URL. | Dan's issue comment estimates a Danish number at about 15 DKK/month via Operator Connect or 20 DKK/month via Calling Plan and ACS usage at 0.01–0.03 DKK/min; these are estimates, not an official Danish quote or a live bill. Sources: [Foundry telephony channels](https://learn.microsoft.com/azure/foundry/agents/how-to/voice-agent-telephony-channels), [voice agent with a hosted conversation engine](https://learn.microsoft.com/azure/foundry/how-to/voice-first-with-hosted-agent), and [Teams Phone extensibility](https://learn.microsoft.com/azure/communication-services/concepts/interop/tpe/teams-phone-extensibility-overview). This repository already provisions `jarvis-voice-mai` as a `kind: voice` wrapper around hosted agent `jarvis` via `VoiceHostedAgentConversationEngine`; it is a plausible binding target, but TPE compatibility is not live-verified. Foundry documents caller numbers in trace spans, but no trusted caller identity passed to the hosted agent's backend tool requests was verified; those routes authorize the Jarvis app identity, not a phone caller. The coding agent has no tenant access, no number was purchased, and no call, tool invocation, or latency was live-tested. | Documentation spike only; implementation and live acceptance blocked until a supported voice-session path can pass verifiable Dan caller identity to backend tools |
| 2026-10-05 | Raise model deployment capacity: `gpt-5.6-luna` 100, `gpt-realtime-2.1` 10, `text-embedding-3-small` 20 (Global Standard) | Dan's first live chat failed with `rate_limit_exceeded` from the hosted agent's model call (Application Insights dependency `invoke_agent jarvis:25`, 500). Capacity 1 allowed 1,000 tokens and 1 request per minute, less than one chat turn with Jarvis's tool definitions. Swedencentral quota: 1,000 for Luna and embeddings, 10 for realtime. Global Standard is billed per token, so this changes rate limits, not cost. Supersedes the 3 October "capacity 1" row as that row allowed | Accepted (coordinator, per the earlier "increase if testing shows rate limits" decision) |
| 2026-10-05 | P3-16 runs a bounded stale-Running scan at startup and every five minutes; after five minutes without a heartbeat, verify the recorded Foundry invocation and reconcile completion through GitHub PR mapping and the existing project policy. Only that verified path may complete a task; failed or indeterminate outcomes become Needs attention with an event summary. | A missed completion or webhook can otherwise leave a task Running after its sandbox stops. The issue reports PR #1 opened before webhook activation, but Foundry invocation and task-event history were unavailable here and GitHub returned 404 for that PR, so the specific live root cause remains a hypothesis and the production task has not yet been reconciled. Focused fake-client tests cover lost completion, live/failed runners, and GitHub unavailability; no schema change is required. | Implemented offline; production reconciliation and root-cause verification pending |
| 2026-10-05 | Danish voice returns to MAI Transcribe (`mai-transcribe`, `da`, phrase list) | P7-20 (#315) changed the Danish voice agent to `gpt-4o-mini-transcribe` for partial transcripts; after the automatic re-provisioning, every live Danish session closed within a second (`voice.reflex_metrics` with 0 deltas, UI stuck on Reconnecting). The previous setting was live-working | Accepted (coordinator fix); Danish partials need a model verified live with `da` and the phrase list |

| 2026-10-05 | P8-26 queues chat submissions locally in FIFO order, capturing language at Send/Enter; retain failed-turn feedback and offer Stop reply without changing voice. | One in-flight client turn avoids overlapping requests without backend changes. The next submission starts only after the previous promise and stream cleanup settle; Stop does not undo completed tool actions. The queue is not persisted across navigation/reload. Focused tests and scratch-auth/API Chromium checks cover desktop/phone, dark/light, removal, language, double Enter, Stop/next, error/next and reduced motion. | Implemented offline; live Entra/Foundry acceptance unverified |
| 2026-10-05 | P8-28 owns the production 3D room, live mirror-floor reflection and orb-received lighting on the Jarvis route only. Dynamically load Three.js with the Jarvis stage; dispose its renderer/listeners on teardown, pause hidden tabs and honor reduced motion. Keep HTML controls authoritative and keep Factory/Settings free of the canvas. | The accepted scene must remain centred and live, respond to orb light/theme rather than a raster backdrop, and preserve the existing shell/contracts. Focused lifecycle/route tests, lint/build and scratch-fixture Chromium captures exercise fallback, theme, phone/desktop sizing and state changes. Three.js is `0.180.0` (MIT); transition flicker and hardware/live-device acceptance remain follow-ups. | Merged in PR #375; physical hardware/live voice remains unverified |
| 2026-10-05 | Web sign-in uses `loginRedirect` to the site root instead of `loginPopup`; supersedes the popup part of the 3 October P0-09 row. `/redirect.html` stays the `redirectUri` for silent (iframe) renewal (L63) | Dan's choice: the popup was blocked in the Copilot app's embedded browser ("The sign-in window could not open"), and a sign-in screen has no state worth keeping across a reload. The site roots are already registered in Entra (`http://localhost:5173` and the production Static Web App root in `bootstrap.output.json`). Offline tests cover redirect start, return handling, refusal and error codes; `auth.test.ts` is now in the Vitest include list (it was never run before). Locally, the embedded browser reached Entra with `redirect_uri=http://localhost:5173/` and Dan completed sign-in (`Welcome, Dan Aakesen`, `/me` succeeded) | Implemented; local live sign-in verified, production sign-in to confirm after deploy |
| 2026-10-05 | P8-35 supersedes the busy-control and Stop behavior of P8-25/P8-26: Enter/Send steers the current turn, Ctrl+Enter queues, and Send, language and voice controls remain available during replies. No Stop reply button; steering replaces it (Dan, 5 Oct). | Streaming steering preserves the partial reply and continues in the same turn. Tool rounds are not cancelled; new Dan messages are consumed at the next round boundary, with existing confirmation gates intact. The per-conversation in-flight registry is process-local; cross-replica coordination is not provided. Offline regression tests cover the interaction and no-parallel-turn behavior; Chromium captured desktop/phone streaming states in both themes using scratch fixtures. Live Entra/Foundry remains unverified. | Implemented offline; live acceptance pending |
| 2026-10-06 | P8-36 replaces the voice orb/status disc and DA/EN buttons with Dan's selected Luminous Glass bar: More (•••), a state glyph with runtime label, and End voice. A shared More menu with a Language flyout (Danish/English, checked choice) serves the voice bar and the composer. Mute, Look at screen and Look at camera move into More; Enable microphone stays an explicit bar action. | Status precedence is truthful: the transport owns connecting, reconnecting, stopping and failure over runtime activity, and listening is shown only with the microphone open. Changing language mid-session applies to chat and the next voice session, and the bar states the language the current session continues in; no live switch is implied. Escape closes the flyout, then the menu, before ending voice. Glass edges reuse stage cyan/amber tokens on the shared `.luminous-glass` surface. Web tests, lint and build pass; scratch Chromium fixtures cover desktop/phone/320px in both themes and reduced motion. Handoff in draft PR #400. | Implemented offline; live voice/device acceptance pending |
| 2026-10-06 | P8-37 implements the Architectural Glass shell, composer and message window in one PR. The paperclip maps to the existing screen/camera visual-context actions (no file upload exists, so none is invented), reusing `ConversationMoreMenu` without its Language row. After review, history is not a separate window: it is registered as the shared workspace view `conversation`, and the transcript is portalled into that window, so tabs, geometry, focus, the snapshot and Jarvis commands reuse WorkspaceController. ConversationHistory keeps the chat session, composer and voice controls mounted outside it. Voice entry minimises the view and voice exit restores it; Close hides it until the next send or Conversation navigation. Author names stay as visually hidden text. Selection uses complete `--glass-selected` surfaces with a full glow ring. | Issue #398 acceptance criteria; approved references in `docs/ui/shell-styling/` and `docs/ui/chat-voice/`; `docs/ui/screenshots/p8-37-*` fixture captures | Implemented |
| 2026-10-07 | P9-08 routes chat deployments whose selected model name begins with `claude-` through the Anthropic Messages API on Foundry. Authenticate with the hosted agent's `DefaultAzureCredential` and `https://ai.azure.com/.default`; translate the existing backend tools and tool results, and map shared reasoning effort to a bounded extended-thinking budget. Keep voice and non-Claude chat on Responses. | The provider adapter reuses the existing project resource, identity and backend tool dispatcher; it adds no public contract, UI or database change. Offline tests cover endpoint resource resolution, managed-identity token scope, tool conversion, streamed chat/tool rounds, usage and sanitized provider errors. This coding-agent worker had no `FOUNDRY_PROJECT_ENDPOINT` and could not acquire an Azure token, so the live endpoint/auth spike remains pending. | Implemented offline; deployed Foundry auth and model acceptance pending |
| 2026-10-08 | GitHub issues are the single backlog and source of truth for all work. The Software Factory and Copilot are executors: an issue labelled `Jarvis` is started by the Factory with the `codex` agent (Dan's default for Jarvis-raised work), an issue labelled `Copilot` by Copilot. The Factory's SQL task row stays the execution record and links to its issue; PRs use the issue's task ID in the title and `Fixes #N`. The Factory board shows the GitHub Project columns (Backlog, Needs Dan, Ready, In progress, In review, Done). Jarvis-raised issues use the rolling `P11-NN` phase. | Task 10 (8 October) showed Factory tasks living only in SQL: invisible to the backlog, PLAN and the merge gate, without traceability or conflict awareness. One backlog keeps every executor, the board and the gate aligned. | Decided; P10 in progress |

### P7-23 latency evidence

5 October 2026 follow-up to reopened [#327](https://github.com/DanAakesen/jarvis/issues/327):
keep reflex safety/auditing and its 800 ms parallel classification budget unchanged.
Overlap chat settings with catalogue/live-context reads, retain the existing
60-second container catalogue cache, and leave memory retrieval/embedding on demand.
Do not cache live settings/task data or repeat #344's earlier opaque session-routing
attempt, which #356 reverted after Foundry rejected chat invocations. P9-84
supersedes that historical routing decision using the documented Invocations query
parameter and a validated owner-scoped UUIDv5.

| Evidence | First text / total duration | Source and limitation |
| --- | --- | --- |
| Original deployed baseline, 09:03–09:06 UTC | Backend turns 11.0, 11.7, 11.9, 16.8 s; hosted invocation 3.1, 4.8, 5.4 s; model 0.35, 0.79, 1.36 s | Application Insights/backend measurements supplied in #327; not independently queried here |
| After #329, 10:41–10:43 UTC | `agent_first_byte` 8.8, 10.2, 11.5, 9.2 s; whole turn ends ~0.5 s later; Jev ~0.2 s | Coordinator's live issue comment; acceptance still missed |
| 10:42:49 turn breakdown | Backend agent call 10:42:49.5 → `invoke_agent` 10:42:54 (~4.5 s); model starts ~10:42:57 (~3 s prep), takes 0.44 s | Coordinator's Application Insights evidence; gateway/container attribution remains a hypothesis |
| Latest reported live baseline | First word 9–19 s | Coordinator's reopening/status comment |
| This change, local HTTP smoke | First mock delta 0.005 s; done 0.757 s; delta-to-done gap 0.752 s | Actual Hypercorn + HTTP client with fake backend/model and a deliberate 0.75 s pause; proves local incremental delivery, not deployed performance |
| This change, deployed after | **Not measured** | No authenticated Azure CLI account in this environment; no deployment or paid invocation performed |

New agent `chat.latency` logs and spans/events identify verification, settings,
catalogue/cache, live context, memory retrieval, prompt build, Responses creation,
model first delta and first SSE delta out. Logs contain phase/duration/outcome
only, and stage spans disable automatic exception-content recording. Embedding
is backend-owned and already emits content-free `memory.embedding` timings.
Backend `turn_first_token`/`turn_complete` include pre-agent SQL setup and completed
assistant persistence; `agent_first_byte` still counts text only, not the initial
SSE comment. The first-delta-out duration starts at agent handler entry, allowing
comparison with backend latency to isolate work outside the container.

Configuration inspection: `infra/main.bicep` sets **backend** minimum/maximum
replicas to one. `.github/workflows/deploy.yml` sets the **hosted Jarvis agent**
session idle timeout to 120 seconds and routes 100% of traffic to the active
version; it does not declare an always-warm agent replica. Installed official
`azure-ai-agentserver-invocations` SDK `_dispatch_invoke` and
`_wrap_streaming_response` pass the response/body chunks through, and the model
adapter requests `stream=True`. Gated ASGI tests prove a Responses text delta
reaches SSE before `response.completed`, including disconnect cleanup. No
buffering was reproduced locally. Public Microsoft Learn retrieval was blocked
in this environment; no undocumented replica/session option was added.

Post-deploy verification: send repeated short “hi” turns, including a first
invocation and another after >120 seconds idle, and record the deployed agent
version/time window. Compare `turn_first_token`, `turn_complete`,
`agent_first_byte`, agent `first_delta_out`, preparation spans and `invoke_agent`
start timestamps. Do not treat headers or keepalive comments as tokens.
This Application Insights query returns only backend timing dimensions:

```kusto
traces
| where timestamp > ago(1h)
| where message == "chat.latency"
| extend phase = tostring(customDimensions.phase),
         durationMs = todouble(customDimensions.durationMs)
| where phase in ("agent_first_byte", "turn_first_token", "turn_complete")
| project timestamp, operation_Id, phase, durationMs
| order by timestamp asc
```

Correlate those operations with agent stage spans/events and the hosted
`invoke_agent` dependency before attributing a gap to cold start or routing.
Acceptance remains **pending** until Application Insights shows ≤2.5 s first
text and ≤4 s complete short reply. Offline checks: 148 hosted-agent tests,
92 focused backend tests, agent Ruff/compileall and backend lint/build pass.

### P7-24 live transcription evidence

Coordinator test on 5 October 2026, using synthesized Danish and English streamed in real time against the same Foundry resource:

| Engine | Partial text while speaking | Final text | Danish quality |
| --- | --- | --- | --- |
| Voice Live + `mai-transcribe` | None | About 0.05 s after speech end | Correct (“Jarvis”, “København”) |
| Voice Live + `gpt-4o-mini-transcribe` | Only after speech end (6.5–6.7 s; speech ended at 6.3 s) | About 0.5 s after end | “Chavis”; also unsupported with Voice Live agents (Microsoft docs) |
| Azure Speech real-time STT (`da-DK` / `en-GB`, phrase list) | Yes: “Jarvis” at 0.95 s, “åbn min browser og” at 2.6 s, “Jarvis open my browser” at 2.3 s; sentence ended at about 5.8 s | At speech end | Good; “Google” was heard as “kogle”, so Google is included in the phrase hints |

## Learnings

Mistakes made so far and the rule that prevents each one.
| # | Area | What happened | Rule |
| --- | --- | --- | --- |
| **L1** | Foundry agent routes | The `/agents` list route returned `Project not found`, and the deploy script treated it as an Azure block. | Create and check agents through `/agents/{name}/versions`. Prove any "Azure is blocking us" claim with a direct API call. |
| **L2** | Foundry names | Recreated account and project names kept stale state for over an hour. | Never reuse a deleted account or project name; generate timestamped names. |
| **L3** | Sandbox size | 0.5 vCPU / 1 GiB failed with `ImageError`. | Use at least 1 vCPU / 2 GiB. |
| **L4** | Steering | A correction queued behind the running turn and changed nothing. | Interrupt with ACP `session/cancel`, then send the correction as the next turn. |
| **L5** | Pause | Stopping the sandbox mid-turn lost the turn. | Pause with ACP `session/cancel`, then let the sandbox idle out. |
| **L6** | Codex login | The prototype copied Dan's PC login into every sandbox; the first renewal would have signed out one copy. Replaced by a Jarvis-only login on 2 October 2026. | Follow the [Codex login rules](architecture.md#sandbox-credentials). |
| **L7** | Azure tenant | Dan's Azure CLI defaults to the Microsoft tenant; wrong-tenant tokens returned misleading 404s. | Target the Novaro subscription explicitly in every script. |
| **L8** | Monitoring | Application Insights created a managed workspace outside the resource group. | Create the Log Analytics workspace in the resource group first. |
| **L9** | Runner | Copilot needed a writable home and non-interactive mode; ACP calls timed out. | Writable session home, Copilot `--allow-all`, and an ACP timeout above the longest turn. |
| **L10** | Endpoints | The driver used the runtime host for administration calls. | Store both endpoints ([coding sandbox](architecture.md#coding-sandbox)). |
| **L11** | AI delivery | A builder agent spent 2.5 hours polishing teardown edge cases and declared its own work done. | Builders never review their own work; fix the main blocker first. |
| **L12** | Codex renewal | OpenAI's docs say Codex renews after 8 days, but the current client renews only 5 minutes before the 10-day access token expires. A renewal based on `last_refresh` did nothing. | Check vendor behavior in the current source. Trigger Codex renewal on the access token's expiry date. |
| **L13** | Tool versions | The company npm mirror's `latest` Codex was a Windows-only alpha with no executable. | Pin CLI versions (Codex 0.157.0 worked) locally and in the sandbox image. |
| **L14** | Sessions | The deploy script's Key Vault check left its session running, which blocked renewal. | Every component that opens a session deletes it. |
| **L15** | Danish speech to text | Azure Speech `da-DK` turned English names into Danish-sounding words ("Jarvis" → "jobes", "dark mode" → "dog mode"); the phrase list did not help. With no language set, it heard German and French. | Use MAI Transcribe with language `da`. Always set the language. |
| **L16** | Spoken confirmations | The model said "Jeg har sagt det til Codex" after creating a new task instead of steering the existing one. | Strict action rules in the instructions; speak confirmations from the backend's tool result. |
| **L17** | Voice cold start | The first hosted-agent turn of each call took ≈5 s; later turns ≈3 s. | Warm the agent session when a call connects, with a message that needs no model. |
| **L18** | Hosted agent settings | Setting `FOUNDRY_PROJECT_ENDPOINT` failed: `FOUNDRY_*` and `AGENT_*` variables are reserved. The tool log failed silently because Table storage treats Python integers as 32-bit. | Let the platform inject its variables. Store large integers as Int64, and give every agent a no-model status command (`/diag`). |
| **L19** | Voice tests | Results were wrong three ways: the container clock differed from the PC's, earlier commands changed the data for later ones, and replies were fully generated before an interruption. | Match logs as "new since the command", use a fresh session per scored command, and measure interruption as detection while audio still plays. |
| **L20** | Windows scripts | `az` is a `.cmd`, so `&` in a URL split the command; the Danish culture wrote times with "." and Azure rejected the budget dates. | No `&` in `az` arguments; format dates with the invariant culture. |
| **L21** | Voice bridge drop | In a noisy room, two speech fragments 0.4 s apart reached a freshly started hosted agent; interrupting its first answer ended the preview voice bridge (`bridge_session_ended`). Intermittent: 1 of 4 reproductions. | Warm the agent with a silent no-model message before opening the microphone; reconnect automatically when the bridge ends. |
| **L22** | Sandbox crash | A forced crash mid-turn lost the cloned repository and the agent's conversation; resume then reported `completed` with no branch or PR. Foundry persists session files only at certain points, not continuously. | Push work to the task branch often; recover by restarting from the branch; never trust `completed` without checking GitHub for the branch and PR. Detect a crash by HTTP 424/404/5xx on two polls or for 30 s, not by an event gap. |
| **L23** | Sandbox disk | Every sandbox size had a 6 GiB writable disk (docs: up to 20 GiB), about 3 GiB free with a .NET image; a full .NET solution restore (2.4 GiB of NuGet packages) filled it. | Keep sandbox images small, build single projects, and run full builds in GitHub Actions. |
| **L24** | Cloud GitHub access | Git fetch worked, but issue and PR API calls failed with a proxy CONNECT 403 because `api.github.com` was absent from the cloud environment allowlist. | Allow `api.github.com` in cloud network settings for issue and PR operations. A successful Git read does not prove GitHub API access; diagnose networking before requesting credentials. |
| **L25** | Provider startup and cancellation | Independent review of the runner port reproduced a leaked process after failed ACP initialize/session-load and a cancelled credential-loading turn that later started provider work. | Own and await the invocation worker and its locally constructed client throughout startup and cleanup. Keep the session lock until provider and credential-file cleanup finishes, so cancelled or failed turns cannot continue work or affect the next turn. |
| **L26** | Container readiness | The Docker image built, but an immediate health request failed with curl exit 56; retrying only refused connections did not cover startup resets. | Poll the real health response with bounded retries covering startup resets and a per-attempt timeout. Keep the health, CORS, secret-filtering and shutdown assertions after readiness succeeds. |
| **L27** | ACR build context | Review of issue #28 found that ACR uploads `runner/` as its source root, while `--file runner/Dockerfile` would resolve to a nonexistent nested path. Local Docker builds did not exercise the ACR path contract. | Pass Dockerfile paths relative to the uploaded ACR source context (`Dockerfile`, `Dockerfile.dotnet`). Check the actual workflow commands against that context; keep local Docker and ACR path semantics distinct. |
| **L28** | Invocation metadata | Two successive turns in one session overwrote its single `task-state.json`; after clearing in-memory state, polling the older invocation returned 404. The runner regression now reloads both turns through the real GET handler. | Persist metadata by invocation identity, using a path-safe digest, and retain reads of the older session record. Store only identifiers, status, and timestamps; protect prompts and credentials from persistence. |
| **L29** | Nested ESLint configs | Combining the backend and Foundry client loaded both `eslint.config.js` and a nested `eslint.config.mjs`; typescript-eslint rejected multiple inferred config roots even without typed rules. | Give an explicitly selected module config a non-default filename (the Foundry client uses `lint.config.mjs`) so workspace lint uses its own config. If multiple discovered configs are intentional, set their parser `tsconfigRootDir` explicitly. |
| **L31** | Authentication and CORS | A regression with an explicit business OPTIONS route returned 204 before the later authentication hook ran; CORS completed the request in its own `onRequest` hook. | Install root authentication before CORS. Exempt only the registered health GET/HEAD and generated wildcard preflight route, then test explicit business OPTIONS and nested routes through real request handling. |
| **L32** | Fastify lifecycle hooks | The shutdown test attached its close hook after module plugins had completed `ready()`. Fastify rejected it with `FST_ERR_INSTANCE_ALREADY_LISTENING`, so the test could not observe cleanup. | Register lifecycle hooks before `ready()` or `listen()`. Keep the test asserting server close before telemetry flush/disposal; do not remove the assertion to bypass lifecycle ordering. |
| **L35** | Workflow status commands | Runner deploy's missing-infrastructure summary used a plain YAML scalar containing `issue #11`. YAML treated the hash as a comment, truncating the quoted shell command and failing the status job before any Azure access. | Use a YAML block scalar for shell commands containing hash characters. Execute the YAML-parsed command when checking prerequisite and skip paths; shell quotes inside a plain YAML scalar do not protect it from YAML comments. |
| **L37** | Configuration fixtures after parallel merges | The database lifecycle fixture constructed the old backend config without `auth`. After authentication merged, main CI failed with an undefined tenant ID before the startup assertion ran. | Build shared application fixtures through `loadConfig({})` so required defaults are present and ambient secrets/configuration cannot enter the test. Test the combined latest-main revision before merging parallel branches; preserve the auth boundary and existing lifecycle assertions. |
| **L38** | GitHub Actions | Copilot finished #95 while it had a merge conflict; its review request started no workflow, so the PR stayed a draft. GitHub doesn't run `pull_request` workflows on a PR with merge conflicts. | Workflows that must react to PR state whatever its conflicts use `pull_request_target` (never checking out PR code) or `issue_comment`. |
| **L39** | Merging | After pushing a merge commit to #99, the coordinator read the PR head from the API, got the previous commit, waited on its green checks and merged a failing commit; `main` stayed red until `fix-main` #104. | Take the commit ID from your own push and require checks whose `headSha` equals it; never merge on checks of another commit. |
| **L40** | Asynchronous branch updates | GitHub accepts a branch update with HTTP 202 before the new PR head is visible. Dispatching CI immediately can test the old head, leaving the new head without evidence | Observe the updated head first, dispatch missing exact-head CI on a later run, and bind eligibility to both the tested PR SHA and current main. Never reuse old-head success. |

| **L30** | Database startup ownership | Fastify ready hooks default to a 10-second deadline, shorter than SQL auto-resume and the migration lock wait. `mssql` also refuses to close a connecting pool. | Await bounded database initialization before listen. Own pending connection work through cancellation, close a late connection before migrations, cancel active SQL and roll back before pool disposal. Verify these paths independently of the provider. |
<!-- L33–L34 remain reserved for the parallel CI and cloud setup issues. L30, L31 and L32 record database, authentication and module lifecycle pitfalls. Preserve existing numbers. -->
| **L36** | GitHub Actions | The Copilot PR ready workflow failed with `Resource not accessible by integration`: `GITHUB_TOKEN` with only `pull-requests: write` can rename a PR but can't mark it ready. | Declare `contents: write` as well for `gh pr ready`. Test a new workflow with a throwaway PR (`workflow_dispatch`) before relying on it. |

| **L41** | External integration readiness | A personal-project credential setup was presented as usable before its availability in Dan’s account and live board access were established. | Verify the supported credential controls and real integration before giving setup instructions or claiming readiness. A passing dry run can conceal a deliberately skipped integration. |

| **L42** | Cleanup scope | The coordinator cleanup also removed the separately delivered Project board sync; Dan clarified that only the coordinator should be removed. | Limit a rollback to the requested integration. Preserve separately owned workflows and their environments. |
| **L43** | GitHub Actions | Four tasks started at once lost the `Copilot` label on #55: the Worker label workflow shared one concurrency group, and GitHub keeps only one pending run per group and cancels the others. Per-issue groups then raced (an old PR closing while the task was reassigned). | Workflows that change state recompute it in full from current GitHub state on each run (Plan status, Project board, Worker label); then one shared group that replaces the waiting run is safe. |
| **L44** | Copilot cloud agent | Copilot finished P5-01 (#114), but its session was cancelled at 20 minutes during GitHub's post-session Dependabot check, so the PR stayed a `[WIP]` draft. `timeout-minutes` in `copilot-setup-steps.yml` limits the whole session, not just setup. | Keep `timeout-minutes: 59` (the maximum) in `copilot-setup-steps.yml`; split tasks that need longer. |
| **L45** | Copilot cloud agent | After an `@copilot` follow-up on #114, Copilot finished but reported it can't change the PR title or draft state in follow-up rounds, so `[WIP]` stayed and the ready workflow skipped the PR. | On Copilot's closing comment, the Copilot PR ready workflow removes a leftover `[WIP]` and marks the PR ready. |
| **L46** | T-SQL `LIKE` patterns | In P1-01, `tool NOT LIKE '%[^A-Za-z0-9_-]%'` rejected `create_task`: a trailing `-` after `_` in a bracket set is not a literal hyphen. | Put `-` first in a bracket set (`[^-A-Za-z0-9_]`) and test each check constraint with valid and invalid values against SQL Server. |
| **L47** | SQL JSON checks | `ISJSON(x)` without a type returns 0 for JSON scalars such as `"gpt-5.6-luna"` or `null`, which settings values need. | Use `ISJSON(x, VALUE)` for any JSON value and `ISJSON(x, OBJECT)` where only objects are allowed. |
| **L48** | GitHub Actions concurrency | With `cancel-in-progress: false`, a concurrency group still keeps only one pending run by default; a third quick run cancels the waiting one (GitHub documents `queue: single` as the default). | Deploy groups that must never drop a run set `queue: max`, and deploy from the last successful run's commit so a dropped or failed run's changes are still deployed. |
| **L49** | Browser checks in Copilot cloud agent | During P1-07, the Playwright MCP browser tools failed ("Browser-based OAuth required"), so the UI could not be inspected through them. | Use the preinstalled `/usr/bin/chromium` with `playwright-core` installed in a scratch directory outside the repository (see [agent-context](agent-context.md#setup-and-commands)). Stub sign-in only in that scratch harness, never in the app. |
| **L50** | Azure OIDC | The first three Deploy runs failed at Azure login with AADSTS700213: GitHub presented the subject `repo:DanAakesen@68902534/jarvis@1403065900:ref:refs/heads/main` (immutable owner and repository IDs), and the bootstrap had trusted only `repo:DanAakesen/jarvis:ref:refs/heads/main`. | The bootstrap trusts both subject forms for `main`; when a login fails, compare the subject in the error with the federated credentials before changing anything else. |
| **L51** | Azure SQL | The first deploy failed to create the SQL server with "Invalid value given for parameter Login": a new server needs an administrator at creation, and the Entra admin was a separate child resource. | Set `administrators` (Entra admin, `azureADOnlyAuthentication: true`) in the server's own properties. |
| **L52** | Structured voice metrics | The backend logger intentionally strips unrecognized events and arbitrary fields, so recording metrics with `request.log.info` alone did not make them observable. | Add a named event and individually validate each non-sensitive metric in the logger allowlist; never allow transcript text or arbitrary provider fields through. |
| **L52** | Foundry | The first deploy created the Foundry project and model deployments in parallel; Azure rejected them with RequestConflict ("Another operation is in progress"). | Chain project and model deployments with `dependsOn`, one at a time per account. Check new templates with `az deployment group what-if` before merging. |
| **L53** | Azure Container Registry | The first Jarvis agent Deploy (run 37162875562) failed with `Unable to find 'Dockerfile'`: `az acr build` resolves `--file` from the working directory, not from the build context argument. Pass the Dockerfile path from the repository root (`--file agents/jarvis/Dockerfile agents/jarvis`), as the backend build already does; verified with an `az acr build --no-push` run. `runner-deploy.yml` had the same mistake and is fixed too |
| **L54** | Azure RBAC | After P1-12 merged, every Deploy failed at Bicep: the deploy identity (Contributor and Role Based Access Control Administrator) may assign roles but not create role definitions (`Microsoft.Authorization/roleDefinitions/write`). `infra/bootstrap.ps1` now creates the custom role 'Jarvis backend app scaler' with Dan's rights under the fixed ID `985158cb-2c3c-5b9b-bd65-897ed9be3e36`; Bicep only assigns it. A Bicep change that creates a role definition needs the same split |
| 2026-10-03 | P2-11: provider model configuration | Copilot CLI 1.0.91 accepts `--model` and `--reasoning-effort` ([CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#command-line-options)); the runner uses `--model` for Copilot. `@agentclientprotocol/codex-acp` 2.1.1 exposes model and reasoning options through ACP `session/set_config_option` with IDs `model` and `reasoning_effort` (not a `codex-acp --model` flag). The runner verifies Codex's returned selected value and preserves config with the ACP session. Verified with `npm ci --prefix runner/tools`, pinned CLI help and package README/source; offline runner and Foundry contract tests cover forwarding. The settings model catalogs remain at `default`; supported real model choices and authenticated provider execution remain unverified. | Implemented offline; dispatcher resolution remains P2-05 and live selection awaits P0-16 |
| **L57** | Credential renewal | A read-only active-task query races a dispatcher task start; a renewal result also needs to survive runner recreation without writing prompts or secrets. | Serialize renewal acquisition and Codex starts on the same SQL credential-status row. Persist only allowlisted expiry/last-update metadata, and keep a lease when invocation completion is uncertain. |
| **L58** | Resuming Foundry sessions | A resume implementation that inserted a new sandbox row violated the unique Foundry session ID constraint and would have split cumulative usage. | Reopen the existing session row after clean pause, account each active interval in the same usage row, and make crash cleanup idempotent; cover repeated pause/resume and repeated cleanup in SQL Server integration tests. |
| **L55** | Migration numbering | Parallel branches both introduced a `0003` migration, so merging the credential migration unchanged would duplicate the sequence already used on `main`. | Rebase new schema work onto the latest migration number and update the exact forward-manifest expectation together with its reverse migration. |
| **L56** | Foundry chat routing | A hosted agent deployed with the Invocations protocol does not expose an arbitrary application `/chat` route through the Foundry gateway. | Register the application handler with `@app.invoke_handler` and have callers use the documented Invocations endpoint; define the request payload and SSE response in the application contract. |
| **L59** | Foundry sessions | The first Runner deploy (run 37180989945) failed its Key Vault probe with "Probe session response has no session identifier": `POST .../endpoint/sessions` returns the platform session as `agent_session_id`, which the probe didn't read (it accepted only `session_id` or `id`). The probe now reads `agent_session_id` first. Runner deploy had never run before because `JARVIS_INFRA_DEPLOYMENT_NAME` was unset; it is now `jarvis-infra` |
| **L60** | Project board | Four closed issues (#19, #21, #24, #59) stayed in In review or In progress: a board run listed them as open, the merge closed them and the built-in workflow set Done, then the run wrote its stale status over Done. Nothing corrected closed items afterwards. `project_board.py` now also moves every closed issue on the board to Done on each run, so a race heals on the next run |
| 2026-10-04 | P2-05: use one transaction-owned dispatcher app lock to serialize global/project capacity checks and lease claims; use event-driven wakes and retry deadlines rather than recurring SQL polling. Retry only failures known to have been rejected before session creation; move ambiguous start outcomes and expired leases to Needs attention rather than risking duplicate sandboxes. Resolve task model/reasoning overrides before validated settings defaults. | Two dispatcher instances share SQL task leases; capacity counts include Running tasks and unexpired startup leases. Safe failures use up to three attempts with 15- and 30-second backoffs. Foundry session, active route, and running turn commit before heartbeat tracking. Unit and SQL Server integration acceptance tests are included; live Foundry/Azure SQL behavior remains unverified. | Implemented offline; SQL Server CI pending |
| 2026-10-04 | P2-12: add `dbo.usage` in `0007_usage.sql`. Record a turn immediately before each ACP prompt, and accept token/premium-request counts only from explicit numeric `usage` fields. Tie those entries to runner invocation/event identity; finalize sandbox minutes and estimated DKK transactionally when a session ends, and calculate a live estimate for an open session. | This keeps absent provider metrics absent, makes repeated usage-event delivery idempotent, and presents estimates as estimates. Offline inspection found that the Codex ACP README advertises token-usage events without defining their fields; the Copilot CLI README says prompts consume premium quota but does not document a per-turn ACP report. Focused runner/backend/web checks pass; SQL Server integration and authenticated Codex/Copilot task reports remain post-merge checks. | Implemented offline; live provider reporting pending |
| 2026-10-04 | Persist completed voice transcripts in the existing conversation tables and record connected relay duration as one `voice`/`minutes` usage row per voice session. | This measures the provider-active relay sitting rather than inferred speaking time; a transaction closes the session and writes a row keyed by its `jarvis_session_id`, with no migration. Focused local tests cover relay transcripts, idempotent usage, and history display; Azure SQL and live voice remain unverified. | Implemented offline |
| 2026-10-04 | P1-13 Now feed: keep `activity` as the source for attention, release/deployment and credential activity; persist per-item dismissal in `activity.dismissed_at`; send an authenticated refresh hint after committed task events and dismissals, then reread the bounded snapshot. | Reuses the existing activity model and task event hub without storing duplicate feed snapshots or adding another replay log. Offline API/client tests cover read, dismissal, unknown IDs and task-event refresh; SQL Server integration and deployed Entra/stream behavior remain unverified. | Implemented offline |
| 2026-10-04 | P6-01: provide 7-, 30-, 90-day and all-time usage views grouped by project, agent or source; read `dbo.usage` only, include live sandbox estimates, and cap grouped entries at 1,000 with visible partial-result messaging. Never show DKK for Codex/Copilot. | Keeps P2-12/P5-06 writers unchanged, provides task links and period-aware summaries, and avoids presenting capped data as a full total. Focused route/store/web tests, workspace builds and linters pass; Chromium verified local mocked interactions at 390/1280 px. Live SQL and real provider/voice data remain unverified. | Implemented offline |
| 2026-10-04 | P7-11: register `set_jarvis_model` and `set_task_model` in the backend tool catalog; validate choices against the settings catalogs, apply Jarvis changes to the next session, and allow task changes only while Ready. | Reuse P2-11 provider catalogs and P4-07's next-session rule. A SQL state-guarded update refuses Running and other non-Ready tasks; the override, `model_changed` event, and activity row commit together, then the existing event hub refreshes task detail. Focused authenticated tool tests, the 69-test SQL Server suite, backend build and lint pass; live voice and production Azure SQL are unverified. | Implemented offline |
| 2026-10-04 | P2-07: expose state-bound steer, pause, resume and cancel actions from the board and task detail through one Dan-authenticated control route; keep pause pending until heartbeat confirms stop. Reuse the unique Foundry session row on resume and accumulate sandbox time/cost in its existing usage row. | The Foundry session ID is unique in `sandbox_sessions`, so resume cannot insert another row for the same session. Reopening the row preserves its turns and usage without a migration; cancelled paused sessions are closed, and repeated crash cleanup cannot add the same interval twice. `PauseRequested` continues to consume capacity and blocks backend sleep until resolved. Focused backend/web tests and Chromium mock checks pass. SQL Server integration is authored but couldn't run without the isolated loopback configuration; live both-agent task-branch acceptance remains the coordinator's post-merge check. | Implemented offline; SQL Server CI and live Foundry acceptance pending |
| 2026-10-04 | GitHub credentials are limited to the inventory in `docs/architecture.md`: the Jarvis Software Factory App (trimmed to Contents and Pull requests write; Actions, Checks and Deployments read), the temporary `jarvis-github` token, the Copilot-only `jarvis-copilot` token and the board's `PROJECT_TOKEN` (`project`, `repo`). The App stays installed on all repositories. Workflow-file pushes stay disabled | Dan found overlapping and unused tokens; the App had many permissions the design never needed, and its private key would carry all of them | Decided; Dan trims the App and deletes the unused tokens |
| 2026-10-04 | New projects are created by Jarvis from a name and description (P3-11, P3-12). Defaults live in a New projects settings section; the projects page keeps edit and archive but loses its create form. The scaffolding task uses `DanAakesen/templates` (`cpinit`), and the agent picks the template modules from the description, asking Dan through Needs attention when it lacks information. Repository creation uses a new backend-only fine-grained token `jarvis-repo-admin` (Administration: write), stored in Key Vault and never given to a sandbox | Dan does not want to fill in project forms. A GitHub App cannot create repositories under a personal account (GitHub requires the token's Administration permission for `POST /user/repos`), and putting that permission on the sandbox-visible `jarvis-github` would let a sandbox create or delete repositories | Decided |
| 2026-10-04 | P3-05: for a failed task-PR workflow, persist the failing job's bounded log to the existing private `logs` Blob container, then steer the same task using the existing P2-07 controller. Use an Actions-read-only repository token minted only in the backend, a sanitized bounded prompt excerpt plus Blob path, and `global.max_check_attempts` (default 3, range 0–10). Move the task to NeedsAttention when attempts are exhausted or required log/steer work is unavailable. | P3-03/P3-04 webhook records and `workflow_runs.log_artifact` remain the durable source; task-event markers make redelivery/restart idempotent without a migration. Focused fakes cover log extraction, Blob writes, webhook retry, attempt limits, prompt bounds and task identity. | Implemented offline; live failing-test/agent-push and Azure storage behavior remain unverified |
| 2026-10-04 | P7-16: keep tone, response style, and up to 2,000 characters of custom instructions in the existing whitelisted global settings store. Apply a snapshot to each new chat invocation and voice session; use British-butler/concise/empty-instructions defaults. | No migration is needed for the existing key/value schema. JSON-quote custom instructions and frame every preference as presentation-only, with immutable Jarvis identity, backend tools/permissions, and truthful action outcomes taking precedence. | Implemented offline; P8-19 Settings UI implemented offline; live Azure session behavior remains unverified |
| **L59** | Dispatcher to runner contract | The P2-05 dispatcher built start and resume requests without `taskId`, and its unit tests asserted the request without it. A runner deployed with `JARVIS_BACKEND_URL` requires `task_id`, so every production start would have failed with HTTP 400 and moved to Needs attention. No task had run live, so nothing showed the failure until the P6-05 load test checked the request. | Assert the complete request across the dispatcher, Foundry client and runner boundary, including identifiers the receiving side requires in its production configuration. |
| **L61** | SQL concurrency | After #169, `main` CI failed intermittently: under the parallel dispatcher load test, `endTaskSessions` sometimes failed with "Sandbox session usage persistence failed" while the same test passed on the PR. Concurrent session ends run check-then-insert upserts on `dbo.usage` under `UPDLOCK, HOLDLOCK`, whose key-range locks can deadlock (SQL error 1205). The store now retries a deadlocked transaction up to three times (each attempt rolls back completely) and reports the SQL error number if it still fails |
| **L62** | Credential names | Dan pasted the GitHub token into the Copilot secret because the GitHub token `jarvis-copilot` was stored as Key Vault `copilot-token` (and `jarvis-github` as `github-token`). Key Vault secrets now carry exactly the GitHub token names (`jarvis-copilot`, `jarvis-github`), the setup script checks which token was pasted, and Settings shows the GitHub name. The database's internal credential-status key stays `copilot-token` |
| **L64** | Load test | The remaining load-test stall ("14/15 tasks finished") came from the test, not the product: #177's diagnostics showed a SQL deadlock, and the victim was the test's own `activeCounts()` read inside the fake `startTask`. The fake then threw, the dispatcher correctly recorded a failed start, and the test waited for a task that would never run. The observer read now runs at low deadlock priority and retries on error 1205; the limit checks are unchanged |
| **L63** | MSAL sign-in | Dan's first production sign-in left the popup on the app's own sign-in page: MSAL Browser v5 returns popup and silent (iframe) responses only through a redirect bridge page that calls `broadcastResponseToMainFrame()`, because Entra ID sends COOP headers that sever the popup from its opener. The app used the site root as `redirectUri`. `apps/web/redirect.html` is now the bridge (a second Vite entry, served with `Cache-Control: no-store`), `redirectUri` and `postLogoutRedirectUri` point to it, and Entra has `/redirect.html` registered for production and localhost |
| **L65** | Web config | After the first production sign-in, Software Factory and Settings showed "sign-in needs attention" while the backend logged about 14 `/me` calls per second for hours. Vite's `define` inlines `__JARVIS_CONFIG__` as an object literal, so `App({ config = __JARVIS_CONFIG__ })` made a new config on every render: `useSignIn` then created a new MSAL client, re-ran the sign-in restore (`/me`) and re-rendered, and pages asked an uninitialized client for tokens. The config is now read once at module level. Build-time objects must never be used directly as default parameters or hook dependencies |
| **L66** | First live task | The first production task (4 October 2026, `jarvis-test-target`) proved dispatch, the Foundry sandbox, Copilot sign-in, Key Vault access and runner event delivery, and exposed two gaps. (1) The runner identities had no `Jarvis.Runner.Events` role, because `bootstrap.ps1 -JarvisRunnerPrincipalIds` was a post-merge step nobody ran; every event was rejected and the task hung in Running. The IDs come from the Runner deploy evidence artifact. (2) Nothing cloned the project repository: the start request has no repository or branch, so the agent found an empty folder and asked for them. P2-13 adds the task workspace and turns agent questions into Needs attention |
| **L67** | Post-merge steps | Steps that a PR lists as "after merge" (bootstrap flags, App settings, live checks) are easy to lose. The coordinator runs them as part of the gated merge, or records them as an open item in PLAN.md before merging |
| **L68** | Key Vault URI in Bicep | `environment().suffixes.keyvaultDns` already starts with a dot, so `https://${name}.${keyvaultDns}/` produced `kv-...` followed by `..vault.azure.net`. The value was unused until P3-03 validated it, and the new backend revision then failed to start (deploy run 37204931180; the old revision kept serving). Use `keyVault.properties.vaultUri` and check generated URLs from Bicep against the live resource when a setting starts being read. |
| **L69** | Empty PRs | Copilot paused P7-11 because `main`'s deploy was red, closed its round with no implementation, and the Copilot-ready workflow marked the PR ready. The coordinator's gated merge checked only CI, so PR #213 merged with zero changed files and closed #209 as complete. Before merging, require a non-empty diff against `main` and at least one commit that is neither the plan nor a merge from `main`; reopen any issue closed by an empty merge. |
| **L70** | SQL auto-resume | Production requests failed after exactly 30 seconds during auto-resume on 4 October 2026, although SQL connection/request timeouts were configured for 120 seconds. `mssql` also uses Tarn, whose acquisition and creation deadlines default to 30 seconds. | Bound the complete wake retry window, including pool acquisition and backoff, rather than only increasing driver timeouts. Retry before SQL execution; replay only explicitly read-only queries, never an ambiguous write or commit. |
| **L71** | Task workspace boundary | Production task 2 started ACP in a folder containing only runner metadata and its credential helper; the agent ended by asking for the repository and branch. | Prepare and verify the checkout before starting ACP, assert repository/default/task branch across the dispatcher and runner contract, and distinguish commit-free questions from task completion. Live acceptance remains a separate post-merge check. |
| **L72** | SQL JSON event search | SQL Server `JSON_VALUE` defaults to `nvarchar(4000)` and returns `NULL` for longer scalar strings, so it cannot find an idempotency marker in a long steering message. | Search the serialized event payload as `nvarchar(max)` when matching a marker embedded in a bounded but long prompt; keep the search scoped by task and event type. |
| **L73** | Conflict markers merged | While merging `main` into P3-07, the coordinator's resolver handled one file and the script committed with `git add -A`, although `git grep` had just listed markers left in `PLAN.md`; the gated merge then merged them into `main`. Stop when any `<<<<<<<`, `=======` or `>>>>>>>` line remains, and make the merge helper refuse a head that contains them. |
| **L74** | Foundry idle expiry | A completed invocation can remain in an active session after the task moves to NeedsAttention; a later 404 then looks like an in-work crash unless the heartbeat retains completion evidence. | Persist terminal status for the matching sandbox turn and classify confirmed expiry as `idle_expired`; keep monitoring completed turns until session expiry or cleanup, and preserve task state. |
| **L75** | Pending deploy is not broken | Copilot stopped P7-11, P7-12, P3-06, P8-09 and P8-13 with "blocked until the latest `main` Deploy run completes" while a Deploy was only queued or pending, then closed its round with an empty PR that the ready workflow marked ready. The rule now says only a failed run blocks; the coordinator's merge helper refuses empty PRs (L69). |
| **L76** | Duplicate task issues | After a manual plan-status run created P8-14–P8-18 (#247–#251), the coordinator's title search had not indexed them yet, so it created #252–#256 as well; the duplicates were closed. Before creating task issues, list issues through the REST API (not search), or rerun plan-status and check its output. |
| **L77** | Unverified infrastructure in an offline PR | P6-02 (#229) passed CI but broke every `main` Deploy: it required a new secret `JARVIS_BUDGET_CONTACT_EMAILS` that nobody set, then Azure rejected its scheduled query rules (`Count` aggregation with a metric column) and a mistyped Cost Management Reader role ID (`…a0` instead of `…a3`). Bicep compiling is not proof: look up built-in role IDs with `az role definition list`, run `az deployment group what-if` for new resource types, and set new secrets before merging. |
| **L78** | Task state is not crash evidence | P2-14's heartbeat guard did not protect generic dispatcher NeedsAttention cleanup, which still wrote Crashed for completed turns. A completion event can also precede turn insertion, leaving the later row running. | Check the latest invocation's durable completion evidence at every crash-writing boundary, retain monitoring until confirmed expiry, and log the committed heartbeat outcome rather than inferring it from task state or an in-memory flag. |
| **L79** | Logger allowlist hides new diagnostics | The backend logger replaces unknown event names with `backend.event` and discards unapproved fields before stdout and telemetry. Adding a logger call alone does not make heartbeat decisions visible. | Register controlled event names and validate their fields at the logging export boundary; test the real logger output and telemetry properties, including secret rejection. |
| **L80** | SVG icon rules can collapse a sized graph | The shell applies a general SVG width/height rule that overrides SVG presentation attributes, leaving a graph effectively invisible even though its viewBox and dimensions are correct. | Set the graph's rendered dimensions explicitly and inspect computed SVG size in a real browser; give SVG commit links a visible focus style and an adequate hit area. |
| **L81** | Graph permissions and Exchange RBAC | An Entra Graph application-role grant is additive to Exchange Online RBAC for Applications and can defeat the intended mailbox restriction. | Historical P7-09 guidance superseded by P7-22: Exchange RBAC is no longer used for Jarvis mail/calendar. Remaining Microsoft Graph integrations use their separately configured managed-identity permissions. |
| **L82** | Windows desktop target on Linux | The PC companion is a `net10.0-windows` WinForms application and Linux CI must also restore its Windows targeting packs. | Set `EnableWindowsTargeting` in the Windows project and test the portable command-policy project separately from the Windows-target build. |
| **L83** | Voice session callback state | The vision callback is created before Voice Live reports its session ID; reading only React state left that callback holding `null`, so voice inspection silently no-op'd after readiness. | Keep the active session ID in a ref for asynchronous event callbacks, and test the callback using the same instance created before session readiness. |
| **L84** | Popup bounds differ from page overflow | P8-21's phone Arrange menu clipped controls off the left edge even though the document had no horizontal overflow. | Open disclosures during responsive checks and measure their bounding rectangles, not just document scroll width. Anchor window menus to the available header width and keep lifecycle actions on one row without shrinking touch targets. |
| **L85** | Touch arbitration stops at the scroll surface | P8-11's native touch swipe was cancelled when only the outer canvas declared vertical pan; its inner overflow surface still allowed browser gesture handling. Synthetic pointer tests did not reproduce this. | Apply `touch-action: pan-y pinch-zoom` to the phone content scroll surface as well as the canvas, keep nested horizontal scrollers out of view switching, and exercise native touch events in Chromium rather than relying only on dispatched pointer events. |
| **L86** | Escape from closed Arrange | The open-menu Escape handler also consumed Escape after its `<details>` was already closed, preventing voice mode's global Escape-to-end action. | Only prevent and stop Escape while Arrange is open; test both menu-close/focus-return and a second Escape from the closed trigger in a real browser. |
| **L87** | Ready-state phone dock bounds | The inherited primary-button top margin and a fixed short dock pushed End voice outside the dock when the microphone-enable action and inspection controls wrapped. | Reset the voice-control margin and size the ready dock for wrapped rows; in Chromium, check the End voice and workspace bounds at narrow phone widths. |
| **L88** | Voice detail live announcement | Microphone permission denial can update the detail while the state stays “Ready”; a live heading alone does not announce that changed reason. | Announce the state heading and detail together in an atomic status region; test a detail update without changing the state. |
| **L89** | Actions minutes are not free | Overnight on 4–5 October the coordinator ran about 40 PRs through Copilot sessions and full CI. Copilot cloud agent runs on GitHub Actions minutes, CI has 11 jobs that each bill rounded-up minutes on every PR push (including drafts and every merge-main update), and CI repeated on `main` after each merge. October reached about 18,000 Linux minutes against 2,000 included, about $96, and GitHub charged $50. Dan's rule is free services only, and nobody checked the Actions quota. Now: CI skips drafts and no longer reruns on `main`; Copilot PR ready dispatches CI after marking a PR ready. Before starting many agent sessions or adding workflows, check `gh api users/<owner>/settings/billing/usage` and stay inside the free minutes unless Dan approves a budget. |
| **L90** | Foundry voice wrapper and hosted target | `jarvis-voice-mai` is the native `kind: voice` wrapper; it uses hosted `jarvis` as its conversation engine. The telephony binding targets the voice wrapper, not the hosted target. | Verify the deployed wrapper and live TPE compatibility. Do not treat caller numbers in trace data as authorization for backend tools; verify a trusted per-call identity path first. |
| **L91** | Capacity 1 is not a working default | A Global Standard deployment at capacity 1 gets 1,000 tokens and 1 request per minute; a single Jarvis chat turn with tool definitions exceeds it, and the hosted agent reports only a 500 with `error.type=rate_limit_exceeded` in Application Insights. The backend previously swallowed the cause. | Size Global Standard capacity from per-turn tokens (capacity costs nothing extra); when chat fails, query Application Insights dependencies for `invoke_agent` result codes and `error.type`, and read the backend's `conversation.reply_failed` warning. |
| **L92** | Voice-agent provisioning changes are live changes | Any change to `provision_danish_voice.py` or `infra/main.bicep` re-provisions the Danish voice agent after Deploy. A transcription-model change passed fake tests and CI but broke every live Danish session. | Treat voice-agent settings as live configuration: verify a real Danish session (connect, speak, hear a reply) right after the provisioning workflow, and keep transcription model, language and phrase-list support verified together. |
| **L93** | Workflow environments look like deployments | Any Actions job with `environment:` creates a GitHub deployment and `deployment_status` events. After the webhook went live on 5 October, the `project-board` workflow's cancelled/failed runs raised about 20 false "Deployment failed" alerts in five minutes. | Release mapping ignores the `project-board` and `copilot` environments; add any new non-release workflow environment to `NON_RELEASE_ENVIRONMENTS` in `webhook-mapping.ts`. |
| **L94** | Shared-tab context | A screen-share title and vision description are easy to leak when added to ordinary chat/tool arguments, and routing a deictic request through the focused-tab reflex can act on a different page. Model-supplied tab titles also cannot stand in for Dan's clarification; one overlapping word is weak evidence. | Keep bounded frame context transient and bind it to the authenticated request; bypass focused-tab reflex for shared intents, accept a clarification only when its exact title appears in Dan's current message and is strongly consistent with the frame, and ask rather than guess on weak matches. |
| **L95** | PowerShell 5.1 native stderr is terminating | In Windows PowerShell 5.1 with `$ErrorActionPreference = 'Stop'`, `& az ... 2>$null` turns stderr into a terminating `NativeCommandError`, so retry loops never retry. `setup-google.ps1` failed on the first Key Vault write while the temporary role was still propagating (5 October). | Wrap native calls that may fail transiently in a helper that sets `$ErrorActionPreference = 'Continue'` locally, then check `$LASTEXITCODE`. Also, 5.1 `ConvertFrom-Json` returns a JSON array as one object (`@('[]' | ConvertFrom-Json).Count` is 1), which made the script skip creating its temporary Key Vault role; enumerate with `Where-Object` before counting. |
| **L96** | Code and schema enums must match | The tools route records `outcome: 'refused'`, but `CK_tool_calls_outcome` allowed only `ok`/`error`. Every tool refusal (bridge offline, no workspace connected) then failed the audit insert and returned HTTP 500 instead of a readable refusal (`pc_open` and `workspace_command`, 5 October). | When a TypeScript union is persisted, add a schema integration test that inserts every value. Migration 0018 adds `refused`. |
| **L97** | Voice agents have their own WebSocket route | The backend connected to the Danish `kind: voice` wrapper at `/agents/<name>/endpoint/protocols/invocations_ws` (the hosted text agent's Bridge Protocol route). Foundry rejected every handshake with HTTP 400, so live voice never worked (seen once failure logging was exported, 5 October). The SDK (`azure-ai-projects` `_to_ws_url`) uses `/endpoint/protocols/voice` with header `Foundry-Features: VoiceAgents=V1Preview`. | Connect browsers' voice sessions to the voice wrapper's `protocols/voice` route with the preview header; `invocations_ws` is only the wrapper-to-hosted-target transport. Verify new Foundry routes against the official SDK source, not the protocol name. |
| **L98** | Match the client protocol to the route | After #360 moved the Danish relay to the voice wrapper's `protocols/voice` route, the browser still spoke the hosted agent's Bridge Protocol: it sent `session.start` and a `/diag` text turn and waited for `session.ready`. The voice wrapper speaks the Voice Live realtime protocol (`session.created`, audio append) and owns its own configuration and greeting, so sessions closed and reconnected in a loop. | When a transport or route changes, update every client of it in the same change, and verify the first-message handshake against the official SDK (`voice_agents.realtime.connect` waits for `session.created`). |
| **L99** | A Bridge Protocol target must declare Voice Live compatibility | The voice probe (#383) showed the real Danish failure after #384: `agent_not_voice_compatible` — "Agent jarvis uses the Invocations protocol but is not marked as voice-compatible". The voice prototype set version metadata `voiceLiveCompatible: "true"` and `bridgeProtocolVersion: "1.0"`; the production deploy never did, so the `jarvis-voice-mai` wrapper could never reach the hosted agent. With the metadata added, the next probe failed with `bridge_transport_not_supported`: a typed Bridge agent must also declare the `invocations_ws` protocol. | The deploy creates every `jarvis` version with that metadata and declares and enables both `invocations` (chat) and `invocations_ws` (voice bridge). Port all metadata and protocol settings when promoting a prototype, and run the voice probe after any agent or voice deploy change. |
| **L100** | Reinstalling the PC bridge must not mix runtimes | Reinstalling the bridge for P7-07 (6 October) left it unable to start: `hostfxr.dll` failed with `0x800700C1` on Dan's ARM64 PC. The installer copied over the previous self-contained publish without removing it, and the documented publish targeted `win-x64`, so files from different runtimes and architectures were mixed. | The installer removes earlier install files (except the loaded Chrome extension folder, overwritten in place) before copying, and the publish command selects `win-arm64` or `win-x64` from the PC's architecture. After a reinstall, check that the bridge process stays running and holds a connection to the backend. |
| **L101** | Keep renderer recovery independent from voice | P8-33's browser fixtures forced WebGL context loss and unavailability while voice controls remained mounted. Treating a lost renderer as a voice error would misrepresent the existing voice session and could hide the available recovery path. | Retain and pause the same scene across recoverable context loss; use a CSS stage fallback if creation/restoration is unavailable, keep HTML actions usable, and report rendering state separately from voice readiness. Adapt DPR, mirror resolution and scene work from viewport/device limits and observed frame cadence; hardware/battery acceptance still requires real devices. |
| **L102** | A route that is never registered looks like an auth failure | English voice never connected in production: every `/voice` WebSocket got `401 missing_token` (6 October). The backend registers `/voice` only when `VOICE_LIVE_ENDPOINT` is set, and infra never set it; on an unregistered route the auth hook cannot match the voice route, so the browser token was reported as missing. | Bicep now sets `VOICE_LIVE_ENDPOINT` from the Foundry account (hot-fixed on the live backend first). Every optional feature switch must be set in infra or reported at startup; verify a new route against the live deployment, not only tests. |
| **L103** | Voice runs on one realtime model, configured in Voice Live's own session shape | Dan's live test (6 October) showed Danish voice unusable: the hosted-agent wrapper split speech every 2–4 s, each fragment cancelled the previous agent turn (2 of ~9 turns answered in 80 s) and each turn took ~7 s (3.5 s inside the hosted agent before the model call). A local probe against Voice Live showed `gpt-realtime-2.1` understands and answers Danish directly (perfect transcript, 1.25–1.7 s from detected end of speech to first audio) and that `api-version=2026-07-15` rejects the GA shape (`session.type`, `output_modalities`, `audio.input`) the English path sent. | Danish and English both use the backend relay → Voice Live `gpt-realtime-2.1` with the flat session shape, noise suppression and server echo cancellation; Danish uses server VAD (600 ms) and `da-DK-JeppeNeural`. Jev handles instant actions from live transcripts; the hosted agent is no longer in the voice loop. Probe any session-config change against the live service before shipping. |
| **L104** | The free database allowance ran out mid-test | Azure SQL serverless on the free offer paused at 09:43 on 6 October when the monthly free vCore allowance was exhausted (`AutoPause`), so every database route returned 500. Overnight board activity and GitHub webhooks kept the database awake for hours. Dan approved billing beyond the free limit; Azure then refuses to switch back to `AutoPause`, so the next Bicep deploy failed. | Bicep sets `freeLimitExhaustionBehavior: BillOverUsage`. Webhook and polling paths must not wake the database unnecessarily; watch free-allowance use. |
| **L105** | Give Jev the situation, not just the sentence | After voice worked (6 October), Jev ran on every turn in 0.21–0.48 s but never acted: each decision was `not_addressed`. With only the transcript as state, Jev scored "Åbn YouTube." as addressed to Jarvis at 0.10; adding one `situation` sentence (Dan is talking directly to Jarvis; transcripts may contain background speech) raised it to 0.94 while background chatter stayed at 0.16. Production calls had also failed silently with HTTP 402 earlier the same morning. | Jev state always carries the situation the judgment depends on, per the TypeSafe docs. Verify Jev judgments against real examples before relying on a threshold, and log Jev failure types instead of collapsing them to `unavailable`. |
| **L106** | The app allow-list contradicted "Chrome, never Edge" | On 6 October voice called `pc_open` with target `app`, value `chrome`, and the bridge refused it: the backend and bridge app allow-lists contained `edge` but not `chrome`. | Allow-lists now contain `chrome` instead of `edge`; the reflex treats opening Chrome as safe; the tool description and voice instructions tell the model to open websites with target `url`. Check allow-lists and fallbacks against Dan's product rules whenever a rule like "never Edge" is set. |
| **L107** | Page actions use the focused Chrome tab; sharing is optional | On 6 October every voice or chat page command with "this/here/it" waited for a shared screen and, when Dan was not sharing, told the model not to use `browser_do`; the extension also marked the active tab of every Chrome window as focused, so the backend refused to pick one. Dan decided the same day: page actions use his focused Chrome tab by default, and screen sharing is only for "look at this". He also chose full PC access (any installed app, UI Automation everywhere, confirm only irreversible actions, no raw shell). | Without a shared screen the relay runs the reflex on the focused tab, and the web client no longer blocks such requests. The extension (1.0.2) marks only the last-focused window's active tab as focused. P7-31, P7-32 and P7-33 implement the access decision. |
| **L108** | Log why live partial transcripts fail | Every voice session logged `voice.partials_unavailable` with no reason, so Jev never received live partial transcripts and could not act before Dan finished speaking. The Speech SDK cancellation code and details were discarded. | The relay logs the sanitized Speech SDK cancellation code and details (max 120 characters, allowlisted `failure` field). Diagnose the partials path from that evidence before changing the recognizer. |
| **L109** | Windows interop must match the native layout and the caller's rights | Dan's test on 6 October: every media key failed because the `INPUT` struct was 32 bytes instead of 40 (the union lacked `MOUSEINPUT`), so `SendInput` returned 0 with error 87; and Spotify launched while Jarvis reported failure because `AllowSetForegroundWindow` is denied to the background bridge. | `INPUT` includes `MOUSEINPUT`, verified on Dan's ARM64 PC (40 bytes, 2 inputs sent). App launch treats foreground permission as best effort. Voice instructions use `browser_do` on the focused tab and `pc_media` for playback. Verify P/Invoke sizes against the Windows SDK and test native calls on the real machine. |
| **L110** | A background bridge must bring what it opens to the front | Dan's test on 6 October: tv2.dk opened in Chrome behind other windows, "VS Code Insiders" did not match "Visual Studio Code - Insiders", and "close it" was refused because the bridge had no close command. Windows lets only the process that received the last input take the foreground. | After opening a URL or app, the bridge sends a synthetic Alt key and calls `SetForegroundWindow` on the new window (best effort). The app matcher expands spoken short forms (VS Code → Visual Studio Code) before scoring. `pc_close` sends `WM_CLOSE` so the app can still offer to save, without confirmation. |
| **L111** | Live partial transcripts used a wrong Speech path | Every voice session since partials were added logged `voice.partials_unavailable`; the cause was hidden because the log allowlist dropped the `failure` field. A local Speech SDK probe on 6 October got HTTP 404 on `wss://<foundry>.cognitiveservices.azure.com/speech/universal/v2`; `/stt/speech/universal/v2` connects and streamed Danish partials ("åben youtube" at 2.31 s of a 3.56 s sentence). | The recognizer uses the `/stt` path, and `voice.partials_unavailable` keeps `failure` and `language`. Probe new Azure endpoints live before shipping, and check that new diagnostic fields survive the log allowlist. |
| **L112** | Screen inspection had never worked | A live test on 6 October showed every screen-vision request failing with HTTP 400: `gpt-5.6-luna` and `gpt-6-luna` reject `max_tokens` and require `max_completion_tokens`, and only accept `reasoning_effort` none, low or medium. Measured on a 1280×720 test screen, `gpt-6-luna` at detail auto used 1136 input and 26 output tokens, returned in 1.4 s, cost ≈ USD 0.00013 per frame, and read a TypeScript error correctly. | Vision uses a dedicated `gpt-6-luna` deployment (Bicep plus capacity 50) with `max_completion_tokens`, `reasoning_effort: none` and `detail: auto`, so the chat model setting no longer affects vision cost. Dan chose continuous watching with frames only on change and a USD 1/day cap. Probe every new model call live before relying on it. |
| **L113** | The shared runner agent name was stale | On 6 October Codex task 7 failed with `credential_unavailable`. The runner deploy creates `jarvis-runner-{base,dotnet}-{1x2,2x4}`, but `FOUNDRY_RUNNER_AGENT_NAME` still named `jarvis-runner-node-1x2`, so Foundry returned 404. Codex login renewal, web research and image/video artefacts had all been failing; the credential was never marked renewed. The value is now `jarvis-runner-base-1x2` (hotfixed in revision `0000144`, credential back to `ok`). Renewal outcomes were also invisible because `credentials.codex_renewal` is not on the log allowlist. |
| **L114** | `ORDER BY id` sorted text, not numbers | On 6 October a Now feed test failed only once activity ids reached 10. SQL Server resolves an unqualified `ORDER BY id` to the select-list alias, and these queries select `CAST(id AS varchar(19)) AS id`, so `'9'` sorted above `'10'` whenever timestamps tied. `getEventsAfter` (live task event replay) used `TOP (@limit) ... ORDER BY id` the same way and would return the wrong events once ids cross a power of ten. Qualify the column (`e.id`, `dbo.tasks.id`) whenever the select list casts `id` to text. |
| **L115** | One missing brace unstyled the whole app | On 7 October the overnight UI deploy (#473) rendered without styles on desktop. The last `@media (max-width: 700px), (max-height: 500px) and (pointer: coarse)` block in `ConversationHistory.css` was never closed. Vite concatenates stylesheets into one bundle, so everything after it (all of `styles.css`) landed inside a mobile-only query. Lint, unit tests, build and the deploy check all passed; only a signed-in look caught it. `src/stylesheets.test.tsx` now fails on any unbalanced stylesheet. |
| **L116** | The Chrome native host crashed 400 times a day | The UI session found 405 `Jarvis.PcBridge.exe` crashes in 24 hours (6–7 October): unhandled `OperationCanceledException` from `NamedPipeClientStream.ConnectAsync`, each writing a Windows Error Reporting dump. The bridge pipe accepts one client, and the extension's 30-second keep-alive alarm launched a new host regardless of back-off. Any extra host (a second Chrome profile, a stale worker, or a stopped bridge) timed out after 10 seconds and crashed. The host now exits with code 0 and tells the extension `host_unavailable`; the extension then waits 5 minutes, and the alarm respects the back-off. A likely contributor to Dan's freezes. |
| **L117** | Hijacked event streams lost their CORS header | On 7 October research was always refused with "no workspace connected". `/now/events` (and the factory task-event stream) call `reply.hijack()` and write headers straight to the raw response, which drops the `Access-Control-Allow-Origin` header that `@fastify/cors` put on the Fastify reply. The browser (cross-origin from both the Static Web App and localhost) blocked the stream after about 65 ms, so the workspace never connected. Every tool that opens a window was refused. Hijacked streams now copy `reply.getHeaders()`. Research also uses a default report frame until the web app sends its own. |
| **L118** | Embeddings used the project-scoped URL, which returns 404 | After #486 the vault re-index made about 4,800 `memory.embedding` calls, all `fallback`, so no vectors were stored. A probe from the backend container showed `https://<account>.services.ai.azure.com/api/projects/<project>/openai/v1/embeddings` returns 404 while `https://<account>.services.ai.azure.com/openai/v1/embeddings` returns 200 with the same managed identity. The embedder now posts to the account origin, and fallback logs carry `httpStatus` so a silent failure is diagnosable. Lesson: probe a new Foundry endpoint from the deployed identity before trusting a mocked test, and never log a fallback without its reason. |
| **L119** | Vault backfill throttled at 20K TPM | Once embeddings worked (L118), the first backfill made 639 successful calls and 1,244 HTTP 429s in a minute: the `text-embedding-3-small` deployment had capacity 20 (20 requests per 10 s). Capacity is now 150 (GlobalStandard bills per token, quota 1,000), and background vault indexing waits out a 429 using `Retry-After` (at most 15 s, four attempts) instead of storing a null vector. Interactive memory search still fails fast. Lesson: size a background backfill against the deployment rate limit before enabling it. |
| **L120** | SQL Server migrations: same-batch columns and column type changes | P9-23's first migration failed twice in Database CI. Each migration file runs as one batch, so an `UPDATE` or `CHECK` that references a column added earlier in the file fails to compile ("Invalid column name"); wrap those statements in `EXEC(N'...')`, as 0016, 0020 and 0021 already do. `ALTER COLUMN` also fails while a constraint or index references the column; drop and recreate them around the change, in the down script too. Lesson: read the existing migrations before writing a new one. |
| **L121** | One tool schema with a root `oneOf` broke every voice session | On 8 October voice failed right after start: Voice Live answered `session.update` with `invalid_function_parameters` for `manage_model_deployment` (P9-07, #544), whose input schema put `oneOf` at the root. Voice sends every registered tool at session start, so one invalid schema disables voice entirely; `toModelToolSchema` only strips untyped nested combinators (L103). The schema is now a flat object with `action` as an enum, and `execute` enforces the per-action fields. The original guard checked core tools only; L136 extends it to every configured production tool. Lesson: tool input schemas must be a plain root object; express alternatives in code, not in the schema. |
| **L122** | Clipboard reads are sensitive and turn-scoped | P9-32 adds only explicit current-message clipboard reads through the authenticated PC bridge. | Keep clipboard tools out of reflex execution, redact obvious secrets before returning read text, bound text to 20 KiB, and store only redacted metadata in the generic tool-call audit. |
| **L123** | Chat called an agent-only route with Dan's token | From the 01:53 agent deploy on 8 October every chat message failed with `Chat agent unavailable (HTTP 503)`. P9-11 (#557) added a `GET /agent/settings` read to `load_verified_history`, but sent Dan's delegated token; that route only accepts the hosted agent's identity, so the backend answered 403 and the agent refused the turn. Mocked tests asserted the same wrong header, and nobody used chat overnight. The agent now reads its settings with its own managed identity and falls back to the default timeout if they are unavailable. Lesson: agent-only routes need the agent token, tests must assert which identity each call uses, and a deploy that touches the agent needs a live chat check (P9-39). |
| **L126** | One huge ACP line hung a Factory task for an hour | Task 10 (8 October, the calendar-approval change Jarvis requested) went silent at 03:37 right after Codex ran `cat` on several large docs, and failed on the runner's 60-minute timeout. The runner spawned Codex with asyncio's default 64 KiB stream limit; the tool-output ACP message was one longer line, so `readline()` raised, the unobserved reader task died, nobody drained stdout and Codex blocked writing. The ACP pipe now allows 32 MiB lines, and an over-limit line is dropped with an `acp_message_dropped` event while reading continues. Lesson: stream readers on agent pipes must survive oversized messages; a dead reader must never look like a busy agent. |
| **L127** | The research smoke probe timed out at random | After L125, the deploy for #591 still failed its smoke gate: the research dry run (a real Codex call through the runner) was cancelled at its 20-second budget, while a normal call takes 15-25 s (it passed in 21 s at 04:29). The probe now has 45 s, the gate's request 60 s, and the workflow prints each check's id and status to the log so a failed gate names its check. Lesson: size a probe's timeout from observed latency with headroom, and make a gate say which check failed. |
| **L128** | Wake word: a 10-second gap before the chime | Dan heard the chime about 10 s after saying "Wake up Jarvis". A timing probe with Speech SDK 1.52.0, his `.table` model and real-time push audio showed the keyword detected at once, but `KeywordRecognizer.Dispose()` blocked for 10.01 s because the bridge never stopped the recognition session after a detection. Calling `StopRecognitionAsync()` before disposing cut that to 0.13 s. Always stop a Speech SDK recognizer before disposing it, and time detection and teardown separately when diagnosing latency. |
| **L129** | The chat agent rejected every reply because the shared instructions grew past 10,000 characters | On 10 October, "hi" in the chat returned "Jarvis could not finish the reply". The backend log only said `conversation.reply_failed` / "Chat agent failed"; the hosted agent swallows the exception (`except Exception: yield "event: error"`), so the cause was invisible in Log Analytics. It was `capabilityInstructions` (the shared tool guidance sent with `GET /agent/settings`): 11,362 characters after the P9-5x tool additions, while `agents/jarvis/jarvis_tools.py` rejected anything over 10,000 as "invalid Jarvis settings" and the agent failed ~9 ms after reading settings. Every capability line added raises the risk and no test connected the two limits. The agent limit is now 20,000 and the budget lives in one shared file, `agents/jarvis/limits.json` (hard limit 20,000, headroom budget 15,000 code points): the agent reads it, and `capability-instructions.test.ts` checks the backend constant, the budget and BMP-only text against it. A failed chat turn now emits `event: error` with a short diagnostic `code` (for example `capability_instructions_too_large`), which the backend logs in the `failure` field of `conversation.reply_failed` as `Chat agent failed (<code>)`, with no message text. Some redundant wording was also trimmed. When a chat turn fails, filter Log Analytics for `conversation.reply_failed` and read `failure`. Two services enforced the same budget in different languages without a shared test, and a generic catch hid the cause. |
| **L130** | File and screenshot contents are untrusted prompt data | P9-66 sends extracted document text or a bounded image description to the hosted agent so Jarvis can answer file questions. | Treat all file-derived content as data, label it untrusted, keep it out of logs and tool-call audits, and expose further reads only through owner-scoped sensitive tools. |
| **L131** | A tool catalogue over 128 tools silently takes chat down | #737 (GitHub App tools) passed CI and deployed, then every chat turn failed with 'I could not finish the reply' (Chat agent failed (catalogue_unavailable)): the hosted agent rejects the whole /tools catalogue above 128 tools, which is also the model API limit. Nothing tested the production catalogue size. Fix: the registry now refuses more than the limit (and over-long descriptions or an over-large catalogue) when the backend starts, so the deploy fails its health gate and the previous revision keeps serving; the limits live in agents/jarvis/limits.json, with a backend and an agent test that they cannot drift. Add tools only by merging related ones into one tool with an operation parameter. | Historical only; count remedy superseded by #1204 and provider-limit claim unverified. |
| **L132** | The post-deploy canary's model usage was rejected for hours | After the chat canary (#760) deployed, every `POST /usage/foundry` with role `smoke` returned 400 (14 calls from 01:15 UTC on 13 Oct, none succeeded). The route schema enum listed `smoke`, but a second hand-written role list in `validFoundryUsage` did not, so the schema accepted what the validator then refused. Chat usage kept working, so nothing visibly failed and the canary itself still passed; only a log query for non-2xx on the route showed it. Both places now read one `foundryUsageRoles` constant and a test posts every listed role. | Define a value set once and derive both the schema and the validator from it; after a deploy that adds a role, status or kind, check the 4xx counts on the routes that carry it |
| **L133** | Parked issues sat in In progress on the board while labelled needs-decision | #717 and #719 carried `Codex` plus `needs-decision`, and #717 had a linked parked draft PR. The board script treats a worker label or a linked draft PR as claimed work, so both showed In progress while only Dan could move them, and the coordinator reported the board clean from labels without opening it. A worker label means actively working; a parked item drops it. The script now keeps a needs-decision issue in Needs Dan when only a draft PR links it, with a test. | Each round compare the real board columns to the labels (project item list), not only the labels; remove the worker label when work parks on Dan |
| **L134** | A decision was requested on a stale premise | #396 asked Dan to pick a Danish voice because PRODUCT.md, architecture.md and the provisioner all said Harper. The live code had used Jeppe since P5-08 (`DANISH_REALTIME_VOICE`), so the question was already answered and the fix I proposed (re-provision `jarvis-voice-mai`) would have changed only an unused fallback. Docs lagged the code by a week. | Before asking Dan to decide or filing a change, confirm the current value in the code that runs in production (and its tests), not in the docs; correct the docs in the same change |
| **L135** | The new in-app board returned 502 on every read in production | #806 shipped the board columns and deployed green, but `GET /factory/board` failed with `factory.board_read_failed` on every call (117 in 15 minutes). The reader compared the number of blockers GitHub lists for an issue with the summary count `blocked_by`, which counts only open blockers while the list includes closed ones; #721, #723 and #732 each had a closed blocker beside an open one, so the whole board threw. The unit test passed because its fake dependency items had no `state` field, unlike real GitHub data, and the handler swallowed the cause so the log showed only the event name. The reader now keeps only open blockers and rejects entries without a state. A second defect appeared in the same first live call: GitHub returns `closed_at` without milliseconds and the shared contract requires them, so the web correctly rejected the 200 payload; the reader now normalises `closedAt` to ISO with milliseconds, with a test that runs the built board through `isFactoryBoard`. | Shape test fixtures from a recorded real response, and check a new read path against live data (compare the counts it assumes) before calling it done; after deploying a new endpoint, query its error event in the logs and call it once with real data |
| **L136** | The Voice Live schema guard covered only core tools | #1153’s reconnecting voice was caused by Voice Live rejecting `session.update` with `invalid_function_parameters`: configured Daily health, nutrition and coach tools had root `oneOf` schemas, while the L121 guard inspected only `coreModule.tools`. The model-facing schemas now flatten typed root object alternatives, while the registered full schemas remain the server-side validation contract; the production-catalogue test checks all configured tools. | Guard every tool in the full production composition, including features enabled only when their stores are configured; keep schema simplification model-facing and preserve authoritative server validation |
| **L137** | ARM REST and Azure CLI model shapes | The first backend-log preflight failed at `builtin_role_mismatch`: its `az rest` verifier and synthetic fixture both used CLI-model `properties.roleType`, while ARM returns `properties.type`. | Build wire-response fixtures from the exact REST version being called; do not substitute a CLI's normalized output. Keep fail-closed permission checks, and test both the documented positive shape and rejected normalized/custom-role shapes. |
| **L124** | Folio ids came back upper case from SQL | After #564 deployed, `GET /folio` returned 503 for Dan: migration 0035 built `item_id` as `kind:` + `CONVERT(nvarchar(36), id)`, which SQL Server renders in upper case, while the store only accepts lower-case GUIDs, so every stored item failed validation. Same root cause as #536's job ids. Migration 0036 lower-cases existing ids and the store normalises ids on every read and write. Lesson: never build or compare GUID text from SQL Server without `LOWER()`; tests against the real database must assert the id shape round-trips. |
| **L125** | The Google smoke probe used an endpoint Jarvis has no scope for | Every deploy after P9-39 (#562) failed its smoke gate with Google "down", while Dan's calendar tools worked. The probe read `/users/me/calendarList`, which needs `calendar.readonly`; Jarvis holds only `calendar.events` (infra/setup-google.ps1), so it always got 403. The probe now reads one primary-calendar event, the same endpoint and scope the calendar tools use. Lesson: a health probe must exercise the feature's own endpoint and scopes, and a new gate should be checked against a known-good system before it blocks deploys. |

## 5 October 2026 — Software Factory layout selected

**Confirmed by Dan:** use image 2 (Task Lens) as the base, include image 3's compact release bar and keep the details pane on the right. Dan approved [the combined mockup](ui/software-factory/task-lens-release-bar.png) and requested one implementation issue. P8-34 (#369) implements that composition using the existing task, release, workspace and conversation contracts; #364 supplies the shared glass styling. The reference uses illustrative data. Dark/light desktop and phone fixture checks are recorded in `docs/agent-context.md`; live integration and physical-device acceptance remain unverified. This decision does not authorize starting or assigning a worker.

## 6 October 2026 — Luminous-glass conversation components selected

**Confirmed by Dan:** select the last Luminous Glass component-family image for the compact voice bar, chat input and message window. Remove the line above messages and the small orb/Jarvis title from the top-left window header; keep top-right window controls and the input's voice-start orb. Language belongs inside More as an icon/text row with a Danish/English flyout. Existing capture capabilities and their placements remain.

[Edited reference](ui/chat-voice/README.md). [P8-36 (#397)](https://github.com/DanAakesen/jarvis/issues/397); [P8-37 (#398)](https://github.com/DanAakesen/jarvis/issues/398); [P8-38 (#399)](https://github.com/DanAakesen/jarvis/issues/399) are implementation tasks and preserve existing steering/queue, voice and workspace behavior. They are unclaimed; publication does not start a worker. Three app-shell styling alternatives were requested separately and remain proposals until selected.

## 6 October 2026 — Architectural Glass shell selected; footer and message avatars removed

**Confirmed by Dan:** choose the last/third displayed shell concept for its 3D material feel. Remove the separate bottom app-shell/status bar, leaving open the possibility of adding one later if needed. Keep the bottom-centred composer and compact voice-session controls. Preserve the current footer's truthful database-waking feedback in compact top-bar status treatment.

Remove only the two message-avatar icons (human and Jarvis) from the selected chat window. Preserve accessible author roles and hierarchy, the large scene orb, small voice-start orb, window controls and all other selected elements. [The refined reference](ui/shell-styling/README.md#refined-approved-reference) applies these removals to the exact selected result. New P8-39 (#401) covers shell/footer changes; existing P8-38 (#399) is amended for avatars, avoiding a duplicate message-window issue. These tasks are unclaimed; publishing the selection does not start a worker. This supersedes earlier bottom-bar requirements and message-avatar details in the original comparison image.

## 6 October 2026 — Consolidate input, messages and shell into #398

**Confirmed by Dan:** #398, #399 and #401 should be one implementation issue to avoid unnecessary splitting and repeated CI across separate PRs. P8-37 (#398) now owns the full composer, avatar-free message window and selected Architectural Glass shell/footer scope in one PR. All acceptance criteria and retained prerequisites remain. P8-38 (#399) and P8-39 (#401) are closed as superseded (`not_planned`), not completed; keep their IDs reserved and their original scopes archived.

P8-36 (#397) is already claimed by Copilot in PR #403, so its voice-bar/shared-menu work remains separate and is reused by #398. The selected references, two retained orbs and all runtime/window/theme/steering requirements are unchanged. CI still runs for updates to the combined PR; no checks are bypassed and no worker is started by consolidation.

## 6 October 2026 — Voice status below the orb, microphone on start and stronger live states

**Confirmed by Dan:** resolve the supplied screenshot overlap by moving state feedback beneath the orb and keeping the compact glass bar for controls. Remove the normal Enable microphone button: explicit voice start is the activation gesture, with native browser permission and authenticated readiness still required. Keep language in More with current/next-session explanation inside its flyout. Make waking substantial and listening, thinking, tool-work and speaking visibly different; actual runtime and audible playback drive the same cyan orb/open amber core and reflected light. Preserve the room, scene/window continuity and reduced-motion behavior.

All changes belong in [#417](https://github.com/DanAakesen/jarvis/issues/417), P8-40. Dan confirmed keeping all requested changes in this issue. This supersedes earlier two-step microphone and in-bar status requirements; PR #419 implements the replacement offline. One implementation PR must include responsive layout and observed motion verification. No separate prototype or new design decision is required. #398 remains the shell/input/messages task. Creating the issue and publishing these requirements does not start a worker or claim implementation.

## 6 October 2026 — Voice refinement implemented offline (#417)

PR #419 uses one reconciled voice presentation for the under-orb HTML feedback and scene state. The controls retain only More and End voice; current/next language feedback stays in the Language flyout. Explicit Start voice requests microphone permission and prepares audio, then attaches the granted stream after the authenticated handshake. Reconnect preserves mute; ending disposes late grants and audio resources. This replaces the separate-enable lifecycle recorded for P8-05/P8-36.

The same orb uses phased core ignition, outward wave and settling, with distinct listening/thinking/tool motion and actual playback-driven speech energy. Camera, room and platform remain fixed. Reduced motion uses steady forms. The focused tests and prior PR CI passed; Copilot reported browser fixtures and low-rate software-WebGL motion frames. Live microphone/provider, physical devices and normal hardware-GPU motion remain unverified. No new provider protocol or persistence is introduced.

## P9-36 (8 October 2026) — One capability and safety prompt for voice and chat

Keep shared tool-use and safety guidance in the backend, where the existing
memory automatic-capture setting can shape its knowledge rules. Realtime voice
uses the generated block directly; the agent-only `/agent/settings` response
delivers the same block to chat. Preserve the existing tool registry,
confirmation results, and bounded settings response; do not add a migration or
change the web app. Focused route, voice, settings-parser, and chat-prompt tests
cover the offline behavior; live provider behavior remains unverified.

## P9-40 (8 October 2026) — Backend-directed page navigation

Extend the shared `workspace_command` with `navigate` rather than opening an
external browser or generating another workspace view. Use canonical page and
Settings-section IDs in `packages/contracts`; accept task IDs and positive
safe-integer issue numbers only for Factory
and a section only for Settings. Flatten the root schema to satisfy L121 and
keep per-operation validation in the existing type guard. Reuse the authenticated
all-tab broker and acknowledgement routes without a migration or new channel.
Keep aliases in the shared capability prompt so voice and chat have the same
guidance. Backend contract, route and prompt checks pass offline; the UI session
must implement page transitions and application/refusal reporting before this
is a working end-to-end feature. No `apps/web` changes are part of this task.
The UI-session handoff fixes the page key to `knowledge` and Settings sections
to `appearance`, `jarvis`, `personality`, `voice`, `presence`, `memory`, `coding`,
`projects`, `routines`, `credentials`, `backend`. Aliases belong only in the
shared capability prompt. The UI resolves task/issue selectors and refuses with
a reason if they are missing or if Folio/Status is not implemented; sending a
command never implies application.


## P9-45 (8 October 2026) — Show or hide the conversation

Add `conversation` with `action: 'show' | 'hide'` to the existing flat-root
workspace command contract. Reuse its authenticated all-tab broker and require
an applied/refused acknowledgement; do not treat sending as success. This is a
reversible view change and needs no confirmation. Route invalid arguments
through P9-42's safe refusal guidance. The backend and shared voice/chat prompt
are implemented offline; the UI session owns the handler and the phone default
of hiding the transcript, with live acceptance still pending.

## P9-60 (10 October 2026) — Current-session controls

Add `session` with exact language (`da`/`en`), voice (`end`) and camera
(`front`/`rear`/`off`) action/value pairs to the existing plain-root workspace
contract (L121). Keep this separate from persisted settings and reuse the
authenticated broker's applied/refused acknowledgement and refusal reasons.
The page owns application and permission checks; the backend never requests
browser permissions, and Jarvis directs Dan to grant missing permission.
No migration, new App permission or `apps/web` edit is needed in the backend task.
The change is additive but old UI validators/dispatchers do not support it;
Dan holds merge until the coordinator confirms #641 handlers have landed first.
Offline checks cover the backend contract; live browser/model acceptance remains
unverified.


## P9-37 (8 October 2026) — Keep voice, chat, and the backend tool catalogue aligned

Treat `GET /tools` as the source catalogue for both model clients. Offline backend
tests compare voice tool names with that endpoint, check tool identifiers in the
shared capability instructions against the registered tools, and require plain
object roots for the model-facing chat and voice schemas. Provider behavior
remains unverified.


## 6 October 2026 — Credential health and repair (#457)

P6-18 keeps the existing `renew_soon` status vocabulary and Codex renewal lease.
Manual repair forces the runner's refresh but never bypasses running-task or
single-flight exclusion. Uncertain completion remains distinct from failure.

Copilot health uses a bounded authenticated GitHub check plus available Key
Vault expiry; it establishes token authentication, not seat entitlement.
That check owns Copilot status exclusively, so runner expiry-only metadata
cannot clear a confirmed authentication failure during Codex renewal.
GitHub App health follows actual installation-token mints, including catalog
operations, rather than an extra polling request. Failed mint transitions
raise one transactional activity alert per failure episode. Check timestamps
make observation freshness visible without exposing credentials.

Local fake-provider tests verify the backend contract. SQL Server CI and live
Key Vault/GitHub/Foundry checks are not established by those tests. Settings UI
wiring remains separate. Migration 0023 leaves 0022 available for #432 and
must be rechecked against the migration history before merge.

## 6 October 2026 — Direct voice sharing and living dormant orb (#435)

Dan requested the hotfix after seeing inspection guidance overlay More and persist into the typing composer. Voice More must offer native-permission start/stop for screen and camera plus on-request inspection, using existing capture/session cleanup. Transient guidance and failures belong in bottom-right dismissible toasts, outside chat layout. Under-orb state is bright white projected text with no dark badge or colored dot. Preserve awakening, add a gentle dormant pulse and more movement in the open amber core when awake. Existing runtime/playback truth, mirror, themes and reduced motion remain. Codex implements all changes in one PR under Dan’s explicit hotfix/merge instruction.

## 6 October 2026 — Stage glass shell, fixed orb and Activity on Settings

**Confirmed by Dan in a live local session (reference image supplied):** on the Jarvis page the rail, navigation and Context panels become translucent glass slabs angled back into the room, hinged at the outer screen edges. The message window and composer use more transparent glass with a rim and warm lower light. The composer orb is a living miniature of the stage orb's amber core. The stage orb stays fixed on desktop when windows open, which supersedes the move-left layout. Phones keep the flat stacked layout and the existing voice docking. The top-level Arrange menu is hidden on the Jarvis page. The "Activity, sharing and backend" disclosure is removed: the Now feed and backend sleep move to Settings, and screen sharing becomes a working top-bar toggle beside the camera. Pending confirmations therefore appear in Settings until a top-bar indicator exists. Scrollbars are thin glass. The conversation window docks onto the composer with a grab handle and an overshooting spring. Every workspace window shares one compact chrome and flies off to the top right when closed by Dan or Jarvis. Later the same day Dan asked for one room and one shell look on every page (the 3D stage now lives in the shell), a Kanban page that is first and default in Software Factory (a layout of the existing task data, not a new data source), a visual commit-trail release bar on Kanban, restyled Settings with a Back control and a restyled sign-in page, more transparent glass, and next-generation motion (pointer-lit glass and staged entrances). Chrome's styleable selects are used where available, with native fallback. Dan then made Kanban the only Software Factory page: the Tasks and Projects list pages are removed (old addresses redirect), Kanban gains Create task and Create project dialogs, and project management moves to Settings. Side panels float over content without moving it, and the navigation panel appears only for areas with more than one page. In the evening Dan asked for tasks to open as windows (not pages) that can be pinned, a tab bar under the top bar that minimised windows are thrown into, the chat bar parked as an orb in the rail off the home page and popped out on demand, a slimmer chat bar without the paperclip, an orb that wakes on hover, and an icon-only current-area mark in the rail. Pinned task windows persist in the browser only; server-side pinning of generated views (#430) is still open. Via the coordinator Dan also asked for presence-mode and memory designs in Settings (#468, #469); both are built against the merged APIs and fall back to an explicit "not available yet" state if a service is missing. This is UI-only work done directly by Dan and the UI session, outside agent issues.
**Confirmed by Dan on 8 October 2026 (P8-45, #430):** server-side pins are written only by the page through owner-authenticated routes. Persist a validated view and its stable workspace `viewId`, not window geometry or transient generated views; keep at most 20 and preserve the original `pinnedAt` when the same view is pinned again. This supersedes the earlier note that server-side generated-view pinning remained open. Migration 0038 and shared contracts provide the backend boundary; the UI session owns its controls and calls.

## 7 October 2026 — Sign-in layout and first-paint theme

**Confirmed by Dan:** the sign-in page must not flash light before switching to dark. The theme is applied before first paint from the last theme used on the device, falling back to the OS theme (not light) when none is remembered. The sign-in card moves off the orb into a dense glass slab low over the floor, without its duplicate orb. UI-only.

## 7 October 2026 — Windows, chat activity, jobs chip, knowledge graph

**Confirmed by Dan in the local UI session:** window tabs move into the top bar and the breadcrumb is removed; windows float and drag freely and may overlap the docked conversation; the Arrange menu is removed. While Jarvis works its bubble shows the orb's amber core (not an animated J) with rotating, shuffled first-person phrases and tool lines; tool calls show on Jarvis's reply. Look-at-screen/camera menu items are removed (Dan asks Jarvis instead). The jobs chip (P8-43) follows the coordinator's proposal that Dan delegated. The knowledge graph (P7-43) is a 3D star cloud (Dan chose it over a flat constellation and folder islands despite the higher cost, with the performance limits in DESIGN.md). The room's amber accents match the chat orb's brighter amber and its orange lines are thinner. UI-only.

## 7 October 2026 — Chat bubbles, glass transparency, loading and panel motion

**Confirmed by Dan in the local UI session:** bubbles lose their fill; Dan's rim is cyan and Jarvis's amber, with a running rim light while Jarvis works and a soft breathing glow on the newest reply. The conversation has no tab, and every other window is a Chrome-style tab, as is every background job. Voice keeps the shell. Windows and shell slabs are more transparent (less blur and tint), with stronger rims on high-density screens. The signed-in page never scrolls or bounces. The amber core loader is kept for the app's first load only (Dan found it confusing everywhere); after that, frames appear at once and content loads lazily behind glass placeholders shaped like it. The palette is reduced to cyan and amber (red only for errors); presence modes, primary buttons, success and voice states follow it, while the knowledge graph keeps four folder colours. Side panels animate closed as well as open. The knowledge graph keeps a subtle idle life (slow turn, breathing stars, occasional link sparks), which means it renders continuously at 30 fps while visible. UI-only.

## 8 October 2026 — Folio pane and Jarvis navigation in the UI

**Coordinator-relayed from Dan:** the Folio (P9-25) is built as a pane in the left sidebar slot rather than a page, so reopening never moves Dan off what he is looking at; `navigate { page: 'folio' }` therefore opens the pane. Jarvis's `navigate` command (P9-40) is handled in the shell with the agreed page and Settings section keys; unknown targets and pages that do not exist yet are refused with a reason. UI-only.
## P9-41 (8 October 2026) — Best-effort work presentation

**Confirmed by Dan in #568:** selected tool work is visible through the existing
workspace broker and activity stream, with the UI session owning rendering.
Automatic presentation does not await acknowledgements or change tool outcomes.
Settings/presence lookups have a 250 ms presentation-only deadline and suppress
presentation on failure; `on_the_move` overrides the default-on `showWork` setting.
Reuse the graph payload builder without a second vault search, and keep one
Code view per stored turn. Escape and redact bounded repository content before
publication; show Google staged summaries without confirmation codes or a new
approval path. Automatic views remain transient rather than adding Folio writes.
Evidence: `core/work-presentation.ts`, the shared tool/reflex dispatchers, and
contract/presentation tests. Backend implementation is offline; live UI acceptance
is pending.

## P10-04 (8 October 2026) — GitHub issues are the Factory board source

GitHub issues remain the single backlog and source of truth; Factory and
Copilot execute the work. Codex is the default executor for Jarvis-raised work,
identified by the `Codex` issue label. The backend board reads registered
repositories and uses the same six status columns and precedence as
`project_board.py`, with shared fixtures guarding parity. Recently closed
issues remain visible as Done for 14 days. Cached snapshots are invalidated by
signed issue, PR, check, and workflow webhooks and committed task events; no
GitHub Project write or database migration is added. The response is the
typed `{ project, fetchedAt, stale, columns }` contract, with issue, linked PR,
and existing Factory task details; `/now/events` emits a typed project-scoped
board update. The response contract is backend-owned; the UI session separately
consumes it. Offline fake-provider tests do not establish live GitHub App
permissions.

## P10-07 (13 October 2026) — Wire the canonical board into Kanban

Implements Dan's 8 October column decision through #793. Reuse the approved
Task Lens layout and the backend `FactoryBoard` validator; do not rename task
columns or duplicate GitHub placement rules. Select the first returned active
project because the board endpoint requires an actual project. Other filters
are local, with issue-update periods relative to the snapshot and filtering
before the explicit 100-card cap per column. Task states remain overlay facts;
task-free issues have no invented controls or duration. Share validated board
invalidations through the existing Now stream, refresh on reconnect, accept
version resets after deployment, and preserve board DOM/selection during quiet
refreshes. Loading another project hides the previous snapshot and cancels its
request. Live and cached failures remain visible. No backend or Project writes.
An observed 320px keyboard-return failure after moving a selected card is
handled by the shared panel's optional focus resolver: find the issue's current
title control or a usable board header action, while preserving existing element
targets. Local types, zero-warning lint, 160 tests and desktop/320px Chromium
fixtures pass. Authenticated live board placement and release remain to verify.

## 8 October 2026 — Voice-first phone shell

**Confirmed by Dan:** on phones Jarvis is primarily hands-free voice. The rail and side panels give way to a slim top bar, a bottom menu sheet and the chat bar as the dock; the transcript is hidden until swiped up or requested from Jarvis (P9-45, #596); Jarvis-opened windows are full-width sheets; presence switches to On the move on phones (P9-44, #595, a manual choice wins for two hours). Screen sharing is not offered on phones because no mobile browser supports it; the camera gets a front/back switch. UI plus the two backend issues named.

## 8 October 2026 — Collapsible sections as the default for settings-like UI; visual Usage page

**Confirmed by Dan:** Settings (web and phone) becomes a stack of collapsible sections, and this is the pattern for future settings, configuration and detail areas so pages save space and suit phones. The Usage page is redesigned to be visual and uncluttered: charts and figures first, tables folded away. Charts show only what the report contains (no invented time series). UI-only.
## P10-05 (8 October 2026) — Backfill issues for existing Factory tasks

Use the Dan-only `POST /factory/tasks/backfill-issues` route to create P11 issues
for open unlinked tasks in ascending task-ID order. Reuse the P10-03 issue
creation service so task codes, issue labels, and secret redaction stay
consistent. Include a stable task-ID title suffix to recover an issue after a
partial failure, persist its number before adding the `Jarvis` webhook trigger
label, and rely on the existing active-issue lookup to prevent duplicate tasks.
No schema change is needed. Offline route/service tests cover idempotent retries
and secret rejection; P10-01 permission changes and the coordinator's live run
remain pending.

## P10-06 (8 October 2026) — Factory issue delivery owns pull requests

Include the issue number and repository as trusted prompt metadata, and require
the Factory agent to commit and push its branch without opening a pull request.
Delivery adds a missing `Fixes #N` line to a reused task-branch PR and marks a
reused draft ready for review using the existing GitHub App token permissions.
An exception during post-delivery policy evaluation is logged with only a safe
reason/status and does not turn an already recorded PR into a delivery refusal;
later GitHub events can reevaluate policy. No new permission or migration is
needed. Offline issue-prompt and delivery tests cover the behavior; live GitHub
API acceptance remains unverified.

## P10-01 (8 October 2026) — GitHub App write permissions are live

Dan granted the Jarvis GitHub App Issues write, Workflows read and write, and Repository creation, and accepted them on the installation. Issues write is required for P10's issue creation, progress comments and label changes. Workflows write lets Factory branches touch `.github/workflows` files, which GitHub otherwise rejects on push. Repository creation supports confirmed new-project runs. Evidence: the production installation reports `issues`, `workflows` and `repository_creation` as `write`, and an installation token requested with `issues: write` for `jarvis` minted with HTTP 201. Status: accepted.
## P11-01 (8 October 2026) — Short Google Calendar approvals

Calendar create, update, move and delete actions accept only a later verified Dan
message containing yes, approve, go ahead or do it; no/cancel discards the action.
Replies are case-insensitive with optional final period/exclamation mark. Combined
requests and ambiguous replies are refused. The ten-minute expiry remains; staging
a new Calendar action permanently invalidates the previous one. The returned code
identifies the action for the tool, but Dan does not need to say it. Consumption
occurs before execution to prevent replay. Gmail, project archive and issue creation
retain their existing confirmation rules. No web change or migration is needed.
Offline validation: 55 focused pending-action, Google-tool and capability-instruction
tests pass, along with backend lint and build. Unit and fake-provider HTTP checks
cover approval, cancellation, expiry, identity/turn checks, supersession and Gmail
regression; live acceptance is pending.
Superseded in part by P11-10 (17 October 2026): the word list is replaced by a
server-side meaning step; the verified later Dan message, expiry and supersession stand.

## P9-09 (8 October 2026) — Appearance colours can be reset

`PATCH /settings` accepts `null` for `appearance.accent`, `appearance.accent-secondary` and `appearance.surface-tint`, meaning "remove the override". The store keeps JSON `null`, which the read path already ignores, so GET omits the key and the theme's light and dark defaults apply. No migration or store change was needed. Other settings still reject `null`. Status: accepted (requested by the UI session for #503's "Use Jarvis colours").

## 2026-10-08: Settings Memory shows only conversation memories

- **Decision (Dan):** Settings → Memory lists only what Jarvis remembered about Dan from conversations (durable memories), merged with the retrieval settings in one card. Vault notes are browsed in Knowledge, not Settings.
- **Rationale:** the old panel duplicated the knowledge graph and added no settings value.
- **Evidence:** `GET /memory` lists durable memories (folder General) before vault notes, so the UI requests `folder=General` and keeps `type: memory` items. A server-side type filter would remove the reliance on that ordering if more than 50 memories accumulate.
- **Status:** implemented on `ui/shell-iteration`.

## 2026-10-10: P9-72 phone voice stays below foreground content

- **Decision:** phone voice keeps the current page and header, with an always-docked
  orb/status and compact glass controls. The dock container is transparent and
  non-intercepting; desktop fullscreen voice is unchanged. The phone header is
  straight and unblurred.
- **Evidence:** fixture Chromium/WebKit at 390×844 reproduced the full-viewport
  voice container and curved top band. Header removal did not remove the band;
  hiding the canvas did. Extending the phone wall panels removes that exposed
  ambient-background edge. Dock lengths reuse P9-73 safe-area spacing.
- **Status:** implemented and browser-checked offline; physical iPhone and live
  microphone/provider verification remain open.

## 2026-10-10: P9-71 shared cyan selection

- **Decision:** navigation, top-bar toggles, tabs and segmented choices use one
  subtle cyan tint and readable foreground from canonical `--state-selected-*`
  roles. Weight or stronger icon strokes reinforce selection without a selected
  outline/glow. Presence mode colours remain separate from the open-menu state.
- **Evidence:** fixture Chromium/WebKit checks at 390×844 and 1280×900 in both
  themes exercise keyboard, touch, hover, press and reduced motion. CSS regressions
  verify selected text/indicator contrast; component tests assert current-page and
  toggle semantics. Before/after captures are in `docs/ui/screenshots/p9-71/`.
- **Status:** implemented offline; physical-device and live-service checks are
  not claimed.

## 2026-10-10: Orb inlay vibrancy and Folio navigation

- **Decision (Dan):** rear-ring orange inlays match the floor's vibrant amber.
  Keep the existing warm token and a fine profile; bypass distance fog and tone
  mapping for ring inlays only. Floor lighting, cyan geometry and motion remain
  unchanged.
- **Decision (Dan):** choosing a page dismisses Folio, including the current
  page, home/Settings links, the phone menu and Jarvis navigation. An area with
  multiple pages can replace it with its own navigation. History changes also
  dismiss the pane without reopening it on return.
- **Evidence:** focused navigation regressions and stage tests; local Chromium
  desktop/phone checks in both themes. Fixture captures and limitations are
  recorded in `docs/ui/screenshots/orb-folio-polish/README.md`.
- **Status:** implemented locally; production acceptance follows merge.

## 2026-10-10: Composer follows enlarged conversation

- **Decision (Dan):** desktop typing keeps the composer aligned with both edges
  of the visible maximised conversation, on home and when chat floats over
  another page. Restore/minimise/close return to the normal width; phones,
  voice and unrelated maximised windows do not trigger expansion.
- **Implementation:** derive the local chat-width token from the existing
  conversation window class and shell attributes, without a second state owner.
- **Evidence:** local Chromium fixture measurements, keyboard/window controls,
  hide/reopen and repeated toggles, with desktop light/dark and phone captures
  in `docs/ui/screenshots/composer-sizing/README.md`.
- **Status:** implemented locally; production acceptance follows deployment.

## P9-65: report device kind and honour command targets

- **Decision:** Snapshots carry `device.kind`; the tab refuses commands whose
  `target` names another kind, and retries once without `device` against
  backends that reject it.
- **Why:** The UI half must ship before the P9-61 broker so a command for the
  phone is never applied on the desktop and old backends keep working.
- **Status:** UI implemented first with unit tests; P9-61 adds offline-tested broker
  routing. Live phone/desktop acceptance remains unverified.

## P9-61 (11 October 2026) — Route workspace commands to the intended tab

- **Decision:** Reuse the existing device/target contracts and owner-authenticated
  broker. Default `active` selects the latest-snapshot connection; with no reports,
  select the first connection for older pages. Named `desktop`/`phone` selects
  the latest-reporting matching tab, never broadcasts or falls back to another kind.
  Explicit `all` retains broadcast, including unknown-device pages.
- **Why:** Snapshot context and default delivery must refer to the same tab.
  Missing kinds refuse with connected kinds; device labels stay out of context and
  refusal text. Freeze recipients when delivering so only those tabs can acknowledge
  or receive cancellation, even if later snapshots change the active tab.
- **Status:** UI device reporting (#642/#689) shipped first, as confirmed in #638.
  Backend routing, snapshot compatibility and guidance are tested offline.
  No migration, new App permission or web edit; live multi-device acceptance pending.

## 2026-10-11: Chat attachments reuse the More menu (#649)

- **Decision:** attach, paste and drop add files to the existing composer. The
  attach control is an **Attach file or photo** item in the shared More menu (the
  paperclip was removed on 6 October), so no new composer button, window
  arrangement control or layout change is introduced.
- **Rules:** five files, 10 MB images and 20 MB other files, checked in the
  browser and again by the backend. Send waits for uploads. A message with files
  queues rather than steers. Files open only through short-lived signed URLs.
  Jarvis's public-publication confirmation shows the image with a visible
  "This repository is public" note.
- **Evidence:** offline Vitest tests; Chromium at 1280×900 and 390×844 with
  stubbed auth and API. Live backend, Blob and provider acceptance remain pending.
- **Status:** implemented offline.

## 2026-10-08: Window management by intent (P8-42, #430)

- **Decision (Dan):** The page arranges windows automatically (smart fit by window count, cascade from five); Jarvis acts only when asked. Jarvis names intents and the page computes geometry: `place {viewId, region}`, `arrange {layout: auto | side-by-side | grid | cascade, viewIds?}`, `minimise-all`, `restore-all`, `close-all` and `pin`/`unpin`. "Stack" means a diagonal cascade. Windows placed by Dan or by coordinates stay put until "tidy up". Pins persist server-side across reloads and devices; pinned windows return as tabs, and closing a pinned window sends it to the tab bar.
- **Rationale:** intents are quick for voice, can't be wrong about the real screen size, and degrade sensibly on phones. Coordinates stay as a backwards-compatible fallback.
- **Split:** the UI session builds the layout engine, command handlers, pin UI and richer snapshot (window `state`, `region`, `pinned`, `front`). The coordinator adds the contract, pin storage and routes, and Jarvis's tool and instructions.
- **Status:** design agreed; implementation in progress.

## 2026-10-10: Integrated reports and compact window tabs

- **Decision (Dan):** use one solid background shared by report and host, rather than nested frames. Use compact rounded-rectangle tabs with clear buttons.
- **Treatment:** the canonical report surface follows light/dark appearance. Strip only document-level framing and a sole main/div/article wrapper, retaining useful nested sections. Synchronise presentation tokens without reloading interactive reports; retain the existing sandbox and CSP.
- **Controls:** keep window controls in one non-wrapping row. Tabs use a consistent window icon and one pin toggle; its orientation and accessible pressed state identify pin status. Preserve Close-to-tab behaviour for pinned windows, and show Close on unpinned tabs. Desktop controls are 32 px, touch controls 44 px; crowded tabs scroll and the phone list opens above windows.
- **Evidence:** local report fixtures at desktop, 860 px tablet and 390 px touch-phone widths; matching solid surfaces, single-row controls and preserved report-section selection after theme messages. The shared browser confirms one functional pin and the separate window icon. Typecheck, 64 focused tests and build pass.
- **Limitations:** additional real Settings-control browser acceptance and ESLint stalled; their helper processes were stopped. No production release or physical-device acceptance. Persistent-pin lifecycle work under #430 remains unfinished and unshipped.

## 2026-10-10: Notes source editor (P9-77, #683)

- **Decision (Dan):** the local UI session builds Notes after #626 merges.
  Rename the Knowledge page to Notes; use plain Markdown source with a Preview
  toggle and `knowledge` as an alias. Dan subsequently rejected the list-first
  interpretation: the normal graph is the default, clicking a note opens the
  familiar editable popup, and Create new in the corner chooses a section
  before writing. There is no Notes/Graph view switch.
- **Implementation:** reuse graph search, section filters and connected notes.
  Open exact source through the Notes API, retaining the original floating
  reader treatment with Edit Markdown, Preview and explicit Save. Section/title
  creation opens a draft in that popup. Source preserves whitespace and front
  matter; preview reuses the safe renderer and hides reader properties.
- **Save safety:** guard dirty/saving navigation and duplicate saves. Retain
  drafts on failed reads or writes; show 409 comparison rather than overwriting.
  Explicitly adopting the latest Contents SHA still requires a separate Save.
  Reread after a confirmed write because its commit SHA is not an edit token.
  Uncertain writes remain read-only until checked and are never auto-replayed.
- **Routing:** use React Router's data router for the real links/history
  blocker. Refuse Jarvis page changes immediately while dirty/saving so the
  workspace broker does not receive false success.
- **Previous list-first evidence (not acceptance of the correction):**
  typecheck, focused ESLint, production build and 130 Notes/router/graph tests passed.
  The isolated full web run passed 513 tests; three unchanged date/decimal
  expectations fail under this machine's en-DK locale. Chromium fixtures cover
  1440/1280 px desktop, 390/320 px phones and 844x390 touch landscape in
  light/dark, including reduced motion, keyboard focus, history/link/reload
  guards, saves/conflicts, visible Graph controls and editor scroll clearance.
  WebGL-disabled workflow fixtures do not verify hardware graph/room motion
  or a physical phone keyboard.
- **Contract integration (11 October):** merged #685 (`9e8d834b`) into the UI
  checkout and switched `/notes` snapshots to canonical `notes`, including
  after legacy-address redirects. Keep `knowledge` accepted and
  `show_knowledge` unchanged. Command/snapshot guard smoke and the 130 focused
  web tests pass; the full contract suite is unavailable locally because
  Fastify is missing. Backend deployment is not verified here.
- **Graph-first evidence:** typecheck, focused lint/build and the 131-test
  Notes/router/graph integration run pass. All 18 Notes workflow cases pass
  after adding keyboard-close and latest-draft star-selection guards. Chromium
  fixtures cover light/dark desktop, 320 px phone and 844x390 reduced-motion
  touch landscape, with intercepted saves/creation/conflicts. The real
  desktop graph canvas survives editing; portalled popups clear the dock and
  retain reachable close controls when short-phone documents scroll.
  The shared signed-in browser confirms the normal graph is the default.
- **Status:** Dan approved shipping the graph-first correction on 11 October;
  current main is integrated. The exact Notes-only release tree passes
  typecheck, focused lint, build and 132 Notes/router/graph tests. Chromium
  fixtures pass at 1440x1000 dark and 1280x900 light desktop, 320x700 light
  phone and 844x390 dark reduced-motion touch landscape. Initial concurrent
  test timeout and mobile fixture failures passed on isolated reruns.
  CI/deployment, post-deploy review and physical-phone keyboard acceptance remain.
  Fixture checks use synthetic sign-in, notes and intercepted writes, not
  live vault edits.
## 2026-10-13: P12-12 inactive optional nutrition export

Coordinator released only #727 after closed/deployed #722 using [pure source contract evidence](https://github.com/DanAakesen/jarvis/issues/727#issuecomment-6134567097). Ordinary ChatGPT logging is independent; canonical SQL meals alone feed exact owner-confirmed period snapshots. Scoped revocable export-device verification is a root-auth extension for only two inactive routes, not login/upload auth or a production credential grant. No verifier/issuance is installed. Claim-response replay returns no instructions; identical receipt ACK replay is harmless, conflicting ACKs refuse. Five-minute expiry, partial native writes and changed revisions/tombstones preserve uncertainty/out_of_sync. Recovery records checked-in-Health evidence but never automatically requeues, even when absence is reported; replacement native-write policy and actual phone behavior remain unverified. This conservative slice does not assert SQL guarantees exactly-once Health effects. 0044 adds only export evidence metadata with guarded rollback, and scoped canonical-writer changes affect status metadata only. Draft #758/Refs #727 requires exact-head SQL/full CI, independent review and explicit readiness release; device provisioning/activation/live/private/iPhone gates remain open. No original source/data/credential/access/resource changes or own merge.

## 2026-10-12: P12-01 Daily integration and migration authority

### P12-07 nutrition checkpoint (released after P12-03)

Dan released #722 after #718 merged/deployed. Supplied read-only source action contracts preserve accurate/approximate/estimate, voice/photo/text/mixed, explicit exact-label intent, accepted photo/portion proposals, permanent intake with exact-key revisions/tombstones, favourite definition/name reuse and owned-favourite 3–50-slot plans with server-summed snapshots. Trusted Jarvis metadata replaces no auth/dispatcher and never accepts model userConfirmed. Unknown macros remain null; plans/recommendations are not food. Guarded migrations 0042/0043 support unknown plan totals and confirmed standalone favourites/provenance without fake source/intake IDs. Frida deliberately stays at source release 10 / 5.5, DOI DTU.29500682, dataset version 8 published 19 January 2026, with DTU attribution and qualified CC BY 4.0 dataset terms. Public API shape/pin evidence is coordinator-provided; cloud CONNECT returns HTTP 403 and exact bootstrap format clarification is pending. No session borrowing, provider/live success claim or source mutation. Status: draft #743; exact-head CI/review and live gates remain distinct.

SQL validation caught new-column constraint compilation in migration 0043: a static constraint in the same batch could not bind the just-added provenance column, so startup rolled back and unrelated tables were absent. Use the existing 0040 deferred `EXEC` pattern for that constraint; preserve actual SQL startup/reapply tests and never treat cascading missing-table errors as permission to weaken checks. Exact repaired-SHA results belong in PR #743.

Provider-format clarification (16:17:51 UTC) resolves the earlier bootstrap/scalar questions: an empty body, response X-XSRF-TOKEN header and XSRF-TOKEN cookie; synonyms are arrays; mapped values are numbers; observed source IDs are numeric arrays. This sample does not prove global non-null provenance. Missing/null provenance stays unavailable, and unrecognized string/object structures are refused. No coordinator session values are copied. The repaired pre-format-tightening head passed full CI and all 109 SQL tests; final head still requires fresh checks/independent review before readiness.

Dan approved P12 on 12 October 2026 and explicitly released only P12-01 for this worker. The later [execution authorization](https://github.com/DanAakesen/jarvis/issues/716#issuecomment-6124634183) supersedes the original backlog-only and extra cutover-approval wording. The cancelled database-export/bundle-import approach is withdrawn; #1005 specifies source-contract-first API/schema and supported historical ingestion/replay. Original Daily continues ordinary authorized food/health writes and remains running/canonical before any future cutover. This cleanup does not alter its application/source code/schema or records; any final-delta, cutover or eventual legacy retirement follows its separate reviewed gates. Never delete the original repository or data. New secrets/access and unapproved paid resources retain their explicit-confirmation boundaries. This issue performs no cutover or production writes.

**Implemented contract, pending review/live acceptance:** default-off trusted module flag; metadata-only enabled endpoint; same server owner for existing user and hosted-agent auth; runner denial; reserved stable native view IDs. Production composition, shell, voice, login and dispatcher stay unchanged. **Planned:** source-contract-first API/schema and supported historical ingestion/replay in #1005, owner-bound Daily data/device services, and native mobile-first pages/views; cancelled #717/#721/#982 export/import work is not a prerequisite. [Full scope and evidence gates](daily-migration.md). Synthetic checks are distinct from live providers, SQL, cutover and physical-phone acceptance. TickTick excluded; notifications default off; private health/food data and credentials excluded from public Git/coding sandboxes.

- **Creation revision (Dan, 11 October):** remove Start writing and the filled
  Create new treatment. Open the blank editor immediately, with title and an
  Obsidian-style expandable folder picker. Dan chose existing folders plus new
  nested folders; those are local destinations until their first note Save.
  An untouched blank draft does not trigger discard confirmation. Typed title
  or source does; location/title changes must not modify Markdown.
- **Vault scope (Dan, 11 October):** “Jarvis should be able to read and write all
  folder, no limitations at all! full vault acess that is the whole point”.
  This supersedes the four routing-folder permission restriction for Notes and
  Jarvis vault access, including root notes and arbitrary nested directories.
  Preserve owner authentication, safe paths, existing secret handling and SHA
  concurrency; access scope is not permission to traverse outside the vault or
  overwrite a newer revision. Backend/contracts work and an actual full-vault
  folder inventory are requested from the coordinator. The local UI revision
  is not committed/deployed; full-vault live acceptance remains blocked on it.
- **Local revision evidence:** typecheck, scoped ESLint, production build and
  74 Notes/graph tests pass. Chromium fixtures cover dark 1440x1000 desktop
  with preserved graph canvas, light 320x700 phone and dark reduced-motion
  844x390 touch landscape. Immediate writing focus, title focus retention,
  nested destination creation, exact intercepted POST content, SHA/conflict
  recovery and dock clearance pass. Corrected an initial harness URL mistake
  and duplicate accessibility names. No real notes were written; full-vault
  backend access, complete folder inventory and physical keyboard acceptance
  remain unverified. The coordinator session is stopped; requests are queued.
- **Backend contract and scope exception (Dan, 11 October):** the coordinator
  started #697 (P9-80), backend/contracts only, and agreed an owner-only
  `/notes/tree` prototype contract sourced from the real Git tree. The picker
  consumed it directly, validated bounded paths/metadata, exposed truncation
  and freshness, and keeps drafting available on an unavailable endpoint.
  No graph or paged-index fallback is used. Dan explicitly selected
  “Exclude hidden dot-folders; allow all normal note folders”, superseding
  the unrestricted hidden-folder interpretation. Root Markdown and arbitrary
  normal nested folders remain required. Backend merge/deployment and live
  acceptance are pending; the earlier stopped-coordinator observation is
  historical, not the current assignment status.
- **Tree integration evidence:** typecheck, scoped ESLint, build and 93
  Notes/graph tests pass. Updated `/notes/tree` Chromium fixtures pass at
  1440x1000 dark desktop (graph canvas retained) and 320x700 light reduced-motion
  touch phone, including explicit truncation, new nested folders and
  intercepted saves. The shared signed-in canvas confirms the unavailable
  endpoint is displayed with Retry rather than a false complete tree.
  This evidence covers the earlier `/notes/tree` prototype, superseded by the
  final contract below.
- **Superseded folder proposal (coordinator, 11 October):** #697 was described as owner-only
  `GET /notes/folders`, with `{ folders, rootNoteCount, truncated, updatedAt }`.
  All depths and non-Markdown-only folders are included; root `""` is always
  first, ancestors are included, hidden/skipped folders are excluded, the
  timestamp is a non-null string, and the backend bounds the inventory at
  roughly 2,000 entries. The UI used this proposal, rejected missing root or
  malformed metadata, and distinguishes absent deployment (404) from an index
  not ready (503). Neither failure substitutes invented or graph-derived folders.
  Folder paths and final note paths have independent length validation, so a
  long existing directory does not falsely invalidate the whole inventory.
  Typecheck, scoped Notes lint, build and 98 Notes/graph tests pass. Final-contract
  Chromium fixtures pass at 1440x1000 dark desktop (graph canvas retained) and
  320x700 light reduced-motion touch phone (WebGL disabled), including root and
  non-Markdown-only destinations, immediate writing focus, nested new folders,
  exact intercepted saves, conflicts and dock clearance. The signed-in shared
  canvas still shows an unavailable live endpoint with Retry. Actual full-vault
  responses, physical-phone keyboard acceptance and deployment remain pending.
- **Implemented contract correction (#698, 11 October):** the coordinator
  superseded `/notes/folders` with `GET /notes/tree` and
  `{ directories, rootNoteCount, truncated, updatedAt }`. Root is implicit,
  the directory bound is 10,000, and `updatedAt` is an ISO last-sync timestamp.
  The picker now consumes this shape and offers Vault root even with zero
  directories/root notes. Note/graph items require `folder` and `directory`;
  older deployed responses remain readable through derived parent metadata.
  Typecheck, scoped Notes lint, build and 103 Notes/graph tests pass, including
  the exact directory bound, implicit-root handling and date-time validation.
  Updated Chromium desktop/phone fixtures pass with intercepted saves.
  The signed-in local canvas now loads the live tree and expands nested folders,
  without real vault writes; physical-phone keyboard acceptance remains pending.
  At inspected head `4d2d3279`, synchronization calls
  `indexedDirectoryTree(markdown.map(({ path }) => path))`, omitting
  non-Markdown-only folders. This contradicts the agreed full-directory scope
  and was raised with the backend coordinator; the requirement is not withdrawn.
- **Inventory gap resolved (#699, 11 October):** the follow-up is merged at
  `ffd29ec1` and the coordinator reports deployment/smoke green. Inspection
  confirms directory collection now uses every Git-tree file while counting
  only eligible root Markdown notes. Hidden/skipped directory segments remain
  excluded; `/notes/tree` names and bounds are unchanged. Reopening an untouched
  draft in the signed-in local canvas loads the refreshed live inventory with
  last-sync time 19:42:47. No code adaptation or live note write was needed.
  The backend blocker is resolved; Dan's local UI review and shipping approval
  remain pending.

## 2026-10-11: Centred Notes creation and camera request correction (local)

- **Dan's UI direction:** keep search centred and place a quiet plus-only
  Create new action inside it. Move vault inventory freshness into the note
  popup header's top row next to the close icon, not below the title, and remove
  the repeated hidden-folder exclusion notice. Narrow-phone metadata wraps
  within that row while keeping close reachable.
  The destination disclosure also uses one line, not stacked "Save in" and
  folder labels; long paths retain their full accessible name and tooltip.
  Dan then replaced the separate New folder button with a per-parent plus
  (including Vault root), revealed on desktop hover/focus and always visible
  on touch. Clicking it expands the parent and focuses a child naming row there;
  Enter/check adds and selects locally, Escape/cross cancels and restores focus.
  The new-draft instruction/path row is removed; existing note paths remain.
  Final picker checks pass typecheck, scoped lint/build and 92 Notes tests.
  Desktop/phone Chromium fixtures verify hover/focus/touch visibility, focused
  child naming, cancellation, nested selection and exact intercepted saves.
  Repeated clicks preserve the pending name; collapsing its ancestor cancels
  naming and returns focus to a visible control. No real vault write occurred.
  Hidden dot-folders remain refused, as previously approved.
- **Writing:** a new draft still focuses Markdown immediately. Scroll its source
  into view without motion so header metadata cannot leave the phone writing
  area clipped below the fold.
- **Camera evidence:** the screenshot's "can you see anything?" was absent from
  the shared chat/voice recogniser, bypassing frame capture. Recognise broader
  explicit English/Danish visual questions while keeping screen-specific wording
  on the screen path and unrelated turns free of camera uploads.
- **Switching:** Dan requested the switch icon only on mobile. Use coarse primary
  input without hover, not viewport width; desktop keeps status and camera-off.
  Real errors remain visible. No backend contract, camera permission or automatic
  every-turn capture change is introduced.
- **Evidence:** typecheck, scoped lint/build and 229 of 230 relevant tests pass;
  the unchanged en-DK decimal expectation is the only failure. Reduced-motion
  Chromium fixtures cover Notes at 1440/900 px desktop and 320 px touch phone,
  plus camera chat/both voice transports at 1440 px desktop, 320 px phone and
  844x390 touch landscape. Fresh JPEGs and transient context delivery pass;
  failed capture remains visible and does not send text-only chat.
  These fixtures disable WebGL and intercept writes. Initial normal-motion
  workflow attempts timed out; the signed-in canvas confirms live graph/search,
  header freshness and immediate draft focus, without vault writes. Sampling the
  existing popup entrance in the signed-in canvas confirms normal-motion
  progression with the empty Markdown source still focused.
  Physical-phone/live-model acceptance remains unverified.
- **Scope:** local UI only; no new commit, push or deployment authorised.

## 2026-10-12: Shell history frame and pin recovery

- **Decision (Dan):** show the chat window before its messages load, with loading
  feedback inside the window rather than appearing in the room or popping the
  window in after the request. Preserve the frame for empty and error/Retry
  states and keep loaded messages visible during refresh.
- **Recovery:** retry only temporary pin GET failures, at most twice within the
  existing deadline. A failed load can retry when the page becomes visible or
  connectivity returns. Do not retry pin writes, permission refusals or invalid
  saved data. Token failures retain explicit Microsoft sign-in guidance.
- **Evidence:** Dan's signed-in local browser showed the reported error; its
  manual retry returned HTTP 200 and removed the error. The earlier failure's
  transport cause is not proven. The client previously erased token failures
  behind the generic pin-load message. Regression and rendered checks pending.
- **Scope:** local correction; phone explicit show/hide and voice lifecycle
  remain unchanged. No backend change or broader draft release.

## P11-03 / #838 (14 October 2026) — Recover actual calendar stages

Private tool audit results omit confirmation codes, so later turns cannot rely on
conversation history to confirm a staged action. Keep the existing ten-minute,
one-shot process-local state and add a verified read-only
`calendar_get_pending_change` tool to recover the actual original code and summary.
Chat and voice must stage successfully before claiming preparation, then confirm
on a later plain approval without restaging or asking again. Missing and expired
stages return `none`. No persistence, migration or live calendar write is added.
(P11-10, 17 October 2026: "plain approval" now means any later message that
clearly agrees, decided server-side.)

### P11-03 Gmail ownership and extraction

Reuse the MIME reader and its regressions from #837 / task 12 at `bd052c0`,
with the same file path and return fields, rather than add a competing decoder.
#837 remains open and no task-12 PR was visible at this checkpoint. This task
adds hidden-preheader/invisible-padding cleanup and nested hotel-booking
regressions, plus extraction-limit guidance. Read both plain and alternate HTML
text; absent details in extracted text do not prove the original email lacks them.
Computer-use access enforcement stays owned by #837; this change uses only the
Google API and static HTML parsing. No private email was read for these tests.

Offline evidence for P11-03: 268 selected Google, instruction, registry,
presentation, approval, authentication, app and module tests pass after the
sandbox loopback/timing reruns; backend lint/build pass. The stage recovery audit
remains redacted, and failed/unstaged/replayed actions cannot execute. Python
instruction syntax is checked; hosted-model and real-account behavior are not
verified. No calendar change or deployment was performed.

## Consolidated Google delivery (14 October 2026; local preparation)

The user directed local consolidation rather than more issues or cloud workers.
Use existing #848/task-14 as the reviewable delivery for #837/#838/#839, preserving
task-14 extraction/recovery, task-15 evidence-grounded hosted/realtime approval
logic, and task-12 direct-only execution guards. This does not close the issues or
authorise publication/deployment. Current main remains authoritative outside the
Google surfaces; main smoke behaviour and accepted mobile blobs are unchanged.

Keep `calendar_get_pending_change` as the one pending-state tool, adding verified
reply classification rather than retaining task-15's competing name. Calendar
confirmation retains its original summary, consumes before executing, and cannot
be retried by a repeated yes after cancellation, expiry or provider failure.
Parity fixtures register the actual Google module; known result-status tokens
are not callable names, while unknown tool references still fail parity.

Task-15's broad reservation/context heuristic could suppress Gmail-only booking
lookups or an unrelated next request. Restrict reservation context to mutation
requests and stop applying old calendar context to unrelated non-approval turns.
Synthetic hosted-loop regressions cover both cases. Successfully decoded empty
Gmail bodies are not reported as unavailable; missing/malformed or preview-only
content still reports extraction limits. No private content or provider call
was used to establish these local outcomes.

Local evidence includes 267 hosted chat/voice tests, 251 runnable Node regressions,
full backend zero-warning lint, changed Python Ruff, direct MIME assertions and
actual registry receipt checks. Node uses verified 22.23.3 x64 with a non-pinned
Vitest/Vite snapshot; Python is 3.12.10 rather than target 3.12.14. Three HTTP/
parity/relay suites and full types/build remain blocked by unavailable dependencies.
The shared prompt's original 15,000-code-point headroom check remains intact;
compact equivalent PC/mail wording leaves room for explicit calendar evidence
and ten-minute approval semantics. Exact-head pinned CI and original live Gmail/
calendar/speech acceptance are unproven.

## Google independent-review corrections (14 October 2026; local)

Independent review rejected frozen patch `3073B943`; retain that original
artifact, not a rewritten passing receipt. Repair the five findings within the
same #848 delivery, without issue closure or a second publication stream.

- Generic staged/klargjort prose cannot establish calendar context. Mail-only
  history and actual mail confirmation stay separate from an older calendar
  stage; both pending scopes may coexist.
- Raw PC/browser operations check observed site/window metadata rather than
  trust input keywords or pretend the native application is named Gmail.
  Chrome's real process identity and opaque tab IDs must be guarded before
  planner/vision export and before action/confirmed dispatch. Reuse that boundary
  in the Codex executor; unknown site identity is a visible refusal.
- Weather, mail and build status questions are not calendar status referents.
  Reset unrelated realtime context before interception, retaining genuine
  calendar status and later-approval semantics.
- A mail tool does not forbid a separately requested unrelated computer action.
  Match independent intent to the verified current Dan message and scope nested
  execution to the same request/turn; observed Gmail and fallback remain refused.
- Successfully decoded empty plain or static HTML bodies retain their original
  body source even when a snippet exists. Return the snippet separately as a
  bounded preview; warn about unavailable full text only for genuine fallback.

Qualified local evidence: 290 Node tests in twelve runnable suites, 282 Python
tests, backend zero-warning ESLint, changed Python Ruff and actual handler
receipt proofs. Node/Vitest/Vite/Python qualifications and the original prompt
headroom are unchanged. Four app-dependent suites and full types/build remain
blocked by the same five missing packages; relay regressions are added, not
claimed executed. No provider/private-account or hosted speech acceptance.

The coordinator authorised normal owned local commits and one fresh-main
integration. Main `51bda5cb` is integrated with its diagnostics, generated PLAN
cells and protected mobile blobs preserved. The coordinator reports its normal
Deploy `38622011802` accepted revision 315; this is not Google-delivery release
evidence. Independent re-review, pinned exact-head CI and existing-PR publication
remain coordinator-owned. No push, new PR, metadata change or deployment here.

## Google residual targeted-review corrections (14 October 2026; local)

Targeted re-review failed exact `F3BD79DA` / tree `eba45700`; preserve that freeze
and original `3073B943`. The three reproduced findings are corrected in the same
delivery, not a new issue/publication stream.

- Appointment nouns inside mail subjects and receipt text are not calendar
  intent. Recognise the actual mail reply receipt structure before inspecting
  unquoted scope text, and let mail read topics reach the mail/model path.
  Explicit calendar mutations, genuine status/completion and repeated approval
  still recover real backend evidence without duplicate writes.
- A conjunction or punctuation match inside a query/quoted subject cannot
  authorise a computer action. Accept only complete unambiguous current-user
  command shapes for the narrow independent-operation exemption. Ambiguous
  topic text refuses; no model classification probe or blanket exemption.
- Establish real Windows application identity before applying browser-title
  checks. A Gmail-named source file in VS Code is not Gmail access. Keep Chrome
  URL/title validation before planner/vision export and late action dispatch,
  raw browser/confirmation guards and clipboard/Codex refusals. Native protocol
  fields and snapshot binding are unchanged.

Reproduction added eight failing hosted cases and four failing Node cases before
the fixes. Qualified post-main evidence: 306 Node tests, 296 Python tests (including
48 calendar fixtures), backend zero-warning ESLint, changed Ruff and four coupled
actual-handler-receipt hosted chat/voice cases. Instruction maximum remains
14978/15000. Full types still fail on only the same missing-package/consequent
diagnostics; four app-dependent suites/full relay are unrun for this revision.
No pinned CI/build or private/live/provider/device acceptance claim.

Actual main `36d72090` is integrated once under the coordinator's local commit
authority. All Factory/mobile/diagnostic blobs and task-table cells remain exact.
The coordinator reports Deploy `38629181064` passed Web/deep-link, backend health
and actual smoke, while backend/infra/hosted-agent deployment was skipped.
This Google delivery remains local and awaits the same independent reviewer,
coordinator-owned exact-head pinned CI and existing-PR publication.

## Google current-identity and topic-command corrections (14 October 2026; local)

The same reviewer passed all three exact F3 residual cases, then rejected
`CEC84A7A` / tree `438eeb6c` for two new tightly coupled findings. Retain that
failed freeze and all earlier artifacts.

- Raw Windows titles have no application suffix guarantee and are truncated at
  200 characters. Replace title-based browser inference with trusted current
  process identity from existing structured observations and actual Chrome site
  metadata. Missing or changed identity refuses, never defaults to native.
  Check window/clipboard data before export and native actions before dispatch,
  including confirmation and suffixless/truncated Chrome switches.
- UIA and visual observations replace different native snapshot stores. Use the
  other store for late identity checks so original action IDs/window/control
  binding survive. Identity-only capture data remains transient and is discarded
  without model/planner/audit export. No native-wire/C# change is needed.
- Preserve exact-current-user independent operations after clear topic-bearing
  mail requests. Split only explicit top-level separators outside balanced
  quotes, retain exact requested-operation binding and same-turn scope, and
  refuse ambiguous unquoted how-to topics. Do not globally reopen mail fallback.

Before the fixes, production-boundary fixtures reproduced 14 failing cases.
Qualified local evidence: 327 Node tests in twelve files, 296 Python tests
including 48 calendar fixtures, four actual-handler-receipt hosted chat/voice
cases, backend zero-warning ESLint and changed Ruff. Strict types still fail on
the exact same twelve missing-package/consequent diagnostic lines. Prompt
headroom remains 14978/15000; four app-dependent suites/full relay, pinned CI,
full build and original live/provider acceptance remain unpassed.

Use the already-integrated accepted base `36d72090` only; no further main fetch.
All 32 scoped paths, protected mobile/Factory/smoke blobs and PLAN table cells
remain preserved. A normal scoped local replacement commit is authorised;
publication/readiness/CI/release and later-main reconciliation remain with the
coordinator after independent PASS.

## Google pinned-CI fixture corrections (14 October 2026; local)

Independent review passed `3AF653B5`. The coordinator published its normally
integrated runtime/test blobs as `f2afaca9` in existing #848. Pinned CI
`38644147405` reported five backend failures in both Backend and Web jobs;
the 75 frontend files passed, so no frontend or CI configuration change is
indicated.

Four calendar approval fixtures omitted the test route's explicit agent
opt-in. Keep production authentication unchanged and add
`config.jarvisAgent: true` only to `/fixture/calendar-reply` in the tests.
Retain actual receipt/later-message/one-shot and failure-state assertions,
with a denied unmarked-route control proving zero handler/provider execution.

The paused sparse-tree PC fixture expected one observation despite enabling
visual fallback. Current process verification requires a second read before
capture, which the paused connection correctly refuses before RPC dispatch.
Assert exactly two UIA reads, no capture/action/planner/vision dispatch, and
the existing successful resumed action. Add an executable registry/connection
regression through a synthetic local WebSocket peer, not a real device.

Qualified correction checks pass 328 Node tests across twelve files and
zero-warning lint on the three changed test files. The two changed HTTP suites
still cannot collect locally because multipart is absent; strict types report
the same twelve dependency/consequent errors, with no new fixture diagnostic.
Earlier 296 Python/four coupled hosted proofs remain evidence for unchanged
runtime blobs, not newly executed checks or a passing corrected-head CI wave.

No production runtime, permissions, native wire, dependencies, check
configuration, protected blobs or PLAN cells change. Local app-dependent
execution remains package-blocked; the coordinator owns corrected-head
normal pinned CI, publication and release. Original Google provider/live
acceptance remains unproven.

## Factory canonical-status parity (16 October 2026)

For [#811](https://github.com/DanAakesen/jarvis/issues/811), mirror the existing
Project sync precedence rather than changing canonical statuses or interpreting
SQL task activity as ownership. `desiredFactoryBoardStatus` previously promoted
any linked draft before `needs-decision`; Python's `desired_status` already
kept an unclaimed decision issue with a parked draft in Needs Dan. The shared
fixtures omitted that case even though Python had a separate regression.

Keep review-ready PRs and actual worker labels ahead of Needs Dan. Preserve
the existing closing-reference parser and every supplied PR/task overlay,
including Running/Working facts; neither hiding facts nor forcing all decision
issues into Needs Dan would preserve parity. Share the missing draft/decision
controls across Python and TypeScript, with pure complete-board coverage for
task overlays and unchanged columns. No frontend, auth, timeout, cache,
provider or persisted-state change is needed.

This is a local source correction from released `3d3a12ab`, not full #811
acceptance. PM owns independent review, integration and rendered readback;
historical 502 causation remains unestablished; #717/#741 was parked at that
review, then the owner withdrew the database export/import path on 18 October.

## P9-121 — One Projects section (17 October 2026)

Keep the managed-project list, Add project action, and new-project defaults
inside the existing Projects section and `#projects` anchor. The seven defaults
remain in the existing page-level Settings save/PATCH; the Projects disclosure
shows unsaved, pending, confirmed, and failed states with an in-section retry,
without changing the endpoint or project PATCH contract. Add project previews
the saved defaults that the backend applies, and each registered project keeps
its own editable settings.

## P10-11 — Per-project completion policy controls (17 October 2026)

Show the active completion policy as a labelled, descriptive two-choice radio
group on project cards and project settings, and reuse that group beside the
project choice in Create task. A choice uses the existing project PATCH; keep
the saved choice visible until the server confirms the update, disable both
options while saving, and provide an inline retry on failure. State that the
change applies now, including to already-open pull requests. The new-project
policy default is separate: it only pre-fills projects Jarvis registers later,
and each project keeps its own changeable policy. This is web-only; the PATCH
contract, default values, and P10-09 merge behavior do not change.

## P14-01 — Preserve one shared web visual system (18 October 2026)

Keep the established Jarvis visual direction and `apps/web/src/styles.css`
tokens as the only shared style source. Normalize equivalent Settings cards,
header popovers, fields, error blocks and focus states by reusing existing
surface, rule, radius, type and interaction roles; keep route-specific content
geometry where it serves a different workflow. Do not add a library, theme,
route, data behavior or copy-meaning change. The per-project policy's success
announcement is the concise “Saved.” while its standing applicability hint
remains visible and the success stays announced with `role="status"`. The
bounded code audit and follow-up surfaces are recorded in
[`docs/ui-audit.md`](ui-audit.md); browser acceptance remains separate evidence.

## P14-04 — Ratchet shared borders, radii and surfaces (18 October 2026)

Keep the existing radius and surface tokens as the only shared geometry system.
Retain only structural 1px neutral side borders, represent selection through
shared surfaces, and replace inset-shadow pseudo-borders with real boundaries
or no boundary. A PostCSS ratchet in the existing web tests scans every
stylesheet; its exact-value exceptions carry reasons for the P14-03-owned
buttons and genuine circular voice control. No dependency or theme was added.
The Pass 3 audit records measured counts, classifications, exceptions and
synthetic before/after Chromium evidence; this does not claim live-service or
human acceptance.

## P14-13 — Keep action focus order in markup (18 October 2026)

Place each action group's primary action last in markup so keyboard traversal
matches the displayed order at desktop and narrow widths. Confirmation groups
keep the safe Cancel/Keep action first. Do not use CSS `order` to rearrange
action groups. Preserve the deployment form's 10px column gap and set its row
gap to 10px at every breakpoint. The shared button system owns no outer
margins, so no local deployment-button margin is needed. The TSX source guard
and CSS contract tests enforce these rules. Local browser/layout acceptance
remains a separate verification.

## P13-16 owner-bound proactive recall (18 October 2026; #937)

Chat and voice use one read-only tool over the same owner-scoped proactive item
query as the Proactive page. It is composed only behind the existing
`JARVIS_PROACTIVE_ENABLED` flag, returns only bounded display fields marked as
untrusted data, and cannot change item state or authorize actions. Reusing the
page's query keeps both views consistent and avoids creating a second read model.

## Conversational proactive suggestion preferences (#1207)

### Natural owner instructions (23 October 2026 follow-up)

Reuse the bounded, tools-free approval meaning interpreter with a distinct
preference-instruction family rather than expanding command regexes indefinitely.
Keep canonical requests deterministic; interpret other Danish/English owner
instructions independently against the exact candidate category/direction or
scope. Bare agreement is not an instruction. Negative preferences, including
“I do not want travel suggestions” without “anymore”, explicitly request a
disable. Disclaimed authorization such as “do not change my preferences” takes
precedence, including alongside a preference. Quoted/source text, hypothetical,
conditional or ambiguous wording must not authorize writes. Negating an action
such as “do not disable” requests neither a disable nor an enable.
Recheck the current owner message after interpretation and fail closed on
uncertainty, cancellation or unavailable model service.
For voice, re-read persisted owner text and active session and verify the live
source marker instead of comparing only the original request snapshot; a pending,
revised or superseding transcript invalidates the write.

Persistence, enforcement, defaults and reversal remain unchanged. Rolling back
this follow-up restores canonical-only conversation wording without changing
saved preferences or the Settings API. Synthetic dispatch/model-port tests are
not evidence of live model comprehension or live voice-provider acceptance;
those still require owner verification. No live preference change is authorized.

Use the existing owner-scoped Proactive settings record and API for category and
personal/work preferences; Settings, chat and voice must observe one durable
state. Defaults preserve existing behavior: every category enabled and scope
`all`. A direct owner request may patch only one preference at a time, and the
tool verifies that request rather than treating findings, source text or
per-item feedback as authorization.

Preferences govern unsolicited proactive output only. They do not disable source
providers or affect requested tasks. A restricted personal/work scope excludes
unknown and mixed findings. Category re-enable changes no pause, source, budget
or other preference. Successful changes cancel in-flight work, and current
settings are checked again at persisted/delivery boundaries; old findings,
todos and reminders are not deleted as a side effect.

## P14-08 — One form-control system (18 October 2026; #991)

Keep field geometry and state styling in the existing shared web stylesheet,
joining route controls through their current wrappers rather than changing
field names, handlers or validation rules. Use 38px compact fields on fine
pointers and 44px/16px fields on coarse pointers; preserve native select,
checkbox and radio semantics while providing one CSS select arrow and one
switch geometry. Invalid fields keep a linked message and `aria-invalid`;
Notes folder-name errors now expose their existing text through
`aria-describedby`. Guard the shared token, radius, focus and coarse-pointer
rules in the existing stylesheet tests. The Notes source editor and integrated
search fields remain layout exceptions, and Daily markup is unchanged.

## P12-25 — Conditional Daily section availability (18 October 2026)

The owner approved an optional `isAvailable(sources)` predicate on section
definitions, combined with—not replacing—the existing all-required-sources
check. This expresses Body & sleep's sleep-OR-metrics-and-catalogue requirement
without a shared registry or changes to existing sections. Views independently
check sources. Use a section-local sleep SVG rather than changing the shared
chart: stacked stages, total-only nights and unknown values need explicit
semantics, while existing line, grouped-bar and area output stays untouched.
Keep summaries limited to recorded numeric days/nights, split metric units,
and label incomplete reads. No backend, contract, write or access-control
change is part of this decision.

## P12-24 read-only Nutrition inside Daily (18 October 2026; #979)

Use the merged Daily plug-in contract and shared UI rather than a new route,
registry or nutrition read service. Day totals reconcile with the displayed
nondeleted meals; optional daily aggregates supply Trend and known neighbouring
logged dates, not replacement day totals. Keep missing nutrients unknown,
partial sums labelled as lower bounds, and unlogged chart dates as gaps.
Compare energy only with the configured resting-minus-deficit baseline and
explicitly exclude activity; never infer a missing target. Favourites and plans
are saved definitions, not consumed meals. Logging and corrections remain in
chat under the existing native approval boundary. The original Daily remains
canonical; synthetic inspection does not establish live source parity.

## Photo-backed food estimates use the existing review group (22 October 2026; #1196)

Reuse conversation attachments and the existing image-capable model path for
food identity and uncertain portion estimates; Frida remains a nutritional
reference only. In default-off Daily composition, inject the existing Frida
adapter through its owner-bound data callback and group `lookup_components`
inside `daily_food_review`. Do not register another tool name: the catalogue
has eight reserved slots and that headroom is not part of this feature.

Lookup is read-only. The model presents its component proposal, asks for missing
details, and repeats lookup after any user edit. For final review, accept generic
component names, grams and preparation only; resolve them again server-side,
derive nutrient totals from the returned values and preserve missing macros as
null. Missing amounts, unmatched foods or unknown calories return useful
uncertainty without staging a review. Bind photo capture to validated persisted
attachment references and include those references in the existing source
fingerprint; callers cannot supply capture, source identity or approval.

Use the existing exact browser Now approval, canonical meal write, idempotency
key and committed receipt. No new image service, meal store, confirmation
system, credential, schema, tool name or phone authority is introduced. Tests
use synthetic DTOs and attachment references only. Live Frida availability,
production activation and physical-device acceptance remain unverified.

## Keep food correction reviews compact without weakening approval (#1234; 23 October 2026; #1196, #1200)

Keep the existing browser-only Now confirmation and its 4,000-character limit.
Render corrections as changed field transitions plus meal identity, revision,
portion/nutrient context, source and uncertainty; render estimates and deletions
as complete compact projections. Never truncate details or change the canonical
proposal for display. If the full review cannot fit, refuse before staging and
offer a recovery that allows renaming an existing meal without splitting it.
Synthetic tool-path tests cover photo-meal renames, accepted and oversized
summaries, approval/rejection/expiry and replay; no live health data or device
acceptance is implied.

## P12-23 — Read-only Daily Workouts (18 October 2026)

Use the merged Daily plug-in, pagination and UI contracts without backend or
shared-component changes. Continue capped reads in explicit ten-page batches;
label incomplete totals and do not aggregate unlike or unknown units. Keep the
selected workout in a section-owned URL parameter, retain the list for Back,
and gate heart rate and recorded detail independently by capabilities. Render
the merged `{ id, detail }` result using Data's existing escaped JSON pattern.
Synthetic-only browser evidence is under `docs/ui/p12-23/`; live original-site
parity remains unverified and original Daily stays canonical.

## P12-26 — Daily overview summaries and integration audit (18 October 2026)

Use independently loaded Overview tiles for each exposed section, importing
the same pure date, display and calculation helpers as the section views.
Keep the inventory, hide summaries when their required source is absent, and
isolate failures and retries per tile. Retain the existing Briefs source and
replace its generic presentation with a history/detail workflow. Share a
two-request abort-aware queue across Daily query, capability and Nutrition
target calls so rapid section changes do not create unbounded reads. Preserve
unknown and partial semantics, owner-only access and original Daily as
canonical. The integration audit corrected raw chart-series labels, repeated
coverage copy, narrow Nutrition navigation and workout-detail spacing; no
backend, contract, navigation or write-path changes are included.

## GitHub App mint recovery alerts (#1212; 22 October 2026)

Derive a versioned SHA-256 scope from the mint kind, normalized repository or
catalog owner, and canonical requested permissions; persist only the digest.
Serialize observations and reject stale timestamps per scope. Track the current
status for each scope so a success resolves only that scope's active alert
history, repeated failures do not spam, and a new failure after recovery gets a
new activity row. Keep recovered activity and manual dismissal history intact.
Aggregate health is `failed` for any failing scope and `unknown` when only
unscoped legacy alerts remain, because their source scope cannot be proven.
Do not infer the cause of a failed mint or production recovery from offline
tests; no production state or credentials were inspected.

## Per-finding conversational feedback (23 October 2026; #1240)

Reuse UI feedback validation and the existing owner-scoped item store for one
shared chat/voice tool. Require a current stored direct owner request; resolve
pronouns/ordinals only from earlier bounded session recall, never from a
same-turn model-selected list or source instructions. Ask on ambiguity. Use the
existing seven-day snooze range and Europe/Copenhagen clock, rejecting DST gaps
and requiring CET/CEST for folds. Confirm the saved exact local time.

Use optional conditional item updates rather than a schema migration to avoid
clobbering intervening UI/tool feedback. Short-lived in-memory request tracking
prevents reapplying a completed request during its valid conversation lifetime.
No preference, task-completion or independent reminder behavior is added.
Offline synthetic checks establish local behavior only, not live acceptance.

## Chat tool chips hide after delivery (23 October 2026; #1085)

Tool chips appear only while Jarvis is working. Once a reply is delivered the transcript keeps just the task link and any generated image, so a finished turn reads as plain conversation. While working, the status line names the actual activity (derived from the running tool) instead of rotating random phrases, and finished steps use a bare thin tick or cross. The transcript also stays pinned to the end while a reply grows after it was added (it watches the messages, not only the transcript box), without pulling back a reader who scrolled up. No backend or contract change.

## Unbounded productive chat tool continuation (25 October 2026; #1256)

Normal chat and voice keep requesting model responses after tool-bearing rounds
until the provider returns a final answer; do not impose a replacement round
count. Retain the provider's per-response output/context constraints, backend
tool outcomes, authorization and confirmation checks, and caller cancellation.
Use the shared `JarvisTool.execution` contract in
`apps/backend/src/core/tool-registry.ts` and expose it through `GET /tools`.
Read effects execute fresh; action and unclassified effects reuse results for
the same provider-issued call ID within the originating stored message.
Additionally, after an uncertain error, a new call ID with the same canonical
tool input in that same source message reuses the uncertain result to prevent a
second write. A later owner message starts a new action scope. Known outcomes
with distinct call IDs remain distinct even when arguments match. Metadata never
grants permission; backend authorization, validation, confirmation and
owner-isolation checks remain authoritative. A replayed invocation permits a
tool-free synthesis attempt only when the round contains no other fresh work; if
the provider then requests a tool, fail explicitly as `tool_loop_stalled`. Keep
smoke invocation's separate bounded behavior. This removes only the
ordinary-conversation cutoff; it does not establish the cause of the reported
production failure or prove live provider acceptance. A provider-incomplete
response after tool execution remains a failure: no partial reply is synthesized
from prior tool outputs, and the user-facing warning indicates that an action may
have completed. Recovery of useful partial results is not implemented.

## Workspaces naming and legacy compatibility (#1279; 25 October 2026)

Use Workspaces for user-facing and canonical implementation names, including
the `workspaces` navigation key, `workspacesOpen` snapshot field, `/workspaces`
API, `workspaces_*` tools, and `dbo.workspace_items`/
`result_workspace_item_id` storage. Preserve existing clients and integrations
with legacy navigation/snapshot values, route/tool aliases, exported contract
aliases, a `dbo.folio_items` synonym, and synchronized old/new job-result
columns. Migration 0067 renames the table and backfills the new column without
deleting saved items; its down migration restores the old identifiers. Writing
NULL to only one result alias clears both aliases and delivery status; a mixed
write with one NULL alias and a valid delivery status synchronizes both from the
non-NULL identifier. Access controls and source-artifact retention do not change.
The separate chat-time layout remains below message text on mobile widths up to
700px and retains its desktop position.

## 26 October 2026 — One camera feature (#1317)

Dan confirmed Enable video and camera watching were always intended as one
feature, and requested removal of the obsolete separation. Enable video now
automatically delivers sampled JPEGs, while ongoing narration requires a typed
or spoken standing request. Tool acknowledgement distinguishes saved instructions
from received frames. Keep screen watching independent, retain budget/privacy
controls and the ten-minute inactivity cutoff, and never claim raw video.
The cutoff limits “until I tell you to stop”; changing it remains unapproved.
Local synthetic verification does not establish physical-iPhone or live-model acceptance.

## 26 October 2026, 14:21–14:22 UTC — Video continues until stopped (#1317)

Dan explicitly approved removing the ten-minute no-message camera cutoff while
retaining the spending limit. This supersedes the earlier ten-minute decisions
and the initial #1317 cutoff-preservation decision above. He added: “Or til I
close it of course. And make sure Jarvis can also start and stop that video”.
Close and user-requested workspace camera commands control the same continuous
sampled delivery. Startup still needs browser permission; session/sign-out,
permission loss, fatal errors and budget exhaustion still stop it. No guarantee
of background iOS capture or uninterrupted device access is made.

## 29 October 2026 — iOS direction; design before implementation

Owner-confirmed direction is limited to GitHub-based macOS builds, reuse of the
existing Jarvis backend, and native SwiftUI/iOS features and controls. The next
step is an agreed version 1 design/prototype; Dan may work locally on his PC.
Scope, layouts, retained branding, prototype tools and build/authentication setup
remain unconfirmed. No implementation or setup is authorized. The discussion,
proposals and dated references are recorded in [iOS app](../iOS%20app.md).
Migration and logging work continues independently.

## 29 October 2026 — iOS usage context and design decisions

The owner stated that the iPhone app will mostly be used while lifting weights,
running on a treadmill and driving, with minimal hands-on time and the screen
only glanced at, so the experience should be largely hands-free. Generative UI
workspaces and Jarvis control of the app itself (opening, closing and arranging
workspaces and navigating) are essential on iOS, as on the web. The owner also
confirmed these design decisions: native iOS glass and controls rather than the
web chrome; no bottom tab bar, with chat and voice switching from the composer;
areas open from a right-edge swipe-only sidebar, chosen for the prototype and to
be judged by use; an iOS take on the web composer, not final; the existing orb
design carries over; the phone has no presence picker and always uses On the
move; no paid design tools. GitHub Replica is ruled out because it does not run
on the owner's Windows PC. The HTML concept board is local scratch and cannot
establish native behaviour. Scope, sidebar contents, workspace presentation,
assistive access to the sidebar, presence behaviour with workspaces and
build/authentication setup remain unconfirmed. No implementation or setup is
authorized. See [iOS app](../iOS%20app.md).

## 29 October 2026 — iOS sidebar order, naming and removed control

The owner removed the "Jump or ask" control from the iOS sidebar, asked for the
area to be named simply Chat instead of Chat and voice and to be the first
option from below, followed by Notes, Health, Software Factory, banking (later)
and the rest, and asked for a code symbol as the Software Factory icon. The
owner also asked that the sidebar not be dragged far from thumb reach, so rows
and icons sit close to the right edge. The prototype lists the areas upward from
the thumb end and still shows a row of pinned shortcuts, which is not decided.
The final list of areas, the pinned shortcuts and assistive access to the
swipe-only sidebar remain unconfirmed. No implementation or setup is authorized.
See [iOS app](../iOS%20app.md).

## 29 October 2026 — iOS version 1 answers

The owner answered the version 1 checklist and accepted the recommendation on
every row except two. The Face ID lock is now on by default, set up at the first
sign-in, and approvals from the Lock Screen are allowed. Otherwise: hands-free
means a session the owner starts, with no always-listening wake word, and it
keeps running with the screen locked, ends itself after 10 minutes of silence
and pauses for calls and Siri. Version 1 is iPhone only (an iPhone 16 Pro Max on
iOS 27.2, with an Apple Watch), minimum iOS 26, TestFlight only, with English
text and English and Danish voice. Sign-in stays Microsoft with 10 days idle.
Only Apple crash reports are collected, and version 1 has no Health or location
data and no offline mode. In the sidebar the pinned-shortcuts row is removed and
the list sits low, nearest the thumb; a one-time hint teaches the edge swipe and
VoiceOver gets an Open sidebar action. Workspaces open as a full-height sheet,
one at a time. Version 1 is chat, voice, workspaces, app control and settings,
with Notes and Health next and unbuilt areas shown as Coming later. TestFlight
uploads run automatically after each merge to main, signing goes through an App
Store Connect API key, the design docs are committed to the repository, and
small backend endpoints for push and Live Activity tokens may follow. The bundle
ID is com.danaakesen.jarvis, being registered. The owner answered No to starting
the foundation phase, so no implementation or setup is authorized. The
safeguards proposed for the Face ID lock and Lock Screen approvals, and whether
the owner's account has the role the API key needs, are not confirmed. CarPlay,
the Apple Watch and Music are future intent only.
See [iOS app](../iOS%20app.md).

## 30 October 2026 — iOS App ID registered

At the owner's request, the App ID `com.danaakesen.jarvis` (named Jarvis,
explicit) and the App Group `group.com.danaakesen.jarvis` were registered in the
owner's signed-in Apple Developer session, and the group was attached to the App
ID. The saved state was read back from the portal. Nothing else was changed or
created on the account: no keys, certificates, agreements or app record.

Ticked: Push Notifications (Broadcast left off), Time Sensitive Notifications,
App Groups, HealthKit, Maps, Push to Talk and Side Button Access, plus MusicKit
under App Services and In-App Purchase, which Apple locks on. The owner added
HealthKit, Maps, Push to Talk and Side Button Access beyond the plan. Nothing in
the current design uses Maps or Push to Talk, and version 1 has no Health data.
A tick only permits a capability: the app's entitlements file decides what a
build uses. Side Button Access is limited to Japan, on iOS 26.2 or later, and
starts a voice assistant through an App Intent. Clinical Health Records stay
off.

Left off on purpose: Data Protection, because the complete level cannot be read
on a locked phone, which hands-free voice and CarPlay both need. Camera,
microphone, location, photos and Face ID need no portal tick, only a purpose
string in the app's Info.plist and iOS's own Allow prompt. CarPlay is not a tick
either: it is a capability request that Apple must approve, and requests need
the Account Holder role.

Still open: the owner's role (Account Holder or Admin), who files the CarPlay
request, and the owner's go for the foundation phase, which is still No. No
implementation or setup is authorized.
See [build plan](ios/build-plan.md) and [iOS app](../iOS%20app.md).

## 30 October 2026 — iOS foundation phase go and Mac cost guard

The owner gave the go for the iOS foundation phase, replacing the earlier No.
Phase 1a, the project skeleton and checks, is the first work. Later phases still
need their own go. The owner also set the build policy: build and test as much as
possible locally, and ship as much as possible on every GitHub build.

The cost guard follows from that. The owner's PC has no Swift toolchain and cloud
agents run on Ubuntu, so a Mac run is the only compile check for the SwiftUI
layer. Standard `macos-26` runners are free while the repository is public and
the account is personal. Larger macOS runners are billed even for public
repositories and are not available to a personal account, so xlarge labels are
never used. The workflows are designed as if the minutes were billed: GitHub
lists $0.062 per macOS minute for private repositories, roughly $0.60 to $0.90
for a 10 to 15 minute run (estimate).

Rules, set out in the build plan: logic stays in the pure-Swift `JarvisCore`
package, tested on Linux on every push. The iOS CI has a Linux job and a Mac job
that runs only after it passes, only for ready pull requests that touch
`apps/ios/` or shared inputs, with per-pull-request cancellation, a 20 minute
timeout, a SwiftPM cache, a simulator build without signing, and no simulator
boot, UI tests or screenshots. Screenshots run only on manual dispatch. The
TestFlight workflow builds, archives and uploads in one job on merge. Authors
keep pull requests in draft until the Linux checks pass and batch related
changes. The owner should set a GitHub Actions budget in Billing as a safety net.
The dispatcher reviews Actions billing usage at the end of each iOS phase. A
local Linux Swift toolchain for the owner is optional and needs the owner's go.
See [build plan](ios/build-plan.md) and [iOS app](../iOS%20app.md).

## 30 October 2026 — iOS screen approval gate

The owner said: "I want to make sure i greenlight every screen before its deployed."

Every screen is its own issue and its own pull request. Design gate: the
dispatcher shows the owner the concept frame for the screen, and no builder
starts on that screen until the owner has approved it. Code gate: the owner
approves the screen's pull request before it merges. A screen that has not been
approved is never built, merged or shipped.

Ship gate: the TestFlight upload workflow runs by manual dispatch only, started
by the owner, so nothing reaches the owner's phone unapproved. The automatic
push-to-main trigger is removed, and checklist row 19 (automatic uploads) is
superseded. The monthly keep-alive no longer uploads: it is a reminder to the
owner to run the manual upload, because TestFlight builds expire after 90 days.
An automated keep-alive of the last approved build can be added later if the
owner wants it. The other safeguards stay: the signing environment is limited to
main, there is no `pull_request` trigger, the secrets live only in the
environment, and build, archive and upload stay in one job, so a manual run is
also one Mac run. Uploads only happen when the owner starts them, which also
lowers Mac minutes.

Phase 1a, the empty shell with no real screens (#1370), is unaffected. See
[build plan](ios/build-plan.md) and [iOS app](../iOS%20app.md).

## 30 October 2026 — iOS Phase 1a implementation boundary

Phase 1a adds only the iPhone app target and its blank native glass root view.
The orb icon asset is prepared for the owner to review before any first upload;
no other screen or feature is authorized by this shell. The target uses the
registered `com.danaakesen.jarvis` bundle ID, iOS 26.0 minimum, Swift 6 compiler
in Swift 5 language mode, a local `JarvisCore` package, and
`ITSAppUsesNonExemptEncryption = NO`.

XcodeGen 2.46.0 and Xcode 26.6 follow the build-plan defaults. Linux CI tests
the pure-Swift package and checks project/plist/entitlement metadata. The
aggregate workflow selects the Mac simulator build only for ready pull requests
whose changes select iOS; manual dispatch does not start a Mac job. The Mac
build is unsigned and does not boot a simulator or run UI tests. Phase 1b
signing, upload and credentials were outside the Phase 1a implementation; later
screens remain out of scope for that foundation change.

## 30 October 2026 — P15-13 iOS navigation shell

The approved sidebar concept is implemented as a native SwiftUI shell. A custom
fixed-behind sidebar is necessary for the specified right-side drag reveal,
screen translation, dimming and blur; native `NavigationStack` owns page pushes
and back behavior. Pure-Swift destination and navigation state stay in
`JarvisCore` for Linux tests and future chat or voice navigation commands.

The shell opens to a Chat placeholder. Chat, Voice, enabled unbuilt areas and
Settings render title-only placeholders; Banking remains disabled and marked
Later. The sidebar uses system colors, typography, scrolling and SF Symbols,
with shared tokens for custom geometry and motion. No backend changes are part
of this decision.

## 30 October 2026 — P15-10 native Chat screen

The owner approved the Chat concept for implementation in this screen issue.
Use the board for composition only. Keep chat/SSE, history, attachment, Now
feed and confirmation behavior on the existing authenticated web routes; keep
time grouping and Now-feed decoding in the Linux-testable `JarvisCore`.
`JarvisDesignSystem.swift` is the shared source for native screen geometry and
glass-related tokens.

Message bubbles are custom because native SwiftUI has no conversation-specific
sender alignment with the approved glass treatment. The inline Now bar is
custom to combine live state and a pending confirmation's Approve/Decline
actions; the activity sheet is custom to present the existing feed categories
and decisions. Use native scrolling, sheets, file/photo pickers, system glass
button styles and SF Symbols elsewhere.

The web attachment limits are authoritative: up to five files, documents up
to 20 MB and images up to 10 MB. Camera/photos stay local until the existing
upload route is called on send. The app fixture is synthetic and only selected
by previews and the screenshot launch argument. It supports one sample text
turn; fixture-mode attachment uploads and feed writes are disabled rather than
returning fake success. Native Entra sign-in is not implemented here, so the app
provider fails closed without an existing Keychain session. ReplayKit sharing
remains disabled until a Broadcast Upload Extension and Stop lifecycle are
implemented; no backend change is authorized or needed.

## 30 October 2026 — P15-12 iOS Notes area

Implement the owner's approved Notes concept as four native tabs, following the
issue's Notes/Tasks/List/Graph requirement even though the checked-in concept
board currently shows only three tabs. Reuse the web app's existing vault and
knowledge routes through `JarvisNotesClient`; keep note saves conditional on the
SHA returned by the current note read, and load graph data before resolving
search node IDs. Read `voice.defaultLanguage` from the existing `/settings`
route for Danish/English interface copy without writing any settings.

Do not invent backend operations for standalone folder creation, note
delete/rename/move, task delete or task priority on create. Creating a note at a
nested path may establish its folder. Do not add a local database or offline
cache. The app does not yet have a native Entra provider, so existing stored
sessions can access the routes but first-time/expired-session sign-in remains a
separate gap. The cost guard also remains binding: CI must not gain additional
Mac builds, simulator boots or UI tests. Screen-specific screenshots may extend
the existing screenshot step only when explicitly required, without adding a
job or simulator boot. No backend route, dependency or CI job is added by this
screen.

## 31 October 2026 — P15-19 Software Factory area

Build the owner-approved Factory area with native SwiftUI and the existing
owner-authenticated Factory routes. The project picker selects one project;
Board, Needs Dan and Releases make requests only for that selection. Needs Dan
is intentionally not cross-project: the board endpoint requires a project ID,
and this screen does not fan out or invent an aggregate. Project administration,
APNs, the web-only branch graph, backfill and sandbox remain out of scope.

Keep all Factory models, filters, state-based control availability, and request
validation in pure Swift `JarvisCore`. Task controls repeat the exact request
with `confirm: true` only after a `409 confirmationRequired` response and owner
confirmation; other conflicts remain visible. Cancel has a native confirmation.
Creation uses one generated submission UUID for every retry of the same draft.
Completion policy is a project setting, so save changes through the existing
project PATCH and do not send policy in the task-create payload.

Use the existing ready-PR iOS screenshot job and its one simulator boot for the
Factory segments, details and key states in light/dark and Danish/English. This
is the issue-specific extension to the existing screenshot artifact, not
authorization for another Mac job, simulator boot, UI test or backend path.
Screenshots use synthetic fixture transport only. The merged main branch now
includes the approved Factory frames in `docs/ios/design/board.html`. Record
frame-level differences after comparing them with simulator captures; no parity
claim is made before an Apple build and screenshot review.
The owner reviews the pull request and starts any TestFlight upload.

## 30 October 2026 — iOS Phase 1b owner-started TestFlight workflow

The TestFlight workflow is separate from aggregate CI and uses only
`workflow_dispatch`. Its single `macos-26` job uses the `ios-testflight`
environment, requires the `main` ref, and builds, archives and uploads in one
run with Xcode 26.6 and XcodeGen 2.46.0. App Store Connect credentials are
environment secrets; the team is an environment variable supplied to the
export options at runtime. The key is mode 600 and removed by an always-run
cleanup step. Xcode output is captured so identifiers and team values are not
written to logs. Direct upload is the default; `xcrun altool --upload-app` is
only a documented fallback if the first real run establishes direct upload
fails.

The first archive/export/upload is unproven, including the key role needed for
provisioning and Xcode 26's export-options behavior. The owner configures the
environment and starts the first run after merge, then checks the signing
authorization, archive, export/upload result, rising build number, and
TestFlight availability. No run is started by this change.

## 30 October 2026 — P15-09 Apple adapter boundary

Keep Apple framework implementations in the iOS app target. The URLSession
adapter implements the existing HTTP and streaming seam without adding
backend-specific headers or routes; the app composition reads
`JARVIS_API_BASE_URL` from build configuration and receives its access-token
provider as a dependency so MSAL remains separate.

Store the session credential as a generic-password Keychain item with
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. This allows access after
the device's first unlock for later background use while preventing migration
to another device; synchronizable is explicitly disabled. Never log token
values. The checked-out `JarvisCore` has no WebSocket seam, so defer its Apple
adapter until #1391 lands rather than inventing or changing the contract.
The existing Mac job compiles these app-target adapters but does not run
simulator tests.

## 30 October 2026 — ready-PR iOS screenshot artifact

Extend the existing ready-PR-only `macos-26` simulator job rather than adding a
second Mac workflow. After the unsigned build, boot an available iPhone simulator
with `xcrun simctl`, capture the main screen in light and dark appearance, upload
and capture the light-appearance open sidebar using the
`--screenshot-sidebar-open` launch argument. Upload the PNGs as a 14-day Actions
artifact and create/update a single bot comment with the artifact link. Keep the
existing timeout and cancel-in-progress behavior; do not add signing, secrets or
TestFlight work.

GitHub workflow artifacts are downloadable archives and cannot be embedded as
inline images in an issue comment; the comment links the artifact instead. Do not
commit screenshots or publish them elsewhere. The sidebar launch argument
initializes the actual navigation state and rendered drawer, not a mock view. The
offline workflow tests pass, but hosted simulator, artifact and comment behavior
remain unverified until a ready iOS pull request runs.

## 30 October 2026 — P15-14 native Workspaces (updated 31 October 2026)

The owner-approved Workspaces concept is implemented with SwiftUI system
navigation, controls and scrolling, shared Jarvis UI tokens, grouped saved items
and one large generated-view sheet at a time. The screen and app-control runtime
reuse existing `/workspaces` routes and `/now/events`; no backend or iOS-specific
route, new dependency, simulator test or Mac job is added. Window/action behavior
is limited to operations the phone can apply; unsupported operations receive a
refusal rather than a false success.
Generated renderer subviews adapt contract payloads to native components; charts
use Apple's Charts framework rather than a custom plot or third-party package.

The checked-in standalone reference is `docs/ios/design/workspaces.html`; the
native list pins search to the bottom as shown and omits a create/plus control
because the shared contract has no create route. The screen does not add an orb
that is absent from the reference. All Workspaces UI/accessibility strings use
the persisted Danish/English app preference, defaulting to Danish. The shared
native gate orb uses a dark glass sphere with an orange center and no orbit or
meridian ellipses. HTML-app, knowledge-graph and code remain unsupported,
non-executable cards. A configured HTTPS web-app root may be opened, but no item
deep link is guessed.

Still open in the integration contract: active-client choice, command replay
after reconnect, desktop-only commands and version negotiation. Successful
registration/open does not establish that the phone was selected. The native
screen also requires a configured API base URL and existing Keychain session;
sign-in is not added here. Native compile and device/visual verification remain
for the existing Mac check and owner review.

## 31 October 2026 — iOS app icon

The owner approved a new app icon: a dark glass sphere with a blue rim and an
orange filament core on a black background, with no rings or orbit ellipses
around it. It replaces the earlier blue-ring icon as the single 1024 by 1024
RGB PNG in the app icon set. The artwork came from an owner-supplied image.
Home Screen appearance on a device is not yet verified.
