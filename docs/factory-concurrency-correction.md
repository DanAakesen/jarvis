# Factory concurrency correction — 9 November 2026

The Factory must support up to **100 simultaneously executing coding agents**.
Workers start on demand, have isolated workspaces with the selected 128 GiB
capacity target per worker, and release compute when idle. Preserve owner-set
global/project limits, task ownership, progress, steering, cancellation, recovery
and repository-scoped credentials. Managed infrastructure is preferred.

## Confirmed regression

- PRODUCT.md already specifies global concurrency from 1 to 100.
- `apps/backend/src/factory/worker-mailbox.ts` intercepts every new `start` when
  enabled, wakes one configured VM and reads one shared `health.json`.
- `runner/worker.py` defers `start` and `resume` while any task is active. This is
  single-worker execution even if the dispatcher admits multiple tasks.
- Provisioning run 42530882044 qualified one 128 GiB data disk, credentials, idle
  deallocation and backend readiness. It did not qualify concurrent Factory tasks.
- Removing the worker guard cannot turn a two-vCPU host into 100 isolated workers.
  Multiple consumers sharing today's mailbox/health/filesystem are not a safe fleet.

## Managed candidate to qualify

Microsoft's documentation, checked 9 November 2026, describes **Azure Container
Apps Sandboxes** separately from apps, jobs, dynamic sessions and Foundry Hosted
Agents. Sandboxes have independent lifecycle and persistent state; Microsoft
operates the underlying compute clusters. The documented 2XL tier has 8 CPUs,
16 GiB memory and 160 GiB disk. Data Disk volumes provide another storage option,
but the compatible sizing, mount API and cost still need verification. Do not
assume 128 GiB can be independently selected at the old 2-CPU price.

The documented sandbox-group Bicep resource supports a maximum sandbox count.
That count is a resource cap, not an automatic Factory dispatcher or evidence that
the subscription can run 100 agents. Regional/service quotas and Codex/Copilot
provider concurrency remain separate. The sandbox service currently documents no
availability SLA; evaluate that alongside disk, performance and cost.

Sources:

