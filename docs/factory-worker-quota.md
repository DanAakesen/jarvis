# Archived VM worker quota history

The single-VM route is superseded by the managed Factory design. Its provisioning
and quota automation are removed in the VM-retirement change; use the
[managed sandbox runbook](factory-concurrency-correction.md) for current work.
Actual managed acceptance and resource retirement are tracked there and in PLAN.md.

Historical run [42530882044](https://github.com/DanAakesen/jarvis/actions/runs/42530882044)
provisioned the 128 GiB VM and verified its mounted disk, credential access,
idle deallocation and backend readiness. See the
[dated delivery evidence](factory-worker-delivery-2026-11-08.md).
This established one worker, not an automatically scaling fleet.

The earlier VM prerequisite work registered Microsoft.Compute/Microsoft.Network
and granted subscription quota access. Those shared subscription registrations and
permissions are not dedicated VM resources and are not removed with this worker.
Managed sandboxes use Microsoft.App SandboxCores capacity instead of a VM-family
quota. No old task migration is required; the owner identified them as test tasks.
