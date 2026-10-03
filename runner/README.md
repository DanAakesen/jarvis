# Coding runner

Python Foundry Invocations adapter for Copilot CLI and Codex over ACP. Ported
from the read-only [prototype](../docs/reference/coding-sandbox-prototype/runner/).
Production has no crash-test command. Live event delivery and frequent branch
pushes remain issues #29 and #35.

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
| Start or resume | `{"agent":"copilot","task":"..."}` (or `codex`) |
| Steer | `{"agent":"copilot","mode":"steer","message":"..."}` |
| Pause | `{"mode":"pause"}` |
| Credential probe | `{"agent":"copilot","probe":"key-vault"}` |
| Codex renewal | `{"agent":"codex","mode":"renew-codex","min_days_left":3}` |

Start, steer and renewal return `invocation_id`, `session_id`, `status`,
`agent`, and `mode`. Poll the invocation for bounded events, result, error, and
timestamps. Renewal results contain only expiry/status metadata; those
allowlisted dates may persist with invocation status, never prompts, secret
values, or general task results. Pause uses ACP cancellation; a later turn
reloads the persisted ACP session.
Every agent prompt, including resumed and recovered turns, is prefixed with
instructions to commit and push small work-in-progress changes to the existing
task branch after each meaningful step. Agents must not force-push or push to
`main`, and must report commit or push failures.
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

The port retains the prototype's `github-token`, `copilot-token`, and
`codex-login` retrieval contract. `copilot-token` authenticates the CLI seat;
`github-token` is separate Git access. The GitHub App installation-token flow
in #40 will replace the prototype's static Git-token path. This workflow never
seeds or copies credentials; the workspace `GH_TOKEN` is not a runner input.
Dan's personal Codex login must never be used. See the
[Codex login rules](../docs/architecture.md#sandbox-credentials).

## Images and deployment

The base image contains Node/Python and both coding CLIs. The .NET image adds
only the .NET SDK and its runtime libraries to that base; .NET never enlarges
Node/Python sandboxes. Each image has `1x2` (1 vCPU / 2 GiB) and `2x4` (2 vCPU /
4 GiB) hosted variants named `jarvis-runner-{base|dotnet}-{1x2|2x4}`. Default to
`base-1x2`; .NET projects normally use `dotnet-2x4`. Full builds run in GitHub
Actions because sandbox disk is limited (L23).

`runner-deploy.yml` runs only on `main` with the bootstrap OIDC identity. It
queues under `jarvis-production-deploy`; #11's infrastructure/backend deploy
workflow must use that same concurrency group. It builds both images in ACR with Dockerfile paths relative to the uploaded
`runner/` context (`Dockerfile` and `Dockerfile.dotnet`), checks their manifests, deploys immutable digest references, selects the active
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
