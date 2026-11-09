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
5. Validate 2, then 10, then 100 overlapping workers using synthetic jobs, including
   duplicates, one crashed worker, cancellation and scale-down. Separately qualify
   simultaneous real Codex/Copilot execution under the actual account limits.
   Synthetic process concurrency is not proof of 100 simultaneous model sessions.
6. Switch new work only after storage and concurrency acceptance. Existing test
   tasks do not require migration. Migrate future research/image/credential-renewal
   functions before retiring the old runner. Retain a tested rollback route.

## Current status

- 128 GiB VM storage: provisioned and measured.
- Concurrent execution through that VM route: one active coding task.
- Managed replacement: documented candidate; integration not implemented.
- Read-only availability inspection: implemented; live observation pending.
- 100-agent capacity: required; neither deployed nor demonstrated.

Local check: `python -m unittest discover -s .github/scripts/tests -p test_inspect_factory_capacity.py -v`.
