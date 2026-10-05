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
| `chat_runtime.py`, `chat_telemetry.py` | Verified chat history, incremental SSE and content-free stage timings |

## Backend tools

Before acknowledging a new hosted voice session, the agent loads its effective Jarvis
model and reasoning effort from `GET /agent/settings`. It keeps that snapshot for
the session, so later settings changes affect only new sessions. If the settings
cannot be loaded, it logs a warning and uses the defaults (`gpt-5.6-luna`,
reasoning `none`) for that session.

Each turn loads `GET /tools` from `JARVIS_BACKEND_URL` (cached 60 seconds) and
fetches `GET /factory/context` before calling the model. The context contains up
to 20 running tasks and their three most recent events; the agent's in-session
message history is bounded to 12 messages / 24,000 characters. A model tool call
goes to `POST /tools/{name}` with the arguments and `X-Jarvis-Message-ID`, and the
backend result goes back to the model unchanged. The agent authenticates with its
platform identity (`DefaultAzureCredential`, scope `api://<jarvis-api>/.default`).
The backend accepts that token only with the `Jarvis.Tools` role and only on
agent-enabled routes: the tools, the turn context and the limited Jarvis-settings
read.

Only `outcome: "ok"` counts as done. Every failure becomes `outcome: "error"` and
says whether nothing was done (the request never left the agent) or, after a
timeout or a connection lost after sending, that the action may have happened. These failures cover unknown tools, bad arguments, refused identity,
unavailable persistence and an unreachable backend. If the catalogue cannot be
loaded, the turn fails before the model is asked.
If the context snapshot cannot be loaded, the turn also fails before the model
call rather than answering with missing or stale task status.

The chat handler is registered with Foundry's `invocations` protocol, not as a
custom `/chat` route. It accepts an application payload containing the delegated
user authorization, stored source-message ID, text and language. Before starting
a turn it checks `/me` and the exact stored source message, then sets that ID in
the per-turn `current_message_id` context used for every backend tool call.
`create_app` accepts a `chat_context_loader`; the default loader verifies the
stored message and supplies a bounded history window. The backend authenticates
to Foundry with its managed identity; the delegated user token remains in the
server-to-agent payload and is never sent to the browser or logged.

Chat loads current settings, catalogue and live context concurrently after
authorization; settings/context are not cached. The catalogue cache is shared
by turns in the same container for 60 seconds. Memory search and backend
embeddings are on-demand tools, not chat preparation. Responses text deltas are
forwarded immediately, with an initial SSE comment to flush the stream; cancelling
chat closes the model stream and joins outstanding preparation reads.
`chat.latency` logs/spans include stage durations and outcomes, never content or
exception messages. See [P7-23 evidence](../../docs/decisions.md#p7-23-latency-evidence)
for the outstanding deployed acceptance check.

## Commands

Setup: `bash scripts/setup-dependencies.sh` from the repository root creates
`agents/jarvis/.venv` from the hash-locked `requirements-dev.txt`.

```sh
agents/jarvis/.venv/bin/python -m ruff check agents/jarvis
agents/jarvis/.venv/bin/python -m pytest agents/jarvis/tests -q
docker build --tag jarvis-agent:local .
docker run --rm --publish 8088:8088 \
  --env FOUNDRY_PROJECT_ENDPOINT=https://<host>/api/projects/<name> \
  --env AZURE_AI_MODEL_DEPLOYMENT_NAME=<deployment> \
  --env JARVIS_BACKEND_URL=https://<backend> jarvis-agent:local
.venv/bin/python scripts/smoke_test.py   # model-free /help turn
```

Configuration and lock regeneration are in
[agent-context.md](../../docs/agent-context.md#jarvis-agent).
