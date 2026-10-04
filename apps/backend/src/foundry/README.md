# Foundry backend client

`client.ts` ports the prototype driver's Invocations contract. It has no runtime package dependency and uses Node 22's native fetch. Construction requires two explicit HTTPS project endpoints for the same account/project:

- `runtimeEndpoint`: `https://<account>.cognitiveservices.azure.com/api/projects/<project>`
- `adminEndpoint`: `https://<account>.services.ai.azure.com/api/projects/<project>`
- `agentName`: deployed runner name; `apiVersion` defaults to `v1`.
- `getToken(scope, signal)`: the backend's identity provider, returning the bearer token for `https://ai.azure.com/.default`. An Azure `TokenCredential` adapter can call `credential.getToken(scope, { abortSignal: signal })` and return its `token`. Credential caching and tenant/identity selection belong to that provider. This module never shells out to Azure CLI or stores credentials.

`startTask({ agent, task, model, reasoning? })` returns the accepted invocation and session IDs. `model` is the effective task model; the runner currently supplies reasoning only for Codex. The caller resolves a task override before the corresponding settings default; that dispatcher integration is P2-05. This client validates and forwards the already-resolved values. `steer(sessionId, agent, message)`, `pause(sessionId)` and `resume(sessionId, { agent, task, model, reasoning? })` reuse the session through `agent_session_id`. The runner retains the original settings for resumed turns. Steering and pause ask the runner to cancel the current ACP turn. Pause reports `pausing` or `idle`; it does not assert that the running turn has stopped. The owner observes the original invocation before resuming.
`startTask({ agent, task, model, reasoning? })` and `startCodexRenewal()` return the accepted invocation and session IDs. Renewal uses the runner's `mode=renew-codex` contract with a three-day threshold. `model` is the effective task model; the runner currently supplies reasoning only for Codex. The caller resolves a task override before the corresponding settings default; that dispatcher integration is P2-05. This client validates and forwards the already-resolved values. `steer(sessionId, agent, message)`, `pause(sessionId)` and `resume(sessionId, { agent, task, model, reasoning? })` reuse the session through `agent_session_id`. The runner retains the original settings for resumed turns. Steering and pause ask the runner to cancel the current ACP turn. Pause reports `pausing` or `idle`; it does not assert that the running turn has stopped. The owner observes the original invocation before resuming.

`cancel(invocationId)` cancels an invocation, `status(invocationId)` returns its status/timestamps/events/result/error, and `deleteSession(sessionId)` explicitly closes the session. `checkAdministration()` checks project connections and the named agent's versions on the administration host, creating no session. All calls accept an optional `{ signal }`.

Each HTTP call has a 30-second default deadline covering authentication, fetch and response consumption, and a 1 MiB response limit. Configurable ceilings are 120 seconds and 16 MiB. Task and steering text are limited to 65,536 characters. Redirects are refused. Invalid response shapes fail closed. `FoundryClientError` exposes a controlled operation, kind and optional HTTP status code; it excludes raw provider bodies, URLs and credentials.

There are no retries in this client. The dispatcher owns retry policy and session lifetime; the renewal job owns bounded status polling and its SQL lease; the heartbeat polls registered active invocations immediately and about once a minute, updating `last_heartbeat_at` on a valid status response. The first HTTP 404, 424 or 5xx response gets a confirming poll after 30 seconds; a second qualifying response marks the sandbox crashed and the task NeedsAttention. Event gaps do not affect the rule. A timed-out create/control request may already have reached Foundry, so its owner must reconcile rather than resend blindly. Provider `completed` is not proof of delivery: the branch and PR still need GitHub evidence. Resume is for a clean pause/idle shutdown; crash recovery starts a new session from the task branch.

The session owner calls `deleteSession` after delivery or cancellation and cleans probe sessions in `finally`. This client deliberately does not delete a paused session, so its files and conversation can survive idle shutdown.

## Offline verification

From the repository root, after `npm ci`:

```sh
npm run build --workspace @jarvis/backend
npx --no-install eslint --config apps/backend/src/foundry/lint.config.mjs apps/backend/src/foundry --max-warnings 0
npx --no-install vitest run --config apps/backend/src/foundry/vitest.config.mts
```

The backend production compiler excludes the contract tests and their standalone config. The dedicated Foundry contract CI workflow runs the build and these tests independently of the server skeleton. The backend test suite also includes `*.test.mts`, so root `npm test` checks the Foundry contract alongside the server tests.

## Recording provenance

`fixtures/runner-responses.json` contains actual responses recorded offline from the production runner handlers added by #28, source commit `cb5b713`. The capture uses fixed time and IDs and stubs external ACP execution. Start, running/completed/cancelled status, resume, steer, both pause acknowledgements, cancellation and missing-invocation responses come from those handlers. The JSON is kept as captured, including field names, nulls, result and event structure.

`fixtures/capture_runner.py` reproduces the recording after `runner/` and its Python environment are available. It imports the actual runner module, disables telemetry export, and executes handlers without Azure or a CLI process:

```sh
runner/.venv/bin/python apps/backend/src/foundry/fixtures/capture_runner.py runner /tmp/jarvis-runner-captured-responses.json
```

These are runner response recordings, not Azure runtime envelope captures. DELETE acknowledgements and administration list envelopes use synthetic fixtures. HTTP 424/404 after a crash and healthy status during an event gap replay the statuses observed in the preserved [restart report](../../../../docs/reference/coding-sandbox-prototype/RESTART-REPORT.md); the original Azure error bodies were not retained. Additional malformed-body, timeout, cancellation and response-size cases are deliberately synthetic. Live Azure routing, authorization, response envelopes and end-to-end ACP behavior remain unverified until deployment and task-control validation.
