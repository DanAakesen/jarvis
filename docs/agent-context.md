# Jarvis operator manual

Use this when starting work. The [plan](../PLAN.md) owns release status, [architecture](architecture.md) explains the runtime, and the [index](README.md) points to other references.

## Agent context

- **Repository work:** [Factory issue starts](../apps/backend/src/factory/issues.ts) put root `AGENTS.md`, if present, in the worker prompt and quote the issue and owner comments as untrusted request data. Jarvis workers follow that pointer to [the working agreement](../.github/copilot-instructions.md), then read [P0](../p0.md) and the affected docs from the checkout. This prompt is not the owner's PI conversation.
- **PI Chat and delegated Voice:** Foundry owns the standing instructions. The [backend](../apps/backend/src/pi/context.ts) supplies settings, presence, Memory policy and known environment defaults, not the repository docs. The [gateway](../apps/backend/src/pi/gateway.ts) combines these with current situation context. It sends the block at warm-up and on normal turns when its hash differs from the recorded one. The hash controls resending, not provider history or compaction. The current message and reference are per turn; extracted attachments and screen context travel with that turn as data, not instructions.
- **Proactive wakes:** fresh context, activation evidence and a tool overview go to a scratch PI conversation, not the foreground one. Durable Personal Memory and Vault Knowledge are separate; see [architecture](architecture.md#memory-and-vault-knowledge).

## Agent logs

Start with a UTC window and [the log source map](reference/logs.md). Stored Chat messages and receipts show what the app committed; Foundry history and the Factory worker timeline are separate. Diagnostic streams are not part of the default PI prompt. PI can request the bounded backend log view when configured; operators use the named diagnostic sources for anything it omits. Diagnostic events are not model reasoning. Keep raw output and prompts out of PRs.

## Setup and commands

### Work from another machine

1. Install Git and the GitHub CLI. Clone `https://github.com/DanAakesen/jarvis.git`, enter `jarvis`, and fetch `origin/main`. Sign in with your own GitHub account. Ask the owner for collaborator access to push to the repository; otherwise push to your fork and open the PR against `DanAakesen/jarvis:main`. Work on an isolated local branch or worktree. The public checkout and offline checks do not require Azure or Apple credentials.
2. Install Node **22** (exact version in [`.nvmrc`](../.nvmrc)), npm **10** (exact version in [`package.json`](../package.json)), and Python **3.12** ([`.python-version`](../.python-version)). Check `node --version`, `npm --version`, and `python --version`; on Windows `py -3.12 --version` selects the right interpreter even if `python` points elsewhere.
3. From the repository root, run `npm ci` once to restore the locked workspace dependencies. This bootstrap may fetch packages. For cache-only checks that do not need install hooks, use `npm ci --offline --ignore-scripts --no-audit --no-fund`. If the cache is incomplete or a check needs a prebuilt dependency, report what is missing. Do not change the lockfile to get a local run working.
4. Use the checks below. Do not copy `.env` files, shell history, signing files, or credentials between machines. Tests use local fixtures. Production access is separate: normal Deploy uses the repository's `main` OIDC identity in Azure; Apple signing lives in the TestFlight workflow environment. Ask the owner for the appropriate access rather than using another machine's login.

### Offline checks

Run from the repository root unless noted. These checks are declared in scripts or CI; no production authentication is needed.

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
| Browser | Use Playwright with an installed Chromium and cached `playwright-core` in a scratch directory. The [workspace content check](../scripts/check-workspace-content-browser.mjs) reads `PLAYWRIGHT_CORE_MODULE` and uses a local fixture. For signed-in layouts, stub auth only in a scratch Vite config; never change app auth or use live credentials. |
| Docs | `git diff --check`; use `git grep -n -I -F '<old-path-or-basename>'` before moving a file and `git grep -n -I 'agent-context\.md#'` for inbound manual links. Resolve paths from the linking file and check fragments against GitHub heading slugs or explicit anchors. CI has no general Markdown link or Mermaid lint check. Render new or changed Mermaid diagrams locally. |

### What CI runs

[Aggregate CI](../.github/workflows/ci.yml) qualifies ready PRs. [Its impact rules](../.github/scripts/pipeline_impact.py) select checks; shared or unknown inputs get wider coverage. Python tests come from the aggregate job. Depending on the change, the workflow calls web/contracts, backend (including a local container smoke and PC bridge), Vault mirror, SQL integration, offline Foundry contracts, runner, legacy agent, and JarvisCore jobs, or runs Bicep checks. **CI result** and its receipt are the merge evidence. The separate macOS Apple Watch build runs on iOS changes; general CI does not claim Simulator UI or physical-device acceptance.

Do not edit [`docs/features.md`](features.md) in a docs-only change. It is built into the backend image, selects backend checks and triggers [Deploy](../.github/workflows/deploy.yml) when it lands on `main`.

For a Notes change, run `swift test --filter 'JarvisNotesRedesignTests|JarvisClientTransportTests'` from `apps/ios/Packages/JarvisCore`. From `apps/backend` run `npm exec -- vitest run src/vault src/logging.test.ts src/pi/tool-conformance.test.ts src/voice/chat-voice-parity.test.ts`. These use local fixtures. [Database CI](../.github/workflows/database-ci.yml) covers the note metadata migration and guarded backfill on loopback SQL.

## Development workflow

Start from [.github/copilot-instructions.md](../.github/copilot-instructions.md), the source of truth (`AGENTS.md` only points to it), and read only the project context needed for the change. Use local worktrees. Bundle related work into fewer, larger issues and PRs; do not bundle unrelated changes or open placeholders. Keep a single owner per file or feature until handoff.

### Start a task

1. Locate the GitHub issue and read its dependencies, acceptance criteria and current PR. Claim it with the appropriate worker label (`Codex`, `Copilot`, `Dan` or `Jarvis` for the existing board automation). If another worker owns it, stop and coordinate. Do not assign Copilot unless the owner explicitly wants a cloud agent. Do not claim unrelated work or create an issue to duplicate an existing one.
2. Check the latest `main` and the current [plan](../PLAN.md). If `main` has a failed required check or Deploy, prioritise repairing it; a queued Deploy is not a failure. Choose a local branch/worktree on current `origin/main`, and check for overlapping work.
3. Trace the affected code and checks. Plan the smallest coherent change, include negative cases and a recovery path, and use offline fixtures. For a substantial design decision ask Astra if available and approved. Astra's `CopilotAndCodex.md` exists only on Dan's machine. Never commit it or require it on another machine.

### Finish a task

| What changed | Update in the same PR |
| --- | --- |
| Progress, next action, blockers | [PLAN.md](../PLAN.md) and the issue. Leave automation-owned issue/status fields to the workflow; the issue stays open if device acceptance remains. |
| Requirement or user workflow | [PRODUCT.md](../PRODUCT.md). Update the [deployed feature catalog](features.md) only with the corresponding implementation change. |
| Visual or interaction contract | [DESIGN.md](../DESIGN.md); use the [style guide](ui/style-guide.md) and shared controls. |
| Runtime, data flow, identity, deployment or schema | [Architecture](architecture.md), and [data model](reference/data-model.md) for database changes. |
| Approved decision, setup or check | [Decisions](decisions.md) for rationale and evidence; this manual for commands and operations. |

Add confirmed entries at the top of [decisions.md](decisions.md), newest first. Move decisions older than 14 days out of the live log: keep a dated link with the original ID in the archive index and leave the full text in Git history. Keep proposals separate.

Run the focused offline checks, inspect the diff, and open **one ready PR** when it can be reviewed. Use `<task ID>: ...`, `fix-main: ...` or `docs: ...` as the [title workflow](../.github/workflows/pr-title.yml) requires. Give concrete tests, exact results and unverified behaviour. Use `Refs #N` for partial work or device acceptance; use an explicit closing reference only if the issue's acceptance is complete. Check native closing links as well as the PR body.

### Task board

GitHub issues are the live backlog. [Plan status](../.github/scripts/plan_status.py) syncs task rows and dependencies. The private Project Jarvis board is a view populated by [project-board.yml](../.github/workflows/project-board.yml) and [project_board.py](../.github/scripts/project_board.py). Do not hand-move cards to work around a sync.

A new `P##-##` row in a `PLAN.md` task table creates a GitHub issue if none matches on the next push to `main` that changes the plan ([plan-status.yml](../.github/workflows/plan-status.yml)). Use prose or an ordinary table for status recaps that should not create issues.

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

1. Verify independent review of the **exact head**, no unresolved threads or High findings, and green required checks for that head. Fix Medium findings or record explicit follow-ups. The PR author may merge after the gates pass. A Deploy-triggering push to `main` without a qualified PR fails with `exact_qualification_missing`.
2. Bring the branch up to `origin/main` before qualifying it. Keep both sides of additive docs conflicts and take main's version for untouched content. Recheck the new head after any update. The merged tree must equal the tree tested in CI; see [CI receipts](../.github/scripts/pipeline_evidence.py) and [Deploy qualification](../.github/scripts/release_state.py).
3. After each merge to `main`, refresh and requalify other affected PRs. Updating another open iOS PR triggers `synchronize` and restarts its macOS checks. The update, not the push to `main` on its own, is the trigger. Batch coordinated merges instead of repeatedly updating native PRs.

### TestFlight build

When the approved release work is merged and nothing is pending, the release owner cuts the next build. After a backend or PI merge, wait for the matching normal [Deploy](../.github/workflows/deploy.yml) and its readiness evidence before dispatching [iOS TestFlight](../.github/workflows/ios-testflight.yml). Only the authorised release owner runs this command; it is not an offline check.

```sh
gh workflow run ios-testflight.yml --ref main -f branch=main
```

The Apple build number is the workflow run number. Check the export/upload step, then confirm the exact build has finished processing in App Store Connect and is available to the intended TestFlight testers. If only Actions is accessible, report upload only; do not dispatch another build for readback. Name the available build and the [plan's](../PLAN.md) daily-core checks. A successful upload is **not accepted on device**. Reopen an acceptance issue if linking a PR closed it prematurely.

## Cost and safety

- **Local only.** Do not create a GitHub cloud sandbox without explicit approval; those sandboxes are billed. Using GitHub for an authorised issue, fetch or PR is not cloud-agent work.
- **Offline by default.** `measure_pi`, a live model/provider smoke, Foundry readback/probes, real APNs sends, and paid benchmarks require Dan's explicit approval of the **exact command**. No change that adds cost without approval. Do not start release or live acceptance workflows just to validate docs.
- **Product rules.** Keep PI model-driven. Use deterministic checks for facts, provenance and exact outcomes, not to add a second decision-maker. No new PI confirmation or approval except delete; preserve auth and sensible retry safety. Build the replacement, test it, then delete the old path explicitly. No new fallback, dual path or compatibility shim. Note any deliberately accepted cutover gap.
- **Public repository.** Use secret names, never values. Keep live logs, captures, tokens, account details and real personal data out of docs, test evidence, cards and PRs. Use synthetic fixtures, not real examples.

For Voice changes, test event shapes seen in real logs using sanitised, synthetic fixtures. Idealised sequences missed fragmented requests. An `offset_ms` value is not the end of an utterance, and a backchannel never cancels PI. Run the Chat/Voice parity suite for relay, gateway, MCP door and tool-route changes.

## Repository hygiene

The repository must stay small enough for a new agent to read it. [.github/copilot-instructions.md](../.github/copilot-instructions.md) lists every key file and its owner; [docs/README.md](README.md) indexes the docs folders.

- **One doc per topic, updated in place.** Put a decision in [decisions](decisions.md), progress in [the plan](../PLAN.md), runtime changes in [architecture](architecture.md), procedures here. Do not add a new file when an existing one fits.
- **Do not commit working material.** Per-build or per-task notes, handoffs, review write-ups, evidence JSON, screenshots, captures, prototypes and exported chats belong in the pull request body or CI artifacts. Design references may sit in `docs/ui/` only until implemented. When the feature ships, move the lasting rules into [the style guide](ui/style-guide.md) or [DESIGN.md](../DESIGN.md) and delete the images.
- **Delete, do not archive.** Git history keeps removed files; `docs/archive/` holds only decision indexes.
- **Key files stay current.** `p0.md`, `PRODUCT.md`, `PLAN.md`, `DESIGN.md`, `ui.md` and the key docs listed in the instructions file describe the project as it is now. A change that makes one wrong updates it in the same change.
- **A new markdown file** is added to the map in `.github/copilot-instructions.md` and to [docs/README.md](README.md) in the same change. That file started from shared-project-templates 2.2.3 and is now maintained by hand. `AGENTS.md` only points to it. Keep the hashes in `.template-state.json` as they are so a template sync treats both files as customised, and keep the map when re-syncing.
- **Fixed paths.** `docs/features.md`, `docs/github-app-manifest.json` and `docs/tool-conformance.md` are read by code, the Docker build or CI. Moving or editing them is a code change.
- **Large files.** Do not commit files over 1 MB without a reason recorded in the pull request.

## Azure

Local work does not require Azure credentials. Production inspection requires the correct tenant/subscription and a scoped role from the owner; verify the target before an authorised command. Keep change delivery in the main-only Deploy workflow. Do not change Foundry versions concurrently with Deploy; instructions are portal-owned after bootstrap, and `KEEP THIS BLOCK` is not editable. See [infra](../infra/README.md) and [agent ownership](architecture.md#the-two-foundry-agents).

### Verify the live agents (read-only)

After saving agent text in Foundry, Dan activates the intended version and checks what is serving. With authorised access, use `GET /agents/<name>` and `GET /agents/<name>/versions/<version>` on the project endpoint. Check the 100% pin, or latest if unpinned. Use the API version and headers in the [provisioner](../.github/scripts/provision_pi_agent.py).

For `jarvis-pi`, check the model, harness, tool setup and both `KEEP THIS BLOCK` markers. For `jarvis-pi-live`, check the live voice kind, client delegation and audio contract. Compare the results to the checked-in [Chat](../agents/pi/definition.json) and [Voice](../agents/pi/voice-definition.json) definitions without printing the instruction text. If the intended version or tool block is missing, correct it in the portal and verify again. Do not run this check from a coding session without approval of the exact command.

### Configuration names only

| Area | Names to look up in the checked-in configuration |
| --- | --- |
| Deploy OIDC variables | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` |
| PI backend environment | `FOUNDRY_PROJECT_ENDPOINT`, `JARVIS_PI_AGENT_NAME`, `JARVIS_PI_MCP_SECRET`, `JARVIS_PI_GITHUB_TOKEN` |
| Deploy secret for PI GitHub access | `PI_GITHUB_TOKEN` in GitHub Actions, mapped into the backend as `JARVIS_PI_GITHUB_TOKEN`. |
| APNs (Key Vault-backed backend secrets) | `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_SIGNING_KEY` |
| TestFlight environment | `APP_STORE_CONNECT_KEY_P8`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`; `APPLE_TEAM_ID` is a variable. App configuration secret names are listed in the workflow. |

Do not use a production setting as a local default. See [`config.ts`](../apps/backend/src/config.ts), [Bicep](../infra/main.bicep) and the workflows for current names.

### GitHub App setup

The GitHub App manifest and Azure bindings are maintained separately from developer GitHub CLI sign-in. The backend reads the App key through Key Vault under its managed identity; never give it to a client or a sandbox. The [infra guide](../infra/README.md) describes the boundary. App creation, credential rotation and permission changes are owner operations, not onboarding.

### Jarvis agent

Normal Chat and Voice use PI. The [legacy hosted agent](../agents/jarvis/README.md) is separately deployed and still has its own offline CI.

## Troubleshooting

**Saved note not visible:** Check the exact Vault path, current folder and index state separately. A Vault commit is not proof that the index update succeeded. `vault.title_backfill` reports a failed-attempt count without logging note paths or content. Deploy the backend with [migration 0103](../db/migrations/0103_vault_note_metadata.sql) before shipping the iPhone client that uses owner-only `/notes/summaries` and `sort=updated`.

| Symptom | Check |
| --- | --- |
| `node` is missing, wrong version or the npm cache misses | Check `.nvmrc`, PATH and `node --version` in this shell. Don't borrow a machine's unpinned Node for sign-off. Report a blocked offline install rather than downloading implicitly. |
| Fixture paths fail on Windows | Check whether the suite assumes POSIX paths, Git executable bits, case sensitivity, or mode bits. The Python secret-file test uses `os.fchmod`, unavailable on Windows; use Linux for that exact assertion. Python reports with non-ASCII output need UTF-8. Do not patch tests for a docs-only change. |
| JWKS/auth fixture fails near a timeout | Rerun the focused offline [`auth.test.ts`](../apps/backend/src/auth/auth.test.ts) and note the runner/platform and timing. Investigate a repeatable failure. Do not label a failing run green or reach out to the real issuer. |

For production symptoms, use the [runbook](runbook.md#triage).
