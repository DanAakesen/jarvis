# Foundry sandbox restart during a coding turn

Experiment time: 2026-10-02 20:36-20:55 UTC. Target agent was the isolated
`jarvis-runner-restart`; `jarvis-runner` was not changed or used.

## Method used

1. **Version swap:** copied `jarvis-runner` v5 to `jarvis-runner-restart`,
   started a Copilot coding turn, then posted another version to
   `jarvis-runner-restart`. Result: **did not restart the running session**.
   The task completed and opened PR
   [#12](https://github.com/DanAakesen/jarvis-poc-target/pull/12).
2. **Guarded crash hook:** added runner mode `crash-test`, enabled only by
   `JARVIS_ALLOW_CRASH_TEST=1`; built image
   `jarvispocscacr.azurecr.io/jarvis-runner:runner-restart-20261002204134`
   (`sha256:d7ca522421c882f75472ca89f32a32db4a248b06f183822d7e3fbcfe780a31ad`),
   and deployed it only to `jarvis-runner-restart` v2. This forced a real
   process/container restart.

Unit test added: `test_crash_test_is_guarded`. Runner tests: **16 passed**.

## Timeline

| UTC time | Event | Caller/backend observation |
| --- | --- | --- |
| 20:36:21 | Version-swap task started | Invocation `inv_6c356bd5dfc0821800QLjB32Q8UkzILgZ0rPudU37kJiRW7SXK`, session `0481ffd495ed2b0500EAuaI8xUxX6hRYekA2YHEAitgA2GZcu4`. |
| 20:36:59 | New version posted to `jarvis-runner-restart` during sleep | Version POST returned active by 20:37:09; invocation polls stayed HTTP 200 / `running`. |
| 20:37:10-20:40:45 | Healthy long shell sleep | Polls stayed HTTP 200 / `running`; event count stayed 30 and last event stayed 20:36:46. This proves "no events" alone is not a safe restart detector. |
| 20:41:00 | Version-swap task completed | HTTP 200 / `completed`; PR #12 opened. |
| 20:52:36 | Crash-test task started | Invocation `inv_69a2617c4ce6a72700o3aWO0DjwCwHYTVKaeRhgVD9qq9rJt1x`, session `0cd916cccccd4515007ZBmGHsdeVhDloWhzX7umyKtLBSHk7qu`. |
| 20:52:50 | Pre-crash progress confirmed | HTTP 200 / `running`, 25 events, ACP session present, marker commit observed. |
| 20:52:53 | `crash-test` POST sent on same session | Request timed out after 10 s; no HTTP response body. |
| 20:53:03 | First poll after crash | GET original invocation returned **HTTP 424 Failed Dependency**. |
| 20:54:14, 20:54:28 | Later polls | GET original invocation returned **HTTP 404 Not Found**. |
| 20:54:15 | App Insights | New `AgentServerHost starting`; same Foundry session id; trace says resilient tasks disabled. |
| 20:54:38 | Resume sent on same Foundry session | New invocation `inv_69a2617c4ce6a72700fyvJvr1hD35Sy74L5ZrhbIBeJE4eYa2d`. |
| 20:54:47 | Resume filesystem check | `/files/jarvis/<session>` existed, but contained only `.cache`, `.copilot`, `.git-credential-helper`, `acp-session.json`, `task-state.json`; no repo/marker worktree. |
| 20:55:10 | Resume invocation ended | Status `completed`, but no PR/branch existed and no code word was recalled. |

## Results by question

### 1. What the caller observes — **Pass**

Evidence:

- The crash trigger request timed out after 10 s.
- The original in-flight invocation then returned HTTP **424** once and HTTP
  **404** thereafter.
- App Insights excerpt for session
  `0cd916cccccd4515007ZBmGHsdeVhDloWhzX7umyKtLBSHk7qu`:
  - `20:52:48` GET original invocation: `200`
  - `20:54:15` `AgentServerHost starting`
  - `20:54:15` GET original invocation: `404`
  - platform trace: `TaskManager NOT initialized ... Durable tasks and crash recovery are inactive`

Detectability: within the next poll after the crash. In this run, that was
10 seconds for HTTP 424 and about 80 seconds for stable 404 after host restart.

### 2. Do `$HOME`, `/files`, and ACP conversation survive? — **Fail / partial**

- `$HOME` still pointed at `/files/jarvis/<session>` after restart.
- The session directory existed, but the working content did **not** survive:
  only runner metadata files were present; the repo/marker worktree was gone.
- ACP did **not** resume the prior conversation. The resume run logged a new
  `acp_session` (`dde036ee-2ebf-42f9-a59d-c227bef2ffb4`) and no
  `acp_session_loaded`; it could not recover the unwritten code word.

### 3. Does resume complete and push/open a PR? — **Fail**

Resume invocation
`inv_69a2617c4ce6a72700fyvJvr1hD35Sy74L5ZrhbIBeJE4eYa2d` returned
`completed`, but it did not push branch `restart-crash-20261002205236` and no
PR exists. This is a dangerous false-complete state after a crash.

### 4. Backend detection rule — **Pass**

Proposed rule:

> For a task already accepted and marked running, move it to **Needs attention**
> when polling `GET /protocols/invocations/{id}` returns HTTP 424, HTTP 404, or
> 5xx for two consecutive polls or for 30 seconds, whichever comes first. If
> the backend itself sent a control request and that request times out, mark
> Needs attention immediately after the next failed poll.

Do **not** use "no events for N seconds" by itself: a healthy `sleep 240`
coding turn produced a 4-minute event gap while remaining HTTP 200 / running.

## Problems hit

- Creating a new version of the same separate agent does not restart existing
  sessions.
- A process crash loses the in-flight invocation record and does not use the
  runner's persisted `task-state.json` for the platform invocation route.
- Foundry/agentserver traces explicitly report durable crash recovery disabled.
- Resume can return `completed` while doing no useful work; PR/branch existence
  must be verified before treating it as recovered.

## Root cause

The resume request was a normal task resume on the same Foundry session:
`agent=copilot`, `mode` omitted (therefore `task`), with the prompt beginning
`The sandbox crashed during the previous turn...`. The resume invocation
logged `acp_initialized(load_session=true)` at 20:54:41, then a new
`acp_session` (`dde036ee-2ebf-42f9-a59d-c227bef2ffb4`) at 20:54:42, and never
logged `acp_session_loaded`.

So the runner did not load an existing ACP session. The recorded evidence does
not include the pre-resume contents of `acp-session.json`; the later file
listing happened after the new `acp_session` event, so that file may have been
created or overwritten by the resume itself. Pre-crash polling saw
`hasAcpSession=true` and `commitSeen=true`, but it did not capture the cloned
repo path or directory timestamps. After restart, `/files/jarvis/<session>`
contained only `.cache`, `.copilot`, `.git-credential-helper`,
`acp-session.json`, and `task-state.json`; no repo/worktree was present.

Conclusion: the crash appears to have restored `/files` to a partial or earlier
state rather than continuously persisting every write. That is consistent with
persist-on-idle/deprovision behavior, but the exact persistence boundary is
unknown from this run.

## Cleanup

Deleted sessions:

- `0481ffd495ed2b0500EAuaI8xUxX6hRYekA2YHEAitgA2GZcu4` — HTTP 204
- `0e4779d4e2c1d6f100KkQrauUvbUxg8zYQKgIdK1XRwcX707v2` — HTTP 204
- `0cd916cccccd4515007ZBmGHsdeVhDloWhzX7umyKtLBSHk7qu` — HTTP 204

Deleted `jarvis-runner-restart` — HTTP 200:
`{"object":"agent.deleted","name":"jarvis-runner-restart","deleted":true}`.
