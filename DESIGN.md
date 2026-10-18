# Design

## Icon-only header (P9-119)

Settings is a gear only at every width, including phones, with its Settings
accessible name, native tooltip, active-route state and 44px target. Presence
uses one person, moon or walking-person icon for Present, Away or On the move;
the existing green/yellow/blue tokens remain, with darker same-hue strokes in
light mode for contrast. No top-bar presence dot or visible mode label.
Accessible names and tooltips identify the mode; switching behaviour is unchanged.

The header background-work cluster has non-zero running, done, failed and
attention icon/count pairs. Spinner, check, warning-triangle and bell shapes
accompany accent, green, red and the existing warning token. Every pair has
its own accessible count and tooltip. The yellow attention pair counts only
non-dismissed attention, credential and alert feed items plus pending browser
confirmations; its own popover keeps links, times, dismissal and approval
actions. Running, releases/deployments and away-mode changes do not count as
attention. Dismissed and cancelled jobs do not count. With no counts, hide the
whole cluster, including idle; the background-work popover remains available
whenever a background-work pair is present. Only the running icon rotates, and
neither OS nor app reduced-motion mode allows that animation. Preserve the
background-work popover contents, delivery and dismissal.

The summary remains in the header on phones instead of inside the windows
sheet; the separate windows button counts windows only. Keep the existing
individual desktop job tabs and phone window sheet. Settings, presence and
the summary have 44px targets, shared borderless hover/pressed surfaces and
visible keyboard focus. Stack each phone count below its icon to fit the
single-row header at 320px without changing the composer or voice orb.

Local Chromium fixture captures and interaction measurements are in
`docs/ui/screenshots/p9-119/`: 320×568, 390×844 and 1440×900 in both themes,
all three modes, two running/one done/three failed jobs, and idle after
dismissal, with a separate restored window. OS and app reduced motion,
keyboard focus/return, active Settings and phone-sheet independence were
checked. Authentication and API data are synthetic; the room uses its WebGL
fallback. This is not live-provider, hardware-GPU or physical-device evidence;
Dan's visual acceptance remains pending.

## Presence colours, Routines and composer clearance (17 October 2026; P9-102, P9-103, P9-98)

Presence uses green, yellow and blue in both themes. P9-119 supersedes the
top-bar dot and label below; menu/settings dots retain their shape and glow.
Light dots gain a ring of their own hue so the
yellow stays visible on pale glass, and the orb keeps its own colour. Settings
says Routines. Phone pages end above the composer however tall its draft is, and
Save settings stays a plain end-of-page row: no sticky bar or new chrome.

Inspected in headless Chrome with stubbed sign-in and a fake backend at 320×700
and 390×844 (touch) and 1440×900, in light and dark. The presence menu, mode
cards and per-mode instruction labels show the three colours with their labels
in every case, and the closed phone chip shows the dot alone, so colour is its
only visible cue. At 320×700 with a six-line draft a touch tap now reaches Save
and saves, with 16px between Save and the composer; before, the tap opened the
composer's More options menu. The default composer keeps its 22px gap, and
desktop is unchanged. In light, the "Saved." message sits outside any glass
panel and is hard to read over the 3D stage; that predates this change. Not
covered: a physical iPhone/Safari, the voice layout, attachments and real chat
streaming.

## Voice proposal summaries (16 October 2026; P11-07)

Reuse the existing text/list window for readable dates and staged proposals.
Focus an existing matching view rather than reconstructing it as a chart.
The automatic voice preview uses the actual returned summary, not invented
event details or confirmation codes. No new renderer, chrome, animation or
approval control is introduced.

## Mobile composer focus hotfix (16 October 2026)

Reuse the current phone dock and glass chat, with both halves attached to the
same visible viewport. A saved desktop rectangle must not add a second,
independently measured fixed composer on phones. Move/resize chrome belongs to
desktop; phone chat retains Show/Hide, Minimise and Close. Suspend, never delete
or rewrite, desktop geometry while the phone layout is active. No new shell,
keyboard-height estimate, focus-scroll workaround or keyboard-fit animation.
This narrows the earlier manual-placement descriptions to desktop. Controlled
Chromium layout evidence does not establish physical iPhone/Safari acceptance.

## Chat records and keyboard geometry (16 October 2026; local candidate)

Keep the current glass chat, compact message type and readable composer.
Prefer one labelled list record per booking/event, blank lines between
records, and explicit source-backed date/time meaning. The calendar/agent
lane owns the matching normal-chat instruction; this frontend has no live
agent visual readback. Existing well-formed GFM tables retain native table
headers in a focusable horizontal scroll region, with neutral structural
rules and the existing focus ring. Table-bearing replies can use the available
transcript width; prose keeps its compact measure. Narrow tables scroll
within the message rather than widening the page. No raw HTML or guessed repair of flattened
pipe text is introduced.

Both phone chat halves derive their top/height from the same visual viewport.
Do not animate keyboard fitting, subtract a second keyboard gap from a
shrinking fixed viewport, or use page-scroll/delay hacks. Existing manual
placement, seam and no-keyboard safe-area spacing remain. Content following
runs before paint so layout-generated scroll events cannot mistake streamed
growth for reader intent. Latest-following survives transcript resizing;
reading older history does not jump to bottom during further streamed growth.
Browser emulation and synthetic viewport events are not physical Safari
acceptance.

## Shared control geometry (16 October 2026; local candidate)

Dan's three supplied screenshots identify inconsistent Refresh/Create action
shapes, boxed release icons and repeated bevelled job tabs. Preserve Jarvis's
existing glass room, typography, palette and layout; this is an app-wide control
correction, not a new theme or a Factory-only treatment. This contract supersedes
older capsule-action and refracted-control-rim descriptions below.

Actions, icon buttons, navigation tabs, filters, segmented choices and form
fields use the existing control radius from `apps/web/src/styles.css`.
Pills identify compact noninteractive status; genuine switch tracks, orb/media
geometry and window/panel surfaces retain their semantic shapes. Primary actions
keep the existing primary fill. Quiet actions use borderless surfaces with
hover/pressed feedback. Selected choices retain their existing surface/text
roles, stronger weight and accessible state. No decorative coloured boxes,
bevels, inset-shadow borders or glowing control outlines, including on hover.
Neutral field boundaries and real panel/list structure remain; keyboard focus
uses the existing visible focus outline rather than a permanent accent rim.
Within action groups, markup order is keyboard and visual order: place the
primary action last. CSS does not reorder action groups.

Keep compact desktop controls where useful and at least 44px touch targets.
Segmented groups wrap at narrow widths; scrolling filter rows retain keyboard
focus and readable labels. Reuse current motion timing and reduced-motion
handling; do not animate geometry merely to make controls look busy.
Project completion policy uses a labelled, two-choice radio group with both
outcomes explained in plain language. Its checked value changes only after the
existing project PATCH confirms the choice; pending state disables both choices,
and failures keep the prior choice with an inline retry. Use the existing
selected surface and visible focus outline, never a coloured border as the sole
selection cue.
`docs/agent-context.md` and the project-local product-ui skill carry this rule
for future work. Header/job and mobile chat corrections have separate owners;
this candidate does not imply their changes are integrated or released.

## Button system (P14-03; 18 October 2026)

`apps/web/src/styles.css` owns the shared button hierarchy. `.primary-button`
keeps the existing primary fill with a restrained shadow; `.secondary-button`
uses a clearly surfaced neutral tone; `.ghost-button` stays quiet until hover
or press; `.danger-button` is a low-emphasis destructive action, and
`.danger-button--filled` marks a confirmed destructive action. Existing
specialized and icon button classes keep their workflow role while sharing the
same control radius, feedback and visible focus.

Text actions are 44px high by default. Compact controls are 36px only on fine
pointers and return to at least 44px on coarse pointers. Icon-only actions stay
square and retain their accessible names. Leading/trailing SVGs align with
their label in the shared gap. Busy actions set `aria-busy`, stay disabled and
overlay the shared inline `Loader` on an opacity-hidden label so the button
keeps its measured width and accessible name.

`.button-group` and the existing `.settings-actions`, `.task-dialog-actions`
and `.action-row` patterns use tokenized gaps, wrap without clipping, and place
the primary action last. Form and dialog groups stack full-width on narrow
phones. Buttons own no outer spacing: the parent action row or section owns
that spacing. The primary button's previous 32px top margin is removed; the
deployment form preserves that separation in its grid row-gap instead.

## Gated push notifications (17 October 2026; P13-02)

The Notifications Settings section is its own collapsed-by-default section and
appears only when the exact-string `VITE_PUSH_ENABLED` build gate is on. It
reuses the existing section, type, surface, focus, motion and button treatments.
The section presents unsupported/Home Screen guidance, server-off, permission
not requested, denied, on-this-device, changed-key/lost-subscription and
cleanup/error states as plain labelled text with only actions that can work.
Buttons retain the shared 44px minimum touch target and wrap on narrow screens.
The item route uses one page headline, readable item text and time, plus
loading, unavailable, retry and sign-in states. The visual design does not
imply that provider acceptance proves phone display.

Proactive worker notifications keep the title `Jarvis` and choose body copy only
from fixed Danish/English templates for a validated kind and count. Payload
title/body text is ignored; invalid template data keeps the existing generic
“New item” notification.

The header's **Background work** list contains only undismissed jobs and explains
that research, images, apps and indexing are separate from Factory tasks.
P11-05 supersedes the earlier Recent jobs view that kept hidden rows visible.
Dismissing finished UUID jobs is account-owned server state (P11-12), not a
device preference, and removes the row without cancelling work or deleting
server history. The popover offers Dismiss all finished, groups equivalent
finished entries with a count, and shows kind, start time and stored reasons.
Restart interruptions use neutral text and marks, not failure emphasis/counts.
The P9-119 icon/count header remains unchanged; restart interruptions are excluded
from its failed count. Keep a stable trigger and explicit empty
state after the final dismissal; row dismissal focuses the list, while detail
dismissal and Escape return to the trigger. Cross-tab dismissal of an open run
returns to the filtered list. Indexing Retry remains explicitly unavailable
without a supported owned action. A historical interruption is not current
system health. Preserve borderless tabs and phone-sheet geometry; local fixture
inspection and live acceptance are separate.

Merged-header Chromium fixtures are in `docs/ui/screenshots/p11-12/merged-*`
at 390×844 and 1440×900, light and dark, captured with reduced motion.
Synthetic auth/API data exercised
grouped and bulk dismissal, running-work retention, updated outcome counts,
Escape/focus return and reduced motion. These are local browser checks, not
production-data or physical-device acceptance.

## Fixed balanced stage rendering (15 October 2026; local)

Dan accepted a single middle ground and said the changed stage still looks
good. Keep the existing room/orb/mirror composition, with no quality selector
or automatic tiers. The persistent room animates on home/sign-in and during
voice, and holds its last frame on other pages. Meaningful state, theme and
size changes can redraw that still frame without rebuilding the scene.

