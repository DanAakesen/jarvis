# Jarvis operator manual

Use this when starting on a new machine or handing off a task. [Plan](../PLAN.md) owns current priorities and release status. [Product](../PRODUCT.md) owns requirements. [Architecture](architecture.md) explains the runtime; [decisions](decisions.md) record why it works that way. Start with the [style guide](ui/style-guide.md) for design or the [documentation index](README.md) for other references. [Archive: 3 October–22 November 2026](archive/agent-context-2026-10-03-to-2026-11-22.md).

## Setup and commands

### Work from another machine

1. Install Git and the GitHub CLI. Clone `https://github.com/DanAakesen/jarvis.git`, enter `jarvis`, and fetch `origin/main`. Use your GitHub account to push an isolated task branch or worktree and manage the issue/PR; the public checkout and offline checks do not require Azure or Apple credentials.
2. Install Node **22** (exact version in [`.nvmrc`](../.nvmrc)), npm **10** (exact version in [`package.json`](../package.json)), and Python **3.12** ([`.python-version`](../.python-version)). Check `node --version`, `npm --version`, and `python --version`; on Windows `py -3.12 --version` selects the right interpreter even if `python` points elsewhere.
3. From the repository root, run `npm ci` once to restore the locked workspace dependencies. This bootstrap may fetch packages. For cache-only checks that do not need install hooks, use `npm ci --offline --ignore-scripts --no-audit --no-fund`. If the cache is incomplete or a check needs a prebuilt dependency, report what is missing. Do not change the lockfile to get a local run working.
4. Use the checks below. Do not copy `.env` files, shell history, signing files, or credentials between machines. Tests use local fixtures. Production access is separate: normal Deploy uses the repository's `main` OIDC identity in Azure; Apple signing lives in the TestFlight workflow environment. Ask the owner for the appropriate access rather than using another machine's login.

### Offline checks

Run these from the repository root unless the row says otherwise. These commands are declared by the checked-in scripts or used in CI; that identifies the supported check, not a claim that every command ran during this docs refresh. No production authentication is needed.

| Scope | Command or check |
| --- | --- |
| JavaScript and TypeScript | `npm run lint`, `npm test`, `npm run build`. To narrow a command, append `--workspace @jarvis/backend` or `--workspace @jarvis/web`. The web CI also checks `@jarvis/contracts`. |
| PI generated docs | `npm test --workspace @jarvis/backend -- src/pi/tool-conformance.test.ts`. Run the whole test file with no `CONFORMANCE_GROUP`, name filter or `UPDATE_TOOL_CONFORMANCE`; only a full run compares [tool-conformance.md](tool-conformance.md) to the registry. Use the regeneration instruction in the test only for an intentional registry change. |
| PI parity and stream handling | `npm test --workspace @jarvis/backend -- src/voice/chat-voice-parity.test.ts src/pi/gateway.test.ts src/pi/mcp.test.ts`. Uses fake Foundry, tool and voice services; do not substitute a live smoke. |
| PI brain, reply push and safe logs | `npm test --workspace @jarvis/backend -- src/pi/brain src/push/reply-notifications.test.ts src/logging.test.ts`. No model or APNs call. |
| Vault mirror | `npm run typecheck:vault-mirror`, `npm run lint:vault-mirror`, `npm run test:vault-mirror`, `npm run build:vault-mirror`. Unit tests do not sync a vault. |
| SQL integration | `npm run test:database --workspace @jarvis/backend`, with the disposable SQL Server 2022 loopback fixture in [database-ci.yml](../.github/workflows/database-ci.yml). Set only its fixture variables. Never point the integration test runner at a real database. The normal backend test command excludes these tests. |
| Python workflow scripts | Set `PYTHONPATH` to `.github/scripts`. On Windows PowerShell: `$env:PYTHONPATH = '.github\scripts'; py -3.12 -X utf8 -m unittest discover -s .github\scripts\tests`. On Bash: `PYTHONPATH=.github/scripts python -X utf8 -m unittest discover -s .github/scripts/tests`. The suites mock transport; running the scripts themselves may not be offline. |
| Python components | CI calls [`python-ci.sh`](../.github/scripts/python-ci.sh) for Ruff, pytest and byte-compilation. It creates venvs and installs hash-pinned requirements. For an offline run, activate an already provisioned component venv, then run `python -m ruff check .`, `python -m pytest -q`, and `python -m compileall -q .` in `runner` or `agents/jarvis`. |
| Bicep | `az bicep build --file infra/main.bicep` and `az bicep lint --file infra/main.bicep` with the CLI/compiler already installed. No `az login` or resource call for the build/lint. |
| JarvisCore | In `apps/ios/Packages/JarvisCore`, `swift build` and `swift test` under Swift 6.2. CI uses the `swift:6.2` Linux image for this portable package. Use a cached image or installed toolchain for an offline run. |
| iPhone and Watch apps | The native SwiftUI targets need macOS and Xcode, not a Windows or Linux checkout. [Apple Watch build](../.github/workflows/watch-build.yml) generates the Xcode project with XcodeGen and builds the Watch simulator/device and iPhone simulator targets. Signed install and physical tests are separate. |
| Docs | `git diff --check`; use `git grep -n -I -F '<old-path-or-basename>'` before moving a file and `git grep -n -I 'agent-context\.md#'` for inbound manual links. Run a local link audit against the resulting tree: resolve paths from the linking file and check fragments against GitHub heading slugs or explicit anchors. CI has no general Markdown link checker. |

