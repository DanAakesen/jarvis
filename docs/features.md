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

Status as of 7 October 2026.

## Jarvis: conversation and voice

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Sign-in | Sign in with his Microsoft account; everyone else is refused | Screen | All pages | Live | P0-08, P0-09 |
| Chat | Open at the latest messages with typing focus; Enter/Send steers a reply in progress, retaining its partial response as interrupted; tool execution continues until the next round boundary picks up new messages; Ctrl+Enter adds to the removable FIFO queue, whose bubbles show Queued and captured language with an accessible count; queued turns advance after success or error; failed-turn feedback and next drafts survive; thinking precedes open-surface Markdown streaming; history refresh dedupes saved messages by ID. Send, language and voice entry remain available during replies; starting voice leaves the chat reply streaming into history. The queue is local to the mounted conversation, not persisted across navigation/reload. | Screen | Main page | Built | P4-03, P4-06, P4-09, P8-05, P8-21, P8-24, P8-25, P8-26, P8-35 |
| Conversation search | Search saved messages by keywords and UTC date range, optionally narrowed to chat, voice or phone; receive message IDs and concise excerpts as evidence | Voice/chat | Authenticated `/conversation/search` and `conversation_search` tool | Built offline; production SQL full-text availability unverified | P9-24 |
| English voice | Talk to Jarvis in English (gpt-realtime, Ryan HD, British butler persona) | Voice/chat | Main page | Built | P5-03, P5-04 |
| Danish voice | Talk to Jarvis in Danish (MAI Transcribe, Harper) | Voice/chat | Main page | Built | P5-02, P5-04 |
| Interrupt and reconnect | Interrupt Jarvis by speaking; voice reconnects automatically | Voice/chat | Main page | Built | P5-04 |
| Language toggle | Switch Danish/English from the shared More → Language menu in the composer and voice bar; during voice the change applies to chat and the next voice session, and the bar says so | Both | Main page, Settings | Built | P5-05, P8-36 |
| Voice transcripts | Read what was said in each voice sitting, with voice minutes | Screen | Main page | Built | P5-06 |
| Phone calling | No production number is verified or available in backend configuration today. When Teams Phone is provisioned, call the number assigned to Jarvis's Teams resource account from Dan's Teams identity; `/phone/status` surfaces module configuration and recent call outcomes. | Phone | Backend `/phone/status` | Built offline; production dormant, number/resource unverified | P7-01, P9-22 |
| Task context | Jarvis knows running tasks and recent events without asking | Background | — | Built | P4-04 |
| Background jobs | See research and other slow work in the workspace; current status, step history and result-window links persist across reloads and replicas for 30 days; interrupted work is marked failed at startup | Both | `/jobs`, `event: job`, `list_jobs`, `cancel_job` | Built offline; SQL Server/live multi-replica behavior unverified | P9-14 |
| Honest confirmations | Jarvis reports refused or failed actions as such, never as done | Voice/chat | — | Built | P4-05 |
| Task recipes | Remember successful PC/browser operation sequences without entered values; Jev selects and verifies fresh targets, falling back to planning on drift. List and delete saved recipes. | Both | Voice/chat and Settings → Task recipes | Built offline; live replay timing pending | P7-35, P7-34, P5-14 |
| Software Factory tools | Ask Jarvis to list projects and tasks, create tasks, change the agent or model on a Ready task, steer, pause, resume or cancel tasks, retry an eligible failed start, and inspect releases and deploy status | Voice/chat | Main page | Backend tools implemented offline; live GitHub access unverified | P4-10, P7-11, P9-29 |
| Image generation | Ask Jarvis to create an image with the existing ChatGPT/Codex subscription; open it in the workspace and inspect its saved artifact in chat history | Both | Main conversation and workspace | Built offline; live Codex and Blob acceptance pending | P7-15 |
| Model switching by voice | Change Jarvis for the next session or a Ready task using verified provider options; running-task changes are refused | Voice/chat | Main page | Built (offline) | P7-11 |
| Live status by voice | Jarvis announces important task changes and answers "what's going on?" | Voice/chat | — | Built (offline) | P7-12 |
| Long-term knowledge | Recall relevant facts from Dan's GitHub vault, tune bounded similarity/top-k retrieval, and enable or disable automatic saving of clearly stated durable facts; user-requested writes remain available | Voice/chat | Settings API and shared tools | Implemented offline; App installation on the vault and live access pending | P7-40, P9-10 |
| Continuous screen/camera watching | Independently share screen/camera and ask “tell me when…”; Jarvis comments only on useful observations, dedupes repeats, and stops at the shared USD 1/day budget | Both | Main conversation; backend `/vision/watch` and watch tools | Backend built offline; separate UI and live model/delivery acceptance pending | P7-38 (#440) |
| Long-term memory | Recall relevant stated preferences, project facts, decisions and unfinished tasks with Dan's source; inspect, correct or forget them | Voice/chat | — | In progress | P7-13 |
| Live voice test | Dan's verdict on Danish and English voice | Voice/chat | — | In progress | P5-07 |
| Reflex layer | Jev classifies stable voice clauses early with a per-turn ledger; only complete, high-confidence reversible actions execute on partials, and contradictions are undone where supported. Calibrated Choice confidence gates actions at 0.9; typed provider failures are logged without keys or transcripts. | Voice/chat | Main page | Built offline; live verification pending | P7-04, P7-20, P5-12 |

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
| Retry eligible task start | Retry a failed start only when no sandbox work began; use Recover for tasks with sandbox history | Voice/chat | — | Implemented offline; live backend acceptance pending | P9-29 |
| Recover crashed task | Restart a task after an active-turn crash from its branch in a new sandbox | Both | Task detail | Built (offline) | P2-10 |
| Continue after idle expiry | Expiry preserves task state; Continue or a steering correction starts a new session on the existing task branch | Both | Board, task detail; steering tool | Built (offline; regression fix) | P2-14 |
| Sandbox per task | Each task runs Codex or Copilot in its own Foundry sandbox that closes after delivery or cancel | Background | — | Live (start and events); repo clone in progress | P2-02, P2-04, P2-05, P2-13 |
| Agent and model per task | Choose Codex or Copilot with provider-supported model and reasoning defaults; task-specific model/reasoning overrides take precedence and are applied at task start | Both | Create task | Backend implemented offline; live provider/account availability unverified | P2-11, P9-04 |
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
| Project policy and merge | On task completion, open or reuse an App-backed PR only when the task branch is ahead of the default branch; record refusals as Needs attention, then stop at a verified green PR (or a no-CI PR after a two-minute grace period) or squash-merge via the GitHub App when checks, branch freshness and protection rules pass | Background | Project settings; task detail | Built offline with fake GitHub coverage; coordinator live test-repository acceptance pending | P3-06, P3-14, P6-16 |
| Release records | One release per merge to `main`, linked to runs and deployments by SHA | Background | — | Built (live webhook setup pending) | P3-07 |
| Release view | Git graph, releases, runs and deployments per project | Screen | Release view | Built | P3-08 |
| Release and deploy tools | List recorded releases, inspect a release's linked runs/deployments, and check the latest deploy workflow on a project's default branch | Voice/chat | — | Implemented offline; live GitHub App access unverified | P9-29 |
| Workflow templates | Managed projects copy PR-check and release workflows | Background | — | Built | P3-09 |

## Settings, usage and operations

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Settings | Jarvis, voice and coding-agent defaults; global limits; app-wide light/dark appearance | Screen | Settings | Built | P1-11, P8-13 |
| Voice tuning | Configure bounded server-VAD threshold, prefix padding and silence duration, barge-in, and maximum spoken reply tokens | Backend API | `/settings`; realtime session configuration | Backend built offline; live Voice Live behavior and the hosted Danish agent's separate configuration remain unverified | P9-05 |
| Jarvis model per session | Model and reasoning for new Jarvis sessions | Both | Settings; by voice with P7-11 | Built | P4-07 |
| Model catalogue and per-role settings | List live Foundry deployments and configure model/reasoning effort for chat, vision, research, voice, transcription, embeddings, Codex and Copilot; selected settings apply to the next relevant task, job, request or session | Backend API | Settings API and the corresponding chat, task, research, vision and voice jobs | Backend built offline; live ARM, provider/account availability and model-selection acceptance pending | P9-01, P9-02, P9-04 |
| Embedding model changes | Select `text-embedding-3-small` or `text-embedding-3-large`; re-embed mismatched memory and vault vectors with background progress | Backend API + background | Settings API; memory and vault indexes | Backend built offline; live deployment and re-embedding acceptance pending | P9-03 |
| Model catalogue, per-role settings and deployments | List live Foundry deployments; configure model/reasoning effort for chat, vision, research, voice, transcription, embeddings, Codex and Copilot; request confirmed deployment creation or deletion by Dan through Now or `manage_model_deployment` in chat/voice. Deletion is refused while a role uses the deployment. | Backend API and chat/voice | `/models`, `/models/deployments`; `manage_model_deployment`; Settings API and model-backed jobs | Backend built offline; live ARM permissions and operations unverified | P9-01, P9-02, P9-07 |
| Personality preferences | Choose a tone and response style, and add bounded instructions for new chat and voice sessions | Both | Settings, chat and voice | Built offline; live Azure behavior unverified | P7-16, P8-19 |
| Credentials status | See credential expiry and renewal status (never values) | Screen | Settings | Built | P2-08 |
| System status | Inspect database, Foundry, vault index/embedding coverage, GitHub App permissions, Google, PC bridge, runner configuration, deployed commit and most recent unhandled server error | Backend API; UI pending | Dan-only `GET /status`; `get_status_summary` shares the cached snapshot | Backend implemented offline; UI and live-provider verification pending | P9-20 |
| Codex login renewal | Daily automatic renewal of the Jarvis Codex login | Background | Settings | Built | P2-08 |
| Usage and cost | Per-model and per-role Foundry tokens; daily/monthly USD and DKK totals; research and image-generation call counts, with estimated and unverified costs identified | Screen | Usage API; UI integration pending | Backend implemented offline; live provider billing unverified | P2-12, P6-01, P7-14, P9-23 |
| Event archive | Old task events move to Blob and load on demand; idle checks skip SQL until a sandbox is active | Background | Task detail | Built offline | P6-03, P5-13 |
| Alerts | Failed deploys, sandbox crashes, credential expiry, budget 80 % | Now + email | Main page; email-only Azure Monitor action group | Built (offline; live Azure delivery unverified) | P6-02 |
| Backup drill | Database restore documented | Background | — | Planned | P6-04 |
| Runbook | Deploy, rollback, key rotation, task recovery, sleep, and temporary SQL access | — | [Operations runbook](runbook.md) | In progress | P6-06 |

## Jarvis everywhere (P7)

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Away mode | Toggle by voice/chat, manual mode and automatic return to present on active browser use; see mode in Now and receive task updates and approvals there while away or present | Both | Main page | Built offline; live browser acceptance pending | P7-02 |
| Repository tools for Jarvis | Discuss Jarvis's own code and docs with a README/tree overview, bounded file reads, code search, and issue/PR summaries | Voice/chat | — | Built offline; live GitHub access pending | P7-45 |
| Notifications and approvals | Receive Now-feed notifications and approve or reject gated actions in the authenticated browser; active English voice sessions announce pending approvals and task status | Both | Main page, browser voice | Built offline; live acceptance pending | P6-22, P7-03 |
| Screen sharing | Share a screen or window; request an in-memory vision description and, for browser tasks, pass its selected display label only as transient context | Both | Main page | Built offline; live vision/form check pending | P7-05, P7-19 |
| Local PC bridge | Jarvis opens websites in foreground Chrome when its extension is connected and automation is on; otherwise it launches Chrome directly, never Edge or the Windows default browser. It matches installed app names, opens folders under `C:\Repo` in VS Code, reports and focuses windows, and supports closing apps. The tray pause blocks PC control and reports its state | Voice/chat | PC companion | Built offline; live Windows/Chrome acceptance pending | P7-06, P7-26, P7-31, P7-32 |
| Ultrafast browser agent | Complete bounded Chrome tasks with Jev-selected operations, observed targets, bounded keyboard sequences and exact quoted focused text; TYPE text is generated by Foundry, DONE is independently checked, and only irreversible actions require P7-03 approval | Voice/chat | Backend `browser_do`; P8-15 workspace; PC bridge | Built offline; fake-provider tests pass; live Jev/Foundry/Chrome/approval checks pending | P7-17, P5-12, P7-34 |
| Chrome browser executor | With Dan's explicit bridge toggle on, open URLs in a new active tab and bring Chrome forward; list tabs, snapshot visible controls, and run fresh indexed or bounded keyboard/focused-typing actions in his signed-in Chrome. Sensitive focus is blocked, unsafe system chords are refused, and only irreversible actions require confirmation | Voice/chat | PC companion; authenticated backend tools | Built offline; foreground-tab acceptance in Dan's normal profile pending | P7-18, P7-26, P7-34 |
| Act on the shared tab | Resolve the page Dan shares from its transient title and vision description, ask if ambiguous, and run the bounded browser agent with spoken progress and “stop” | Voice/chat | Backend `browser_do_shared`; P8-15 workspace; PC bridge | Built offline; live form, voice and approval check pending | P7-19 |
| Computer use | Control any foreground Windows app through bounded UI Automation, up to four safe keyboard chords, or a transient vision fallback when fewer than three actionable controls are exposed. Jev chooses one action from each fresh snapshot; visual actions click or scroll only and cannot type. Typed text must be exact, quoted, and non-sensitive. Sensitive focus and dangerous chords are blocked; confirm only irreversible actions. Tray pause blocks PC capture and control. Websites remain on Chrome; never use Edge, Foundry computer-use, or raw shell | Voice/chat | Backend `pc_act`; PC companion | Built offline; focused backend/.NET tests and Windows-target build pass; live Windows/Foundry/Jev/approval check pending | P7-07, P7-31, P7-32, P7-34, P7-36, P5-12 |
| Local PC bridge | Jarvis opens websites in Dan's foreground Chrome when its extension is connected and automation is on; if disconnected, the bridge launches Chrome directly, never Edge or the Windows default browser. It fuzzy-matches app names against user/common Start-menu shortcuts and AppsFolder, returns candidates when ambiguous, opens folders under `C:\Repo` in VS Code, reports the active window title, and focuses an exact-title window | Voice/chat | PC companion | Built offline; live Windows/Chrome acceptance pending | P7-06, P7-26, P7-31 |
| Ultrafast browser agent | Complete bounded Chrome tasks with Jev-selected operations and observed targets; TYPE text is generated by Foundry, DONE is independently checked, irreversible clicks require P7-03 approval, and current progress appears in a workspace window | Voice/chat | Backend `browser_do`; P8-15 workspace; PC bridge | Built offline; 0.07 ms fake median per step; live Jev/Foundry/Chrome/approval checks pending | P7-17 |
| Chrome browser executor | With Dan's explicit bridge toggle on, open URLs in a new active tab and bring Chrome forward; list tabs, snapshot visible controls, and run fresh, unobstructed indexed actions in his signed-in Chrome. Sensitive typing is blocked and only irreversible clicks need confirmation | Voice/chat | PC companion; authenticated backend tools | Built offline; foreground-tab acceptance in Dan's normal profile pending | P7-18, P7-26 |
| Act on the shared tab | Resolve the page Dan shares from its transient title and vision description, ask if ambiguous, and run the bounded browser agent with spoken progress and “stop” | Voice/chat | Backend `browser_do_shared`; P8-15 workspace; PC bridge | Built offline; live form, voice and approval check pending | P7-19 |
| Local PC bridge | Jarvis opens websites in Dan's foreground Chrome when its extension is connected and automation is on; if disconnected, the bridge launches Chrome directly, never Edge or the Windows default browser. It fuzzy-matches installed apps and returns candidates when ambiguous, closes apps normally, opens files/folders under `C:\Repo` in VS Code, reports the active window title, and focuses an exact-title window. The tray pause control blocks PC actions and Now reports its state | Voice/chat | PC companion | Built offline; live Windows/Chrome acceptance pending | P7-06, P7-26, P7-31, P7-32, P7-33 |
| Ultrafast browser agent | Complete bounded Chrome tasks with Jev-selected operations, observed targets, bounded keyboard sequences and exact quoted focused text; typed Jev failures are logged without page content, keys, or transcripts. TYPE text is generated by Foundry, DONE is independently checked, and only irreversible actions require P7-03 approval | Voice/chat | Backend `browser_do`; P8-15 workspace; PC bridge | Built offline; live Jev/Foundry/Chrome/approval checks pending | P7-17, P5-12, P7-34 |
| Chrome browser executor | With Dan's explicit bridge toggle on, open URLs in a new active tab and bring Chrome forward; list tabs, snapshot visible controls, and run fresh indexed actions or bounded keyboard/focused-typing actions in his signed-in Chrome. Sensitive focus is blocked; unsafe system chords are refused; only irreversible actions need confirmation | Voice/chat | PC companion; authenticated backend tools | Built offline; foreground-tab acceptance in Dan's normal profile pending | P7-18, P7-26, P7-34 |
| Act on the shared tab | Resolve the page Dan shares from its transient title and vision description, ask if ambiguous, and run the bounded browser agent with spoken progress and “stop” | Voice/chat | Backend `browser_do_shared`; P8-15 workspace; PC bridge | Built offline; live form, voice and approval check pending | P7-19 |
| Computer use | Control the focused VS Code or File Explorer app through bounded Windows UI Automation; Jev chooses one action from each fresh snapshot using calibrated Choice confidence at 0.9. Typing is limited to exact quoted non-sensitive text, and destructive actions require P7-03 approval. Typed Jev failures are logged without goals, keys, or control data. Websites remain on the Chrome browser path; no Foundry computer-use is used | Voice/chat | Backend `pc_act`; PC companion | Built offline; live Windows/Jev/approval check pending | P7-07, P5-12 |
| Local PC bridge | Jarvis opens websites in Dan's foreground Chrome when its extension is connected and automation is on; if disconnected, the current bridge launches Chrome directly, never the Windows default browser. It also opens allow-listed apps and folders under `C:\Repo` in VS Code, reports the active window title, and focuses an exact-title window. The tray can pause PC control and Now reports its state | Voice/chat | PC companion | Built offline; live Windows/Chrome acceptance pending | P7-06, P7-26, P7-32 |
| Ultrafast browser agent | Complete bounded Chrome tasks with Jev-selected operations, observed targets, bounded keyboard sequences and exact quoted focused text; TYPE text is generated by Foundry, DONE is independently checked, and only irreversible actions require P7-03 approval | Voice/chat | Backend `browser_do`; P8-15 workspace; PC bridge | Built offline; fake-provider tests pass; live Jev/Foundry/Chrome/approval checks pending | P7-17, P7-34 |
| Chrome browser executor | With Dan's explicit bridge toggle on, open URLs in a new active tab and bring Chrome forward; list tabs, snapshot visible controls, and run fresh indexed actions or bounded keyboard/focused-typing actions in his signed-in Chrome. Sensitive focus is blocked; unsafe system chords are refused; only irreversible keyboard actions and indexed actions need confirmation | Voice/chat | PC companion; authenticated backend tools | Built offline; foreground-tab acceptance in Dan's normal profile pending | P7-18, P7-26, P7-34 |
| Act on the shared tab | Resolve the page Dan shares from its transient title and vision description, ask if ambiguous, and run the bounded browser agent with spoken progress and “stop” | Voice/chat | Backend `browser_do_shared`; P8-15 workspace; PC bridge | Built offline; live form, voice and approval check pending | P7-19 |
| Computer use | Control any foreground Windows app through bounded UI Automation or a sequence of up to four safe keyboard chords; type only exact quoted non-sensitive text into the focused control. Sensitive focus and dangerous system chords are blocked; only irreversible actions require P7-03 approval. Pause Jarvis control from the tray to block PC actions. Websites remain on the Chrome browser path; no Foundry computer-use is used | Voice/chat | Backend `pc_act`; PC companion | Built offline; focused backend/.NET tests and Windows-target build pass; live Windows/Jev/approval check pending | P7-07, P7-32, P7-34 |
| Local PC bridge | Jarvis opens websites in Dan's foreground Chrome when its extension is connected and automation is on; if disconnected, the bridge launches Chrome directly, never Edge or the Windows default browser. It fuzzy-matches app names against user/common Start-menu shortcuts and AppsFolder, returns candidates when ambiguous, opens folders under `C:\Repo` in VS Code, reports the active window title, and focuses an exact-title window | Voice/chat | PC companion | Built offline; live Windows/Chrome acceptance pending | P7-06, P7-26, P7-31 |
| Ultrafast browser agent | Complete bounded Chrome tasks with Jev-selected operations and observed targets; TYPE text is generated by Foundry, DONE is independently checked, irreversible clicks require P7-03 approval, and current progress appears in a workspace window | Voice/chat | Backend `browser_do`; P8-15 workspace; PC bridge | Built offline; 0.07 ms fake median per step; live Jev/Foundry/Chrome/approval checks pending | P7-17 |
| Chrome browser executor | With Dan's explicit bridge toggle on, open URLs in a new active tab and bring Chrome forward; list tabs, snapshot visible controls, and run fresh, unobstructed indexed actions in his signed-in Chrome. Sensitive typing is blocked and only irreversible clicks need confirmation | Voice/chat | PC companion; authenticated backend tools | Built offline; foreground-tab acceptance in Dan's normal profile pending | P7-18, P7-26 |
| Act on the shared tab | Resolve the page Dan shares from its transient title and vision description, ask if ambiguous, and run the bounded browser agent with spoken progress and “stop” | Voice/chat | Backend `browser_do_shared`; P8-15 workspace; PC bridge | Built offline; live form, voice and approval check pending | P7-19 |
| Computer use | Control any foreground Windows app through bounded UI Automation; Jev chooses one action from each fresh snapshot. Typing is limited to exact quoted non-sensitive text, and irreversible actions require P7-03 approval. Websites remain on the Chrome browser path; no Foundry computer-use is used | Voice/chat | Backend `pc_act`; PC companion | Built offline; live Windows/Jev/approval check pending | P7-07, P7-31 |
| Wake word | Say "Wake up Jarvis" at the PC. The bridge detects the phrase offline with the Speech SDK keyword recognizer and plays a chime. It brings Dan's Jarvis Chrome tab forward, or opens Jarvis in Chrome (never Edge), and the backend publishes `voice.wake` so the open page can start voice. No audio leaves the PC before the phrase is heard. A tray toggle controls listening, and listening pauses during a voice session | Voice | PC companion; backend activity hub | Built offline; keyword model, page reaction (Dan's UI session) and live microphone acceptance pending | P7-39 |
| Computer use | Control any foreground Windows app through bounded UI Automation, safe keyboard sequences of up to four chords, or exact quoted non-sensitive text in the focused control. Jev selects each action from a fresh snapshot; sensitive fields and dangerous system chords are blocked. Only irreversible actions require P7-03 approval. Pause Jarvis control from the tray to block PC actions. Websites remain on the Chrome browser path; no Foundry computer-use is used | Voice/chat | Backend `pc_act`; PC companion | Built offline; focused backend/.NET tests and Windows-target build pass; live Windows/Jev/approval check pending | P7-07, P7-32, P7-34 |
| Local Codex prompt | Open the installed Codex desktop app and enter an exact non-sensitive prompt through the existing `pc_act` flow; confirm irreversible submission, refuse clearly when Codex is unavailable, and report success only after entry and submission complete | Voice/chat | Backend `codex_prompt`; PC companion | Built offline; live Windows/Codex/approval check pending | P7-33 |
| Media controls | Play/pause, skip tracks and adjust or mute volume with fixed Windows media keys. These reversible actions work through chat, voice and Jev reflexes without confirmation | Voice/chat | Backend `pc_media`; PC companion | Built offline; live Windows/media-device acceptance pending | P7-31 |
| Camera | Turn on the webcam from the shared shell and ask Jarvis by chat or voice to inspect a single frame; camera state times out and stops with the session | Both | Shared top bar, main conversation | Built offline; live camera/model check pending | P7-08 |
| Calendar and mail | Google Calendar agenda, date-range search and next appointment, free slots, create/move/update/delete events; Gmail search and summaries, bounded draft listing/replacement/deletion, archive and label add/remove, reply drafts and sending after exact confirmation | Voice/chat | Backend tools; no new page | Built offline; Dan must re-consent for `gmail.modify`; live Calendar/mail acceptance pending | P7-09, P7-22, P7-28, P9-26, P9-27 |
| Long-term knowledge | Search and read Dan's private GitHub vault, and automatically save durable facts there with a commit link | Voice/chat | — | Implemented offline; GitHub App installation on the vault and live search/write pending | P7-40 |

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
| Runtime activity | See actual listening, thinking, tool-call start/outcome, speaking, interruption, reconnect and failure states; keep activity transient and free of conversation/tool data | Both | Main page and voice workspace | Backend SSE names and payloads now use shared typed contracts; UI parser migration remains a separate session. Live Entra/Foundry and physical voice remain unverified | P8-16, P8-20, P9-18 |
| Persisted UI preferences and themes | Change light/dark/system appearance, approved theme tokens, and whether windows minimise when voice starts (off by default) | Screen | Settings and shell | Theme and voice-window preferences persist through P8-17; generated views remain transient | P8-10, P8-13, P8-17 |
| Generated-view and theme capabilities | Use the initial safe renderer/action and adjustable theme-token allowlists | — | UI planning | Decision recorded; implementation remains with P8-14/P8-15/P8-17 | P8-18 |

