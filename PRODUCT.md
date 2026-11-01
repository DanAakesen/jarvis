## Whole-Jarvis diagnostic logs (#1341; owner confirmed 29 October 2026)

Read-only diagnostic access covers Jarvis's backend, hosted AI agents, coding
runners, deployments and supporting services, excluding unrelated projects. This
replaces the earlier backend-only scope. Retain the existing Foundry Reader role.
New persistent grants require exact approval; the existing narrow approval is not
expanded implicitly. One authenticated sensitive log capability must describe
actual enabled sources, with bounded reads, redaction, untrusted-evidence handling,
retained-history/ingestion-delay disclosure and honest source coverage. A read grant
cannot create missing history. No duplicate legacy feature, repair action,
arbitrary query/exec, credential, collection or retention change is implied.
The current implementation remains disabled; [whole-scope design](docs/jarvis-logs.md)
is preparation, not a claim of deployed coverage.

## Runtime test failure recovery (#1350; 29 October 2026)

The owner requested repair of failed Copilot test replies. Show meaningful,
sanitized failure information instead of describing every failure as interruption.
A history refresh must not imply that an uncertain managed turn is cleared or
replayable. Preserve the existing return-to-normal action and explicit sending;
no automatic resend, claim reset, new runtime controls or default change.

## Approved main chat harness replacement (#1350; 29 October 2026)

Replace the custom main chat loop through a controlled, switchable Foundry
Copilot-harness migration after fixing the live baseline. Preserve native audio,
Jarvis identity, existing tools/approvals, SQL memory, blob artifacts and separate
subscription-backed Factory workers. Automated comparisons use identical test
scenarios. Dan can test Current or Copilot through Test agent runtime in the chat
menu, opening a separate labelled conversation with no mid-conversation switch;
normal chats stay unchanged. The local candidate implements this selector and
session-scoped test view; Copilot stays unavailable until its live definition,
settings, bindings and application policies are verified. The owner also approved
retaining the Python bridge temporarily for voice fallback, using existing Jarvis
tools only initially, and excluding test conversations from normal history. Cutover,
rollback and retirement follow proven parity and required authorization. See
[migration scope and open decisions](docs/main-chat-harness-migration.md).

Jarvis is the owner's personal side project, not a multi-user product. The owner
does not require extra pre-live exclusion of test transcripts from search, recent
context or rolling summaries. Preserve existing authenticated owner checks and
the approved separate UI history. No context wipe is included.

## Native iPhone sign-in recovery (#1445; 31 October 2026)

Microsoft sign-in must open system authentication UI above the Sign-in gate,
using the highest eligible visible window in an active scene, not the privacy
cover. Failure to start or a two-minute token-acquisition timeout
must leave the spinner and show the existing Danish/English failure and retry
copy. Cancelling the sheet returns to idle. Real-device presentation and signed
TestFlight keychain/Entra configuration require separate verification.

## Native iPhone Voice screen (#1401; 30 October 2026)

The approved Voice screen presents one orb and one short live status, with mute,
add, captions and end controls during a session. A downward swipe minimizes
without ending the session. Ending voice, including from the minimized bar, returns
to Chat with a cleared navigation stack and a usable sidebar.
Reopening Voice after End connects automatically with a fresh transport and audio
session. The red End control follows the approved board. The shared dark-glass,
cyan-rimmed orb reserves its space; its orange/amber centre animates in place,
more actively when listening or speaking, without overlapping the status.
Voice status, controls and recovery copy support Danish and English; Reduced
Motion keeps the centre still.
Language follows the existing `voice.default_language`
setting, defaulting to Danish. Microphone capture and speaker playback use the
existing voice socket contract; speaking over playback interrupts it immediately.
Camera inspection and screen sharing reuse the web app's existing vision and
voice-context routes. Denied microphone permission offers a path to Settings.
Face ID locking is separate; background audio, Bluetooth and route changes, call
interruption and lock/call microphone recovery are not part of this screen.
Follow-ups to file separately: background audio; Bluetooth; audio route changes;
call interruption handling; microphone recovery after device lock; microphone
recovery after a phone call; CarPlay; and Action Button. P15-34 adds the separately
approved local Lock Screen voice Live Activity below.
The screen requires an existing Keychain owner-session token; native sign-in is
not included, so first-install voice remains unavailable until that separate work.

## Native voice Lock Screen Live Activity (P15-34 / #1470)

An active native voice session starts a local ActivityKit Live Activity after
microphone capture is ready and removes it on end or terminal failure. It shows
the approved Jarvis orb, title, Listening/Speaking/Muted state, elapsed timer and
audio-derived waveform. Thinking and reconnecting remain visible rather than
misreporting listening. Mute/Unmute and End operate on the existing in-app session
while locked, without opening the app or signing in. Stale controls cannot affect
a replacement session. Copy follows the app language, Danish by default, with
English resources. Activities disabled by the system do not prevent voice.
No APNs, push tokens or backend changes are included. P15-35 adds the approved
Dynamic Island presentation to this same activity.
Native button dispatch, background audio and the Simulator/board comparison
remain acceptance checks, not claims established by Linux tests.

## Native voice Dynamic Island (P15-35 / #1472)

Use the same ActivityKit Live Activity, attributes, state and embedded
`JarvisVoiceActivity` extension as the Lock Screen; do not request a second voice
activity. Compact shows the Jarvis orb and a small waveform, minimal shows only
the orb when another activity shares the Island, and expanded shows Jarvis, the
localized Listening/Speaking/Muted state, elapsed time, waveform, and working
Mute and End actions. Danish is the default and English is supported. Preserve
the dark-glass orb, cyan rim, amber center, orange as a restrained primary
accent, and stone as secondary. Simulator captures of compact, minimal and
expanded beside the approved board are required before acceptance.

## Native voice connection loss (#1476; 31 October 2026)

After an established realtime connection drops, Voice shows a muted orb, the
“Connection lost” title, and Retry now and End actions. Retry now starts another
session with the existing bounded reconnect policy; End closes the session and
returns to Chat. Initial connection failures do not use the lost state. Copy
follows the app's Danish-default language preference.

## Backend log authorization qualification (#1341; 29 October 2026)

Retained backend-log chat access remains disabled until Azure isolation is proven.
The existing deployment smoke route may return bounded, fixed authorization
observations from the verified backend identity. It exposes no log records,
private Azure IDs, credentials, arbitrary query input, new model tool or UI.
Empty negative queries and missing real controls never establish exclusion.
This verification stage neither assigns roles nor enables the reader.
Foundry resource verification uses the supported fixed log table and privately
classifies permission metadata into fixed verdicts. It never exposes metadata
identifiers or treats absent data, HTTP 400 or metadata as isolation proof.

## Backend log awareness and approved activation (#1341; 28 October 2026)

The owner has approved persistent read-only access to backend records and basic
workspace metadata, excluding other applications. Activation remains off until
live target, schema, effective-access and enforcement checks are complete.
Main chat explicitly names `read_backend_logs` for self-diagnosis when configured;
while disabled/unconfigured it must say log access is unavailable. The tool
catalogue carries the same availability distinction. These are retained,
backend-only diagnostics that can lag minutes; tool results establish current
access and data availability. They are never advertised as an instantaneous
stream or other-app log access. No new UI or log/retention changes.

## Review fixes (#1343; 28 October 2026)

The eight owner-approved fixes preserve one task per signed issue-label delivery,
carry the verified conversation origin through issue creation and label pickup,
and write task-status messages atomically with their delivery receipts. Retried
writes cannot consume a receipt without the message. Oversized issue startup
shows a retained Now alert naming the existing issue instead of implying work
started or creating another issue.

Gmail receipts distinguish waiting for approval, cancellation, completed writes
and uncertain outcomes. Settings approvals name each proposed model, reasoning
value and vision budget in USD per day.

Chat warnings and unsent queued messages survive reload in this tab, scoped to
the backend and signed-in account. Restored queued messages wait for the owner's
explicit Send queued messages action. Missing browser storage is reported.
Supported partial replies up to 512 KiB in UTF-8 survive recovery. Invalid
warning entries do not discard valid queued messages; when recovery reaches its
storage bound, unsent messages and uncertainty warnings take priority over
partial reply context, and incomplete saving is reported.
On mobile, Settings keeps its heading and explicit Save in a sticky top; desktop
keeps its existing footer Save. No Settings navigation guard, autosave or draft
persistence is added. Live/device and SQL integration acceptance remain separate
from local synthetic checks; implementation does not activate other features.

## Read-only backend log troubleshooting (#1341; P11-42; 28 October 2026)

Owner-approved chat access covers only Jarvis's own retained backend runtime
diagnostics, with secrets/free text excluded before model exposure. The reader
uses the authenticated sensitive read-tool path, reports time windows, ingestion
delay, partial/truncated/unavailable results, and treats logs only as untrusted
evidence. No UI, repairs, arbitrary KQL, other-app access or retention change.
Implementation is default off; the exact persistent Azure grant still requires
owner approval and deployed isolation proof. See [the contract and activation
plan](docs/backend-logs.md).

## Compact screen Stop control (#1333; 27 October 2026)

While a screen is shared, the composer shows one compact icon-only red square
Stop recording button beside Dictate instead of a separate status row. It stops sharing only, keeps the
draft and typing focus, and screen-share errors stay announced. Capture behavior
is unchanged.

## Mobile composer tap focus (#1315; 27 October 2026)

While typing on a phone, primary mouse-down on Send, Plus or Dictate preserves
textarea focus until native click performs the action. Keep the draft, one-send
semantics, cancellation, menu keyboard focus and transcript scrolling intact.

## Temporary Send diagnostic (local, 26 October 2026)

Approved passive, bounded, content-free in-memory tracing supports investigation
of the unresolved keyboard-open Send symptom. An explicitly pressed temporary phone Plus action copies the trace to clipboard;
no clipboard read, automatic transmission or persistence. This is not a proven fix.

# Product

## Shared readability material (#1324; 26 October 2026)

Use a moderately lighter shared blur on Plus, bubbles and header. Round both
composer top-corner borders only on mobile with the chat window shown.

## Chat bubble readability (#1324; 26 October 2026)

Frost the background behind both speakers' chat bubbles like the Plus menu,
retaining sharp text, translucency, existing layout and the desktop top-edge fade.

## iPhone Chat screen (P15-10; owner-approved concept, 30 October 2026)

P15-38 / #1478 applies Chat's approved ambient background to every native
screen and app-owned sheet: one light/dark definition and the same glow positions,
with glass content surfaces above it. The 1 November reconciliation reuses main's
`JarvisScreenBackground` (also used by `JarvisGateAmbientBackground`), without
adding another renderer or decorative orb. Voice and sign-in/lock
keep their foreground orb over the shared ambient base. This changes no routes,
notification delivery support or screen functionality.

Chat is the iPhone app's root conversation surface. It streams the existing
conversation events, pages the existing history cursor, reattaches/cancels
active turns, sends up to five local attachments, and shows persisted tool
outcomes. The Now bar and Needs you sheet reuse the web app's `/now` snapshot,
activity dismissal, confirmation decisions and event stream. No iOS-specific
backend path is part of the screen.

Jarvis replies render Markdown structure, including headings, emphasis, lists and
event date/time lines. Persisted tool outcomes stay unboxed and start at the
Jarvis reply's leading edge; only the user's message has a background. Generated
workspace views continue to arrive over the existing workspace event contract.
The native sheet also loads `html-app` artifacts from the existing authenticated
HTML-artifact route and renders them in an isolated WebKit view with a restrictive
content policy, no app bridge, and no persistent website data. The view can display
local HTML/JavaScript but does not support web-only `window.jarvis` actions such as
asking Jarvis, pinning, or opening links from inside the generated app.

The composer offers Chat and Voice navigation and a plus menu anchored above its
trigger. The menu includes Camera, Attach, Enable video, Share screen and Voice
language. Camera uses an in-app viewfinder and still-photo capture; video and
ReplayKit screen sharing keep frames local until a Chat turn sends them as image
attachments. Voice language reads and saves the existing shared setting and
applies to the next Chat session. The existing web contract allows documents up
to 20 MB and images up to 10 MB per attachment. Synthetic fixtures are clearly
marked and used only in previews and CI screenshots. Native Entra sign-in remains
a separate concern; no fake conversation or successful live sign-in is implied.
The activity sheet keeps the no-activity icon and text without empty category rows.
The composer Now bar appears only while a turn is sending or the feed contains
background activity.

