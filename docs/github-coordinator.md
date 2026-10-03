# GitHub coordinator

Issue [#12](https://github.com/DanAakesen/jarvis/issues/12) provides
`.github/workflows/coordinator.yml`. It runs from trusted `main` every 15 minutes
when enabled. Manual inspection is available under **Actions → Jarvis coordinator
→ Run workflow** only after the workflow is explicitly enabled.
GitHub may delay scheduled runs; this is a recurring check, not a precise timer.
It runs independently of any Codex chat or cloud workspace.

The workflow is **disabled in GitHub** as of 3 October 2026, following Dan's
request to stop project-board automation. Project-board reads and writes,
Ready-column polling and automatic issue assignment have been removed. No
Projects credential is required. The remaining code handles PR maintenance;
this cleanup does not re-enable the workflow.

## Credentials and controls

The existing repository Actions secret `COPILOT_ASSIGNMENT_TOKEN` is used for
user-authorized PR merges, branch updates and existing-PR Copilot repair comments.
Its value stays in protected workflow configuration. Never put credentials in
source, a PR, an issue, logs or chat. This workflow starts no new issue assignments
and does not select a model. Existing-PR repair comments continue that PR's agent.

- Manual runs default to **dry run**: reads and reports only. Active runs can
  merge, update PR branches and request conflict repairs after their checks.
- Repository variable `COORDINATOR_ENABLED=false` pauses the job. Disabling the
  workflow in Actions also stops it; it is currently disabled.
- Add PR label `automation:hold` to prevent that PR's merge, branch update or
  conflict repair. Agents keep their PR draft while actively working.

## PR loop

The workflow serializes its own runs, inspects open same-repository PRs targeting
`main`, and performs at most one squash merge per run. A PR must be non-draft,
have an approved task, `fix-main:` or documentation-only `docs:` title, have no
unresolved review findings, contain current main, and have passing aggregate CI
at its exact head. Other pending or failing checks prevent merging. A Copilot
PR must have a completed work timeline; a pending repair request also holds it
until the later completion event. Draft human/Codex PRs are left to their worker.

Clean outdated branches are updated and retested. GitHub's branch update is
asynchronous; the next run dispatches missing CI only after observing the new
head, so an old-head result cannot approve the new revision. Conflicts are sent
to Copilot on the existing PR, with a marker tied to its head and main revision.
The same request is not repeated. A finished Copilot draft can receive a repair;
it cannot merge until Copilot finishes, the PR becomes ready and checks pass.
Unresolved review comments are held for their worker; conflict repair does not
silently resolve them. A failed or stalled agent request remains visible in the
Actions summary instead of spawning duplicate jobs.

Immediately before merging, the coordinator refreshes main, PR, worker state,
review threads and checks, and supplies the expected head SHA to GitHub's merge
API. GitHub Free cannot enforce an atomic base-SHA condition against merges by
other actors: once Pro is available, protect main with `CI result` and require
up-to-date branches. The coordinator does not bypass branch rules or use an
administrator merge.

User-token merges and branch updates generate normal push/PR events. If the
Copilot secret is absent, merging may use the workflow token; it explicitly
dispatches CI and existing applicable deployment workflows because token-made
pushes do not generate those events. Missing main CI is recovered on subsequent
runs. Docs-only merges do not dispatch deployments. Deploy workflows must support
`workflow_dispatch`; #11 owns the complete deployment integration. Before #11,
aggregate CI gates main. After #11 is Complete, its latest deployment runs must
also pass. A red or pending main permits only tested `fix-main:` PRs.

## Evidence and operation

Each run writes a short summary of merges, updates, repairs and holds under **Actions → Jarvis coordinator → run → Summary**.
No credentials, prompts or provider response bodies are printed. API requests
have time/size bounds, and writes are not automatically retried.

Local PR policy, API and orchestration regressions use Python's standard `unittest`
without live jobs or Azure access. Aggregate CI runs them. Future reactivation
requires explicit authorization and live verification; a successful workflow
result alone does not establish its external effects. Azure deployment and
scratch-PR deployment acceptance remain #11/#12.
