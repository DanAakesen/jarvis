# Factory worker quota request

Dan authorized requesting the quota increase on 8 November 2026. The approved
worker remains Standard_D2as_v5 in Sweden Central, with a 128 GiB workspace. This
operation supplies two free standard vCPUs; it does not allocate a VM, change its
size/region, or grant Azure roles.

The existing `jarvis-github-deploy` application has resource-group-scoped access.
A subscription administrator must give it **Quota Request Operator** at subscription
scope, and register `Microsoft.Quota`, before the API can submit requests. There
is no subscription-admin credential in the current Codex environment. This is an
access prerequisite; the owner's authorization to increase quota is already given.

After that access is available, run **Factory worker quota** from qualified `main`:

```sh
gh workflow run worker-quota.yml --repo DanAakesen/jarvis --ref main -f submit=true
```

The workflow first reads current usage/limits for `standardDASv5Family` and `cores`.
It requests `max(existing limit, current usage + 2)` only when capacity is missing.
After a family increase it rereads the regional quota, because Azure may raise it
automatically. It retains submitted/request status separately from verified
capacity, performs only bounded read polling, and never retries a PUT after an
unknown outcome. A pending/denied result must not be called provisioned. Inspect
the retained status URL and Azure request before a manual resubmission.

The `factory-worker-quota` artifact records limits/usage/status without access
tokens or provider response bodies. Once both readbacks show at least two free
vCPUs, use the existing Runner deploy provisioning path, verify real disk capacity
and idle deallocation, then recover saved task 23. Do not create a duplicate task.

PR #1649 passed full CI 42502476758 and merged as `b6b515d9`. The authorized
live attempt [42503224623](https://github.com/DanAakesen/jarvis/actions/runs/42503224623)
failed during quota inspection with `Quota API HTTP 403: AuthorizationFailed`.
No quota request was submitted and no capacity was changed. Artifact 13625869545
retains the sanitized result, SHA256
`3dedf9ac7c88aa3955fa16b7afce24fd7dd17968644b87b30642fa046badf076`.

To supply the missing access, a subscription administrator can open Azure Portal
→ Subscriptions → the Jarvis subscription → Access control (IAM) → Add role
assignment, select **Quota Request Operator**, and select the service principal
**jarvis-github-deploy**. Once the role is effective, rerun the existing workflow;
the failed attempt made no write to reconcile. Provider registration remains a
prerequisite if it has not already been done.

References: [quota API prerequisites](https://learn.microsoft.com/en-us/rest/api/quota/),
[request contract](https://learn.microsoft.com/en-us/rest/api/quota/quota/create-or-update?view=rest-quota-2025-09-01),
[family and regional quotas](https://learn.microsoft.com/en-us/azure/quotas/per-vm-quota-requests).


### 8 November: subscription access corrected

The owner corrected the Quota Request Operator assignment from resource-group to subscription scope. Live run 42523978403 passed the previous authorization boundary but returned HTTP 400 InvalidResourceName before any quota write. The client now discovers canonical quota resource names from Azure’s catalogue, matches only the two approved resources case-insensitively, and uses returned casing for reads/writes. Missing/ambiguous resources stop without a write; catalogue pagination is bounded and confined to the same scope. Live retry and 128 GiB provisioning remain pending.


### 8 November — live quota follow-up

GitHub authentication is working again. Provisioning run 42525578592 reached Azure but failed with InvalidTemplateDeployment / QuotaExceeded; worker routing remains inactive. Quota run 42524952522 failed before writes because an approved resource was absent from its catalogue. The quota diagnostic now retains validated catalogue names, the missing requested name, and only the two approved Compute usage/limit records. This read-only evidence is needed to distinguish catalogue coverage from actual capacity; no resource allocation or quota write is added.


## Latest live evidence: 8 November, 21:44 UTC

- GitHub authentication works again; provisioning dispatch succeeded. Do not carry the earlier expired-token blocker forward.
- Runner deploy 42525578592 reached Azure and failed InvalidTemplateDeployment / QuotaExceeded. Activation remains false; no completed 128 GiB workspace is claimed.
- Read-only quota run 42526613341 reports the missing requested resource as standardDASv5Family. Its quota catalogue contains zero entries, and the filtered Compute usage result is empty. This is not evidence of a numerical zero quota or approved capacity. No quota write was submitted.
- Provider registration/region availability remains unverified. The owner was asked to check Microsoft.Compute and Microsoft.Quota under subscription Resource providers and register either if NotRegistered. Do not assert registration is the cause until verified.
- Both code changes (#1660 and #1661) passed full CI and CodeQL; the diagnostic retains only validated resource names and approved usage/limit fields.


### 8 November — Compute registered, quota response handling

The owner registered Microsoft.Compute (Microsoft.Quota was already registered). Run 42527062741 now fails local quota response validation rather than the prior missing catalogue error; direct provisioning 42527158192 still returns QuotaExceeded. Treat integral JSON numeric values as integer counts, preserve rejection of fractions/booleans/unknowns, and resolve approved resource names using properties.name.value as documented by Azure. Ignore unrelated catalogue rows rather than allowing their metadata shape to abort the approved lookup. The precise triggering response field remains unverified; no quota submission or provisioning success is claimed.


### 8 November — quota usage value investigation

Run 42529215408 resolves both approved resource names but fails at usage_decode with ValueError before writes. Retain only numeric counter values/types (including negative sentinels) from the two approved quota resources; arbitrary provider text and structured bodies are excluded. The unknown usage remains rejected rather than assumed zero. This is diagnostic evidence only, not a quota increase or workspace activation.


## Approved quota and provider prerequisite (8 November)

The owner registered Microsoft.Compute and obtained the DASv5 quota increase to 2 in Sweden Central. Read-only run 42530362925 verifies family usage 0 / limit 2 and regional usage 0 / limit 12, with ready=true. No additional regional quota request is needed. Earlier unknown usage/counter failures are superseded by this successful live read; do not claim a confirmed cause for those transient values.

Provisioning 42530295512 reached deployment but failed DeploymentFailed / MissingSubscriptionRegistration and did not activate routing. The owner was asked to check/register Microsoft.Network, which the template requires for its network, NSG, NIC and outbound IP. The retained error does not name the missing provider, so confirm registration rather than treating that inference as proof.

Before first worker provisioning, verify subscription registration of Microsoft.Compute and Microsoft.Network, plus Microsoft.Quota for quota automation. The template also uses existing ManagedIdentity, ContainerRegistry, Storage and KeyVault providers and Authorization role assignments. Quota authorization is separate from provider-registration permissions. Registration and quota approval do not themselves prove a working 128 GiB workspace.