### Enabling-logic coverage

This coverage is for backend-enabling requirements in [ui.md](../ui.md); shell composition and client-only interactions belong to the companion P8-02 breakdown. P8-02 allocated P8-04 through P8-13 to frontend tasks in PR #233. P8-10 is implemented on the client without waiting for future contracts; P8-14/15/16 now provide the data, commands, and activity consumed by the related views. P8-11's phone workspace is complete offline, and P8-13 consumes P8-17's preference path.

| Confirmed UI requirement in scope | Existing capability or issue | Coverage and owner |
| --- | --- | --- |
| Agent-callable view operations, layout changes and contextual-panel open/close | P4-02 (#49) supplies the authenticated tool registry and dispatch; P4-05 (#52) supplies honest confirmations; P4-10 (#219) registers Factory tools over existing services. | **Implemented offline: P8-15.** One validated, session-scoped tool delivers commands over the authenticated Now event stream and waits for client acknowledgement; bounded pending work, command IDs, timeout and cancellation handling preserve honest outcomes. The browser owns geometry and presentation. |
| Typed visual views over accessible data, including safe renderer capabilities and bounded detail | P1-03 (#17), P1-04 (#18), P1-13 (#136), P2-12 (#38), P3-07 (#45) and P6-03 (#64) provide bounded project, task, activity, usage, release and archived-event data; P4-10 (#219) exposes selected Factory data to Jarvis. | **Implemented offline: P8-14/P8-06.** Shared versioned schemas validate and bound view data; fixed React renderers display typed payloads in temporary workspace windows and the contextual panel. The separately approved `html-app` artifact renderer runs only in a sandboxed iframe; it is not part of ordinary generated-view payloads. Live acceptance remains unverified. |
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
| Long-term knowledge | Search and read Dan's private GitHub vault, and automatically save clearly stated preferences, people, project facts, decisions and unfinished tasks | Voice/chat | Existing conversation; dedicated management UI undecided | Implemented offline; GitHub App installation and live access pending | P7-40 |
| Web research | Use the existing ChatGPT/Codex subscription for bounded, source-linked research in chat/voice and dynamic views | Both | Conversation and dynamic workspace | Built offline; live Codex/Foundry acceptance pending | P7-14; existing P8-06/P8-14/P8-15 consumers |
| Interactive research report | Start quick, standard or deep research with an immediate progress window, replace it with a cited self-contained HTML report, and receive a brief spoken findings or failure update; configure default depth, maximum sources and per-invocation timeout through `/settings` | Both | Conversation/voice, workspace and backend Settings API | Backend settings, depth, source-limit and timeout tests pass offline; renderer and browser acceptance depend on open P8-41 | P7-37, P8-41, P9-06 |
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

## Accepted conversation-surface refinement (6 October 2026)

Existing chat, voice, safe Markdown, queue/steering, workspace tools and shared glass remain implemented with their recorded validation limits. These tasks refine their presentation; they do not recreate those capabilities.

| Feature | Behaviour | Surface | Status | Tasks |
| --- | --- | --- | --- | --- |
| Compact voice bar and shared Language flyout | Truthful voice/activity state, reachable End voice; Language inside More with Danish/English flyout; existing capture capabilities retain their placement | Jarvis voice bar and shared menu | Merged in PR #403; full selected shell/composer/messages remain #398 | P8-36 (#397) |
| Matching glass composer | Small voice-start orb, paperclip menu for existing screen/camera visual context (disabled with a reason until shared; no file upload), multiline writing area, More → Language and Send; preserve Enter/Send steering and Ctrl+Enter queueing during replies | Jarvis typing, bottom centre | Implemented in the P8-37 PR | P8-37 (#398) |
| Readable message window | Glass history hosted as the shared workspace view `conversation` (shared tabs, minimise/restore, maximise, close, drag/resize and Jarvis commands); avatar-free 62ch messages with hidden author text; auto-follow only at the latest message with Jump to latest; safe Markdown, tool outcomes and failures kept | Jarvis typing and requested voice history | Implemented in the P8-37 PR | P8-37 (#398) |

[Approved visual and acceptance criteria](ui/chat-voice/README.md). Architectural Glass is selected; P8-37 (#398) implements the shell without a bottom bar, matching composer and avatar-free messages together. #399/#401 are superseded separate allocations.

## Selected shared shell refinement (6 October 2026)

| Feature | Behaviour | Surface | Status | Tasks |
| --- | --- | --- | --- | --- |
| Architectural Glass shell | Selected dimensional graphite/glass framing, existing navigation and context; remove separate bottom bar/layout track, retaining compact accessible database-waking status in the top bar | Shared shell; large room/orb on Jarvis only | Implemented in the P8-37 PR | P8-37 (#398) |

[Refined selected reference](ui/shell-styling/README.md#refined-approved-reference). The bottom composer and voice bar remain; P8-37 owns the shell, composer and avatar-free message-window update in one PR. Existing shell/voice/window/data capabilities remain implemented with their recorded validation limits.

## Approved voice/orb follow-up (6 October 2026)

These accepted changes are implemented offline together in P8-40 [#417](https://github.com/DanAakesen/jarvis/issues/417), [PR #419](https://github.com/DanAakesen/jarvis/pull/419). They replace two-step microphone activation and in-bar status. No separate prototype is required. P8-37 (#398) retains the separate shell/composer/messages scope. Live microphone/provider, physical-device and hardware-GPU acceptance remain unverified.

| Feature | Behaviour | Surface | Status | Tasks |
| --- | --- | --- | --- | --- |
| Under-orb voice status | Accessible session state/recovery follows the orb; compact More/End voice controls have no overlapping state or long language note | Jarvis browser voice | Implemented offline; fixture layout checks reported in PR #419 | P8-40 (#417) |
| Microphone on voice start | Explicit voice start requests native permission and begins capture after session readiness; no normal Enable microphone button; preserve mute, recovery and cleanup | Jarvis browser voice | Implemented offline; lifecycle tests pass, real audio unverified | P8-40 (#417) |
| Expressive awakening and live orb | Pronounced core/shell wake, distinct listening/thinking/tool-work motion and audible-playback-driven speech/light/reflection; interruptible and reduced-motion safe | Same Jarvis scene in typing/voice | Implemented offline; motion-model tests and software-WebGL observations, hardware acceptance pending | P8-40 (#417) |


## Voice UI hotfix (#435)

| Feature | Behavior | Location | Evidence | Task |
| --- | --- | --- | --- | --- |
| Direct voice sharing | Native-permission screen/camera start, requested inspection and stop; sharing alone sends no frame | More in voice controls | Local implementation; live physical capture/backend pending | P8-43 (#435) |
| Transient notifications | Dismissible bottom-right toast; no menu overlay or composer text leakage | Outside chat/voice layout | Local implementation; browser verification recorded with the PR | P8-43 (#435) |
| Projected status and living dormancy | White text without badge/dot; gentle dormant cyan pulse and stirring amber core, stronger awake movement; preserve wake and real state/audio responses | Under orb and existing Jarvis stage | Local implementation; hardware motion acceptance pending | P8-43 (#435) |
