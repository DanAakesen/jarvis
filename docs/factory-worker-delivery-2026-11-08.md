# 128 GiB Factory workspace delivery — 8 November 2026

[Provisioning run 42530882044](https://github.com/DanAakesen/jarvis/actions/runs/42530882044)
succeeded. Evidence artifact 13637845540 records activated=true,
credentialsAccessible=true, idleDeallocationVerified=true and backendReadyVerified=true.

| Verified item | Result |
| --- | --- |
| Managed workspace disk | 128 GiB Standard SSD |
| Mounted filesystem capacity | 134145380352 bytes (124.93 GiB) |
| Free space at qualification | 132754182144 bytes (123.64 GiB) |
| Credentials | Codex and Copilot secrets accessible; not a provider execution test |
| Idle state | Actual Azure VM deallocation verified |
| Backend | Worker routing activated and latest revision ready |

The VM stops compute billing while deallocated. Workspace disk, OS disk and
outbound IP remain allocated. The separate backend Container App remains running.

## Owner clarification — 9 November 2026

Existing tasks are tests and do not need migration or recovery. Task 23 recovery
is no longer a required acceptance step. A fresh representative Factory task can
verify delivery on the worker. The recovery prompt below is retained as historical
reference only; no existing tasks were deleted or replayed.

Retiring the old Foundry runner is a separate follow-up: `FoundryClient` sends
`codex-tool` (web research, HTML reports, images) and `renew-codex` to Foundry
because `FactoryWorkerMailbox` only intercepts new `start` operations and IDs
owned by the VM. `runner/worker.py` also does not accept those operation names.
The shared runner already implements the underlying modes; routing, scheduling,
status/cancel/cleanup and live acceptance still need adaptation. This is migrating
functions that will be used again, not transferring old task data.

## Earlier end-to-end acceptance proposal (superseded)

The saved Task 23 branch remains jarvis/task-23 at
3ace0ad86092026e99a52f5f791c9fdb376afcc1, with no delivery PR at the latest check.
No failed task was automatically replayed by this deployment. Use owner-authenticated
Jarvis chat or Factory task controls to recover the existing task; the deployment
identity is smoke-only and must not impersonate the owner.

Suggested prompt:

> Check existing Factory task 23 for the Windows widget in Jarvis. If it is stopped and recoverable, recover that same task from its saved branch using the new worker. Do not create another task or issue. If already running, report its progress. Verify the final result and link its delivery PR; explain any remaining failure.

After that action, verify wake-up, streamed progress, continued work on the existing
branch, completed checks and delivery PR, then idle deallocation. Workspace delivery
is complete; task completion and this end-to-end check are not yet claimed.
