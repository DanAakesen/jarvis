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
| Decisions and learnings L1–L40 | [decisions.md](decisions.md) |
| Prototype code and reports to port in P2 and P4 | [reference/](reference/) |
| Open-source research | [open-source.md](open-source.md) |

## Development workflow

Every coding agent on this repository follows these rules. This project requires one pull request per task; that overrides the template's "no PR required".

### Where work happens

- **Remote only.** Agents work in GitHub Copilot cloud agent or Codex cloud and deliver through a pull request. `main` on GitHub is the only source of truth; nothing may exist only on a local machine.
- The runner instructs coding agents on every turn, including resumed or recovered sessions, to commit and push small work-in-progress changes to the existing task branch after each meaningful step. Never force-push or push to `main`; report commit or push failures.
- **Local work needs Dan's permission.** An agent running on Dan's PC (Copilot CLI, Codex CLI, or an editor agent) asks Dan before changing anything and stops without a clear yes. Known local-only steps: `infra/bootstrap.ps1` and the Codex login seed, because both need Dan's sign-in.
- **No Azure access for agents.** Changes reach Azure only through the deploy workflows on `main`; GitHub Actions can sign in to Azure only for `main`. In a PR, check infrastructure without Azure (`az bicep build`, linter); the deploy after merge proves it against Azure. Verify Azure behaviour from those workflow runs, or ask Dan.

### Task status

