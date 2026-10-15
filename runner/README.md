# Coding runner

Python Foundry Invocations adapter for Copilot CLI and Codex over ACP. Ported
from the read-only [prototype](../docs/reference/coding-sandbox-prototype/runner/).
Production has no crash-test command. P2-03 implements task-scoped event delivery;
live Azure identity verification remains a post-merge step. Frequent branch pushes
remain issue #35.

## Develop and check

Use Python 3.12.14 from the root `.python-version`:

```sh
python -m venv runner/.venv
runner/.venv/bin/python -m pip install --require-hashes -r runner/requirements-dev.txt
cd runner
.venv/bin/python -m pytest -q
.venv/bin/python -m ruff check .
```

Requirements files pin all Python dependencies and artifact hashes. Update them
with `uv pip compile --generate-hashes requirements.in -o requirements.txt` and
`uv pip compile --generate-hashes requirements-dev.in -o requirements-dev.txt`
from `runner/`, using Python 3.12. CLI versions and their npm integrity hashes
live in `tools/package.json` and `tools/package-lock.json`.

| Tool | Version |
| --- | --- |
| Python | 3.12.14 |
| Node | 22.23.3 |
| Copilot CLI | 1.0.91 |
| Codex CLI | 0.157.0 |
| Codex ACP adapter | 2.1.1 |
| GitHub CLI | 2.98.0 |
| PowerShell | 7 (Microsoft Debian package) |
| .NET SDK (separate image) | 8.0.419 |

The aggregate `CI` workflow runs runner lint and tests in its Python job and calls
`runner-ci.yml` for both image builds, packaged CLI checks, and an
HTTP smoke request against the container's OpenAPI route. The cloud agent
sandbox cannot run Docker; GitHub Actions owns those checks.

## Invocations contract

Foundry authenticates and routes calls to this server; do not expose port 8088
as a public service outside that boundary. The runtime host uses
`/agents/<name>/endpoint/protocols/invocations?api-version=v1`. Pass an existing
session as `agent_session_id` to resume, steer, or pause.

| Operation | JSON body |
| --- | --- |
| Start or resume | `{"agent":"copilot","task":"...","task_id":"42","repository":"owner/name","defaultBranch":"main","branch":"jarvis/task-42","model":"gpt-5.4","reasoning":"high"}` (model and reasoning are optional for either provider) |
| Steer | `{"agent":"copilot","mode":"steer","message":"...","task_id":"42"}` |
| Pause | `{"mode":"pause"}` |
| Credential probe | `{"agent":"copilot","probe":"key-vault"}` |
| Codex renewal | `{"agent":"codex","mode":"renew-codex","min_days_left":3}` |
| Codex web research | `{"agent":"codex","mode":"codex-tool","tool":"web_research","query":"...","model":"gpt-5.5","reasoning":"high"}` (`reasoning` optional) |
| Codex HTML report | `{"agent":"codex","mode":"codex-tool","tool":"html_report","query":"<bounded JSON report request>","model":"gpt-5.5","reasoning":"high"}` (`reasoning` optional) |

