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

Status as of 4 October 2026.

## Jarvis: conversation and voice

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Sign-in | Sign in with his Microsoft account; everyone else is refused | Screen | All pages | Live | P0-08, P0-09 |
| Chat | Type to Jarvis and read streamed replies; one continuous saved conversation with history | Screen | Main page | Built | P4-03, P4-06, P4-09 |
| English voice | Talk to Jarvis in English (gpt-realtime, Ryan HD, British butler persona) | Voice/chat | Main page | Built | P5-03, P5-04 |
| Danish voice | Talk to Jarvis in Danish (MAI Transcribe, Harper) | Voice/chat | Main page | Built | P5-02, P5-04 |
| Interrupt and reconnect | Interrupt Jarvis by speaking; voice reconnects automatically | Voice/chat | Main page | Built | P5-04 |
| Language toggle | Switch Danish/English for the next voice session | Both | Main page, Settings | Built | P5-05 |
| Voice transcripts | Read what was said in each voice sitting, with voice minutes | Screen | Main page | Built | P5-06 |
| Task context | Jarvis knows running tasks and recent events without asking | Background | — | Built | P4-04 |
| Honest confirmations | Jarvis reports refused or failed actions as such, never as done | Voice/chat | — | Built | P4-05 |
| Software Factory tools | Ask Jarvis to list projects and tasks, create tasks, change the agent or model on a Ready task, and steer, pause, resume or cancel tasks | Voice/chat | Main page | Built | P4-10, P7-11 |
| Model switching by voice | Change Jarvis for the next session or a Ready task using verified provider options; running-task changes are refused | Voice/chat | Main page | Built (offline) | P7-11 |
| Live status by voice | Jarvis announces important task changes and answers "what's going on?" | Voice/chat | — | In progress | P7-12 |
| Long-term memory | Recall relevant stated preferences, project facts, decisions and unfinished tasks with Dan's source; inspect, correct or forget them | Voice/chat | — | In progress | P7-13 |
| Live voice test | Dan's verdict on Danish and English voice | Voice/chat | — | In progress | P5-07 |
| Reflex layer | Instant acknowledgement and fast routing of simple commands (Jev) | Voice/chat | — | Planned | P7-04 |

## Main page overview

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Now panel | See running tasks, tasks needing attention, releases, deployments and credential warnings; dismiss items | Screen | Main page | Built | P1-13 |
| Sleep switch | Put the backend to sleep or wake it; refused while tasks are active | Screen | Main page | Built | P1-12 |
| Database waking | Pages wait and show "waking" while the paused database resumes | Screen | All pages | In progress | P1-14 |

## Software Factory: tasks

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Task board | See tasks in columns by state with live updates; filter and search | Screen | Task view | Built | P1-08 |
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
| Heartbeat and crash detection | Active invocation failures move the task to Needs attention; completed-turn expiry preserves task state, including first-poll and cleanup races; every poll logs a secret-safe state decision | Background | Backend logs | Built (offline; regression fix) | P2-06, P2-14 |
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
| Webhook receiver | GitHub events are verified and recorded once | Background | — | Built (live webhook setup pending) | P3-03 |
| PR, run, release and deploy records | Webhook events stored as pull requests, workflow runs, releases, deployments | Background | — | Built (live webhook setup pending) | P3-04 |
| Checks loop | A failed task-PR check is stored in private Blob and sent to the same task; bounded repairs move to Needs attention when exhausted | Background | Task detail | Built | P3-05 |
| Project policy and merge | On task completion, open or reuse an App-backed PR only when the task branch is ahead of the default branch; record refusals as Needs attention, then stop at a verified green PR or squash-merge via the GitHub App when checks, branch freshness and protection rules pass | Background | Project settings; task detail | Built offline with fake GitHub coverage; coordinator live test-repository acceptance pending | P3-06, P3-14 |
| Release records | One release per merge to `main`, linked to runs and deployments by SHA | Background | — | Built (live webhook setup pending) | P3-07 |
| Release view | Git graph, releases, runs and deployments per project | Screen | Release view | Planned | P3-08 |
| Workflow templates | Managed projects copy PR-check and release workflows | Background | — | Built | P3-09 |

## Settings, usage and operations

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Settings | Jarvis, voice and coding-agent defaults; global limits | Screen | Settings | Built | P1-11 |
| Jarvis model per session | Model and reasoning for new Jarvis sessions | Both | Settings; by voice with P7-11 | Built | P4-07 |
| Personality preferences | Choose a tone and response style, and add bounded instructions for new chat and voice sessions | Both | Settings, chat and voice | Backend built; Settings UI pending | P7-16, P8-19 |
| Credentials status | See credential expiry and renewal status (never values) | Screen | Settings | Built | P2-08 |
| Codex login renewal | Daily automatic renewal of the Jarvis Codex login | Background | Settings | Built | P2-08 |
| Usage and cost | Sandbox, model, voice, Codex and Copilot usage per task, project, period | Screen | Usage | Built | P2-12, P6-01 |
| Event archive | Old task events move to Blob and load on demand | Background | Task detail | Built | P6-03 |
| Alerts | Failed deploys, sandbox crashes, credential expiry, budget 80 % | Now + email | Main page; email-only Azure Monitor action group | Built (offline; live Azure delivery unverified) | P6-02 |
| Backup drill | Database restore documented | Background | — | Planned | P6-04 |
| Runbook | Deploy, rollback, key rotation, task recovery, sleep, and temporary SQL access | — | [Operations runbook](runbook.md) | In progress | P6-06 |

