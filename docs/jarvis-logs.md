# Whole-Jarvis diagnostic log access (#1341)

Owner-confirmed scope on 29 October 2026 replaces backend-only access: read-only
logs belonging to Jarvis's backend, hosted AI agents, coding runners, deployments
and supporting services, excluding unrelated projects. Retain the existing
Foundry Reader assignment. No removal was approved or performed. The earlier
backend-only permission approval does not authorize new whole-system grants.
The existing reader remains disabled. This document is the current design;
[backend-only implementation history](backend-logs.md) remains historical evidence.

## Source inventory and current access

| Source | Existing store/read path | Current reader evidence and gap |
| --- | --- | --- |
| Backend runtime | Container Apps console tables; backend manual traces in workspace-based Application Insights | Main preflight matched the backend identity/workspace. Its workspace console query returned 403. Existing chat reader is disabled. |
| Vault mirror and container platform | Same managed environment's console/system tables; mirror status blobs | Mirror has its own scoped identity for state/status writes and service credentials. Backend's workspace query access is not established. An environment-owned record is not automatically proof every app in that environment belongs to Jarvis. |
| Hosted chat/voice agents | Foundry project's Application Insights connection; content-free agent logs/spans and Foundry account resource diagnostics | Project identity has Monitoring Metrics Publisher for ingestion, which is not evidence of query access. Backend retains Foundry User/Cognitive Services roles and Reader on the account. Actual resource query was allowed; permission metadata was inconclusive. Table/data availability and source mapping still need verification. |
| Coding runners | Authenticated sandbox event publisher to backend task events; SQL and archived task-event blobs | Existing backend SQL/Blob access already serves task events. Runner process stdout/stderr is not proved durably complete by those events. Restrict model-visible diagnostics to Jarvis operational evidence; repository work payloads need an explicit safe-output policy. |
| CI and deployment | Jarvis repository Actions logs; bounded failed-check logs copied to private Blob logs container; fixed release evidence | Existing backend GitHub App token path requests repository-scoped Actions read; existing backend Blob Data Contributor permits retained log access. The failed-check path bounds and escapes excerpts but is not a general secret-redaction contract. Reuse authentication; do not expose raw buffers through the new reader. |
| SQL, storage, Key Vault, registry and web platform | Existing backend operation diagnostics and any resource diagnostics already routed to the workspace | Source configuration does not declare dedicated diagnostic settings for these services. Verify actual collection; a read grant cannot recover logs never collected. Existing SQL/Blob/Key Vault/registry application permissions do not establish Azure Monitor log-query permission. |
| Browser and local companion | Current browser console/local process diagnostics | No centralized browser-log export was found in the current web code. Do not claim cloud coverage or collect device files without a separate supported path and authorization. |

The shared Log Analytics workspace is configured with 30-day retention. Its
contents are not assumed entirely Jarvis-owned. Source tags alone are insufficient:
match an exact server-owned infrastructure resource ID and an ownership tag, then
verify the table's resource identifier and actual routing before including records.
Unknown resources, missing identifiers and unverified historical/deleted resources
remain excluded with honest coverage gaps. Existing retention is unchanged.

## Independent metadata implementation

`backend_log_sources.py` classifies metadata from the existing resource-group
resource list and workspace table list. It admits only twelve exact canonical
resources from current infrastructure naming: backend, container environment,
vault mirror, Application Insights, Foundry account, storage, Key Vault, registry,
SQL server/database, web app and workspace. A matching project tag is also required.
A tagged unrelated resource is never admitted. Known log tables are described only
by plan and presence of a string `_ResourceId`; no log rows are read or retained.

The existing main-only preflight stores this planning catalogue only in its private
mode-0600 report. Public output contains fixed inventory/planning labels. It keeps
workspace-wide ownership, routing, historical ownership and provider enforcement
unverified. It applies no grant and changes no reader availability. The existing
90-second total and 30-second per-call limits remain; the metadata call cap rises
from 24 to 32 solely to accommodate the two bounded, paginated lists. Four-page,
1,000-row and 2-MiB per-response limits remain. Inventory denial is incomplete,
never a reason to request broader discovery access.

## Proposed persistent grant for parent review

Propose one new built-in **Log Analytics Data Reader** assignment to the existing,
live-verified backend managed identity at the existing verified workspace only:

- Actions: `Microsoft.OperationalInsights/workspaces/query/read` and
  `Microsoft.OperationalInsights/workspaces/read`.
- DataAction: `Microsoft.OperationalInsights/workspaces/tables/data/read`.
- Condition version 2.0: data reads require both a fixed approved table and an
  exact `_ResourceId` in the privately verified finite Jarvis resource manifest.
  Control-plane query/workspace reads pass through; no unconditional data read.
- Candidate tables: verified Analytics tables among Container App console/system
  legacy and current names, AppTraces, AppRequests, AppDependencies, AppExceptions,
  AppEvents, AppMetrics, AzureDiagnostics and AzureActivity. Missing/non-Analytics
  tables and tables without the necessary resource field are not silently admitted.

Bind approval to the exact private resource/table manifest and final condition;
this is a proposed grant, not authorization to apply it. In particular, official
ABAC documentation's value-character restrictions do not clearly establish support
for complete ARM resource-ID literals. Provider acceptance, condition readback and
populated positive/negative tests are required; failure leaves access disabled.
Never replace an unsupported condition with a workspace-wide role.

Retain the existing Foundry Reader and all other application roles. Reuse existing
repository-scoped GitHub Actions read and existing SQL/Blob access for task/log
records; propose no new GitHub, storage, directory, subscription, resource-group,
credential, retention or ingestion permission. Additional native deployment or
supporting-service access must be specified separately if existing evidence cannot
cover it. No new diagnostic setting or collection cost is part of this request.

## Runtime implementation and qualification

Replace/expand the existing log-reader entry into one sensitive authenticated read
capability, with matching main-agent availability instructions. Do not add a second
legacy/new capability. This metadata change does not implement that replacement.
Fixed source selection, time/row/byte/deadline limits and no arbitrary KQL/exec remain.
Use source-specific normalization and redaction before model exposure; logs remain
untrusted evidence and never authorize repairs. Keep raw inputs/results out of
sensitive tool audit persistence. Report source timestamps, ingestion delay, missing
collection, excluded records, partial failures and truncation per source.

The old requirement to deny vault-mirror/Foundry records belongs to the superseded
backend-only scope; these are now positive Jarvis controls. Prove exclusion using
actual unrelated-project resources/records and exact assignment scope instead.
Do not silently claim an absent foreign-workspace control passed. Final whole-scope
qualification must be reviewed and approved, with real populated controls and
fresh-process tests after any grant. Synthetic checks are not Azure proof.

Sources: [resource-context access](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/manage-access),
[granular RBAC](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/granular-rbac-log-analytics),
[diagnostic collection](https://learn.microsoft.com/en-us/azure/azure-monitor/data-collection/diagnostic-settings).