Start, steer and renewal return `invocation_id`, `session_id`, `status`,
`agent`, and `mode`. Poll the invocation for bounded events, result, error, and
timestamps. Renewal results contain only expiry/status metadata; those
allowlisted dates may persist with invocation status, never prompts, secret
values, or general task results. Pause uses ACP cancellation; a later turn
reloads the persisted ACP session.
The backend passes the effective model and reasoning selected from the task
override or settings default; `default` or an omitted value leaves the provider
setting unchanged. Codex `none` is passed as an explicit effort, while Copilot
`none` omits the CLI flag. The dispatcher owns settings resolution. Copilot
receives `--model` and `--reasoning-effort` when specified. Codex uses ACP
config options `model` and `reasoning_effort`; the runner validates supported
reasoning values and persists the choices with session metadata so
resumed/steered turns keep the task's original configuration.
When configured with `JARVIS_BACKEND_URL`, real task and steer invocations must
include the positive SQL task ID as `task_id`. The runner obtains a token for
`JARVIS_API_SCOPE`, sends each event in order to `/factory/sandbox-events`, and
waits for delivery before reporting completion. Payloads are bounded to 256 KiB;
a delivery failure marks the invocation failed. The backend's runner-only app
role is assigned after Runner deploy using the principal IDs in its evidence
artifact. Browser streaming remains P1-06.
Task status and its checkpoint remain nonterminal while owned finalization runs.
Success requires provider, private Codex auth file and event/publisher cleanup.
A shared 60-second monotonic work deadline bounds asynchronous finalization;
credential persistence, event delivery and publisher close also have ten-second
caps. Cancellation joins add at most one second per timed-out wait. Synchronous
filesystem operations are not covered by an exact wall-clock guarantee.
Losing a control request does not cancel the worker it is joining. A stop deadline still forces
only the owned process group on POSIX (the owned process on Windows), but neither its timeout nor a delayed ACP cancellation
acknowledgement appends events after finalization starts.
A late pause or cancellation retains its requested terminal outcome; it does
not append events to a closing publisher. Cleanup failure stays failed and
returns a sanitized 503 from an in-flight cancellation, not false success.
Timed-out cancellation-resistant work remains owned until it settles, even
after the invocation becomes failed. It fences the same session; unsettled
credential persistence also fences new Codex turns across sessions. Queued
turns recheck ownership after acquiring their lock. An exhausted budget does
not start a new credential write. These fences are process-local and do not
prove cloud resource release.
`tests/test_task_finalization.py` exercises this ordering with synthetic delivery
and metadata boundaries, actual temporary Git commits and owned child processes;
it is not authenticated Foundry/GitHub acceptance.
ACP shutdown retains both stdout/stderr readers and shares one teardown across
concurrent callers. Terminate, post-kill exit and reader completion each have a
ten-second bound; cancellation joins have a one-second bound. A timeout or
reader exception fails explicitly rather than reporting successful cleanup.
Failed cleanup retains the session client to refuse another provider turn;
only successful stop removes the matching owner. These are local process/pipe
guarantees, not cloud deallocation evidence or a repair of an old runner image.
`tests/test_acp_shutdown.py` covers these boundaries with synthetic readers and
owned child processes. POSIX starts the provider in its own session/process group
and signals that captured group even after its leader exits. Shutdown verifies
the leader, live group members and both readers; an inherited pipe cannot be
left open by an unsignalled group member. Linux procfs distinguishes live members
from exited zombies awaiting PID 1 reaping. An unreadable membership check fails
cleanup rather than assuming exit. This does not reap PID 1's children, supervise
processes that deliberately leave the group, or prove cloud deallocation.
Automatic cleanup failure events include only an allowlisted `cleanup_phase`
(`process_exit`, `reader_shutdown`, `reader_failed`, or `provider_shutdown`),
never provider output. Sanitized finalization timeout errors also identify
`credential_persist`, `event_delivery`, or `publisher_close`; heartbeat logging
accepts only these named phases.
The first failure stays in the terminal `error`; cleanup does not overwrite an
earlier work failure. A needs-attention question is not a work failure.
`cleanup_failures` records the first sanitized error for each failed cleanup
phase, in observation order, including failures that follow the primary error.
Event-delivery errors are recorded when observed, even before provider shutdown.
Delivery and publisher failures stay separate; no phase suffix is appended to
the primary error, preserving the heartbeat parser's anchored format.
Polling and persisted invocation metadata include these bounded, allowlisted
diagnostics. Metadata excludes raw exception text, provider output, credentials
and arbitrary extra fields. Built-in exception classifications and the fixed
ACP/timeout errors survive recreation; other work-error messages remain intact
in memory but rehydrate as `Runner task failed` when cleanup diagnostics exist.
General prompts, events and task results still do not persist. These diagnostic
changes do not extend the work deadline, IO caps or cancellation joins.
Polling and persisted invocation metadata also expose independent boolean
`work_completed` and `provider_stopped` lifecycle proof. Both default to false
for fresh turns and legacy metadata; only literal JSON booleans are accepted,
never strings or numbers. `work_completed` additionally requires a trusted local
delivery-work indication from `_run_task`'s verified new-commit completion branch,
with a completed task outcome and no preceding error, cancellation or intentional
stop at finalization entry. `_finish_task` defaults this indication to false
and additionally requires the validated work commit.
A no-commit `session_question` never qualifies, even if its turn outcome is
completed and its publication fails only after provider stop or never reaches
the backend. End-turn/result text, an existing PR and absence of a question
event are not delivery-work evidence.
`work_commit_sha` binds successful work to the exact new local commit whose
branch and ancestry the runner verified. The commit check returns that captured
object ID directly; finalization does not reread a potentially changed `HEAD`.
Polling and persisted metadata expose its normalized lowercase, full 40-hex
SHA, or `null` when absent or malformed. Strings containing whitespace,
abbreviated hashes, nonhex values and nonstring types are not accepted; full
uppercase hex is normalized. Fresh turns, questions and unsuccessful work have
no work commit. Legacy metadata remains readable without inventing one from
booleans, results, model text or an existing PR.
Local branch/commit ancestry checks do not prove a push. An unpublished new
local commit B can coexist with an older green remote commit A; the runner
reports B, not A, and does not push on the agent's behalf. Backend completion
and merge authorization must require this binding for both clean completion
and the cleanup-failed alternative, verify the remote task branch and PR have
exactly that head on create/reuse/reconciliation, and apply project policy to
the same expected commit. Missing binding cannot authorize new Done or merge.
`provider_stopped` becomes true only after the matching owned client's bounded
ACP stop returns successfully, including its process-group and reader checks.
An absent client/process, an exited leader alone, a failed or timed-out stop,
or a late cancellation-resistant stop completion is not proof.
Later credential, event-delivery or publisher failure still produces a failed
runner status with the original diagnostics; it does not erase established
work/stop proof or become runner success. These fields are not PR evidence or
physical cloud deallocation. Only the backend may consider a final failed
snapshot with both flags true and a valid commit binding, after current-generation/invocation, GitHub
delivery verification and project policy checks. Nonterminal or cancelled
snapshots, failed work and missing stop proof are not eligible through this path.
Every agent prompt, including resumed and recovered turns, is prefixed with
instructions to commit and push small work-in-progress changes to the existing
task branch after each meaningful step. Agents must not force-push or push to
`main`, and must report commit or push failures.
New sessions require a GitHub `repository` (`owner/name`), `defaultBranch`, and a
separate task `branch`. The runner clones into the session's `project/` directory
using the existing Git credential helper, checks out the remote task branch if
present, or creates it from the remote default branch. ACP runs inside that
checkout; credentials, provider homes, and session metadata stay outside it.
Branch names may contain Git-valid Unicode and punctuation such as `+`; unsafe
ref syntax is rejected before running Git commands.
Resume and steer reuse the persisted workspace configuration (fields may be
omitted but cannot change); recovery into a new session clones the supplied task
branch again. Existing worktrees retain local commits and uncommitted files.
Workspace configuration is persisted before cloning. Failed clone/checkout setup
removes only the newly created checkout, allowing a retry with the same
configuration. Existing checkouts without verified session metadata are refused.
Missing repository-local Git author settings default to the existing project
automation identity, `github-actions[bot]`
(`41898282+github-actions[bot]@users.noreply.github.com`). Existing author settings
are preserved on resume. This is commit metadata, not Git authentication;
provider-specific author setup is not required.
Git operations have a 120-second timeout. Clone/access failures are reported
without Git diagnostics or credentials; invalid origins, missing Git metadata,
wrong branches, and rewritten history fail rather than reporting completion.
An ACP `end_turn` with no new commit on the task branch emits `session_question`
with the last agent message instead of `completed`. Its invocation is terminal
(`completed`), but the question is not a delivery result. A new local commit
does not prove it was pushed; the backend still verifies GitHub.
Question events retain the sanitized provider result, including reported usage,
so commit-free turns are accounted for like other completed turns.
Cancel terminates the provider process. A `completed` runner turn is not proof
of a branch or PR: the backend must verify GitHub before accepting delivery
(L22). The filesystem persists only at Foundry checkpoints. Metadata is stored per
invocation, so an idle recreation still permits polling earlier turns in the
session. Older images' single `task-state.json` records remain readable. Only
identifiers, status, and timestamps rehydrate for ordinary turns. Renewal
records additionally retain allowlisted expiry and last-updated dates so the
backend can reconcile a completed invocation after runner recreation.