## Jarvis everywhere (P7)

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Teams calling | Call Jarvis from the Teams app (no paid number at first) | Phone | Teams | Planned (needs decision) | P7-01 |
| Away mode | "I'm leaving": updates and confirmations go to the phone | Both | Main page, Phone | Planned (needs decision) | P7-02 |
| Phone confirmations | Approve or reject actions from Teams, with a voice note | Phone | Teams | Planned (needs decision) | P7-03 |
| Screen sharing | Share a screen or window; Jarvis sees it | Both | Main page | Planned (needs decision) | P7-05 |
| Local PC bridge | Jarvis opens apps, URLs and allowed commands on Dan's PC | Voice/chat | PC companion | Planned (needs decision) | P7-06 |
| Computer use | Jarvis clicks and types on Dan's PC while he talks | Voice/chat | PC companion | Planned (needs decision) | P7-07 |
| Camera | Jarvis sees through the webcam on request | Both | Main page | Planned | P7-08 |
| Calendar and mail | Agenda, free slots, move meetings, search and draft mail | Voice/chat | — | Planned (needs decision) | P7-09 |
| Second brain | Search Dan's configured OneDrive notes folder and quote snippets with links | Voice/chat | — | Implemented offline; Graph setup and live search pending | P7-10 |

## Jarvis UI enabling logic (P8-03)

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Complete Jarvis front end | One designed UI for all features above | Screen | All pages | Planned | P8-01, P8-04–P8-13 |
| Shared app shell and area navigation | Navigate areas from the rail/sidebar; open Settings from the top-right; use confirmed screen-share and Camera controls | Screen | All pages | Planned | P8-04 |
| Conversation opening and voice entry | See the conversation on arrival, type from the bottom-centred composer, and explicitly start voice from the small orb | Both | Main page | Planned | P8-05 |
| Dynamic workspace views | View accessible information in temporary, question-relevant windows; ask Jarvis or move/resize/reorder views | Screen | Main workspace | Planned | P8-06 |
| Window tabs and restore | Minimise a view without closing or saving it, then restore it from its tab or by asking Jarvis | Both | Main/voice workspace | Planned | P8-07 |
| Contextual right panel | Open, close, or change relevant information without replacing the main content | Both | Main workspace | Planned | P8-08 |
| Runtime-state orb | See listening, thinking, speaking, reconnect, and unavailable states from the actual voice client; tool-call activity is stated unavailable until its runtime event exists | Screen | Voice workspace | Built | P8-09, P8-16 |
| Desktop voice workspace | Enter full-page voice, carry open views across modes, and restore the typing layout; optionally minimise windows on entry (off by default) | Voice/chat | Main page | Planned | P8-10 |
| Phone workspace | Show one main view, switch by swipe or request, and dock the active voice orb while content is foreground | Phone | Jarvis on phone | Planned | P8-11 |
| Manual voice-end affordance | Choose the manual end control and Escape-key behavior without changing natural spoken ending | Both | Voice workspace | Planned (needs decision) | P8-12 |
| Theme controls and client persistence | Use light/dark appearance and apply Jarvis-supplied theme variables across visits | Screen | Shared shell, Settings | Planned | P8-13 |
| Agent-directed workspace views | Ask Jarvis to create, update, show, close, minimise, restore, focus, move and resize views, and change the layout or contextual panel | Both | Main page and voice workspace | Planned | P8-15 |
| Generated data views | Inspect accessible information in temporary, typed views using registered renderers | Screen | Workspace | Planned | P8-14 |
| Runtime activity | See Jarvis's actual listening, thinking, tool-call and speaking state | Both | Main page and voice workspace | Planned | P8-16 |
| Persisted UI preferences and themes | Change light/dark theme values and choose whether windows minimise when voice starts | Screen | Settings and shell | Planned | P8-17 |
| Generated-view and theme capabilities | Decide the initial safe renderer/action and adjustable theme-token allowlists | — | UI planning | Planned (needs decision) | P8-18 |

### Enabling-logic coverage

This coverage is for backend-enabling requirements in [ui.md](../ui.md); shell composition and client-only interactions belong to the companion P8-02 breakdown. P8-02 allocated P8-04 through P8-13 to frontend tasks in PR #233. Matching consumers must be blocked by their backend prerequisites: P8-06 by P8-14 and P8-15; P8-07, P8-08, P8-10 and P8-11 by P8-15; P8-09, P8-10 and P8-11 by P8-16; and P8-10 and P8-13 by P8-17.

