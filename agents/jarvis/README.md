# Jarvis agent

The Foundry hosted Jarvis agent (P4-01). It is ported from the read-only
[voice prototype](../../docs/reference/voice-prototype/agent/): the Voice Live
Bridge runtime, response coordinator and strict action rules are unchanged. The
prototype's fake tools are gone: every tool comes from the backend's tool registry.

| File | Role |
| --- | --- |
| `main.py` | Entry point: Voice Live Bridge host on port 8088 (`/invocations_ws`) |
| `voice_runtime.py`, `response_coordinator.py`, `state.py`, `response_telemetry.py` | Voice turn handling, as in the prototype, including model-free test commands such as `/help` |
| `model_client.py` | Per-session configured model and reasoning effort for the Responses API |
| `jarvis_tools.py` | Instructions and `BackendToolClient` for the backend tool registry |

## Backend tools

Before acknowledging a new hosted session, the agent loads its effective Jarvis
model and reasoning effort from `GET /agent/settings`. It keeps that snapshot for
the session, so later settings changes affect only new sessions. If the settings
cannot be loaded, the session is rejected with a retryable startup failure.

Each turn loads `GET /tools` from `JARVIS_BACKEND_URL` (cached 60 seconds) and
offers those schemas to the model. A model tool call goes to `POST /tools/{name}`
with the arguments and `X-Jarvis-Message-ID`, and the backend result goes back to
the model unchanged. The agent authenticates with its platform identity
(`DefaultAzureCredential`, scope `api://<jarvis-api>/.default`). The backend accepts
that token only with the `Jarvis.Tools` role on the tool routes and the limited
Jarvis-settings read.

Only `outcome: "ok"` counts as done. Every failure becomes `outcome: "error"` and
says whether nothing was done (the request never left the agent) or, after a
timeout or a connection lost after sending, that the action may have happened. These failures cover unknown tools, bad arguments, refused identity,
unavailable persistence and an unreachable backend. If the catalogue cannot be
loaded, the turn fails before the model is asked.

The message ID comes from the per-turn `current_message_id` context. The conversation
store (P4-03) stores messages, but no caller passes a message ID to the agent yet,
so the agent currently answers every tool call with "nothing was done". Deployment, the role assignment and a live
check of the factory tools are P4-08.

## Commands

Setup: `bash scripts/setup-dependencies.sh` from the repository root creates
`.venv` from the hash-locked `requirements-dev.txt`.

```sh
.venv/bin/python -m ruff check .
.venv/bin/python -m pytest -q
docker build --tag jarvis-agent:local .
docker run --rm --publish 8088:8088 \
  --env FOUNDRY_PROJECT_ENDPOINT=https://<host>/api/projects/<name> \
  --env AZURE_AI_MODEL_DEPLOYMENT_NAME=<deployment> \
  --env JARVIS_BACKEND_URL=https://<backend> jarvis-agent:local
.venv/bin/python scripts/smoke_test.py   # model-free /help turn
```

Configuration and lock regeneration are in
[agent-context.md](../../docs/agent-context.md#jarvis-agent).