The hosted identity fetches secrets from `KEY_VAULT_URI`; its writable home is
under `JARVIS_WORK_ROOT` (default `/files/jarvis`). Codex auth files are private
and removed after a turn or renewal. Known credential strings are redacted from
ACP output. Errors and credential probes never return secret-provider details.
Renew only while no Codex task runs; the backend scheduler in #34 owns that
coordination across sandboxes.

The runner reads Key Vault secrets `jarvis-github`, `jarvis-copilot` and
`codex-login`; `jarvis-copilot` authenticates the CLI seat, while `jarvis-github`
is the legacy Git credential path. P3-02 adds GitHub App installation tokens:
the backend keeps the App private key and mints a one-hour token for the active
task's repository only when the request's Foundry session matches that task. The
Git credential helper requests a fresh token on each Git credential lookup. Set
repository Actions variable
`JARVIS_GITHUB_APP_TOKEN_ENABLED=true` only after deploying/configuring the backend;
it defaults to `false`, preserving the legacy path. Actions variable
`JARVIS_GITHUB_APP_ID` configures the backend's `GITHUB_APP_ID`; neither value is
sent to the sandbox. Keep the legacy secret and runner
read grant until the post-merge live push to `DanAakesen/jarvis-test-target`
succeeds, then remove them and the fallback in a follow-up. The workflow never
seeds or copies credentials; workspace `GH_TOKEN` comes from the runner's
task-scoped credential response, not an external runner input.
Dan's own local/personal Codex login must never be copied into a runner. The
existing `codex-login` Key Vault secret is the authorized Jarvis ChatGPT/Codex
subscription login used by the runner. See the
[Codex login rules](../docs/architecture.md#sandbox-credentials).

### Codex tools (P7-14)

The backend sends a bounded `web_research` query or JSON `html_report` request
and configured model in `mode=codex-tool`; it does not send a repository,
GitHub token, or API key. The runner accepts only the registered Codex tool name
and a ChatGPT-supported model. It starts `codex --disable shell_tool exec
--skip-git-repo-check -s read-only` in a fresh temporary directory. Live web
search is enabled only for `web_research`; report generation receives the
collected findings as untrusted JSON evidence. Disabling
`shell_tool` is required: the read-only filesystem sandbox still permits reads,
including of a file-backed `CODEX_HOME/auth.json`. The temporary Codex home
contains only the authorized login file and minimal config; the workspace, home,
and auth file are removed after the call. No repository is cloned.

The query is passed as argument data (never through a shell) and prompts treat
retrieved pages and research findings as untrusted evidence. Each invocation is bounded by
`JARVIS_CODEX_TOOL_TIMEOUT_SECONDS` (1–600 seconds; default 300), stdout/stderr
and the last-message file (256 KiB each); cancellation kills the Codex process.
Only invocation status/mode/tool metadata persist, not the query or result. A
Codex usage-limit stop returns the visible exact failure
`Codex usage limit reached`; there is no paid API fallback. The backend validates
the answer and at most ten unique HTTPS sources, supplies backend receipt times,
and explicitly reports an empty source list.

## Images and deployment

The base image contains Node/Python and both coding CLIs. The .NET image adds
only the .NET SDK and its runtime libraries to that base; .NET never enlarges
Node/Python sandboxes. Each image has `1x2` (1 vCPU / 2 GiB) and `2x4` (2 vCPU /
4 GiB) hosted variants named `jarvis-runner-{base|dotnet}-{1x2|2x4}`. Default to
`base-1x2`; .NET projects normally use `dotnet-2x4`. Full builds run in GitHub
Actions because sandbox disk is limited (L23).

`runner-deploy.yml` runs only on `main` with the bootstrap OIDC identity. It
queues under `jarvis-production-deploy`; #11's infrastructure/backend deploy
workflow must use that same concurrency group. It builds both images in ACR from the `runner/` context, passing Dockerfile paths from the
repository root (`runner/Dockerfile` and `runner/Dockerfile.dotnet`, L53), checks their manifests, deploys immutable digest references, selects the active
Invocations version, grants each dedicated agent identity secret-specific read
access and write access only to `codex-login`, then probes both providers from
a session it deletes in `finally`. Existing resources, credentials, and task
sessions are not deleted. The deployment evidence artifact records each variant
only after its identity probe passes; partial deployment is visible if a later
variant fails. New versions apply to new sessions, not existing running tasks.

Before the first runner deployment, #11 must:

1. Deploy `infra/main.bicep` and retain its deployment name and outputs.
2. Set Actions variable `JARVIS_INFRA_DEPLOYMENT_NAME` to that successful group
   deployment. Existing bootstrap variables supply Azure client/tenant/subscription.
3. Ensure the three credential secrets already exist using the approved credential
   setup. Missing secrets fail the identity probe; this workflow does not seed them.
4. Run Runner deploy from `main`. The workflow grants its deploy identity project
   data-plane roles and the Foundry project identity `Foundry User` on its account.

Until the deployment-name variable is set, the workflow explicitly reports the
pending prerequisite and skips Azure work. Local tests do not establish live
ACR, Foundry, RBAC, or Key Vault acceptance. Those remain pending #11 and the
main-branch deployment evidence; issue #28 remains In progress.
