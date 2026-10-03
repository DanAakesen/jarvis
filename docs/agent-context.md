# Agent context

Project-specific working context for agents. The generated `AGENTS.md` is not edited; additions belong here.

## Scope

- Phase 1 only: the Jarvis core and the Software Factory area ([PRODUCT.md](../PRODUCT.md), [PLAN.md](../PLAN.md)).
- Do not add tables, pages, or code for Banking, Health and fitness, Calendar, or other areas until their phase starts.
- Single user (Dan). Keep the design as small as the requirements allow.

## Sources

| Need | Read |
| --- | --- |
| Requirements, page data points, and actions | [PRODUCT.md](../PRODUCT.md) |
| Phases, tasks, task status, acceptance criteria | [PLAN.md](../PLAN.md) |
| One issue per task: start trigger, discussion, linked PR | [GitHub issues](https://github.com/DanAakesen/jarvis/issues) in `DanAakesen/jarvis` |
| Stack, runtime, sandbox, voice, dispatch, cost | [architecture.md](architecture.md) |
| Tables, relationships, and groups | [data-model.md](data-model.md) |
| Step-by-step flows with evidence status | [architecture-flows.html](architecture-flows.html) (open in a browser) |
| Decisions and learnings L1–L29 | [decisions.md](decisions.md) |
| Prototype code and reports to port in P2 and P4 | [reference/](reference/) |
| Open-source research | [open-source.md](open-source.md) |

## Development workflow

Every coding agent on this repository follows these rules. This project requires one pull request per task; that overrides the template's "no PR required".

### Where work happens

- **Remote only.** Agents work in GitHub Copilot cloud agent or Codex cloud and deliver through a pull request. `main` on GitHub is the only source of truth; nothing may exist only on a local machine.
- **Local work needs Dan's permission.** An agent running on Dan's PC (Copilot CLI, Codex CLI, or an editor agent) asks Dan before changing anything and stops without a clear yes. Known local-only steps: `infra/bootstrap.ps1` and the Codex login seed, because both need Dan's sign-in.
- **No Azure access for agents.** Changes reach Azure only through the deploy workflows on `main`; GitHub Actions can sign in to Azure only for `main`. In a PR, check infrastructure without Azure (`az bicep build`, linter); the deploy after merge proves it against Azure. Verify Azure behaviour from those workflow runs, or ask Dan.

### Task status

- Every task in [PLAN.md](../PLAN.md) has a [GitHub issue](https://github.com/DanAakesen/jarvis/issues) in `DanAakesen/jarvis`. The title starts with the task ID (for example `P1-04: Tasks API`), the label is the phase (`P0`–`P6`), and the body copies the task, acceptance criteria, and dependencies. Find one with `gh issue list --repo DanAakesen/jarvis --state all --search "P1-04 in:title"`.
- **Dependencies:** the Depends on column is mirrored as GitHub issue dependencies ("Blocked by"). An issue shows **Blocked** until every issue it depends on is closed. A task is **ready** when its issue is open, unassigned, and not blocked; list ready tasks with `gh issue list --repo DanAakesen/jarvis --search "is:open no:assignee -is:blocked"`. Ready tasks can run in parallel.
- Dependencies order tasks; they don't stop two ready tasks from changing the same files. That is what step 5 of [Start a task](#start-a-task) and the up-to-date rule in [Merge](#merge) are for.
- `PLAN.md` is the source of truth for what a task is. The issue is where a task is started and discussed, and where its PR is linked. If the two differ, `PLAN.md` wins.
- When a PR adds a task to `PLAN.md` or changes one, its issue must match: create or update it, including its "Blocked by" dependencies. If you can't edit issues from your environment, list the needed issue changes in the PR body. P0-13 automates this.
- Status values: **Not started**, **In progress**, **Blocked**, **Complete**. The Status column in `PLAN.md` on `main` is the shared view of the project.
- Dan (or later Jarvis) starts a task, from the issue or directly in the agent's app. **The agent claims the issue itself** (step 1 of [Start a task](#start-a-task)); Dan never assigns issues by hand.
- A task is **In progress** when its issue has an assignee or an open PR containing `Fixes #<issue>`. The plan-status workflow (P0-13) writes that to `PLAN.md` on `main`, sets Complete when the PR merges, and resets Not started if the PR closes unmerged and the issue is unassigned.
- Until P0-13 is merged, the agent also sets the status in its own PR.

### Start a task

1. **Claim the issue before anything else.** Find it by task ID, then:
   - The task is taken if the issue has a `Claimed by` comment, is assigned to Copilot, or has an open PR with `Fixes #<issue>`, and that claim isn't yours. Then stop and say so. (Codex claims with Dan's token, so Dan as assignee alone doesn't tell who works on it.)
   - **Codex cloud:** assign the issue and comment, using `GH_TOKEN` from the environment: `gh issue edit <n> --repo DanAakesen/jarvis --add-assignee @me` and `gh issue comment <n> --repo DanAakesen/jarvis --body "Claimed by Codex at <UTC time>."`. Without `gh`, call the GitHub REST API with `curl` (`POST /repos/DanAakesen/jarvis/issues/<n>/assignees` and `/comments`). If the claim fails, stop and report it; never work on an unclaimed task.
   - **Copilot cloud agent:** started from the issue, Copilot is assigned and opens a draft PR with the issue link automatically. Started anywhere else, open the draft PR with `Fixes #<issue>` in its body first. Its draft PR is its claim.
   - **Any other environment:** claim the same way, or ask Dan.
2. Read the current `main`: the Status column and Current focus in `PLAN.md`, the relevant [decisions](decisions.md), and the files the `AGENTS.md` context map names for your area.
3. Check that `main` is green: the latest `CI` and deploy runs on `main` passed (before P0-11 adds deploy, only `CI` counts). If not, stop. The only allowed work is a fix for `main` (PR title `fix-main: …`).
4. Check your task: not Complete, not claimed by anyone else, and every task in its "Depends on" column Complete. If any check fails, stop and report it on the issue.
5. Look at the running tasks (In progress rows, assigned issues, and open PRs). Stay out of files they change, or say in your PR why you overlap.
6. Use one branch and one PR. The PR title is exactly `<task ID>: <short summary>`, for example `P0-05: Foundry account and project`: the ID, a colon, a space, no brackets. Copilot's temporary `[WIP] ` prefix is fine. Work outside a task uses `fix-main: …` or `docs: …`. The [PR title](../.github/workflows/pr-title.yml) workflow corrects small deviations and fails otherwise. The PR body contains `Fixes #<issue>`. When the PR merges, GitHub closes the issue, and the tasks it blocked unblock automatically. Never remove "Blocked by" links by hand; they stay as history. If a task needs more than one PR, use `Refs #<issue>` in all but the last.

### Finish a task

Before marking the PR ready, update the repository in the same PR so the next agent needs no other context:

| What your task did | Update |
| --- | --- |
| Always | `PLAN.md`: task Status Complete; Current focus (active phase, next step, blockers) |
| Added or changed product behaviour or a requirement | [PRODUCT.md](../PRODUCT.md) |
| Changed the stack, packages, versions, service boundaries, data flows, identities, or deployment | [architecture.md](architecture.md) |
| Made a choice, accepted a trade-off, or answered a **Verify** item | [decisions.md](decisions.md) decision log: date, decision, rationale and evidence, status |
| Hit a mistake or pitfall another agent could repeat | [decisions.md](decisions.md): a new learning (next free L#) |
| Added or changed tables, columns, indexes, or migrations | [data-model.md](data-model.md) |
| Added or verified a command, environment variable, secret name, or setup step | this file |
| Built or proved a step in a flow | [architecture-flows.html](architecture-flows.html): the box status |
| Settled a visual direction or found a UI issue | [DESIGN.md](../DESIGN.md) |
| Found work outside the task | `PLAN.md`: a new task (next free ID in its phase, Depends on filled in, Not started) or an entry under Ideas. Update the Depends on column of any task this changes. Never drop it silently. |

The PR body states what changed, how it was verified (commands and results), what remains unverified, and follow-ups. Then mark the PR ready for review; the merge workflow never merges a draft.

Every task issue ends with the same "Before you start" and "Definition of done" checklist that summarises these rules. New task issues get it too.

### Merge

- **No manual approval.** The merge workflow (P0-12) squash-merges a PR when it is ready (not a draft; see Copilot drafts below), no agent is still working on it, its title starts with a task ID, `fix-main:`, or `docs:` (documentation changes outside a task), all checks pass, and it contains the latest `main`. If the branch is behind, the workflow updates it and waits for the checks again, so every merge is tested against the current `main`.
- **Never start from a broken `main`.** After every merge, CI and deploy run on `main`; deploy skips documentation-only changes and deploys only the parts that changed ([P0-11](../PLAN.md#p0--foundations)). If either fails, the merge workflow merges only `fix-main:` PRs until `main` is green again.
- **Copilot drafts:** Copilot cloud agent never marks its own PR ready; it finishes by removing `[WIP]` from the title and requesting review. The [Copilot PR ready](../.github/workflows/copilot-ready.yml) workflow then marks the PR ready, so Copilot PRs need no click from Dan.
- Agents never merge their own PRs, push to `main`, or weaken or skip checks.
- Parallel PRs edit the same documents. When your branch is updated, keep other agents' entries, take the next free numbers (task IDs, L#), and recheck that your updates still hold.
- Until P0-12 is merged, Dan merges green PRs.
## Azure

| Item | Value |
| --- | --- |
| Subscription | "Dan Aakesen", `0ac7d719-89bc-4100-be87-a79d33e953a7` |
| Tenant | Novaro, `802efa29-17f2-4a79-8f5f-38f087aed96a` |
| Region | Sweden Central |
| Dan's Entra object ID | `12bcfab7-49ba-4cf7-8be7-780a13911f93` (the backend's allow-list) |
| Resource group | `rg-jarvis` (one production environment) |
| Bootstrap IDs | [`infra/bootstrap.output.json`](../infra/bootstrap.output.json); also Actions variables in `DanAakesen/jarvis` |

- `infra/main.bicep` deploys into the existing `rg-jarvis`; it does not create the group or bootstrap identities. Run `az bicep build --file infra/main.bicep` and `az bicep lint --file infra/main.bicep` in PRs; the build writes `infra/main.json`, which is generated output and must not be committed. These checks need no Azure access.
- The Bicep deployment must supply `backendIdentityResourceId`, `sqlAdminGroupObjectId`, `backendImage`, and `foundryNameTimestamp`. The timestamp is a 14-digit UTC value in `yyyyMMddHHmmss` format, for example `20261003120000`. P0-11 must save the chosen value in deployment configuration and supply the same value on every normal redeployment, so the existing Foundry account and project are updated in place. Do not generate a new timestamp for each workflow run.
- `sqlAdminGroupName` defaults to `jarvis-sql-admins`; the budget defaults to 300 in the subscription billing currency. Confirm the billing currency is DKK and supply any required budget notification email addresses as appropriate. The first Azure deployment and real resource behavior are verified by P0-11, not by the local build/lint.
- Dan's Azure CLI defaults to the Microsoft tenant: pass `--subscription` in every command and script (L7). For Microsoft Graph, get the token with `az account get-access-token --subscription <id> --resource-type ms-graph`; `--tenant` picks the wrong account.
- `az` runs through a `.cmd` file: avoid `&`, parentheses, and pipes inside arguments such as `--query` (L20); filter JSON in PowerShell instead.
- Never reuse a deleted Foundry account or project name; generate timestamped names (L2).
- `FOUNDRY_*` and `AGENT_*` environment variables are reserved in hosted agents (L18).
- Foundry has separate administration (`*.services.ai.azure.com`) and runtime (`*.cognitiveservices.azure.com`) hosts (L10).
- Create the Log Analytics workspace in the resource group before Application Insights (L8).
- Every component that opens a hosted-agent session deletes it (L14).
- Windows scripts: no `&` in `az` arguments; format dates with the invariant culture (L20).
- Creating or deleting Azure resources, spending money, or deploying needs Dan's approval unless it runs through the approved GitHub Actions workflows.

## Secrets

- Local secrets live in `.secrets/` (git-ignored). Never print, copy, or commit them.
- In Azure, secrets live only in Key Vault; services use managed identities, and GitHub Actions uses OpenID Connect.
- Codex: the Jarvis-only login follows the [Codex login rules](architecture.md#sandbox-credentials). Never copy Dan's own Codex login.
- Codex cloud environment: `GH_TOKEN` is a fine-grained token for `DanAakesen/jarvis` with only **Issues: read and write**, used to claim issues. It is an environment variable, not a Codex secret, because Codex removes secrets before the agent runs. Never print it, write it to files, or use it for anything else.
- P0-01 exception: Dan explicitly authorized using the existing `GH_TOKEN` to open its linked PR. PR #78 creation succeeded. This task-specific authorization does not change the issue-claim restriction for other tasks.

## Setup and commands

The repository uses npm workspaces for `apps/web` and `apps/backend`, one root
lockfile, and shared strict TypeScript configuration. P0-02 implements the web
skeleton with React/Vite, routing, ESLint and Vitest; P0-03 adds the Fastify
backend with `/health`, safe structured logs, ESLint, Vitest and a Dockerfile.
Python and SQL components remain in their planned tasks.
P0-04 adds the Bicep template; its Azure deployment awaits P0-11.

Use Node.js 22.23.3 (`.nvmrc`), npm 10.9.9 (`packageManager`), TypeScript 6.0.3,
and Python 3.12.14 (`.python-version`, for future Python work). Install from the
repository root. Prototype dependencies are excluded from npm workspaces.
See [README.md](../README.md) for public web configuration and overrides.

Verified in Codex cloud for P0-02:

| Purpose | Command |
| --- | --- |
| Frozen dependency installation | `npm ci` in the repository root |
| Both workspace builds | `npm run build` in the repository root |
| Both workspace lint checks | `npm run lint` in the repository root (P0-03 adds backend lint) |
| Both workspace tests (single run) | `npm test` in the repository root (P0-03 adds backend tests) |
| Targeted web checks | `npm run lint --workspace @jarvis/web`; `npm test --workspace @jarvis/web` |
| Run web app | `npm run dev` in the repository root; open `http://localhost:5173` |
| Watch web tests | `npm run test:watch --workspace @jarvis/web` |

The web starts with the bootstrap identities and the public production backend
origin in `apps/web/config.json` (optional `VITE_BACKEND_URL` override). The URL
is pending P0-11's first deployment; opening the skeleton needs no extra setup.
Sign-in and authenticated API calls remain P0-09. `Web CI` checks lint, tests,
and root builds as part of the aggregate `CI` workflow (below).

Backend commands implemented in P0-03:

| Purpose | Command |
| --- | --- |
| Backend lint / offline tests / targeted build | `npm run lint --workspace @jarvis/backend`; `npm test --workspace @jarvis/backend`; `npm run build --workspace @jarvis/backend` |
| Start compiled backend | `npm start --workspace @jarvis/backend` (after its build) |
| Build then start backend | `npm run dev --workspace @jarvis/backend` |
| Health request | `curl --fail http://localhost:3000/health` → `{"status":"ok"}` |
| Production container (GitHub Actions only; no Docker in an agent sandbox) | `docker build --file apps/backend/Dockerfile --tag jarvis-backend .` from the repository root |

`PORT` defaults to 3000, matching Container Apps ingress. `LOG_LEVEL` defaults
to `info`. `STATIC_WEB_APP_ORIGIN` is an exact HTTPS origin with no trailing
slash, path or query; it is required when `NODE_ENV=production`. P0-11 supplies
the deployed Static Web App origin. Browser origins are limited to this value
and `http://localhost:5173`; requests with another Origin receive 403. Requests
without Origin (such as container health probes) are allowed. CORS is not
authentication; P0-08 supplies token validation before business endpoints exist.

`APPLICATIONINSIGHTS_CONNECTION_STRING` is backend-only protected runtime
configuration supplied by P0-11 through Key Vault references. When absent,
logs go to stdout only and `telemetry.stdout_only` makes that state visible.
The isolated manual SDK receives the same safe events; automatic request and
dependency instrumentation is not enabled. Log output drops headers, bodies,
URLs, query strings, arbitrary messages and raw errors. Request IDs are generated
by the server. Telemetry tests use fake sinks, never Azure. SIGTERM/SIGINT stops
the backend and bounds close/flush/disposal to five seconds.

`Backend CI` runs the offline lint, tests and targeted build plus a production
container build and smoke test without Azure credentials. Its image uses pinned
Node.js, runs as non-root, and contains backend output and production dependencies.
Container verification belongs in Actions; live telemetry ingestion and Azure
connectivity remain unverified until P0-11.

Verified locally in P0-04 (Azure deployment remains pending P0-11):

| Purpose | Command |
| --- | --- |
| Build Bicep (generates git-ignored `infra/main.json`) | `az bicep build --file infra/main.bicep` |
| Lint Bicep | `az bicep lint --file infra/main.bicep` |

Dan requests a fresh checkout of the latest `main` for every task. A new cloud
task can use its provided checkout; a task started in an existing cloud session
uses a separate Git worktree and task branch. Git HTTPS access and GitHub API access are
separate: cloud environment network settings must allow `api.github.com` for
issue/PR operations, as well as GitHub Git access and package registries. Never
request a token merely because a network policy blocks that hostname.

Verified locally for issue #30 (no Azure access required):

| Purpose | Command from the repository root |
| --- | --- |
| Build the standalone backend Foundry client | `npm run build --workspace @jarvis/backend` |
| Lint the client module | `npx --no-install eslint --config apps/backend/src/foundry/lint.config.mjs apps/backend/src/foundry --max-warnings 0` |
| Run offline Foundry contract tests | `npx --no-install vitest run --config apps/backend/src/foundry/vitest.config.mts` |

The client constructor takes `runtimeEndpoint`, `adminEndpoint`, `agentName` and an injected `getToken(scope, signal)` identity provider. These are module options, not new environment variables. See the [module guide](../apps/backend/src/foundry/README.md) for operation ownership and fixture provenance. Recorded runner responses are captured locally with ACP stubbed; these checks establish the offline contract, not live Azure readiness. The dedicated `Foundry contract CI` workflow checks this module on the current skeleton without depending on the server implementation.

Aggregate CI (P0-10), `.github/workflows/ci.yml`:

| Item | Detail |
| --- | --- |
| Triggers | Every `pull_request`, `push` to `main`, and `workflow_dispatch` (P0-12 starts it on `main` after a merge) |
| Jobs | `Web`, `Backend` (lint, tests, build, container smoke) and `Foundry` call the reusable `web-ci.yml`, `backend-ci.yml` and `foundry-contract.yml`; `Python lint, test and build`; `CI result` |
| Gate | `CI result` fails unless every other job succeeded. It is the check to require on `main` and for P0-12 `workflow_run` |
| Python | `bash .github/scripts/python-ci.sh [dir ...]` (default `runner agents/jarvis`). A component with `pyproject.toml` must have a hash-pinned `requirements-dev.txt` with ruff and pytest; each gets its own venv, `ruff check`, `pytest -q` and `compileall`. A component without `pyproject.toml` is reported as skipped (notice and step summary), not passed |
| Local workflow lint (verified for P0-10) | `go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7`, then `~/go/bin/actionlint` from the repository root |

- Add a new component workflow as `on: workflow_call`, call it from `ci.yml`, and add it to `CI result`'s `needs`, so it runs once per PR and the gate covers it.
- Required checks on `main` are not enforced: branch protection on a private repository needs GitHub Pro. When available, Dan requires `CI result`; until then P0-12 must read the `CI` run result itself.

Future commands (unimplemented until their tasks):

| Purpose | Command |
| --- | --- |
| Bootstrap or repair identities | `./infra/bootstrap.ps1` (safe to re-run; needs Dan's signed-in `az` and `gh`) |
| Python tests | `pytest` in `runner` and `agents/jarvis` (CI runs them through `python-ci.sh` once present) |
| Validate Mermaid diagrams (candidate; unverified) | `npx -y @mermaid-js/mermaid-cli@11 -i <file>.md -o <out>.md` |

Pin the Codex and Copilot CLI versions locally and in the sandbox image (L13).

## Release procedure

- Every change reaches `main` through a PR merged by the merge workflow (see [Merge](#merge)). A merge deploys infrastructure, backend, and web; the backend applies migrations at startup.
- No manual portal changes.

## Documentation rules

- English; short bullets, tables, diagrams, and brief supporting text.
- Keep requirements, proposals, evidence, and open questions distinct.
- Keep stable decision (#) and learning (L#) numbers; add new ones at the end of [decisions.md](decisions.md).
- When a status, decision, or learning changes, update the matching boxes in [architecture-flows.html](architecture-flows.html) in the same change.
- Prototype reports keep only run instructions and raw evidence; decisions and learnings belong in [decisions.md](decisions.md).
