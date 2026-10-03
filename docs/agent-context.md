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
| Decisions and learnings L1–L23 | [decisions.md](decisions.md) |
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
- Dependencies order tasks; they don't stop two ready tasks from changing the same files. That is what step 4 of [Start a task](#start-a-task) and the up-to-date rule in [Merge](#merge) are for.
- `PLAN.md` is the source of truth for what a task is. The issue is where a task is started and discussed, and where its PR is linked. If the two differ, `PLAN.md` wins.
- When a PR adds a task to `PLAN.md` or changes one, its issue must match: create or update it, including its "Blocked by" dependencies. If you can't edit issues from your environment, list the needed issue changes in the PR body. P0-13 automates this.
- Status values: **Not started**, **In progress**, **Blocked**, **Complete**. The Status column in `PLAN.md` on `main` is the shared view of the project.
- A task starts when Dan (or later Jarvis) assigns its issue to Copilot or comments `@codex` on it. The plan-status workflow (P0-13) then sets In progress on `main`, sets Complete when the task's PR merges, and resets Not started if the PR closes unmerged.
- Until P0-13 is merged, Dan starts tasks one at a time and the agent sets the status in its own PR.

### Start a task

1. Read the current `main`: the Status column and Current focus in `PLAN.md`, the relevant [decisions](decisions.md), and the files the `AGENTS.md` context map names for your area.
2. Check that `main` is green: the latest CI and deploy runs on `main` passed (before P0-10 and P0-11 add them, `main` counts as green). If not, stop. The only allowed work is a fix for `main` (PR title `fix-main: …`).
3. Check your task: not Complete, not In progress through another PR, and every task in its "Depends on" column Complete. If any check fails, stop and report it on the issue.
4. Look at the running tasks (In progress rows and open PRs). Stay out of files they change, or say in your PR why you overlap.
5. Use one branch and one PR. The PR title starts with the task ID, and the PR body contains `Fixes #<issue>`. When the PR merges, GitHub closes the issue, and the tasks it blocked unblock automatically. Never remove "Blocked by" links by hand; they stay as history. If a task needs more than one PR, use `Refs #<issue>` in all but the last.

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

The PR body states what changed, how it was verified (commands and results), what remains unverified, and follow-ups.

### Merge

- **No manual approval.** The merge workflow (P0-12) squash-merges a PR when it is ready (not a draft), its title starts with a task ID, `fix-main:`, or `docs:` (documentation changes outside a task), all checks pass, and it contains the latest `main`. If the branch is behind, the workflow updates it and waits for the checks again, so every merge is tested against the current `main`.
- **Never start from a broken `main`.** After every merge, CI and deploy run on `main`; deploy skips documentation-only changes and deploys only the parts that changed ([P0-11](../PLAN.md#p0--foundations)). If either fails, the merge workflow merges only `fix-main:` PRs until `main` is green again.
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

## Setup and commands

Nothing is built yet; P0 creates the apps. Candidate commands (unverified until P0):

| Purpose | Command |
| --- | --- |
| Run the web app | `npm run dev` in the repository root, then open `http://localhost:5173` (uses the production backend). Agents run it only in their cloud environment |
| Bootstrap or repair identities | `./infra/bootstrap.ps1` (safe to re-run; needs Dan's signed-in `az` and `gh`) |
| Web build and test | `npm run build`, `npm test` in `apps/web` |
| Backend build and test | `npm run build`, `npm test` in `apps/backend` |
| Python tests | `pytest` in `runner` and `agents/jarvis` |
| Validate Mermaid diagrams | `npx -y @mermaid-js/mermaid-cli@11 -i <file>.md -o <out>.md` |

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