Use bounded ambient/voice rendering and a separately refreshed, cached mirror.
Reduce mesh detail and combine compatible static geometry; preserve nine
orb ribbons as one additive single-pass mesh. Filter fine shader bands rather
than letting subpixel detail shimmer. Resize the drawing buffer only when
dimensions/density actually change, before the next draw, not after it.
The window remains the glass boundary; nested panels keep their surfaces
without another backdrop blur. Pause the ambient CSS field behind work pages.
This supersedes the older adaptive-tier and route-only descriptions below;
historical measurements are not results for this revision.

## Gated Proactive web (18 October 2026; P13-10)

The Proactive page follows the shared smoky-glass surfaces without repeating
decorative cards. One page headline leads distinct Status, Open items, Sources
and Budget blocks; Recent checks and Earlier items use native disclosures.
Urgency and budget states pair words with icons, never colour alone. Finding
text stays plain, with a clamped expandable body and a separate full-detail
route. Actions and settings keep visible success/error copy, retry behavior,
keyboard focus and 44px touch targets. The small-screen layout is phone-first,
and all state remains readable with reduced motion and in either theme.

The settings slot is a single collapsed Proactive section with its own Save;
the Pause switch commits immediately. Private feed and guidance values are not
persisted with disclosure state. The exact-string web flag controls its route,
navigation, Settings slot and Background work Open link.

## Header tab overflow correction (15 October 2026; combined candidate)

Keep the existing glass header, fixed brand and fixed action group. Tabs
shrink from 240px to a readable 140px minimum before their bounded groups
scroll horizontally; retain title ellipsis, tooltips and focus reveal.
Use native scrolling without a scrollbar track consuming the compact
header height. Job details sit outside the scrolling job list.
Phone window/job rows stay full-width and 44px tall in the existing sheet.
Remove duplicated runtime activity from the header, preserving the chat
and voice-orb feedback and distinct backend-availability status.

## Mobile/Status review publication (14 October 2026)

Publish the already accepted phone chat geometry, focus behaviour and
route-commit acknowledgement without another UI iteration. The local
sections below retain the reviewed design and controlled-fixture evidence.
Publication approval is not physical-iPhone/Safari or voice acceptance,
and does not authorise merge, deployment or another live turn.

## Page navigation acknowledgement correction (14 October 2026; local)

Keep the existing Status page and navigation appearance. Broker success now
corresponds to the committed destination, including its normal loading/error
states. No new animation, toast, health probe or replacement composer is
introduced. Offline actual-App checks cover desktop/phone route commits;
they are not production, physical-phone or voice acceptance.

## Phone typing keyboard correction (14 October 2026; local)

Keep the existing glass frame and composer as one joined chat surface.
Home and off-home typing share visual-viewport insets, safe-area spacing and
the measured composer height. Manually positioned chat keeps its existing
two-pixel seam and device-local preferred geometry; viewport fitting never
saves a replacement layout. Keyboard space follows viewport events rather
than focus alone, since iOS can hide its keyboard while leaving focus intact.
Outside touch blurs only Message Jarvis, without cancelling the tap.
Do not animate keyboard fitting or treat pinch zoom as keyboard space.
Controlled actual-component Chromium checks are not physical Safari proof.

## Fixed Danish voice in Settings (13 October 2026)

The Voice section shows **Jeppe (Danish)** in a labelled read-only field,
with "Fixed for Danish voice sessions." as its accessible explanation.
Reuse the existing Settings grid, field styling and collapsible section.
There is no selectable Danish voice, new animation or additional save action.
Legacy Harper payloads still display the actual live voice without dirtying
the form.

## Remaining UI release (13 October 2026)

Dan approved the remaining refinements for live testing. This supersedes
earlier local-only or held release notes for these surfaces.

Keep the agreed glass chat frame, compact message typography and readable
composer. Move sits beside Maximise; borders and corners resize without the
rejected brackets. Resize hit regions stay outside the native scrollbar.
The existing composer follows the frame; keyboard controls, cancellation,
refresh and viewport fitting preserve the chosen layout and unsent text.

Keep Notes graph-first with a centred search and quiet plus. The blank draft
is immediately writable, with a destination tree beside it on desktop and
a folded picker on phones. Per-folder creation is inline, with explicit
confirm/cancel and focus recovery; touch controls do not depend on hover.
Inventory freshness remains in the header when the picker is folded.

Reports use the canonical `--report-surface` for both host and iframe. Only
the workspace frame has outer chrome; content-level structure is retained.
Changing appearance updates the mounted report without losing its selected
section.

Chromium checks and screenshot inspection cover 1480x1000 desktop and
320x700 touch/reduced-motion phone layouts in dark/light themes. Chat gestures,
native scrolling, loading, refresh, short viewports and off-home placement pass.
Notes checks cover exact saves, conflict recovery, arbitrary folders and
same-canvas continuity with desktop WebGL enabled. Reports cover theme changes,
pin/unpin, restore and Close. Fixtures intercept writes; no real vault edit,
live voice acceptance or physical-phone check is claimed.

## Workspace window release (12 October 2026)

#430 follows Dan's 8 October intent design: automatic fit, named regions,
side-by-side/grid and diagonal cascade. The first named cascade window is in
front. Arranged windows glide for 300 ms; dragging interrupts from the visible
rectangle, and reduced motion removes the glide. The existing camera preview
remains beside the foreground phone content, not in its swipe order.

Tabs are compact rounded rectangles with one pin toggle, accessible pressed
state, 32 px desktop and 44 px touch controls. Pinned Close returns to a tab;
unpinned tabs retain Close. Crowded desktop tabs scroll; the phone window list
opens above the content. Failures and Retry are visible, never colour-only.
Chromium fixtures cover desktop dark/light and 320px light/touch/reduced-motion
arrangement, first drag, pin failure/Retry, update, reload and all-window actions.
Camera and loading-recovery regressions pass too; live voice and real devices
remain separate acceptance, not inferred from intercepted backend responses.

## Chat loading correction (12 October 2026)

The glass chat frame appears before its messages. Loading messages, empty
history and first-load Retry occupy its transcript area; the frame does not
disappear or get replaced when data arrives. Existing messages remain during
refresh. This supersedes earlier hidden initial-history loading descriptions.
The hosted transcript exposes `aria-busy`; the composer remains usable.

The isolated chat-only candidate was inspected in Chromium at 1480x1000
dark/ordinary motion and 320x700 light/touch/reduced motion, including held
history, first-load failure and Retry. The same DOM frame survives each
transition. These are intercepted responses, not a live backend outage.
No new chat movement, sizing, density, pin or arrange changes ship here.

## Camera UI release (12 October 2026)

Dan approved #695 shipping at 21:20; this supersedes earlier parked-camera
statements below. Keep the agreed compact upper-right glass preview, contained
local video, Front/Back and Live labels, existing window chrome, dock-to-tab
motion and mobile-touch-only Switch. On phones the preview stays beside the
foreground window; controls remain 44 px and the composer keeps its geometry.
Close/Turn off stops capture. Ten-minute user-idle expiry restores explanation
and Retry, hiding the inactive picture. Live means local playback, never a
claim that the model receives continuous video.

The upload-only contract changes no layout or animation. Image/caption evidence
uses existing body copy and current-item voice notices. Synthetic Chromium
1440x1000 dark/ordinary-motion and 320x700 light/touch/reduced-motion checks cover
preview, switching, composer clearance, docking, chat and both voice languages,
Close and idle recovery. These do not establish physical-phone or voice-model
acceptance. Other local window/Notes changes are not part of this release.


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
| Task view | Kanban columns matching the GitHub Project; task state is a card/detail fact |
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

## Interactive research report (P7-37)

Progress and the final report share one temporary workspace window. Progress
lists observed queries and sources found without invented percentages; terminal
errors stay in the window. The final report follows the accepted Architectural
Glass surfaces and existing workspace chrome. Use report headings, readable
facts, comparison tables or labelled charts, and visible source links rather
than a generic repeated card layout. Respect the current viewport, appearance,
typography and reduced-motion preferences passed in the workspace frame.

The report is model-written HTML/JS in a sandboxed `html-app` iframe, as Dan
decided on 6 October. The host loads `srcdoc` with `sandbox="allow-scripts"` only
and the restrictive artifact CSP; it validates bounded `open_url`, `ask`,
`pin`/`unpin`, and `resize` bridge messages. The iframe has no access to
same-origin data, tokens, cookies, Jarvis DOM, network, or top-level navigation.
The web renderer (8 October) fetches the artifact with Dan's token and shows it
flush in the window body, which scrolls; the frame sizes itself to the content
through the bridge. Links inside the report open in a new tab (or Chrome on the PC
if the browser blocks it), and ask, open and pin act only after a real click inside
the frame. Loading, missing (no retry) and temporary-failure (Retry) states are in
words. Timelines from Jarvis use a quiet cyan rail with the label or date as an
amber marker, in the order Jarvis gives.

Dan's 10 October refinement makes the host and report one solid window. The
canonical `--report-surface` in `styles.css` supplies the window, iframe and
document background in each appearance. The document's outer background,
border, radius and shadow are removed, including a sole top-level
main/div/article wrapper; meaningful nested sections retain their own styling.
The host sends presentation-only theme updates without reloading the report,
so selected report sections remain selected. The scripts-only sandbox and CSP
are unchanged. A long window title wraps independently of the single control
row; Close never wraps onto a second row.

## Interactions to design

- **Voice states:** listening, thinking, speaking, interrupted, reconnecting. Show what Jarvis heard. English uses Ryan HD and a British butler persona; action confirmations reflect backend tool results.
- **Confirmations (P7-02/P7-03/P9-120, Teams removed by P10-10):** in every presence mode, the header attention popover lists expiring requests with the bounded summary and explicit Approve/Reject buttons. The queue appears only when requests are pending.
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

### Compact luminous-glass voice bar (P8-36; refined by P8-40)