| Confirmed UI requirement in scope | Existing capability or issue | Coverage and owner |
| --- | --- | --- |
| Agent-callable view operations, layout changes and contextual-panel open/close | P4-02 (#49) supplies the authenticated tool registry and dispatch; P4-05 (#52) supplies honest confirmations; P4-10 (#219) registers Factory tools over existing services. None controls workspace views. | **Gap: P8-15.** Add validated, session-scoped workspace commands and delivery/acknowledgement to the active client. The browser owns geometry and presentation. |
| Typed visual views over accessible data, including safe renderer capabilities and bounded detail | P1-03 (#17), P1-04 (#18), P1-13 (#136), P2-12 (#38), P3-07 (#45) and P6-03 (#64) provide bounded project, task, activity, usage, release and archived-event data; P4-10 (#219) exposes selected Factory data to Jarvis. | **Gap: P8-14.** Define the typed declarative view/data boundary and renderer identifiers over existing authorised data. Generated HTML, JavaScript and CSS are never executable input. The frontend renderer is P8-06. |
| Listening, thinking, tool-call and speaking activity reflects actual runtime state | P5-03 (#57) and P5-04 (#58) provide the English/voice relay; chat streams user/delta/done/error; P4-05 records ok/refused/error tool outcomes. P7-12 (#210, in progress) announces selected status changes by voice, not orb/runtime activity. | **Gap: P8-16.** Normalize and publish ephemeral, typed activity transitions for the UI, coordinating speaking state with P7-12 without duplicating its announcements; orb presentation is P8-09. |
| Voice/typing transitions preserve the active workspace; window create/close/minimise/restore/focus/move/resize and layout remain transient | `ui.md` confirms these workspace lifecycle rules. No backend view store or state-persistence task exists or is needed; P4-03/P5-06 retain conversation history/transcripts independently. | **Client behavior: P8-10/P8-11.** P8-15 carries agent-directed commands only. Ending voice or closing a view must not delete saved conversation or source data. |
| Generated views are unsaved while theme preferences persist and can change dynamically | P1-11 (#25) provides the existing persistent, validated settings store and API, but its schema has no UI theme or voice-window preference. | **Gap: P8-17.** Extend the existing settings/tool path for confirmed preferences; the frontend applies updates dynamically under P8-13. Do not persist generated views. |
| Data available through Jarvis is inspectable without duplicating integrations | Existing issues own feature data and integrations: P3-08 (#46) releases; P7-05/06/07 (#203–205) screen share and PC capability; P7-08 (#206) camera; P7-09/10 (#207–208) calendar/mail and notes. Banking and Fitness/Health details are deferred. | **Covered by those features plus P8-14's bounded data contract.** No new PC vendor issue; no Banking or Fitness/Health integration work is authorized here. |

#### Deferred decisions (needs-decision)

- The exact generated view/rendering and interactive-control catalogue is not yet defined; the examples in `ui.md` are possibilities, not a committed renderer list.
- P8-18 asks Dan to settle the initial renderer/action and theme-token allowlists before P8-14/P8-17 implements them. The five-theme example is not a requirement; implementation must not invent tokens or values.
- Exact orb styling/animation and detailed mode-transition styling remain with the frontend/design work. Manual voice-end control/Escape remains the P8-12 `needs-decision` task; neither decision blocks the backend activity contract.
- Banking and Fitness/Health integration detail remains deferred. Dan withdrew the proposed PC vendor integration; do not create an issue for it.

## Additional accepted Jarvis capabilities (planned)

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Long-term memory | Recall preferences, decisions and unfinished work across sessions; inspect, correct and forget retained memories | Voice/chat | Existing conversation; dedicated management UI undecided | Planned (storage, capture and retention decisions open) | P7-13 |
| Web research | Search and retrieve web sources, synthesise findings with links and show results through dynamic views | Both | Conversation and dynamic workspace | Planned (provider and cost decision open) | P7-14; existing P8-06/P8-14/P8-15 consumers |
| Image and video generation | Generate visual assets, inspect truthful job status and view the resulting artifacts | Both | Conversation and dynamic workspace | Planned (providers, cost and retention decisions open) | P7-15; existing P8-06/P8-14/P8-15 consumers |
| Editable personality | Configure tone/response style and custom instructions consistently for chat and voice; reset to the current default | Both | Proposed Settings → Jarvis → Personality | Planned | P7-16, P8-19 |

Dan accepted these features on 4 October 2026. No new provider or paid service
was selected, and no implementation was started by this planning change. Notes
search remains #208 and is not a replacement for long-term conversational memory.
The first video's project was described as open source; its repository and
licence have not yet been inspected, so code reuse is not a dependency.