### What CI runs

[Aggregate CI](../.github/workflows/ci.yml) qualifies ready PRs. [Its impact rules](../.github/scripts/pipeline_impact.py) select checks; shared or unknown inputs get wider coverage. Python tests come from the aggregate job. Depending on the change, the workflow calls web/contracts, backend (including a local container smoke and PC bridge), Vault mirror, SQL integration, offline Foundry contracts, runner, legacy agent, and JarvisCore jobs, or runs Bicep checks. **CI result** and its receipt are the merge evidence. The separate macOS Apple Watch build runs on iOS changes; general CI does not claim Simulator UI or physical-device acceptance.

## Development workflow

Keep [AGENTS.md](../AGENTS.md) as the entry point and read only the project context needed for the change. Use local worktrees. Bundle related work into fewer, larger issues and PRs; do not bundle unrelated changes or open placeholders. Keep a single owner per file or feature until handoff.

### Start a task

1. Locate the GitHub issue and read its dependencies, acceptance criteria and current PR. Claim it with the appropriate worker label (`Codex`, `Copilot`, `Dan` or `Jarvis` for the existing board automation). If another worker owns it, stop and coordinate. Do not assign Copilot unless the owner explicitly wants a cloud agent. Do not claim unrelated work or create an issue to duplicate an existing one.
2. Check the latest `main` and the current [plan](../PLAN.md). If `main` has a failed required check or Deploy, prioritise repairing it; a queued Deploy is not a failure. Choose a local branch/worktree on current `origin/main`, and check for overlapping work.
3. Trace the affected code and checks. Plan the smallest coherent change, include negative cases and a recovery path, and use offline fixtures. For a substantial design decision ask Astra if available and approved. Astra's `CopilotAndCodex.md` exists only on Dan's machine. Never commit it or require it on another machine.

### Finish a task

| What changed | Update in the same PR |
| --- | --- |
| Progress, next action, blockers | [PLAN.md](../PLAN.md) and the issue. Leave automation-owned issue/status fields to the workflow; the issue stays open if device acceptance remains. |
| Requirement or user workflow | [PRODUCT.md](../PRODUCT.md) and the relevant [feature record](features.md). |
| Visual or interaction contract | [DESIGN.md](../DESIGN.md); use the [style guide](ui/style-guide.md) and shared controls. |
| Runtime, data flow, identity, deployment or schema | [Architecture](architecture.md), and [data model](data-model.md) for database changes. |
| Approved decision, setup or check | [Decisions](decisions.md) for rationale and evidence; this manual for commands and operations. |

Add each confirmed decision (`#N`) or learning (`LN`) at the top of **Decisions of the last 14 days**, newest first, using the next unused number in its own series; move entries older than 14 days to the monthly archive and add a dated index link, preserving their IDs and anchors. Keep proposals separate from confirmed decisions.

Run the focused offline checks, inspect the diff, and open **one ready PR** when it can be reviewed. Use `<task ID>: ...`, `fix-main: ...` or `docs: ...` as the [title workflow](../.github/workflows/pr-title.yml) requires. Give concrete tests, exact results and unverified behaviour. Use `Refs #N` for partial work or device acceptance; use an explicit closing reference only if the issue's acceptance is complete. Check native closing links as well as the PR body.