- [Sandbox overview and resource tiers](https://learn.microsoft.com/en-us/azure/container-apps/sandboxes-overview)
- [Sandbox group Bicep configuration](https://learn.microsoft.com/en-us/azure/container-apps/sandboxes-quickstart-bicep)
- [Cluster ownership and reliability](https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps-sandboxes)
- [Container Apps quotas](https://learn.microsoft.com/en-us/azure/container-apps/quotas)
- [Sandbox-specific quotas and read-only usage API](https://sandboxes.azure.com/docs/sandboxes/limits)
- [Sandbox regions, including Sweden Central](https://sandboxes.azure.com/docs/sandboxes/regions)

The sandbox-specific quota page lists a 300-core default, while the general
Container Apps page gives a different broader limit. Neither establishes this
subscription's entitlement: inspect its actual sandbox quota. At the documented
8-core tier, 100 workers need 800 active cores; a smaller tier with a separately
mounted workspace could change that sizing, but is not qualified yet.

This is the first managed candidate to investigate, not an adopted or deployed
replacement. Container Apps Jobs with Azure Files remains an alternative requiring
filesystem/performance qualification. Neither candidate may silently route all
work back through a single host. Keep the current custom chat harness in Foundry;
the parked Copilot-harness migration is unrelated.

## Qualification and implementation

1. Read the subscription's Microsoft.App catalogue for sandboxGroups, API versions
   and Sweden Central availability. Read the regional Sandbox quota using the
   documented `Microsoft.App/locations/swedencentral/usages` GET; absent or invalid
   counters remain unknown. Check actual group access separately. The
   main-only `Factory managed capacity inspection` workflow performs GETs only and
   retains `factory-capacity.json`; it does not allocate resources, register
   providers, grant roles, change quota or run model inference. Missing/failed
   reads remain unknown, not zero capacity or proof the service does not exist.
2. Qualify one sandbox: supported image import, credentials scoped to the task,
   actual usable workspace, Git checkout, dependency restore, build, progress and
   pause/resume. Measure startup, disk throughput and cost. Provision no 100-worker
   fleet merely to test catalogue availability.
3. Implement one independently addressed execution environment per admitted task.
   Persist worker/session assignment; route status, events, steering and cancel to
   that worker. Use durable, fenced task claims and idempotent environment creation.
   A failed host must not interrupt another worker or replay an uncertain write.
   Keep credentials, workspaces, health and lifecycle separate between workers.
4. Match capacity requests to owner-approved demand, up to the configured 100-agent
   ceiling; retain project-level limits. Stop/suspend each idle worker independently.
   Expose startup, quota/provider throttling and queue status honestly. Infrastructure
   quota and provider limits must be checked before claiming the target is available.
5. The owner explicitly caps live qualification at **five concurrent workers**.
   Validate five overlapping workers, isolation, cancellation and scale-down.
   The production design remains capable of 100; do not run a 100-worker load test.
   Synthetic process concurrency is not proof of simultaneous model sessions.
6. Switch Factory after managed storage, concurrency and task-lifecycle acceptance.
   Then remove the VM, dedicated disks/network/roles and VM-specific code/config.
   This retirement is owner-authorized; existing test tasks need no migration.
   Preserve the backend Container App and Foundry custom chat/voice. Separate
   Foundry research/image/login operations are not VM resources.

## Current status

- 128 GiB VM storage: provisioned and measured.
- Concurrent execution through that VM route: one active coding task.
- Managed replacement: authorized. Group/identity Bicep and a main-only, fixed-five
  qualification workflow are implemented; provisioning and task routing are pending.
- Read-only availability inspection: passed in
  [run 42580034945](https://github.com/DanAakesen/jarvis/actions/runs/42580034945)
  at 08:33 Copenhagen on 9 November. Microsoft.App is registered; sandboxGroups
  lists Sweden Central and stable API 2026-07-01. The resource group currently has
  no sandbox groups. Regional SandboxCores quota is 300, usage 0. This is enough
  CPU quota for 100 workers at 2 cores each, but does not prove resource placement,
  a 128 GiB volume at that size, build performance or provider concurrency.
- 100-agent capacity: required; neither deployed nor demonstrated.

PR #1670 merged as 1d9f3074 after full CI 42579005933 and CodeQL 42579005892.
All 13 inspection tests and 15 pipeline-impact tests passed locally. The full
local pipeline suite encountered 15 missing-Ruby errors; the equipped CI runner
subsequently passed the complete checks. Local check:
`python -m unittest discover -s .github/scripts/tests -p test_inspect_factory_capacity.py -v`.

## Managed sandbox qualification implementation

`infra/factory-sandboxes.bicep` creates a group with a 1,000 retained-sandbox cap, a dedicated
registry/secret identity and group-scoped management access for backend/deploy.
SQL admission retains its separately configurable limit of up to 100 active tasks; stopped sessions do not consume
active core quota. The larger resource cap leaves room for retained sessions and
allocates no workers. Stopped bindings skip repeated sandbox API polling until
new work or deletion arrives. `Factory managed sandboxes` imports the
immutable qualified .NET image and creates at most five sandboxes, each with a
128 GiB DataDisk, 2 vCPUs and 4 GiB memory. It checks mounted capacity, POSIX
operations, Git, .NET restore/build, five-way execution overlap, credential access
and disk persistence across stop/resume. Sanitized evidence is retained. Cleanup
uses this run’s labels only, including reconciling ambiguous creates. This workflow
does not switch production routing or delete the VM. Those steps follow separate
Factory integration acceptance. No 100-worker or model concurrency claim follows
from this synthetic qualification.

The runtime qualification in `factory-runtime.yml` builds the exact runner source
and invokes the production TypeScript pool against a disposable Entra-only Blob
account. Five deliberately invalid task requests prove delivery/refusal without
model calls or repository writes, followed by actual worker disk/credential probes,
five overlapping shell commands, adapter restart, idle stop and resume. It is a
transport/lifecycle test, not a claim that five model tasks completed or that SQL
admission ran against production tasks. CI covers the existing SQL ownership and
admission contracts. The temporary storage role is scoped to that test account;
workers still receive only their individual container SAS. Account removal follows
confirmed cleanup of the five owned sandboxes and volumes.

## Private image import and acceptance receipts

Run 42589074806 confirmed group data-plane access, then failed with HTTP 401 at
private image import. The import path now uses `az acr login --expose-token`
under the existing deployment identity, restricted to a digest-pinned Jarvis
runner image. The short-lived credential is passed only to Azure's image import;
it is never written to an artifact or worker. Registry admin login remains off.
Runtime vault access still uses the sandbox group's managed identity.

Cutover requires the exact current accepted release receipt. A backend image
reused by that release is valid only with its preserved image/revision provenance;
a receipt for another source is rejected. VM role cleanup is scoped to rg-jarvis
and includes the backend's obsolete VM wake grant, preserving its shared access.
Failed image preparation releases the disposable storage before workers exist;
failed worker cleanup retains the storage and bounded failure diagnostics.

## Idle handoff and current qualification failure

A managed worker publishes idle and exits its command loop after 120 idle seconds.
The controller can then stop it even when another turn was queued after its final
queue read. That turn remains durable and resumes the same sandbox on the next
reconciliation. A new consumer clears the old idle heartbeat before boot; SAS
rotation of a live consumer keeps its heartbeat. This closes a shutdown/claim
race without holding an allocation lease while the user submits work.

Run 42592487832 passed image import and failed at volume creation (HTTP 400),
with no qualified workers and cleanup complete. Qualification now reads safe
problem-details codes and numeric size facts, and waits for deletion tombstones
before reporting cleanup complete. The exact storage constraint remains under
investigation. Five-way execution, Factory activation and VM retirement have
not passed. The later normal deploy failed legacy configuration validation before
applying infrastructure; ARM boolean and resource-ID casing are normalized, with
other identities and invalid flags still rejected.
