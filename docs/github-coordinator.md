# GitHub coordinator

Issue [#12](https://github.com/DanAakesen/jarvis/issues/12) provides
`.github/workflows/coordinator.yml`. It runs from trusted `main` every 15 minutes
and can also be started under **Actions → Jarvis coordinator → Run workflow**.
GitHub may delay scheduled runs; this is a recurring check, not a precise timer.
It runs independently of any Codex chat or cloud workspace.

Dan authorized automatic merges, Copilot conflict repair and assignment of
ready tasks on 3 October 2026. This implements the requested periodic portion
before #11; #12 remains In progress until deployment integration and its live
acceptance criteria are verified. It does not close either issue early.

## Credentials and controls

Repository Actions secret `COPILOT_ASSIGNMENT_TOKEN` holds a fine-grained
personal access token for `DanAakesen/jarvis`. Repository permissions:
**Actions, Contents, Issues, Pull requests and Workflows: read and write**;
Metadata is automatically read-only. Replace the secret before its token expires.
Never put the value in source, a PR, an issue, logs or chat. The coordinator reads
it only as a protected workflow environment binding.

The token authorizes requests; Copilot remains the issue assignee and coding
worker. GitHub requires a user token for Copilot assignment and follow-up; a
GitHub App installation token or the built-in Actions token is insufficient.
This does not replace the Jarvis Software Factory App or distribute its key.
See GitHub's [assignment API documentation](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api).

New assignments explicitly request `claude-opus-5.5`. The assignment API has no
documented reasoning-level selector; GitHub uses the model's default reasoning.
Existing-PR `@copilot` follow-ups retain that PR's model; the comment API cannot
select a replacement model. See [Copilot on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github).

- Manual runs default to **dry run**: reads and reports only. Uncheck `dry_run`
  to enable mutations. Scheduled runs are active.
- Repository variable `COORDINATOR_ENABLED=false` pauses the job. Disabling the
  workflow in Actions also stops it.
- `COORDINATOR_MAX_COPILOT` defaults to `3` open Copilot-labelled issues; values
  1–99 are supported. Existing work uses capacity before new assignments.
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
also pass. A red or pending main permits only tested `fix-main:` PRs and pauses
new task assignments.

## Issue loop

`PLAN.md` on current main is the authority. The coordinator requires all of:

- An open issue whose exact task ID matches a Not started PLAN row.
- Every PLAN prerequisite Complete and its corresponding GitHub issue closed.
- No open GitHub "Blocked by" prerequisite.
- No `Codex`, `Jarvis`, `Dan` or `Copilot` worker label, checked without regard
  to case; no existing assignee; no open PR with a closing reference to the issue.
- Green main and available Copilot capacity.

It rechecks ownership and dependencies, adds its Copilot worker claim and assigns
the existing issue through GitHub's supported API. It never removes other workers'
labels, replaces their assignees, removes dependency links or creates a duplicate
task PR. Ambiguous assignment failures retain the claim for inspection because a
request may already have started work; inspect the issue before releasing it.
Missing issue mappings, incomplete PLAN dependencies and access denials remain
blocked. GitHub search alone is not trusted to determine readiness.

## Evidence and operation

Each run writes a short summary of merges, updates, repairs, ready candidates,
assignments and holds under **Actions → Jarvis coordinator → run → Summary**.
No credentials, prompts or provider response bodies are printed. API requests
have time/size bounds, and writes are not automatically retried.

Local policy, API and orchestration regressions use Python's standard `unittest`
without live jobs or Azure access. Aggregate CI runs them. Live activation must
be verified with the configured secret after this workflow reaches main; mocked
assignment tests do not prove a live Copilot session started. Azure deployment
and scratch-PR deployment acceptance remain #11/#12.
