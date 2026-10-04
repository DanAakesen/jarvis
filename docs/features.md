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
| Software Factory tools | Ask Jarvis to list, create, steer, pause, resume or cancel tasks | Voice/chat | — | Gap | P4-10 |
| Model switching by voice | "Use Codex with high reasoning", "switch Jarvis to the faster model" | Voice/chat | — | In progress | P7-11 |
| Live status by voice | Jarvis announces important task changes and answers "what's going on?" | Voice/chat | — | In progress | P7-12 |
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
| Task controls | Steer, pause, resume, cancel | Both | Board, task detail; by voice once P4-10 lands | Built (screen) | P2-07, P4-10 |
| Recover crashed task | Restart a crashed task from its branch in a new sandbox | Both | Task detail | In progress | P2-10 |
| Sandbox per task | Each task runs Codex or Copilot in its own Foundry sandbox that closes after delivery or cancel | Background | — | Live (start and events); repo clone in progress | P2-02, P2-04, P2-05, P2-13 |
| Agent and model per task | Choose Codex or Copilot, model and reasoning per task | Both | Create task | Built | P2-11 |
| Repository workspace | Sandbox clones the project repo and works on `jarvis/task-…`; agent questions surface in Needs attention | Background | — | In progress | P2-13 |
| Frequent pushes | Agents push work in progress after each step | Background | — | Built | P2-09 |
| GitHub App tokens | Sandboxes push with one-hour tokens scoped to the task's repository | Background | — | Built (enabled; live push check after P2-13) | P3-02 |
| Heartbeat and crash detection | Crashed sandboxes move the task to Needs attention | Background | — | Built | P2-06 |
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
| Checks loop | A failed PR check is sent back to the task; the agent fixes it | Background | Task detail | Planned | P3-05 |
| Project policy and merge | Stop at a green PR, or merge automatically when rules pass | Background | Project settings | Planned | P3-06 |
| Release records | One release per merge to `main`, linked to runs and deployments by SHA | Background | — | Built (live webhook setup pending) | P3-07 |
| Release view | Git graph, releases, runs and deployments per project | Screen | Release view | Planned | P3-08 |
| Workflow templates | Managed projects copy PR-check and release workflows | Background | — | Built | P3-09 |

## Settings, usage and operations

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Settings | Jarvis, voice and coding-agent defaults; global limits | Screen | Settings | Built | P1-11 |
| Jarvis model per session | Model and reasoning for new Jarvis sessions | Both | Settings; by voice with P7-11 | Built | P4-07 |
| Credentials status | See credential expiry and renewal status (never values) | Screen | Settings | Built | P2-08 |
| Codex login renewal | Daily automatic renewal of the Jarvis Codex login | Background | Settings | Built | P2-08 |
| Usage and cost | Sandbox, model, voice, Codex and Copilot usage per task, project, period | Screen | Usage | Built | P2-12, P6-01 |
| Event archive | Old task events move to Blob and load on demand | Background | Task detail | Built | P6-03 |
| Alerts | Failed deploys, sandbox crashes, credential expiry, budget 80 % | Phone | — | Planned | P6-02 |
| Backup drill | Database restore documented | Background | — | Planned | P6-04 |
| Runbook | Deploy, rollback, key rotation, recovery steps | — | docs | Planned | P6-06 |

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
| Second brain | Search Dan's notes and quote them | Voice/chat | — | Planned (needs decision) | P7-10 |

## Jarvis UI (P8)

| Feature | What Dan can do | Surface | Where | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| Complete Jarvis front end | One designed UI for all features above | Screen | All pages | Planned (design session) | P8-01 |
