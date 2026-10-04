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
| Production operations | [Runbook](runbook.md) |
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

### Task board

Dan follows the work on the [Project Jarvis board](https://github.com/users/DanAakesen/projects/2). Every open issue is on it. [`project_board.py`](../.github/scripts/project_board.py) sets its Status column; nobody moves cards by hand, because the next sync moves them back.

| Column | Meaning (open issues) |
| --- | --- |
| **Backlog** | Blocked: at least one issue it depends on is still open. |
| **Ready** | Not blocked, no worker label, no open linked PR: any worker may claim it. |
| **In progress** | Has a worker label, or an open draft PR with `Fixes #<issue>`. |
| **In review** | Has an open PR with `Fixes #<issue>` that is ready for review: waiting for checks and merge. |
| **Done** | Issue closed (the project's built-in "Item closed" workflow). |

- The rules are in `project_board.py` and its tests. Ready on the board is the same as **ready** above.
- **Who syncs:** [`project-board.yml`](../.github/workflows/project-board.yml), in the cloud. It reconciles every open issue on issue open/close/reopen/label/unlabel, PR open/close/reopen/ready/draft/edit, after each **Plan status** run, daily at 05:17 UTC, and on `workflow_dispatch`. It adds missing issues and writes only cards whose column changed. It uses `pull_request_target`, so PRs with merge conflicts still sync (L38), and never checks out PR code. Nobody needs to ask an agent.
- **Token:** projects owned by a personal account can only be edited with a classic token (`repo` scope); GitHub Actions tokens, GitHub Apps, and fine-grained tokens can't. The token is the `PROJECT_TOKEN` secret of the `project-board` environment, which only `main` may use (deployment branch policy), so workflows on agent PR branches can't read it. Verified on 3 October 2026: a workflow on a test branch was rejected with "Branch is not allowed to deploy to project-board". Without the secret, a run only warns.
- Manual run, for example to test: `DRY_RUN=1` lists the moves without writing; see the environment variables in the workflow.
- The project's built-in workflows may set a column first (item added, PR linked, PR merged); the sync runs seconds later and sets the final one. Built-in "Item closed" moves closed issues to Done.

### Start a task

1. **Claim the issue before anything else: set your worker label.** Find the issue by task ID, then:
   - If it already has a worker label that isn't yours, or an open PR with `Fixes #<issue>` that isn't yours, the task is taken: stop and say so.
  - **Codex:** add the `Codex` label and a comment, using `GH_TOKEN` from the environment: `gh issue edit <n> --repo DanAakesen/jarvis --add-label Codex` and `gh issue comment <n> --repo DanAakesen/jarvis --body "Claimed by Codex at <UTC time>."`. Don't assign the issue. Without `gh`, call the REST API with `curl` (`POST /repos/DanAakesen/jarvis/issues/<n>/labels` with `{"labels":["Codex"]}`, and `/comments`). If the claim fails, stop and report it; never work on an unclaimed task.
  - **Copilot cloud agent:** Copilot can't edit labels, so the [Worker label](../.github/workflows/worker-label.yml) workflow keeps `Copilot` on an open issue exactly while an open Copilot PR links it (`Fixes`/`Closes`/`Resolves #<issue>`), or while the issue is assigned to Copilot and no Copilot PR for it was closed unmerged. Each run recomputes all open issues ([rules](../.github/scripts/worker_label.py)). Started outside the issue, open the draft PR with `Fixes #<issue>` in its body first.
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
| Added, changed, removed or verified a feature (including new planned tasks) | [features.md](features.md): its row's status, surface and tasks |
| Found work outside the task | `PLAN.md`: a new task (next free ID in its phase, Depends on filled in, Not started) or an entry under Ideas. Update the Depends on column of any task this changes. Never drop it silently. |

The PR body states what changed, how it was verified (commands and results), what remains unverified, and follow-ups. Then mark the PR ready for review; never merge a draft, and never merge a PR whose diff against `main` is empty or whose only commits are a plan or merges from `main` (L69).

Every task issue ends with the same "Before you start" and "Definition of done" checklist that summarises these rules. New task issues get it too.

### Merge

- **Coordinator removed.** Dan or an explicitly authorized agent squash-merges a PR when it is ready (not a draft; see Copilot drafts below), no agent is still working on it, its title starts with a task ID, `fix-main:`, or `docs:` (documentation changes outside a task), all checks pass, and it contains the latest `main`. If the branch is behind, the authorized worker updates it and waits for the checks again, so every merge is tested against the current `main`.
- **Never start from a broken `main`.** After every merge, CI and deploy run on `main`; deploy skips documentation-only changes and deploys only the parts that changed ([P0-11](../PLAN.md#p0--foundations)). If either fails, merge only `fix-main:` PRs until `main` is green again. Only a **failed** run blocks: a queued, pending or in-progress Deploy is not a broken `main`, so start or continue your task (L75).
- **Copilot drafts:** Copilot cloud agent never marks its own PR ready; it finishes by removing `[WIP]` from the title and requesting review. The [Copilot PR ready](../.github/workflows/copilot-ready.yml) workflow then marks the PR ready, also after follow-up rounds and while the PR has merge conflicts (L Follow-up rounds (after an `@copilot` comment) can't edit the title, so on Copilot's closing comment the workflow also drops a leftover `[WIP]` prefix.
- Agents never merge their own PRs, push to `main`, or weaken or skip checks.
- Parallel PRs edit the same documents. When your branch is updated, keep other agents' entries, take the next free numbers (task IDs, L#), and recheck that your updates still hold.
- The Jarvis coordinator for #12 is removed at Dan's request. It no longer assigns issues, merges PRs or requests conflict repairs. The separate Project board sync and its `project-board` environment remain. Dan merges green PRs or explicitly instructs an agent to merge them. Deployment integration remains #11.
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
- `infra/bootstrap.ps1` registers `Microsoft.BotService`; `Microsoft.CognitiveServices` is already registered there. When a backend image exists, Bicep provisions Azure Bot Service F0 with its Teams channel, plus Azure Speech F0 and a **Cognitive Services Speech User** assignment to `id-jarvis-backend`. The bot uses that user-assigned identity; no client secret, speech key, additional app registration, or new deployment secret is required.
- Bicep sets backend `TEAMS_BOT_APP_ID`, `TEAMS_BOT_TENANT_ID`, `TEAMS_AUDIO_ORIGIN`, and `SPEECH_REGION` from the identity, subscription, Container Apps environment, and Speech resource. Speech is F0-only: if the free allowance is exhausted or synthesis fails, delivery remains text-only. Local build/lint and fake service tests do not prove the resource role, deployed endpoint, free allowance, Teams installation, or live phone approval.
- The Bicep deployment must supply `backendIdentityResourceId`, `sqlAdminGroupObjectId` and `foundryNameTimestamp`; `backendImage` is optional (empty skips the backend app, used only before the first backend image exists). The timestamp is fixed at `20261003200000` in `infra/main.parameters.json`, so every deploy updates the existing Foundry account and project in place. Change it only to recover from a deleted account, and then to a fresh value (L2).
- Bicep sets `BACKEND_CONTAINER_APP_RESOURCE_ID` and grants `id-jarvis-backend` a custom role limited to Container App read/write on that app. The sleep API uses this fixed target and the existing `SQL_MANAGED_IDENTITY_CLIENT_ID` for ARM authentication. Local tests inject the scaler; a local app without an Azure managed identity cannot perform live scaling, and the Bicep build/lint checks do not verify the deployed role.
- `sqlAdminGroupName` defaults to `jarvis-sql-admins`; the budget defaults to 300 in the subscription billing currency. Deploy requires the `JARVIS_BUDGET_CONTACT_EMAILS` GitHub secret, a comma-separated list including Dan's email. It passes the values through a mode-0600 temporary parameters file to the required Bicep `budgetContactEmails` parameter, then deletes the file. Do not commit email addresses. The first Azure deployment and real resource behavior are verified by Deploy, not by local Bicep build/lint.
- The [Deploy workflow](../.github/workflows/deploy.yml) is the only routine path to Azure: push to `main` deploys the parts changed since the last successful Deploy run; Dan's `workflow_dispatch` on `main` redeploys everything. Its Bicep deployment is always named `jarvis-infra`. Details: [production deploy](architecture.md#production-deploy-p0-11).
- GitHub Actions OIDC: GitHub signs this repository's tokens with the immutable-ID subject `repo:DanAakesen@68902534/jarvis@1403065900:ref:refs/heads/main`, not `repo:DanAakesen/jarvis:ref:refs/heads/main`. `infra/bootstrap.ps1` reads the IDs with `gh api repos/DanAakesen/jarvis` and registers the federated credential `github-main-ids`. An `AADSTS700213` sign-in failure means the credential is missing: Dan re-runs bootstrap; the subject is printed under "Federated token details" in the `azure/login` step (L49).
- Dan's Azure CLI defaults to the Microsoft tenant: pass `--subscription` in every command and script (L7). For Microsoft Graph, get the token with `az account get-access-token --subscription <id> --resource-type ms-graph`; `--tenant` picks the wrong account.
- P7-10 deploys `JARVIS_NOTES_FOLDER_PATH` from the `notesFolderPath` Bicep parameter (default `/Jarvis/Notes`). After merge, the coordinator must review and approve the broad Graph `Files.Read.All` application permission before running `./infra/setup-notes-search.ps1` with an administrator-authorized Azure CLI session. The script is idempotent and assigns the permission to `id-jarvis-backend`; Graph Search does not support `Sites.Selected`. The backend fixes the user to Dan and scopes queries and returned links to the configured folder. Live tenant consent and a known-note search remain unverified.
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

Do not configure a webhook URL or secret until P0-16 has deployed the backend and P3-03 has implemented its receiver. The manifest intentionally has no webhook URL. A GitHub App ID is not a secret; the private key and webhook secret are.

Dan's manual setup checklist:

1. Wait for [P0-16](https://github.com/DanAakesen/jarvis/issues/131) to deploy the Key Vault and backend. Use the deployed `keyVaultName` output; do not guess a vault name.
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

6. Remove the temporary local PEM copy. The backend managed identity reads the key from Key Vault for app authentication; never pass the key to a runner. The App ID is not secret: set repository Actions variable `JARVIS_GITHUB_APP_ID`; the Deploy workflow maps it to backend configuration `GITHUB_APP_ID`, not to the sandbox.
7. P3-02 rollout: leave `JARVIS_GITHUB_APP_TOKEN_ENABLED` unset (defaults to `false`) while deploying the backend and confirming the Key Vault secret is available. Then set that repository Actions variable to `true` and manually dispatch **Runner deploy** from `main`; the workflow requires `JARVIS_GITHUB_APP_ID` and configures new runner versions for App tokens. Run a live sandbox push to `DanAakesen/jarvis-test-target`. Keep the existing `jarvis-github` secret/token and runner read grant until that check passes; remove them and the legacy fallback in a follow-up only after success.
8. After P3-03 is merged and deployed, read the `backendFqdn` and `keyVaultName` outputs from the `jarvis-infra` deployment. Generate a separate random webhook secret with a password manager and temporarily stage it outside the repository and synced folders. Import it into Key Vault without displaying the value:

   ```powershell
   az deployment group show --subscription <subscription-id> --resource-group <resource-group> --name jarvis-infra --query "properties.outputs.{backendFqdn:backendFqdn.value,keyVaultName:keyVaultName.value}" --output json
   az keyvault secret set --subscription <subscription-id> --vault-name <key-vault-name> --name github-app-webhook-secret --file <webhook-secret.txt> --encoding utf-8 --output none
   ```

   In **GitHub → Settings → Developer settings → GitHub Apps → Jarvis Software Factory → Webhook**, set the URL to `https://<backendFqdn>/github/webhooks`, choose `application/json`, paste the same secret, enable the webhook, and subscribe to `pull_request`, `check_run`, `workflow_run`, `deployment_status`, and `push`. Save the settings, remove the temporary local copy, and inspect **Recent Deliveries** for a successful 2xx response to GitHub's initial `ping`. The receiver records that signed but unsupported event as ignored. Never put either copy in source control or logs.

Status, 4 October 2026: Dan registered the App, installed it on all repositories of his account, trimmed its permissions, and stored `github-app-private-key` in Key Vault (P3-10). P3-02 code is merged but its live token issuance and sandbox push are not yet verified. The webhook receiver (P3-03) is implemented; webhook secret provisioning, App URL configuration, and live delivery remain Dan's post-merge steps. P3-05 uses a separate repository-scoped token with only Actions read permission in the backend, stores failed-job logs in the existing private `logs` container, and never passes that token to the sandbox. The backend setting `global.max_check_attempts` defaults to 3 and accepts 0–10; 0 disables automatic repairs. The receiver caches the webhook secret after its first successful lookup, so restart the backend when rotating it.

## Setup and commands

The repository uses npm workspaces for `apps/web` and `apps/backend`, one root
lockfile, and shared strict TypeScript configuration. P0-02 implements the web
skeleton with React/Vite, routing, ESLint and Vitest; P0-03 adds the Fastify
backend with `/health`, safe structured logs, ESLint, Vitest and a Dockerfile.
Python runtime remains in its planned tasks. Issue #7 adds the database connection and startup migration infrastructure; P1-01 (#15) adds the first domain tables (groups 1–3), and P2-01 (#27) adds sandbox and operations groups 4 and 6.
P0-04 adds the Bicep template; its first Azure deployment is P0-16. Bicep sets backend `KEY_VAULT_URI`; the backend uses its managed identity to read `github-app-webhook-secret`. Locally, the URI can be omitted; webhook requests then fail with 503. The secret is cached in memory after a successful lookup and requires a backend restart to rotate.

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
| Focused P3-11 checks | `npm test --workspace @jarvis/backend -- --run src/core/settings.test.ts`; `npm test --workspace @jarvis/web -- --run src/SettingsPage.test.tsx src/factory/ProjectsPage.test.tsx src/factory/TasksPage.test.tsx` |
| Focused P3-13 checks | `npm --workspace @jarvis/backend test -- --run src/github-app.test.ts src/factory/projects.test.ts`; `npm --workspace @jarvis/web test -- --run src/factory/ProjectsPage.test.tsx` |
| Focused P3-12 contracts | `npm test --workspace @jarvis/backend -- --run src/credentials/repo-admin.test.ts src/factory/new-project.test.ts src/factory/heartbeat.test.ts`; `runner/.venv/bin/python -m pytest -q runner/tests/test_app.py` from repository root |
| Focused chat UI and API tests | `npm test --workspace @jarvis/web -- --run src/ConversationHistory.test.tsx src/conversation-history.test.ts`; `npm test --workspace @jarvis/web -- --run src/App.test.tsx` |
| Focused P6-01 usage API and SQL-store tests | `npm test --workspace @jarvis/backend -- --run src/core/usage.test.ts src/database/usage-store.test.ts` |
| Focused P3-05 failed-check tests | `npm test --workspace @jarvis/backend -- src/database/checks-loop-blob.test.ts src/database/checks-loop-store.test.ts src/github/checks-loop.test.ts src/github/actions-logs.test.ts src/github/webhook.test.ts src/core/settings.test.ts src/github-app.test.ts` |
| Focused P6-01 usage page and navigation tests | `npm test --workspace @jarvis/web -- --run src/usage/UsagePage.test.tsx src/App.test.tsx` |
| Run web app | `npm run dev` in the repository root; open `http://localhost:5173` |
| Watch web tests | `npm run test:watch --workspace @jarvis/web` |

The web starts with the bootstrap identities and the public production backend
origin in `apps/web/config.json` (optional `VITE_BACKEND_URL` override). With a
backend URL, MSAL signs in against the configured tenant and calls authenticated
`/me`; only the backend-approved display name is shown. The main-page sleep
switch reads and updates the backend's configured replica count; the API refuses
to sleep while tasks are Ready, Running, or PauseRequested.
`Web CI` checks lint, tests, and root builds as part of the aggregate `CI`
workflow (below). Local tests use signed fixture tokens and do not verify a live
Entra tenant or Azure deployment.

Browser checks of signed-in pages (verified in Copilot cloud agent for P1-07,
P1-10 and P1-11, where the Playwright MCP tools were unavailable; L45): in a scratch
directory outside the repository, run `npm install --no-save playwright-core`,
then drive
`chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] })`.
Signed-in pages need a scratch Vite config. It aliases `./auth` to a stub that
returns a profile and defines `__JARVIS_CONFIG__` with a placeholder backend
URL. For settings, serve a mock `/settings` response from that harness only.
P1-11 was inspected at 390 and 1280 px; save and disabled actions were exercised.
P1-12 was inspected at 390 and 1440 px with mocked sleep-status, scale, refusal,
and failure responses; sleep/wake, refusal, retry, and the Settings link worked
without horizontal overflow or browser errors. Mocks do not verify ARM scaling.
P1-10 was inspected at 390 and 1280 px with scratch-only project/task API mocks;
list, create, update and archive worked, the settings form stacked on mobile,
there was no horizontal overflow, controls were at least 44 px high, and no
console exceptions occurred. Mocks do not verify live Entra, Azure SQL, or
production API behavior.

P8-13 was inspected in Chromium at 1440×1000 and 390×844 using the scratch auth
stub and Vite settings mock. The mock rejected the first dark-mode PATCH with
HTTP 400, after which the prior light appearance remained selected; retry
accepted dark, and reloading Settings restored it. Keyboard navigation reached
the dark radio with a visible native focus outline; the phone layout had no
horizontal overflow. Muted-text contrast against the page/surface was at least
6.25:1 in light mode and 8.99:1 in dark mode. The only browser console/network
error was the intentionally rejected mock request; no page exceptions occurred.
Screenshots are in `docs/ui/screenshots/p8-13-theme-settings-*.png`. These mocks
do not verify live Entra, API authorization, or Azure SQL persistence.
P1-14 was inspected at 390 and 1440 px with scratch-only database-status and
project API mocks: “Waking Jarvis…” appeared during a reported wait, disappeared
when requests settled, and status polling stopped while idle. No horizontal
overflow or page exceptions occurred. This does not verify live SQL auto-resume.
Focused P1-14 checks: `npm test --workspace @jarvis/backend -- src/app.test.ts
src/factory/tasks.test.ts src/database/wake-retry.test.ts src/database/lifecycle.test.ts
src/database/config.test.ts` and `npm test --workspace @jarvis/web -- --run
src/DatabaseWakeStatus.test.tsx src/App.test.tsx src/task-events.test.tsx`.
P3-11 rechecked Settings and Projects at 390 and 1280 px: New projects defaults
load and save, and the Projects page retains edit/archive but has no create form.
The backend project POST route remains available to Jarvis for P3-12. Live Entra
and Azure SQL behavior remain unverified.
P3-13 was checked at 390 and 1280 px with scratch-only auth and API mocks:
managed projects appeared first, managing a repository needed no form and removed
it from the unmanaged list, and explicit refresh loaded the updated list. Neither
width overflowed, the management buttons were 44 px high, and no browser errors
occurred. Live GitHub App, Key Vault, Entra, and Azure SQL behavior remains
unverified.
P3-12 adds the authenticated `create_project` tool and backend-only Key Vault
repository creation. Backend and runner contract tests are local/offline; live
Entra, Key Vault, Azure SQL, private template access and the throwaway end-to-end
scaffolding PR remain unverified.
P1-08 was inspected at 390 and 1280 px with scratch-only auth and project/task/SSE
mocks. All six columns, task creation, filter submission, modal dismissal, and
focus return worked; the page had no horizontal overflow, controls were at least
44 px high, and no console errors occurred. The wide board scrolls within its
own region. Mocks do not verify live Entra, Azure SQL, or deployed SSE.
P1-09 was inspected at 390 and 1280 px with a scratch-only `./useSignIn` stub
and project/task/conversation/SSE mocks. The source message, project and branch
links, live SSE event, event filter, and expanded payload worked; P1-09 task
controls remained disabled until P2-07. Neither width overflowed, interactive
controls were at least 44 px high, and no console errors occurred. P2-07 was
inspected at 390 and 1280 px in Chromium with scratch-only auth and task API
mocks; steer, pause, resume, cancellation confirmation, and cancellation worked,
with no horizontal overflow or console errors. The live acceptance still
requires both agents on `DanAakesen/jarvis-test-target`, including intermediate
commits on the task branch; the coordinator runs it post-merge. Live Entra, Azure
SQL/Blob archive reads, deployed SSE, and live Foundry controls remain unverified.
P2-14's actual `TaskControls` component and styles were inspected in Chromium at
390 and 1280 px from a scratch Vite harness with only the controls POST mocked.
Continue showed a disabled pending state and success feedback; an active-crash
fixture still showed Recover. The button measured 44 px, neither viewport
overflowed, and there were no page errors. Live backend/Foundry expiry remains
unverified.
P6-01 was inspected at 390 and 1280 px using the scratch `./auth` stub, a
placeholder backend origin, and a mocked `/usage` response. Project/agent/source
grouping, period selection, task links, 503 recovery, and the empty state worked;
the page had no horizontal overflow, selects measured 44 px, and only the table
scrolls horizontally. The expected mocked 503 produced a browser network log;
there were no other console errors or page exceptions. Live SQL and provider or
voice usage remain unverified.
P3-08 was inspected at 390×844 and 1280×1300 in Chromium using scratch-only auth
and mocked release/graph/API responses: opening a release, refresh, and keyboard
focus on a commit link worked; its hit area was 44×44 px and the document did not
overflow either viewport. The desktop and phone screenshots are
`docs/ui/screenshots/p3-08-release-view-desktop.png` and
`docs/ui/screenshots/p3-08-release-view-phone.png`; their fixture data is mocked.
Live Entra, Azure SQL, and GitHub behavior remain unverified.
Never commit the stub or weaken sign-in in the app.

Backend commands:

| Purpose | Command |
| --- | --- |
| Backend lint / offline tests / targeted build | `npm run lint --workspace @jarvis/backend`; `npm test --workspace @jarvis/backend`; `npm run build --workspace @jarvis/backend` |
| Focused P3-07 release webhook contract | `npm test --workspace @jarvis/backend -- --run src/database/webhook-delivery-store.test.ts` |
| Focused P3-08 release API and GitHub graph tests | `npm test --workspace @jarvis/backend -- --run src/factory/release-view.test.ts src/github/release-graph.test.ts src/github-app.test.ts` |
| SQL Server migration, webhook mapping, and task-store integration tests (including event/activity transaction and sub-second publish contract) | `npm run test:database --workspace @jarvis/backend` (requires the isolated loopback SQL Server configuration used by `database-ci.yml`) |
| Focused P2-07 backend control tests | `npm test --workspace @jarvis/backend -- src/factory/dispatcher.test.ts src/factory/tasks.test.ts src/factory/heartbeat.test.ts src/factory/task-lifecycle.test.ts` |
| Focused P2-14 completion/expiry regressions | `npm test --workspace @jarvis/backend -- src/factory/heartbeat.test.ts src/factory/dispatcher.test.ts src/database/sandbox-heartbeat-store.test.ts` |
| Focused P2-07 web control tests | `npm test --workspace @jarvis/web -- src/factory/TaskControls.test.tsx src/factory/TasksPage.test.tsx src/factory/TaskDetailPage.test.tsx` |
| Focused P3-08 release view and project navigation tests | `npm test --workspace @jarvis/web -- --run src/factory/ReleasePage.test.tsx src/factory/ProjectsPage.test.tsx src/App.test.tsx` |
| P6-05 SQL Server parallel load test (CI `Database` job; prints a `P6-05 load:` summary line) | `npm run test:database --workspace @jarvis/backend -- src/database/dispatcher-load.integration.test.ts` (isolated loopback SQL Server only) |
| Focused P6-05 runner Codex limit test | `runner/.venv/bin/python -m pytest -q runner/tests/test_app.py -k codex_usage_limit` |
| Start compiled backend | `npm start --workspace @jarvis/backend` (after its build) |
| Build then start backend | `npm run dev --workspace @jarvis/backend` |
| Health request | `curl --fail http://localhost:3000/health` → `{"status":"ok"}` |
| Production container (GitHub Actions only; no Docker in an agent sandbox) | `docker build --file apps/backend/Dockerfile --tag jarvis-backend .` from the repository root |

Live parallel load test (P6-08; Dan runs it, because agents have no production
access):

1. Check that the latest Deploy on `main` passed and includes P6-05. The dispatcher
   now sends `task_id`; earlier backends could not start any task (L59). Codex
   and Copilot credentials must be current in Settings.
2. Create two or three projects on private test repositories (for example
   `DanAakesen/jarvis-test-target` and a second one created with
   `gh repo create --private`). Set global max parallel tasks to 4 and project
   limits to 2/2/1.
3. Note the remaining Codex allowance on the Jarvis ChatGPT account's Codex usage
   page. Then create about eight small tasks across the projects, alternating
   Codex and Copilot.
4. Watch the board and task details. Record the maximum number Running at once,
   the time from Ready to Running, every Needs attention reason (a Codex
   `failed` event reads `Codex usage limit reached`), and sandbox minutes/DKK from
   the Usage page. Afterwards, note the Codex allowance again.
5. Record the results as a dated entry in [decisions.md](decisions.md).

The factory tasks API provides authenticated create, filtered list, detail, and
state-aware control routes. The controls route accepts only `steer`, `pause`,
`resume`, `cancel`, or `recover` (the latter only for Needs attention); it never
accepts a client-supplied task state. Recovery starts a new Foundry session from
the task branch with the original request, bounded steering history, and an event
summary. Task list
filters are `projectId`, `agent`, `state`, `createdAfter`,
`createdBefore`, and `search`; `limit`/`offset` and `eventLimit`/`eventOffset`
bound result pages. Responses are capped at 1 MiB; event payloads above 4 KiB
are marked truncated. State is backend-owned; do not add a client state update.
The task store's transition operation must be used by backend dispatch/control
code, and `Done` requires GitHub verification of the task branch and a pull
request in the configured repository.

`PORT` defaults to 3000, matching Container Apps ingress. `LOG_LEVEL` defaults
to `info`. `STATIC_WEB_APP_ORIGIN` is an exact HTTPS origin with no trailing
slash, path or query; it is required when `NODE_ENV=production`. P0-11 supplies
the deployed Static Web App origin. Browser origins are limited to this value
and `http://localhost:5173`; requests with another Origin receive 403. Requests
without Origin (such as container health probes) are allowed. CORS is not
authentication. P0-08 installs a root bearer-authentication hook before CORS,
so future area routes inherit it. Only `/health` GET/HEAD and the generated CORS
preflight route are public; explicit OPTIONS business endpoints are protected.

`FOUNDRY_ADMIN_ENDPOINT` and `FOUNDRY_RUNTIME_ENDPOINT` are optional HTTPS Foundry
project endpoints, supplied by Bicep in production. Configure both to enable
sandbox dispatch and heartbeats; if absent, the backend starts with both disabled.
The backend identity uses `DefaultAzureCredential` with the SQL
managed-identity client ID and has Foundry User on the project. At startup, the
heartbeat reloads active sessions once; the dispatcher writes `agent_name` for
new sessions, calls `track()` after the SQL commit, and `untrack()` when sessions
end. The dispatcher wakes on task events and retry deadlines, not SQL polling;
expired start leases go to Needs attention rather than replaying a possibly
accepted Foundry start. Offline tests do not verify live Foundry access.
Every heartbeat poll emits `sandbox_heartbeat.decision` with the SQL session ID,
invocation ID, HTTP status (null before any response), and a controlled decision.
Use these fields to distinguish confirmation retries, committed crashes,
`idle_expired`, unchanged state, and soft/persistence failures; no provider body,
question, prompt, or credential is included.

The optional `VOICE_LIVE_ENDPOINT` enables `/voice`; it must be a secure Azure
Voice Live WebSocket endpoint without credentials in its URL. The backend pins
`gpt-realtime-2.1`, gets the `https://ai.azure.com/.default` token with
`DefaultAzureCredential`, and owns session settings and tool execution. P0-16
must configure this endpoint and provider identity before live use. Local voice
tests use a mock WebSocket and do not verify Azure access or browser audio.

`JARVIS_CHAT_AGENT_NAME` names the hosted chat agent (`jarvis` in production);
`FOUNDRY_PROJECT_ENDPOINT` is the secure Azure AI project endpoint supplied by
Bicep. The main Deploy workflow configures the name after publishing the hosted
agent, and Bicep retains it on later infrastructure updates. The backend calls
Foundry's Invocations endpoint using its managed identity and the
`https://ai.azure.com/.default` scope. It sends the user's delegated authorization
and stored message ID in the application payload, not the Foundry HTTP
`Authorization` header. The agent validates the delegated token through `/me`,
verifies the source message through `/conversation/history`, then streams its
application-defined SSE reply. Never expose or log the delegated token. Without
the agent name, chat remains unavailable and returns a visible 503; live Azure
streaming and tool-call linkage require the post-merge acceptance check.

Production runner calls use the optional paired `FOUNDRY_RUNTIME_ENDPOINT` and
`FOUNDRY_ADMIN_ENDPOINT`, plus `FOUNDRY_RUNNER_AGENT_NAME`. Bicep supplies the
project URLs and `jarvis-runner-node-1x2`; these are non-secret settings. When
configured, the backend uses its shared `DefaultAzureCredential`, selected with
`SQL_MANAGED_IDENTITY_CLIENT_ID`. The daily Codex renewal job requires database
and Foundry runner configuration, and uses the SQL credential lease; the task
dispatcher must start Codex work through `TaskStore.transition` so both
operations serialize. Bicep retains one `Foundry User` assignment for the
backend identity at project scope.

Backend authentication defaults to the nonsecret identities in
`infra/bootstrap.output.json`. `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID` and
`ENTRA_OWNER_OBJECT_ID` may override those UUIDs at startup. The API expects an
RS256 Entra v2 delegated access token with the API client ID as audience and
`access_as_user` scope; an ID token, app-only token or another user's object ID
is denied. `request.principal` contains only the verified object and tenant IDs.
The optional `ENTRA_JARVIS_AGENT_OBJECT_ID` (a UUID other than Dan's; P4-01)
admits the hosted Jarvis agent's app-only token with the `Jarvis.Tools` role,
and only on routes marked `config: { jarvisAgent: true }` (`GET /tools`,
`GET /factory/context`, `POST /tools/{name}`); elsewhere it gets 403. Unset or
empty denies the agent.
Missing/invalid credentials return 401; verified but unauthorized tokens return
403. Authentication failures never export token/claim/provider details.
Approved browser origins retain CORS headers on these early denials so the web
can read their status; unapproved origins receive no allow-origin header.

`npm test --workspace @jarvis/backend` includes real RSA/local-JWKS auth checks,
socket duplicate-header rejection, cached keys and bounded provider outages.
It also covers task API validation and every lifecycle edge. SQL Server
integration tests cover task creation, event persistence, filtering and
transitions against an isolated SQL Server 2022 instance; neither test suite
requires Azure identity or Azure access. The production JWKS
lookup timeout is five seconds. `/me` and browser sign-in remain P0-09; live
Azure token verification remains P0-16.

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
connectivity remain unverified until P0-16.

Verified locally in P0-04 (Azure deployment remains pending P0-16):

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

P2-13 task starts require `repository` (`owner/name`), `defaultBranch`, and
`branch` in addition to the task identifier. The runner prepares the Git
checkout before starting ACP; provider probes and Codex renewal do not clone a
repository. Keep the existing Git credential-helper interface when changing
token acquisition (P3-02). After merge, the coordinator must run one Copilot and
one Codex task on `DanAakesen/jarvis-test-target`, verify pushes to their
`jarvis/task-<id>` branches, and verify that a commit-free agent question appears
as Needs attention.

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
  applied history. Add the reverse batch under `db/migrations/down/` with the
  same name; an offline test requires one for every migration, and
  `schema.integration.test.ts` reverts all of them newest first and reapplies.
  `0001_core_tables.sql` contains groups 1–3; `0002_sandbox_operations.sql`
  contains groups 4 and 6; `0003_sandbox_agent_name.sql` adds the heartbeat's
  Foundry routing field, and P6-03's `0005_task_event_archives.sql` indexes
  committed Blob chunks for on-demand task-history reads.
  See [migration guide](../db/migrations/README.md).
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
- P6-03 adds the Bicep-created private `task-events` Blob container. Bicep supplies
  `TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT`; the backend requires it when SQL is enabled
  and authenticates with its existing managed identity. No local credential or
  manual Azure setup is needed. Archive/restore contracts use a fake Blob store;
  the live Azure archive/restore check must happen after merge.

Aggregate CI (P0-10), `.github/workflows/ci.yml`:

| Item | Detail |
| --- | --- |
| Triggers | Every `pull_request`, `push` to `main`, and `workflow_dispatch` for manual verification |
| Jobs | `Web`, `Backend` (lint, tests, build, container smoke), `Database` (isolated SQL Server contracts), `Foundry` and `Runner` (base and .NET images, packaged CLI and HTTP smoke) call the reusable `web-ci.yml`, `backend-ci.yml`, `database-ci.yml`, `foundry-contract.yml` and `runner-ci.yml`; `Python lint, test and build` (runner lint and tests moved here from `runner-ci.yml`); `CI result` |
| Gate | `CI result` fails unless every other job succeeded. It is the check to require on `main` and inspect before merging a PR |
| Python | `bash .github/scripts/python-ci.sh [dir ...]` (default `runner agents/jarvis`). A component with `pyproject.toml` must have a hash-pinned `requirements-dev.txt` with ruff and pytest; each gets its own venv, `ruff check`, `pytest -q` and `compileall`. A component without `pyproject.toml` is reported as skipped (notice and step summary), not passed |
| Local workflow lint (verified for P0-10) | `go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7`, then `~/go/bin/actionlint` from the repository root. It passes for the CI files; it reports existing findings in `runner-ci.yml` (SC2034 warning) and `runner-deploy.yml` (an unquoted ` #11` ends the `prerequisite` step's YAML scalar, so that job failed on `main` at 290195b; needs a `fix-main:` PR) |

- Add a new component workflow as `on: workflow_call`, call it from `ci.yml`, and add it to `CI result`'s `needs`, so it runs once per PR and the gate covers it.
- Required checks on `main` are not enforced: branch protection on a private repository needs GitHub Pro. When available, Dan requires `CI result`; until then Dan or the authorized merging agent must read the `CI` run result itself.

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

Deploy, `.github/workflows/deploy.yml` (P0-11):

| Item | Detail |
| --- | --- |
| Triggers | Push to `main` (except `*.md` and `docs/` only); `workflow_dispatch` on `main` redeploys everything |
| Scripts | `deploy_plan.py` (parts to deploy), `deploy_bicep.sh` (Bicep deployment `jarvis-infra`), `deploy_smoke.py` (Foundry hosts) in `.github/scripts/` |
| Permissions | `contents: read`; the plan job adds `actions: read` (last successful run); Azure jobs add `id-token: write` for the bootstrap OIDC identity. No stored secrets; the Static Web Apps token is read at run time and masked |
| Offline checks (verified for P0-11) | `PYTHONPATH=.github/scripts python3 -m unittest discover -s .github/scripts/tests -v` (plan and smoke rules); `az bicep build --file infra/main.bicep --stdout >/dev/null` and `az bicep lint --file infra/main.bicep`; `actionlint .github/workflows/deploy.yml` (actionlint 1.7.12 does not know `concurrency.queue` yet and reports it; GitHub documents it) |
| Live verification | Pending the first run (P0-16) |

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
P6-07 adds fake-filesystem coverage for snapshots, threshold configuration, and
the low-disk stop. These offline checks do not verify the Foundry writable disk;
Dan performs that measurement post-merge.

### Runner event identity (P2-03)

Runner deploy sets `JARVIS_BACKEND_URL` from the successful `jarvis-infra`
outputs and `JARVIS_API_SCOPE` from the bootstrapped `jarvis-api` identifier URI.
Each hosted runner sends events with its managed identity; the backend accepts
only the `Jarvis.Runner.Events` app role on `POST /factory/sandbox-events`.
Runner deploy sets `JARVIS_DISK_LOW_THRESHOLD_BYTES` from the same-named GitHub
Actions repository variable, defaulting to `1073741824` bytes (1 GiB). The runner
emits a disk snapshot at each task-turn start and checks free space every 15
seconds; `disk_low` stops the current turn and lets the backend own the task state.

After Runner deploy succeeds, use the four `principal_id` values in its
`runner-deployment` artifact to assign the role:

```powershell
./infra/bootstrap.ps1 -JarvisRunnerPrincipalIds '<base-1x2-id>','<base-2x4-id>','<dotnet-1x2-id>','<dotnet-2x4-id>'
```

Cloud agents cannot run bootstrap or reach Azure. After merge, Dan verifies the
role assignment with a task-ID-bearing runner invocation and confirms its event
appears in task history; browser live updates additionally require P1-06.

### Jarvis agent

`agents/jarvis` (P4-01) has its own `.venv` from the shared setup script. Verified
in the P4-01 Copilot session (Docker was available there):

| Purpose | Command |
| --- | --- |
| Lint and tests, from `agents/jarvis/` | `.venv/bin/python -m ruff check .`; `.venv/bin/python -m pytest -q` (100 passed) |
| Same check as CI, from the root | `bash .github/scripts/python-ci.sh agents/jarvis` |
| Image, from the root | `docker build --tag jarvis-agent:local agents/jarvis` |
| Model-free voice turn | Run the image with the variables below, then `agents/jarvis/.venv/bin/python agents/jarvis/scripts/smoke_test.py` (default `ws://127.0.0.1:8088/invocations_ws`, text `/help`) |
| Regenerate the hash locks, from the root, after editing a `.in` file | `uv pip compile --python-version 3.12 --generate-hashes agents/jarvis/requirements.in -o agents/jarvis/requirements.txt`, then the same for `requirements-dev.in` → `requirements-dev.txt` |

P4-04 fetches `GET /factory/context` before each model turn; it contains at most
20 running tasks and three recent events per task. The voice runtime supplies
the most recent 12 messages, bounded to 24,000 characters total and 8,000 per
message. The context endpoint is agent-authorized and adds no configuration or
secret. SQL-backed context behavior is covered by the database integration suite.

### Danish voice provisioning

The `Danish voice agent` workflow provisions `jarvis-voice-mai` after a successful
`Deploy` when its inputs change, or on manual dispatch from `main`. It checks out
the deployment commit, reads `foundryAdminEndpoint` from the `jarvis-infra`
deployment, and authenticates with GitHub OIDC. The hash-locked SDK inputs are
`agents/jarvis/requirements-voice-provisioner.in` and
`agents/jarvis/requirements-voice-provisioner.txt`. To check locally:

```sh
python -m pip install --require-hashes -r agents/jarvis/requirements-voice-provisioner.txt
python agents/jarvis/scripts/provision_danish_voice.py
```

The script requires `FOUNDRY_PROJECT_ENDPOINT` and an Azure CLI identity authorized
to manage project agents. The Deploy smoke step grants its identity `Foundry User`
on the project; Bicep grants the backend the same role. The backend receives the
project endpoint from Bicep and uses its managed identity; do not put credentials
in the browser.

Agent configuration (environment variables, no secrets):

| Variable | Meaning |
| --- | --- |
| `FOUNDRY_PROJECT_ENDPOINT`, `AZURE_AI_MODEL_DEPLOYMENT_NAME` | Required. Foundry project endpoint (`https://<host>/api/projects/<name>`) and model deployment |
| `JARVIS_BACKEND_URL` | Required. Backend origin: HTTPS, or HTTP only for `localhost`/`127.0.0.1`/`::1`; no path, query or credentials. Startup fails without it |
| `JARVIS_API_CLIENT_ID` | Optional `jarvis-api` client ID for the token scope `api://<id>/.default`; defaults to the bootstrap ID |
| `AZURE_OPENAI_API_KEY` | Optional local model key; without it the agent identity also gets the model token |
| `AZURE_OPENAI_SYSTEM_PROMPT`, `AZURE_OPENAI_MAX_OUTPUT_TOKENS`, `JARVIS_REASONING_EFFORT`, `LOG_LEVEL` | Optional overrides, as in the prototype |

The main Deploy workflow publishes the agent image by digest, creates a hosted
version with `JARVIS_BACKEND_URL`, and configures the backend with the version's
instance identity. After its summary reports `instance_identity.principal_id`,
run `./infra/bootstrap.ps1 -JarvisAgentPrincipalId <instance_identity.principal_id>`
to assign `Jarvis.Tools` and persist that same value as the
`ENTRA_JARVIS_AGENT_OBJECT_ID` Actions variable. Bicep uses that variable on later
infrastructure deployments. Cloud agents cannot run bootstrap or verify Azure;
Dan verifies the hosted deployment and tools after this local step. Tool calls
also need the stored message ID from P4-03, supplied by the caller in P4-06.

## Release procedure

- Every change reaches `main` through a PR merged by Dan or an explicitly authorized agent (see [Merge](#merge)). A merge runs the Deploy workflow, which deploys only the changed parts among infrastructure, backend, web, and the Jarvis agent; the backend applies migrations at startup. Redeploy everything with **Actions → Deploy → Run workflow** on `main` (`gh workflow run deploy.yml --ref main`).
- After the first successful deploy only (P0-16): run `./infra/bootstrap.ps1 -WebRedirectUris 'https://<Static Web App host>/redirect.html'` so sign-in works there (the redirect URI is MSAL's redirect bridge page, L63) (existing URIs are kept), set `backendUrl` in `apps/web/config.json` to the backend URL so `npm run dev` signs in, and set the Actions variable `JARVIS_INFRA_DEPLOYMENT_NAME` to `jarvis-infra` (`gh variable set JARVIS_INFRA_DEPLOYMENT_NAME --body jarvis-infra`). The Deploy run summary lists both URLs.
- No manual infrastructure portal changes.
- **P7-03 coordinator check after merge:** wait for Deploy to finish, open the Azure Bot resource `bot-jarvis-{suffix}` and use its Teams/Open in Teams entry to install it for Dan. Send the first message in a personal chat from Dan's Novaro account so the backend can persist the conversation reference. Then use Teams on Dan's phone to verify a text notification, an optional voice note, Approve continues a test action, Reject does not, and a card left unanswered for five minutes cannot run its action. Do not enable a paid Speech tier.
- Managed-project workflow examples and Azure OIDC adoption steps are in [github-actions-templates.md](github-actions-templates.md). The templates assume npm/Node defaults that adopters must match or customize; no Azure access is available to verify an adopting project's federation or deployment.

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

P2-11 provider option verification uses `npm ci --prefix runner/tools` and
`runner/tools/node_modules/.bin/copilot --help` (the pinned Copilot CLI reports
`--model` and `--reasoning-effort`). The pinned
`@agentclientprotocol/codex-acp` 2.1.1 README/source exposes `model` and
`reasoning_effort` via ACP `session/set_config_option`; no live provider
credentials are needed for these checks. Runner and Foundry contract tests
exercise the local wire behavior, not authenticated model availability.

P2-12 usage verification uses those pinned package docs and runner contracts.
Offline inspection found that the Codex ACP README advertises token-usage events,
without a confirmed field schema; the Copilot CLI README says each prompt consumes
a premium request, without documenting a per-turn ACP report. Neither establishes
what a live run sends. After merge, run one Codex task and one Copilot task, then
check task detail against each runner event and the provider's actual response;
record which token or premium-request fields, if any, were reported.

The main-only [runner deploy workflow](../.github/workflows/runner-deploy.yml)
requires Actions variable `JARVIS_INFRA_DEPLOYMENT_NAME`, set to `jarvis-infra` after
the first successful Deploy run. It consumes that deployment's existing outputs and bootstrap
Azure variables, queues under `jarvis-production-deploy`, builds the two images
in ACR, deploys both capacity tiers, and records identity-probe evidence. The main
Deploy workflow uses the same group; both set `queue: max` so no queued deploy is dropped. The workflow never seeds secrets;
`jarvis-github`, `jarvis-copilot`, and the Jarvis-only `codex-login` must already be
in Key Vault. P3-02 adds the opt-in App-token path, but the legacy Git-token path
remains available until the post-merge sandbox push check succeeds.
See [runner/README.md](../runner/README.md) for commands and the contract.

P3-02 uses repository Actions variable `JARVIS_GITHUB_APP_ID` to configure the
backend's `GITHUB_APP_ID` setting;
the private key stays in Key Vault as `github-app-private-key` and is read only by
the backend identity. Runner App-token mode is separately controlled by
`JARVIS_GITHUB_APP_TOKEN_ENABLED` (defaults to `false`), so deploying the backend
does not turn off the legacy Git credential path. Set it to `true` only after the
backend deployment and Key Vault setup are confirmed, then dispatch Runner deploy
from `main`. Keep the legacy secret and runner read grant until the live sandbox
push to `DanAakesen/jarvis-test-target` succeeds; remove them in a follow-up.
