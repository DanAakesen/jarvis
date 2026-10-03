# Jarvis agent

The Foundry hosted Jarvis agent (P4-01). It is ported from the read-only
[voice prototype](../../docs/reference/voice-prototype/agent/): the Voice Live
Bridge runtime, response coordinator and strict action rules are unchanged. The
prototype's fake tools are gone: every tool comes from the backend's tool registry.

| File | Role |
| --- | --- |
| `main.py` | Entry point: Voice Live Bridge host on port 8088 (`/invocations_ws`) |
| `voice_runtime.py`, `response_coordinator.py`, `state.py`, `response_telemetry.py` | Voice turn handling, as in the prototype, including model-free test commands such as `/help` |
| `model_client.py` | `gpt-5.6-luna` tool loop over the Responses API |
| `jarvis_tools.py` | Instructions and `BackendToolClient` for the backend tool registry |

## Backend tools

Each turn loads `GET /tools` from `JARVIS_BACKEND_URL` (cached 60 seconds) and
fetches `GET /factory/context` before calling the model. The context contains up
to 20 running tasks and their three most recent events; the agent's in-session
message history is bounded to 12 messages / 24,000 characters. A model tool call
goes to `POST /tools/{name}` with the arguments and `X-Jarvis-Message-ID`, and the
backend result goes back to the model unchanged. The agent authenticates with its
platform identity (`DefaultAzureCredential`, scope `api://<jarvis-api>/.default`).
The backend accepts that token only with the `Jarvis.Tools` role and only on
agent-enabled routes.

Only `outcome: "ok"` counts as done. Every failure becomes `outcome: "error"` and
says whether nothing was done (the request never left the agent) or, after a
timeout or a connection lost after sending, that the action may have happened. These failures cover unknown tools, bad arguments, refused identity,
unavailable persistence and an unreachable backend. If the catalogue cannot be
loaded, the turn fails before the model is asked.
If the context snapshot cannot be loaded, the turn also fails before the model
call rather than answering with missing or stale task status.

The chat route verifies the delegated user token and stored source message before
starting a turn. It sets the source ID in the per-turn `current_message_id` context,
which the tool loop uses for every backend call. `create_app` accepts a
`chat_context_loader`; P4-04 can provide its context builder at that seam. The
default loader verifies the stored message and supplies a bounded history window.
Deployment, the role assignment and a live check of the factory tools are P4-08.

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
