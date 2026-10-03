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

The queue is Dan's [Jarvis project 2](https://github.com/users/DanAakesen/projects/2/views/1).
Its single-select **Status** field must have unique **Ready** and **In progress**
options (capitalization may vary). Only open issues from `DanAakesen/jarvis` in
Ready are candidates; archived cards, draft items, PR cards and other repositories
are ignored. Move a card out of Ready to prevent a new assignment.

Repository Actions secret `PROJECTS_TOKEN` holds a separate **classic** personal
access token with the **`project`** and **`repo`** scopes, so private issue content
is visible. Create it under GitHub **Settings → Developer settings → Personal
access tokens → Tokens (classic) → Generate new token**, then save its value in the repository's **Settings → Secrets and variables
→ Actions → New repository secret**. Keep it separate from the Copilot token.
GitHub [does not support personal-account Projects with fine-grained PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations).
The workflow uses the project token only for project reads/status changes;
repo and Copilot requests use their own credentials. Replace both secrets before
expiry. Missing/denied project access pauses new assignments while PR processing
continues. If GitHub returns redacted issue content, verify the token's access to
those private issues; the coordinator never treats hidden content as a candidate.

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
- `COORDINATOR_MAX_COPILOT` defaults to `3` open Copilot-owned issues
  (worker label or assignee); values 1–99 are supported. Existing work uses capacity before new assignments.
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

The project's Ready column selects the queue; `PLAN.md` on current main and
GitHub dependencies remain eligibility checks. The coordinator requires all of:

- A non-archived project item in **Ready**, referencing an open Jarvis issue
  whose exact task ID matches a Not started PLAN row.
- Every PLAN prerequisite Complete and its corresponding GitHub issue closed.
- No open GitHub "Blocked by" prerequisite.
- No `Codex`, `Jarvis`, `Dan` or `Copilot` worker label, checked without regard
  to case; no existing assignee; no open PR with a closing reference to the issue.
- Green main and available Copilot capacity.

It rechecks Ready status, ownership and dependencies, adds its Copilot worker
claim and assigns the existing issue through GitHub's supported API. Only after
GitHub confirms the Copilot assignment does it move that item to **In progress**.
The final Ready check runs immediately before the assignment mutation;
removed cards and changed statuses observed by those reads are left untouched.
GitHub offers no atomic transaction spanning assignment and project status, so
an external move racing the final API request cannot be completely excluded.
If assignment succeeds but the project write fails, the next run reconciles the existing Copilot-owned
Ready card without starting another job. Human or mixed assignees are untouched.
It never removes other workers'
labels, replaces their assignees, removes dependency links or creates a duplicate
task PR. Definitive preflight or HTTP assignment rejections release the
coordinator's unused claim
only after fresh issue/PR reads show no assignee, other worker or linked PR.
Partial GraphQL mutation failures, unconfirmed mutations and other ambiguous
assignment failures retain the claim for inspection because a request
may already have started work; inspect the issue before releasing it. Either
failure pauses further assignments in that run while future runs continue.
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