The notifications toolbar button keeps its badge inside the 44-point control,
including two-digit counts. Notifications and Background activity sheets use a
compact xmark with a localized Done accessibility label (Færdig/Done). Both retain
the stone secondary tint and shared system glass surface without stacked fills or
strokes (P15-48, updating P15-29 / #1459).

## Whole-number meal estimate lists (#1327; 26 October 2026)

Display kcal and all nutrient grams rounded to whole numbers in one canonical
meal-estimate list. Retain protein, calories, fat, carbohydrates and fiber; keep
unknown distinct from zero. Calculations, stored values, approval fingerprints
and idempotency retain full precision. Chat and voice consolidate existing
nutrition bullets using server presentation; acknowledgment-only replies still
receive the complete list. Validate with synthetic fractional nutrition fixtures.


## Mobile chat scrolling (26 October 2026; local)

Scrolling the phone transcript while composing retains textarea focus and the
unsent draft, allowing continued typing and one-tap Send. An intentional outside
tap can still dismiss the keyboard. Physical iPhone acceptance remains unverified.
## Health meal estimates (#1321; 26 October 2026)

Jarvis advertises Health tools. Every meal estimate shows actual returned protein
(g), calories (kcal), and fat (g) as a list, including lookup-only responses and
pending proposals. Unknown values remain unknown; zero is shown only when returned.
Estimates do not log food. Exact-proposal approval, expiry and deduplication remain
required. The external Daily Assistant and internal data namespace are unchanged.

## Composer Plus readability (#1319; 26 October 2026)

The chat composer Plus menu must stay readable over chat text. From the trigger upward, place Attach file or photo, Voice, the other available actions, then Language. Voice uses a waveform distinct from the Dictate microphone. Preserve the native attachment chooser anchor and desktop parity.

## Mobile Send focus (#1315; 26 October 2026)

A phone Send tap while the message field is focused sends once without dismissing
the keyboard, leaving the field ready for the next draft. Cancelled presses do
not send. Existing upload, empty-draft, pending/steering and failure recovery
semantics remain in place. Physical iPhone acceptance remains unverified.


## Desktop composer parity (#1309; 26 October 2026)

Desktop uses the approved full-width draft and second row of borderless Plus,
Dictate and Send controls; Voice is under Plus. Attachment errors stay above the
composer, and attachment pills stay inside. The composer follows the history
window when resized, maximized or restored, with its popup above history.
Desktop navigation remains unchanged; Chat-only composer visibility is mobile-only.

## Camera preview follow-up (#1304; 26 October 2026)

Show only the unframed video and overlaid switch/close controls, using the existing app glass material. Remove visible Live and camera-direction badges. Preserve movement, camera switching and closing; retain fitted geometry through stream replacement and refresh it on playback resume.

## Native attachment chooser continuity (#1306; 26 October 2026)

Opening Attach file or photo retains the underlying plus menu while the native
chooser is open. Cancellation leaves the menu available; selecting files closes
it and continues the existing upload flow. Preserve plus toggling and ordinary
menu-action dismissal. No custom photo chooser is introduced.

## Accepted chat recovery (#1311; 26 October 2026)

Leaving the app or losing its HTTP stream does not cancel an accepted chat turn.
Returning recovers the running reply and its exact pending food invitation; completed
replies load from conversation history. Recovery never resubmits a meal or approves
an estimate. Explicit cancellation still cancels the running turn; actions already committed
remain committed. Existing exact-proposal approval, expiry, presence/source checks
and food receipt deduplication remain authoritative.


## Unified translucent chrome (#1301; 26 October 2026)

Menu popups, composer, bottom navigation and header retain visible but partial
translucency after opening settles. Dock selection highlights only the icon,
without selected background/border effects; keyboard focus remains visible.
This supersedes #1296's exclusion of the header. Existing icon colors and merged
phone keyboard/startup behavior remain unchanged.


## Camera/menu follow-up (#1296; 26 October 2026)

The camera preview can be repositioned with touch and desktop pointers, with
switch/close controls over the unframed video and subtle tinted blurred fills.
Repeated composer plus presses alternate opening and closing its menu. The
composer, bottom menu dock and menu popups are visibly more transparent while
keeping text/icons readable. Composer icons remain borderless; chat remains
undimmed behind the menu. Keyboard/navigation follow-up belongs to #1295.


## Workspaces saved-item pane (#1279)

The saved-item pane is **Workspaces** throughout the app and implementation.
Canonical identifiers are `workspaces`/`workspacesOpen`, `/workspaces`,
`workspaces_*`, `dbo.workspace_items` and `result_workspace_item_id`. Existing
clients and records remain compatible through `folio` navigation/snapshot
values, legacy API/tool routes, contract aliases, the SQL table synonym and the
synchronized job-result column added by migration 0067. Workspace delivery
remains a separate action.

## iPhone Workspaces (P15-14)

The native Workspaces screen reuses the existing saved-item routes and workspace
command stream. It provides search, kind filters, Pinned/Today/This week/Earlier
groups, refresh, open, pin, rename and remove, and presents one generated view at
a time in a native full-height sheet. Table, list, detail, text, timeline, chart,
task-card, status and image views render natively. HTML apps, knowledge graphs,
code views and unknown renderers remain non-executable unsupported cards until
their native presentation is decided. No create action or new backend route is
introduced. All native Workspaces UI and accessibility copy follows the persisted
Danish/English app-language preference, defaulting to Danish.

## iPhone Lock Screen tasks and decisions (P15-36)

The approved Lock Screen surface shows an ActivityKit Live Activity for real
running Factory tasks and an actionable Jarvis notification for real pending
confirmations. The task surface uses its actual state, activity text and start
time, tracking at most the five most recently started running tasks. Until the backend exposes measured task progress, the progress track stays
indeterminate and never presents invented step counts. Approve and Decline use
the existing authenticated confirmation endpoint, require device authentication,
and report success or failure in the Now activity sheet. New labels and recovery
copy follow the Danish-default, English-selectable app language.

The app synchronizes tasks and confirmations from existing backend snapshots and
events while active. Updates while the app is suspended are not promised: APNs
device registration, backend delivery and task/approval update or removal pushes
remain separate work.

## Conversational finding feedback (#1240)

The owner can mark one proactive finding seen, dismiss it, snooze it, or rate it
useful/wrong through chat or voice, using the same feedback state as the UI.
References must identify an actual finding; ambiguous “that one” requests ask
which finding rather than guessing. Snooze requires an explicit date and
24-hour Europe/Copenhagen time within seven days, with DST ambiguity resolved
before saving and the exact local time confirmed afterward. Feedback never
changes lasting preferences, completes a vault task, or creates a reminder.

## Vault mirror freshness (19 October 2026; P14-29)

Status shows one compact **Vault mirror** row: not set up, healthy, stale,
needs attention, failed, loading or read error, plus time since the last success.
Healthy includes no-op and busy runs; freshness becomes stale after 30 minutes
without success. Dry-run is always visible when reported: the mirror is not
writing into Obsidian. Expand the row for counts, write-back mode, a short fixed
reason and up to ten conflict paths. No status document is normal, not a failure.

The existing proactive checks create a normal-urgency finding immediately for
needs-attention, or for failed/stale status when success is over an hour old or
has never occurred, at most once per Copenhagen day and reason, with no push
notification. A recent transient failure stays quiet. Missing/unreadable status
does not create a mirror finding. No new flag or change to default-off write-back is introduced.
The mirror has reported live status since 20 October 2026.

## System status evidence (#1288; 25 October 2026)

System checks distinguish when a check ran from the evidence it evaluated.
Vault-index freshness follows the latest verified successful synchronization,
including no-change runs; the most recently changed content timestamp is labeled
as such and does not establish corpus freshness. A failed sync remains degraded,
incomplete embedding coverage remains visible, and no verified sync in the
current backend process—including after restart—remains unknown. Show the latest
attempt and last success separately. Foundry configuration or catalogue presence
does not establish runtime health, and a configured runner remains unknown until
probed. Refreshing Status does not trigger a model request or runner probe.

## Azure vault mirror safety boundary (19 October 2026; P14-27)

The Azure mirror runner reconciles the owner's Obsidian vault with its private
GitHub repository using Obsidian Headless Sync. It has been connected to the live
vault since 20 October 2026. The scheduled task on the owner's computer was
unregistered on 21 October 2026, so the mirror is the only vault sync route.
Obsidian-to-GitHub sync is enabled from the first run. GitHub-to-Obsidian
write-back defaults to `dry-run`; only the owner may explicitly set it to `on`
after reviewing runs, and it has been `on` since 22 October 2026. Fresh state,
conflicts, private policy and partial-pull/mass-deletion guards prevent unsafe
writes. Unresolved conflicts resolve in Obsidian's favour after 24 hours, never
by overwriting Obsidian. Whether a change reached a second device is visible only
on that device.

## Shared overlays (18 October 2026; P14-09)

Dialogs, sheets and menus use one stacking order without covering modal actions
with background windows or feedback. Dialogs retain their existing actions,
trap focus while modal, return focus on close and protect unsaved input from
accidental Escape/backdrop dismissal. Phone overlays fit the visible viewport
and scroll internally. Workspace pin errors remain readable in page flow with
their existing alert and retry action.

## Voice result previews (16 October 2026; P11-07)

Voice tool results use the existing automatic workspace presentation path.
A successful staged Calendar proposal displays its actual returned summary
as readable text, without its confirmation code. Showing or focusing that
summary never approves or writes Calendar changes. Simple summaries and dates
use an existing matching view or text/list, not an unsolicited chart/timeline.
Show-work preferences, on-the-move suppression and disconnected-screen
behaviour remain unchanged. The original transcript does not prove staging,
a write or the exact rejected payload; live voice acceptance remains separate.

## Mobile composer focus hotfix (16 October 2026)

P11-06 / #860 is the priority mobile focus-jump correction. Phone chat uses
the existing joined visible-viewport dock, including when a desktop chat
rectangle is saved on the device. Desktop manual placement must remain dormant,
not be fitted into the phone keyboard viewport or written back as a new
preference. Returning to desktop restores that saved placement. Preserve drafts,
conversation visibility and existing reader/tail-following behaviour through
focus, viewport pan/resize, keyboard dismissal and orientation changes.
Native-phone acceptance remains separate from controlled browser evidence.

## Mobile navigation and composer actions (#1287; 25 October 2026)

On mobile, show the message composer only on the Chat screen (`/`), not on
other pages or the open Workspaces screen (#1303). Desktop composer behavior
is unchanged.

On phones, keep message times below the chat bubbles. Use the compact composer
with a plus menu for existing attachments, video, screen sharing and realtime
Voice. Dictate is a separate action that adds recognized speech to the unsent
draft; it never starts a Jarvis voice turn or sends the draft. Dictate stays
active through pauses until Stop, displays interim speech as it arrives, and
can be toggled repeatedly. Genuine recognition failures stop it visibly. Make unavailable
browser dictation and microphone failures clear. On phones, give the draft a
full-width row and place borderless icon actions below it, preserving accessible
names. Show errors above the composer surface. Keyboard-covered navigation must
not reserve space above the keyboard.

Keep Chat, optional Health, Workspaces and Menu reachable in the bottom
navigation. Workspaces opens the saved-window pane; Software Factory remains a
separate menu destination. Show the current destination through its color only,
without an active-page dot. When the menu has more entries than fit, allow
horizontal swiping between six-entry menu pages and arrow-key navigation,
with three dots instead of Close/Previous/Next controls. Keep the chat visible
behind the menu and use shared subtle translucency for header, menu and composer.
Preserve existing attachment pills and image previews.

## Header background work (17 October 2026; P11-12)

The header's **Background work** control covers research, images, apps and
indexing, not Software Factory tasks or current service health. Show only
undismissed entries, with their real status, failure details and available
result/cancellation controls. Dismissing finished work is saved for the account
on the server, across browsers, devices and cleared browser storage.
It does not cancel work, delete records or remove saved results. Keep the
control and an explicit empty state available after the last entry is hidden
so keyboard focus is not lost. Storage/load failures remain visible and must
not be presented as a successfully empty list.

### What appears here

- **Research** starts when Jarvis runs a research request. **Image** labels
  recorded image work; **App** labels app work, including requested weather
  reports. These are supported job kinds, not a promise that every generation
  tool creates a header entry.
- **Memory re-embed** rebuilds memory and vault search vectors after an embedding
  model change, or at backend startup when vectors are missing. Viewing or
  dismissing the list does not start it.
- Rows show the kind, start time and stored reason. A trigger is shown only if
  recorded; older rows do not establish which trigger started them.
  **Interrupted by a restart** is neutral history, not a failure count or a
  claim about current service health.
- **Dismiss** hides finished work for the account; **Dismiss all finished**
  hides all finished entries, never running work. Equivalent finished rows can
  share a count and are dismissed together. Raw records remain available under
  the existing history retention for Status, Usage and audit.
- Existing browser dismissals are sent to the server once. A failed transfer
  remains visible as an error, with those entries hidden locally until confirmed.
- Research generation completes when the validated artifact and owner-scoped
  Workspaces entry are saved. Workspace delivery is separate: pending, unknown or
  failed delivery does not turn a saved result into a failed research job.
  Background work keeps an **Open report** action for the saved result; opening
  it after reconnect or reload reuses the same report and never reruns research.
  `Delivered` requires a Workspace acknowledgement and does not claim that a
  person has seen the report. Artifact or Workspaces persistence failures remain
  research failures, and partial findings remain identified as partial.

## Readable chat and attached phone typing (16 October 2026; local candidate)

Booking/event summaries use labelled records separated by blank lines, with
explicit known dates, years, times and local-time/timezone qualifiers. Do not
invent missing dates or zones, or claim the agent sees a live chat preview.
Ordinary chat supports paragraphs, emphasis, lists, links and fenced code.
Well-formed historical GFM tables also render safely in a bounded,
keyboard-scrollable region; malformed one-line tables remain source text,
not guessed records. New reservation summaries should prefer labelled lists.
Table replies may use the transcript width without widening ordinary prose.

Phone typing must use one explicit visible-viewport rectangle rather than
subtracting a keyboard estimate from a different fixed viewport. Preserve
the chat/composer seam, drafts and saved placement through keyboard resize,
pan, dismissal and orientation. Latest-following must survive repeated partial
table growth while a response remains open, not just catch up on completion.
Reading older history opts out of following until explicitly resumed.
Physical iPhone/Safari acceptance remains
open; earlier synthetic passing checks do not contradict Dan's screenshots.

## App-wide control consistency (16 October 2026; local candidate)

Equivalent actions, tabs, filters and fields must use Jarvis's existing common
control geometry across routes. Do not introduce arbitrary action capsules,
decorative coloured boxes, bevels or inset-shadow control borders. Preserve
semantic status chips, necessary neutral structure, accessible selected and
disabled states, visible keyboard focus and usable touch targets. Reuse the
existing visual direction; no replacement theme or control framework is needed.
Dan's direct instruction of 18 October 2026 supersedes the earlier button
appearance limits for buttons only: shared primary actions may use a token-based
tonal gradient, visible rim and restrained accent glow, with equally clear
secondary, ghost and danger treatments. Other controls retain the shared
geometry and surface constraints.
See `DESIGN.md` for the contract and `docs/agent-context.md` for consumed guidance.

## One balanced 3D stage budget (15 October 2026; local)

Keep one recognisable room, cyan shell, open amber core and mirror floor.
Dan wants a single balanced implementation, without quality tiers, modes
or settings choices. Retain the mounted room across navigation, holding
its last frame behind work pages; animate on home/sign-in and during
voice. Preserve truthful activity/audio, explicit microphone ownership,
reduced motion, hidden-tab pause, context recovery and usable HTML fallback.
Rendering must have bounded frame, pixel and reflection work, without
frame-time-driven resolution oscillation or redundant drawing-buffer resets.
Dan's local feedback is that the stage still looks good; this is not a
measured CPU/GPU utilisation reduction or a production flicker verdict.

## Header tab overflow correction (15 October 2026; combined candidate)

Window and background-job tabs must shrink as their number increases, then
scroll horizontally within the available header space. Presence and Settings
retain their own space. Keep full titles accessible and preserve Show/Restore,
Pin, Close and job details. The phone window sheet stays a vertical list.
Generic thinking, speaking and tool activity belongs in the conversation and
beneath the voice orb, not in the header. Backend-waking feedback remains.
Dan requested this correction in the next deploy; his physical mobile-composer
report remains unresolved, with no device-fix or live acceptance claim.

## Hosted chat terminal response (15 October 2026)

The hosted chat application's `done` SSE event ends that response. Process its
bounded completion metadata once, stop consuming later frames and await disposal
of the owned response reader; do not require the server to close its HTTP socket
first. Preserve partial-text streaming, pre-completion errors, cancellation,
authentication and existing response-size and request deadlines. This is not a
Factory task-completion or physical cloud-deallocation signal.

## Mobile/Status review publication (14 October 2026)

Dan approved commit, push and a separate review PR for the accepted phone
composer and page-acknowledgement correction. The requirements below are
unchanged; approval supersedes earlier local-only publication holds, not
merge, deployment or live/device acceptance gates. No backend or Factory
change belongs to this publication.

## Page navigation acknowledgement correction (14 October 2026; local)

A page-navigation command may acknowledge success only after the requested
route has committed in the shell, not merely after requesting the switch.
Status can acknowledge its mounted loading/error page without waiting for
health data. Cancellation, supersession, disposal and the existing command
deadline must settle truthfully; preserve drafts and the shared stream.
Successful completion must recheck the captured deadline, including an
already-current page or pane; a delayed timeout callback is not an expiry
check. A late route may still appear, but it must not acknowledge success.
Local evidence of an acknowledgement race does not establish the cause of
Dan's reported first-turn failure or release acceptance.

## Phone typing keyboard correction (14 October 2026; local)

The chat frame and composer must stay joined when the phone keyboard opens,
the visible viewport pans, or iOS Hide Keyboard restores space without
blurring the input. An outside touch dismisses Message Jarvis without
swallowing the tapped action; composer/menu controls and other editors keep
their own focus behaviour. Preserve unsent text and saved chat geometry.
This correction changes neither voice nor backend behaviour and is not a
production or physical-iPhone acceptance claim.

## Remaining UI release (13 October 2026)

Dan authorised "Deploy everything. so i can test live." This releases the
remaining chat, Notes and report refinements together and supersedes the
earlier instructions to hold or split these drafts. Camera #750, immediate
chat loading #751 and window management #752 are already deployed.

Chat moves from its header Move control and resizes from its plain borders
and corners, without decorative handles or interception of the native
scrollbar. The composer follows it without losing its draft. Device-local
position and size survive refresh; fitting a smaller viewport does not replace
the saved preference. Minimise retains the composer position.

Notes remains graph-first. Create new opens a focused, writable blank draft
immediately; its destination picker includes the vault root, arbitrary safe
folders and attachment-only directories from `/notes/tree`. Per-folder plus
controls add a local destination; only explicit Save writes to the vault.
Freshness, unavailable/incomplete inventory and save conflicts remain visible.

Generated reports share one opaque surface with their workspace frame.
Appearance changes update the existing iframe rather than resetting its state.
Backend APIs, permissions, camera ownership and pin persistence are unchanged.
CI and deployment remain the release gates; Dan's live/device acceptance is
not inferred from local fixture checks.

## Workspace window release (12 October 2026)

#430 implements the agreed window intents: smart-fit automatic layout,
`place`, `arrange`, `minimise-all`, `restore-all`, `close-all`, `pin` and `unpin`.
New windows come forward. A named cascade puts the first `viewId` frontmost;
manual placement remains untouched until tidy-up. Phone geometry requests
focus the named view instead of forcing desktop coordinates.

Generated windows can be pinned from the title or tab. Owner-scoped pins
return as tabs after reload; Close keeps a pin, while Unpin removes it.
Updates refresh the saved view. Acknowledgement waits for storage, and failed
or timed-out saves retain visible recovery. Pin reads retry transient failures
within a bounded deadline and recover on a visible return/online event;
sign-in failures retain sign-in guidance. Camera and chat lifecycle remain
unchanged. Notes, report appearance and movable-chat drafts stay separate.

## Chat loading correction (12 October 2026)

Show the conversation window as soon as the signed-in shell is ready; do not
wait for history data to create it. Load messages inside that same frame with
visible loading text and placeholders, not in the empty stage. Empty history
and first-load failures remain inside the window with Retry where needed.
Refreshing existing history keeps the messages visible. Phone minimise/show
behaviour remains intentional. Saved-window pins and their idle recovery
belong to the separate #430 release.

## Camera UI release (12 October 2026)

Dan accepted the camera conversation and authorised shipping #695 at 21:20,
relayed by the coordinator. This supersedes earlier camera-release holds below.
The coordinator reports live chat `visual.path=image` on every tested turn;
live voice image acceptance and physical-phone checks remain separate.

Camera preview is a preview-only workspace surface sized to the local video's
actual aspect ratio and the available workspace, with no surrounding frame around
the video and overlaid camera-switch and close controls. Its accessible workspace
identity and lifecycle remain. Front/Back status and mobile-touch-only switching remain. It docks without stopping
capture; Close/Turn off, session end, permission loss, fatal failure or exhausted
spending budget stop the tracks. Silence alone does not stop active video. Status, observation notices and playback recovery remain visible on
the video without scrolling its controls away. Failure recovery stays visible. Camera controls never share or cover
the composer. Camera-on chat and correlated EN/DA realtime turns upload a fresh
frame using deployed #713 `mode: 'handle'`, then forward its single-use handle
without requiring a caption. Legacy screen inspection stays caption-first.
No frame-only result is cached or replayed; rate/daily limits without a real
cached caption report unavailable. Backend image/caption evidence remains honest.
Window pins/layout, floating-chat resizing and Notes drafts ship separately.


Jarvis is Dan's personal AI platform: one app, controlled by chat and voice, that grows area by area. Phase 1 is the **Software Factory**: Dan asks Jarvis for a change, a coding agent (Codex or GitHub Copilot) does the work in a cloud sandbox, and GitHub Actions builds, tests, and releases it.

Keep implementation phases and progress in [PLAN.md](PLAN.md), feature summaries in [docs/features.md](docs/features.md), visual choices in [DESIGN.md](DESIGN.md), system structure in [docs/architecture.md](docs/architecture.md), the data model in [docs/data-model.md](docs/data-model.md), commands and operating constraints in [docs/agent-context.md](docs/agent-context.md), and dated decisions and learnings in [docs/decisions.md](docs/decisions.md).

## Purpose and users

- **User:** Dan only. Single user; no multi-tenant or team features.
- **Purpose:** one Azure platform for building software projects, and later for banking, health and fitness, calendar, and further areas, all controlled through one shared UI and voice.
- **Language:** Dan speaks Danish and English. UI copy and documentation are English.
- Jarvis can develop its own repository through the same task flow.
- For overall capability overviews, chat and voice briefly name every successfully discovered category. They must not invent unavailable categories or describe failed/refused discovery as successful.
- Prefer Microsoft services, so Dan learns the stack and new Foundry features, unless Dan confirms a different provider for a capability.

### Roadmap

| Phase | Goal |
| --- | --- |
| **1 — Software Factory** | Voice or chat → coding agent → GitHub → live board and voice updates. Start with one project, then verify parallel tasks. |
| **2 — Banking** | Integrate the existing Banking app into Jarvis with shared UI and voice access. Scope open. |
| **3 — Health and fitness** | Clean up the existing health solution and migrate valuable functions, integrations, and history to Azure. |
| **4 — Windows app** | The same core experience through the shared backend. Framework open. |

Only phase 1 is in scope now, extended by P7 (Jarvis everywhere: web and voice confirmations, screen and camera, PC control, calendar, mail and notes search) and P8 (the complete Jarvis UI) in [PLAN.md](PLAN.md). Banking, health and fitness, and other areas get no tables, pages, or code until their phase starts.

## Scope and core workflows

### Confirmed experience

| Area | Requirement |
| --- | --- |
| **Jarvis** | Jarvis is the app and its main page. Dan talks to Jarvis in one continuous conversation (chat and voice), with saved messages and streamed chat replies. Chat turns save the source message before invoking the hosted agent; productive tool investigations continue until final synthesis rather than stopping at an arbitrary round count, and only a completed reply is saved. Tool calls link to the source message. Dan can discuss Jarvis's code and features through read-only repository tools; files and issues are untrusted data. Code changes use issue-first Factory handoff; project references resolve against active registrations, and ambiguity is clarified before a write. |
| **Notifications and approvals** | Notifications appear in the authenticated Now feed; gated actions await Dan's single-use approval in the browser in every presence mode. When an English browser voice session is active, Jarvis speaks concise task-status and pending-approval notices. Jarvis does not send external messages. |
| **Board** | Kanban-style task view: add, start, steer, pause, resume, cancel, and follow tasks. |
| **Updates** | Events update state and progress live, without manual refresh. Automatic board updates preserve an in-flight read in the same scope and coalesce into one follow-up; project, backend, identity and unmount changes still cancel obsolete reads. |
| **Assignment** | One active coding agent per task. |
| **Plan tracking** | The repository's `PLAN.md` is the shared task-status view, with each task linked to its GitHub issue. An open issue with a worker label (`Codex`, `Copilot`, `Dan`, or `Jarvis`) or an open linked PR sets In progress (assignees are ignored), completed tasks set Complete, and all other tasks, including issues closed without completion, reset to Not started unless Blocked is set by hand. New task rows get a labelled issue with dependency links. |
| **Parallel work** | Dan controls concurrency across projects; capacity depends on provider limits and compute. |
| **Agent choice** | Codex or GitHub Copilot per task, regardless of project. |
| **Subscriptions** | Coding tasks and image generation use Dan's ChatGPT/Codex subscription through the Jarvis-only login; Copilot uses Dan's work seat on his personal GitHub account, approved for Jarvis. Codex usage is shared with Dan's use; no per-image API billing or fallback is allowed. |
| **Voice** | An open browser is enough. Danish and English, chosen from the shared More → Language menu in the composer and voice bar; status requests and follow-ups. During English sessions, Jarvis announces selected task, pull-request, and deployment status changes in fixed short wording, merging bursts and waiting until the current voice turn is idle. Voice Live credentials stay on the backend; the browser connects through an authenticated backend WebSocket relay. |
| **Reflex layer** | Jev evaluates stable streaming voice clauses as they arrive, with the per-turn ledger of prior actions, so high-confidence, complete, reversible open/navigation/pause actions can run before Dan finishes speaking. English and Danish Voice Live keep streaming the final transcript to Jarvis; the relay replaces any early partial message with the final text and gives the ledger to Jarvis to prevent repeats. Submit, send, buy, delete, merge, uncertain, and confirmation-requiring actions wait for the final turn and required confirmation. If the final transcript contradicts an early action, Jarvis attempts an available undo and reports success, refusal, failure, or an unavailable undo honestly. |
| **Phone workspace** | At phone width or short coarse-pointer landscape, one content view is foreground. New views open directly as foreground sheets; there is no inline view-tab bar. Switch by horizontal swipe, the Open windows picker, or the existing workspace focus/restore command; hidden views retain their local state. The top bar remains visible while scrolling. The persistent stage orb stays subdued behind content, while the small composer orb remains the explicit voice-start control. Active voice docks the orb and its separate status above a compact glass bar (More, End voice) below foreground content, and returns to the main space when all content is closed or minimised. Agent-delivered views and requests remain P8-15. |
| **Presence modes** | The owner can choose Present, Away, or On the move by saying or typing it. A phone or desktop may set its device mode, but a manual change takes precedence for two hours. No Graph or Teams presence is read. Active use of the authenticated Jarvis browser app returns the owner to Present; background feed refreshes do not. The persisted mode appears in the header presence control. Each chat and voice turn states the mode and its built-in behavior: On the move is voice-first, very brief and hands-free, never asking the owner to paste, type, copy, open, read or look at a screen; details can be saved for later. Away uses tools for routine requests and queues screen-dependent work for a return summary. Present allows richer answers and windows/reports. In every mode, Jarvis fetches available content with tools or names missing permissions rather than requesting a paste; manual sharing is optional only when present. Custom mode preferences remain supported; empty saved text uses built-in behavior without a destructive migration. Mode changes refresh active instructions, preserving the approval rules. Pending browser approvals appear in the header attention popover in every mode, and active English browser voice sessions announce concise status. |
| **Local PC bridge** | A Windows tray companion signs in as the workspace owner with Entra and keeps an outbound authenticated WebSocket to Jarvis. Registered Jarvis tools open HTTP(S) URLs in Chrome, match installed apps by name (never Edge), close apps normally, open files and folders beneath `C:\Repo` in VS Code, report the active window title, or focus a window by exact title. `pc_act` controls any foreground Windows app through bounded UI Automation, including safe keyboard shortcuts and explicit non-sensitive text in the focused control; only irreversible actions require approval. The owner can pause Jarvis control from the tray; the bridge blocks control actions and reports pause state through the authenticated feed. No inbound ports are opened. |
| **Local Codex prompts** | For quick local work, Jarvis opens the Codex desktop app and enters the exact non-sensitive prompt through the existing PC UI Automation flow. Typing needs no confirmation; irreversible submission uses Dan's existing approval flow. Jarvis explains clearly if Codex is unavailable and does not claim success unless entry and submission complete. Tracked repository work uses Factory `create_task` instead. |
| **Calendar and mail** | Jarvis reads today's Google Calendar agenda, finds free slots, searches and summarises Gmail, lists and replaces simple drafts, archives messages, manages labels, and prepares calendar changes, reply drafts, or messages to send. Calendar writes wait for Dan's later reply, in the same chat or voice session, to the latest staged action, within ten minutes. A reply that clearly agrees in his own words (English or Danish, for example "yes please, book both") approves it, a clear no discards it, and anything unclear or conditional gets one short natural question; Jarvis never asks him to say particular words or a code. The server decides what the reply means (a plain one-word reply at once, anything else with one bounded model check that refuses when unsure); only a verified, later message from Dan in the same session can approve, never the model, a tool result or mail content. Gmail writes follow the same rule for the latest staged action. Reply drafts are saved to Gmail for Dan to send himself. Mail content is untrusted data, never instructions. |
| **Long-term knowledge** | Dan's private GitHub vault is the source of truth. Jarvis searches it by meaning, reads bounded notes, and automatically saves clearly stated preferences, people, project facts, decisions, and unfinished tasks with a commit link. The backend indexes safe Markdown at the root and in every non-skipped directory, and exposes a bounded note graph of links and semantic neighbours; `show_knowledge` opens the validated graph view with search matches highlighted, with UI rendering handled separately. |
| **Notes (P9-77)** | The existing graph is the default Notes page, retaining search and folder filters across every indexed safe Markdown note at the vault root and in any normal folder. Clicking a note opens its familiar popup with Markdown editing, safe preview and explicit Save. The centred search contains a quiet plus-only Create new action that opens a blank, immediately writable draft; title and an Obsidian-style expandable destination tree live alongside the editor. Vault inventory freshness appears in the popup header, including when the phone destination picker is folded. Dan requires read/write access across all normal vault folders and root-level notes, not a four-section whitelist; he explicitly approved excluding hidden dot-folders, without a repeated notice in the picker. The picker uses `/notes/tree` and adds its implicit root locally, not a graph or paged-index fallback. Backend #698/#699 is deployed and inventories directories from every Git-tree file, including folders containing only non-Markdown files; Dan approved the remaining picker for shipping on 13 October. Incomplete, not-ready or unavailable data stays visible without blocking writing. New folder adds a draft destination under the selected folder; saving its first note creates it in the vault. Dirty drafts guard closing, changing notes and navigation; an untouched blank draft closes freely. Stale writes offer reload/comparison without automatic overwrite. `knowledge` remains a navigation alias. |
| **Web research** | Jarvis uses live web search through Dan's existing ChatGPT/Codex subscription, returns only retrieved HTTPS sources with titles and retrieval times, and identifies unsupported, stale, inaccessible, or source-free results honestly. Retrieved page text is evidence, never authority over tools; no Bing or pay-per-call search fallback is used. |
| **Interactive research reports (P7-37)** | A quick or deep research request opens an acknowledged progress window immediately, updates observed query/source progress, then replaces it with a cited, self-contained HTML report artifact. Jarvis speaks a brief findings summary on success; failures remain visible and are announced. The report runs only in the sandboxed `html-app` iframe renderer, with the validated host bridge and Dan-authorized artifact access. |
| **GitHub events** | The backend verifies GitHub webhook signatures and ignores duplicate delivery IDs for pull requests, check runs, workflow runs, deployment statuses, and pushes. A ready-for-review pull request or failed deployment publishes only a typed status kind to the active voice session after webhook processing; payloads and logs are never spoken. |
| **Continuity** | Work continues when the browser or voice session closes. |
| **Sandbox** | One sandbox per task: starts when work begins, closes after delivery or cancel. Runner terminal status follows bounded cleanup; verified work can survive a later cleanup failure only with authoritative stopped-writer proof. Cancellation waits for owned cleanup and reports failure instead of false success. A completed runner turn is not task Done without verified GitHub delivery and project policy. The agent runs targeted builds and tests only; no Docker. |
| **Build and release** | Full builds, all tests, and releases run in GitHub Actions, as in Dan's normal workflow; never in the sandbox. Managed projects can copy the repository's PR-check and OIDC-release workflow templates and adapt their build and deployment commands. |
| **Project settings** | Per project: how far agents may go (deliver a PR, or complete without deployment), merge rules, sandbox size. |
| **Settings** | A settings page controls Jarvis, voice and coding-agent defaults using only server-validated models, plus the app-wide light/dark appearance; updates affect new sessions and tasks, not running work. Dan can also list and delete saved PC/browser Routines. |
| **Routines** (formerly task recipes) | After a successful PC/browser run, remember its app/site key, normalized goal and stable operation/target sequence, never entered values or sensitive data. Jev chooses among matching app/site routines plus none and verifies each step against a fresh snapshot; ambiguous or missing targets fall back to normal planning, and low confidence asks Dan. Existing pause and irreversible-only confirmation gates still apply. |
| **Decision provider (P9-76)** | Reflex, browser, recipe and PC decisions are scored by Jev (default) or Microsoft-Decision-1, chosen in Settings under Decisions (also by asking Jarvis). Switching applies to the next request. If the chosen service cannot answer, Jarvis acts as if no quick decision was made; it never silently switches. Logs record which service decided, to compare speed and agreement. |
| **Transparency** | Usage and cost per task and project: sandbox time, model tokens, voice, and Codex/Copilot usage. Show today's UTC Jarvis tool-call counts by tool, including refusals and failures; subscription usage has no fabricated DKK cost. |
| **Tool argument recovery** | Voice and chat receive safe validation hints so Jarvis can correct invalid arguments and retry without executing the invalid call. Repository search identifies incomplete or empty results and suggests listing and reading files rather than claiming code is absent. |
| **Sign-in** | Tenant-specific Microsoft sign-in requests only the delegated Jarvis API scope; the backend allows only the owner's Entra object ID and returns his display name from `/me`. MSAL keeps its browser cache in `localStorage` so tabs share the device's sign-in; a non-identity marker permits silent SSO and one guarded top-level recovery redirect after a prior sign-in. The default path never forces account selection; **Use a different account** is explicit, and **Sign out** clears the cache and marker. Tokens stay in MSAL. Persistence of the Microsoft sign-in depends on Microsoft's session, the browser and its "Stay signed in" choice; SPA refresh tokens remain limited to 24 hours and tenant sign-in-frequency policy can require sign-in sooner. When `JARVIS_OWNER_SESSION_ENABLED` is on (default off in code, on in production since 23 October 2026; #1217, web client #1220), a successful Microsoft sign-in can mint a revocable, opaque owner token in the background. The browser uses that session first for backend requests and voice, checking it on load without MSAL renewal; a 401 is confirmed before clearing it, while 429, 503 and network failures keep the session and retry. If an MSAL account or prior-device marker is known, an unsuccessful restore falls back to silent Microsoft sign-in after about 25 seconds without deleting the stored session; requests prefer Entra until a session-authenticated request succeeds. A slow session restore or status probe shows “Waking Jarvis…” after about three seconds. It lasts 10 days of normal use, with a 30-day absolute cap and at most 10 active sessions. The owner can revoke the current session or every session in Settings. With the switch off, verification stops on the next request and session routes return 404; the next off-mode process start with SQL and the owner configured attempts to revoke active stored sessions once in the background. This may wake a paused serverless database; no SQL means no boot revoke. The web client waits up to six hours after a 404 before trying to mint again, so a device may need a reload or time after enabling; an explicit Sign in clears the wait. The browser stores one origin-scoped record in `localStorage`; the backend stores only a hash of the token secret, checks revocation on each request, and throttles unfamiliar-session lookups before database work. Open voice and Now/Factory streams close on the local replica after revoke and are periodically rechecked on other replicas (about five minutes), without extending idle expiry. The localStorage token remains script-readable as accepted in #1217. The session is owner-only and never accepted for service or deployment routes. For chat, the backend calls the hosted agent through Foundry Invocations with its managed identity; the agent verifies Dan's delegated token and stored source message through `/me` and conversation history. The agent has its own identity for reading model settings and listing/calling tools; coding runners use a separate app-only role restricted to task-event ingestion. Google Calendar and Gmail use backend-only OAuth credentials in Key Vault, scoped to Dan's personal account. No passwords in Jarvis. |
| **Cost** | As low as possible. Slower startup after inactivity is acceptable. |
| **Database wake** | SQL connection acquisition and explicitly read-only queries retry resume errors 40613, 40197, 40501 and connection timeouts with backoff for up to 90 seconds. Signed-in pages show “Waking Jarvis…” only while the backend reports a database wait. An ambiguous write failure is never automatically replayed. |
| **Memory** | Carry forward only clearly stated preferences, project facts, decisions and unfinished tasks. Retrieve relevant memories with their source message; Dan can inspect, correct and forget them. Never remember secrets, credentials, banking or health details unless Dan explicitly says “remember”. Memories live in Azure SQL until deleted; forgetting does not delete conversation records. Compaction and generated views have separate lifetimes. A long chat keeps its context through a bounded rolling summary of older messages, placed ahead of the recent ones: it keeps decisions, commitments and open tasks, never holds secrets or file contents, never rewrites messages, shows nothing new in the UI, and is limited by a daily setting (default 24, 0 turns it off). If it fails, chat falls back to the plain recent window. |
| **Turn context** | Each model turn receives current running-task status and recent events plus a bounded recent-message window, so typical status questions do not need a separate task-list model round. |

### App structure

Jarvis's main page is the conversation with Jarvis plus an overview of what is happening across areas. Each area has its own pages for details. The structure exists from the start so later areas plug in without rework.

```mermaid
flowchart TB
    J["Jarvis (main page)<br/>conversation: chat + voice<br/>'now': activity across areas"]
    J --> SF["Area: Software Factory<br/>task view · task detail · release view · projects"]
    J --> X["Later areas (not in phase 1)"]
    J --- S["Shared: settings · status · usage and cost · activity"]
```

- Each area owns its pages and registers its tools with Jarvis. The backend exposes every registered tool's input schema and executes calls, recording each result so new modules become available without agent changes. Jarvis's reply about an action comes from that recorded result: a refused or failed call is reported as refused or failed, never as done. The Jarvis agent uses only these backend tools.
- In chat and voice, Jarvis can list active projects and filtered tasks, inspect a task, create work, and steer, pause, resume, or cancel it. The backend applies the existing task validation and lifecycle rules to every action.
- Gmail access uses direct mail tools only, never PC, browser or screen fallback after failed or incomplete reads. Raw computer tools verify trusted current process/site observations, including opaque Chrome tab IDs, before exporting controls, window/clipboard data or acting. Optional or truncated title suffixes cannot establish application identity; a Gmail-named source file in an actually observed native editor is not a Gmail browser window. Clear independently requested unrelated computer actions remain available in the same mail turn, including after topic-bearing EN/DA mail requests, but quoted subjects and how-to query text cannot authorise them. Ambiguous query text remains on the direct-mail path. Reads expose body source, truncation and extraction warnings, plus alternate HTML text when it contains different content. Successfully decoded empty bodies retain full-body provenance; any available snippet is a separately labelled preview, not evidence that the body is unavailable. Jarvis checks both bodies for reservation details and describes incomplete extraction without claiming the original email lacks them; booking dates must come from readable source text.
- Calendar changes must return `ok` with `awaiting_confirmation`, an eight-digit code and the actual summary before Jarvis claims preparation or requests approval. Dan's later approval, in his own words, uses the original pending code; if private history omits it, a verified read-only tool recovers the live stage without restaging or requesting repeated approval. Gmail and calendar approvals stay separate even when both have pending changes; generic staging prose or appointment/calendar words inside mail subjects, reply receipts or read topics do not establish calendar context. Explicit calendar workflows, including adding an email-derived appointment, remain available. Mail or notes requests reset calendar follow-up routing; while a proposal is pending, any other follow-up is checked by the server and carries on as normal conversation unless it clearly approves or declines. Expired or absent stages are reported as no pending change, not proof that an event exists or does not exist. Calendar checks require actual reads; completed writes require actual confirmation results. Subject, timezone-aware dates, attendees and returned summary survive the approval flow.
- For multiple requested calendar creations, stage 2–10 events as one immutable proposal displaying every subject, local date/time, zone and attendee list. One later approval covers exactly that list, never an undisclosed extra event or a replacement proposal under an old code. Google writes are sequential, not atomic: show each created, failed, unverified or not-attempted item and stop on failure/cancellation. Never automatically replay created or unverified events. Process-local receipts support short-lived follow-up recovery, not durable survival after a restart. Ordinary explanations, incomplete requests and general conversation must not be replaced by a calendar evidence disclaimer merely for mentioning the calendar.
- Calendar batch approval must match the actual staged source to the latest server-verified request identity in the authenticated scope. Contextual requests such as "Add those two." or "Tilføj de to." may inherit recent calendar routing, but not another request's identity; explicit Notes/mail requests remain separate. Visible assistant prose is not origin proof. Missing or mismatched identity must refuse approval without writing or cancelling an unrelated proposal.
- Google tools use the authenticated backend registry for agenda/free-slot reads, mail search and draft listing, calendar changes, draft updates/deletion, archiving, label changes, reply drafts and sending. The backend uses OAuth credentials held only in Key Vault for Dan's `danaakesen@gmail.com` account, redacts private tool inputs/results from persistence, and requires a one-time confirmation from a later verified Dan message before any write.
- Page requirements list every data point and action, not the look. Dan creates the visual design from them with an image generator (see [DESIGN.md](DESIGN.md)).

### Task lifecycle

```mermaid
stateDiagram-v2
    [*] --> Ready
    Ready --> Running: Start
    Running --> PauseRequested: Pause
    PauseRequested --> Paused: Turn stopped and saved
    PauseRequested --> Running: Pause did not stop the active turn
    PauseRequested --> NeedsAttention: Pause outcome cannot be confirmed
    Paused --> Running: Resume
    Running --> NeedsAttention: Blocked, failed, active sandbox crashed, or disk_low
    NeedsAttention --> Running: Continue or recover
    Running --> Done: Project policy satisfied
    NeedsAttention --> Done: Verified project policy satisfied
    Ready --> Cancelled: Cancel
    Running --> Cancelled: Cancel
    Paused --> Cancelled: Cancel
    NeedsAttention --> Cancelled: Cancel
```

- **Steer** submits a bounded text correction to the current turn, or starts a new session on the task branch when the completed turn's session has expired. **Pause** requests a safe stop and remains `PauseRequested` until the backend confirms the turn has stopped; the heartbeat resolves an unsuccessful pause to `Running` or `NeedsAttention`. **Resume** continues the same Foundry session after a clean pause; **cancel** ends the task and requests deletion of its Foundry session.
- Task controls are offered only for valid task states, with pending and failure feedback beside the action. The backend enforces every transition; a browser cannot set task state directly.
- Needs attention, including an agent question, offers the same confirmed Cancel action. Cancellation stops only the task's current owned invocation, awaits session-end recording and owned-session deletion, and reports cleanup failures rather than success. Unknown runtime ownership blocks cancellation. Crash Recover and expired-session Continue remain separate actions; cancellation never answers the question or starts another turn.
- Chat-created tasks retain their originating message. When a task becomes Done, Needs attention, or Cancelled, or opens a pull request, Jarvis posts one task-ID/outcome update with the PR link when available to that in-app conversation in every mode. Away task-state notifications appear in Now; an active voice session speaks the update.
- If writable disk falls below the configured threshold, the runner reports `disk_low`, stops the current turn, and the backend moves the task to Needs attention with reason `disk_low`.
- If Codex rejects a turn because the Jarvis login's usage limit is reached, the runner reports the failure as `Codex usage limit reached` (reason `codex_usage_limit`) instead of a generic runner error. The task moves to Needs attention, and other tasks keep running.
- **Sandbox heartbeat:** while a task runs, the backend checks its active invocation about once a minute and updates the session heartbeat timestamp. HTTP 424/404/5xx on two polls (or persisting for 30 seconds) signals failure only while the invocation is active; a gap in runner events alone never signals a crash. If that invocation already completed, confirmed session expiry ends the sandbox as `Ended`/`idle_expired` without changing task state. **Continue** starts a fresh sandbox from the existing task branch with the original task, recorded steering messages, and a bounded event summary. **Recover** remains for actual crashes. When a provider turn completes, the backend uses the repository-scoped GitHub App token to open or reuse a pull request only if the task branch is ahead of the project default branch; it records the outcome and leaves the task Running for the signed webhook and project policy. Missing commits or a GitHub refusal moves the task to Needs attention with a reason.
- **Dispatch:** the backend leases Ready tasks only when both global and project concurrency limits allow them. It retries safe start failures up to three attempts (15-second, then 30-second delays); an ambiguous Foundry start or exhausted attempts moves the task to Needs attention. The dispatcher reacts to committed task events and retry deadlines rather than polling SQL while idle.
- **Task workspace:** each start carries the project's repository and default branch plus the persisted task branch `jarvis/task-<id>`. The runner clones through its Git credential helper and uses the remote task branch when present, otherwise creates it from the default branch. Resume and recovery keep the same task branch.
- An agent `end_turn` without a new commit on the task branch moves the task to Needs attention with the agent's last message as its question. A new commit alone does not mark a task Done; PR creation and verified GitHub/project-policy completion are still required.
- The authenticated tasks API creates board tasks only for active projects, lists tasks with project, agent, state, period and search filters, and returns task details with a bounded, pageable event history. API responses are capped at 1 MiB; oversized event payloads are explicitly marked truncated. New tasks always start Ready and record their creation event.
- Task state belongs to the backend. State changes must follow this lifecycle; clients cannot write state directly, and Done requires verified GitHub branch and pull-request evidence rather than the provider's completion report alone.
- Coding agents push small work-in-progress commits to the existing task branch after each meaningful step. They never force-push or push to `main`, and report commit or push failures.
- Git pushes use a one-hour GitHub App installation token scoped to the task's repository. The runner authenticates to the backend for each Git credential request; the App private key remains in Key Vault and is never sent to a sandbox. Keep the legacy GitHub token path available until the App flow passes its live sandbox push check.
- **Checks loop:** when a task pull request's required workflow fails, Jarvis stores bounded failing-job logs in private Blob storage and sends a bounded diagnostic plus the log reference to the same running task through its existing steer path. The agent fixes and pushes again. A configurable attempt limit (default 3, range 0–10; 0 disables automatic repair) moves exhausted or unavailable repairs to Needs attention. No GitHub token enters the sandbox.
- **Done** follows the project policy and verified GitHub results, never the agent's own report.
- Show observed milestones; use percentages only when measurable. Show stale or disconnected status and reconcile after reconnect.
- Changing the provider (Codex ↔ Copilot) on a running task is out of scope for now.

### Project policies

| Policy | Allowed outcome |
| --- | --- |
| **Deliver a pull request** | Implement, test, push a task branch, and open or update a pull request. Stop at a non-draft PR with green checks, or with no configured checks after a two-minute grace period; mark Done without merging. |
| **Complete without deployment** | Also squash-merge with the GitHub App when checks are green or none are configured after a two-minute grace period, the PR is not a draft, its branch is up to date, and GitHub reports it mergeable. Selecting this policy is approval; no additional confirmation or message is requested. Mark Done after the signed merge webhook is persisted. |

- Merge rules and Done behavior are Dan's choices per project.
- The backend applies policy only from task-linked P3-04 GitHub records, current GitHub API state, and backend-verified completion proof for the current sandbox session and invocation. Proof is either a clean final completed snapshot, or final failed status with independently recorded successful work and verified owned-provider stop, where only credential/event/publisher cleanup failed. A runner's early `completed` event, idle expiry, or passing PR checks alone never authorises Done or a policy merge. `NeedsAttention` can become Done only after that verification.
- An explicit failed runner snapshot overrides earlier completion or question events. Failed work or uncertain writer teardown requires attention. Post-stop credential/event/publisher failure remains visible as runner failure even when verified delivery satisfies task policy. Logical session expiry and stopped-writer proof do not prove cloud compute deallocation.
- Recovery invalidates the previous execution's completion proof before starting its replacement. Done and an automatic policy merge require the same current task/session/proof generation and no pending start lease; a failed replacement start never restores old proof.
- Proof must match opaque Foundry session and invocation identifiers exactly, including case, regardless of the database-default collation.
- Durable delivery, project-policy completion and runtime release are separate facts. Persisted runner-owned `work_completed`, `provider_stopped` and `work_commit_sha` facts bind completed work to its verified commit. Both clean and cleanup-failed completion require that exact published task-branch/PR head; the locked policy gate compares the proof commit with its candidate head. A local unpushed commit or an older green PR cannot substitute. Successful-work proof never comes from a generic completed or question-only turn. Legacy unbound snapshots remain readable but cannot authorise new completion. Missing or malformed proof, question snapshots, cancelled/nonterminal status, or process/reader/provider shutdown failure cannot use it. Physical release and fresh live acceptance remain separately verified outcomes.
- A clean completed invocation without delivery proof retains its observed completed lifecycle and leaves the task in verification attention. Missing proof is neither a runner crash nor permission to deliver, mark Done or merge.
- The GitHub merge endpoint enforces repository branch protection and required checks. A refusal is recorded on the task and leaves it unfinished.

### Project creation and defaults

Jarvis creates new repositories from a name and description; the Add project dialog shows the saved defaults that Jarvis applies. Each project keeps its own settings and can change them at any time.

1. Jarvis creates `<owner>/<name>` with the configured visibility and the backend-only `jarvis-repo-admin` token. The token never enters a sandbox.
2. Jarvis registers the project with the configured defaults and starts the first task in a sandbox: clone the templates repository, run its initializer (`cpinit`) with the modules the agent chooses from the description, fill `PRODUCT.md` and `PLAN.md` from the description, add the repository's PR-check and release workflow templates (P3-09), and open a pull request.
3. When the description is not enough to choose modules or fill the documents, the task moves to Needs attention with a question for Dan instead of guessing.
4. A new project starts with the base `node`/`1x2` defaults; this is not a detected stack. Dan can change any project setting afterwards.

### Settings

P9-40 lets Dan ask Jarvis by voice or chat to switch the visible page: Jarvis
home, the Software Factory Kanban board or a specific task/issue, Settings (including
named sections), Usage, Notes, the knowledge graph, Workspaces or Status. “Kanban”, “board”,
“factory” and “tasks” select the Factory board; “go home” and “back to Jarvis”
select home. Navigation is reversible and needs no confirmation. The backend
delivers it to all open signed-in tabs through the existing workspace broker
and reports success only after an applied acknowledgement; refusals and failures
remain visible. The navigation contract and backend are built offline; shell
routing, the usual page transition and live acceptance belong to the UI session.
Factory task navigation opens the task window over the board and focuses its
card; issue-number navigation focuses that issue's card. The UI refuses missing
tasks/issues with a reason. Status is a read-only shell page. Workspaces is a pane; `workspaces` is the canonical navigation key and `folio`
remains accepted for older clients.

P9-43 supplies a short, content-free workspace reference on every voice and chat
turn. “This/that” identifies the focused window or task/issue; “go back” uses the
reported previous page and selectors. Titles are untrusted data, not instructions;
summaries require retrieving the identified content. If no snapshot, focus or
previous destination is available, Jarvis says so and asks rather than guessing.
The UI session owns publishing view metadata on route, section, focus and pane changes.
Focusing a Factory issue card reports its issue number, including task-free
issues; moving focus away, hiding/removing the card or leaving Factory clears
the current issue selector. Commands from a disconnected workspace are never
replayed or acknowledged under its replacement session.

Global defaults on the settings page; a task can override the coding-agent model and reasoning. A changed setting applies to new sessions and tasks, never to running ones. Only models available in the Foundry account or Dan's subscriptions are offered. Light, dark, or system appearance and the optional voice-start window preference are persisted; system appearance follows the OS without replacing or restarting the live Jarvis room. Generated views and window arrangement remain temporary.

Dan can also change Jarvis's model or reasoning by chat or voice for the next session, and change the agent or verified model options on a Ready coding task. Running-task model changes are refused with a reason; they never alter an active turn.

Presence has three modes: Present (`present`, green), Away (`away`, yellow), and On the move (`on_the_move`, blue), in both themes. Away and On the move suppress spoken status updates; the Now feed and browser approvals remain available in all modes. Settings keeps `identity.description` separate from personality preferences: identity establishes the same broad Jarvis role in chat and voice, while tone and response style govern how replies sound. Mode instructions add situational behavior without replacing shared identity; identity and style text cannot grant permissions or capabilities. The Settings API keeps `personality.customInstructions` as the base style instruction and adds one instruction for each mode, each limited to 2,000 characters. Jarvis can change modes from chat or voice without confirmation and announces the change.

| Area | Setting | Default |
| --- | --- | --- |
| Jarvis | Model and reasoning effort | `gpt-6.1-terra` when deployed, otherwise the existing `gpt-5.6-luna`; reasoning `none` (chat and hosted Danish fallback); voice role `gpt-realtime-2.1` (Danish and English Voice Live) |
| Appearance | Light, dark, or system mode; approved theme tokens | Light |
| Identity and role | Shared owner description for chat and voice (up to 2,000 characters) | Broad personal AI assistant |
| Personality | Tone, response style, base custom instructions, and per-mode instructions (each up to 2,000 characters) | Courteous British-butler tone, concise, no custom instructions |
| Voice | Speech to text | MAI Transcribe |
| Voice | Voice per language | English: Ryan HD (British English, may address Dan as "sir"); Danish: Jeppe (`da-DK-JeppeNeural`, native male; live since P5-08) |
| Voice | Default language | Danish |
| Voice | Minimise all windows when starting voice | Off |
| Global | Screen inspections per day | 300 (configurable from 1 to 300) |
| Codex | Model and reasoning effort | Codex default |
| Copilot | Model | Copilot default |
| Global | Max parallel tasks; sleep switch | Set by Dan |
| Backend global setting | Maximum automatic check-fix attempts (`global.max_check_attempts`) | 3 (0–10; 0 disables automatic repair) |
| New projects | Owner, visibility, templates repository, default agent, policy, max parallel tasks, default branch | `DanAakesen`, private, `DanAakesen/templates`, Copilot, Deliver a PR, 1, `main` |

GPT-6.1 Terra main-chat preparation (#1337) preserves saved model choices. Changing
the code default does not replace Dan's saved `roles.chat.model` or legacy
`jarvis.model`; rollout must inspect that effective setting and update only chat
through Settings after deployment. Active session choices remain intact. Danish
`/voice/da` uses the realtime voice role when `options.connect` is configured;
only the `connectDanish` hosted-agent fallback inherits chat settings. Separate
voice, vision, research, coding and image-generation defaults are unchanged.
The template requests capacity 150 through the normal authenticated deployment
path; actual allocation and live acceptance remain unverified. Dan accepts the
existing budget alerts with USD 20/month authorized for Terra; no new spending
guard or other role change is part of this work.

English voice sessions use Ryan HD and the British butler persona. The backend owns the realtime session and executes registered tools; the browser never executes tool calls or supplies their results. Jarvis relays the backend-built confirmation for successful, refused, and failed actions.

Browser voice uses the same canonical backend tool registry and execution policy
for Danish and English. Voice Live first advertises every configured tool with
its validated schema. If that bounded startup attempt fails, a second attempt
advertises only paged capability discovery and execution functions; discovery
reads the same registry, and dispatch still enters the existing validator,
authorization and approval path. This representation does not remove Daily or
proactive capabilities. The model must discover a capability before using it;
an undiscovered or unregistered call is rejected. Large discovery responses
fail explicitly rather than silently truncating the catalogue.

Each Voice Live startup attempt uses a fresh socket and a six-second
`session.updated` deadline. The process remembers the last acknowledged
representation for reconnects. If both attempts fail, the relay closes with
code 4010 and the browser uses its existing retry backoff. The hosted Danish
voice-agent fallback retains its provider-owned setup and `session.created`
readiness path. No background tool-budget probes run. Provider acceptance and
real browser audio still require an owner attempt after deployment.

During an English voice session, Jarvis announces task completion, tasks needing attention, ready pull requests, and failed deployments. The backend merges bursts and waits until Dan is no longer speaking or Jarvis has finished its current response. Announcements use fixed, short wording rather than task titles, messages, or logs. `get_status_summary` answers status questions with aggregate counts from the Now feed.

Danish voice uses the authenticated backend `/voice/da` WebSocket to the
backend-owned Voice Live realtime session, with Jeppe (`da-DK-JeppeNeural`).
Settings shows Jeppe as read-only: the stored preference does not select the
live voice. A retired Harper preference remains loadable and resolves to
Jeppe without changing storage. The provisioned hosted-agent bridge remains
a fallback when Voice Live is not configured.

Screen sharing uses the browser's explicit screen/window picker. Sharing status and Stop sharing remain visible; Jarvis captures a frame only when Dan asks by button or voice phrase. The authenticated backend validates the active session, JPEG type and size, a three-second minimum interval, and the configurable daily cap before using the existing Foundry project and backend managed identity.

Camera access starts after Dan selects **Enable video** in More and grants browser permission. It opens a **Camera preview** workspace window, not a camera row in the composer or voice bar. The window shows the local muted live video at its actual aspect ratio, fitted to available workspace space without a surrounding frame, plus overlaid Switch/Close controls without visible Live or direction badges; Switch appears only on mobile touch input, not a narrow desktop window. Switch retains an accessible directional name when the browser reports facing direction. Observation notices and playback recovery stay over the video with retry reachable without scrolling the camera controls away. The larger phone preview stays visible beside the foreground window. Minimise docks it as a tab while capture remains on; restoring does not request another stream. Close stops capture and removes the preview. Jarvis receives its stable name, ID and state in workspace snapshots and can show, restore, focus, minimise or close it. Reopening an off camera by command requires already-granted permission and never opens a permission prompt. **Attach file or photo** is first in the typing More menu and uses the existing upload flow. Pending photos appear as compact preview pills above the text input inside the composer; sent photos show their image preview in the message.
With a screen share active and the camera off, generic visual questions in text chat such as **What do you see?** inspect the shared screen and send its context with the message. Camera-specific questions still require the camera; camera-conversation mode keeps its existing priority while the camera is on.

Dan's 11 October decision superseded explicit-request camera capture: while the camera is on, every chat and voice user turn captures a fresh bounded frame with that turn's question, even while docked. Camera off sends no frames. Issue #1317 supersedes the old turn-only behavior: enabling video also starts automatic sampled-frame delivery. There is no Look now button and there is no separate camera-watch mode. Respect the shared three-second interval and daily cap; when a limit prevents freshness, label any reused observation with its capture time/age and original question, show the limit visibly and never treat an old observation as a new answer. This is the implemented local path, not an accepted final camera experience.

On 12 October Dan rejected the slow snapshot-per-turn experience and requires
a natural conversation about what is on camera, alongside faster general chat.
Camera UI changes are deferred until that experience is proved. His two live
camera chat turns reported caption-only input with `budget_unavailable`; the
finger answer was incorrect according to Dan. Browser request-to-completion
timings were approximately 20 and 23.5 seconds, including sequential frame
inspection. This is failed live acceptance, not proof of direct image input.
The replacement visual conversation flow and cadence remain under investigation;
continuous background uploads are not enabled or approved by this requirement.

Dan's 12 October wording requirement: fresh camera answers should sound like
conversation, not a capture report. Omit unsolicited capture timestamps and
"captured image, not a live view" boilerplate; answer the observation directly.
Keep provenance internally. Stale/reused observations still need an ordinary
age warning, and unavailable input must be explicit. Answer timing/input-path
questions honestly when asked; do not claim continuous video access.

The coordinator identified the failed budget check: the image resolver refused
`gpt-6.1-sol` because the model had no pricing-table entry. #707 merged on
12 October to admit unpriced models with the existing conservative, unverified
0.1 DKK reservation. The coordinator confirms #707 deployed on 12 October;
real image acceptance still needs proof.
This admission fix does not remove the existing caption request before chat.
General chat first-token times were 12.2-17.6 seconds in coordinator logs;
#708 investigates hosted-session reuse and exposes timing breakdowns without
changing Dan's selected model or reasoning effort.
Separately, the coordinator reports changing the live chat reasoning effort
from medium to low on 12 October; it is reversible in Settings. This is not a
change to the product default or proof of lower latency.

Dan also requires the chat and voice answering models to receive the actual
camera image, not only a vision caption. Deployed #704 returns an opaque,
owner/session/turn-bound `frameId` for an in-memory frame with at most sixty
seconds' lifetime and single-use consumption. The queued chat
turn must capture immediately before sending; voice supplies the reference
with that transcription item's visual result before its held reply is
released. Image delivery versus caption fallback must be distinguishable
through `visualPath: 'image' | 'caption'`; an expired or reused reference must
never be presented as current image access. Local callers forward fresh
optional references using the final deployed contract. Chat/Danish-text image
input is implemented, but live answering-model image acceptance is unverified.
#713's deployed upload-only `mode: 'handle'` additionally removes the separate
caption call before the answering turn; failed image delivery captions that
same stored frame, and failed fallback reports unavailable. Omitted mode
preserves the current caption-first caller. The UI opt-in remains held until
Dan accepts the camera UI release; deployment alone neither authorises
activation nor proves actual image delivery.
Deployed #706 (P9-83, closing #705) adds budget-admitted original images to
English and Danish realtime voice before the single item-correlated reply.
Acknowledged delivery or caption fallback is reported per turn; hosted Danish
fallback remains caption-only. Actual `gpt-6.1-sol` and `gpt-realtime-2.1`
image acceptance remains unverified: Dan's 12 October live chat turns reported
caption fallback because the image budget could not be checked. Voice image
acceptance has not been exercised. Content-free `visual.path { path, reason, channel, latencyMs }`
diagnostics support subsequent live verification. #703 remains open until
that evidence exists. No UI release is authorised.

The local UI consumes #704's deployed input evidence without inferring image
delivery from a frame reference or the preview's Live label. A backend-reported
image/caption result appears on the matching chat user message, including
history reload, and as a current-item voice notice. Legacy turns without
evidence stay unlabelled; malformed evidence reports that input could not be
confirmed. Stale, duplicate, uncorrelated and pre-switch/reconnect voice results
must not claim current image access. Caption fallback is explicit, with known
limit/reference/model reasons in ordinary text. Neither synthetic image-status
fixtures nor successful caption conversations fulfil actual-image acceptance.
Unverified model image support must not be described as disabled image input;
legacy-agent input being disabled is a separate reason.
If evidence metadata makes a history refresh fail, Retry must reload that
latest page, retaining already displayed messages. An older-page failure
instead retries its original cursor; having messages does not decide the
retry destination.

The local camera cache is scoped to its current stream and conversation;
stop/switch clears observations, but does not forget known rate/daily limits.
Only typed limit refusals may reuse a prior caption, never its single-use image
reference. Without a previous observation, report unavailable rather than
inventing one. Other failures remain explicit. Limits are visible in Camera
preview and a toast even when it is docked. Voice results require the provider's
transcription item ID; obsolete/repeated items and results after the ten-second
inspection deadline must not create another reply. Backend hold/late-result
behaviour is deployed but has offline-only voice-ordering acceptance.

Caption reuse is limited to `frame_rate_limited` and `daily_limit`.
A capture-time `budget_exhausted` refusal remains an explicit typed failure;
it must not replay a caption or image handle as a successful capture.
Voice budget-denial and unavailable-budget notices apply only to the current
camera item, without echoing a relay event or creating another reply.

Camera-on voice owns the per-turn visual slot. Look at screen is disabled with
an explanation until the camera is off; it must not cancel the camera turn or
send an uncorrelated unavailable event that closes the relay. Activating the
camera cancels any in-flight legacy screen inspection. Independent watch
mode and Stop sharing screen remain available.

Camera access stops when Dan closes or turns off video, when voice or the signed-in app session ends, when its owner unmounts, when permission is lost, on fatal capture/delivery failure, or when the spending budget is exhausted. Dan approved removing the ten-minute no-message cutoff on 26 October 2026 at 14:21:24 UTC: active video and requested narration continue during silence. Browser/device restrictions still apply; background iPhone capture is not promised. Raw frames remain in memory only and never enter transcripts, logs or task events. Capture/connection failures and local-preview playback failures remain visible with recovery. Jarvis can start or stop the same video through acknowledged workspace commands when Dan asks; startup requires existing browser permission, otherwise instruct Dan to enable it himself.

Issue #1317 unifies Enable video and camera watching. Permission-granted camera capture automatically sends fresh JPEG samples, including during silence or an unchanged scene, at a 2.6-second delay after each completed request. Typing mode creates a session when needed. There is no separate Watch the camera or Look at camera action. Camera delivery is confirmed only after backend acceptance; local preview alone is not confirmation. Jarvis stays quiet by default; a typed or spoken keep-describing request sets a standing continuous-description instruction, producing brief current observations without another user prompt. Stop describing clears that instruction; camera off, unmount, session transition, capture failure and exhausted budget cancel delivery. Busy voice narration is dropped rather than queued. Screen sharing/watching keeps its independent controls and unchanged-frame suppression. The shared vision budget and image authorization remain. There is no user-inactivity cutoff for active video; user-requested start/stop uses the same permission-checked workspace camera controls. Raw frames remain memory-only and there is no raw video streaming or recording.

### Status

Dan can open `/status` from the rail, phone menu or voice/chat navigation.
It reads the authenticated `GET /status` snapshot and shows each reported
subsystem result, failure/unavailable reason, check time and safe details.
PC connection and pause state are visible without expanding details; missing
versions are not invented. Foundry configuration checks do not prove a live
model turn, and the last backend error is historical, not current health.

Refresh reads only `/status`; it never runs `/status/smoke` or model canaries.
Checks and retained smoke evidence older than five minutes are marked stale.
A failed refresh explicitly retains the previous snapshot with Retry.
The recorded smoke report includes its time but has no deployment/commit
association, so it cannot certify the latest release. No retained report means
unavailable, including after backend restart.

### Web notifications and confirmations (P6-22)

Text and voice share the pending-action lifecycle: an exact proposal, a verified
later owner decision bound to that action, expiry/cancellation and one-time
execution. Tools retain their own permission checks. An acknowledgment that a
request was received is not approval; identifying a project selects the target,
not permission for an action on it. Browser-only proposals keep their
authenticated browser approval boundary.

Jarvis writes bounded text notifications to the Now activity feed. Gated actions appear as browser approval requests with Approve and Reject controls and normally expire after five minutes. Internal food-review cards explicitly expire after two minutes to keep the whole operation inside the hosting request limit; the visible expiry matches persistence and cancellation. Unknown, replayed, rejected, cancelled, expired, or unverified responses never run the action. A pending approval is announced to an active browser voice session; the authenticated Now feed remains available. Only a current pending food estimate also accepts the owner's next natural reply in the same text/browser-voice session, without a separate button.

P13-02 adds an optional web push opt-in, on in production since P13-03, for a
visible alert that links to a durable owner-protected item. P13-21 includes
bounded todo/finding titles and due times only in the encrypted payload, never
telemetry. Notifications never approve an action. Opening an
item requires the usual authenticated session; after sign-in, Jarvis returns to
that same-origin item path. Provider acceptance is not proof that a phone
displayed the notification.

Manual gated actions—including a merge initiated through GitHub tools, deletion, sending mail, calendar changes, repository creation, destructive or externally consequential computer use outside the browser, and anything that spends money—always require Dan's confirmation. The automatic project-policy merge under **Complete without deployment** is distinct: selecting that policy is approval, and its automatic merge asks for no additional confirmation or message. Other gated actions fail closed if Jarvis approval is unavailable or expires. Provider credentials remain server-side; notification content, audio, tokens, and images are not written to logs, task events, or errors.

The owner-editable **Identitet og rolle** setting is validated and persisted separately from Personality. Its versioned identity contract is shared by hosted chat, Danish and English realtime voice, hosted voice and reduced English voice. Composition order is the fixed truthfulness/security kernel, shared Jarvis identity, owner description, tone/response style, current mode, then situational/project context. Legacy personality and mode preferences remain unchanged; absent identity uses the broad personal-assistant default. A save refreshes an active voice session after the provider acknowledges the update; if refresh fails or times out, the relay closes so the client can reconnect. Chat refreshes its settings during the active conversation flow. “Saved” confirms persistence, not that an external provider or device accepted a live update.

Personality preferences affect response style only, not Jarvis's identity, available tools, permissions, selected language, model or voice, or truthful reporting of action outcomes. Reset restores the current courteous British-butler tone, concise response style and empty custom instructions; it does not alter the separate identity description. Active voice updates apply only after acknowledgement; an unavailable in-place update requires reconnect.

### Page requirements

Data points and actions per page. The look is decided in [DESIGN.md](DESIGN.md).

#### Jarvis main page

| Data points | Actions |
| --- | --- |
| Conversation opens at the latest messages with typing focus: a calm greeting when empty; visually distinct Dan/Jarvis messages across chat and voice sessions; channel, language and relative time on hover/focus (always visible on touch or reduced motion); thinking feedback until the first delta, then open-surface streaming text with a live caret; tool-call chips (tool, outcome, link to task), and voice minutes per sitting; retained failed-turn and interrupted-reply feedback; history refresh retains messages without duplicates; removable queued Dan bubbles and an accessible queue count | Type from the floating bottom-centred, auto-growing composer; while idle Send/Enter starts a turn and while Jarvis replies Send/Enter steers it, preserving any interrupted partial reply; Ctrl+Enter adds to the removable FIFO queue; send queued messages in order after success or error; keep Send, the More → Language menu and voice entry available during replies; capture language per message so changes apply to the next message; Shift+Enter adds a line; voice starts immediately while the chat reply continues into history; preserve unsaved and next drafts on failure |
| Voice state: connecting, waiting for microphone, listening, thinking, tool work, speaking, muted and reconnecting; accessible status beneath the orb. History and composer hide during voice; exit restores the draft and typing focus | Start voice requests microphone permission and prepares audio; capture begins after permission and authenticated session readiness. End voice; interrupt by speaking; mute/unmute or exceptional microphone retry in More |
| Header attention (P9-120): undismissed task-attention, credential-warning and alert items, plus every pending browser confirmation; background-work history stays reachable for every non-dismissed job, including interrupted jobs | Open a linked task, release or project; dismiss an item or finished job; approve or reject a browser confirmation |

For tool-backed turns, Jarvis gives one brief, truthful first-person sentence in the
conversation language before tool work. Chat shows it as a distinct interim segment.
Hosted voice emits a separate initial text item before resuming the model stream;
its transport does not acknowledge that a user heard it. Browser realtime voice
waits for browser playback completion only when the initial turn response contains
audio and tool calls; tool-only responses and later silent tool rounds need no
playback receipt. A browser receipt is not proof of physical-speaker output. The
final answer contains only the useful result, and a failed or partial turn retains
an honest terminal outcome. Direct answers and greetings remain single, immediate
replies without a preamble.

#### Proactive page (P13-10; default off)

The `/proactive` page has one headline and separate Status, Open items, Sources,
Budget and collapsible Recent checks sections. It shows Copenhagen-local check
times, fixed-copy errors, a manually triggerable check, accessible budget state,
source coverage and recent outcomes. Open findings are plain text with urgency,
evidence labels, arrival time and state markers; users can open, dismiss, snooze
or rate them. Earlier items are read-only. The item detail remains the push tap
target and links back to open items.

Settings exposes one immediate switch for automatic proactive suggestions and a
compact ordinary-language view of the preferences Jarvis actually enforces.
Dan can edit supported preferences in his own words and see a few contextual
examples backed by the same capability source used in chat and voice. The view
refreshes an open page without silently replacing an unsaved edit; stale changes
are reported and can be explicitly reloaded. The existing budget, quiet hours,
cadence, source policy, feed configuration, guidance, category settings and other
advanced values remain stored and unchanged when a preference is edited or the
simple view is used. Disabling automatic suggestions does not change separately
requested reminders or ordinary owner requests. Per-item “Wrong” and “Useful”
feedback remains item-specific and does not become a lasting preference.
Changed fields only are sent. Feed URLs and guidance remain in component state
and are never written to browser storage, URLs, titles, analytics or logs.
`VITE_PROACTIVE_ENABLED` is exact-string `true`, defaults off in code, and grants no
backend access; when off, routes, navigation, settings and requests remain absent.
Production sets it since P13-14 (18 October 2026).
The header links terminal proactive Background work entries to the page only
when the web gate is on.

The persistent shell consumes the existing authenticated Now feed without a second stream or request. Its header shows a yellow, counted attention control only while non-dismissed attention, credential or alert items, or pending browser confirmations exist. Its popover retains linked activity, timestamps, dismissal and confirmation actions. Running tasks remain in the background-work counts; releases, deployments and away-mode changes do not count as attention. The background-work control is hidden only when there are no non-dismissed jobs and no attention items; it remains visible while its popover is open, and interrupted history uses a labelled neutral mark. Neither the Now nor Backend section is part of Settings. The backend `/operations/sleep` API is unchanged.
Deployment failures represent deploy workflows or real release deployments, not
board/plan maintenance. Cancelled runs are not failures. Repeated failures for
the same project workflow collapse into one activity item within a rolling hour;
dismissed items still suppress repeats during that hour.

Presence, running tasks, releases/deployments and away-mode changes remain in the feed for their existing consumers but are not shown in the attention popover. Each alert condition is stored once and can be dismissed per item. Failed deployments, confirmed sandbox crashes and expiring credentials remain email-only alerts; the monthly Azure budget uses its existing bounded spend read and email action group, with one 80% activity warning per recurring UTC calendar month. Dismissing a warning does not allow another warning for that month. Authenticated server-sent events continue refreshing the snapshot; the shell feed remains mounted while Settings is closed.

The Jarvis typing/voice page keeps a subdued transparent cyan exterior and visible open amber core; explicit voice entry brightens the same orb in place, and exit returns it to dormancy. Real transient runtime activity and decoded playback audio drive its awake response. Dormancy is only a presentation state: it does not indicate backend sleep, enable the microphone, or change voice readiness. The stable living 3D room, centred stage and real mirror floor carry across modes; light appearance re-lights the same room. Voice mode hides shell/history/composer immediately without taking a document-wide snapshot. In the 3D stage, workspace visibility moves/scales only the orb through its existing spring, leaving room, camera and platform fixed; the responsive temporary-window layout remains unchanged. The room and large orb do not appear on Factory, Settings or other routes. Shared smoky glass surfaces are the selected treatment across existing pages. If WebGL is unavailable or lost, show a readable lower-cost stage while preserving HTML chat, voice and workspace controls; restore the same renderer when the browser restores its context, and keep rendering errors separate from voice status. P8-28 (#375), P8-31 (#376), and P8-32 (#387) are merged; P8-29's runtime/audio wiring is implemented offline in draft PR #377, and P8-30's local fixture implementation is in PR #386. P8-33's adaptive rendering/recovery implementation is in draft PR #391; its software-WebGL measurements and remaining hardware limits are in [the accepted UI evidence](ui.md#accepted-centred-3d-stage--5-october-2026). The reported flicker is attributed to the full-document View Transition snapshot, which included the live WebGL stage/mirror and delayed the committed layout; normal-hardware flicker acceptance remains unverified because the available SwiftShader browser rendered at very low frame cadence. The previous shell, windows/tabs, phone single-view/dock, theme persistence and explicit microphone/readiness rules remain. The approved prototype remains reference-only. See [accepted UI requirements](ui.md#accepted-centred-3d-stage--5-october-2026).

The orb follows typed, transient runtime activity delivered over the authenticated event stream and decoded response-playback PCM; the HTML voice status retains its text label and detail beneath the orb. Listening requires a ready relay and live, unmuted microphone following explicit Start voice. Speaking and its energy follow audio actually playing; microphone input only modulates listening. Transport and microphone recovery take precedence over runtime activity. Unknown states are unavailable, and reduced motion uses steady state forms.

English and Danish voice keep Voice Live as the final-transcript source. While the microphone is active and unmuted, a parallel Azure Speech stream can provide interim clauses to the existing safe reflex path; mute, voice end, or disconnect stops that recognizer. If Speech is unavailable, voice continues with final-transcript reflexes.

P7-27 lets Jev control currently open Jarvis workspace windows by title in chat and voice, including stable partial speech: show, focus, minimise, restore, close, enlarge, tile/layer and open/close the context panel. These reversible UI actions need no confirmation; creating new generated views stays with the main agent. The agent receives the reflex outcome and must not repeat it. Each classification logs bounded decision metadata and latency without transcript text. Live acceptance: “tile my windows” changes the layout within 1.5 seconds of chat send.

The shared top bar reports actual chat and voice runtime activity, including tool calls; it does not infer work from a local submit. Activity events contain no transcript, tool arguments or results, or secrets, and are not persisted. The orb's audio response uses decoded playback samples, not microphone input or an estimated level. Jarvis-updated workspace windows receive a brief tool-call shimmer; unrelated windows and thinking states do not.

Temporary client windows support title dragging, edge resizing and icon lifecycle
actions. Keyboard arrangement lives under Arrange: focus Move or Resize and use
arrow keys (Shift for larger layered steps); Escape closes the menu and returns
focus. Each window's accessible overflow control opens its keyboard Arrange
actions; the workspace header retains its shared tile/layer control. Escape
closes the disclosure and returns focus. The shell shows Jarvis once on the home
route and adds the area and matching page on deeper routes. All presentation
motion preserves readable states under reduced motion. Jarvis workspace
commands use the authenticated Now event stream, are scoped to the active
signed-in workspace session, and are acknowledged only after the client applies
or refuses them. Generated views and window state stay in memory; closing or
changing a view does not change conversation or source data. A local-fixture
footer belongs only to screenshot fixtures and is absent from the production UI.

Generated HTML reports and their host share one solid appearance-aware background,
without a second outer frame. Internal report sections and controls remain intact,
and theme changes preserve report state. Window controls stay on one row beside
long titles. Open-window tabs use a consistent window icon, one pin toggle where
pinning is available, and Close for unpinned windows. Crowded tabs remain
scrollable; phone window-list actions remain reachable above content windows.
Persistent-pin semantics are still part of the unfinished P8-42 implementation.

#### Vault tasks on the Notes page (P13-19; 18 October 2026; one page since 19 October 2026)

Notes and personal to-dos share one page; there is no Tasks page. A **Show tasks**
button at the top left of the map, beside the search bar rather than inside it,
opens a task panel beside the map (**Hide tasks**, Escape or Back closes it), and
the old `/tasks` address redirects to `/notes?tasks=1`, keeping a `q` search. The
address holds the panel's state, so a link to a task search opens it. The panel
reads native Obsidian checkbox items from the
shared proactive scope: `Personal/` and `Work/` notes plus the root `task.md` or
`tasks.md` dashboard. It groups open tasks by Overdue, Today, Upcoming and No date;
completed tasks are hidden but searchable. Search filters task text, and each task
opens its source note in place. The owner can complete or reopen a task from its tick
button (with a four-second Undo) and add one with **+**: Personal or Work, optionally
with an optional due date and time, saved to that side's `Inbox.md` note. Each change is a commit
to the owner's vault, made only for the owner, refused if the line (its text, date, priority or position) has changed since the
list was read, and shown as an error with the tick rolled back when it fails. In the All view each row says Personal or Work in words, not only by colour. A pencil at the top
right of each open task edits it in place in a multi-line field with its date, time and priority (Enter saves, Escape cancels); the tick state stays as written. Jarvis
never reorders or deletes these tasks and never edits one except on the owner's own request.
Chat and voice share the panel's task write service through `vault_task_create`,
`vault_task_complete` (including reopen), and `vault_task_edit`. Ambiguous matches
or scope require clarification; existing tasks require the exact path, line, text
and version returned by the read-only `vault_search`. Explicit tasks go to the
requested Personal or Work Inbox, not Factory or the proactive task generator.
An open panel quietly reloads after a successful conversational task write.
Agent work remains on the Software Factory
board.

A **notes tree** icon button beside **Show tasks** opens a tree of the vault's
folders and Markdown notes, including notes at the vault root; hidden dot-folders
stay out. It sits in the same place as the task panel, so one panel is open at a
time. Folders load lazily through `GET /notes/tree` and
`GET /notes?directory=` a page at a time, and selecting a note opens it in the
existing note popup with its safe preview, Edit and explicit Save. Notes at the root
and outside People, Work, Personal and General are listed because the backend index
covers every indexed note (#1113, P14-40).

Notes search shows the matching plain-text snippet under each note title and, when
open tasks match, a Tasks result group whose count opens the panel with that
search. In chat and voice, task/to-do/reminder requests use the read-only tasks
kind of `vault_search`; note searches use its default notes kind and `vault_read`.
All reads are owner-only and treat vault content as untrusted data.
Full-note replacement through `vault_write` requires `expectedSha` from
`vault_read`; stale or missing versions require rereading and reapplying.
Creation remains create-only without a version, and append can rebase once after
a confirmed conflict. Uncertain write outcomes require rereading before another
attempt, never a blind replay.

The knowledge map opens centred on the notes and fitted to the window, and its idle
motion is clearly alive (drifting notes, breathing stars, pulses along links). The
Notes search bar is compact and shows no note total, only a match count while
searching. Screens carry as little copy as the task allows: no sentence repeats a
heading, label or visible state, and none reassures about what is not stored or not
done unless it is consent, a destructive-action warning or recovery guidance.
Freshness, stale, partial, failed-refresh and estimated states keep a short
visible marker.

#### Native iOS Notes area (P15-12; 30 October 2026)

The approved iPhone version presents the shared vault in four tabs: Notes, Tasks,
List and Graph. Notes group Markdown files by folder; Tasks group open
Personal/Work tasks by Overdue, Today, Upcoming and No date; List lazily browses
the vault tree; Graph pans and zooms the knowledge graph and offers a list
alternative. A persistent bottom search supports All, Notes and Tasks scopes.
Creating and editing notes use the shared vault routes; editing saves only with
the version returned by the note read. Tasks can be completed, and new tasks
include title, scope and optional date/time. All interface and accessibility copy
is localized in Danish and English from the app-owned Settings preference,
defaulting to Danish; it is independent of voice language and device locale.

This iOS navigation is an approved native presentation of the existing web
capabilities, not a new backend surface. Notes are path-sorted rather than
recent-first. A folder appears only when a note is created beneath it; there is
no standalone folder action. Note delete/rename/move, task delete, task priority
on creation and offline caching are not available. The app has no native
Microsoft sign-in provider yet; an existing stored owner session can be used,
but a new or expired session cannot be established from this screen.

Notes with open in-scope tasks use the Tasks map colour and a slightly larger mark.
The map legend shows how many notes are marked and toggles that colour without
hiding notes; hovering a marked note shows its open-task count. Counts come from the
same bounded checkbox parser as the read-only task panel. A partial count is labelled
partial; the graph carries counts and completeness only, never task text.

#### Software Factory — task view

| Data points | Actions |
| --- | --- |
| GitHub Project columns: Backlog, Needs Dan, Ready, In progress, In review, Done | Create a linked GitHub issue and task (project, agent, text, optional model/reasoning override) |
| Issue title/link, task code, worker, blockers and linked PR/checks; supplied task agent/state/activity, start time, attempts and branch | Open issue/PR; task details/window and state-valid controls when a task is linked |
| Active project; local agent, task-state, issue-update-period and text filters | Filter; search title, issue number, task code, labels or branch |
| Compact release context for the selected project: repository/default branch, latest build/deployment status, short commit timeline | Open the full project release view |

The board reads the canonical `GET /factory/board?project=<id>` snapshot for one active project, initially the first returned project. Placement comes from the backend, never from task state. It includes open issues and issues closed in the last 14 days. Filtering precedes the explicit 100-card display cap per column; counts include all matches and the cap explains how to find hidden matches. Paused, Needs attention and Cancelled remain task facts, not columns. Cards without tasks have no invented task actions or timings; full history and usage stay in task details. Snapshot time, repository and connection text do not appear while the board works. Cached GitHub data, live connection failures and retained data after a failed refresh show as one small red “Board not connected” notice beside the refresh icon, with the cause and the snapshot time in its tooltip and screen-reader text (Dan, 19 October). While a board is retained, a failed refresh shows only that notice and the refresh icon is the retry path; the full error with “Retry board” appears only when no board is loaded. Refresh and retry preserve the current board and scroll; changing project hides the old snapshot and cancels obsolete reads. Committed board events and stream reconnection refresh placement.

An unclaimed `needs-decision` issue stays in Needs Dan when its linked PR is
still a parked draft. The draft and any supplied task state/activity remain
visible as facts, not an implicit worker claim. An actual worker label still
means In progress, and a review-ready linked PR still means In review.

The local 16 October correction (not released) shares one server-owned board
load per project. An update invalidates
only its project and can require one immediate complete follow-up. If that
follow-up is invalidated too, the snapshot is explicitly stale and remains
expired until another read; continuous events cannot extend one operation into
an unbounded refresh loop. Failed refreshes retain a validated snapshot and
visible stale/failure feedback, never an invented empty board. Cancelling one
client's wait must not cancel another client's shared source work.

Jarvis can navigate to an issue by a positive whole `issueNumber` on the selected project's Factory board. An exact `#number` search clears other local filters and expands the issue's column, so the display cap cannot hide the requested card. A real linked task opens its existing window; a task-free issue stays on the board with its title link focused. Unknown, unavailable, cancelled or still-loading targets return a reason rather than acknowledging a route change as success. Navigation waits at most six seconds and stays within the command expiry; ordinary board loading may continue without a late focus or window action. Notes' unsaved-draft guard and task-ID navigation remain intact.

An older snapshot cannot definitively exclude an issue or its requested task
link while the selected scope has a pending read or known automatic follow-up,
including the idle debounce. Navigation waits within its existing budget,
without starting a speculative read; a failed follow-up returns the visible
read error rather than a definitive task-link miss.

GitHub issues are the single backlog and source of truth; the Software Factory and Copilot execute them, with Codex as the default for Jarvis-raised work. Dan can start an existing issue with the `Jarvis` label, the `start_issue` tool, or the authenticated Factory API. Duplicate starts reuse the active task, and task progress links back to the issue without copying code or issue content into comments.

Jarvis exposes the operations its installed GitHub App actually permits. It reads and caches the installation permission map at runtime, reports missing grants by name, and scopes each API token to the permission required by that operation. Read tools cover issue contents/comments/search, pull requests and comments, workflow runs/jobs, branches, commits, comparisons, labels and milestones. Write tools update issues and pull requests, comment/review/merge, mark PRs ready, create branches, dispatch/rerun workflows, write branch files and create labels. These tools accept any repository where the App is installed and default to Jarvis's own repository. Ordinary writes execute when Dan asks; closing issues, merging PRs, writing the default branch and public-repository publication require a later simple approval word, never a generated phrase.

P8-34 (#369) implements the approved board/release-bar/right-details composition. Selecting a task opens its existing task detail data in the contextual right pane while retaining filters and board position; Open full task keeps the complete timeline available. The release bar uses the existing authenticated project release source, never mixes data between projects, and shows honest loading/empty/unavailable/stale states. The Factory Ask Jarvis composer hands messages to the existing conversation queue and focuses the explicit voice-start control without activating the microphone. These paths reuse existing contracts; fixture browser checks do not establish live Entra, backend, release, provider-usage, or voice behavior.

**Kanban (6 October 2026, Dan; GitHub alignment 13 October):** `/factory/kanban` is the only Software Factory page. It shows GitHub issues with their supplied Factory task overlays, live updates, task actions and details pane, with:
- matching-issue counts for In progress, Needs Dan and Done;
- project-scoped loading and instant local filters (debounced search);
- compact cards ending in View details and Open task;
- a commit-trail release bar with project, branch, pipeline states and up to five linked recent commits;
- a slim board strip above the board with a refresh icon and the Create task and Create project dialogs. Create task first creates one GitHub issue in the selected project's repository (task title and request body), then queues one task linked by issue number, preserving the selected agent, model and reasoning overrides. The confirmation links to that issue.

Create project adds an existing GitHub App repository through the existing manage action. Requests for a new repository go to Jarvis in the conversation. Project management (managed projects, existing repositories, project settings links) lives in Settings → Projects. A task opens as a window over the current page (from Kanban, chat, releases, usage or its address); minimised windows become tabs under the top bar, and open task windows return as tabs after a reload. Off the home page the chat waits as an orb in the rail and pops out over any page. The former Tasks and Projects list addresses redirect to Kanban and Settings. Kanban uses the existing backend board contract; the browser neither copies GitHub status rules nor writes Project status.

GitHub issues remain the board's only backlog; no GitHub Project read or write is involved. A new dialog issue appears in Ready with its task overlay before a PR exists, and delivery includes `Fixes #N`. Submission IDs prevent double clicks and retries from creating another issue or task, including after a backend restart. Issue-create failures create no task; partial failures identify the created issue for recovery. An uncertain write is not automatically repeated. Existing tasks and the manual issue-backfill route are unchanged.

#### Software Factory — task detail

| Data points | Actions |
| --- | --- |
| Header: title, request, project, agent, model, state, branch, PR, checks, timestamps, the message in the conversation that created it | Steer, pause, resume, cancel, continue after idle expiry, recover after crash; open PR or branch on GitHub |
| Timeline: every runner event, steering messages, check results, state changes | Filter event types; expand payloads; open artifacts (logs, CI logs) |
| Sandbox sessions: start, end, size, end reason, heartbeat state, timestamped writable-disk total/free readings and low-disk threshold | — |
| Usage: sandbox minutes and DKK; Codex/Copilot turns and any reported usage | — |

Sandbox cost is an estimate from recorded session time and size. Coding-agent tokens and premium requests appear only when the runner receives an explicit provider usage report; missing values are not inferred.

The backend persists each task event and state change to the task history and activity feed together, then publishes the committed event for live clients. The authenticated live feed resumes from the last delivered event after reconnect so updates missed while disconnected are replayed without duplicate timeline entries.

The task timeline remains complete as older events move from SQL to private Blob Storage. The detail API restores those events on demand within its existing paginated response.

The detail page initially loads a bounded event page and offers further pages on demand. It combines those records with authenticated live updates without duplicate timeline entries; event-type filtering starts with every event visible, and payloads can be expanded. Task controls are state-aware and call the authenticated backend control route. Pull-request, check, artifact, and CI-log links stay unavailable until their integrations provide them; the Usage section is reserved for P2-12.

The runner sends each task-scoped event to authenticated `POST /factory/sandbox-events`
using its managed identity. The backend accepts only the separately assigned runner
events role and records the event through `TaskStore.recordEvent`, which persists it
with activity before publishing the committed event.
At the start of each task turn the runner reports disk total, used and free bytes.
It checks free space every 15 seconds; below the configurable threshold it reports
`disk_low`, and the backend atomically records the attention transition and reason.

#### Software Factory — release view (per project)

| Data points | Actions |
| --- | --- |
| Horizontal git graph: branches as lines, commits as dots (from GitHub on demand), coloured by PR, checks, release, and deployment state | Hover or keyboard-focus a dot for commit and linked-state details; open its commit on GitHub; open linked PRs and runs from their records |
| Releases (one per merge to `main`): build number, SHA, status, created and released time, linked tasks and PRs | Open a release; open its workflow runs |
| Workflow runs: workflow, trigger, status, conclusion, duration | Open the run on GitHub; open the failing log |
| Deployments: environment, status, time | Open the deployment |

#### Software Factory — projects

| Data points | Actions |
| --- | --- |
| List: every repository of Dan's GitHub account. Managed projects first (name, repository, default agent, policy, tech, running tasks, last release), then the other repositories (name, last push, language) | Change the labelled, two-choice completion policy directly on each project card; edit or archive a managed project; **Manage with Jarvis** registers an existing repository with the configured defaults (tech detected from the repository); **Add project** opens the existing-repository and new-repository actions |
| Project settings: repository, default branch, default agent, completion policy, merge rules, sandbox size, tech, max parallel tasks | Change the completion policy in one choice; the saved policy is confirmed by the server and applies now, including to pull requests already open. Save other project settings for new tasks. |

The project API lists active projects, creates and updates settings, and archives
without deleting the row or its task history. Repositories use `owner/name`;
policies are `deliver_pr` or `complete_without_deployment`, sandbox sizes are
`1x2` or `2x4`, tech identifiers start with a lowercase letter and use lowercase
letters, digits, `.`, `_`, and `-`, and max parallel tasks is a positive
32-bit integer (default 1).

The backend lists every repository in the GitHub App installation for the
configured project owner. It caches the list and refreshes it when Dan asks
from the Projects page. Managed projects appear first; each other repository
shows its last push and primary language, with **Manage with Jarvis** registering
it without a form. Jarvis can register the same installed repository through
`manage_repository`. Registration uses the repository's actual default branch,
the configured agent, policy, and task-limit defaults, and a tech identifier
detected from its default-branch files or primary language. The GitHub App token
and private key stay in the backend.

The projects page derives running-task counts from tasks in the `Running` state
and refreshes them when Dan refreshes the page. Until release data is connected,
the last-release field is explicitly unavailable rather than inferred.

#### Settings

| Data points | Actions |
| --- | --- |
| Appearance: light or dark mode across all signed-in pages | Change; persist across visits |
| Jarvis: model and reasoning (chat and hosted Danish fallback); voice-role model for Danish and English Voice Live | Change (applies to new sessions) |
| Appearance: light/dark/system and approved theme tokens | Change (persisted across visits) |
| Identity and role: shared description (up to 2,000 characters), distinct from tone/style | Change; apply to active voice after provider acknowledgement, otherwise reconnect |
| Personality: tone, response style, custom instructions (up to 2,000 characters) | Change or reset; preserves the separate identity description |
| Voice: speech-to-text model, English voice, fixed Danish voice (Jeppe), default language, minimise windows on voice start (off by default) | Change supported preferences; Danish voice is read-only |
| Coding agents: Codex default model and reasoning; Copilot default model | Change (applies to new tasks) |
| Global: max parallel tasks; sleep switch | Change |
| Projects: defaults for new projects (owner, visibility, templates repository, default agent, policy, max parallel tasks, default branch) | Change in the Projects section. The policy default only pre-fills projects Jarvis registers later; every project keeps its own policy and can be changed any time. |
| Credentials: name, expiry, last renewal, last check, status (never secret values) | Trigger Codex renewal; open re-seed instructions |

The backend checks Codex daily and renews only when the access token has three
days or less remaining and no Codex task is running. Credential dates and
status are non-secret Key Vault metadata; definitive failed renewal is visible as
"Action needed". Uncertain runs preserve the previous credential state and retry
after 15 minutes, doubling the delay up to one hour. Dan can force Codex renewal
through the backend repair API, using the same lease and running-task exclusion.
Copilot token authentication is checked daily, retaining expiry where known.
GitHub App health reflects the last installation-token mint; a failure raises
an activity alert once per failure episode. Settings UI repair wiring is a
separate task; re-seeding remains an operator workflow.

The settings API validates choices against the server's available-model catalog.
The coding-agent catalog currently offers only each provider's default. P2-11
verifies the runner path for explicit model values: Copilot uses its CLI `--model`
option; Codex uses the ACP `model` and `reasoning_effort` session options. Task
overrides take precedence over settings defaults when the dispatcher supplies
the effective values. Actual provider/model availability still needs a live
task. The global parallel-task limit is a whole number from 1 to 100. The
sleep switch is on the main page; voice sample playback and credential
data/actions remain visibly unavailable until their owning services exist.

#### Usage and cost

| Data points | Actions |
| --- | --- |
| Per task, project, and period: sandbox minutes and DKK; Jarvis model tokens, screen frames and DKK; voice minutes and DKK; Codex and Copilot usage (no DKK); current UTC-day web-research call count | Change period; group by project, agent, or source; open a task |

The Usage page offers 7-, 30-, and 90-day periods plus all time. It shows task-linked metric rows in project, agent, or source groups, plus today's UTC Jarvis tool-call counts by tool (including successful, refused, and failed calls). Screen-frame DKK uses the current documented Luna Global Standard token rates and is identified as an estimate; sandbox and voice costs are also estimates, and Codex/Copilot never display DKK. Unknown model rates remain unpriced. When more than 1,000 grouped rows match, the page says that its subtotals cover only the displayed rows.
The separate daily web-research count includes successful, refused, and failed calls. A missing audit count is shown as unavailable, not zero.

## Constraints and integrations

- **Azure:** subscription "Dan Aakesen", tenant Novaro, region Sweden Central. Details in [docs/agent-context.md](docs/agent-context.md).
- **GitHub:** Dan's private repositories only; a GitHub App provides per-task tokens, webhooks, and merges.
- **Coding agents:** Codex (ChatGPT Pro, Jarvis-only login) and Copilot (work seat) over ACP; their usage limits are shared with Dan's own use.
- **English voice:** `gpt-realtime-2.1` with Ryan HD; tool calls execute through the backend's registered tools. After a successful write, voice and chat give one short confirmation with at most a count, not a recap of approved details; those remain in the written/on-screen record and are read only when requested. Failures and unverified outcomes stay explicit.
- **PC bridge:** the hosted agent and browser never connect to the PC directly. The backend accepts only Dan's delegated token from the configured bridge app on the bridge route, bounds and correlates commands, and reports bridge availability and Jarvis-control pause state in Now. Fixed local open/focus/read actions and the separately gated Chrome actions are allowed; there are no arbitrary shell commands. With Chrome automation on, HTTP(S) URLs open as active tabs in Dan's connected Chrome profile and its window is brought forward; if the extension is disconnected, the current bridge launches Chrome directly, never the Windows default browser. `pc_act` uses Windows UI Automation on any foreground app, with one Jev decision per fresh snapshot, sensitive-field blocking, and confirmation only for irreversible control actions. It can send at most four key chords or type an explicit, quoted, non-sensitive value into the focused control; Windows input is sent only after rechecking the foreground app, and Win+L/Ctrl+Alt+Delete are refused while Alt+F4 requires an explicit close request. The tray's persisted Pause Jarvis control toggle blocks PC control actions. Launched apps are granted Windows foreground permission.
- **Chrome browser executor:** When Dan explicitly enables the tray toggle, the authenticated PC bridge drives the Chrome profile Dan normally uses through the installed Jarvis MV3 extension and native messaging; if that transport is disconnected, it retains the loopback CDP fallback for browser automation. Website URLs open in a new active tab through the extension, and Chrome's window is focused and asked for attention. If the extension is disconnected, the current bridge launches Chrome directly; if the extension is connected but the toggle is off, Chrome routing is refused. The extension is registered for Dan's Windows user, accepts no external messages, and introduces no network listener. Jarvis may list tabs, take one snapshot of visible actionable elements, and click, type, select, scroll, wait, send a bounded keyboard sequence, or type explicit text into the focused control. Before keyboard input, the bridge rechecks the focused tab and blocks sensitive fields; Win+L/Ctrl+Alt+Delete are refused and Alt+F4 requires an explicit close request. No model-provided selectors, coordinates, scripts, or shell commands are accepted; irreversible keyboard actions and irreversible clicks require Dan's P7-03 confirmation.
- **Ultrafast browser agent:** `browser_do` uses one Jev decision per observed browser step to choose a fixed operation and indexed target. Foundry writes text only for TYPE actions; only send, delete, pay/purchase, post, push, or overwrite actions retain P7-03 confirmation, and Jarvis stops rather than entering passwords, card numbers, or one-time codes. The bounded run reports its step and result in the workspace and independently checks completion.
- **Act on the shared tab (P7-19):** When Dan asks to act on the page he is sharing, capture that display's window label alongside its transient vision description. Match both only against the live bridge tab list; ask Dan to choose on ambiguity and offer to send steps if Chrome is offline. Run the bounded Jev agent on the matched tab, announce brief voice progress, show step/results in the workspace, and honor “stop.” Never use model output as selectors, coordinates or scripts; P7-18 still rechecks each observed element and confirms only irreversible send/delete/pay/purchase/post/push/overwrite actions.
- **Security:** agents run with full permissions inside their sandbox and can read its tokens, so each token is scoped to the task. Jarvis data and other areas are never reachable from a sandbox.
- **Cost:** see [Cost](docs/architecture.md#cost) in the architecture map.
- **Existing systems:** Banking is an existing Azure app using the Agents API (integration code not inspected yet). Daily is an existing ChatGPT site and remains running/canonical with ordinary authorized writes before evidence-gated cutover; its approved functions and history migrate through P12. Migration tooling must not rewrite its application/source code/schema or records.

## Success criteria

- For this repository, a responsive intake/integration coordinator dispatches at
  most two builders and maintains the canonical GitHub backlog. Builders own
  development, automated regression tests and failure fixes; pipeline results
  provide bounded, content-free routing evidence.
- Qualified integrated changes flow continuously through the existing main-only
  production path without routine per-release human sign-off. Required failures
  still block acceptance. Applied components, deterministic readiness and live
  conversation acceptance are separate facts; real-world reports feed the backlog.
- Dan can ask Jarvis, by voice or chat, to start a task on a project; a coding agent delivers a pull request; GitHub Actions checks it; Jarvis merges and releases it according to the project policy.
- Dan sees every task and release update live, can steer, pause, resume, cancel, and recover tasks, and sees what each task used and cost.
- Each phase in [PLAN.md](PLAN.md) meets its acceptance criteria. Prototype results are evidence for feasibility; production behavior needs its own verification.

## Open questions

- Conflicts between pull requests in one repository (Decision 5).
- Changing the provider on a running task (Decision 4).
- What usage Codex and Copilot report per turn ([data model](docs/data-model.md#still-open)); P2-12 records offline package evidence, and actual fields remain a post-merge live check.
- Whether Foundry sandboxes can get the documented 20 GiB disk (Decision 9).

## Shared UI direction (4 October 2026; confirmed, implementation in progress)

P9-73 requires the phone composer on Home and Knowledge, and the voice dock,
to clear the bottom safe area by at least 12px even when the inset is zero.
Feedback and windows must not overlap those controls. Portrait and landscape
respect all safe-area edges; desktop remains unchanged. Home Screen launch uses
a minimal standalone Jarvis manifest and the existing app icon.

P9-77 adds `/notes` as the canonical page; old `/knowledge` addresses redirect.
The source editor preserves front matter and whitespace. Preview uses the safe
Markdown renderer with no raw HTML, unsafe links or external image requests.
The graph stays mounted behind the editable popup and may lag a vault write.
The centred search's plus action starts writing immediately; title and destination
can be chosen before Save from the full normal-folder vault tree, including root.
The popup header carries the inventory's last-sync time.
New folders start from the plus on their parent row, including Vault root:
desktop hover or keyboard focus reveals it; touch keeps it visible. The child
name field opens inside that folder with typing focus. Enter or the check adds
and selects it locally; Escape or the cross cancels. The separate New folder
button and new-draft instruction/path row are removed.
Phones retain the graph with a scrollable note overlay. Saves keep the draft on failure, prevent duplicate submissions
and use the loaded Contents SHA; 409 offers reload or comparison with explicit
adoption of the latest revision before a separate Save. Uncertain writes are not
replayed, and a failed revision check cannot discard the draft. Drafts are local
to the mounted page, not persisted or synchronised between devices. Backend
permissions and secret checks remain authoritative.

P9-74 excludes skill tooling, `.template.md` files and `.github` files from the
Knowledge graph and displayed note counts, without changing Jarvis vault search.
The graph reader renders Markdown without raw front matter, including after leading comments
or a BOM. Long notes scroll with a bottom fade and visible scroll control; titles
and paths wrap.

P9-71 shares one subtle cyan selected treatment across phone menu rows, desktop
navigation, top-bar toggles, tabs and segmented choices. Weight or icon shape
reinforces selection; current-page and toggle semantics, visible keyboard focus,
touch feedback and readable light/dark contrast are required.

The confirmed requirements and proposed feature placement are in [ui.md](ui.md).
Jarvis has one typing shell with expandable navigation and context panels, and a
fullscreen voice workspace with a runtime-state-driven orb. Jarvis can create and
arrange temporary views of accessible data, while Dan can override layouts and
move/resize windows. Window chrome can minimise, maximise, or close a view.
Minimising retains the mounted view in memory and exposes a tab in the active
workspace; Dan can restore it from the tab, and Jarvis can request restore
through the workspace command interface. P8-15 validates each command against
the shared generated-view and operation
allowlists, delivers it to the active client, and waits for that client's
application acknowledgement. Disconnected, stale, expired, cancelled, or
partially applied commands return a refusal or error rather than false success.
Closing a view changes only the temporary workspace and does not delete
conversation or source records.
Voice enters immediately, hiding typing history and the composer. On desktop, the
orb stays centred and fixed in the room whether or not windows are open;
the existing layout carries into voice and returns on natural end, connection
failure, Escape, or End voice. A speech interruption leaves voice active. The
optional “Minimise all windows when starting voice”
setting is off by default; when enabled, windows return as workspace tabs. P8-10
persists this preference through P8-17's account settings and mirrors it to
device storage for immediate shell reads. P8-14 supplies the safe generated-list
renderer; P8-15 supplies generated workspace windows and Jarvis-directed
commands; P8-16 supplies typed runtime activity.
Voice is explicitly started; the always-available assistant does not continuously
listen. Desktop and phone layouts follow the mode/window rules in ui.md. Theme
variables can be changed on demand and persist until changed again. Banking and
Fitness and Health are future areas; their detailed integrations remain deferred.
Generated views use versioned declarative JSON over existing authorised, bounded
data sources and the renderer/action allowlists recorded in `ui.md`. They are
temporary; HTML, JavaScript, and CSS supplied with a view are never executed.
P8-14's fixed React renderers display these typed views in the signed-in
workspace and contextual panel. P8-15's authenticated command tool controls
their in-memory lifecycle and layout; live Entra/Foundry delivery remains
unverified.

Implementation status and live-service limitations are tracked in PLAN.md and
the UI coverage report.

## Accepted capability additions (4–5 October 2026)

Dan accepted four additions after reviewing the supplied video transcript:

- **Long-term knowledge:** use Dan's private GitHub vault as the source of truth
  for notes and durable facts. Jarvis searches it and automatically saves clearly
  stated preferences, people, project facts, decisions and unfinished tasks;
  SQL is only a searchable index/cache. Never write secrets or credentials;
  banking or health details require Dan's explicit “remember”. Writes commit to
  `master` and return a commit link. No literally unlimited capacity is promised.
- **Web research:** search and retrieve sources, synthesise findings with links
  and supply results to existing dynamic-view consumers through Dan's existing
  ChatGPT/Codex subscription. Bing grounding and pay-per-call search are excluded.
- **Image generation:** generate images with Dan's ChatGPT/Codex subscription
  through the existing hosted runner, expose truthful job outcomes, and save
  private workspace artifacts for chat and workspace display. Usage is shared
  with coding tasks; no pay-per-image API or fallback is allowed. Video is
  deferred indefinitely to a separate issue. Artifact retention remains open.
- **Editable personality:** persist Dan's tone/response-style preferences and
  custom instructions, applying the same configuration to new chat and voice
  sessions. Keep the current butler default until changed; personality does not
  change tool permissions or honest reporting. Settings placement and form
  details are proposed in DESIGN.md and ui.md.

Tasks: P7-14–P7-16, P7-40 and the P8-19 Personality settings UI. P7-14, P7-16,
P7-40 and P8-19 are implemented and tested offline; live Azure/Codex behavior and
vault access remain unverified. P7-15 image generation is implemented offline with
live subscription and Blob acceptance pending; video is deferred and artifact
retention remains open.
The existing Microsoft-first service and cost constraints remain in force.

### Vault mirror setup (19 October 2026; P14-28)

The owner may opt into an Azure-hosted mirror that keeps the Obsidian vault and
private GitHub vault repository synchronized in both directions. Reading the
vault into GitHub is live on the first run; writing back to Obsidian remains
`dry-run` until the owner reviews the initial runs and explicitly changes the
repository setting. The owner did so on 22 October 2026; the scheduled task on
their computer had been unregistered at their request on 21 October. The
infrastructure switch defaults off, and the owner stores all
Obsidian credentials and sync policy directly in Key Vault.

### Selected shell refinement (6 October 2026; implemented in P8-37)

The shared typing/manual shell retains its top bar, narrow icon rail, collapsible area navigation, main tabs/workspace, closable contextual panel and Settings at top right. It has no separate bottom app-shell/status bar. Existing database-waking feedback remains accessible in compact top-bar status treatment; the bottom-centred chat input and compact voice-session control bar remain. P8-37 (#398) implements this requirement together with the composer and message window in one PR: the footer and its layout track are gone, and “Waking Jarvis…” is a compact `role="status"` pill in the top-bar actions (a pulsing mark with the same accessible text on phones).

The same consolidated P8-37 (#398) uses an avatar-free chat message window: remove both human and Jarvis icon/avatar marks from message content, preserving accessible author roles and readable user/assistant hierarchy. Retain the large scene orb, small voice-start orb, message content, safe Markdown, steering/FIFO queue and existing window actions. This requirement does not create another conversation or workspace system. As implemented, once a conversation exists the history is the shared workspace view `conversation` (title Conversation), shown as a glass window above the composer. It uses the existing workspace lifecycle: Minimise creates the shared Restore Conversation tab, Maximise/Restore size, Close, drag/resize, focus, tiling and Jarvis `workspace_command` targets all apply, and the window appears in the published workspace snapshot. Voice entry minimises it and voice exit restores it; Jarvis can still show it during voice. Close keeps it hidden until the next send or Conversation navigation. The composer, voice controls and overview stay outside the window, so typing and voice remain available throughout. New content auto-follows only while Dan is at the latest message; otherwise a Jump to latest action returns him. The composer's paperclip opens an attachment menu with the existing Look at screen/Look at camera visual-context actions, disabled with a reason until that source is shared; no file upload is added.

P9-45 lets Dan ask Jarvis to show or hide the conversation transcript through the existing `workspace_command` broker. This reversible view change needs no confirmation; Jarvis reports it only after the UI applies and acknowledges it. On phones, the transcript is hidden by default. The backend contract and prompt are implemented; the UI handler, phone default, and live acceptance remain the UI session's work.

In desktop typing mode, maximising the visible conversation also widens its composer to the same horizontal edges, including when chat floats over another page. Restoring, minimising or closing the transcript restores the normal composer width. Phone and voice layouts, drafts and other windows are unchanged.

Dan's revised 12 October requirement (local, unreleased) supersedes the initial
fixed-width height grip: resize by dragging the clean glass border from any
edge or corner, with no decorative corner brackets or separate top grip.
Resize hit regions must leave the native scrollbar usable; scrolling must not
move or resize the window or change its saved placement.
A Move icon beside Maximise moves the conversation and composer together.
Save position and size on this browser, fit them within the available viewport,
and preserve drafts and voice-client identity. Keyboard alternatives and
cancelled-drag restoration remain. Minimise hides messages but leaves the
composer where Dan placed it (Dan's explicit selection); maximise/restore
retains the saved placement. Keep compact message type and the readable composer.
On initial load, mount the chat window before requesting its messages. Show
message placeholders and a loading label inside the window, never in the room.
Keep the same window for loaded, empty and error/Retry states; retain existing
messages during refresh. Phones retain their explicit show/hide behaviour.
Temporary pinned-window read failures receive bounded recovery, including after
returning online or to the page. Authentication failures must identify sign-in,
not masquerade as storage failures; persistent errors retain Retry.
No backend change or release is authorised.

### Voice feedback and orb refinement (6 October 2026)

[#417](https://github.com/DanAakesen/jarvis/issues/417), P8-40, moves voice state and recovery feedback beneath the orb, following its position while leaving the compact glass control bar unobstructed. Language remains in More with current-session/next-session feedback inside its flyout. Explicit Start voice also requests browser microphone permission and prepares audio; once permission and authenticated session readiness succeed, capture starts automatically. Remove the normal Enable microphone step. Capture remains off before an explicit start, stops on end/navigation, preserves mute on reconnect and handles denied permission and cancelled starts with truthful recovery. This supersedes the earlier two-step activation requirement and is implemented offline in PR #419; deployed/live voice acceptance is separate.

The same task makes the persistent cyan orb/open amber core visibly awaken and gives listening, thinking, tool-work and speaking distinct motion. Labels and motion follow reconciled actual voice/runtime/playback state; speech intensity follows audible decoded playback and resets at silence/interruption. Changing light reaches the same living room and mirror floor. Voice controls work immediately while animation runs. Preserve scene/window/theme continuity, adaptive rendering, accessible status and reduced-motion alternatives. No extra prototype or design decision is needed before implementation.


### Voice UI hotfix (#435)

The voice More menu can start screen sharing or camera access through the native browser permission prompt, then inspect a frame on request or stop capture. Sharing alone never sends a frame. Session end retains existing capture cleanup. Transient sharing/inspection guidance, permission failures and terminal voice failures use dismissible bottom-right notifications outside the conversation layout; they never become chat messages or inline composer content.

Under-orb status uses bright white text with a soft glow and contrast shadow, without a badge background or colored glyph. Accessible live announcements and readable recovery detail remain. Dormancy keeps a gentle cyan pulse, visible amber network and slow core motion; awakening increases core movement and retains the existing ignition/wave/surge sequence. Real activity and audible playback still determine active states. Reduced motion remains steady and dormancy never opens the microphone.

## Control and reach (7 October 2026, P9)

Dan approved these after a gap audit. They are planned, not built.

- **Touch chat resize (P9-117, implemented):** phones have a visible, keyboard-accessible grip inside the Conversation heading. Dragging it changes chat height within the existing resize limits without scrolling or covering the composer; completed changes persist on the device separately from desktop placement. The composer open/close handle and desktop edge/corner resizing remain unchanged. Physical iPhone and Safari acceptance belongs to Dan, not automated browser emulation.
- **Model control per role.** Settings lists the models actually deployed on the Foundry account and lets Dan pick one per role: chat, vision, research, voice, transcription, embedding, Codex and Copilot, each with a reasoning effort the model supports. Dan can add or remove Foundry deployments from Settings with a confirmation, and Claude models are allowed as the chat model. Jarvis can read and change these settings by voice or chat; model and budget changes need confirmation. Voice tuning (turn detection, barge-in, reply length), research depth, memory and retrieval thresholds, and timeouts are also adjustable. ([#495](https://github.com/DanAakesen/jarvis/issues/495)–[#507](https://github.com/DanAakesen/jarvis/issues/507))
- **Workspaces.** Everything Jarvis researched or pulled up (reports, generated apps, images, knowledge-graph views) is kept in Workspaces. A rail icon opens a left pane where Dan can search, filter by kind, pin, and reopen items; Jarvis can find and reopen them too ("pull up the Ignite research again"). Jarvis can also rename, pin/unpin or remove one entry by id or unique query; ambiguous matches require Dan to choose. Removal requires Now approval naming the item while Dan is present and retains its source artifact and history. ([#519](https://github.com/DanAakesen/jarvis/issues/519), [#633](https://github.com/DanAakesen/jarvis/issues/633))
  Selecting another page closes the pane rather than leaving Workspaces selected, including selecting the current page again. This applies to desktop links, the phone menu and Jarvis navigation; an area with multiple pages can open its own navigation instead.
- **Routines.** Task recipes (saved PC/browser action sequences Jarvis can replay) are renamed Routines and can be edited and renamed. ([#529](https://github.com/DanAakesen/jarvis/issues/529))
- **Connected features.** Persisted background jobs, the jobs chip, the knowledge graph page, wake-word events, renew-credential, a system status page including the PC bridge, watch mode for screen and camera sharing, phone-call status, complete cost coverage, and conversation search.
- **Show work (P9-41).** In voice, selected tools publish a short, safe activity description and open their own window; typed chat opens nothing on its own (the chat answer carries the data, and Dan asks for a window with "show me", "open" or "put it on screen"). Successful vault reads/searches update one knowledge graph, repository tools update one bounded, redacted Code view per turn, task creation/steering/retry focus the Factory card, and calendar/mail tools show a readable agenda or their staged preview without bypassing confirmation. Code wraps at its allocated window width by default; an accessible “Wrap lines” choice restores original horizontal code layout without changing the source text, line numbers, highlights or search marks. `presentation.showWork` defaults on and is suppressed in `on_the_move`; presentation is best effort and never blocks or fails a tool. The backend contract is implemented; status-line rendering, Code rendering, graph highlighting, and focus animation belong to the UI session.
- **New abilities.** Calendar update and delete; mail drafts, archive and labels; project update and archive; Factory retry and release/deploy status; job detail and retry; a usage tool; clipboard read and write; vault note deletion; weather by home or named location.
- **Declined:** verbosity and max-token settings, notification preferences, an effective-config view, settings history, access to arbitrary local folders or browser history, and outbound phone or desktop notifications.

## GitHub backlog (8 October 2026, P10)

Dan decided that GitHub issues are the single backlog. When Dan asks Jarvis to change code, Jarvis creates an issue with the problem and acceptance criteria; the Software Factory then picks it up with the Codex agent (worker label `Jarvis`), or Copilot when Dan chooses. Project references use the active registry; ambiguous or missing selections do not write, and a named non-self project never falls back to Jarvis's repository. Existing approval gates for attachments and public image publication remain. Factory progress shows on the issue, its pull request uses `Fixes #N`, and the Factory board uses the same columns as the GitHub Project: Backlog, Needs Dan, Ready, In progress, In review, Done. ([#573](https://github.com/DanAakesen/jarvis/issues/573)–[#577](https://github.com/DanAakesen/jarvis/issues/577))

## Proactive assistance (17 October 2026; P13)

- Run checks at 07:00 and 18:00 Europe/Copenhagen, and let Dan request
  “Check now” at any time subject to quiet hours.
  Do no proactive work or delivery from 22:00 to 07:00; there is no emergency
  exception, and interactive requests remain available.
- Read todos, Factory, weather, calendar, mail headers, calendar-derived travel
  and news. Treat all source content as untrusted data, never as instructions.
- Use the vault todo file as canonical. Eligible proactive tasks go only to an
  existing `Personal/Inbox.md` or `Work/Inbox.md` selected by unambiguous scope.
  Every new proactive line starts `- [ ] (proactive)`. Project/software and
  engineering suggestions, and tasks with ambiguous scope or unavailable
  destinations, are not written. Existing tasks and suggestion sections are
  never edited, completed, reordered or deleted.
- Push only for deadlines within 24 hours, calendar clashes, travel disruptions
  and reminders about an hour before a todo is due. Hold a quiet-hour reminder
  until 07:00 and show it as due soon or overdue. Bundle at most one push per
  run and enforce daily caps. Pushes carry bounded todo or finding titles and
  due times for durable, owner-protected items in an encrypted payload. They
  identify deadline tasks by name and include due times in bundled alert lines;
  they never approve an action. Details never enter logs, metrics, errors or job
  output, and the payload is not stored. A user-triggered test is not proactive
  delivery. Teams is not used.
- Cap estimated spend at 100 DKK per Copenhagen month, warn at 80%, and label
  spend as an estimate.
- Show every scheduled, catch-up or manual run in the header Background work
  popover as running, then done or failed.
- Write findings and push text in the language of Dan's last chat message.
- Keep every milestone off by default and enable one at a time, only after the
  previous deployment is accepted.
- Real-device iPhone delivery remains unverified until observed in the
  installed Home Screen app.

Web Push is an opt-in visible alert for a durable, owner-protected item. Its
encrypted payload carries notification details, performs no silent work and
never approves an action. Notification headlines never repeat the product name:
iOS adds `from Jarvis` itself. Details are visible on the lock screen unless the
owner hides them in Settings → Notifications → Jarvis → Show Previews. The
backend defaults off and registers no push routes unless
`JARVIS_PUSH_ENABLED` is exactly `true`; production has set it since P13-03
(18 October 2026), so milestone 1 is live: Notifications in Settings can turn on
push and send a test. The user-triggered test is not proactive delivery. Teams is
not a delivery option. Real iPhone delivery remains unproven until separately
observed on the installed Home Screen app.

Proactive checks (milestone 2) are on in production since P13-14 (18 October
2026): both `JARVIS_PROACTIVE_ENABLED` and `VITE_PROACTIVE_ENABLED` are set, so the
07:00 and 18:00 checks run, Check now works, and the Proactive page and its
Settings section are available. A check only reads sources and stores findings.
Whether scheduled checks run is established by Dan's test on the deployed app,
not by CI.

Suggested todos, alerts and reminders (milestones 3 and 4) are on in production
since P13-15 (18 October 2026): `JARVIS_PROACTIVE_TODO_WRITES_ENABLED` and
`JARVIS_PROACTIVE_ALERTS_ENABLED` are set in the backend, with no web flag. The
P13-20 behavior replaces the old dashboard writer: eligible, clearly personal or
non-project work tasks go only to the corresponding existing `Personal/Inbox.md`
or `Work/Inbox.md`, with `(proactive)` immediately after the checkbox. Software
projects, Factory tasks, pull requests, builds/checks and engineering follow-up
are excluded regardless of source; ambiguous scope or an unverified destination
produces no write. Stable source/action receipts deduplicate across wording,
elapsed time, category and routing changes, including after owner completion or
removal. The writer never creates a note or changes the existing `Suggested by
Jarvis` section. A time-critical finding (a deadline within 24 hours or a calendar clash) found by
the 07:00 or 18:00 check can send one push, at most 3 a day and never between 22:00
and 07:00. Todo findings and reminders are limited to open vault tasks explicitly
marked `🔺`, `⏫`, `[priority:: highest]`, `[priority:: high]`, their
parenthesized Dataview forms, or legacy `priority:: P1 - High`. Unmarked and
lower-priority tasks do not generate task notifications. Open high-priority tasks
without a due date create one normal-urgency digest finding for an unchanged task
set per Copenhagen day, listing the count and up to five titles; it sends no push.
About an hour before an eligible todo with a time is due, Jarvis sends one reminder
push; a reminder due in the quiet window is held until 07:00 and shown as due soon
or overdue. Pause, the Todo list source switch and Notifications → Turn off stop
them. Whether todo lines appear and pushes arrive is established by Dan's test on
the deployed app, not by CI.

## Proactive foundation and engine (18 October 2026; P13-05, P13-06)

The backend foundation provides owner-only status, settings, durable finding
storage and feedback behind `JARVIS_PROACTIVE_ENABLED`, which defaults off.
Separate todo-write and alert flags also default off in code. P13-06 adds the in-process
scheduler, manual checks and run history, deterministic deadline/clash detection,
and one bounded, tool-less summary call; sources plug into the existing registry.
P13-07 adds read-only todo, Factory and weather source readers, without a writer
or proactive alert. P13-11 adds a
separate add-only suggested-todo writer behind
`JARVIS_PROACTIVE_TODO_WRITES_ENABLED`, which is effective only with
`JARVIS_PROACTIVE_ENABLED`; both default off in code, and production sets them in
P13-14 and P13-15. P13-20 replaces its destination and selection rules: it excludes
project/software suggestions across sources, routes only unambiguous Personal or
Work tasks to the corresponding existing inbox, and prefixes each new checkbox
with `(proactive)`. Stable source identities drive durable receipts and markers.
The writer never creates a note, writes to root `Task.md`/`Tasks.md`, or appends
under `Suggested by Jarvis`; it preserves old content and follows the Todos
switch, pause state, quiet hours for scheduled work, and per-run/daily caps.
Manual writes may run at any hour.

The approved schedule uses 07:00 and 18:00 Europe/Copenhagen slots; scheduled
work is forbidden from 22:00 to 07:00. The monthly estimate limit defaults to
100 DKK, warns at 80% and stops at 100%, including a conservative request-cost
pre-check. Idle scheduler ticks do not query SQL. Only the latest missed slot
can catch up, while under 12 hours old; paused slots are recorded without replay.
Scheduled checks still running at 22:00 are cancelled. Manual checks ignore quiet
hours but respect pause, source settings, budget and stored rate limits (one per
five minutes, six per Copenhagen day). Runs appear in Background work with safe
plain-language outcomes. None of these flags is enabled by this change.

The todo reader scans safe Markdown notes recursively under `Personal/` and
`Work/`, excluding Archive and hidden paths, plus the case-insensitive root
`task.md` or `tasks.md`. It emits at most 40 sanitized facts, only for open tasks
marked `🔺`, `⏫`, `[priority:: highest]`, `[priority:: high]` (square or round
brackets, case-insensitive), or legacy P1 - High metadata. `🔼`, `🔽`, `⏬`,
`medium`, `low`, `lowest`, prose and missing priorities remain normal. `🕒 HH:mm`
can precede or follow the due date; legacy due fields and date-only end-of-day
behavior remain supported.
Duplicate tasks and moves between notes preserve reminder identity.
Discovery is SHA-cached and bounded to 256 files, 4 MiB total content,
256 KiB per file, four concurrent reads and 20 seconds. Partial scans show
unavailable, never "no tasks". The P13-11 writer keeps its root-only resolver/parser,
writes only to an existing resolved file, and records hashed receipts so
completed or deleted suggestions are not re-added. The Factory reader reports
attention/failure and open-PR status plus a running-task count; the weather
reader uses the saved home location and makes a bounded HTTPS forecast request.
Their reads remain governed by the existing proactive engine; the todo writer is
a separate gated after-storage hook.

## Proactive calendar, mail and travel sources (18 October 2026; P13-08)

P13-08 registers bounded read-only Google Calendar and Gmail metadata sources and
a calendar-derived travel source. Calendar reads use a 48-hour window; mail lists
at most 15 unread primary-inbox messages from the prior two days and reads only
selected headers; travel reads up to seven calendar days and makes no
travel-provider request. These changes enable no flag, run no source, add no OAuth
scope and leave the server entry point unchanged.

## Proactive run alerts (18 October 2026; P13-12)

Only scheduled and catch-up checks can notify for a new, time-critical deadline
within 24 hours or calendar clash; travel disruption keeps a typed category for a
future provider. Eligible items share one detailed push, capped at three accepted
bundles per Copenhagen day. Manual checks, paused settings, quiet hours, cancelled
runs, missing subscriptions, and findings already seen, snoozed or dismissed do
not alert. The server composes bounded Danish/English v2 headlines and bodies
from stored item titles, with a due time for a single item when available.
Bundles show up to three titles and an overflow count. Failed detail reads still
send the count headline. The worker validates and clamps v2 text; older payloads
use generic headlines with empty bodies. The alert switch defaults off
in code, like the proactive and push switches, and production sets it since P13-15; per-class controls are not
part of this slice.

## Owner-requested task reminders (#1239)

In chat and voice, a direct owner request can schedule a one-time reminder or a
daily/weekly recurrence for an existing open task. Repeating until the task is
completed is explicit; the requested reminder time is independent of the task's
due date and time, which are never changed. The owner can read, update, snooze
or cancel schedules. Missing, ambiguous, quiet-hour or unsupported times are
clarified or refused rather than guessed; confirmations state the Copenhagen
time and recurrence.

These explicit schedules use the existing reminder ticker and Web Push delivery.
They are not subject to automatic high-priority, category or scope suggestion
filters, and do not change those preferences. An explicit time in the existing
22:00–07:00 Copenhagen quiet window is refused. A task is re-read before
delivery; a completed, deleted or ambiguous task stops the schedule, while a
stable Obsidian task ID preserves it through a rename or move. Dismissing a
notification does not complete the task.

The database migration creates no reminder schedules and enables no new
notifications. Only a verified direct owner request creates a schedule.
Scheduled, suppressed and provider-accepted states are distinct; provider
acceptance is not confirmation that a device displayed or acknowledged a push.
Physical-device delivery remains unverified.

## Proactive todo reminders (18 October 2026; P13-13)

An explicit-time P1 - High todo gets one detailed reminder push about an hour
before it is due when a proactive check has seen it or a verified push to the
vault's default branch triggers a todos-only planning pass. Other priorities and tasks
without an explicit priority do not generate task notifications. Date-only
P1 - High todos remain covered by the 24-hour deadline alert. Reminders wait
through the 22:00–07:00 Copenhagen quiet window and are presented as due soon or
overdue after 07:00. The ticker verifies the current priority before sending and
suppresses a reminder when vault verification fails. Each reminder has a private
Proactive item. A single push headline gives its Copenhagen due time, including
earlier-today or yesterday wording, with the todo title in the body. Bundles
use the existing count headline and up to three soonest-first time/title lines,
then an overflow count. Titles are capped at 60 code points, bodies at 240 and
each line at 80, with control characters removed and ellipsis truncation.
Todo text goes only into the encrypted payload, never logs or other telemetry.
The shared
proactive, push and alert switches default off in code, are on in production since
P13-15, and add no new setting or web control.

A default-branch vault push plans eligible todos shortly after the change, except
during the quiet window; scheduled checks and "Check now" continue to plan them.

## Proactive web (18 October 2026; P13-10)

The web page and Settings section are independently gated by
`VITE_PROACTIVE_ENABLED === "true"`, which is off by default in code and set in
production by P13-14. They use the shared authenticated HTTP
contract, keep returned item/settings content in memory only, and render all
model/source text as plain text. Manual check polling is visible-page-only and
bounded; item actions can be retried after rollback. This web slice does not set
the flag or grant permissions.

## Proactive news source (18 October 2026; P13-09)

The backend registry includes a read-only RSS/Atom source for configured
feeds, defaulting to the GitHub changelog and OpenAI news. It validates hosts, pins HTTPS
connections to vetted public DNS addresses, rejects redirects and unsafe XML,
and returns only bounded, sanitized titles. The source does not itself activate a
scheduler, model call or proactive delivery, and this slice sets no proactive flag.

## Health migration (approved P12)

Native iPhone Health logging (P15-39 / #1480) uses only the plus-button
**New lift** sheet, with chips that prefill an exercise's last logged weight,
reps and sets. **Track workout** contains Exercises and History, or the existing
empty state, without an inline form, Save button or save-status line.
The Dashboard/Track workout segmented pill sits in the fixed bottom bar above
search and plus. Visible and accessibility copy follows Danish/English.

Tool parity is an acceptance requirement for every retained Daily capability,
not a later convenience. The page and Jarvis chat/voice must use the same
owner-authorised services, source data, calculations and confirmation rules.
Browsing periods/history/details, showing requested data and visuals, and
permitted changes need equivalent tool workflows; UI controls alone do not
complete a capability. Reuse existing general tools where they provide the
equivalent action rather than creating one tool per button. Missing tool
coverage remains unfinished. This does not restore excluded features or waive
private-data, provider, credential, device, approval or activation gates.
Both Danish and English Voice Live start with the configured Daily tools in R1;
the capability-preserving R2 discovery transport is used if the direct schema
frame does not become ready. R2 preserves catalogue access but does not bypass
the existing server-side permissions or review requirements. Passing CI is not
production acceptance for Health parity or proof of live provider responsiveness.

Health and nutrition history (#1201) must be traversable beyond the first
page. Each Health call reads at most 93 inclusive Copenhagen dates and 100
records per category; wider requested periods advance through explicit windows.
Categories continue independently without replaying exhausted results. Nutrition
keeps the requested meal-date filter and creation-time keyset order across pages.
Jarvis must fetch further pages when needed for the answer or disclose the
actual loaded windows/records and remaining limits. Failed, interrupted or
budget-limited traversal is partial. Exhausting retained results never proves
complete device/source ingestion.

An independently opt-in `daily_feed` workflow shares the retained Gmail/calendar
snapshot, attention, suppression and manual-refresh services. Reads preserve
Missing/Stale/Current, successful capture versus latest attempt, exact source
IDs/consumer keys and unknown retained calendar range. Refresh, dismiss, Received
and restoration require the current verified chat/browser-voice context and
the existing two-minute browser Now approval. Only Daily visibility changes:
no mail/calendar/order-provider mutation, original workflow dispatch or schedule.
Changed targets are refused under the owner transaction; acknowledged changes
refresh existing consumers. Missing Google/model configuration and failed,
limited or incomplete refreshes cannot establish fresh coverage. The separate
nutrition-only connector has no feed access. The feed is not part of the
owner-only Daily module that production switches on; stored grants,
CalendarList/live-model parity and #725 acceptance remain unverified.
Active suppressions are limited to1,000 per type under the owner lock. Updating
an existing suppression and native-reviewed exact-key restoration remain usable
at capacity; known-key recovery cannot depend on listing the whole collection.

Retained brief history belongs in that same page and chat/voice query workflow.
Read existing historical metadata and exact body detail without generating,
delivering or scheduling a new brief. Stored timestamps and historical delivery
states are not current health/freshness evidence; do not infer a missing timezone.
Preserve the original data and leave recurring Daily notifications off.

16 October implementation resumption: the next inactive P12-09 slice shares
one owner-authorised bounded query path between HTTP and the existing sensitive
tool registry for retained health/sleep/workouts/minute heart rate, meal history
and sync evidence. It preserves canonical values, units, Copenhagen dates,
lineage, nullable unknowns and tombstones; source completeness and staleness are
not inferred. Acknowledged health/intake commits invalidate the existing refresh
stream. Reconnect/refocus consumers must refetch; content revisions are not a
durable global event cursor. This is local source work, not deployed integration
or full #724 acceptance. Hosted authenticated ChatGPT food logging, trusted
intent/proposal acceptance, the single Daily page/on-demand GenUI and protected
export/source-parity/device/cutover gates remain separate. No coaching, widget,
provider call, new meal writer or production composition is added by this slice.

The next bounded #724 continuation adds retained favourites and meal plans to
that same read path, not another service. These periodless collections use
exact ID-only cursors and at most 100 records per page. Preserve display aliases,
saved nutrient provenance, plan snapshots/revisions/tombstones and nullable
values; definitions and plans are not consumed meals. Their acknowledged writes
invalidate their own source through the same refresh hub. The hosted ChatGPT
food-write/connector requirement remains unfinished.

The next inactive hosted nutrition adapter exposes only nutrition reads,
Frida lookup and explicitly reviewed intake logging/correction/soft deletion.
A separate delegated OAuth client must not acquire general Jarvis authority.
External model input cannot select an owner or declare its own confirmation,
provenance verification or rollout state. Native confirmation binds the exact
proposal and stable operation keys; receipts claim commitment only after the
existing handler returns. Unknown nutrients stay null. For this unactivated
external boundary, every mutation requires native review, including exact-label
logging; internal exact/favourite logging keeps its no-redundant-confirmation
requirement. This conservative external limitation is not full retained-workflow
parity. Unsupported clients refuse writes; actual ChatGPT compatibility,
account linking, scopes/grants and mobile acceptance are not established by
synthetic protocol tests. Production composes no hosted adapter.

The inactive saved-food continuation supports native-reviewed favourite/alias
saves, server-resolved plan saves/soft deletion and persistent canonical
favourite likes/dislikes/clears. Reviews show actual source snapshots and plan
totals; SQL rechecks sources under lock before commit. Real favourite/feedback
revisions protect retries, including cleared preferences. These operations
never create intake or Health exports and do not activate the connector.

An independently opt-in internal `daily_food` tool supports direct requests
such as `Log my favourite NAME` and `Log yoghurt: 200 kcal, protein 10 g`.
Only its operation is model input: names and exact quantities come from the
verified current Dan message, with saved portions resolved server-side.
Absent macros remain null and saved confidence/provenance remain intact.
These explicit requests do not require a second confirmation. Conditional,
negated, time-qualified or unsupported wording is refused, not guessed;
this narrow direct path does not implement new photo/portion-estimate review.
Repeating one message recovers its actual committed intake without logging
again, even if the favourite later changes. Edited source requests and deleted
intakes cannot silently become another intake. Production remains off;
this is not complete internal food workflow or #724 acceptance.

The inactive internal composition includes `daily_food_review` for portion
estimates, revisioned corrections and soft deletion. It uses the existing
owner-bound one-time approval in Now, not model confirmation flags or a new
proposal dispatcher. Review shows the exact operation and changed before/after
values, with meal identity, portions, nutrients, source, uncertainty,
occurrence/Copenhagen date and target revision. Unchanged details are summarized
instead of repeated. The existing 4,000-character Now bound refuses a review
that cannot be shown completely and gives a rename-safe recovery. Model proposals remain
estimates; approval does not make them independently verified. Direct supported
exact labels and actual saved favourites are routed back to the one-step tool.
This initial reviewed path requires a present chat/voice session and a browser
approval within its displayed two-minute window. For estimates only, a natural affirmative
such as "yes, log that" in the same session consumes that exact pending approval.
Unrelated/conditional replies, ambiguous proposals, stale replies and other sessions
cannot authorize it; unrelated replies end conversational approval for that proposal.
Corrections and deletions still require Now. Confirmations remain in the browser
app even if presence changes, and present mode is rechecked before writing. Rejected,
cancelled, expired or stale reviews cannot mutate intake. Existing canonical
storage, exact operation/revision replay, tombstones and commit refresh remain
shared. No Health write, production activation or physical-phone acceptance is
included; broader conversational and actual client/device gates remain.
Both internal food tools refuse phone calls before generic approval; an approval
cannot make their unsupported phone context valid.
Browser chat and browser voice remain supported on mobile as well as desktop;
using a phone's browser is not a telephone call. Stage `log_estimate` before
inviting confirmation: prose estimates and reference lookups create no pending
approval. Without a pending proposal, prepare a new review and obtain a new reply;
historical agreement cannot authorize it. Only a committed tool receipt proves logging.
While the tool waits, the authenticated Now feed exposes the exact review.
Typed chat also streams that source-bound review into the active conversation,
with a direct invitation to reply; opening the separate Now popover is not required.
Present-mode browser voice also requests a tool-free spoken estimate and invitation
from that same staged summary, even though the food tool is still pending.
An initial spoken acknowledgement is not that invitation or proof of logging.

Approved #1196 extends the same reviewed flow to food photos. Existing
conversation attachments reach the existing image-capable model path; the model
proposes generic components and estimated portions, while the existing pinned
Frida adapter supplies nutrient references only. `lookup_components` is a
read-only operation grouped into `daily_food_review`, so the tool catalogue
does not grow. The user can correct component identity, preparation or grams;
Jarvis must re-lookup changed inputs, and the server resolves Frida again and
recalculates totals before showing the exact Now proposal. Missing quantities,
unmatched foods and unknown nutrients remain explicit; unreadable/non-food
images or provider failures ask for recovery. Photo provenance comes from
validated persisted attachment references, not tool arguments. Only approval
of the exact final proposal reaches the existing canonical meal writer.
Daily remains default-off; no live provider, deployed client or physical-device
acceptance is implied.

An additional independently opt-in internal `daily_saved_food` tool provides
owned saved-name/alias lookup and versioned preference reads without mutation.
Favourite/alias saves from an owned intake or proposed definition, server-built
plans, plan soft deletion and canonical like/dislike/clear require the exact
browser Now approval. Show actual before/after snapshots and bind source
revisions/fingerprints under canonical SQL locks. New definitions stay estimates;
plans and preferences never become eaten food or Health writes. Keep missing
preferences distinct from persisted null clears. Replays return real saved
records without another write or refresh. Current verified present chat/browser
voice supplies write context; phone is unsupported. The two reviewed food tools
share the bounded 180-second browser relay and 210-second hosted-agent read
budgets; other tool deadlines remain unchanged. No production activation or
full client/provider/device acceptance is implied.

Owner-configured nutrition targets feed the personalised suggestion budget:
resting energy burn, daily deficit and protein target, each a whole number Dan
enters in Settings or by telling Jarvis; a chat or voice change needs the exact
browser Now approval. There are no defaults: an unset target shows as needing
configuration and is never estimated. Allowance today is resting burn plus the
active energy burned so far today minus the deficit; energy and protein left
subtract what has been eaten so far, with unknown values flagged rather than
counted as zero and no projection of the rest of the day. There is no BMR/TDEE
estimate and no coaching, recovery or recomposition automation. The values are
private health data and stay out of source, fixtures, documents and logs. The
stored targets, their approved tool and the read-only `daily_nutrition_suggest`
tool exist only behind the default-off Daily gate (Daily off leaves Jarvis
unchanged). The gate is one server switch that is off by default in code; only the
reviewed production deployment files turn it on (18 October 2026). The suggest tool
reports energy and protein left and the saved
favourites that fit, using the stored active energy and only the meals logged in
Jarvis, so food eaten but never logged is not counted. The Settings section
appears only while Health is enabled. It shows the three targets as whole-number fields
with their allowed ranges, saves on its own rather than with Save settings, and
clears a target when its field is emptied. It ships no defaults, placeholders or
example figures, and a failed load or save shows page-owned wording, never server
text. Checking it with his real figures is Dan's own step.

The Health page (P12-15 / #730) opens on an overview so Dan can see what is
actually stored before he browses it. For each retained collection the backend
exposes (measurements, sleep, workouts, food history, saved favourites, meal
plans, brief history and sync evidence) it says in plain English what the
collection is for, and whether a read-only one-record check found records, found
none or could not read it. "None returned" never claims the original source is
empty, and the overview shows no invented counts, totals or estimates. Open goes
to the existing record browser, which keeps its periods, paging, details, units
and source/freshness labels. Its Data presentation (P12-34) uses a sticky table
on wide screens and record cards below 700px. A readable, keyboard-operable
detail region keeps every field and a secondary raw-record disclosure; closing
returns focus to the opener. Observation charts keep their unaggregated values,
with keyboard inspection and a disclosed data alternative. The page uses only
the existing owner-authorised
`/daily/capabilities` and `/daily/query` reads, so it adds no writer, provider,
device, private-data or consent path. It exists only when the web build switch
`VITE_DAILY_ENABLED` is exactly `true`; the switch is off by default in code, so a
build without it leaves the released navigation unchanged. Dan pre-authorised
switching Daily on for his account once the page is live and checked, and the
production deployment files then set it together with the backend switch (18
October 2026). Acceptance with real data, a physical phone and the original source
stays open.

18 October 2026 (P12-20 / #964): Health keeps that single destination and now has
one page heading, a section switcher and an active section (from P14-58 the
switcher is the list of pages in the shell sidebar, not a row in the page). The shipped sections
are Overview, Briefs and Data; Overview still opens a collection in the existing
browser, and Briefs reuses its history and detail. Unavailable section
capabilities do not create dead entries. Data uses one shared Europe/Copenhagen
period (Today, Yesterday, Last 7, 14, 30 or 90 days, This year, or a validated custom range of at most
366 calendar days), retained while switching sections and in the URL. New
Workouts, Nutrition and Body & sleep views remain follow-up work; there are no
separate navigation destinations, widget, coaching/recovery/recomp or TickTick.

On-demand Health views (P12-16 / #731) let Dan ask Jarvis in chat or voice to show
what Health holds, and the answer appears as a table, chart or detail in the existing
workspace window instead of a fixed native screen. The `daily_show` tool covers
measurements, sleep, workouts, one workout's heart rate, food history, per-day
nutrition totals, saved favourites, meal plans and sync status. Jarvis understands
the request and follow-ups in Danish or English: factual questions and explanations
are answered in words, while a visual is used when requested or helpful for a clear
trend/comparison. An explicit table or chart preference is honored when supported;
nutrition is not tied to tables, nor are measurements automatically charted.
Nutrition charts show one selected nutrient from the existing per-day totals.
Unknown values are omitted, partial totals are identified as lower bounds, and
bounded or partial history is disclosed. For a saved-target comparison, Jarvis reads
the actual owner target and relevant measurements through `daily_query`; an unset
target stays unset and is never replaced by a default.
It reads through the same
owner-authorised read model as the Daily page and `daily_query`: one bounded page
per request (at most 366 days and 200 rows, 100 for meals, favourites and plans;
no paging), and `daily_show` adds no calculations: per-day nutrition totals are
already derived by the shared query read model from retained meals. Values keep their
units and dates. A footnote under the data names the source, the period, the read
time and that completeness and freshness are not established. A missing value reads
as unknown, never zero, and an empty read says so with its own read time. Asking
for the same view again refreshes it in place rather than opening another. It works
only while a signed-in workspace tab is connected; otherwise, or for an external
client, Jarvis says so and uses `daily_query` for a text answer. It is private
health data: the phone is unsupported, and nothing is changed, logged or sent. The
tool exists only behind the default-off Daily gate (Daily off leaves Jarvis
unchanged). It adds no page, renderer, widget, writer, provider, device or consent
path and no Status, Recomp, Review or Ready views. Workout charts plot each
recorded duration in seconds by date, keeping repeated-date workouts distinct;
unknown durations are omitted. Checked with synthetic data
only; acceptance with real data and a physical phone stays open.

The existing `daily_query` also reads the owner's Gym, Run and daily-step targets
from the same target store used by Health Settings. Unset targets remain null and
are listed as missing; no default or target write is available to the assistant.
Historical metric and sleep provenance is exposed as bounded typed fields, and
workout detail adds normalized metrics not already summarized there. A capped
workout-metric detail is explicitly partial rather than described as complete.

When an existing Frida adapter is explicitly supplied, owner-authenticated
`daily_food_lookup` exposes only its public-reference component lookup.
Keep generic food names, requested grams or explicit unknowns, preparation,
DTU/version/DOI attribution, retrieved times, incomplete totals and provenance
intact. Reference results are not verified consumed food or approval for a
later mutation. No owned history, credentials or raw conversation is sent to a
provider. Missing provider capability contributes no tool; failures stay
unavailable rather than falling back to invented nutrition. This read neither
logs intake nor enables Daily, and does not establish live-provider acceptance.

P12-05 processes the existing SQL inbox through a bounded restart-recoverable worker only when the new `JARVIS_HEALTH_UPLOAD_ENABLED` switch is explicitly true; code defaults off, while the reviewed backend deployment setting is explicitly true. Processing records accepted, in-progress, succeeded and quarantined outcomes distinctly, with retry leases and retained evidence. Metrics/sleep/workouts/detail/minute HR keep canonical units, Copenhagen dates, exact session/checksum replay and bounded reads. Domain changes, ingestion lineage and processed-feed freshness commit together; phone heartbeat stays separate. Empty workout exports cannot erase history, missing values stay unknown, and native nutrition cannot feed back into canonical meals. Older accepted snapshots cannot replace newer keys. Historical batching limits and cautious grouping guidance are documented in `docs/daily-health-ingestion/README.md`; exporter-specific date-range/chunking controls and complete-history verification remain unverified.

18 October 2026, owner-approved #1005 / P12-29 scope supersedes the earlier
export/import route for this delivery: source Daily uploads reach Jarvis through
the existing authenticated Health Auto Export endpoint, SQL inbox, processor
and selected native tools. Do not build or rely on a Daily export/import path,
second API/store/auth service, or new Azure resource. Port the 16 selected
source capabilities (including nutrition history/analysis/balance, conversational
Status, profile, preference and recovery) using existing services and confirmed
owner writes; do not add excluded commitments/orders/experiments, meal plans,
fixed Status renderers or Apple Health meal write-back. This is not evidence of
deployment, complete API parity, replay, phone acceptance, token handoff, or a
cutover; all remain separately verified gates.

Heart-rate summaries and series must validate declared units consistently. Unsupported rate units quarantine without changing processed freshness; only established legacy summary fields imply BPM when their unit is absent. Missing samples and summaries remain unknown, not inferred.

Body-fat percentage accepts string `%`/`percent` or `fraction`/`1` and normalizes to percent. Unsupported strings and non-string unit declarations quarantine even when another unit could override them. Absent/null/blank units remain missing; without a supported inherited unit they stay unknown without inferred conversion. Preserve zero, missing values and raw evidence.

P12-04 reuses the existing backend and SQL for the Health Auto Export upload/heartbeat boundary. The runtime switch defaults off in code; the reviewed backend infrastructure explicitly enables it. Owner-bound hashed, scoped, revocable device credentials remain separate from human login; Settings allows the signed-in owner to create, rotate or revoke one only with an Entra owner token, while an owner session may read state and expiry. A new credential has a one-time no-store reveal. An 8-MiB upload is accepted only after the SQL raw inbox transaction commits; SQL outage/capacity returns 503 for the phone to retry. Exact sessions/checksums deduplicate and changed bytes conflict. The bounded inbox retains raw evidence without automatic deletion. No separate Blob/Queue/host or new resources are needed. Accepted and processed freshness stay distinct. The post-merge deployment succeeded, but upload-specific production authentication/processing, current credential status, private handoff and phone acceptance remain unverified; see the [Daily v182 delivery status](docs/reference/daily-v182/delivery-status.md).

Its device-capability lifecycle uses conditional issuance, terminal revocation and reserved revoke-before-issue rotation with the existing owner/device permissions. Rotation can temporarily deny both credentials, and a lost one-time reveal requires status review and rotation. The owner route exists only behind the explicit switch; no real credential or protected handoff has occurred, and ordinary Jarvis human authentication is unchanged.

The previous standalone host, Blob/Queue recovery proposal and deployment proposal remain superseded regression assets. The existing backend owns a bounded worker when explicitly enabled; it adds no host, queue, resource, permission or device. Reliable production availability, ingress quotas and scale-to-zero behavior remain unverified.

P12-12's inactive optional nutrition export is independent of ordinary ChatGPT logging. Only a trusted owner-confirmed exact period queues canonical SQL meal snapshots. Scoped revocable device capability is separate from login/upload credentials, and absent capability fails closed. Conditional claims, source revisions, tombstones, expiry-to-uncertain and identical ACK replay preserve retry safety without asserting exactly-once native Health effects. Corrections/deletions and partial writes never automatically requeue. Recovery records checked-in-Health evidence without issuing another write. Optional [phone guidance](docs/nutrition-export-shortcut.md) is not an installed/tested Shortcut; provisioning, activation and physical-iPhone/sample acceptance remain open. No native re-ingestion or routine auto-export.

P12-10's inactive Google services reuse existing owner/login/connections, enumerate visible calendars and retrieve Gmail through resumable bounded scans with independent coverage/freshness/errors. Verified source rules drive waiting states, Danish business days/holidays, physical deliveries and owner-local suppressions/revival; Received is terminal for display. The existing protected chat model/settings/identity supply tool-free extraction with strict local schema; missing/failed capability stays explicit, with no guessed classifier or action authority from mail. Incomplete scans and oversized sources never become current or erase healthy-source success. Mapped snapshots preserve last complete success after failure and distinguish capture from attempt; manual refresh never promises success before execution. No broader consent, new provider/model/key or activation; live source/model/phone and private migration gates remain open.

All migrated React/rich UI must use the Jarvis shell, shared components, themes/density/motion and native phone/workspace patterns, and preserve Daily capabilities/data semantics; no replacement shell/voice/window manager. Updated 20 October 2026 (P14-56 / #1156, the owner's ruling in docs/decisions.md): the Health area looks like the original Daily app, not like neutral Jarvis panels, so the earlier "no separate skin" rule no longer applies to Health. Health draws its navy glass look from documented Health-scoped tokens (a stylesheet of `--health-*` properties with a light counterpart at AA contrast); the rest of the application keeps the shared Jarvis styling and no Health token is used outside the Health area. The header carries the name of the current page as its headline ("Overview", "Workouts" and so on; since P14-58, replacing the greeting), with the Overview period dropdown at the end of the title row, and above it a small, quiet freshness status line (a status dot, the last-upload time and a "Last sync" table of sources, where a source without a time reads "Not received"). The [audit](docs/ui/p14-41/audit.md) maps components to served data; unserved data stays an explicit gap and earlier scope exclusions need their own ruling. Overview top cards (P14-46 / #1143, replacing the P14-41 Today cards): the Health Overview leads with Training (Gym, Run and Activity rings, Protein, Calories left, meals strip), Health (Sleep, Protein, protein across the day) and Body (Sessions, Calories, Duration, measurement trends of weight, fat % and muscle mass) cards, set by a period dropdown (Today, Yesterday, 1 week, 2 weeks, 1 month) at the end of the page title row that sets all three, from served workouts, steps, nutrition, sleep and metric reads. P14-45 adds owner-set weekly gym/run and daily step targets in Settings because the original task source is outside approved scope. P14-55 wires them into every Health view that compares against a target: the Overview Training card and Activity ring, the Health panel weekly progress, the Workouts rings and the Rules & sources editor, from one read per visit to the Health area, and a save updates the cards without a reload. A target that is not set reads "No target set" and nothing is defaulted; a targets read that is loading or has failed says so ("Loading target", "Targets unavailable"), never "No target set"; a served source with no data reads "Not recorded". A source that is not served reads as unavailable, never as empty or loading. The Overview tiles and cards keep a stable size from loading to loaded (P14-44), show the previous values while refreshing, and do not read again when the tab regains focus within a minute of the last successful read; the Refresh button always reads. P14-57 / #1157 carries the same Health look to Workouts, Nutrition, Body & sleep, Briefs, Data and Rules & sources (glass lead cards, panel cards for lists and records, dark tiles for figures, class colour always with its word and icon) with no change to what they show or read; the waiting lists and calendar agenda stay with P14-52. P14-58 / #1175 removes the row of section tabs from the Health page: the pages (Overview, Workouts, Nutrition, Body & sleep, Briefs, Data, Rules & sources) are listed in the shell sidebar when the owner selects Health in the rail, and on a phone under Health in the "Go to" sheet; the current page is marked, links, the back button and a reload keep the page, and no page, data or period behaviour changes. Generated views reuse safe trusted Jarvis theme context through the existing bridge without expanded permissions. Physical/browser mobile-first visual acceptance is required in #730/#731/#732/#726; persistence work does not start those blocked UI tasks.

[Approved scope](docs/daily-migration.md), updated by Dan on 15 October 2026, preserves existing Daily health, nutrition, workout/tracking and integration capabilities through one mobile-first Daily page and existing on-demand GenUI in the single assistant conversation: no widget, separate Workouts/Nutrition pages or four mandatory Status/Recomp/Review/Ready views. New P12-08/#723 coaching/recovery/recomp automation is excluded from planned scope and the combined release, not accepted as complete; this does not remove existing capabilities, measurements or retained records. Health sync, nutrition/Frida/history/plans, the scoped optional iPhone Shortcut and existing Google feeds retain their existing gates. Football preferences (#728) are closed as not planned and stay excluded. TickTick stays excluded and recurring notifications stay off. Reuse existing login/session/owner, shell and voice. Core P12-09/#724 API/tools work excludes new coaching and must not require #723 completion; this scope decision does not activate it. The Sites database-export/bundle-import approach is withdrawn; source-contract-first API/schema and historical ingestion/replay are specified in #1005. Original Daily continues ordinary authorized writes and remains canonical until source-compatible parity, real-device/provider, final-delta, rollback and cutover gates pass; no original source/schema/data deletion or rewrite.

P12-07 adds inactive nutrition services and typed handlers using verified source action semantics. Explicit exact-label/favourite intake needs no redundant confirmation; photo/portion estimates need acceptance of the displayed proposal from trusted Jarvis metadata, never model `userConfirmed`. Exact quantities outrank estimates; nullable unknowns and legacy confidence/capture vocabulary remain intact. Meals persist until soft deletion, with full paged history and revisioned corrections by exact owner-bound idempotency key beyond seven days. Occurrence defaults to trusted request time/Copenhagen date only when absent. Favourites accept one retained source key or confirmed definition; normalized-name reuse updates its ID. Plans resolve owned favourites server-side for one breakfast/lunch/dinner plus optional snacks (3–50 slots), snapshot and sum values without trusting model totals or logging food. Suggestions use authoritative time/remaining budgets and persistent dislikes. Frida pins release 10 / 5.5 with DTU/DOI attribution, supplied public bootstrap/DTO shapes, per-100-g scaling and honest null/provenance/subtotals. Final CI/independent review, live parity and P12-09 integration remain gated; this code activates nothing.

## App-wide visual consistency (18 October 2026; P14-01)

The web app keeps one existing Jarvis visual system across the shell, chat,
Settings, Factory, Daily, Proactive, dialogs and header popovers. Equivalent
controls and surfaces reuse the shared geometry, neutral structure, typography,
focus, theme and state treatments in `apps/web/src/styles.css`; route styles
may arrange workflow-specific content but do not create a second theme. This is
a presentation-only consistency pass: routes, data, and product behavior stay
unchanged. The requested project-policy success announcement is “Saved.”; its
standing applicability hint remains alongside the control.

## Chat and voice controls for proactive suggestions (#1207)

When proactive checks are enabled, chat and voice can read current findings and
the effective category/scope preferences. The findings tool remains read-only;
the preference tool changes one category or the personal/work scope only after a
matching direct owner request, using the same saved settings as Settings.
Findings, source text and per-item feedback cannot authorize a lasting change.
Capabilities are advertised only when their tools are active.

Preference requests may use natural Danish or English phrasing, such as
“Jeg vil ikke have rejseforslag længere”, “Slå vejrforslag fra” or
“Could you bring back travel suggestions, please?”. The current owner message
must explicitly request the exact category and direction or personal/work/all
scope. Negative preferences such as “I do not want travel suggestions” explicitly
request disabling that category. Bare agreement, ambiguity, quotations,
hypotheticals, disclaimed authorization (“do not change my preferences”) and
third-party instructions do not authorize a change. Uncertainty asks for
clarification without saving; success reports the effective persisted choices.

Category and scope choices constrain proactive generation and delivery across
enabled sources, not the owner's own prompts or requested work. Travel evidence
is excluded even when inferred from mail or calendar; personal-only and
work-only exclude unknown or mixed findings. In-flight checks stop after a
successful change, and queued findings are filtered without deleting the
underlying findings, tasks or reminders. Re-enable is explicit and does not
change pause, sources, budget or other preferences. These controls remain absent
when `JARVIS_PROACTIVE_ENABLED` is off.

## Daily Body & sleep (18 October 2026; P12-25)

The owner-only Daily page includes a read-only Body & sleep section when sleep
or both metric sources are exposed. Body browses every recorded metric through
a searchable catalogue and a native selector, with separate trends and daily
tables for each unit. Summary figures use only days with numeric observations;
missing days are not zeroes and partial reads do not establish complete coverage.
Sleep shows recorded nights, stages and nullable figures, with an inspectable
night detail. Totals without stages remain explicitly distinct from recorded
stages. The selected view, metric and night belong in the URL. This extends the
existing owner-authorised query workflow without new sources, writes, coaching,
recovery, recomp or TickTick integration; original Daily remains canonical.

## Daily Nutrition day, trend and library (18 October 2026; P12-24)

The owner can browse recorded meals by Copenhagen calendar day inside Daily,
compare null-aware totals with their own configured targets, follow energy and
macros over the selected period, and filter loaded favourites and meal plans.
Nutrition is read-only: logging and corrections stay in chat with the existing
native approval rules, and the original Daily remains canonical. The section
requires the meals source; Trend and Library appear only when their respective
sources are exposed. Unknown values never become zero, partial totals are lower
bounds, and days without meals remain gaps. The resting-burn-minus-deficit
comparison is explicitly a baseline before activity, not the full allowance.
No missing target is estimated. This adds no coaching, recovery, recomposition,
TickTick integration or permission changes.

## Daily page: Workouts (18 October 2026; P12-23)

The read-only Workouts section now appears when `daily.health.workouts` is
exposed. Over the shared period it shows loaded workout count, distinct recorded
workout dates, known duration, distance and active energy by unit, weekly or
monthly recorded-minute volume, and filterable/sortable history. Missing values
are not zero, unlike units are never added, and values without units remain
individual observations. Automatically read at most ten 500-row pages per
batch; a visible continuation loads another bounded batch. Incomplete totals
explicitly say “in the N loaded”; returned records never establish original
source completeness.

A URL-selected workout shows its recorded figures and, only when their sources
are exposed, bounded recorded detail and paged heart-rate samples. Browser Back,
reload and refresh retain the selected ID; returning to history restores focus
and scroll. Logging and corrections stay in chat. Original Daily remains
canonical; no coaching, recovery, recomp, TickTick or new writer is introduced.
Synthetic browser checks do not establish live-data or original-site acceptance.

## Daily overview and Briefs integration (18 October 2026; P12-26)

(Superseded by P14-46: the overview is now a period control and three cards,
Training, Health and Body, with no inventory list, notes, refresh button or
summary tiles.) The overview kept its “What Daily holds” inventory and added
independently loaded, section-linked summaries for exposed workout, nutrition,
body measurement, sleep and Briefs sources. Summaries reuse each section's date,
label and calculation helpers; unknown values stay unknown, while empty recent
periods say so explicitly. A failed source can be retried without hiding other
tiles. Briefs provides a dated history and readable, in-page detail using the
existing brief records. Shared disclosures keep source-coverage caveats
available without repeating long paragraphs. Daily reads, including capabilities
and nutrition targets, share a two-request concurrency bound and abort queued
work when its view is left. Original Daily remains canonical; no source,
permission, writer, coaching, recovery, recomp or TickTick behavior is added.