Dan selected the last Luminous Glass component-family image ([handoff](https://github.com/DanAakesen/jarvis/blob/7f45b836a4635c9cf17d3d6a3e12a173995a0f80/docs/ui/chat-voice/README.md), published with draft PR #400). P8-40 keeps voice controls in one compact pill: **More** (•••), a divider and **End voice**. The bright white runtime label and recovery detail sit beneath the orb, without a background or colored glyph, following its centre, left or phone-docked position. The large status disc, heading and duplicate microphone/screen/camera button group are removed. Mute/Unmute microphone and screen/camera start, on-request inspection and stop controls live in the More menu. Disabled items explain why they are unavailable. Start voice requests permission and prepares audio; capture begins after the authenticated handshake. Exceptional Retry microphone belongs in More.

- **Shared More menu:** `ConversationMoreMenu` is used in the voice bar and the composer, replacing the DA/EN buttons. It has a globe Language row that opens a Danish/English flyout, with a check on the current choice. Arrow keys, Home/End, Right/Left (flyout), Tab, outside click and Escape work as expected. The first Escape closes the flyout, the next closes the menu, and only then does Escape end voice.
- **Truthful status:** the transport owns connecting, reconnecting, stopping and failure. Runtime thinking, tool and speaking activity cannot overwrite them. Listening appears only while the microphone is open. A routine detail line is visually hidden but still announced; a non-routine detail (for example, microphone denied) is shown.
- **Language during voice:** changing language mid-session updates chat and the next voice session. The Language flyout states which language the current session continues in; the note stays out of the control bar.
- **Shared tokens:** `--glass-edge-cool`/`--glass-edge-warm` reuse the stage orb cyan and amber, and `--glass-refraction` draws the fine refracted edge for the shared `.luminous-glass` surface on smoky `--surface-translucent`. No second palette is introduced. Reduced motion stops the glyph and menu entry animations.
- **Placement:** the bar sits bottom centre (640px) without windows, and under the left orb column with windows. On phone it publishes its height for the docked orb and separate status; foreground content ends above that dock. Flyouts stack above their menu at 700px and below.

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

## Sign-in (P0-09; simplified in P9-69, refined in P9-75)

The orb remains unobstructed and is the signed-out screen's hero. Place the
single device-local greeting and **Sign in** action (accessible name
**Sign in with Microsoft**) below the stage on desktop and in the lower third
above the safe area on phones. The action reuses the shared luminous-glass
surface, complete refracted rim, and semantic cool/warm tokens; it is not a
filled primary pill. Do not add a card, supporting copy, idle status, or a
second headline.

When Jarvis is idle, the warm core breathes and drifts, separate ring layers
turn at distinct speeds, and small warm lights travel along the existing stage
lines. Keep the cyan shell and all active voice/activity states recognizable.
Pointer or available device-orientation input produces only a slight, eased
stage tilt. Reduced motion keeps a still warm glow with no travelling light;
hidden tabs pause the renderer. Compact viewports start at the existing lowest
quality tier (0.7 backing scale, 256px reflection, 35% particle count) and only
recover after sustained smooth frames; ambient rendering remains capped at 30 fps.

Complete silent account restoration before showing the interactive screen. A
failure adds one short inline message and changes the same action to **Retry**.
Keep the existing 140 ms delayed loader, theme behavior, and reduced-motion
support. Disable the action with an accessible explanation until the backend
is configured. After `/me` verifies the session, show the returned name as the
page headline. Do not expose account tokens, email addresses, or unverified
identity claims in the interface.

## App shell (P1-07)

The shell keeps the neutral foundation and adds structure only, without a
visual direction. The header contains the Jarvis home link, area navigation
(Software Factory only) and a separate Settings entry. The current page is marked with a
surface fill and full outline, never a lone edge. Navigation appears only after
sign-in; the header wraps on narrow screens.
P9-71 supersedes this initial selection treatment with the shared tint and
non-colour cues described in the current shell guidance below.

- **Database wake (P1-14):** one shared, polite status message in the top bar
  (P8-37) reads “Waking Jarvis…” while the backend reports a resume wait.
  Keep the current page and pending controls visible; do not infer this state
  from elapsed time or replace it with an invented progress indicator.

- **Main page:** P8-05 supersedes the initial wide-column layout with a
  conversation-first opening screen and a bottom-centred composer. Attention is
  reached from its conditional header icon; Now and Backend are not Settings
  sections.
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
- **Header attention (P9-120):** Show only non-dismissed attention, credential
  and alert items plus pending browser confirmations. Keep linked titles, times,
  Dismiss, Approve and Reject in its own keyboard-accessible popover. The shell
  feed stays mounted while Settings is closed; releases, running tasks and
  away-mode changes are not attention. Hide the background-work control only
  when no non-dismissed jobs and no attention items remain; keep it present while
  its popover is open. Interrupted history stays dismissable and uses a labelled
  neutral mark when there are no running/done/failed counts.
- **Away mode (P7-02):** Feed mode changes remain ordinary feed data and do not
  become a color-only header status or an attention item.
  An explicit, visible-browser activity request—not passive feed refresh—returns
  Dan to present. Pending browser approvals use the panel's existing list and
  button styles, with visible pending, failure, and recovery feedback.
- **Alerts (P6-02/P9-120):** Keep alerts as dismissible attention-popover items;
  retain the condition title, timestamp, and task/release/project link where one
  exists. Budget alerts have no invented page or cost estimate. Pair the yellow
  state with its own bell shape, count and accessible label.
- **PC bridge browser toggle (P7-18):** Keep Chrome automation in the existing
  tray context menu as an explicit, persistent on/off check item. Its label
  states the current setting; the disabled default must be unmistakable. This is
  a native companion control, not a new web page or a browser-injected overlay.
- **PC bridge control pause (P7-32):** Keep **Pause Jarvis control** in the same
  tray context menu as a persistent check item whose label states on/off. The
  checked state means PC control is paused; failures to save or report the state
  remain visible in the tray status. This is a native companion control, not a
  new web page.
- **Area pages:** the Software Factory has its own Tasks and Projects
  navigation. Unbuilt task and release pages explain what is unavailable.
  Project management is implemented below; record pages link back to their list.
- The P1-07 shell was checked in headless Chromium at 300, 390, 768 and 1280 px
  with a stubbed sign-in: no horizontal overflow, and controls are at least 44 px high.

## Settings (P1-11)

Keep the Settings route within the shell's neutral foundation. Use one page
headline and distinct form sections for Appearance, Jarvis, Voice, Coding agents, Global,
Projects, and Credentials. The Projects section contains the managed-project list,
the Add project action, then a collapsed “Defaults for new projects” disclosure
with the seven defaults in the same labelled field grid. Two columns make related
controls easy to scan on wide screens; the form stacks on narrow screens. Default
save feedback stays beside those fields, and loading, recovery, and unavailable
actions remain explicit. Credentials show text status, expiry, and last-updated
dates without secret values; manual renewal and reseed controls remain disabled
with an explanation. P9-121's browser fixture screenshots are
`docs/ui/screenshots/p9-121-fixture-{light,dark}-{phone,desktop}.png`.
The Voice section includes a labelled “Minimise all windows when starting voice”
checkbox, off by default, saved with the other settings.
Routines (the former Task recipes, renamed in P9-103) use a separate Settings section with compact rows showing the app
or site, normalized goal and step count. Refresh and per-row Delete act immediately,
independently of Save settings, with local pending, error/retry and success feedback.
The section reuses existing surfaces, focus styles and responsive settings layout.
P7-35 was checked in Chromium at 1280×900 and 390×844 with normal/reduced motion:
loading, refresh/error/retry, delete pending/error/retry/success, empty state and
keyboard focus. Buttons measured 44 px; no overflow, clipping or page/console errors.
These were local auth/API fixtures, not live backend or PC acceptance.
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

P12-09 adds a collapsible Nutrition targets section after Projects, only while
Daily is on: with Daily off nothing renders and no request is made. It follows the
Routines pattern, with its own form and save beside the action, independent of
Save settings. The folded header carries a text summary (Needs setup or
Configured). Three labelled whole-number fields (resting energy burn, daily
deficit, protein) sit in an auto-fit grid, three across on desktop and stacked on
a phone, each with a hint and its allowed range. The values are private health
data, so the fields ship no defaults, placeholders or example figures. A bad entry
shows a text error after blur (also `aria-invalid`), and a rejected submit moves
focus to the first invalid field and sends nothing. Save stays disabled until a
value changes; while saving the form is `aria-busy` and read-only with
"Saving…". A saved result shows the committed readback, a text status and the
last-saved date. Failures use distinct page-owned copy (load with Retry, rejected,
denied, unavailable, unreadable) that never shows server text and keeps the
entries. Inputs are 44 px tall at 16 px so iOS does not zoom.

Checked in an isolated headless Chromium at 390×844 touch, 320 and 1280×800, in
light and dark: folded, open, missing, invalid, saving, saved, loading,
unavailable, load error with recovery, and save rejected or failed. No horizontal
overflow at 320 or 390; focus rings unclipped; keyboard order is toggle, fields,
Save, next section; the console was clean. Limits: a mocked `fetch` with synthetic
figures, no live backend, no 3D stage, header or real sign-in, and
`prefers-reduced-motion` could not be emulated (the section adds no motion of its
own). Local runs are not qualification.

## Projects (P1-10)

Keep the neutral foundation. The list uses one compact project panel per
repository, with its settings, running-task count, last-release availability,
and edit action grouped for scanning. Project settings use labelled form
sections; save, archive confirmation, loading, retry, conflict, and
success feedback stay close to the relevant actions. One Projects section holds
the managed-project list, Add project action, and a nested collapsed Defaults for
new projects disclosure. Its seven fields use the existing Settings save form;
unsaved, pending, confirmed, and failed-save states appear beside the defaults,
and a failed save can be retried there. The Add project dialog previews the
server-saved defaults it applies to a new project. Archive messaging explains
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
P9-121 keeps the same neutral controls and anchor while grouping project defaults
with managed projects; no new color, border treatment, or motion is introduced.

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

Needs attention offers **Cancel task** using the shared two-step confirmation,
**Keep task**, pending label and adjacent error feedback. It does not offer
Steer, Pause or Resume. Crash Recover and expired-session Continue remain beside
Cancel when their existing end-reason conditions apply; all actions are disabled
while one request is pending. Recovery starts a new sandbox from the task branch
and saved history; cancellation does not start work.

The local cancellation candidate was inspected with the actual component and
existing styles in an offline browser fixture at 1280 px and in a 390 px iframe.
Question cancellation, Recover/Continue coexistence, confirmation, synthetic
pending/failure and terminal refresh were exercised without a live service.
No horizontal overflow was observed; mobile buttons were approximately 44 px.
This is isolated component evidence, not deployed task-page or live cleanup
acceptance. No layout, token or animation change was introduced.

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

P9-73 keeps phone docks one comfortable gap above the bottom safe area, shared
by typing and voice; feedback and windows clear that dock. The shell and fixed
phone sheets also respect the top and landscape side insets. Canonical spacing
lives in `styles.css`; desktop geometry is unchanged.

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
P9-72 keeps phone voice docked even without a non-minimised window, and starting
voice preserves the current page and header. The dock has no foreground veil or
viewport-sized hit target; only its compact controls and status accept input.
The phone header is a straight, unblurred surface. Typing never shows the large orb. Camera and sharing move behind a
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
Screen sharing and frame-inspection actions remain in their existing workflows;
the header attention icon is separate from the composer.
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
running-tool shimmer; thinking is not treated as a tool call. Completed
background-work outcomes stay static.

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

## Workspace pins (P8-45)

Pinning is explicit and page-owned: the signed-in page writes a validated
generated view through the owner-only backend API. Keep at most 20 pins and show
them oldest first; re-pinning updates the saved view without changing its
original pin time. Persist neither window geometry nor temporary views merely
because Jarvis created or displayed them. The backend and contracts provide the
storage boundary; the UI session owns the controls and API calls.

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

- **Shell:** the footer row is removed from the grid (`--rail-size` + one content row; rail spans `2 / -1`). The original selected rail, sidebar, Settings and phone view-switcher treatment used `--glass-selected` with `--glass-selected-glow`; P9-71 supersedes that treatment below. Rail, sidebar and context pane gain a faint `--glass-shell-sheen` over the existing translucent surfaces.
- **Status:** `DatabaseWakeStatus` renders a compact `.topbar-status` pill first in the top-bar actions; phones show the pulsing mark with the label kept for assistive technology and as a tooltip. Reduced motion stops the pulse.
- **Composer:** one `luminous-glass` pill (radius 30px) holding orb │ paperclip │ multiline text │ More │ Send (paper-plane). Neutral `--rule` hairline dividers separate groups. The paperclip reuses `ConversationMoreMenu` with no Language row for the existing screen/camera visual-context actions.
- **Message window:** the shared workspace window for view `conversation`, styled `luminous-glass` with a visually hidden title and round borderless controls. Tiled, it sits bottom-centred above the composer at up to `min(860px, 100%)` wide and `min(44vh, 460px)` tall (phones `min(46dvh, 420px)`). Maximise, minimise tabs, layered drag/resize and focus are the workspace's own behavior. Typing-mode Jarvis now stacks the workspace above the composer, so workspace windows are visible on desktop as well as phones. No title, orb, separator or avatars. Dan's messages sit right with a warm `--message-dan-tint`; Jarvis replies sit left with the existing `--surface-translucent` plus `--message-jarvis-tint`; both are limited to `min(88%, 62ch)`. Author names remain in visually hidden text and `data-speaker`.
- **Errors:** turn failures stay `role="alert"` text inside the conversation window, and a new failure restores a closed or minimised window. Voice and capture failures use the dismissible bottom-right toast introduced in #435, outside the composer and above its measured bounds. Older `p8-37-*-voice-error-*` captures show the superseded inline layout; the integration captures document the current toast behavior. Failed-turn captures remain applicable.
- **Evidence:** fixture Chromium/SwiftShader captures `docs/ui/screenshots/p8-37-*` at 1440×1000 and 390×844, dark/light. They use scratch auth/API fixtures, not live provider, physical-device or hardware-GPU evidence. The final `p8-37-integration-*` captures/report exercise the real browser voice client with fake media and socket: shared window controls, voice minimise/restore, draft continuity, capture and toast feedback. App tests also cover commands, snapshots, an in-flight reply and the FIFO queue. Phone window controls use 44px targets. The compact voice bar, white under-orb status and living stage retain #419/#437's behavior.

## Voice status beneath the orb and stronger live behavior — 6 October 2026

**Confirmed by Dan; planned in [#417](https://github.com/DanAakesen/jarvis/issues/417), P8-40.** State feedback moves out of the compact control bar to readable HTML beneath the orb. It follows the orb when centred, moved left of windows or docked on phones. Keep useful recovery feedback and an accessible text alternative even without WebGL. More and End voice retain clear space; current/next-session language explanation moves into the Language flyout. This supersedes the in-bar state placement in P8-36's reference.

Start voice includes microphone activation, subject to native permission and real session readiness; remove the normal Enable microphone button. Earlier descriptions of microphone-off readiness document the existing implementation and are superseded requirements. Keep explicit user start, mute, cancellation, truthful recovery and resource cleanup; visual awakening alone never requests capture.

Reuse the approved cyan exterior, transparent open amber core, live room and mirror. Make wake-up a pronounced staged nonlinear sequence: core ignition, energy spreading through the shell, a controlled expansion/light surge, then active settling. Keep action handling immediate and transitions interruptible. Use attentive listening breath/ripples, inward/core-flow thinking, directed real tool-work movement and a strong speech envelope synchronized with actual playback. These are state cues rather than arbitrary decoration. Room/reflection lighting follows orb light; room/camera/platform do not jump. Keep state legible at reduced motion and lower rendering quality. Validate actual motion as well as desktop/phone composition; a separate prototype is not a prerequisite.

### Voice status and expressive orb implementation (P8-40)

PR #419 implements the approved refinement on the existing stage. Wake lasts about 1.05 seconds at normal frame cadence: amber core ignition, an outward cyan-shell wave, then expansion/light surge and settling. Listening has breathing ripples; thinking draws energy inward; tool work uses travelling arcs; speaking uses the decoded audio currently playing with attack/release smoothing. Mic input only modulates listening. Reduced motion uses steady forms. The camera, room and platform remain fixed, and reflected light follows orb output.

Copilot reported fixture browser layout checks at desktop, 390/320/280px, short landscape, both themes and reduced motion. Its motion frame observations used software WebGL at about 4 fps; they do not establish normal-rate animation quality or live microphone/provider behavior. Hardware-GPU, physical devices and live voice remain acceptance checks after deployment.


## Voice UI hotfix — 6 October 2026 (#435)

Use unframed white status text beneath the orb, with soft light and a dark contrast shadow; preserve recovery text and responsive placement. Bottom-right smoky-glass toasts hold transient feedback with a dismiss control, a ten-second lifetime paused while hovered or focused, and an offset above the measured composer or voice controls at every width. They render outside the composer and menu. Dormancy has a restrained cyan breath and visible stirring amber core; awake core filaments and sparks move more strongly without filling the transparent core. Preserve the wake sequence, fixed room/camera/platform, mirror and runtime-driven states. Canonical component styles remain in `VoiceControls.css` and `ConversationToast.css`; scene motion remains in `JarvisStageOrb.ts` and `jarvis-stage-scene.ts`.

## Stage glass shell and docked conversation — 6 October 2026 (local UI session with Dan)

Dan supplied a reference image and iterated live. Canonical values live in `styles.css` (stage-glass block and shared window chrome) and `ConversationHistory.css`.

- **Angled shell panels (Jarvis page, desktop):** rail, navigation and Context are translucent glass slabs (`--stage-slab`) hinged at the outer screen edges and turned `--shell-tilt` (20°) with `--shell-perspective`, so their inner edges recede into the room. Their rims are brightest on the inner edge, and they swing in from the hinge when opened. Phones and other areas keep flat panels.
- **Fixed orb:** the stage orb stays centred on desktop when windows open. This supersedes "moves left when windows are present". Phones keep their voice docking.
- **Windows:** every workspace window uses the same stage glass, one compact 32px heading row (15px title) and round borderless 32px controls (44px on coarse pointers). The navigation and Context panels share that heading. The resize corner glyph is gone; the edges still resize. Closing any window (button or Jarvis command) sends a visual-only copy that dips, then flies off the top-right corner. The real close is immediate. Reduced motion fades it instead.
- **Docked conversation:** the conversation window is the upper part of the composer: same glass, square inner corners, no gap. Other windows stack above it in both arrangements. A centred grab handle on the composer shows or hides it. Click and keys toggle it; dragging up opens it; dragging down follows the pointer and dismisses it. Opening springs from the composer with a slight overshoot. Collapsing tucks it back down. The handle also reopens a closed conversation and replaces its minimised tab on the Jarvis page. The window's controls float over the transcript, and messages fade out toward the top edge.
- **Composer:** the same clear glass. Hover and typing show a thin light running around the rim instead of a thick focus ring; reduced motion shows a steady bright rim. The voice orb is a living miniature of the stage orb: a cyan shell with rotating meridians and an amber filament core, which brightens while Jarvis works.
- **Messages:** uniform 18px radius. Dan's bubble has a glowing amber outline; Jarvis's a cool hairline.
- **Removed from the Jarvis page:** the Arrange menu and the "Activity, sharing and backend" disclosure. P9-120 removes Now and Backend from Settings; the shell-owned feed stays mounted and publishes its attention items to the header popover. The `/operations/sleep` API remains unchanged, with no web Settings control. Screen sharing is a working top-bar toggle beside the camera.
- **Scrollbars:** thin, quiet at rest, cyan while hovered. With a mouse or trackpad in Chromium or Safari they are 10px pill thumbs with no arrow buttons and a transparent track; touch screens and Firefox keep the standard thin overlay bars. The Notes reader keeps a stronger resting thumb. A glass surface never shows a scrollbar unless its content overflows: a scrolling glass surface drops the 1px ring (the Notes search results use a hairline border instead) or leaves scrolling to a parent, because the ring's overhang would otherwise add phantom bars.
- **Panel width:** a vertical pill handle is centred on the inner edge of the navigation and Context panels. Dragging it, or using the arrow keys on it as a separator (Shift for bigger steps, Home/End for the limits), resizes the panel within 160–420px and 220–560px. Widths are remembered on the device; phones have no handle. Only the panel body scrolls, so the heading and handle stay put.
- **Handle exit:** hiding the conversation with the composer handle (click or drag down) uses the same top-right fly-off as Close.
- **Phone conversation resize (P9-117):** a visible horizontal grip in the window's heading resizes its height; drag up to expand and down to shrink. Its 72×44px target stays inside the window, clear of transcript actions and the separate composer open/close handle. It uses the shared quiet hover/pressed surfaces and focus outline, with no added animation. Up/Down resize by 32px (64px with Shift); Home/End select the height limits. Phone height is remembered separately from desktop placement.
- **Top bar:** on the desktop Jarvis page it floats as the same glass slab as the side panels, with the same inset gap, radius, lit rim and shadow; other pages keep a flat glass bar. Controls are 36px rounded buttons (44px on touch).
- **One hover style:** every icon button (rail, top bar, panel close, window controls, More/attach, toast dismiss) shares one hover: a lit glass wash with a faint rim and soft cyan glow. Press sinks the button slightly with a deeper wash. Selected, open and pressed controls keep the lit selected surface. An active camera or screen share, an open Context panel and the current Settings page show that surface; camera and screen also show their On/Off text.
- **Feedback:** conversation-history and theme failures appear as bottom-right toasts with Retry, not inline text in the chat. Toasts share one stack, so they never overlap.
- **Composer:** it sits above workspace windows, so its menus are never hidden. Chat language defaults to English. An unsent draft survives page changes within the browser tab.
- **One room everywhere:** the 3D stage is mounted once in the shell, behind every page and the sign-in page, so navigation never reloads it. Signed-out pages start from the last theme used on the device. The rail, navigation, Context and top-bar slabs (including the tilt) look the same on every page. They use the clearest shell glass (`--shell-slab`, dark 30%) with a 14px blur, so content behind them shows through as frosted shapes. The other stage glass is dark slab 40% and clear glass 18%; the Kanban board uses a slightly denser `--board-slab` (48%) with 48% cards.
- **Panels over content:** on desktop the side panels float over the page like drawers. The main area keeps one constant gutter, so opening, closing or resizing a panel never moves content; content passes behind the glass. The navigation panel exists only for an area with two or more pages (its rail toggle is hidden otherwise). It starts closed, and choosing a page in it closes it and moves focus to the page. Today every area has a single page, so the panel and toggle stay out of the way.
- **Software Factory is Kanban:** the separate Tasks and Projects list pages are gone (`/factory/tasks` and `/factory/projects` redirect to Kanban and Settings → Projects). Kanban's header has Create project and Create task. **Create project** opens a dialog that lists GitHub App repositories not yet managed, each with Add (the existing manage action). A "Start a new repository" field sends the request to Jarvis in the conversation, because Jarvis creates and registers new projects. Projects are managed in a Projects section in Settings. The full task page, project settings and release pages remain and link back to Kanban and Settings.
- **Living surfaces:** glass surfaces catch a soft light at the pointer position (mouse and pen only). Pages assemble with a short rise-and-focus entrance, and Kanban columns, cards and Settings sections stagger in. A window Jarvis acts on flashes a cyan halo that settles. Reduced motion removes the movement; the light effect is not motion.
- **Dropdowns:** where Chrome supports styleable selects (`appearance: base-select`), every dropdown opens a glass list with lit hover and selected choices, a cyan checkmark and a rotating chevron. Other browsers keep native lists.
- **Kanban (`/factory/kanban`, first and default in Software Factory; P10-07, 13 October):** reuse the approved glass Task Lens composition with canonical GitHub columns: Backlog, Needs Dan, Ready, In progress, In review, Done. Summary pills count matching issues in In progress, Needs Dan and Done, rather than conflating task and issue state. One actual project is always selected; other filters are local and search waits for a pause in typing. Cards link to the issue and linked PR/checks, show blockers, and add worker/task-state chips plus observed activity, start time, attempts and branch only when supplied. Valid task controls, View details and Open task remain. Snapshot/repository, cached or failed-refresh data and live connection status are written facts; Refresh board gives pending feedback without replacing the board. No task duration is inferred from an overlay lacking finish time. Columns retain their named dots, counts, collapse behavior and existing tint; In progress uses the existing cool tone and In review the existing review/warning tone. Actual Running tasks retain their sheen. Both reduced-motion modes stop the new column pulse. Filtering precedes each explicit 100-card cap.
- **Release trail (Kanban only):** the project and branch, Build/Deploy/release states as named dots, and up to five recent commits as linked dots on a lit line from oldest to newest. The newest commit glows and pulses. Refresh and Open release are compact pills. Without a selected project a dotted placeholder asks for one. The Tasks page keeps its original bar.
- **Automatic board refresh (#813, 14 October):** finish an in-flight same-scope read before handling automatic invalidations or reconnection. Coalesce them into one follow-up, retaining updates that arrive during that follow-up. Keep the existing short idle debounce, pending controls, mounted cards/scroll/focus and visible failure/recovery states. Missing-issue and requested-task-link navigation stays loading while that scoped work is pending, including the debounce gap; it uses the existing bounded wait, not an extra read or longer acknowledgement budget. Explicit Refresh/Retry and actual scope changes keep their cancellation semantics. This local correction is supported by controlled fixtures, not an attribution of the original released cancellation storm or production acceptance.
- **Issue-number navigation (P10-07 follow-up):** retain the selected project, clear interfering local filters, apply an exact `#number` search and unfold the target column. Reuse the existing scroll/glow and reduced-motion behavior, not a new banner or motion system. A task-free issue focuses its real GitHub title link; a linked task retains its foreground task-window focus. The shell-owned feed remains mounted across page changes and supplies the P9-120 header attention popover.
- **Current issue context:** keyboard focus inside a visible Factory card identifies that issue in the workspace snapshot. Other focus, a hidden/removed card or another page clears the current selector; a previously foreground task window must not override actual card focus.
- **Settings:** a centred column of glass section cards with a Back button (to the previous page, or Jarvis when opened directly). Now and Backend are not Settings sections. Inputs are glass and the save bar floats as a compact pill at the bottom right.
- **Status (P9-101, 14 October):** a read-only diagnostic page in the existing shell, with its own pulse rail icon and phone-menu entry. Use two glass lists, System checks and Recorded smoke check, rather than decorative metric cards. Each row pairs the reported status dot with text, check time and stale marker; failures explain why. PC connection/pause state stays visible, while safe provider details use working native disclosures. Refresh/Retry stays next to the single Status heading, disables while pending and never runs model canaries. Failed refresh retains explicitly previous evidence. Reuse the shared data-arrival transition; both reduced-motion settings remove the rise. Desktop dark/ordinary-motion and 320px light/touch/reduced-motion browser checks use synthetic API responses, not production acceptance.
- **Sign-in (revised 7 October):** the room's own orb is the hero and stays clear. A dense glass slab sits low over the floor (where the chat bar lives) with the headline and short copy on the left, the Microsoft button on the right and the status beneath; it stacks on phones. The top bar floats as the same slab as when signed in. The page opens in the right theme from the first frame: a tiny blocking script (`public/theme-boot.js`) applies the theme last used on this device, or the OS theme when none is remembered, before anything paints.
- **Toasts:** an identical message from two sources (for example an expired sign-in seen by two loaders) appears once.
- **Task windows:** a task opens as a workspace window over the current page instead of a page. Task links in Kanban, chat, releases and usage, and the `/factory/tasks/:id` address, all open it; the address then lands on Kanban. The window shows a summary row (a state chip tinted by state that pulses while running, a project chip, a branch chip, the latest free disk) with the task controls and pull request action. Below it the request and a lit timeline run beside compact Details, Sandbox disk (gauges) and Usage cards. It collapses to one column in a narrow window (container query). Off the home page ordinary windows float centred at up to 1,180 px.
- **Tab bar:** a strip of glass tabs under the top bar. Minimise on any window (except the docked conversation, which tucks into the chat bar) throws a copy of the window up into its tab, which lands with a warm glow. A tab restores the window; its × closes it. Open task windows come back as tabs after a reload (saved in the browser). The bar takes no space when empty, and pages keep a constant top gutter for it so nothing moves.
- **Chat everywhere:** the chat stays mounted on every page. Off the home page the chat bar and its conversation fly into a living orb at the foot of the rail. Pressing the orb pops the bar out bottom-centre over the current page; the orb or Escape tucks it back, and changing page parks it again. Returning home restores the normal position. Starting voice from another page returns home, because voice is the full room.
- **Chat bar:** shorter (40 px orb) and narrower (740 px). The paperclip is gone: Look at screen and Look at camera moved into the ⋯ menu beside Language. One divider with room on both sides separates the orb from the message. Send is a small glass lens that warms to amber when there is a message, and its arrow lifts on hover. Hovering or focusing the orb wakes it: the amber core speeds up and brightens, the shell warms and a ripple breathes outwards.
- **Enlarged chat (Dan, 10 October):** in desktop typing mode, the composer expands to the same left/right edges as the visible maximised conversation, on home and other pages. Restore, minimise and close return it to the normal dock width. Phone, voice and unrelated maximised windows keep their existing composer layout. `ConversationHistory.css` derives the width from the shared window state; no duplicate React state or new motion.
- **Camera preview (P9-79, Dan, 11 October; local):** Dan's supplied reference supersedes the camera row in typing/voice. Activating capture opens a compact upper-right glass workspace window named Camera preview, with the existing window chrome and minimise-to-tab motion. It shows the actual local video without cropping, mirrored only for the front preview, with facing/Live labels over the picture and icon-plus-word Switch/Turn off controls below. On phones it stays a compact overlay beside the foreground window rather than replacing that window. Minimise keeps capture on; Close or Turn off stops it. Switching remains mobile-touch-only; unknown direction is explicit. Startup, device and playback failures have visible recovery. The composer and voice bar keep their original geometry. Every-turn capture is enabled locally against deployed #702/#704/#706, including optional handles for chat and EN/DA realtime image input; actual model image acceptance remains unverified. Typed limits show ordinary age-labelled text below the preview controls, and the existing toast stack makes it visible without undocking. Local Live describes the video, not freshness at the model. The obsolete manual Look at camera voice action is absent when conversation capture is enabled; watch mode remains independent. Ten minutes without a user turn stops capture and restores explanation/retry even from a docked tab. The inactive preview omits its empty picture so recovery stays visible on short phones. Synthetic Chromium checks 1440x1000 desktop normal motion and 320x700 touch phone reduced motion, including fitting limit copy and both voice languages. No physical-camera or deployed-model acceptance is claimed. No Look now button or new animation system.

- **Voice visual-source safety (11 October; local):** while camera conversation is on, the existing Look at screen menu row is disabled with the explanation "Turn off the camera to inspect the shared screen in voice." It retains the shared menu's keyboard focus, disabled styling and accessible description. Independent watch actions and Stop sharing screen are unchanged. No new composer geometry, controls or animation.

- **Camera experience acceptance (Dan, 12 October):** camera-window updates are
  parked until a natural, responsive visual conversation is proved. Dan rejected
  the slow snapshot-per-turn experience after two live caption-only answers with
  unavailable-budget feedback and an incorrect finger count. Keep the existing
  honest evidence labels and preview unchanged while the conversational input
  path and general chat latency are investigated; no new visual cadence or
  continuous-upload design is agreed.

Fresh camera replies should not narrate capture timestamps or repeat
snapshot-versus-live disclaimers (Dan, 12 October). The backend owns that
wording; the UI retains evidence/failure feedback and does not strip or rewrite
assistant messages. Stale/unavailable observations remain explicit.
The coordinator's latest 12 October update places live-feel wording in pending
P9-87/#714, separate from #713's deployed upload-only input. Camera preview
polish and the local upload-only opt-in remain held for Dan's review.

- **Camera input evidence (11 October; local UI, deployed backend contract):** backend-reported image/caption input uses ordinary muted body text on Dan's matching chat bubble and the existing dismissible voice toast. It is not a new heading, badge or composer row; preview Live still means local playback only. Missing legacy evidence stays unlabelled, and invalid evidence has visible failure copy rather than an image claim. Voice ignores stale, duplicate and uncorrelated evidence, including after camera replacement/reconnect. Synthetic Chromium checks image-reported and caption-only desktop/320px touch/reduced-motion phone states in both voice languages; they do not prove model image access. The phone preview lets its picture shrink before controls/limit copy, with scrolling for constrained heights, so an open transcript cannot clip recovery text. #704/#706 are deployed with chat and EN/DA realtime image paths; hosted DA fallback remains caption-only, and actual model image acceptance is unverified. Final-shape synthetic 32-character handles also pass desktop/phone caption-only and recovery workflows; forwarding a handle never changes the evidence label by itself.

The existing history-error toast keeps Retry; it now targets the failed
latest/older page correctly even when messages are already displayed. Synthetic
desktop/phone checks exercise malformed evidence, successful retry and
stale/duplicate voice feedback without adding new controls or motion.

Caption-only reason copy distinguishes "Model image support has not been
verified" from legacy-agent "Direct image input is not enabled". Both use the
same body text on chat and existing voice toast; no layout or motion change.
Budget feedback uses that same toast: a reached image budget and a budget
that could not be checked have distinct text, both explicitly saying no image
was supplied for the turn. Capture-time denials also remain visible in Camera
preview. Stale/settled voice items add no new notice or reply.

The existing typed-phrase light sweep remains unchanged: it is Dan's accepted
activity-feedback treatment, not new gradient heading text introduced by this
camera correction. Reduced motion retains solid text without the sweep.
- **Rail (P9-71):** the current area uses the same subtle cyan wash as the phone menu and top-bar toggles, with a readable cyan icon and stronger stroke rather than a glow or outlined tile.
- **Selection (P9-71, 10 October):** navigation, top-bar toggles, workspace tabs and segmented choices share the role-named `--state-selected-*` tokens in `apps/web/src/styles.css`, derived from the existing focus/text palette. Selected text gains weight and selected icons gain stroke weight or size; neither an outline nor colour alone marks selection. Hover deepens the tint and press deepens it again; focus keeps its separate visible ring. A closed toggle returns to its transparent resting surface. Presence keeps its mode label and tone dot when closed; opening its menu uses the shared cyan selection treatment. Text and indicators meet 4.5:1 and 3:1 respectively in light/dark, including hover and press.
- **Presence:** a chip in the top bar shows the live mode (Present green, Away yellow, On the move blue; P9-102) and switches it from a small glass menu. The mode label sits beside every dot except in the phone top bar, which keeps the dot alone and names the mode in its accessible label. Settings has a Presence section with three mode cards and one instruction per mode beside the base instruction in Personality. Without the presence service the chip is hidden and Settings says the modes are not available yet.
- **Memory:** a Settings section to browse, search and filter (People, Work, Personal, General) what Jarvis knows, with sync status and counts. Choosing an entry shows it beside the list with its history, a Save correction action (vault notes link to the resulting commit) and Forget. Forget explains the outcome first: memories Jarvis keeps are forgotten at once; vault notes need approval in the conversation, and the page reports when approval is pending, refused while away, or unavailable.
- **Top bar (7 October):** the brand, then every open window as a Chrome-style tab (the conversation has none; the orb brings it back), then a tab per background job, the presence chip and the controls. There is no breadcrumb. Tabs share the glass hover of every icon button; the front window's tab uses the selected surface. An empty tab area shows nothing.
- **Floating windows:** shell windows float, drag by the title bar and resize from the right and bottom edges; Tab to a title, then arrows move and Alt+arrows resize. There is no Arrange menu. Windows stay inside the window area and may sit over the docked conversation. Long titles wrap to two lines with the full title on hover.
- **Chat turn in progress:** Jarvis's bubble shows the amber working core (the orb's brain) with rotating first-person phrases from large shuffled sets (thinking, working, composing), each tool as a line on a thin lit trail with a running core or a round tick or cross, then the streamed answer. Tool calls sit on Jarvis's reply, not Dan's message. Bubbles use compact body type and tighter speaker spacing (revised 12 October below); the time is a glass tag on the bubble's top-right rim shown on hover. Sharing starts in the ⋯ menu. Screen sharing retains its live line/Stop above typing; camera controls live in Camera preview. The top bar has no capture controls.
- **Movable chat and density (Dan, 12 October; local, unreleased):** Dan rejected visible corner brackets. The existing glass rim is the resize affordance: invisible pointer regions cover every edge and corner, with directional resize cursors and keyboard focus only. There are no brackets, hover decorations or extra top grip. The Move icon sits beside Maximise; moving/resizing keeps the composer attached without reparenting its draft or voice client. Preferred position and size survive refresh on this browser and fit smaller viewports. Cancellation restores the prior placement. Minimise leaves the composer in place with messages hidden, as Dan selected; maximise/restore preserves the placement. A first drag interrupts the opening spring using its visible rectangle, rather than applying a scaled height twice. Top-border Up/Down and Home/End retain height shortcuts; other borders/corners and Move use arrows, with Shift for larger steps. Touch corners have 44 px hit regions; title actions retain priority over overlapping resize regions. Compact `--type-small` message paragraphs, lists and quotes remain distinct from the composer's readable `--type-body`. Initial shell-history loading is a screen-reader status, not skeleton content in the empty room. Standalone history still uses its ordinary loader; errors retain Retry. No camera UI or evidence wording changes.
  Side resize regions sit outside the transcript, on the rim and its outer side. Corner hit regions exclude their inward quadrant so the entire native scrollbar track stays usable, including beside the corners. Scrollbar dragging and touch scrolling do not change window geometry.
- **Modals:** one Modal component, rendered at the document root near the top of the viewport, with an X, Escape and click-outside to close. The card never scrolls itself; a card taller than the viewport scrolls with its backdrop.
- **Job tabs (P8-43):** each background job is a tab in the top bar strip: a cyan progress ring with the short title and step (or "N running"), a peek with the current step, elapsed time and Cancel; a green ✓ pulse when ready while the result window grows out of the chip (it waits in the chip with Open while Dan is Away or On the move); amber with the reason, Retry and Dismiss when it fails. Research progress windows start as tabs while the chip tracks them.
- **Knowledge (P7-43):** a rail page and a window Jarvis opens with `show_knowledge`, showing Dan's vault as a 3D star cloud. Stars are coloured by folder (People blue, Work amber, Personal green, General violet) and sized by connections, with fine additive lines for links and fainter lines for similarity. Since 8 October it is a flat 2D map (Dan found the spinning 3D cloud too much in his face): every note lies on one plane seen straight on, dragging pans and the wheel zooms, and stars are crisp with only a faint halo. It never goes fully still: each note floats a few pixels on its own slow orbit with its links following, each star breathes, and every second or two one link lights up and fades. It stops drawing off-screen or hidden; reduced motion keeps it still. Search lights the matches, dims the rest and flies the camera to them; the accessible results list, labels and a glass note reader (front matter stripped, GitHub link, connected notes) sit over it. One draw call for stars and one for lines, at 30 fps. Development builds can show a labelled sample graph when the service is missing.
- **Knowledge reader (P9-74):** hide properties, including malformed YAML after leading comments. Titles and paths wrap. The path, Markdown and connected notes share one keyboard-focusable scroll region; a bottom fade and labelled Scroll down button appear only while content remains below. The button scrolls directly under reduced motion.
- **Mobile Notes search (#984):** use 16px search-input text to avoid iPhone focus zoom clipping the search and dropdown. Keep graph camera zoom on matches and user-controlled page zoom unchanged.
- **Notes (P9-77, Dan; creation revised locally on 11 October):** keep the existing full-room graph as the default Notes page, including search, stars and folder filters; no list-first browser or Notes/Graph switch. Selecting a note opens the familiar floating reader with Edit Markdown, Preview and explicit Save. Connected notes stay reachable. Search stays centred at desktop, medium and phone widths. Create new is a named, plus-only 44 px action inside the right end of search, transparent at rest. It opens a blank draft immediately with writing focus, no Start writing gate and no generated source text. Desktop creation widens the same popup: an Obsidian-like nested folder tree on the left, title and Markdown on the right. Phones stack the destination disclosure above the editor, initially folded; the focused Markdown area scrolls into view without animation so writing is immediately reachable. Folder rows have separate expansion and selection controls, a selected surface/checkmark, and inline New folder under the current destination. New folders are marked New and persist only when a note is saved inside them. Dan requires all normal vault folders and root notes, with his explicit exception for hidden dot-folders; the repeated exclusion notice is removed, not the safety rule. The picker loads `/notes/tree`, adds the implicit Vault root locally, and offers Retry on absent/not-ready data without reverting to inferred graph/index folders. Last-sync text belongs in the popup header, not the folder body, and remains visible with a folded phone picker; truncation remains near the tree. Deployed #699 includes attachment-only folders with the same contract; the local picker loads the refreshed live inventory. Existing note readers remain narrow; content scrolls above the dock. Source preserves front matter and whitespace; preview hides properties like the old reader. Dirty/saving/saved feedback and conflict comparison accompany explicit saves. An untouched new draft closes freely; actual title/source edits guard closing, changing notes, navigation and reload. The generated `show_knowledge` window stays read-only.
- **Room colour:** the room's amber strips, ring accents, floor arcs, the lamp by the orb and the 3D orb's brain all use the bright `--glass-glow-warm` amber of the chat orb. Strips and ring inlays are thin, unlit lines so they stay crisp.
- **Voice keeps the shell (7 October):** on desktop, voice no longer hides the top bar, tabs, job tabs, rail or panels; they stay over the full-screen voice room, windows float across it as while typing, and only the chat bar becomes the voice bar.
- **Bubbles (7 October):** no fill; Dan's rim is cool cyan and Jarvis's is bright amber. Jarvis's live bubble has an amber light running round its rim while it works; once done, only the newest reply's rim breathes a soft amber glow. The conversation has no tab (the orb and handle bring it back). The Kanban page no longer has its own "Ask Jarvis" composer; the rail orb is the one way to chat off the home page, and an empty conversation shows no greeting card. Jump to latest is a compact glass pill.
- **Transparency (7 October):** windows and shell slabs are thinner glass: window blur 8 px and shell blur 6 px (`--glass-blur-window`, `--glass-blur-shell`), lighter tints, and a light veil dims the room only while windows are open. On screens above 1.5× pixel density rims and bubble borders are 1.5 px so they do not fade to half a pixel.
- **No page bounce:** while signed in the document never scrolls or rubber-bands; only inner lists, windows and the transcript scroll, and they contain their own overscroll.
- **Loading (P9-118, revised 17 October; supersedes the 7–8 October orb-loading rule):** page loading shows immediate plain `Loading` with decorative dots appearing one at a time and deleting one at a time. All three dots retain their width; OS reduced motion and the app's reduced-motion setting show three static dots. Screen readers hear a separate, steady contextual status. Sign-in changes the disabled, busy button to `Redirecting` immediately; a per-tab redirect marker distinguishes returning `Signing you in` from first-visit `Loading`. No loading orb or rotating loading phrase remains. The living stage, voice/input orbs and chat/job working cores are unchanged. The chat window still exists before messages arrive, with its quiet Loading messages label and line placeholders inside its glass. Loaded, empty and first-load error/Retry states keep that frame; refreshes retain messages. Task details retain panel placeholders, and Kanban retains card placeholders on first load or a filter change; skeletons keep their existing 140 ms delay. Live refreshes and task-control completion preserve the board, scroll and selection. Local Chromium fixture evidence in `docs/ui/screenshots/p9-118/` covers 390×844 and 1440×900, light/dark, first visit, Redirecting, Signing you in, Settings Loading and both reduced-motion mechanisms. Animation playback and fixed widths were checked; live Microsoft sign-in, physical devices and hardware WebGL were not verified.
- **Palette (7 October):** two accents only. Cyan for interaction and calm states (primary buttons, focus, selection, listening, running; done in a paler cyan) and amber for Jarvis working, speaking, attention and paused. Red is kept for errors. Presence is the one exception: its own green, yellow and blue (17 October, P9-102). The background glow uses the same two hues. The knowledge graph keeps four distinct folder colours so notes stay easy to tell apart.
- **Jarvis navigates (P9-40, prepared 8 October):** when Jarvis is asked to switch pages it changes the route with the normal page transition; a named Settings section, or the card of a task it names, scrolls into view once its data has loaded and glows cyan once. Folio and Status are refused until those pages exist. Applied or refused is reported back to the broker. Wired to `navigate` workspace commands; live once the backend contract (#571) lands.
- **Folio (P9-25, built 8 October):** a stacked-pages icon on the rail opens the Folio in the left sidebar slot (320 px, same glass hinge) over the current page; area navigation and the Folio share the slot, one at a time. Selecting another page closes the Folio, including the current page, Settings, the brand/home link, phone menu and Jarvis navigation; areas with multiple pages can replace it with their own navigation. Search (debounced) and text-only kind chips (Reports, Apps, Images, Graphs; one at a time, press again to clear) filter the list; Pinned, Today, This week and Earlier group it. A row shows the kind icon, title and time; hover or focus reveals the prompt summary and pin, rename and remove actions (always visible on touch). Clicking reopens through the backend, so the window arrives like any Jarvis window, and the row flashes cyan. Remove asks inline first. Loading uses row placeholders; empty, no-results (with Clear search) and error (with Retry) states are explained. `navigate { page: 'folio' }` opens the pane.
- **Showing the work (P9-41, 8 October):** while Jarvis works, its live chat bubble types Jarvis's own description of the step ("Searching your vault for Ignite") instead of a canned phrase, and the top bar's activity label shows the same text. Repository reads and searches open a read-only **Code view** window: a monospace path breadcrumb (repo / folder / **file**), ref and language chips, an Open on GitHub link (only for a real owner/name repo), numbered lines, highlighted ranges tinted cyan with a bright line number, and query matches marked amber. Each time Jarvis moves, the first highlighted line scrolls to the middle and the body fades in. Content is shown as text only; screen readers hear the highlighted ranges and that matches are marked.
- **Notes refinements (Dan, 11 October; local):** place inventory freshness on the top header row immediately before the close icon, right-aligned opposite New note. On narrow phones it wraps within that row rather than clipping or covering the 44 px close control. The destination disclosure is one 44 px row: folder glyph, "Save in" and destination, then chevron. Long destinations ellipsise visually; the full path remains in the accessible name and tooltip. Remove the separate New folder action: every folder row, including Vault root, has a plus revealed on desktop hover or keyboard focus and always visible on touch. It expands that folder and inserts a focused child naming row there, with Enter/check to add and Escape/cross to cancel. The temporary name does not change the note destination until added; creation remains local until a note Save. Remove the new-draft instruction/path metadata row, retaining path metadata for existing notes.

- **Phones (8 October, voice first):** no rail or side panels. A slim top bar holds an open-windows count, the presence chip and a menu button; the menu is a bottom glass sheet with Jarvis, Software Factory, Knowledge, Usage, Settings, Folio and the context panel (Jarvis can also switch pages by voice). The chat bar is the dock at the bottom of every page; its orb starts hands-free voice. Home is the room with the transcript tucked away: swipe the handle up (or, once P9-45 lands, ask Jarvis) to bring it up as a sheet. One caption line above the dock says what Jarvis is doing. Windows Jarvis opens slide up as full-width sheets; the count opens a list of them. Pages scroll normally (the desktop scroll lock does not apply). Screen sharing is hidden where the browser cannot share the screen (all phone browsers); the camera offers a front/back switch on touch devices. Presence will switch to On the move automatically on phones once P9-44 lands.
- **Chat bar life (8 October):** when idle, one thin (1.25 px) light runs an unhurried six-second lap of the bar's rim every 10 s, easing from slow to moderate, then rests; hover and focus keep a slow steady sweep (7 s and 6 s per lap). The placeholder is a rotating invitation in Jarvis's voice ("What shall we tackle?") that types in slowly (70 ms per letter), rests, gets two unhurried light sweeps (2.4 s each), and gives way to the next every 9 s; the native placeholder stays for assistive technology.
- **Kanban space (8 October):** the header pairs Create project and Create task as matched pills (an even two-up on phones, with the summary pills on one scrolling line). Search and filters are one collapsible glass section showing how many filters are active when closed (open by default on desktop, closed on phones). Each column collapses from its title; on wide screens a collapsed column becomes a 52 px strip with its title running down it. Both are remembered on the device.
- **Collapsible sections (8 October, standing rule):** settings-like pages are an even stack of glass cards that fold to their title (`CollapsibleSection`): the title row is the toggle with a chevron, a folded card shows a one-line summary of its current state (theme, model, presence), and each card remembers on the device whether it was open. Cards start folded. New settings, configuration or detail areas use this component rather than adding long always-open blocks, so pages stay short on a phone. When Jarvis navigates to a section it opens it first.
- **Usage (8 October):** visual and quiet. A period switch (7 days, 30 days, 90 days, All time); a cost hero with Sandbox time, Tokens, Agent turns and Premium requests tiles; a "Where it goes" card with one stacked bar and a labelled legend (value and share) switchable by project, agent or source; Top tasks as ranked bars; Tool calls today as ranked bars with the Codex research count; and the detailed tables folded under "All usage". Cost is the measure when reported, otherwise the split counts usage records and says so. No daily trend is drawn because the report has no per-day series.
- **Models and tuning (P9-13, 8 October):** Settings has a Models card: one row per role (Chat, Vision, Research, Voice, Transcription, Embeddings, Codex, Copilot) with a model menu, a reasoning menu limited to the levels that model supports (disabled when it has none), and capability badges from the live catalogue; below it the Foundry deployments with capability badges, Add deployment (model, version, SKU, capacity) and Remove with an inline confirmation through the authenticated Now feed. When roles are present they replace the older per-area model menus. Voice gains Listening and replies (speech-detection slider, pause and pre-speech padding, longest spoken reply, barge-in switch); new cards for Research (Quick/Standard/Deep, most sources, time limit), Memory and retrieval (match and graph-link sliders, memories per answer, automatic capture) and Timeouts. Out-of-range values are explained under the field and hold Save. Unknown credential names from the backend are listed rather than rejected.
- **Hidden settings (P9-09, 8 October):** Appearance gains Look and feel: Motion (Full, Calm, Reduced), Density, Background, Corner roundness (px) and Room glow (%) sliders, and Accent, Second accent and Surface tint colour pickers labelled "Jarvis default" until changed. Each change applies at once and saves (sliders and colours after a short pause), rolling back if Jarvis refuses it; "Use Jarvis colours" clears custom colours. The disabled "Edit theme variables" button is gone. Global gains Check repair attempts (0–10) and Daily watch budget in USD (0–100, 0 turns watching off). Per-mode instructions already live in Presence.
- **Credential renewal (P9-19, 8 October):** Credentials are a card per credential: name, a status in words with a tone dot (cyan OK, amber renew soon, red action needed), expiry and last renewal. Cards the backend can renew on request (Codex login today) carry a Renew button that turns to 'Renewing…' while it runs; the result sits on the card (Renewed, busy with a task, or the backend's failure reason) and the card takes the returned status. The disabled renewal and re-seed buttons are gone.
- **Settings tidy (Dan, 8 October):** One Memory card replaces both Memory and 'Memory and retrieval': the automatic-capture switch, then 'What Jarvis remembers about you' (only memories Jarvis kept from conversations; vault notes stay in Knowledge, so no folders or sync counts), searchable, with a detail pane that opens on selection to correct or forget, then 'How Jarvis recalls' (match, graph links, memories per answer). Global is renamed Limits. Save settings is a plain right-aligned row at the very end of the page, below Projects and Routines, with no floating glass pill. Section headers no longer paint a slab on hover: the title gains a faint cyan glow and the chevron turns cyan and nudges.
- **Wake word (P9-17, 8 October):** When the PC bridge hears “Wake up Jarvis”, the open Jarvis page on the computer starts voice by itself and shows a short “Heard ‘Wake up Jarvis’” toast; the bridge's own chime is the sound. Phones ignore the wake word. A background tab waits up to 4 s for the bridge to bring it forward; if the browser will not play sound yet (no click on the page since it loaded), the toast asks for one click on the orb instead of failing silently. Settings → Voice shows a Wake word line with the last detection time and its outcome (started, already on, needs a click, background, error), in red only when voice did not start.
- **Window rims (Dan, 8 October):** Content windows (reports, apps, views) wear a thin 1 px amber rim with a slow brighter glint travelling round it once every 16 s; focus brightens the rim instead of adding a thick cyan ring, and dragging shows a faint amber outline. Reduced motion holds the glint still. The conversation window keeps its own rim because it joins the composer.
- **Charts and window titles (Dan, 8 October):** Generated `chart` views are drawn as SVG instead of a table: line (fitted to the data), bar and area (from zero), a hairline grid, cyan then amber series with softer variants for a third to fifth, a legend for two or more series, lines that draw in once (static under reduced motion), and the values under "Show values". The SVG is laid out at its real width, so axis text stays 11 px on a phone; x labels are the real values (years print as 2019), thinned evenly. Window titles are centred on the same line as the window buttons, with a little air above.
- **Window management (P8-42, Dan, 8 October; in progress):** The page arranges windows itself; Jarvis steps in only on request. Each window is *auto* (smart fit: one large and centred, two side by side, three = one big left plus two stacked right, four = grid, five or more = cascade), *region* (placed left, right, top, bottom, centre or full; auto windows fit the remaining space) or *manual* (dragged or resized by Dan, or moved by coordinates; left alone until "tidy up"). Side by side falls back to cascade when a window would be narrower than about 480 px. The cascade offsets cards about 32 px down and right, newest in front, every title visible. Windows glide about 300 ms (interruptible; instant under reduced motion). Phones keep one window at a time: geometry requests focus the named window and "minimise all" sends everything to tabs. Pinned windows have a pin button in the title bar and one pin toggle on their tab, return as tabs on every device after a reload, and closing them sends them to the tab bar; only unpin lets them go. The old tiled/layered switch maps to auto/cascade.
- **Window tabs (Dan, 10 October):** compact rounded rectangles replace pills, with a consistent window icon and a readable, trimmed title. One pin toggle replaces the duplicate leading pin/status icon; tilted/untilted shapes and `aria-pressed` distinguish unpinned/pinned states, with labelled actions and pending disablement. Close remains available only on unpinned tabs. Selected tabs use the shared selected surface and stronger text, while hover/focus/press use the shared control language. Controls are 32 px on desktop and 44 px on touch. Crowded desktop tabs scroll instead of squeezing away their actions; the phone list expands above windows, with full-width rows and no desktop title cap.
- **Orb (8 October):** the room's orb stays in one place on every screen; windows and controls move around it. Its amber core is livelier: a slow heartbeat and a second train of signals firing along the filaments when dormant, a stronger inward pull and racing filaments while thinking or using tools, and in voice it follows the microphone while listening and pushes its sparks outward with speech.
- **Orb ring accents (Dan, 10 October):** the orange inlays around the orb match the floor's vibrant amber instead of fading into the rear room. They use the existing warm colour, bypass fog and tone mapping, and have a slightly wider, still-fine profile. Floor lighting, the cyan shell and motion stay unchanged.
- **Presence on phones (P9-44):** a touch device with a phone-sized screen sets On the move, a computer sets Present (source `device`), once on opening and again after 10 minutes in the background; a manual choice from the last two hours is never overridden.
- **Side panels:** the grid column eases open and shut with the slab, the slab swings back to its hinge with a slight blur when it closes (not only when it opens), and its contents settle in just after the glass. Fixed widths during the move keep text from re-wrapping; dragging a panel edge has no easing.

Evidence: local fixture captures from a stubbed sign-in harness (desktop 1480×1000 dark, phone 390×844), plus Dan's live review against the production backend in the local dev server. Hardware-GPU motion, light theme and physical phones still need Dan's check after deployment.
## Folio — 7 October 2026 (proposed, [#519](https://github.com/DanAakesen/jarvis/issues/519))

The Folio is where everything Jarvis has pulled up lives afterwards. It replaces the idea of a "windows" or "research" page.

- **Entry:** a Folio icon on the left rail (stacked pages). It opens the left pane; the stage and any open windows stay in place.
- **Pane:** a search field at the top, then kind filter chips (Reports, Apps, Images, Graphs). Pinned items come first, then Today, This week and Earlier. Each row shows a kind icon, the short title, and the time; hover shows the one-line prompt summary.
- **Open:** a click reopens the item as a workspace window, or focuses it when already open. Rows offer pin, rename and delete (delete asks first).
- **Jarvis:** "pull up the Ignite research again" reopens the best match and highlights it in the pane when the pane is open.
- **States:** loading skeleton rows, an empty state that explains what will appear here, a no-results state with a clear-search action, and an error state with retry.

## Chat attachments (#649)

Attachments reuse the composer glass. **Attach file or photo** is the first
item after Language in the More menu; paste and drop work without it, and a
drop shows a focus-coloured rim and "Drop files to attach them". Pending files are
chips under the message row: thumbnail or file glyph, name, type · size, a
progress bar while uploading, a note when Jarvis cannot read the file, error text
and a 44px Remove button. Sent files appear as compact glass buttons on the
message and open on demand; an expired file is disabled with an explanation. A
publication confirmation adds the image and a warm warning surface stating
that the repository is public. Text, not colour alone, conveys every state; no
new animation is introduced.

## Daily migration visual requirement (12 October 2026)

17 October brief-history source continuation reuses the existing collection
selector, exact paging and in-page detail/back interaction. Historical timestamps
remain verbatim with explicit stored-order/timezone limitations; no calendar
filter implies a fabricated timezone. Plain stored body text is escaped, not
executed HTML; structured bodies stay inspectable as JSON. Keep historical status
and delivery labelled as historical. No additional page, notification settings
or generation/send controls are introduced.

### Current Daily scope (15 October 2026)

Dan excluded new P12-08/#723 coaching/recovery/recomp automation. Preserve one
Daily page plus existing on-demand GenUI in the single assistant conversation:
no widget, separate Workouts/Nutrition pages or four mandatory native command
views. Existing health/nutrition/workout tracking and retained records are not
removed. Do not add coaching controls or generated coaching views under #724.
Earlier issue/view descriptions are historical where they conflict with this
confirmed scope; exclusion is not completed acceptance or UI implementation.
Existing Jarvis styling, accessibility, mobile/browser and protected migration
gates remain unchanged.

17 October inactive page source: use one shared-shell record browser, not a
dashboard of invented summaries. A labelled collection selector and applied
Copenhagen period precede the returned records. Exact opaque cursors, record
details, source/read-time/coverage labels and separate receipt/processing/phone
contact evidence make partial data inspectable. Tables retain zero and unknown
as different states. Optional existing `ChartView` bars represent individual
numeric observations on the current page, with units and distinct same-date
points; no client averaging or interpolation. The table remains available.

Reuse the existing glass page surface, secondary actions, field/control radius,
selected states and focus tokens. Real browser inspection found native grey
actions and insufficient contrast over the room; shared controls and the
existing translucent page surface replace them. Retain the phone chat dock and
shared navigation. Wide record tables scroll within a labelled, keyboard-focusable
region rather than crushing dates and unknown values into single-character
columns at320px. This source is default-off and synthetic-browser inspection
does not establish live records, import completeness or physical-phone acceptance.

18 October overview first (P12-15 / #730): Dan could not tell what was built, so
Daily opens on an overview, not a table. Under one h1 and one line of body text,
"What Daily holds today" lists a row per collection the backend exposes: its name,
a text status, one plain sentence on what it is for (static copy, no figures),
whether it is limited to the last seven days (Europe/Copenhagen), the time it was
read and an Open button. Open takes that collection into the record browser above;
Back to overview returns with focus on the row just opened. The overview shows no
counts, totals, averages or charts, because nothing it can read cheaply is one. A
read-only check of one record decides the status: Has records, None returned
(older records may exist; this does not prove the original source is empty) or
Could not read (the safe failure sentence, with Retry beside Open). Status is an
icon and a word, never colour alone.

Checking is the shared inline text loader inside the status pill. A settled
result stays visible while the next read runs, so a refresh never blanks the list;
only a failed row returns to Checking, because it is being retried and should not
repeat an old error. Availability loading uses the shared rows loader. An
availability failure is one alert with Retry availability, a backend with no
browsable collection says so, and Refresh overview exists only while there are
rows. Reads run two at a time because the backend shares a small SQL pool with
chat. On a 390 px phone each row is one column, with Open and Retry side by side
and 44 px tall; from 760 px the actions sit at the right of the row. The page
reuses the existing Daily layout, the secondary button and the existing colour,
radius and spacing tokens. The only motion is a short fade when a status changes,
which reduced motion removes.

Checked in an isolated headless Chromium, rendering the real overview with the
real stylesheet over a synthetic `fetch`, at 390×844 touch in dark and light, 320
dark, 768 light and 1280 dark. States seen: every row checking, settled rows, none
returned, a failed row with Retry and its recovery, availability errors (not
found, forbidden, unavailable), a backend with no browsable collection, a hanging
availability request, Open to the browser and Back, a refresh in progress and the
keyboard focus ring. No horizontal overflow at any of those widths, and Open and
Retry measured 44 px tall. The console showed only Vite and React development
notices on the page inspected. Limits: synthetic responses with no live backend,
private data or real sign-in; the harness has no 3D stage, header or MSAL;
`prefers-reduced-motion` was not emulated; the Daily-off path is covered by the
App tests, not the browser. Local runs are not qualification.

18 October 2026 (P12-20): Daily now keeps that overview inside one page-level
heading and body line, followed by Overview, Briefs and Data tabs and the active
section. The tabs expose selected state semantically and by stronger text weight
and a complete selected surface; narrow screens get a contained horizontal tab
scroller, with 44 px controls and visible focus. Data alone shows the shared
period control. Preset and custom date changes use Europe/Copenhagen calendar
dates and reject reversed, impossible or over-366-day ranges before a read.
The period slot retains its height while switching tabs so section content does
not jump when the Data control appears or disappears. Sections keep their
existing page and control geometry; each owns its content
stylesheet and separately lazy-loaded component. Workouts, Nutrition and Body &
sleep remain absent until their follow-up sections exist.

Checked the section shell in isolated Chromium against only synthetic capability
and query responses at 320, 390×844, 768 and 1440×900 in light and dark, with
reduced motion. Overview, Data and brief detail, keyboard/URL switching, shared
period retention, custom-range rejection and the chart were exercised. The page
did not scroll sideways, tab and Open targets measured 44 px, the section panel
kept the same top position across a tab switch, and the browser console had no
page errors. Scratch screenshots were kept outside the repository; this is not
signed-in shell, live-backend or private-data acceptance.

18 October on-demand views (P12-16 / #731): when Jarvis shows Daily data on
request, it reuses the existing generated-view renderer, workspace window and theme.
There is no Daily renderer, skin or page. Under every table, chart or detail view
sits one source footnote in the muted caption style (13 px as measured), directly
below the data and capped at 72 characters wide. It is always visible, never behind
a disclosure, because the source, the period, the read time and "completeness and
freshness are not established" are part of the answer. List and text views do not
render it: they carry their own note in their content, and an empty-read text view
puts its own read time in its sentence. Table cells keep whole words and numbers,
never split mid-token; a wider table scrolls inside its own region, and below 700 px
the cell padding tightens sideways so a narrow table fits a 390 px window without
clipping its last column.

Checked in a headless Chromium rendering the real workspace window, real stylesheet
and real builder output. Phone, 390×844 at 3× scale, dark and light: a measurements
table and chart with a worst-case note, a sleep chart, a workouts table, a sync
detail and an empty read. Desktop, 1280×800: the measurements table and chart across
both themes. Seen: no horizontal overflow, the footnote inside the window, whole
words in every cell, and no console errors or warnings. Inspection also caught two
defects that are now fixed: table cells splitting values across lines, and an empty
read showing no read time. Limits: synthetic records; the harness has no sign-in, 3D
stage or navigation rail; keyboard focus and OS reduced-motion were not exercised;
wider tables (sleep, meals) scroll sideways at 390 px by design. Local runs are not
qualification.

Confirmed by Dan for #730/#731/#732/#726: all migrated React/rich UI fully follows the current Jarvis layout and styling. Current DESIGN.md direction, `apps/web/src/styles.css` tokens, shared components, theme/density/motion settings and native phone/workspace patterns are the source of truth. Preserve capabilities and data semantics while restyling/recomposing legacy Daily content; do not carry its navy/plum/card skin, create a second theme or replace the shared shell, voice or window manager. Generated/ad-hoc views receive only safe trusted Jarvis theme context through the existing bridge, without widened permissions. UI issues require full mobile-first real-browser visual acceptance. P12-03 remains backend/schema-only; this records the standing direction, not completed visual work.

## P14-01 shared surface follow-up (18 October 2026)

The existing design direction and CSS tokens remain canonical; this pass adds no
theme or UI library. Settings sections and the sticky save bar use the same
panel surface, neutral boundary and panel radius as equivalent content panels.
Background work and attention use one opaque popover surface. Daily and Proactive
block-level errors pair their alert text with the existing error surface while
inline field errors stay beside the field. Menu and row actions use the shared
visible keyboard outline. See [the UI audit](docs/ui-audit.md) for the observed
variants and remaining workflow-specific layouts. Local synthetic Chromium
inspection covered the phone and desktop sizes in both themes, plus reduced
motion. The attention event and healthy Daily/Proactive data states were not
available in the harness; screenshot captures could not be attached to the PR.

## Border, radius and surface rules (P14-04, 18 October 2026)

Use `--radius-control`, `--radius-panel`, `--radius-window` and `--radius-pill`
for their matching roles; reserve `50%` for circles and `0` for square edges.
Structural separators use a single 1px `--rule` or `--control-rule` border.
Selected and status states use shared surfaces, text or icons, never a colored
edge alone. Use real neutral borders instead of inset-shadow borders. Panels,
popovers, rows and hover states reuse the existing surface roles and
`--panel-shadow`. Keep exact, reasoned exceptions in the stylesheet ratchet.
