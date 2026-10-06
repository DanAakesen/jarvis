# Design

The shared shell and voice-workspace structure were agreed with Dan on 4 October 2026. On 5 October Dan accepted the centred live 3D Jarvis stage; P8-28's production stage and P8-31's shared glass styling are merged, and P8-29's activity/playback wiring is implemented offline in draft PR #377. This direction supersedes the earlier aurora/voice-only-orb presentation on the Jarvis page. See [the complete UI discussion and wireframes](ui.md). Dan designs each page by giving an image generator the page's data points and actions from [PRODUCT.md](PRODUCT.md#page-requirements), then picks a direction. Record the chosen direction, references, and findings here. Requirements stay in PRODUCT.md; token values go in code.

## Design goals

- **Conversation first.** Jarvis's main page is the conversation (chat and voice) with an overview of what is happening now. It may be the only page Dan uses day to day; area pages hold the details.
- **One app, many areas.** One app shell with area navigation. The Software Factory is the first area; later areas (Banking, Health and fitness, Calendar) must fit without redesigning the shell.
- **Live and honest.** State changes appear without refresh. Stale or disconnected data is shown as such; progress uses observed milestones, not invented percentages.
- **Full transparency.** Every task shows what the agent did, what it used, and what it cost.
- **Headless Google tools (P7-22).** Google Calendar and Gmail actions are available through conversation only; P8 owns any future visual surface. A staged change must state exactly what will happen and how to confirm it; mail text is treated as untrusted content.

## Page set (phase 1)

| Page | Focus |
| --- | --- |
| Jarvis (main) | Conversation, voice state, "now" activity, sleep switch |
| Task view | Kanban columns by task state |
| Task detail | Header, complete paginated event timeline, sandbox sessions, usage, and timestamped writable-disk total/free readings with low-disk threshold |
| Release view | Horizontal git graph per project (branches as lines, commits as dots), releases, workflow runs, deployments |
| Projects | Project list and settings |
| Settings | Models, reasoning, voices, limits, credential status |
| Usage and cost | Usage by task, project, and period, plus today's UTC web-research call count |

The repository `PLAN.md` status workflow is GitHub metadata; it does not add a Jarvis UI control or visual state.

Events archived after 90 days load through the same task-detail timeline and pagination; the archive is invisible to the user.
The disk section uses recorded task events, not a live filesystem estimate; show
each reading's time and byte-derived human-readable values without implying that
the current filesystem state is available.

## Release view (P3-08)

The per-project release page follows the existing shell and neutral surface tokens.
The branch graph is a horizontally scrollable SVG; commit links expose state and
commit details on hover or keyboard focus, with 44 px hit targets. Marker shape
identifies record type and marker colour follows the linked record's status. A
refresh reloads persisted records and the on-demand GitHub graph; graph failures
leave release, run, and deployment records visible.

Inspected with scratch-only auth and mocked API responses in Chromium at 1280×1300
(light theme) and 390×844 (dark theme): release selection, refresh, keyboard
focus, 44 px commit targets, and zero page-width overflow. Screenshots:
[desktop](docs/ui/screenshots/p3-08-release-view-desktop.png) and
[phone](docs/ui/screenshots/p3-08-release-view-phone.png). Fixture content is
mocked; live Entra, Azure SQL, and GitHub data remain unverified.

## Task usage (P2-12)

The task detail route presents usage in a compact, semantic table rather than
summary tiles. Each sandbox session has its own minutes and estimated DKK; agent
turns and any provider-reported metrics remain separate rows, with no fabricated
cost for subscription use. The neutral shell carries explicit loading, empty,
failure/retry, and populated states. On narrow screens only the table scrolls
horizontally; the page itself stays within the viewport. Usage is part of the
task detail response and appears alongside the task metadata, disk readings, and
event timeline.

## Web research usage (P7-14)

The Usage page shows the recorded web-research calls for the current UTC day in a
compact list beside period-based usage. Successful, refused, and failed calls
count; an empty day and unavailable audit storage have distinct text states, and
no subscription price is inferred. Research results keep their source title, URL,
and backend receipt time in a typed result for the existing conversation and
workspace consumers; those consumer windows remain owned by P8.

## Interactions to design

- **Voice states:** listening, thinking, speaking, interrupted, reconnecting. Show what Jarvis heard. English uses Ryan HD and a British butler persona; action confirmations reflect backend tool results.
- **Confirmations (P7-02/P7-03):** while away, one Teams Adaptive Card headline names the action, body text gives its bounded summary, and ordinary supporting text states the five-minute expiry. Approve and Reject are explicit, distinct buttons; optional speech is a separate, non-autostarting audio attachment. While present, the Now panel lists expiring requests with the same summary and explicit Approve/Reject buttons. This queue appears only when requests are pending.
- **Language menu:** Danish ↔ English under the shared More menu's Language flyout, reachable from the composer and the voice bar (P8-36).
- **Task controls:** steer, pause, resume, cancel, recover after a crash, and continue after a completed turn's session expires. Show a clear pending state (for example, "Continuing…" while a fresh session starts).
- **Sleep switch:** the main page shows configured awake/asleep state (minimum replicas 1/0), pending and failure feedback, and explains a refusal while any task is Ready or Running. Settings links to the main-page control.
- **Live updates:** cards and timeline entries change state without layout jumps; a visible marker for a disconnected or stale event stream. Only committed task updates are presented as current.

## Accepted centred Jarvis stage (5 October 2026; P8-28 and P8-29)

Dan approved the corrected [centred prototype](docs/reference/ui-stage-prototype/README.md) and selected [orb/stage image 3](docs/ui/centred-stage/selected-orb-and-stage.png) plus [glass-window image 2](docs/ui/centred-stage/selected-glass-window.png). [Corrected desktop and phone captures](docs/ui/centred-stage/README.md) define centring and continuity; generated stills guide materials, not pixel-identical rendering or product data.

- **Only Jarvis:** mount the live room and large persistent orb only on the main typing/voice page. Other pages use the shared glass surfaces without 3D scenery. Keep the agreed shell geometry and real controls.
- **One room across modes/themes:** stable lower camera, symmetric broad architecture, three depth layers, opposing concentric mechanism motion, restrained atmosphere, real floor mirror and light cast from the orb onto room surfaces. Dark/light share this geometry; light mode re-lights the room.
- **Persistent identity:** subdued transparent cyan exterior and visible open amber core in typing, brighter awake during voice, dimmed in place on exit. Existing authenticated runtime activity and decoded playback audio drive the response; the orb never synthesizes a status. This supersedes the large voice orb growing from/collapsing into the composer and the older phone rule excluding a large dormant orb. The small composer control still explicitly starts voice; neither the visible stage nor waking it starts microphone capture.
- **Content-aware placement:** centre the orb/rear mechanisms/platform with no views. Only the orb glides/resizes left when wide-screen content appears, or docks below phone content. Camera, room and platform stay fixed; current tabs/window lifecycle, draft/focus restoration and default-off minimise preference remain.
- **Glass and readability:** selected image 2 defines restrained smoky translucent window chrome, generous spacing, sans typography and icons. Adapt it to each real view. Keep text legible over the moving/reflected room, accessible labels, focus and touch controls; avoid a solid brain, opaque orb backing and coarse crossing arcs.

P8-28 (#375) mounts the production Three.js scene lazily on the Jarvis route only. It uses live room geometry, independently rotating rear mechanisms, the persistent transparent orb with open amber core, an actual planar floor reflector, and orb-positioned lights; theme changes re-light the same scene. Existing HTML chat, workspace and voice controls remain above it. Reduced motion, hidden-tab pause, WebGL fallback/context recovery and teardown are handled by the scene owner.
P8-29 keeps that scene mounted while typing, connecting, ready, speaking and after voice ends. `JarvisStage` consumes the existing authenticated runtime activity and voice-active state; the existing decoded playback-level callback is passed through a React context to the stage without an extra DOM wrapper or per-audio-chunk page render. Playback uses response PCM from the existing audio adapter only. Readiness, explicit microphone enablement, backend sleep and the visual dormant state remain independent.
P8-31 (#376) applies the shared glass treatment to the existing shell, temporary workspace, contextual panel, Factory and Settings using the canonical tokens in `apps/web/src/styles.css`. Both appearances use translucent smoky surfaces and sans headings; existing page content, shell controls and workspace behavior remain in place. Regression tests calculate primary text, muted text, current-color icon and focus contrast on both translucent and muted surfaces over black and white backings. Conversation Markdown paragraphs use the primary text role rather than the generic muted paragraph color.

P8-29 browser evidence is in [`docs/ui/centred-stage/p8-29-browser/`](docs/ui/centred-stage/p8-29-browser/). Scratch-auth/API/WebSocket/SSE fixtures were inspected in Chromium at 1440×1000 and 390×844 in dark and light. The same one canvas remained before voice, during connecting/ready/playback response, and after voice; the explicit microphone action was the only step that called `getUserMedia`. A schema-valid activity fixture exercised the authenticated Now-event path. Reduced-motion preference matched, mobile had no horizontal overflow, text remained legible on the rendered scene/glass, and the completed run reported no page or shader errors. Existing glass contrast tests verify AA thresholds over black and white backdrops. Fixture audio and activity are not live provider evidence. P8-30's scratch fixture investigation and limits are recorded below. P8-32's implementation is merged in #387; P8-33 records the remaining device/performance evidence below. Detailed requirements and superseded experiments are in [ui.md](ui.md#accepted-centred-3d-stage--5-october-2026). Canonical token values remain in code, not this document.

P8-30's baseline Chromium instrumentation found voice activation wrapped in `document.startViewTransition`: the browser reported `ready` after about 348 ms and `finished` after about 1.2 s, with the whole Jarvis document—including the live WebGL canvas, transparent orb and real mirror—inside the snapshot. This is the identified flicker mechanism; the exact mirror flash was not independently established. Voice changes now commit directly without that snapshot. A separate workspace WAAPI FLIP attempt stayed pending and held a stale transform in the integrated browser, so it was removed rather than leaving windows stuck; the existing temporary-window controls and the stage's current-state orb spring remain. Scratch Chromium exercised empty, two-window and default-on-minimise desktop fixtures through entry, natural/manual/failure exit, interruption/reversal and repeated window operations, plus a single-window voice run at 390×844. Across 73 desktop and 32 phone CDP frames, the same canvas stayed mounted, voice UI state changed before the click returned, drafts and typing focus survived, the phone had no horizontal overflow, camera/platform coordinates remained fixed, the visible-window orb was left/smaller than the empty orb, reduced motion stayed usable, and fixture workspace acknowledgements were `applied: true`. The rendered stage probe showed the spring progressing, but the SwiftShader page produced only about two animation frames per 500 ms; CDP frames and state traces therefore do not establish no flicker or smooth normal-rate animation on hardware GPU. Live voice, physical audio and physical-device acceptance remain unverified.

P8-33 implementation is in draft PR #391. Quality begins with DPR capped at 1.0/reflection 512px on compact viewports and DPR 1.2/reflection 768px otherwise; successive tiers multiply DPR by 1.0/0.84/0.70, reflection scale by 1.0/0.75/0.5 (minimum 256px), and particle budget by 1.0/0.65/0.35. Devices reporting a maximum texture size below 4096 start one tier lower. The renderer samples frame intervals in one-second windows, steps down above 24ms, and steps up below 17ms only after three consecutive fast windows. Reduced motion performs a static update, hidden tabs pause, and route teardown disposes listeners/resources. On context loss, the same scene is paused and retained for browser restoration; creation failure or an unrestored context presents the CSS room/orb fallback while the HTML interface remains available. Rendering status does not overwrite voice status.

Scratch Chromium inspected dark/light stage captures at 390×844, short 844×390 landscape voice, 320×568 unavailable-WebGL fallback, and 390×844 context-loss fallback; the menu remained inside 390×844 and 320×568 bounds, and End voice remained in the landscape viewport. The same voice fixture stayed Ready through forced loss and restoration; unavailable WebGL retained chat and voice controls. Simulated 390×520 keyboard height and 1.5× page scaling kept the composer in bounds. Browser acceptance also exercised reduced motion, hide/resume and route teardown/re-entry; these are local fixtures, not live-provider integration. Software Chromium used ANGLE SwiftShader: after reaching quality tier 2 (backing scale ≈0.70), 90 RAF intervals averaged 327ms (p50 333ms, p95 350ms) at 1440×900 and 151ms (p50 150ms, p95 167ms) at 390×844. These are RAF cadence measurements, not GPU timer queries, and remain far below a smooth interaction target. Hardware-GPU/battery performance, physical phone/keyboard, Safari, live English/Danish provider audio and normal-rate flicker acceptance remain unverified. Captures are in [`docs/ui/screenshots/p8-33-*`](docs/ui/screenshots).

### Compact luminous-glass voice bar (P8-36)

Dan selected the last Luminous Glass component-family image ([handoff](https://github.com/DanAakesen/jarvis/blob/7f45b836a4635c9cf17d3d6a3e12a173995a0f80/docs/ui/chat-voice/README.md), published with draft PR #400). Voice controls are now one compact pill: **More** (•••) on the left, an understated state glyph with a readable runtime label, then **End voice** on the right. The large status disc, heading and duplicate microphone/screen/camera button group are removed. Mute/Unmute microphone, Look at screen and Look at camera move into the More menu. Disabled items explain why they are unavailable. Enable microphone stays a separate explicit action in the bar while voice is ready.

- **Shared More menu:** `ConversationMoreMenu` is used in the voice bar and the composer, replacing the DA/EN buttons. It has a globe Language row that opens a Danish/English flyout, with a check on the current choice. Arrow keys, Home/End, Right/Left (flyout), Tab, outside click and Escape work as expected. The first Escape closes the flyout, the next closes the menu, and only then does Escape end voice.
- **Truthful status:** the transport owns connecting, reconnecting, stopping and failure. Runtime thinking, tool and speaking activity cannot overwrite them. Listening appears only while the microphone is open. A routine detail line is visually hidden but still announced; a non-routine detail (for example, microphone denied) is shown.
- **Language during voice:** changing language mid-session updates chat and the next voice session. The bar then states which language the current session continues in, rather than implying a live switch.
- **Shared tokens:** `--glass-edge-cool`/`--glass-edge-warm` reuse the stage orb cyan and amber, and `--glass-refraction` draws the fine refracted edge for the shared `.luminous-glass` surface on smoky `--surface-translucent`. No second palette is introduced. Reduced motion stops the glyph and menu entry animations.
- **Placement:** the bar sits bottom centre (640px) without windows, and under the left orb column with windows. On phone it docks 12px from the edges and publishes its height for the existing dock. Flyouts stack above their menu at 700px and below.

Scratch Chromium fixtures (stubbed auth, voice client and API) covered 1440×900 dark and light, 390×844 dark and light, and 320×640 dark with reduced motion. Each had no horizontal overflow. Menus and flyouts stayed in the viewport, and every bar control and menu item measured at least 44px. The Escape order held (flyout, then menu, then end voice), reconnecting read "Reconnecting", and there were no console errors. Bar label contrast on the glass surface measured 18.65:1 (dark) and 14.97:1 (light). Fixing the overlay also removed the composer's backdrop filter during voice; that filter had made the composer the containing block for the fixed voice overlay. Captures are in [`docs/ui/screenshots/p8-36-*`](docs/ui/screenshots). They are compared with the handoff image by layout, not pixel-matched; the room renders through SwiftShader. Live voice, physical audio, devices, Safari and hardware-GPU rendering were not verified.

## Current implemented visual system (superseded on Jarvis by the built stage)

Dan's brief (4 October 2026): the UI should be stunning, with rich styling and motion, and feel alive when Jarvis is doing something, especially in voice mode. Three original animated concepts are in [docs/ui/concepts](docs/ui/concepts/README.md) with screenshots. Selected on autopilot for Dan's review: **Concept B, living aurora**, as the default dark appearance, and **Concept C, daylight studio**, as the light appearance. Concept A's precise ring and tick detail is not used.

- **Why B:** its slowly flowing light field and fluid orb make Jarvis feel alive, and the orb's shape follows the audio level and runtime state, so the motion carries information rather than decoration. The futuristic assistant identity is the product reason for its restrained glow and translucent windows.
- **Motion language:** state changes and Jarvis's actions animate in place (orb morph per state, shimmer on the window Jarvis is updating, rows slide into tables, windows carry across when voice starts and the orb grows from the composer's small orb). Motion is interruptible, uses transform and opacity, pauses in hidden tabs, and falls back to fades with readable state labels under reduced motion.
- **Light appearance (C):** warm neutral surfaces and editorial typography with an ink-particle orb, so light mode keeps the same states and motion vocabulary.
- **Constraints kept:** every orb state is also labelled in text; no gradient text, no emoji icons, no lone coloured borders; sample data appears in the concepts only.

Canonical colour, type, spacing, radius, surface, elevation and motion values belong in `apps/web/src/styles.css`. P8-20 (#282) applies Concept B/C across the current shell and pages: the dark aurora is CSS-only, and the orb follows typed runtime activity plus decoded playback PCM. P8-16 publishes actual chat/voice and tool-call states from the backend over the authenticated Now stream; the top bar and voice workspace consume these same transient events. Tool feedback exposes only the tool name and normalized outcome, never arguments, results, transcript text, or secrets. P8-21 refines the conversation and client workspace on those same tokens. Jarvis-updated windows receive a brief shimmer only for a published tool-call; thinking is not treated as a tool call. P8-14/P8-15 render typed generated views in temporary windows and the contextual panel using fixed React elements; no generated code executes. Hidden tabs pause animation; reduced motion keeps all content and state labels readable.

## Voice end (P8-12, decided 4 October 2026; implemented in P8-10)

Escape ends voice; when a menu or dialog is open, the first Escape closes it. P8-36 places the labelled **End voice** control at the right of the compact voice bar on every layout; the history below records the earlier placements. A visible **End voice** control (icon and label) sits directly below the orb on desktop. On phone with foreground content, it sits inside the bottom dock below the compact orb/state row with the mute and inspection actions; with no phone content, it sits below the central orb. P8-23 keeps these controls grouped beneath the orb in both layouts. P8-29's persistent orb supersedes the former collapse-back-to-composer transition; P8-30 preserves the end controls while voice mode changes directly. A natural spoken ending also ends voice; the small composer orb only starts voice.

## Foundation shell (P0-02)

The temporary shell uses system typography, neutral surfaces, one content column
and a compact Jarvis home link. It establishes responsive and keyboard behavior
without choosing the future product identity. Canonical styles live in
`apps/web/src/styles.css`. The signed-out page states that sign-in and deployment
are pending; no fake task data is shown. P1-07 shows unbuilt actions as explained,
disabled controls; see below. Unknown addresses have a return link. A skip link
and visible keyboard focus support navigation. Dan's page designs remain to be selected.

## Sign-in (P0-09)

The home page keeps the neutral, single-column shell and presents one Microsoft
sign-in action. Disable it with an explanation until the backend is configured;
show pending and refusal feedback beside the action. After `/me` verifies the
session, show the returned name as the page headline. Do not expose account
tokens, email addresses, or unverified identity claims in the interface.

## App shell (P1-07)

The shell keeps the neutral foundation and adds structure only, without a
visual direction. The header contains the Jarvis home link, area navigation
(Software Factory only) and a separate Settings entry. The current page is marked with a
surface fill and full outline, never a lone edge. Navigation appears only after
sign-in; the header wraps on narrow screens.

- **Database wake (P1-14):** one shared, polite status message in the top bar
  (P8-37) reads “Waking Jarvis…” while the backend reports a resume wait.
  Keep the current page and pending controls visible; do not infer this state
  from elapsed time or replace it with an invented progress indicator.

- **Main page:** P8-05 supersedes the initial wide-column layout with a
  conversation-first opening screen and a bottom-centred composer. "Now" and
  Backend remain available through the Activity and backend disclosure.
- **Screen sharing (P7-05):** keep the browser-selected share/stop control and
  live sharing status in the conversation workflow, with a separate, explicit
  Look at screen action for chat and voice. Keep the status and Stop action
  visible while sharing; reuse the shared button, focus, and narrow-screen
  wrapping conventions. This is the minimal P7 integration; P8-04 owns moving
  the confirmed share control into the shared shell's top bar.
  Scratch-auth Chromium checks at 390 and 1280 px exercised Share, the visible
  status/Stop action, a mocked chat inspection, and stream cleanup; neither
  viewport overflowed or reported console errors. Real display capture and the
  live backend/model remain unverified. P7-19 reuses these controls for shared-tab
  tasks: an action request captures one fresh frame and its selected window label;
  no new browser surface or persistent page content is introduced.
- **Camera (P7-08):** the shared top-bar control explicitly starts/stops browser
  camera permission and shows an On/Off label on desktop; the pressed surface and
  camera icon retain the state on the narrowest phones. Chat and voice expose a
  separate Look at camera request. Capture one frame only when asked; do not
  preview or stream images. Voice/session end, app teardown, and a five-minute
  timeout release the camera track. Desktop and phone screenshots are in
  `docs/ui/screenshots/p7-08-camera-*.png`; their browser camera is a fake device.
- **Unavailable features:** each data area says what it will show. Each action
  stays visible but disabled, and is linked to that explanation with
  `aria-describedby`. No sample messages, tasks or states are shown.
- **Activity panel:** Running tasks, Needs attention, Releases and deployments,
  Credential warnings, Alerts, and the current away/present mode, with an empty
  state for each activity group. Item titles open their
  task, release or project. Dismiss shows "Dismissing…", keeps the item and
  explains a failure, and returns focus to the Now heading after removal.
  The panel loads its backend snapshot, offers retry when unavailable, and
  labels reconnecting or unavailable live updates while keeping the last
  snapshot visible.
- **Away mode (P7-02):** The Now panel uses a labelled text status for present or
  away and retains the existing list hierarchy. Mode-change entries appear as
  ordinary activity rows; no color-only status or separate dashboard treatment.
  An explicit, visible-browser activity request—not passive feed refresh—returns
  Dan to present. Pending browser approvals use the panel's existing list and
  button styles, with visible pending, failure, and recovery feedback.
- **Alerts (P6-02):** Keep alerts in the existing Now activity panel as a
  separate, dismissible "Alerts" group; retain the condition title, timestamp,
  and task/release/project link where one exists. Budget alerts have no invented
  page or cost estimate. The group uses the shell's existing neutral list and
  responsive layout; no new palette or alert-only visual language is needed.
- **PC bridge browser toggle (P7-18):** Keep Chrome automation in the existing
  tray context menu as an explicit, persistent on/off check item. Its label
  states the current setting; the disabled default must be unmistakable. This is
  a native companion control, not a new web page or a browser-injected overlay.
- **Area pages:** the Software Factory has its own Tasks and Projects
  navigation. Unbuilt task and release pages explain what is unavailable.
  Project management is implemented below; record pages link back to their list.
- The P1-07 shell was checked in headless Chromium at 300, 390, 768 and 1280 px
  with a stubbed sign-in: no horizontal overflow, and controls are at least 44 px high.

## Settings (P1-11)

Keep the Settings route within the shell's neutral foundation. Use one page
headline and distinct form sections for Appearance, Jarvis, Voice, Coding agents, Global,
New projects, and Credentials. New-project controls use the documented defaults
and the same labelled field grid as the other sections. Two columns make related controls easy to scan on wide screens;
the form stacks on narrow screens. Save feedback stays beside the save action,
and loading, recovery, and unavailable actions remain explicit. Credentials show text status, expiry, and last-updated dates without secret
values; manual renewal and reseed controls remain disabled with an explanation.
The Voice section includes a labelled “Minimise all windows when starting voice”
checkbox, off by default, saved with the other settings.
The sleep control also remains disabled until its owning workflow exists; no
new visual direction or palette is introduced. Checked in Chromium at
390 and 1280 px with mock auth/settings: no horizontal overflow, controls at
least 44 px high, and save/disabled states visible. Live backend behavior remains
unverified.

P8-13 keeps the existing neutral visual foundation and adds light/dark palettes
through semantic CSS variables in `apps/web/src/styles.css`. The Appearance
section saves the selected mode immediately and applies only the accepted
settings response across the shared shell. Both modes retain visible focus and
high-contrast text, controls, feedback and surfaces. Custom and Jarvis-directed
variable editing stays disabled with an explanation until P8-17 implements the
validated settings/tool path using the token allowlist recorded in P8-18.
Checked in Chromium at 1440px and 390px with scratch auth/settings mocks: a
rejected update kept the current mode, retry and reload restored dark, and
there was no horizontal overflow. Muted-text contrast against the page/surface
was at least 6.25:1 in light mode and 8.99:1 in dark mode. Screenshots:
[desktop light](docs/ui/screenshots/p8-13-theme-settings-desktop-light.png),
[desktop dark](docs/ui/screenshots/p8-13-theme-settings-desktop-dark.png), and
[phone dark](docs/ui/screenshots/p8-13-theme-settings-phone-dark.png). Live
Entra and API/SQL behavior remain unverified.

## Projects (P1-10)

Keep the neutral foundation. The list uses one compact project panel per
repository, with its settings, running-task count, last-release availability,
and edit action grouped for scanning. Project settings use labelled form
sections; save, archive confirmation, loading, retry, conflict, and
success feedback stay close to the relevant actions. The Projects page has no
creation form; an empty list points users to New projects defaults in Settings.
Archive messaging explains
that history remains and the repository stays reserved. Counts refresh manually
until live updates exist; missing release data is stated, not fabricated.
Checked in Chromium 154 at 390 and 1280 px with scratch-only auth and API mocks:
list, create, update, and archive worked; neither width overflowed, controls
were at least 44 px high, and the project form stacked on mobile. Live Entra and
Azure SQL behavior remains unverified.
P3-11 rechecked Settings and Projects in Chromium 154 at 390 and 1280 px with
scratch-only auth and API mocks. New-project settings save, the Projects page has
no create link or form, and neither width overflows; controls remain at least
44 px high. Live Entra and Azure SQL behavior remains unverified.
P3-13 keeps installed repositories below managed projects in the same neutral
layout. Each unmanaged repository shows its owner/name, last push, and language
with a single **Manage with Jarvis** action; the existing toolbar refreshes both
projects and repositories. Chromium 154 checks at 390 and 1280 px exercised
management without a form and explicit refresh. Neither width overflowed, buttons
were 44 px high, and there were no browser errors. Live GitHub App, Entra, and
Azure SQL behavior remains unverified.

## Task view (P1-08)

Continue the neutral foundation and put the create action and filters before the
board. Keep the six task states as distinct columns; columns stack on narrow
screens, use two columns at tablet widths, and scroll horizontally on wide
screens. Cards group task facts as labelled details, with the state always
written as text. The create dialog uses labelled fields and keeps pending and
failure feedback beside its actions. A shared task-controls component offers
steer/pause while Running, resume while Paused, and cancel only after confirmation.
Pull request, checks, and usage remain
explicitly "Not reported" until the backend provides those values.

Checked in Chromium at 1280 and 390 px with scratch-only auth and API mocks:
task creation, SSE-driven card refresh, Escape dismissal with focus return, and
filters worked. Neither width overflowed the page, modal content fit on mobile,
and controls were at least 44 px high. Live Entra, Azure SQL, and deployed SSE
behavior remain unverified.

## Task detail (P1-09)

The page extends the neutral Factory layout with a labelled task summary, a compact
metadata grid, and separate sections for state-aware task actions, recorded disk readings, usage,
the originating conversation message, and the event timeline. The timeline remains chronological and shows all event
sources by default; users can filter by event type, expand bounded event payloads,
and request additional event pages. Its connection state stays visible beside the
filter. Controls display pending, success, and error feedback beside the action;
unavailable PR/artifact links have adjacent explanations rather than implying an
action is ready.

Needs attention presents a Recover action with a short explanation that recovery
starts a new sandbox from the task branch and saved history. The action keeps its
identity while pending and reports success or failure beside the control.

At narrow widths the metadata and controls stack into one column and timeline
payloads scroll within the page. Existing 44 px controls and focus styles are
reused. The usage section is an explicit P2-12 slot; disk values remain based on
recorded events rather than a live filesystem estimate.

## Usage and cost (P6-01)

The page uses the existing neutral app shell, with one page heading followed by
labelled period and grouping controls. Project, agent, and source groups contain
semantic tables of task-linked usage; rows show the source, metric, quantity,
available DKK, and last-used time. Codex/Copilot costs stay absent, while
sandbox, voice, and screen-frame amounts are labelled estimates. The page identifies partial
results when the 1,000-row API cap applies.

Controls stack on narrow screens and only the table region can scroll
horizontally. Loading, empty, and retryable failure states keep the selected
filters visible. Task links open the existing task-detail route.

Chromium inspection at 390 and 1280 px verified all three groupings, period
changes, task links, and retry/empty states with scratch-only auth and API mocks.
The page had no horizontal overflow, controls measured 44 px high, and the table
kept its own horizontal scrolling region. Live SQL and provider/voice data remain
unverified.

## Conversation history (P4-03)

After sign-in, the main page shows the persisted conversation in chronological
order across chat and voice sessions. Each message has its speaker and time;
tool calls show the tool and outcome, with a task link when available.
History loads in bounded pages, with older entries requested explicitly. Loading,
empty, and retryable failure states remain within the conversation panel. This is
an interim implementation, not a selected visual direction. Completed voice
sessions show their total voice minutes once beside the session's first message.

## Chat (P4-06)

The conversation keeps one message list, an inline DA/EN button group, and an
accessibly labelled text composer. Sending saves Dan's message first, then streams Jarvis's
reply in place. Pending state keeps the Send control disabled; failures remain
beside the composer, preserve partial text as interrupted, and warn that a task
action may have completed. A delivered reply is saved and history refreshes so
tool outcomes and valid task IDs appear as labelled chips and links. The list and
composer stay in the single-column conversation at mobile widths;
P8-21 applies the selected Concept B/C direction. P4-09 routes chat through Foundry
Invocations; live Azure streaming and tool-call linkage remain a post-merge check.

## Browser voice (P5-04)

P8-05 moves Start voice into the composer's small orb. Active sessions retain
Stop voice and Mute/Unmute while P8-12 supplies the final end-control placement.
Connection, microphone-off readiness, listening, thinking, speaking,
reconnecting, and failure feedback stays beside those controls.
Enable microphone is a separate explicit action after session setup and the
Danish no-model warm-up complete; reconnect also returns with capture off. Speaking
interrupts playback. Controls wrap on narrow screens and use the shared 44 px
button and visible-focus styles. Language selection and voice settings remain
with P5-05; no new visual direction is chosen. A headless Chromium check at
390 px and 1280 px verified the layout and start, speaking, interruption,
reconnect, mute, and stop states with mocked relay/audio APIs. Physical
microphone and speaker behavior remains unverified. Stop shows "Saving voice
session…" until the backend has recorded usage, then refreshes conversation
history.

## Conversation opening and input (P8-05)

The conversation fills the shared shell's main space using the P8-20
aurora/daylight visual system. A bounded,
independently scrolling transcript sits above the bottom-centred composer. New
replies stay visible without moving the composer; loading older history does not
jump to the latest reply. Activity and backend controls remain available under
an expandable disclosure rather than competing with the opening conversation.
Only the small, labelled input orb starts voice. Voice hides history and the
composer without discarding the draft or language; stop, natural end and failure
restore typing focus. The ready state says the microphone is off and offers a
separate Enable microphone action. P8-10 implements the desktop shell/fullscreen
transition, available-window carry-over and the selected end-control behavior;
P8-11 implements phone view switching on the existing client controller.

### Phone workspace (P8-11)

At 700px and below, one non-minimised view occupies the main space above the
floating composer. Named view buttons switch foreground; left/right swipes on
non-interactive content and Left/Right/Home/End on those buttons are alternatives.
Selection focuses the view title and announces the change. Background views
remain mounted, hidden and inert; desktop arrangements and geometry survive
viewport changes. Phone windows keep only minimise and close title actions.
Selection, announcements and lifecycle fallback use the combined page and
agent-created view collection; commands retain P8-15's required `commandId`.

During voice, the foreground window ends above the safe-area-aware orb dock;
P8-23 keeps the microphone and inspection actions in the orb's control group
with End voice. Long runtime status text stays within the dock without covering
those controls. The dock expands only while the microphone is ready and at
narrow widths where those controls wrap, keeping End voice above the workspace.
With no non-minimised content, the orb returns to the centre with its controls
below it. Typing never shows the large orb. Camera and sharing move behind a
labelled phone disclosure; Settings stays at the right of the one-line top bar.
Escape closes the disclosure and returns focus before ending voice.

Labelled local before/after screenshots are in `docs/ui/screenshots/p8-11-*`.
Touch-emulated Chromium verifies interactions, not physical-phone keyboards,
hardware audio or authenticated agent delivery.

### Voice workspace polish (P8-23)

Desktop voice shows only the carried workspace windows over the P8-20 aurora;
the Workspace heading, explanatory copy and header Arrange control are hidden.
Each window retains P8-22 chrome and its own Arrange menu. The large state
heading and one quieter detail line accompany the orb. State colour and motion
use the actual P5-04 status, and pulse scale uses decoded playback audio level;
tool-call styling is ready but no tool-call state is inferred before P8-16.
Mute, Look at screen and Look at camera are named icon buttons with tooltips,
grouped below the orb with End voice, not in the top-right corner.

Voice entry grows the composer's small orb while carried windows glide right;
exit reverses the named workspace transition. The transition remains
interruptible. The existing aurora pauses with a hidden document and is static
under reduced motion; labels and controls remain usable without animation. The
same Concept C daylight treatment applies in light appearance. P8-11 continues
to own phone view selection and dock geometry, with the voice actions grouped
below its orb.

Desktop listening, thinking and speaking captures in dark and light, plus
speaking captures on phone in both appearances, are in
`docs/ui/screenshots/p8-23-*`. Compare with [Concept B desktop](docs/ui/concepts/screenshots/concept-b-voice-speaking-desktop.png),
[Concept C desktop](docs/ui/concepts/screenshots/concept-c-voice-speaking-desktop.png),
[Concept B phone](docs/ui/concepts/screenshots/concept-b-voice-speaking-phone.png)
and [Concept C phone](docs/ui/concepts/screenshots/concept-c-voice-speaking-phone.png).
The [dark desktop](docs/ui/screenshots/p8-23-dark-desktop-comparison.png),
[light desktop](docs/ui/screenshots/p8-23-light-desktop-comparison.png),
[dark phone](docs/ui/screenshots/p8-23-dark-phone-comparison.png) and
[light phone](docs/ui/screenshots/p8-23-light-phone-comparison.png) comparison
images place each reference beside its speaking capture.
The captures use a labelled local fixture with simulated state and sample
windows; they are not evidence of live authentication, hardware audio/camera,
generated-window delivery, or P8-16 tool activity.

### Concept polish (P8-21)

The opening is a calm greeting, not an empty card. A floating, translucent
composer sits at the bottom centre: small voice-start orb on the left,
auto-growing frameless input, compact DA/EN buttons and an icon-only Send
action. The input retains its accessible label and Enter/Shift+Enter behavior.
Screen sharing, Now and backend controls sit under the activity disclosure;
frame-inspection actions appear when a camera or screen is shared.
P8-32 renders the greeting as one sans heading with ordinary supporting copy
(not a subtitle) on smoky-light glass, placed clear of the orb rings; the
activity disclosure sits directly below/right of the greeting, clear of the
rings, on its own readable glass surface. Jarvis replies use the semantic
translucent surface so their text remains readable over the re-lit room.

Dan's messages sit on a quiet surface on the right; Jarvis's replies stay left
aligned on translucent glass. There are no message dividers. Channel, language
and relative time appear on hover or keyboard focus, and remain visible on touch
devices and under reduced motion. The exact timestamp remains available on the
time element.
Messages enter with a short opacity/translation transition; streaming keeps a
live caret beside readable text. Only a published tool-call state gets the
running-tool shimmer; thinking is not treated as a tool call. Running Now tasks
use a restrained sheen, while completed outcomes stay static.

P8-24 keeps the established body typography for Jarvis's safe Markdown replies;
inline and fenced code use the shared monospace face and theme-specific code
surface, without decorative borders. Dan's messages remain plain text. While a
reply streams, an unmatched `**` is temporarily closed for rendering so an open
bold span does not flash as literal Markdown; persisted text is unchanged.

P8-26 adds a local FIFO queue. P8-35 reserves Ctrl+Enter for that queue and
keeps its Dan bubbles, “Queued · Danish/English” label, labelled 44px remove
control and polite atomic count announcement. Waiting submissions start in
order after success or error. Starting a queued turn keeps its bubble visible
as “Sending” until the saved user message arrives. Later drafts survive
acceptance, success and interruption; a failed unsaved submission keeps its
draft, while uncertain delivery warns against resending. The queue is local to
the mounted conversation and is not retained across navigation/reload.

P8-35 makes Send/Enter steer the active turn instead of offering a Stop button.
During model text generation the backend aborts that model round, saves its
partial assistant reply as interrupted, then starts a continuation using the
new Dan message. During tool execution the tool is allowed to finish; the hosted
agent collects new Dan messages at the next model-round boundary and continues
with them, retaining existing confirmation gates. Per-message language applies
to the next submission. Send, language, and voice entry remain available while
Jarvis replies; entering voice does not cancel the chat stream, which continues
into conversation history. Ctrl+Enter is the explicit queue gesture. The
thinking status remains labelled and reduced-motion-safe, and streamed text
uses the open transcript surface with a live caret.

P8-35 Chromium evidence at 1440×900 and 390×844 in both themes:
`docs/ui/screenshots/p8-35-progress-{dark,light}-{desktop,phone}.png`.
The in-progress captures show a draft, enabled Send/language/voice controls,
and no Stop button. Chromium verified the streamed state, Ctrl+Enter queueing,
language switching during streaming, enabled controls, no horizontal overflow
and no page exceptions. Focused component/API tests cover steering and voice
entry during streaming. Captures use scratch-only auth/API mocks, not live
Foundry evidence.

The P8-26 screenshots remain historical evidence for that queue implementation:
`docs/ui/screenshots/p8-26-queued-{dark,light}-{desktop,phone}.png`.
The captures show two queued messages at 1440×900 and 390×844. Queue removal,
double Enter, per-message language, Stop/next and error/next were exercised
before P8-35 replaced Stop with steering. Queue bubbles reuse the existing
short entrance transition, static under reduced motion; controls do not wait for
animation.
Local Chromium evidence at 1440×900 and 390×844 in both themes:
`docs/ui/screenshots/p8-25-{before,after,streaming,complete}-{dark,light}-{desktop,phone}.png`.
The sequence is load → send “hi” → saved user message and thinking status →
type “Next message” with Send disabled → first Markdown delta → saved reply and
stale history refresh, with both messages and the next draft retained.
Screenshots label mocked auth/SSE; they do not verify live Foundry latency.

P8-26 Chromium evidence at 1440×900 and 390×844 in both themes:
`docs/ui/screenshots/p8-26-queued-{dark,light}-{desktop,phone}.png`.
The captures show a streaming reply with two queued messages. Browser checks
exercised queue removal by keyboard, double Enter, per-message language,
Stop/next and error/next, with no horizontal overflow or page exceptions.
Queue bubbles reuse the existing short entrance transition, static under
reduced motion; controls do not wait for animation. The fixture label identifies
scratch-only auth and streamed API mocks, not a live backend/Foundry check.

Window titles are drag handles; right/bottom edges and the corner resize. Each
window keeps minimise, maximise and close in its title actions, with a 44px
ellipsis disclosure for keyboard Arrange. The workspace header retains the
shared tile/layer control. Open a window's overflow, focus **Move** or **Resize**,
then use arrow keys; Shift makes larger steps in a layered desktop layout. In
tiles, Move changes order and Resize changes the tile span. On narrow screens
width stays full-screen. Escape closes Arrange and returns focus to its trigger.
Window entry, focus, minimise and restore reuse the shared motion tokens without
waiting for animation to update state; reduced motion removes displacement and
shimmer.

The top bar shows **Jarvis** once on the home route. Deeper routes show the area
and the most specific matching page, such as **Jarvis / Software Factory /
Tasks**. Phone layouts continue to hide the secondary breadcrumb to protect the
single-line bar. The local-fixture footer is added only by screenshot capture;
it is not part of the production shell or bundle.

Local screenshot fixtures are in `docs/ui/screenshots/p8-21-*` and
`docs/ui/screenshots/p8-22-*`; they are not production conversations or proof
of live agent-directed windows. P8-22 phone captures show the typing shell and
workspace, not the phone voice layout owned by P8-11.

## Next-generation shared shell (structure agreed; P8-04 implemented)

[ui.md](ui.md) records the confirmed structure, open questions, feature-placement
proposals and eight static wireframes. P8-04 routes the existing pages through a
thin left icon rail, expandable area navigation, a top bar and a
toggleable contextual panel. P8-04's former bottom status bar was removed in P8-37 (#398). The top bar spans edge to edge above the shell;
its height matches the area rail's width, and the rail begins beneath it.
Settings stays at the top-right. Camera is a working toggle with an accessible
pressed state, visible desktop On/Off label, and a narrow-phone state indicator;
the browser prompts for camera permission only after the toggle is selected.
Screen share remains disabled in the top bar because its active control remains
in the conversation workflow. The top bar remains one line at phone and desktop
widths. Other suggested top-bar controls remain out of scope.

Database-wake status, when configured, is a compact top-bar status pill (P8-37 removed the former bottom bar). The
context panel has an honest empty state until P8-08 supplies contextual content.
The existing neutral theme remains; the specific placement and responsive
proportions above are confirmed while other shell styling and the contents of
these bars and panels remain open.

Voice hides the shell, composer, and history immediately, using a full-page
background and a state-driven orb: centred alone, left of content windows on
desktop, and bottom-docked on phone. P8-10 carries available windows across
voice transitions; generated views and Jarvis-directed commands are supplied by
P8-14/P8-15. Windows can tile, overlap, minimise into tabs and be restored.

Existing windows carry between modes by default. The optional minimise-on-voice
setting defaults off; when enabled, voice begins with only the orb and windows
remain docked on return to typing. Otherwise the earlier shell layout returns.
Generated views are temporary; theme values persist. P8-14 reuses the existing
Now list treatment for its first signed-in fixture. Values render as React text
and allowlisted links; view-provided markup is not interpreted. Small-orb input
controls start voice explicitly. The minimise-on-voice preference persists with
the account through P8-17, with a device-local cache for immediate startup.
Concept B/C's translucent surfaces are the selected treatment; the earlier white
wireframes remain structural references only.

## Temporary workspace composition (P8-06)

P7-27 reuses these controls and states for Jev-directed chat/voice commands, without new chrome or styling. “Make the window bigger” uses a bounded large resize in layered mode and expands the existing row/column spans in tiled mode; command application never waits for animation. Context-panel opening preserves existing content and is idempotent. Agent-closed windows can be restored from a bounded in-memory cache, including after a contradicted voice partial; manual closes retain their discard behavior.

The main workspace accepts an in-memory set of typed views. Desktop opens in a
tiled arrangement and can switch to overlapping layers; using a layered window
raises it, with explicit order controls as a keyboard alternative. Move and resize
work with pointer gestures or focused arrow-key controls. At widths up to 900px,
both arrangements reflow to a single-column view stack to keep content within the
viewport; P8-11 uses one foreground view instead at 700px and below.

Each view presents ready, empty, loading, error, or interrupted content. Retry and
continue feedback stays with the view, including partial interrupted content.
Window geometry, order, and the open view set remain in memory only. The host is
currently empty until P8-14 provides generated-view data and P8-15 supplies
Jarvis-directed workspace commands; those data and agent-control contracts are
not part of P8-06. These structural choices reuse the shared Concept B/C surfaces
and motion tokens in P8-20. Desktop voice-layout transitions are implemented in
P8-10; phone view switching is implemented in P8-11.

## Generated image delivery (P7-15)

Jarvis opens a successfully generated image as the existing typed image view in
the active workspace; the corresponding successful tool record also shows an
owner-authorized preview in conversation history. The view and window
arrangement are temporary, while the source image is saved as a private
workspace artifact. Loading, failure, cancellation, and Codex usage-limit
feedback stay truthful; a saved artifact is not described as visible unless the
workspace command succeeds. The Usage page's UTC daily tool counts show recorded
invocations, not remaining ChatGPT quota or an image cost. Video is deferred
and is not shown as an enabled action. Artifact retention has not been decided.

## Window lifecycle and tabs (P8-07)

Each temporary window has a title bar with labelled minimise, maximise, and
close icon actions. Minimise hides the mounted view and adds a compact,
animated tab to the active workspace; restoring from the tab returns focus to
the view title. The in-memory view and its local component state remain intact,
and neither minimising nor closing saves or deletes source data. Maximise fills
the workspace canvas and toggling it off returns to the existing arrangement.

Workspace and per-window arrangement controls live behind an **Arrange**
disclosure so the canvas and title bar stay compact; keyboard move and resize
controls remain available there. The shell exposes the typed workspace command
controller to page consumers; authenticated Jarvis delivery remains P8-15.
Tab motion uses the P8-20 tokens and becomes static under reduced motion.

## Accepted capability surfaces

Editable personality lives in **Settings → Jarvis → Personality**, reached
through the agreed top-right Settings entry. P8-19 implements Tone, Response
style, Custom instructions, Save settings, and Reset personality using the
existing Settings form and theme tokens. Guidance explains that changes apply to
new sessions and active sessions keep their current settings; visual themes,
model choice, and voice identity remain separate. P7-16 owns validated
persistence and session application.

Research results use source links in the existing dynamic workspace. Generated
images use the fixed image renderer there and an inline chat-history preview;
both show honest loading, failure, and interrupted states. Video generation is
deferred and is not presented as an available action.
Memory can be queried, corrected and forgotten through registered tools; a
dedicated memory-management screen has not been selected. Reuse the agreed shell
and view contracts rather than adding permanent rail/top-bar controls for each
new capability.

## Approved Software Factory composition — 5 October 2026

Dan approved [the combined Task Lens mockup](docs/ui/software-factory/task-lens-release-bar.png): a dark smoky-glass six-state board, compact project release/commit bar beneath filters, and a closable selected-task details panel on the right. Use the selected shared-glass direction in #364, canonical tokens, readable body typography, restrained full-outline selection, and thin existing shell; retain navigation and workspace tabs even though the selected frame omits their expanded state. Match the composition rather than copying illustrative data. Adapt the existing light appearance and narrow-screen layout without clipping controls. The room and large orb stay on Jarvis. [Requirements and validation](docs/ui/software-factory/README.md) belong to P8-34 (#369).

### P8-34 implementation evidence

The implementation uses existing authenticated task, project, release, conversation and contextual-panel paths. The release bar is scoped to the applied project filter and hides stale data from the previous project during a switch. Task selection keeps the board route, filters and scroll position; the close action returns focus to the selecting card. Fixture Chromium captures cover the open-pane composition at 1440×1000 and 390×844 in dark and light; the browser run also checked keyboard selection/close, state-valid Running controls, release-data isolation, reduced motion and horizontal overflow. The screenshots in `docs/ui/screenshots/p8-34-fixture-*` contain fixture data, not live product evidence. Live Entra/backend/GitHub/provider integration, physical-phone rendering and hardware-GPU behavior remain unverified.

## Accepted luminous-glass conversation refinement — 6 October 2026

The existing shared glass implementation remains the foundation. Dan selected [this Luminous Glass reference](docs/ui/chat-voice/README.md) for a more compact voice status bar, matching chat input and readable message window. Implement the exact header removals: no separator above chat messages and no small orb/Jarvis title at top-left; retain top-right window controls, drag region, input voice-start orb. The later Architectural Glass decision below additionally removes both message-avatar icons while preserving accessible author roles.

Use a shared More menu with an icon plus Language row and Danish/English flyout, not a large DA/EN switch. Do not duplicate capture controls inside the voice bar. Extend canonical material/type tokens, with adequate frosted opacity over bright room motion, dark/light contrast and responsive touch targets. Preserve existing runtime/window/conversation contracts, including #371 steering and Ctrl+Enter queueing. [P8-36 (#397)](https://github.com/DanAakesen/jarvis/issues/397); [P8-37 (#398)](https://github.com/DanAakesen/jarvis/issues/398); [P8-38 (#399)](https://github.com/DanAakesen/jarvis/issues/399) were the initial allocations; #397 is now merged in PR #403, and #398 owns the remaining combined implementation. #399 is superseded. The subsequent Architectural Glass selection below supersedes the bottom-bar and message-avatar requirements; the other agreed shell slots and Jarvis-only room scope stand.

## Selected Architectural Glass shell and avatar-free messages — 6 October 2026

Dan selected the last/third shell styling image. [The refined reference](docs/ui/shell-styling/README.md#refined-approved-reference) defines the graphite/smoked-glass framing, dimensional depth, restrained cyan/amber refraction and readable hierarchy. Keep the agreed top bar, rail, left navigation, main tabs/workspace, right contextual panel and top-right Settings. Remove the separate bottom app-shell bar and its reserved layout space; move existing database-waking feedback into compact top-bar status. Chat input and voice-session controls remain.

Remove human and Jarvis avatar icons from the message content as well as the previously removed top-left header orb/title and separator. Preserve author roles via alignment/text and accessible semantics; keep the scene orb and small input voice-start orb. P8-37 (#398) now implements the shell, composer and message-window changes together; former P8-38 (#399) and P8-39 (#401) are retired separate allocations. Reuse P8-36 material/menu work and existing theme, runtime and window contracts. P8-37 implements these requirements; see the implementation note below.

## Unified implementation scope — 6 October 2026

Dan requested one issue and one implementation PR for the shell, input and messages. P8-37 (#398) absorbs all acceptance criteria and retained prerequisites of former P8-38 (#399) and P8-39 (#401). The selected visuals and behavior are unchanged. P8-36 (#397) is the completed voice-bar/shared-menu prerequisite, merged in PR #403; reuse its existing components and tokens. Closing the superseded issues does not mean those surfaces have been implemented. CI runs for the combined PR and its updates.

### P8-37 implementation note

- **Shell:** the footer row is removed from the grid (`--rail-size` + one content row; rail spans `2 / -1`). Selected rail, sidebar, Settings and phone view-switcher items use `--glass-selected` with `--glass-selected-glow` — a complete illuminated surface and ring, not an edge accent. Rail, sidebar and context pane gain a faint `--glass-shell-sheen` over the existing translucent surfaces.
- **Status:** `DatabaseWakeStatus` renders a compact `.topbar-status` pill first in the top-bar actions; phones show the pulsing mark with the label kept for assistive technology and as a tooltip. Reduced motion stops the pulse.
- **Composer:** one `luminous-glass` pill (radius 30px) holding orb │ paperclip │ multiline text │ More │ Send (paper-plane). Neutral `--rule` hairline dividers separate groups. The paperclip reuses `ConversationMoreMenu` with no Language row for the existing screen/camera visual-context actions.
- **Message window:** `luminous-glass` window up to `min(40vh, 440px)` tall above the composer (maximise fills the page column). No title, orb, separator or avatars. Dan's messages sit right with a warm `--message-dan-tint`; Jarvis replies sit left with the existing `--surface-translucent` plus `--message-jarvis-tint`; both are limited to `min(88%, 62ch)`. Author names remain in visually hidden text and `data-speaker`.
- **Evidence:** fixture Chromium/SwiftShader captures `docs/ui/screenshots/p8-37-*` at 1440×1000 and 390×844, dark/light. They use scratch auth/API fixtures, not live provider, physical-device or hardware-GPU evidence.

## Voice status beneath the orb and stronger live behavior — 6 October 2026

**Confirmed by Dan; planned in [#417](https://github.com/DanAakesen/jarvis/issues/417), P8-40.** State feedback moves out of the compact control bar to readable HTML beneath the orb. It follows the orb when centred, moved left of windows or docked on phones. Keep useful recovery feedback and an accessible text alternative even without WebGL. More and End voice retain clear space; current/next-session language explanation moves into the Language flyout. This supersedes the in-bar state placement in P8-36's reference.

Start voice includes microphone activation, subject to native permission and real session readiness; remove the normal Enable microphone button. Earlier descriptions of microphone-off readiness document the existing implementation and are superseded requirements. Keep explicit user start, mute, cancellation, truthful recovery and resource cleanup; visual awakening alone never requests capture.

Reuse the approved cyan exterior, transparent open amber core, live room and mirror. Make wake-up a pronounced staged nonlinear sequence: core ignition, energy spreading through the shell, a controlled expansion/light surge, then active settling. Keep action handling immediate and transitions interruptible. Use attentive listening breath/ripples, inward/core-flow thinking, directed real tool-work movement and a strong speech envelope synchronized with actual playback. These are state cues rather than arbitrary decoration. Room/reflection lighting follows orb light; room/camera/platform do not jump. Keep state legible at reduced motion and lower rendering quality. Validate actual motion as well as desktop/phone composition; a separate prototype is not a prerequisite.
