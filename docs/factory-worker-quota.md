# Factory worker quota and provisioning

The approved 128 GiB workspace is **provisioned and activated**. Run
[42530882044](https://github.com/DanAakesen/jarvis/actions/runs/42530882044)
verified the disk, credential access, actual idle deallocation and backend readiness.
See [delivery evidence and remaining checks](factory-worker-delivery-2026-11-08.md).

## Prerequisites for a new subscription

- Assign Quota Request Operator to jarvis-github-deploy at subscription scope.
- Register Microsoft.Compute, Microsoft.Network and Microsoft.Quota. The worker
  also uses existing ManagedIdentity, ContainerRegistry, Storage, KeyVault and
  Authorization resources. Quota permissions do not imply provider-registration permissions.
- The approved size is Standard_D2as_v5 in Sweden Central: 2 vCPUs, 8 GiB RAM,
  a 128 GiB Standard SSD data disk and a 64 GiB OS disk.
- Before initial allocation, confirm two available family and regional vCPUs.
  Read-only run 42530362925 verified family usage 0 / limit 2 and regional usage
  0 / limit 12 before the successful worker allocation. These are pre-allocation
  values, not a claim that two additional CPUs remain available now.

## Quota inspection and initial request

The main-only worker-quota.yml workflow defaults to read-only. submit=true requests
only the headroom calculated for the approved initial worker. Do not rerun that
mutation for an already allocated worker or treat unknown usage as zero. An approved
limit is not proof of a functioning workspace. A submitted request is not approval.

Provider registration initially produced empty catalogues and unavailable usage.
The corrected client resolves only the approved resource names using Azure's
catalogue, accepts exact integral JSON counts, rejects unknown/fractional counts,
and retains bounded numeric diagnostics without arbitrary provider bodies or secrets.
Earlier failures and the user's quota approval are recorded in docs/decisions.md.
The final successful quota read supersedes the transient usage failures; their
precise raw values were not established.

## Provisioning and updates

Use the existing Runner deploy workflow on qualified main. A provisioning-only
retry may reuse a qualified image only when its build-context equivalence check
passes. Provisioning checks the mounted disk and both credentials, waits for actual
VM deallocation, then enables backend routing and verifies a ready revision.
Do not rerun provisioning against an active worker: drain work and disable new
routing before an intentional image update. No such update is needed after this delivery.

Data disk, OS disk and outbound IP remain billed while the VM is deallocated.
The backend Container App does not shut down with the worker. One worker is
implemented; automatic fleet scaling is not yet implemented.

References: [quota prerequisites](https://learn.microsoft.com/en-us/rest/api/quota/),
[quota request contract](https://learn.microsoft.com/en-us/rest/api/quota/quota/create-or-update?view=rest-quota-2025-09-01).
