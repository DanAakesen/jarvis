# Features

The complete list of what Jarvis does or will do, for UI design and planning. Each row names where Dan uses the feature and how far it has got. Requirements live in [PRODUCT.md](../PRODUCT.md) and tasks in [PLAN.md](../PLAN.md); this file is the index.

**Keep it current:** every task PR that adds, changes, removes or verifies a feature updates its row here (see [Finish a task](agent-context.md#finish-a-task)). New planned tasks add their rows as Planned.

## Legend

| Status | Meaning |
| --- | --- |
| **Live** | Verified in production |
| **Built** | Implemented and tested offline; not yet verified in production |
| **In progress** | A task is being implemented |
| **Planned** | A task exists in PLAN.md; not started or waiting for a decision |
| **Gap** | Described in the docs but missing in the code; a task is linked |

| Surface | Meaning |
| --- | --- |
| **Screen** | Used on a page |
| **Voice/chat** | Used by talking or typing to Jarvis (a Jarvis tool) |
| **Both** | On a page and by voice/chat |
| **Phone** | Away from the browser: Teams app or phone |
| **Background** | Runs without Dan; shows only its effects |

Status as of 5 October 2026.

## Jarvis: conversation and voice

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Sign-in | Sign in with his Microsoft account; everyone else is refused | Screen | All pages | Live | P0-08, P0-09 |
| Chat | Open at the latest messages with typing focus; Enter/Send steers a reply in progress, retaining its partial response as interrupted; tool execution continues until the next round boundary picks up new messages; Ctrl+Enter adds to the removable FIFO queue, whose bubbles show Queued and captured language with an accessible count; queued turns advance after success or error; failed-turn feedback and next drafts survive; thinking precedes open-surface Markdown streaming; history refresh dedupes saved messages by ID. Send, language and voice entry remain available during replies; starting voice leaves the chat reply streaming into history. The queue is local to the mounted conversation, not persisted across navigation/reload. | Screen | Main page | Built | P4-03, P4-06, P4-09, P8-05, P8-21, P8-24, P8-25, P8-26, P8-35 |
| English voice | Talk to Jarvis in English (gpt-realtime, Ryan HD, British butler persona) | Voice/chat | Main page | Built | P5-03, P5-04 |
| Danish voice | Talk to Jarvis in Danish (MAI Transcribe, Harper) | Voice/chat | Main page | Built | P5-02, P5-04 |
| Interrupt and reconnect | Interrupt Jarvis by speaking; voice reconnects automatically | Voice/chat | Main page | Built | P5-04 |
| Language toggle | Switch Danish/English from the shared More → Language menu in the composer and voice bar; during voice the change applies to chat and the next voice session, and the bar says so | Both | Main page, Settings | Built | P5-05, P8-36 |
| Voice transcripts | Read what was said in each voice sitting, with voice minutes | Screen | Main page | Built | P5-06 |
| Task context | Jarvis knows running tasks and recent events without asking | Background | — | Built | P4-04 |
| Honest confirmations | Jarvis reports refused or failed actions as such, never as done | Voice/chat | — | Built | P4-05 |
| Software Factory tools | Ask Jarvis to list projects and tasks, create tasks, change the agent or model on a Ready task, and steer, pause, resume or cancel tasks | Voice/chat | Main page | Built | P4-10, P7-11 |
| Image generation | Ask Jarvis to create an image with the existing ChatGPT/Codex subscription; open it in the workspace and inspect its saved artifact in chat history | Both | Main conversation and workspace | Built offline; live Codex and Blob acceptance pending | P7-15 |
| Model switching by voice | Change Jarvis for the next session or a Ready task using verified provider options; running-task changes are refused | Voice/chat | Main page | Built (offline) | P7-11 |
| Live status by voice | Jarvis announces important task changes and answers "what's going on?" | Voice/chat | — | Built (offline) | P7-12 |
| Long-term memory | Recall relevant stated preferences, project facts, decisions and unfinished tasks with Dan's source; inspect, correct or forget them | Voice/chat | — | In progress | P7-13 |
| Live voice test | Dan's verdict on Danish and English voice | Voice/chat | — | In progress | P5-07 |
| Reflex layer | Jev classifies stable voice clauses early with a per-turn ledger; only complete, high-confidence reversible actions execute on partials, and contradictions are undone where supported. Unsafe/confirmation-required actions wait for the final turn. | Voice/chat | Main page | Built offline; live verification pending | P7-04, P7-20 |

## Main page overview

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Now panel | See away/present mode, running tasks, tasks needing attention, releases, deployments and credential warnings; dismiss items | Screen | Main page | Built | P1-13, P7-02 |
| Sleep switch | Put the backend to sleep or wake it; refused while tasks are active | Screen | Main page | Built | P1-12 |
| Database waking | Pages wait and show "waking" while the paused database resumes | Screen | All pages | In progress | P1-14 |

## Software Factory: tasks

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Task board | See tasks in columns by state with live updates; filter and search | Screen | Task view | Built | P1-08 |
| Factory release bar and task lens | Approved task-board composition with selected-project release/commit context and a closable right task-details pane; reuse existing controls and source data | Screen | Factory task view; contextual right panel | Built offline; live integrations unverified | P8-34 |
| Create task | Create a task (project, agent, text, optional model/reasoning) | Both | Task view; by voice once P4-10 lands | Built (screen) | P1-04, P1-08, P4-10 |
| Task detail | See header, full event timeline, sandbox sessions, disk readings, usage | Screen | Task detail | Built | P1-09 |
| Task controls | Steer, pause, resume, cancel, and continue after a completed turn's session expires | Both | Board, task detail; by voice once P4-10 lands | Built (screen) | P2-07, P2-14, P4-10 |
| Recover crashed task | Restart a task after an active-turn crash from its branch in a new sandbox | Both | Task detail | Built (offline) | P2-10 |
| Continue after idle expiry | Expiry preserves task state; Continue or a steering correction starts a new session on the existing task branch | Both | Board, task detail; steering tool | Built (offline; regression fix) | P2-14 |
| Sandbox per task | Each task runs Codex or Copilot in its own Foundry sandbox that closes after delivery or cancel | Background | — | Live (start and events); repo clone in progress | P2-02, P2-04, P2-05, P2-13 |
| Agent and model per task | Choose Codex or Copilot, model and reasoning per task | Both | Create task | Built | P2-11 |
| Repository workspace | Sandbox clones the project repo and works on `jarvis/task-…`; agent questions surface in Needs attention | Background | — | In progress | P2-13 |
| Frequent pushes | Agents push work in progress after each step | Background | — | Built | P2-09 |
| GitHub App tokens | Sandboxes push with one-hour tokens scoped to the task's repository | Background | — | Built (enabled; live push check after P2-13) | P3-02 |
| Heartbeat and crash detection | Active invocation failures move the task to Needs attention; completed-turn expiry preserves task state, including first-poll and cleanup races; only tracked sandboxes are polled, so idle does not cause recurring SQL heartbeats | Background | Backend logs | Built offline | P2-06, P2-14, P5-13 |
| Disk headroom | Low disk moves a task to Needs attention instead of failing | Background | Task detail | Built | P6-07 |
| Codex limit handling | A Codex usage-limit stop is reported clearly; other tasks continue | Background | Task detail | Built | P6-05 |
| Parallel tasks | Several tasks run within global and per-project limits | Background | Settings | Built (offline load test) | P2-05, P6-05, P6-08 |

## Software Factory: GitHub, projects and releases

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Projects list | See managed projects, edit or archive them | Screen | Projects | Built | P1-10 |
| All repositories | See every repository and "Manage with Jarvis" | Both | Projects | In progress | P3-13 |
| New project by voice | Give a name and description; Jarvis creates and scaffolds the repo from the templates | Voice/chat | — | In progress | P3-12 |
| New projects defaults | Owner, visibility, templates, agent, policy, limits for new projects | Screen | Settings | Built | P3-11 |
| Webhook receiver | Verify GitHub signatures; persist mapped events only for active managed repositories, acknowledging unsupported or untracked events without SQL | Background | — | Built offline; live webhook setup pending | P3-03, P5-13 |
| PR, run, release and deploy records | Webhook events stored as pull requests, workflow runs, releases, deployments | Background | — | Built (live webhook setup pending) | P3-04 |
| Checks loop | A failed task-PR check is stored in private Blob and sent to the same task; bounded repairs move to Needs attention when exhausted | Background | Task detail | Built | P3-05 |
| Project policy and merge | On task completion, open or reuse an App-backed PR only when the task branch is ahead of the default branch; record refusals as Needs attention, then stop at a verified green PR or squash-merge via the GitHub App when checks, branch freshness and protection rules pass | Background | Project settings; task detail | Built offline with fake GitHub coverage; coordinator live test-repository acceptance pending | P3-06, P3-14 |
| Release records | One release per merge to `main`, linked to runs and deployments by SHA | Background | — | Built (live webhook setup pending) | P3-07 |
| Release view | Git graph, releases, runs and deployments per project | Screen | Release view | Built | P3-08 |
| Workflow templates | Managed projects copy PR-check and release workflows | Background | — | Built | P3-09 |

## Settings, usage and operations

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Settings | Jarvis, voice and coding-agent defaults; global limits; app-wide light/dark appearance | Screen | Settings | Built | P1-11, P8-13 |
| Jarvis model per session | Model and reasoning for new Jarvis sessions | Both | Settings; by voice with P7-11 | Built | P4-07 |
| Personality preferences | Choose a tone and response style, and add bounded instructions for new chat and voice sessions | Both | Settings, chat and voice | Built offline; live Azure behavior unverified | P7-16, P8-19 |
| Credentials status | See credential expiry and renewal status (never values) | Screen | Settings | Built | P2-08 |
| Codex login renewal | Daily automatic renewal of the Jarvis Codex login | Background | Settings | Built | P2-08 |
| Usage and cost | Sandbox, model, voice, Codex and Copilot usage per task, project, period, plus the current UTC-day web-research call count | Screen | Usage | Built offline | P2-12, P6-01, P7-14 |
| Event archive | Old task events move to Blob and load on demand; idle checks skip SQL until a sandbox is active | Background | Task detail | Built offline | P6-03, P5-13 |
| Alerts | Failed deploys, sandbox crashes, credential expiry, budget 80 % | Now + email | Main page; email-only Azure Monitor action group | Built (offline; live Azure delivery unverified) | P6-02 |
| Backup drill | Database restore documented | Background | — | Planned | P6-04 |
| Runbook | Deploy, rollback, key rotation, task recovery, sleep, and temporary SQL access | — | [Operations runbook](runbook.md) | In progress | P6-06 |

## Jarvis everywhere (P7)

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Teams calling | Call Jarvis from the Teams app through ACS Call Automation; only Dan's verified Teams Entra identity is accepted | Phone | Teams | In progress; ACS relay and live call remain unverified | P7-01 |
| Away mode | Toggle by voice/chat, automatic Teams Away/Offline detection after ten minutes, and automatic return to present on active browser use; see mode in Now and route task updates and approvals to Teams while away, browser while present | Both | Main page, Phone | Built offline; Graph admin consent and live phone check pending | P7-02 |
| Phone confirmations | Receive Dan-only Teams notifications and approve or reject actions with optional Speech F0 voice notes | Phone | Teams | Built offline; live Azure/phone check pending | P7-03 |
| Screen sharing | Share a screen or window; request an in-memory vision description and, for browser tasks, pass its selected display label only as transient context | Both | Main page | Built offline; live vision/form check pending | P7-05, P7-19 |
| Local PC bridge | Jarvis opens websites in Dan's foreground Chrome when its extension is connected and automation is on; if disconnected, the bridge launches Chrome directly, never Edge or the Windows default browser. It fuzzy-matches app names against user/common Start-menu shortcuts and AppsFolder, returns candidates when ambiguous, opens folders under `C:\Repo` in VS Code, reports the active window title, and focuses an exact-title window | Voice/chat | PC companion | Built offline; live Windows/Chrome acceptance pending | P7-06, P7-26, P7-31 |
| Ultrafast browser agent | Complete bounded Chrome tasks with Jev-selected operations and observed targets; TYPE text is generated by Foundry, DONE is independently checked, irreversible clicks require P7-03 approval, and current progress appears in a workspace window | Voice/chat | Backend `browser_do`; P8-15 workspace; PC bridge | Built offline; 0.07 ms fake median per step; live Jev/Foundry/Chrome/approval checks pending | P7-17 |
| Chrome browser executor | With Dan's explicit bridge toggle on, open URLs in a new active tab and bring Chrome forward; list tabs, snapshot visible controls, and run fresh, unobstructed indexed actions in his signed-in Chrome. Sensitive typing is blocked and only irreversible clicks need confirmation | Voice/chat | PC companion; authenticated backend tools | Built offline; foreground-tab acceptance in Dan's normal profile pending | P7-18, P7-26 |
| Act on the shared tab | Resolve the page Dan shares from its transient title and vision description, ask if ambiguous, and run the bounded browser agent with spoken progress and “stop” | Voice/chat | Backend `browser_do_shared`; P8-15 workspace; PC bridge | Built offline; live form, voice and approval check pending | P7-19 |
| Computer use | Control any foreground Windows app through bounded UI Automation; Jev chooses one action from each fresh snapshot. Typing is limited to exact quoted non-sensitive text, and irreversible actions require P7-03 approval. Websites remain on the Chrome browser path; no Foundry computer-use is used | Voice/chat | Backend `pc_act`; PC companion | Built offline; live Windows/Jev/approval check pending | P7-07, P7-31 |
| Media controls | Play/pause, skip tracks and adjust or mute volume with fixed Windows media keys. These reversible actions work through chat, voice and Jev reflexes without confirmation | Voice/chat | Backend `pc_media`; PC companion | Built offline; live Windows/media-device acceptance pending | P7-31 |
| Camera | Turn on the webcam from the shared shell and ask Jarvis by chat or voice to inspect a single frame; camera state times out and stops with the session | Both | Shared top bar, main conversation | Built offline; live camera/model check pending | P7-08 |
| Calendar and mail | Google Calendar agenda, date-range search and next appointment, free slots, create/move meetings, Gmail search and summaries, reply drafts and sending after exact confirmation | Voice/chat | Backend tools; no new page | Built offline; Google OAuth setup and live range/next-event acceptance pending | P7-09, P7-22, P7-28 |
| Second brain | Search Dan's configured OneDrive notes folder and quote snippets with links | Voice/chat | — | Implemented offline; Graph setup and live search pending | P7-10 |

## Jarvis UI enabling logic (P8-03)

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Complete Jarvis front end | One designed UI for all features above | Screen | All pages | Planned | P8-01, P8-04–P8-13 |
| Shared app shell and area navigation | Navigate areas from the rail/sidebar; show Jarvis once on home and the area/page on deeper routes; open Settings from the top-right; toggle the camera with an accessible on/off state | Screen | All pages | Built | P8-04, P7-08, P8-22 |
| Conversation opening and voice entry | See the conversation on arrival, type from the bottom-centred composer, and explicitly start voice from the small orb; separately enable the microphone, and restore the draft and typing focus on exit | Both | Main page | Built (offline/browser fixtures) | P8-05 |
| Workspace composition | Arrange temporary tiles or layers; drag titles, resize edges, or use Move/Resize arrow keys from the per-window overflow; reflow on narrow screens with reduced-motion-safe lifecycle feedback | Screen | Main workspace | Built (client; generated/agent-delivered views remain separate) | P8-06, P8-07, P8-21, P8-22 |
| Dynamic workspace views | View accessible information in temporary, question-relevant windows and ask Jarvis to create or arrange them | Screen | Main workspace | Built offline; live agent delivery unverified | P8-06, P8-14, P8-15 |
| Window tabs and restore | Minimise a view without closing or saving it, then restore it from its tab or by asking Jarvis | Both | Main/voice workspace | Built offline; live agent delivery unverified | P8-07, P8-15 |
| Contextual right panel | Open, close, or change relevant information without replacing the main content | Both | Main workspace | Built offline; live agent delivery unverified | P8-08, P8-15 |
| Runtime-state orb | See listening, thinking, tool-call outcomes, speaking, interruption, reconnect, and failure states from typed runtime activity; listening appears only after voice readiness and observed microphone audio | Screen | Voice workspace | Built offline; live Azure/physical audio unverified | P8-09, P8-16 |
| Desktop voice workspace | Enter full-page voice, carry open views across modes, and restore the typing layout; optionally minimise windows on entry (off by default) | Voice/chat | Main page | Built offline; voice presentation uses P8-20 tokens and P8-22 window chrome; generated workspace delivery remains P8-15, tool activity P8-16, and preference persistence P8-17 | P8-10, P8-14, P8-15, P8-16, P8-17, P8-23 |
| Phone workspace | Show one foreground view, switch by swipe, named/keyboard controls or client request, and dock active voice below content; return the orb to the main space with no content | Phone | Jarvis on phone; compact typing top bar and composer | Built offline; real components verified with labelled fixtures, authenticated agent delivery remains P8-15 and physical-phone acceptance unverified | P8-11, P8-23 |
| Manual voice-end affordance | Use the selected manual end control and Escape-key behavior without changing natural spoken ending | Both | Voice workspace | Implemented in P8-10 per the P8-12 decision; P8-23 groups End voice with the orb actions | P8-10, P8-12, P8-23 |
| Theme controls and client persistence | Choose and persist light/dark/system appearance across visits; system follows the OS, semantic theme variables update across the app, and the same Jarvis room is re-lit without remounting. Approved theme tokens remain on the existing P8-17/P8-18 allowlist. | Screen | Shared shell, Settings and Jarvis stage | Built offline; local Chromium confirms same-canvas OS updates; live settings remain unverified | P8-13, P8-32 |
| Shared visual and motion system | Use Concept B's living aurora in dark mode and Concept C's daylight surfaces in light mode; see readable, responsive feedback tied only to real chat/voice state and playback audio | Screen/voice | Current shell, conversation, tasks, projects, settings and usage | Built offline; live auth/settings/voice remain unverified | P8-20 |
| Conversation and workspace concept polish | Start from a calm greeting and compact floating composer; read divider-free messages, live caret and quiet metadata; operate translucent windows and Now cards with purposeful, reduced-motion-safe feedback | Screen | Main page and client workspace | Built offline; local screenshot fixtures, not live agent delivery | P8-21 |
| Agent-directed workspace views | Ask Jarvis to create, update, show, close, minimise, restore, focus, move and resize views, and change the layout or contextual panel | Both | Main page and voice workspace | Built offline; live chat/voice delivery unverified | P8-15 |
| Generated data views | Inspect accessible information in temporary, typed views using registered renderers | Screen | Now feed and temporary workspace | Built offline; live data/tool acceptance unverified | P8-14, P8-06, P8-15 |
| Runtime activity | See actual listening, thinking, tool-call start/outcome, speaking, interruption, reconnect and failure states; keep activity transient and free of conversation/tool data | Both | Main page and voice workspace | Built offline; live Entra/Foundry and physical voice remain unverified | P8-16, P8-20 |
| Persisted UI preferences and themes | Change light/dark/system appearance, approved theme tokens, and whether windows minimise when voice starts (off by default) | Screen | Settings and shell | Theme and voice-window preferences persist through P8-17; generated views remain transient | P8-10, P8-13, P8-17 |
| Generated-view and theme capabilities | Use the initial safe renderer/action and adjustable theme-token allowlists | — | UI planning | Decision recorded; implementation remains with P8-14/P8-15/P8-17 | P8-18 |

### Enabling-logic coverage

This coverage is for backend-enabling requirements in [ui.md](../ui.md); shell composition and client-only interactions belong to the companion P8-02 breakdown. P8-02 allocated P8-04 through P8-13 to frontend tasks in PR #233. P8-10 is implemented on the client without waiting for future contracts; P8-14/15/16 now provide the data, commands, and activity consumed by the related views. P8-11's phone workspace is complete offline, and P8-13 consumes P8-17's preference path.

| Confirmed UI requirement in scope | Existing capability or issue | Coverage and owner |
| --- | --- | --- |
| Agent-callable view operations, layout changes and contextual-panel open/close | P4-02 (#49) supplies the authenticated tool registry and dispatch; P4-05 (#52) supplies honest confirmations; P4-10 (#219) registers Factory tools over existing services. | **Implemented offline: P8-15.** One validated, session-scoped tool delivers commands over the authenticated Now event stream and waits for client acknowledgement; bounded pending work, command IDs, timeout and cancellation handling preserve honest outcomes. The browser owns geometry and presentation. |
| Typed visual views over accessible data, including safe renderer capabilities and bounded detail | P1-03 (#17), P1-04 (#18), P1-13 (#136), P2-12 (#38), P3-07 (#45) and P6-03 (#64) provide bounded project, task, activity, usage, release and archived-event data; P4-10 (#219) exposes selected Factory data to Jarvis. | **Implemented offline: P8-14/P8-06.** Shared versioned schemas validate and bound view data; fixed React renderers display typed payloads in temporary workspace windows and the contextual panel. Generated HTML, JavaScript and CSS are never executable input. Live data/tool acceptance remains unverified. |
| Listening, thinking, tool-call and speaking activity reflects actual runtime state | P5-03 (#57) and P5-04 (#58) provide the English/voice relay; chat streams user/delta/done/error; P4-05 records ok/refused/error tool outcomes. P7-12 announcements use the same observed voice output path. | **Implemented offline: P8-16/P8-20.** The backend publishes typed ephemeral events on authenticated `/now/events`; chat tools publish their recorded outcome, voice uses observed relay events, and shared speaking activity includes P7-12 announcements without duplicating them. The client shows actual activity in the orb/top bar and shimmers only the window Jarvis updates. Payloads exclude transcript text, tool arguments/results and secrets; live delivery remains unverified. |
| Voice/typing transitions preserve the active workspace; window create/close/minimise/restore/focus/move/resize and layout remain transient | `ui.md` confirms these workspace lifecycle rules. No backend view store or state-persistence task exists or is needed; P4-03/P5-06 retain conversation history/transcripts independently. | **Client behavior: P8-10/P8-11.** P8-15 carries agent-directed commands only. Ending voice or closing a view must not delete saved conversation or source data. |
| Generated views are unsaved while theme preferences persist and can change dynamically | P1-11 (#25) provides the existing persistent, validated settings store and API, but its schema has no UI theme or voice-window preference. | **Gap: P8-17.** Extend the existing settings/tool path for confirmed preferences; the frontend applies updates dynamically under P8-13. Do not persist generated views. |
| Data available through Jarvis is inspectable without duplicating integrations | Existing issues own feature data and integrations: P3-08 (#46) releases; P7-05/06/07 (#203–205) screen share and PC capability; P7-08 (#206) camera; P7-09/10 (#207–208) calendar/mail and notes. Banking and Fitness/Health details are deferred. | **Covered by those features plus P8-14's bounded data contract.** No new PC vendor issue; no Banking or Fitness/Health integration work is authorized here. |

#### Deferred decisions (needs-decision)

- P8-18 records the initial generated-view renderer/action and theme-token allowlists in `ui.md`; P8-14, P8-15, and P8-17 implement them. The five-theme example is not a requirement.
- P8-20 completes the shared orb styling and page motion system; desktop voice mode transitions are implemented in P8-10 and phone view switching remains P8-11. P8-12's manual voice-end/Escape decision is recorded in DESIGN.md and implemented by P8-10.
- Banking and Fitness/Health integration detail remains deferred. Dan withdrew the proposed PC vendor integration; do not create an issue for it.

## Additional accepted Jarvis capabilities (planned)

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Long-term memory | Recall preferences, decisions and unfinished work across sessions; inspect, correct and forget retained memories | Voice/chat | Existing conversation; dedicated management UI undecided | Planned (storage, capture and retention decisions open) | P7-13 |
| Web research | Use the existing ChatGPT/Codex subscription for bounded, source-linked research in chat/voice and dynamic views | Both | Conversation and dynamic workspace | Built offline; live Codex/Foundry acceptance pending | P7-14; existing P8-06/P8-14/P8-15 consumers |
| Image generation | Generate with Dan's ChatGPT/Codex subscription, inspect truthful job status, and view the private artifact in chat and the workspace | Both | Conversation and dynamic workspace | Implemented offline; live subscription/Blob acceptance pending; retention unresolved | P7-15; existing P8-06/P8-14/P8-15 consumers |
| Editable personality | Set tone/response-style and custom-instruction defaults for new sessions; reset to the current default | Screen | Settings → Jarvis → Personality | Built offline; live Azure behavior unverified | P7-16, P8-19 |

Dan accepted these features on 4 October 2026. On 5 October he selected the
existing ChatGPT/Codex subscription for image generation. Its usage is shared
with coding tasks; no pay-per-image API or fallback is used. Video is deferred
indefinitely to a separate issue, and artifact retention remains unresolved.
Notes search remains #208 and is not a replacement for long-term conversational
memory.
Dan accepted these features on 4 October 2026. No new provider or paid service
was selected, and no implementation was started by this planning change. Notes
search remains #208 and is not a replacement for long-term conversational memory.
The first video's project was described as open source; its repository and
licence have not yet been inspected, so code reuse is not a dependency.

## Accepted 3D visual follow-up (5 October 2026)

The earlier shell/workspace/contracts remain implemented with their recorded live-verification limits. Dan's accepted centred stage supersedes the current aurora and voice-only large orb on Jarvis. P8-28's room and P8-31's glass styling are merged in #375 and #376; P8-29's runtime/audio wiring is implemented offline in draft PR #377. The following table tracks the stage and related follow-ups without claiming live-provider or live-device acceptance.

| Feature | Behaviour | Surface | Status | Tasks |
| --- | --- | --- | --- | --- |
| Living mirrored 3D stage | Stable centred room with live mechanisms/atmosphere, actual floor reflection and orb-cast room light | Jarvis typing/voice only | Merged in PR #375; hardware/live acceptance unverified | P8-28 |
| Persistent transparent orb | Dormant cyan exterior/open amber core in typing, brighter in voice, driven by authenticated runtime activity and decoded playback audio; dormancy does not affect sleep or microphone permission | Jarvis, including phone | Implemented offline in draft PR #377; local desktop/phone, dark/light and fixture-state evidence recorded; live provider/audio acceptance remains unverified | P8-29 |
| Continuous scene/window transitions | Orb alone moves/scales for content; room stays fixed; preserve windows/drafts/focus and eliminate reported flicker | Jarvis typing/voice | PR #386 removes the document-wide transition and records local voice/workspace fixture checks; normal-hardware flicker acceptance remains open because SwiftShader frame cadence was too low to verify smooth motion | P8-30 |
| Selected glass surfaces | Readable translucent shell/window surfaces using existing navigation, views and controls; no 3D on other routes | Current shared shell/pages | Merged in #376; contrast over the integrated stage was visually inspected with P8-29 | P8-31 |
| Re-lit light appearance | Same room geometry/viewpoint re-lit for light mode; existing approved preferences/tokens persist; empty prompt, activity disclosure, and Jarvis replies use readable glass | Jarvis stage and shared appearance | Merged in PR #387; dark/light captures and system-switch continuity recorded; live settings, real devices and hardware GPU remain unverified | P8-32 |
| Resilient phone/GPU experience | Single-view docking/swipe, adaptive quality, hidden-tab lifecycle, reduced motion and usable WebGL failure handling | Jarvis phone/browser | Implementation in draft PR #391; Chromium checks cover phone/landscape layouts, context loss/restore and unavailable WebGL. SwiftShader frame cadence remains poor; hardware GPU, physical phone, Safari and live-provider acceptance are unverified | P8-33 |
[Requirements](../ui.md#accepted-centred-3d-stage--5-october-2026), [references](ui/centred-stage/README.md), [runnable prototype](reference/ui-stage-prototype/README.md). Reuse P8-14–P8-17 for data, tools, activity and preference logic; do not recreate those completed tasks. The latest persistent orb decision supersedes older phone-typing/voice-collapse visual requirements.
