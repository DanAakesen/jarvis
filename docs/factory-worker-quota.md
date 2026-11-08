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