### Task board

GitHub issues are the live backlog. [Plan status](../.github/scripts/plan_status.py) syncs task rows and dependencies. The [Project Jarvis board](https://github.com/users/DanAakesen/projects/2) is a view, populated by [project-board.yml](../.github/workflows/project-board.yml) and [project_board.py](../.github/scripts/project_board.py). Do not hand-move cards to work around a sync.

| Column | What it means |
| --- | --- |
| In review | An open, ready linked PR; review takes precedence over the claim. |
| In progress | Worker label, or an open linked draft that is not parked for a decision. Draft support is not permission to open a placeholder. |
| Needs Dan | Unclaimed `needs-decision` issue. |
| Backlog / Ready | An open dependency blocks work; otherwise an unclaimed, unlinked issue is Ready. |
| Done | Issue closed. A previously merged PR alone does not finish a reopened issue. |

The board workflow uses `PROJECT_TOKEN` from the `project-board` environment; it skips sync and warns when the secret is absent. Do not print the value. If sync disagrees with reality, compare the issue's labels, dependencies and actual linked PR to the script's rules.

<a name="merge"></a>
<a name="merge-and-release"></a>

## Merge and release procedure

The dispatcher/coordinator uses local merge scripts that are not in the repository. This is the procedure in words; another machine does not need those scripts to understand the checks.

1. The coordinator or owner verifies independent review of the **exact head**, no unresolved threads or High findings, and exact-head required checks green. Fix Medium findings or record explicit follow-ups. Agents never merge their own PR. Do not push to `main` or bypass checks.
2. Bring the branch up to `origin/main`, resolving documentation conflicts additively rather than choosing one side wholesale. Re-run checks and review the updated head. The merged tree must equal the tree tested in CI; a green run for a previous head or a merely similar diff does not qualify. The checked-in enforcement is the [CI receipt](../.github/scripts/pipeline_evidence.py) and [Deploy qualification](../.github/scripts/release_state.py).
3. After each merge to `main`, refresh and requalify other affected PRs. Updating another open iOS PR triggers `synchronize` and restarts its macOS checks. The update, not the push to `main` on its own, is the trigger. Batch coordinated merges instead of repeatedly updating native PRs.

### TestFlight build

When the approved release work is merged and nothing is pending, the release owner cuts the next build. After a backend or PI merge, wait for the matching normal [Deploy](../.github/workflows/deploy.yml) and its readiness evidence before dispatching [iOS TestFlight](../.github/workflows/ios-testflight.yml). Only the authorised release owner runs this command; it is not an offline check.

```sh
gh workflow run ios-testflight.yml --ref main -f branch=main
```

The Apple build number is the workflow run number. Check that the exact build has finished processing in App Store Connect and is available in TestFlight; a successful upload alone does not prove either. Name the available build and exact device checks in [the plan's](../PLAN.md) daily-core order. Do not ask the owner to test an unshipped build or a fix still in flight. Reopen an acceptance issue if linking a PR closed it prematurely.

## Cost and safety

- **Local only.** Do not create a GitHub cloud sandbox without explicit approval; those sandboxes are billed. Using GitHub for an authorised issue, fetch or PR is not cloud-agent work.
- **Offline by default.** `measure_pi`, a live model/provider smoke, Foundry readback/probes, real APNs sends, and paid benchmarks require Dan's explicit approval of the **exact command**. No change that adds cost without approval. Do not start release or live acceptance workflows just to validate docs.
- **Product rules.** Keep PI model-driven. Use deterministic checks for facts, provenance and exact outcomes, not to add a second decision-maker. No new PI confirmation or approval except delete; preserve auth and sensible retry safety. Build the replacement, test it, then delete the old path explicitly. No new fallback, dual path or compatibility shim. Note any deliberately accepted cutover gap.
- **Public repository.** Use secret names, never values. Keep live logs, captures, tokens, account details and real personal data out of docs, test evidence, cards and PRs. Use synthetic fixtures, not real examples.

## Azure

Local work does not require Azure credentials. Production inspection requires the correct tenant/subscription and a scoped role from the owner; verify the target before an authorised command. Keep change delivery in the main-only Deploy workflow. Do not change Foundry versions concurrently with Deploy; instructions are portal-owned after bootstrap, and `KEEP THIS BLOCK` is not editable. See [infra](../infra/README.md) and [agent ownership](architecture.md#the-two-foundry-agents).

### Configuration names only

| Area | Names to look up in the checked-in configuration |
| --- | --- |
| Deploy OIDC variables | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` |
| PI and its MCP connection | `FOUNDRY_PROJECT_ENDPOINT`, `JARVIS_PI_AGENT_NAME`, `JARVIS_PI_MCP_SECRET`, `PI_GITHUB_TOKEN` |
| APNs (Key Vault-backed backend secrets) | `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_SIGNING_KEY` |
| TestFlight environment | `APP_STORE_CONNECT_KEY_P8`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`; `APPLE_TEAM_ID` is a variable. App configuration secret names are listed in the workflow. |

Do not use a production setting as a local default. See [`config.ts`](../apps/backend/src/config.ts), [Bicep](../infra/main.bicep) and the workflows for current names.

### GitHub App setup

The GitHub App manifest and Azure bindings are maintained separately from developer GitHub CLI sign-in. The backend reads the App key through Key Vault under its managed identity; never give it to a client or a sandbox. The [infra guide](../infra/README.md) and [historical setup](archive/agent-context-2026-10-03-to-2026-11-22.md#github-app-setup) describe the boundary. App creation, credential rotation and permission changes are owner operations, not onboarding.

### Cloud agent environments

Historical only. Do not follow older cloud-agent setup instructions without explicit approval. The current path is a local worktree, even when the remote is GitHub. The [archived setup](archive/agent-context-2026-10-03-to-2026-11-22.md#cloud-agent-environments) records the old experiment.

### Jarvis agent

Normal Chat and Voice are PI, not the [legacy `agents/jarvis` program](../agents/jarvis/README.md). Deploy can still maintain the isolated old agent path. Use that component's own pinned dev requirements and CI for changes to it; no live run as an offline check.

## Jarvis control styling

Start with the [style guide](ui/style-guide.md) and [shared control geometry](../DESIGN.md#shared-control-geometry). Use shared design-system controls and keep spacing in the parent layout. Put state in text or an accessible label as well as colour. Do not add screen-local glass or button styles.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `node` is missing, wrong version or the npm cache misses | Check `.nvmrc`, PATH and `node --version` in this shell. Don't borrow a machine's unpinned Node for sign-off. Report a blocked offline install rather than downloading implicitly. |
| Fixture paths fail on Windows | Check whether the suite assumes POSIX paths, Git executable bits, case sensitivity, or mode bits. The Python secret-file test uses `os.fchmod`, unavailable on Windows; use Linux for that exact assertion. Python reports with non-ASCII output need UTF-8. Do not patch tests for a docs-only change. |
| JWKS/auth fixture fails near a timeout | Rerun the focused offline [`auth.test.ts`](../apps/backend/src/auth/auth.test.ts) and note the runner/platform and timing. Investigate a repeatable failure. Do not label a failing run green or reach out to the real issuer. |
| Tool or turn fails in use | Start with [backend log fields](backend-logs.md) and [the runbook](runbook.md), not raw prompts. Compare `pi.stream_failed`/`pi.mcp_call_failed` to `pi.mcp_tool`; absence at the door can mean harness policy refused the name. Keep recorded writes and uncertain outcomes distinct. |
| Brain appears idle | From authorised evidence, distinguish Off, paused, no sources, no due work, and a failed wake. `pi.brain_tick`, `pi.brain_run` and `/pi/brain` explain attempts; status does not invoke a model. |
| Deploy says exact qualification missing | Compare PR/head, run and attempt, and `git rev-parse 'HEAD^{tree}'` for the tested and merged revisions. Requalify the real candidate. Do not use an older receipt. |
| TestFlight succeeded but the fix isn't visible | Check the uploaded run number and the version installed on the device. Native signing, APNs display and real Voice behavior are not proved by fixture tests. |

<a name="read-only-status-page-14-october-2026"></a>

The [14 October read-only status evidence](archive/agent-context-2026-10-03-to-2026-11-22.md#read-only-status-page-14-october-2026) is historical.
