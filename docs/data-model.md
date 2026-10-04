# Data model

Version 1, 3 October 2026 (after sparring with Dan). Scope: the Jarvis core and the Software Factory only. Azure SQL is the source of truth ([Decision 3](decisions.md#decision-areas)); Blob Storage holds large files referenced from SQL. Requirements: [PRODUCT.md](../PRODUCT.md); system: [architecture.md](architecture.md).

## Migration infrastructure

Issue #7 adds `dbo.schema_migrations`, an internal deployment ledger separate
from the seven domain groups: `name nvarchar(255)` primary key, `checksum char(64)`
(SHA-256 of committed file bytes), and `applied_at datetime2(7)` defaulting to
`SYSUTCDATETIME()`. The backend creates and writes it only while holding the
transaction-owned `jarvis.schema-migrations` app lock. Its rows must remain an
unchanged prefix of the committed migrations. Failed or cancelled startup rolls
back schema, data and ledger together. Issue #7 introduced no domain schema or seed
data. Groups 1–3 are `db/migrations/0001_core_tables.sql` (P1-01, #15), with a
reverse script in `db/migrations/down/`; see [Physical schema](#physical-schema-groups-13).
Groups 4–7 follow in P2-01, P2-12 and P3-04. P2-06 adds the nullable
`sandbox_sessions.agent_name` column in `0003_sandbox_agent_name.sql`; new
sessions must populate it so the heartbeat can address the correct Foundry agent.
P6-03 adds `task_event_archives` in `0005_task_event_archives.sql`, indexing each
committed event blob so interrupted uploads remain invisible and task history
pages can locate the required blobs without listing the container.

## Overview

Seven groups. Arrows show the main references between groups.

```mermaid
flowchart LR
    subgraph CORE["1 · Jarvis core"]
        settings
        jarvis_sessions
        messages
        tool_calls
        activity
    end
    subgraph PROJ["2 · Projects"]
        projects
    end
    subgraph TASK["3 · Tasks and queue"]
        tasks
        task_events
    end
    subgraph SANDBOX["4 · Sandbox"]
        sandbox_sessions
        sandbox_turns
        artifacts
    end
    subgraph REL["5 · GitHub and release"]
        pull_requests
        workflow_runs
        releases
        deployments
    end
    subgraph USE["7 · Usage and cost"]
        usage
    end
    subgraph OPS["6 · Operations"]
        webhook_deliveries
        credential_status
    end
    tool_calls --> tasks
    tasks --> projects
    sandbox_sessions --> tasks
    pull_requests --> tasks
    releases --> projects
    activity -.-> tasks
    activity -.-> releases
    usage --> tasks
    tasks --> messages
```

| # | Group | Supports | Tables |
| --- | --- | --- | --- |
| 1 | Jarvis core | The one continuous conversation with Jarvis, settings, the activity feed on the main page | `settings`, `jarvis_sessions`, `messages`, `tool_calls`, `activity` |
| 2 | Projects | Which repositories Jarvis works on and their rules | `projects` |
| 3 | Tasks and queue | The task view, dispatch, retries, the task's history | `tasks`, `task_events` |
| 4 | Sandbox | The Foundry sessions that run a task, each turn, files kept in Blob | `sandbox_sessions`, `sandbox_turns`, `artifacts` |
| 5 | GitHub and release | Pull requests, checks, the release view (commits fetched from GitHub on demand) | `pull_requests`, `workflow_runs`, `releases`, `deployments` |
| 6 | Operations | Safe webhook handling, credential expiry warnings | `webhook_deliveries`, `credential_status` |
| 7 | Usage and cost | Transparency per task and project: sandbox time, model tokens, voice, Codex and Copilot usage | `usage` |

Repository task statuses and their GitHub issues are workflow metadata managed from `PLAN.md`; they are not stored in the Jarvis SQL model.

P5-03 and P5-04 do not create `jarvis_sessions`, `messages`, or `tool_calls`; realtime tool calls and browser audio are not persisted yet. P4-03 owns conversation persistence, and P5-06 owns voice transcripts and usage. No schema or migration changes are part of P5-03 or P5-04.

## 1 · Jarvis core

P4-06 uses the existing `jarvis_sessions`, `messages`, and `tool_calls` tables:
each chat sitting is a chat session, the user message is the tool-call source,
and the completed assistant reply is another message. Task links come from the
stored `tool_calls.task_id`; no columns or migrations are added.

```mermaid
erDiagram
    jarvis_sessions ||--o{ messages : contains
    messages ||--o{ tool_calls : triggers
    jarvis_sessions {
        bigint id PK
        string channel "voice | chat"
        string language "da | en"
        datetime started_at
        datetime ended_at
    }
    messages {
        bigint id PK
        bigint jarvis_session_id FK
        string role "dan | jarvis"
        string text
        string model "for example gpt-5.6-luna"
        int input_tokens
        int output_tokens
        datetime at
    }
    tool_calls {
        bigint id PK
        bigint message_id FK
        string tool "create_task, pause_task, ..."
        json arguments
        json result
        string outcome "ok | refused | error"
        bigint task_id FK "nullable"
        datetime at
    }
    settings {
        string scope PK "global | project:<id>"
        string key PK "jarvis.model, voice.en.voice, ..."
        json value
        datetime updated_at
    }
    activity {
        bigint id PK
        string area "factory"
        string kind "task_done, release_failed, ..."
        string title
        string link "task:42, release:7"
        datetime at
    }
```

- **One continuous conversation.** Jarvis has a single thread; each chat or voice sitting is a `jarvis_session` within it. Over time the thread needs compaction and memory (Decision 6, deferred); `messages` keeps the full record either way.
- P4-03's authenticated conversation API creates and idempotently ends sessions, appends messages only to active sessions, and reads history across sessions. History is paginated by message ID (50 by default, up to 100) and ordered chronologically; it includes session channel/language and tool name, outcome, and task ID, not tool arguments or results. The main page reads history; P4-06 sends chat turns through the session turn endpoint, while voice clients use the session/message write endpoints in P5-03/P5-04. No schema migration was needed.
- `tool_calls` records what Jarvis actually did. Spoken confirmations are built from these results (L16).
- P4-04's agent-only turn context reads up to 20 running tasks and their three latest `task_events` from the existing tables. It selects task status/activity and event type, summary, source, and time; it excludes task requests and event payloads, and clips summaries to 400 characters. No schema or migration change is needed.
- The backend tool dispatcher requires `X-Jarvis-Message-ID` and stores the validated arguments, result and `ok`/`refused`/`error` outcome in `tool_calls`. A tool refuses by throwing `ToolRefusal` with a safe reason, stored as `{ "refused": reason }`; any other failure is stored as a generic error. P1-01 (#15) owns the table migration; no live SQL write has been verified yet. P4-06 stores the source message before P4-09 sends its ID and the delegated token in the application payload to the hosted agent through Foundry Invocations. The agent registers its chat handler with that protocol, verifies the caller and message through the backend, and sets the message ID in the per-turn context used by tool calls. P4-04's running-task context is fetched by the model client on every turn. No data-model or migration change is required.
- Session, message, history, task-origin, and tool-call behavior is covered by offline and disposable SQL Server tests; live Azure SQL writes have not been verified.
- `settings` holds the settings page. A task stores its own overrides on the `tasks` row.
- P1-11 stores global defaults in the existing key/value table; missing keys use
  the documented defaults. Current keys are `jarvis.model`,
  `jarvis.reasoning_effort`, `voice.stt.model`, `voice.en.model`,
  `voice.en.voice`, `voice.da.voice`, `voice.default_language`, `codex.model`,
  `codex.reasoning_effort`, `copilot.model`, and `global.max_parallel_tasks`.
  Values are JSON scalars. Model/voice/language/reasoning choices are validated
  against the backend catalog; Codex/Copilot catalogs currently contain only
  `default`. P2-11 verified that the runner can apply explicit model overrides
  (and Codex reasoning) through provider options. Task rows retain an optional
  model override and Codex reasoning override. The runner's ACP session metadata
  retains the effective selection across resumed turns. P2-05 still owns
  resolving task overrides before the applicable settings default. The global
  task limit is an integer from 1 to
  100. Partial writes are transactional; settings are defaults for future
  sessions/tasks, not live updates or history. At the start of a hosted Jarvis
  session, the agent keeps the effective model and reasoning effort in memory for
  that session; the snapshot is not persisted.
- `activity` is the "what's happening" feed on the main page. It carries an `area`, so later areas can add to it without changes.

## 2 · Projects

```mermaid
erDiagram
    projects {
        bigint id PK
        string name "Jarvis, Daily, ..."
        string repo "owner/name"
        string default_branch
        string default_agent "codex | copilot"
        string policy "deliver_pr | complete_without_deployment"
        string merge_rules "Dan's per-project rules, Decision 2"
        string sandbox_size "1x2 | 2x4"
        string tech "node | dotnet | ..."
        int max_parallel_tasks
        bool active
    }
```

- One row per repository. `tech` chooses the sandbox image (small images, L23).
- P1-03's SQL-backed API returns active projects, updates only active rows, and
  archives by setting `active = 0`; archived rows remain to preserve task
  references and the unique repository constraint. Repositories stay reserved
  after archive.
- P1-10 reads project settings from that API and derives each running-task count
  from `tasks.state = 'Running'`. No project columns or migration are added;
  release data remains in group 5 and is not yet shown as a real value.

## 3 · Tasks and queue

```mermaid
erDiagram
    projects ||--o{ tasks : has
    tasks ||--o{ task_events : logs
    tasks ||--o{ task_event_archives : indexes
    tasks {
        bigint id PK
        bigint project_id FK
        bigint origin_message_id FK "the message that created it; nullable for board tasks"
        string title
        string request "what Dan asked for"
        string source "board | voice | chat"
        string agent "codex | copilot"
        string model_override "nullable"
        string reasoning_override "nullable"
        string state "Ready | Running | PauseRequested | Paused | NeedsAttention | Done | Cancelled"
        string activity "current activity shown on the card"
        int priority
        int attempt_count
        datetime next_attempt_at "retry time"
        string lease_owner "dispatcher instance"
        datetime lease_until
        string branch
        datetime created_at
        datetime started_at
        datetime finished_at
    }
    task_events {
        bigint id PK
        bigint task_id FK
        string type "created, started, steered, paused, files_changed, tests_run, pushed, failed, ..."
        string summary
        json payload
        string source "runner | backend | github | dan"
        datetime at
    }
    task_event_archives {
        bigint id PK
        bigint task_id FK
        datetime first_at
        bigint first_event_id
        string blob_name
        int event_count
        datetime archived_at
    }
```

- **The queue is `tasks` itself (Decision 3, option A).** The dispatcher takes the highest-priority oldest eligible `Ready` task within the global and project limits. A transaction-owned `jarvis.task-dispatcher` app lock serializes capacity checks and claims; `lease_owner` and `lease_until` reserve a startup slot. Expired startup leases move to `NeedsAttention`, not another start, because the remote start may have succeeded before the dispatcher stopped.
- **Retries:** `attempt_count` increments for each leased start. Safe pre-start failures retry after 15 and 30 seconds, up to three attempts; `next_attempt_at` gates each retry. Ambiguous Foundry start outcomes are not replayed and move to `NeedsAttention`.
- `task_events` stores **every** task event (Dan's choice: maximum freedom for the UI). It is append-only, drives the card's live updates (via SSE) and the task's history, and is the only fast-growing table; archive by age: a backend job moves events older than 90 days to private Blob Storage in bounded batches. The SQL rows are deleted only after their archive blobs upload successfully, and `task_event_archives` records the blob references in the same SQL transaction as deletion. Task-detail pages read only the indexed archived chunks they need and keep the same bounded pagination. The live `recordEvent` write path remains unchanged. Each event also creates a `factory` activity row with its type as `kind`, its summary (or type) as title, and `task:<id>` as link.
- `origin_message_id` links a task to the message in Jarvis's conversation that created it. The existing schema requires this reference for non-board tasks; board tasks may omit it.
- P1-04 creates a board task only for an active project, using the project's default agent unless the request selects one. Task creation and its `created` event share a transaction. Backend state transitions lock the task row, enforce the product lifecycle, and write a `state_changed` event in that transaction; `Done` requires a trusted, verified-completion call. There is no client state-update route.
- P1-05 writes each task event and its activity row in the same transaction. The runner-only `POST /factory/sandbox-events` validates its task-scoped input and calls `TaskStore.recordEvent` with source `runner` (no schema change); `recordEvent` is also the producer API for backend event sources; JSON payloads are capped at 1 MiB. The in-process hub publishes only after commit; payloads over 4 KiB are omitted from the published event and marked truncated. P1-06's authenticated SSE endpoint reads missed events from `task_events` by ascending ID in bounded pages, buffers live hub publications during replay, and suppresses overlapping IDs. The fetch client reconnects with the last delivered ID; the stream sends a heartbeat comment every 25 seconds. No schema change is needed.
- `GET /factory/tasks` filters by project, agent, state, creation period and search, with bounded offset pagination. `GET /factory/tasks/:id` returns the task and a bounded, pageable event slice. Responses are capped at 1 MiB; event payloads over 4 KiB are omitted and marked truncated.
- P1-08's board uses the task list and event stream without changing the schema. The current task-list contract has no pull-request, check, or usage fields, so those card values remain explicitly unavailable until the GitHub integration (P3-03/P3-04) and usage work (P2-12) supply them.
- Runner task events carry disk readings in `payload.data`: `disk_snapshot` records
  `disk_total_bytes`, `disk_used_bytes`, and `disk_free_bytes` at turn start, with
  the configured `disk_low_threshold_bytes`. A `disk_low` event records the
  threshold breach; its transaction moves a Running task to NeedsAttention with
  reason `disk_low` and releases the task lease. No schema migration is required.

## 4 · Sandbox

```mermaid
erDiagram
    tasks ||--o{ sandbox_sessions : "runs in"
    sandbox_sessions ||--o{ sandbox_turns : has
    tasks ||--o{ artifacts : produces
    sandbox_sessions {
        bigint id PK
        bigint task_id FK
        string foundry_session_id
        string agent_version
        string agent_name "nullable for legacy sessions"
        string size "1x2 | 2x4"
        string image
        string status "Starting | Active | Idle | Crashed | Ended"
        datetime started_at
        datetime last_heartbeat_at
        datetime last_event_at
        datetime ended_at
        string end_reason "done | cancelled | crashed | idle"
        decimal cost_estimate_dkk
    }
    sandbox_turns {
        bigint id PK
        bigint sandbox_session_id FK
        string invocation_id
        string mode "task | steer | pause | resume"
        string acp_session_id
        string status "running | completed | cancelled | failed"
        datetime started_at
        datetime ended_at
    }
    artifacts {
        bigint id PK
        bigint task_id FK
        string kind "log | transcript | screenshot | ci_log"
        string blob_path
        int size_bytes
        datetime at
    }
```

- A task can have several sessions: a crash ends one session, and recovery starts a new one from the branch (L22). The dispatcher records `agent_name` for heartbeat routing. `agent_version = 'active'` and `image` records the selected Foundry runner route (for example `jarvis-runner-base-1x2`); the Invocations start response does not expose the resolved version number or container digest.
- The sandbox heartbeat updates `last_heartbeat_at`; it needs the session's `agent_name` to address the Foundry runtime. Live runner events update `last_event_at` and add `task_events`.
- Large content (logs, CI logs, transcripts) lives in Blob; SQL keeps only the path.
- The schema checks sandbox sizes, statuses, turn modes, end reasons and artifact kinds against these vocabularies. UTC `datetime2` end and heartbeat/event timestamps cannot precede their start.
- `sandbox_sessions` is indexed by task and status; turns and artifacts are indexed by their parent and timestamp for the session/task timelines.

## 5 · GitHub and release

```mermaid
erDiagram
    tasks ||--o{ pull_requests : opens
    pull_requests ||--o{ workflow_runs : "checked by"
    projects ||--o{ releases : ships
    releases ||--o{ workflow_runs : "built by"
    releases ||--o{ deployments : "deployed as"
    pull_requests {
        bigint id PK
        bigint task_id FK
        bigint project_id FK
        int number
        string branch
        string head_sha
        string state "open | merged | closed"
        string checks "pending | passed | failed"
        datetime opened_at
        datetime merged_at
    }
    workflow_runs {
        bigint id PK
        bigint project_id FK
        bigint github_run_id
        string workflow "ci | release"
        string trigger "pull_request | push | tag"
        string head_sha
        bigint pull_request_id FK "nullable"
        bigint release_id FK "nullable"
        string status "queued | in_progress | completed"
        string conclusion "success | failure | cancelled"
        string log_artifact "blob path of the failing log"
        datetime started_at
        datetime completed_at
    }
    releases {
        bigint id PK
        bigint project_id FK
        string version "build number of the merge"
        string sha
        string status "building | deploying | released | failed"
        datetime created_at
        datetime released_at
    }
    deployments {
        bigint id PK
        bigint release_id FK
        string environment "production, ..."
        string status "queued | in_progress | success | failure"
        datetime at
    }

```

- **One release = one merge to `main`** (no tags). Filled from GitHub webhooks (`pull_request`, `check_run`, `workflow_run`, `deployment_status`, `push`), never by polling.
- **Commits are not stored.** The release area shows a horizontal git graph per project (branches as lines, commits as dots): commits and branches come from the GitHub API when the page opens or when Dan asks Jarvis; the dots are coloured from `pull_requests`, `workflow_runs`, `releases` and `deployments`.
- A failed PR check stores the log in Blob, and the backend steers the task with it.
- The release view reads `releases`, `workflow_runs` and `deployments`, plus commits from GitHub on demand.

## 6 · Operations

```mermaid
erDiagram
    webhook_deliveries {
        string delivery_id PK "GitHub's X-GitHub-Delivery"
        string event
        datetime received_at
        datetime processed_at
        string outcome "ok | ignored | error"
    }
    credential_status {
        string name PK "codex-login, copilot-token, github-app-key"
        datetime expires_at
        datetime last_renewed_at
        string status "ok | renew_soon | failed | unknown"
        uuid renewal_lease_owner "nullable"
        datetime renewal_lease_until "nullable"
    }
```

- `webhook_deliveries` makes webhook handling idempotent: GitHub may deliver the same event twice.
- A delivery is first stored with null outcome and processing time; those fields are set together to `ok`, `ignored` or `error` when handled. No webhook payload or secret is stored here.
- `credential_status` stores expiry/last-updated dates and status only, never secret values. Codex and Copilot start as `unknown`; Key Vault metadata and Codex renewal populate dates. A paired owner/expiry lease serializes Codex renewal against Codex task starts; unknown status alone does not block tasks, while a failed Codex renewal does.
- Container App sleep state is read from Azure's configured minimum replicas; it is not persisted in `settings` or another SQL table. The sleep refusal check takes an exclusive transaction-owned application lock while task creation and state transitions take the shared lock, so no Ready or Running task can be introduced between the check and scale request. This adds no schema object.

## 7 · Usage and cost

```mermaid
erDiagram
    tasks ||--o{ usage : "uses"
    usage {
        bigint id PK
        bigint task_id FK "nullable for Jarvis conversation use"
        bigint project_id FK "nullable"
        bigint sandbox_session_id FK "nullable"
        bigint jarvis_session_id FK "nullable"
        string source "sandbox | jarvis_model | voice | codex | copilot"
        string metric "minutes, input_tokens, output_tokens, turns, premium_requests"
        decimal quantity
        decimal cost_dkk "null for subscription use (Codex, Copilot)"
        string source_event_id "nullable; runner invocation/event identity"
        datetime at
    }
```

| Source | Measured from | Cost in DKK |
| --- | --- | --- |
| Sandbox | Session start to end (`sandbox_sessions`) × size | Yes, ≈ 0.89 DKK per hour at 1 vCPU / 2 GiB |
| Jarvis model | Token usage per model round | Yes, list price per model |
| Voice | Voice minutes per `jarvis_session` | Yes, estimated |
| Codex | Turns, and tokens if `codex-acp` reports them | No: ChatGPT Pro subscription; usage shown only. Actual live report fields remain to verify |
| Copilot | Turns, and premium requests if Copilot CLI reports them | No: Copilot seat; usage shown only. Actual live report fields remain to verify |

P2-12's `0007_usage.sql` implements the table and its reverse migration. Sandbox
rows are tied to a `sandbox_session_id`; their minute quantity and DKK estimate
are written when that session ends, while an active session's elapsed estimate
is computed by task detail. Agent turns are recorded immediately before an ACP
prompt. Provider metrics are stored only from explicit numeric `usage` objects in
ACP prompt results or usage notifications, with a runner invocation/event key to
make repeated delivery idempotent. The task detail API and page expose those
entries. Offline package documentation advertises Codex token-usage events but
does not establish their exact fields; Copilot documentation explains quota
consumption but not a per-turn ACP report. Authenticated live runs remain
necessary to verify either provider's actual report.

- Views sum `usage` per task, per project and per period, so Dan sees when Codex and Copilot were used and what each task cost.

## Physical schema (groups 1–3)

`0001_core_tables.sql` implements the diagrams above in `dbo` with these choices:

| Topic | Rule |
| --- | --- |
| Keys | `bigint IDENTITY` primary keys; `settings` uses `(scope, [key])` (`key` is reserved in T-SQL, so quote it) |
| Time | `datetime2(7)` UTC; event and creation times default to `SYSUTCDATETIME()` |
| Fixed values | `nvarchar` with `Latin1_General_100_BIN2` collation and a check, so `ready` is rejected where `Ready` is required. Values exactly as in the diagrams |
| Open vocabularies | `activity.area`/`kind` and `task_events.type`: lowercase letters and `_`. `settings.key`: lowercase, digits, `.`, `-`, `_`. `projects.tech`: lowercase, digits, `.`, `-`, `_`. `tool_calls.tool`: the tool registry's `[A-Za-z0-9_-]{1,64}` |
| JSON | `nvarchar(max)` with `ISJSON(..., VALUE)` (any JSON value, including strings and `null`); `tool_calls.arguments` must be an object (`ISJSON(..., OBJECT)`) |
| `settings.scope` | `global` or `project:<id>` with a positive integer id |
| `projects` | `repo` is unique (case-insensitive) and shaped `owner/name` using `A–Z a–z 0–9 . _ -`; `max_parallel_tasks` ≥ 1, default 1; `active` defaults to 1; `merge_rules` is free text, nullable |
| `tasks` | `state` defaults to `Ready`; `origin_message_id` is required unless `source = 'board'`; `lease_owner` and `lease_until` are both set or both null; `attempt_count` ≥ 0; `priority` defaults to 0; `started_at`/`finished_at` not before `created_at` |
| `messages` | `model` and token counts are nullable (Dan's messages have none); token counts ≥ 0 |
| `tool_calls` | `result` nullable; `0001` permits `ok` or `error`; `task_id` nullable |
| Foreign keys | No cascades. Projects are archived (`active = 0`), not deleted |
| Indexes | Dispatcher `IX_tasks_state_next_attempt_at`; timeline `IX_task_events_task_id_at`; plus one per foreign key: `IX_messages_jarvis_session_id_at`, `IX_tasks_project_id_state` (also the per-project running count), filtered `IX_tasks_origin_message_id`, `IX_tool_calls_message_id`, filtered `IX_tool_calls_task_id` |

P6-03's `0005_task_event_archives.sql` adds the archive index table without changing
the `task_events` producer schema. The API still validates every field (P1-03,
P1-04); these checks are the last line of defence.

P4-05 adds `refused` to the runtime tool-call outcomes, but the current
`CK_tool_calls_outcome` constraint in `0001_core_tables.sql` still permits only
`ok` and `error`. Persisting a refused call therefore needs a forward schema
migration; the history API accepts and displays all three outcomes.

## Conventions

- `bigint` identity keys; UTC `datetime2` timestamps; states as short strings with check constraints.
- JSON only for event payloads, tool arguments and settings values; never as the domain model.
- Indexes: `tasks(state, next_attempt_at)` for the dispatcher; `task_events(task_id, at)`; `workflow_runs(head_sha)`; `usage(task_id)`, `usage(project_id, at)`; and an index supporting each foreign key.
- Every migration ships a reverse script in `db/migrations/down/`; CI applies, reverts and reapplies all of them.
- Thousands of tasks over time are no concern; `task_events` is the only table that grows fast and can be archived by age.

## Decided in sparring (3 October 2026)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Conversations and tasks | One continuous Jarvis conversation, split into sessions; a task stores `origin_message_id`. Compaction and memory later (Decision 6). |
| 2 | Task events | Store every runner event in SQL; archive by age. |
| 3 | Releases | One release per merge to `main`; no tags. |
| 4 | Commits | Not stored; fetched from GitHub on demand. A horizontal git graph per project in the release area. |
| 5 | Costs | Track usage per task and project in `usage`; DKK where billed, usage only for Codex and Copilot. |
| 6 | Settings history | Not needed. |

## Still open

- What usage Codex (`codex-acp`) and Copilot CLI actually report per turn (tokens, premium requests); offline package documentation was inspected in P2-12, but authenticated live runs remain the verification step.
- How a dismissed `activity` item is stored. The main page can dismiss items (PRODUCT.md), but `activity` has no dismissal column. P1-13 adds one with its migration and updates this model.