- Every task in [PLAN.md](../PLAN.md) has a [GitHub issue](https://github.com/DanAakesen/jarvis/issues) in `DanAakesen/jarvis`. The title starts with the task ID (for example `P1-04: Tasks API`), the label is the phase (`P0`–`P6`), and the body copies the task, acceptance criteria, and dependencies. Find one with `gh issue list --repo DanAakesen/jarvis --state all --search "P1-04 in:title"`.
- **Dependencies:** the Depends on column is mirrored as GitHub issue dependencies ("Blocked by"). An issue shows **Blocked** until every issue it depends on is closed. A task is **ready** when its issue is open, not blocked, and has no worker label; list ready tasks with `gh issue list --repo DanAakesen/jarvis --search "is:open -is:blocked -label:Codex -label:Copilot -label:Dan -label:Jarvis"`. Ready tasks can run in parallel.
- Dependencies order tasks; they don't stop two ready tasks from changing the same files. That is what step 5 of [Start a task](#start-a-task) and the up-to-date rule in [Merge](#merge) are for.
- `PLAN.md` is the source of truth for what a task is. The issue is where a task is started and discussed, and where its PR is linked. If the two differ, `PLAN.md` wins.
- When a PR adds a task to `PLAN.md` or changes one, its issue must match: create or update it, including its "Blocked by" dependencies. If you can't edit issues from your environment, list the needed issue changes in the PR body. P0-13 automates this.
- When a task row is added to `PLAN.md` on `main`, the plan-status workflow creates its issue in the standard format, with the phase label and "Blocked by" dependencies. If an existing task's description or acceptance criteria change, update the issue body too; the workflow reconciles dependencies but does not rewrite existing issue content.
- Status values: **Not started**, **In progress**, **Blocked**, **Complete**. The Issue and Status columns in `PLAN.md` on `main` are the shared issue and status view of the project.
- **Worker labels show who has taken a task:** `Codex`, `Copilot`, `Dan`, and `Jarvis` (Jarvis's own coding agents, from P2). **A worker label on an open issue means that worker has taken the task; nobody else may start it.** On a closed issue the label stays as a record of who did it. An issue has at most one worker label.
- Dan (or later Jarvis) starts a task, from the issue or directly in the agent's app. **The worker sets its own label** (step 1 of [Start a task](#start-a-task)); Dan never labels or assigns by hand, except `Dan` for work he does himself.
- A task is **In progress** when its open issue has a worker label or an open PR containing `Fixes #<issue>`. A merged linked PR or an issue closed as completed sets Complete. An open issue without a worker label or open linked PR is Not started, except a manually set Blocked value is preserved.
- `.github/workflows/plan-status.yml` recomputes every task on issue assignment/unassignment/closure/reopen/label/unlabel, PR open/close/reopen/edit, completion of the Worker label workflow, or `workflow_dispatch`. A `PLAN.md` push also creates missing issues and dependency links. The workflow writes the Issue and Status columns; agents edit those columns only before P0-13 is merged. It serializes runs, commits only those columns, skips no-op commits, and rebases/retries once after a rejected push. `GITHUB_TOKEN`-made commits do not trigger another push workflow.
- The status workflow requires `contents: write`, `issues: write`, and `pull-requests: read`. A protected-`main` push and the REST issue-dependency writes have not yet been verified against a live workflow run. After merge, run **Plan status** through `workflow_dispatch` and verify the test task before relying on live writes.
- Issues that existed before worker labels: Codex's claims used Dan as assignee. Those were relabelled `Codex` on 3 October 2026; ignore an assignee without a worker label.

### Start a task

1. **Claim the issue before anything else: set your worker label.** Find the issue by task ID, then:
   - If it already has a worker label that isn't yours, or an open PR with `Fixes #<issue>` that isn't yours, the task is taken: stop and say so.
  - **Codex:** add the `Codex` label and a comment, using `GH_TOKEN` from the environment: `gh issue edit <n> --repo DanAakesen/jarvis --add-label Codex` and `gh issue comment <n> --repo DanAakesen/jarvis --body "Claimed by Codex at <UTC time>."`. Don't assign the issue. Without `gh`, call the REST API with `curl` (`POST /repos/DanAakesen/jarvis/issues/<n>/labels` with `{"labels":["Codex"]}`, and `/comments`). If the claim fails, stop and report it; never work on an unclaimed task.
  - **Copilot cloud agent:** Copilot can't edit labels, so the [Worker label](../.github/workflows/worker-label.yml) workflow adds `Copilot` when the issue is assigned to Copilot or Copilot opens a PR with `Fixes #<issue>`. Started outside the issue, open the draft PR with `Fixes #<issue>` in its body first.
  - **Dan** adds `Dan` himself. **Jarvis** (from P2) adds `Jarvis` when its dispatcher starts a task.
  - **Releasing a task:** a worker that stops without delivering removes its label and says why in a comment. The Worker label workflow removes `Copilot` when Copilot's PR closes unmerged.
2. Read the current `main`: the Issue and Status columns and Current focus in `PLAN.md`, the relevant [decisions](decisions.md), and the files the `AGENTS.md` context map names for your area.
3. Check that `main` is green: the latest `CI` and deploy runs on `main` passed (before P0-11 adds deploy, only `CI` counts). If not, stop. The only allowed work is a fix for `main` (PR title `fix-main: …`).
4. Check your task: not Complete, not claimed by anyone else, and every task in its "Depends on" column Complete. If any check fails, stop and report it on the issue.
5. Look at the running tasks (issues with a worker label, In progress rows, and open PRs). Stay out of files they change, or say in your PR why you overlap.
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
- **Copilot drafts:** Copilot cloud agent never marks its own PR ready; it finishes by removing `[WIP]` from the title and requesting review. The [Copilot PR ready](../.github/workflows/copilot-ready.yml) workflow then marks the PR ready, also after follow-up rounds and while the PR has merge conflicts (L
- Agents never merge their own PRs, push to `main`, or weaken or skip checks.
- Parallel PRs edit the same documents. When your branch is updated, keep other agents' entries, take the next free numbers (task IDs, L#), and recheck that your updates still hold.
- The periodic portion of #12 is `.github/workflows/coordinator.yml`; Dan explicitly authorized it before #11. See [GitHub coordinator](github-coordinator.md) for the secret, controls, eligibility, existing-PR repairs and remaining live acceptance. Its current state must be verified in Actions; it does not claim #12 or deployment complete. Until it is active, Dan merges green PRs.
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

## GitHub App setup

[`github-app-manifest.json`](github-app-manifest.json) is the registration settings reference for the private Jarvis GitHub App. Enter these values in GitHub's **Register a new GitHub App** form; GitHub's settings form does not import this JSON. The `Jarvis Software Factory` name may be changed if GitHub reports it is unavailable.

| GitHub permission | Access | Reason |
| --- | --- | --- |
| Contents | Read and write | Read task repositories and push agent branches |
| Pull requests | Read and write | Create, inspect, and merge pull requests |
| Checks | Read-only | Read check results |
| Actions | Read-only | Read workflow runs |
| Deployments | Read-only | Read deployment status |

Subscribe to `check_run`, `deployment_status`, `pull_request`, `push`, and `workflow_run`. GitHub requires repository metadata read access automatically. Install only on the repositories Dan selects for Jarvis; do not grant access to all repositories by default.

Do not configure a webhook URL or secret until P0-11 has deployed the backend and P3-03 has implemented its receiver. The manifest intentionally has no webhook URL because neither endpoint is available yet. A GitHub App ID is not a secret; the private key is.

Dan's manual setup checklist:

1. Wait for [P0-11](https://github.com/DanAakesen/jarvis/issues/11) to deploy the Key Vault and backend. Use the deployed `keyVaultName` output; do not guess a vault name.
2. In GitHub, register the App using the settings above, leave the webhook URL unset until P3-03 is deployed, and install it only on the intended repositories. This requires Dan's GitHub account to administer the owner and selected repositories.
3. Generate one private key from the App's settings. Download it to a temporary, access-controlled location outside the repository and any synced folder. Never paste or upload it to GitHub, a PR, chat, GitHub Actions, or a sandbox.
4. From Dan's signed-in Azure CLI, import the PEM file directly into the deployed vault. Replace placeholders locally; do not add the key or its value to the command:

   ```powershell
   az keyvault secret set --subscription <subscription-id> --vault-name <key-vault-name> --name github-app-private-key --file <private-key.pem> --encoding utf-8 --output none
   ```

   `--output none` suppresses the returned secret value. Dan needs permission to set secrets on this vault (for example, Key Vault Secrets Officer); cloud coding agents must not run this command or access Azure.
5. Verify only the secret metadata, never its value:

   ```powershell
   az keyvault secret show --subscription <subscription-id> --vault-name <key-vault-name> --name github-app-private-key --query "{id:id,enabled:attributes.enabled}" --output json
   ```

6. Remove the temporary local PEM copy. The backend managed identity reads the key from Key Vault for app authentication; never pass the key to a runner. Record only the non-secret App ID for the later P3-02 backend configuration.
7. When P3-03 provides a deployed webhook endpoint, set that URL in the App, generate a separate random webhook secret with a password manager, and temporarily stage it outside the repository and synced folders. Import it into Key Vault without displaying the value:

   ```powershell
   az keyvault secret set --subscription <subscription-id> --vault-name <key-vault-name> --name github-app-webhook-secret --file <webhook-secret.txt> --encoding utf-8 --output none
   ```

   Configure that same secret in GitHub's App settings and remove the temporary local copy. Do not put either copy in source control or logs.

Status, 3 October 2026: Dan registered the App and installed it on selected repositories (step 2). No private key exists yet; steps 3–6 follow P0-11 and step 7 follows P3-03 (task P3-10). Key Vault storage and webhook delivery are unverified until then. The manifest and instructions do not claim they have happened.

## Setup and commands

The repository uses npm workspaces for `apps/web` and `apps/backend`, one root
lockfile, and shared strict TypeScript configuration. P0-02 implements the web
skeleton with React/Vite, routing, ESLint and Vitest; P0-03 adds the Fastify
backend with `/health`, safe structured logs, ESLint, Vitest and a Dockerfile.
Python runtime and SQL domain tables remain in their planned tasks. Issue #7 adds the database connection and startup migration infrastructure.
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
authentication. P0-08 installs a root bearer-authentication hook before CORS,
so future area routes inherit it. Only `/health` GET/HEAD and the generated CORS
preflight route are public; explicit OPTIONS business endpoints are protected.

Backend authentication defaults to the nonsecret identities in
`infra/bootstrap.output.json`. `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID` and
`ENTRA_OWNER_OBJECT_ID` may override those UUIDs at startup. The API expects an
RS256 Entra v2 delegated access token with the API client ID as audience and
`access_as_user` scope; an ID token, app-only token or another user's object ID
is denied. `request.principal` contains only the verified object and tenant IDs.
Missing/invalid credentials return 401; verified but unauthorized tokens return
403. Authentication failures never export token/claim/provider details.
Approved browser origins retain CORS headers on these early denials so the web
can read their status; unapproved origins receive no allow-origin header.

`npm test --workspace @jarvis/backend` includes real RSA/local-JWKS auth checks,
socket duplicate-header rejection, cached keys and bounded provider outages.
They require no Azure identity or external JWKS service. The production JWKS
lookup timeout is five seconds. `/me` and browser sign-in remain P0-09; live
Azure token verification remains P0-11.

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

### Database access and migrations (#7)

- Configure `SQL_SERVER=<host>.database.windows.net`, `SQL_DATABASE=jarvis` and
  `SQL_MANAGED_IDENTITY_CLIENT_ID=<id-jarvis-backend client UUID>` in the backend
  deployment. These are identifiers, not passwords. `SQL_AUTH_MODE` may be omitted
  or `managed-identity`. Password/user/port overrides are forbidden in this mode;
  TLS certificate validation is always enabled.
- With no SQL variables, the offline skeleton logs `database.not_configured` and
  keeps `/health` available. Partial/invalid configuration fails startup. #11 must
  supply all three settings and verify identity membership/SQL connectivity.
- The backend owns a pool, runs migrations before listening and closes it on
  failed/cancelled startup or shutdown. SQL calls are bounded to 120 seconds,
  lock contention to 60 seconds, and complete startup to 300 seconds. Initialization
  is outside Fastify ready hooks so their 10-second timeout cannot abort SQL
  auto-resume. No idle SQL poll or periodic migration job is added.
- Append immutable files under `db/migrations/` as `NNNN_name.sql`; use one SQL
  batch per file, no `GO`, and never rewrite an applied file or insert before
  applied history. See [migration guide](../db/migrations/README.md). Domain
  schema and up/down acceptance remain #17.
- Offline checks: `npm test --workspace @jarvis/backend`,
  `npm run lint --workspace @jarvis/backend`,
  `npm run build --workspace @jarvis/backend`.
- Real SQL contracts: `npm run test:database --workspace @jarvis/backend` in
  `database-ci.yml`, called by aggregate `ci.yml` and included in `CI result`.
  Actions owns the disposable SQL Server container; agents do not run Docker or
  reach Azure SQL. Test-password mode requires `NODE_ENV=test`, `SQL_SERVER=127.0.0.1`,
  `SQL_USER`, `SQL_PASSWORD` and `SQL_DATABASE`; its isolated fixture is not a
  production credential. See [database guide](../apps/backend/src/database/README.md).
- Real Azure managed-identity exchange and applying/restarting a deployed revision
  remain #11. Offline contracts never establish live Azure readiness.

Aggregate CI (P0-10), `.github/workflows/ci.yml`:

| Item | Detail |
| --- | --- |
| Triggers | Every `pull_request`, `push` to `main`, and `workflow_dispatch` (P0-12 starts it on `main` after a merge) |
| Jobs | `Web`, `Backend` (lint, tests, build, container smoke), `Database` (isolated SQL Server contracts), `Foundry` and `Runner` (base and .NET images, packaged CLI and HTTP smoke) call the reusable `web-ci.yml`, `backend-ci.yml`, `database-ci.yml`, `foundry-contract.yml` and `runner-ci.yml`; `Python lint, test and build` (runner lint and tests moved here from `runner-ci.yml`); `CI result` |
| Gate | `CI result` fails unless every other job succeeded. It is the check to require on `main` and for P0-12 `workflow_run` |
| Python | `bash .github/scripts/python-ci.sh [dir ...]` (default `runner agents/jarvis`). A component with `pyproject.toml` must have a hash-pinned `requirements-dev.txt` with ruff and pytest; each gets its own venv, `ruff check`, `pytest -q` and `compileall`. A component without `pyproject.toml` is reported as skipped (notice and step summary), not passed |
| Local workflow lint (verified for P0-10) | `go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7`, then `~/go/bin/actionlint` from the repository root. It passes for the CI files; it reports existing findings in `runner-ci.yml` (SC2034 warning) and `runner-deploy.yml` (an unquoted ` #11` ends the `prerequisite` step's YAML scalar, so that job failed on `main` at 290195b; needs a `fix-main:` PR) |

- Add a new component workflow as `on: workflow_call`, call it from `ci.yml`, and add it to `CI result`'s `needs`, so it runs once per PR and the gate covers it.
- Required checks on `main` are not enforced: branch protection on a private repository needs GitHub Pro. When available, Dan requires `CI result`; until then P0-12 must read the `CI` run result itself.

Plan status, `.github/workflows/plan-status.yml`:

| Item | Detail |
| --- | --- |
| Triggers | Issue assigned/unassigned/closed/reopened; PR opened/closed/reopened/edited; push to `main` changing `PLAN.md`; manual `workflow_dispatch` |
| Status source | Paginated GitHub issue and PR lists; the offline rules and task-row parser are in `.github/scripts/plan_status.py` |
| New task rows | On a `PLAN.md` push or dispatch, create issues for task IDs without one, add phase labels, then ensure dependency links with the REST `blocked_by` endpoint |
| Commit | Only changes the Issue and Status cells in `PLAN.md`; no commit when unchanged; direct push to `main`, then one fetch/rebase/push retry if rejected |
| Permissions | `contents: write`, `issues: write`, `pull-requests: read`; no secrets or Azure credentials |
| Offline tests | `PYTHONPATH=.github/scripts python3 -m unittest discover -s .github/scripts/tests -v` |
| Live verification | Pending merge: dispatch the workflow and verify a test task; protected-branch push and issue-dependency writes remain unverified |

### Backend modules

Backend modules are composed through the optional third `buildApp` argument;
defaults are `core` and `factory`. Module plugins inherit root security hooks and
contribute internal Jarvis tools without exposing a dispatcher. See the
[module guide](../apps/backend/src/modules.README.md). Register lifecycle hooks
before `ready()`/`listen()`; module startup failures must prevent listening.
The existing backend test/lint/build commands cover the module extension contract.

Future commands (unimplemented until their tasks):

| Purpose | Command |
| --- | --- |
| Bootstrap or repair identities | `./infra/bootstrap.ps1` (safe to re-run; needs Dan's signed-in `az` and `gh`) |
| Python tests | `pytest` in `runner` and `agents/jarvis`, through each package's `.venv` (see [Cloud agent environments](#cloud-agent-environments)); CI runs them through `.github/scripts/python-ci.sh` |
| Validate Mermaid diagrams (candidate; unverified) | `npx -y @mermaid-js/mermaid-cli@11 -i <file>.md -o <out>.md` |

Pin the Codex and Copilot CLI versions locally and in the sandbox image (L13).

### Cloud agent environments

P0-14 prepares both cloud agents with the same dependency step,
[`scripts/setup-dependencies.sh`](../scripts/setup-dependencies.sh). It is
noninteractive and safe to re-run. It fails unless Node.js, npm and Python
exactly match `.nvmrc`, `packageManager` and `.python-version` (it installs the
pinned npm when needed), runs `npm ci`, and gives each Python package (`runner`,
`agents/jarvis`) its own git-ignored `.venv`, installed with
`pip --require-hashes` from `requirements-dev.txt` (else `requirements.txt`). A
package without a hash-locked file fails; an absent package is reported as
skipped and has no tests. Setup fails if it changed any tracked file. It reads
no tokens, calls no Azure service, and builds no Docker image. Lint and tests
are not part of setup.

| Agent | Setup | Status |
| --- | --- | --- |
| Copilot cloud agent | [`.github/workflows/copilot-setup-steps.yml`](../.github/workflows/copilot-setup-steps.yml): `setup-node` and `setup-python` from the pin files, then the shared script. Copilot uses it only once it is on `main`; it also runs as a normal workflow when its inputs change, or manually | The `Copilot Setup Steps` workflow passed on the P0-14 PR; in the P0-14 Copilot session the shared script, `npm run lint`, `npm test` and the runner's ruff and pytest passed |
| Codex cloud | Setup script (and maintenance script) in the Codex environment settings: `bash scripts/codex-setup.sh`. It runs `nvm install`/`nvm alias default` for Node.js, `pyenv install`/`pyenv global` for Python (uv's managed Python if pyenv lacks the version), then the shared script | nvm + uv path verified outside Codex; the Codex image (pyenv path) and a Codex task are unverified: P0-15 |

For P0-15, Dan sets in the Codex environment: setup script `bash scripts/codex-setup.sh`;
optionally `CODEX_ENV_NODE_VERSION=22` and `CODEX_ENV_PYTHON_VERSION=3.12`
(the script installs the exact patch versions itself). The setup script
downloads from nodejs.org, registry.npmjs.org, python.org or GitHub (uv's
Python builds) and PyPI; Codex setup scripts normally have internet access, but
this is unverified for this environment. A Codex task then runs
`npm run lint` and `npm test`. The pyenv path compiles Python on first setup,
which takes a few minutes; Codex caches the result.

Python checks use each package's `.venv`. For the runner, from `runner/`:
`.venv/bin/python -m ruff check .` and `.venv/bin/python -m pytest -q`
(verified in the P0-14 Copilot session after setup: ruff passed, 36 tests passed).
`agents/jarvis` has no Python package yet, so setup skips it.

## Release procedure

- Every change reaches `main` through a PR merged by the merge workflow (see [Merge](#merge)). A merge deploys infrastructure, backend, and web; the backend applies migrations at startup.
- No manual portal changes.

## Documentation rules

- English; short bullets, tables, diagrams, and brief supporting text.
- Keep requirements, proposals, evidence, and open questions distinct.
- Keep stable decision (#) and learning (L#) numbers; add new ones at the end of [decisions.md](decisions.md).
- When a status, decision, or learning changes, update the matching boxes in [architecture-flows.html](architecture-flows.html) in the same change.
- Prototype reports keep only run instructions and raw evidence; decisions and learnings belong in [decisions.md](decisions.md).

## Runner setup and release

Issue #28 adds the Python runner independently of the npm workspaces. With Python
3.12.14, create `runner/.venv` and install `runner/requirements-dev.txt` with
`python -m pip install --require-hashes -r ...`. Codex cloud validated frozen
installation with `uv pip sync --require-hashes`, `python -m pytest -q` and
`python -m ruff check .` from `runner/`; the local OpenAPI route returned HTTP 200.
Runner CI owns Docker builds and packaged CLI/HTTP checks because agents have no
Docker runtime here. Production Key Vault/Foundry acceptance is still unverified.

The main-only [runner deploy workflow](../.github/workflows/runner-deploy.yml)
requires Actions variable `JARVIS_INFRA_DEPLOYMENT_NAME`, set after #11's successful
Bicep deployment. It consumes that deployment's existing outputs and bootstrap
Azure variables, queues under `jarvis-production-deploy`, builds the two images
in ACR, deploys both capacity tiers, and records identity-probe evidence. #11 must
use that same deployment concurrency group. The workflow never seeds secrets;
`github-token`, `copilot-token`, and the Jarvis-only `codex-login` must already be
in Key Vault. Installation tokens replace the prototype Git-token path in #40.
See [runner/README.md](../runner/README.md) for commands and the contract.
