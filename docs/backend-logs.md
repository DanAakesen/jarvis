## Superseded scope — 29 October 2026

The owner confirmed whole-Jarvis diagnostic log access, replacing backend-only
scope. Retain the Foundry Reader assignment; its removal proposal was stopped and
never applied. New expanded grants require exact approval. The existing tool is
still disabled. [Whole-Jarvis inventory and design](jarvis-logs.md) is current;
the backend-only restrictions and grant/qualification discussion below record
implementation history and do not define the new feature scope.

## Foundry resource-log correction — 29 October 2026

Deploy [40836577365](https://github.com/DanAakesen/jarvis/actions/runs/40836577365)
matched the backend identity and returned 403 for unfiltered console, other-app
and other-table queries. Foundry returned 400; the real foreign-workspace control
remained missing. Rollout/readiness passed, live chat/research acceptance failed.
No log grant or reader enablement occurred.

The prepared correction uses a fixed `AzureDiagnostics | ... | summarize Records=count()`
resource query, matching the [supported Cognitive Services log table](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-logs/microsoft-cognitiveservices-accounts-logs).
Only that request adds `Prefer: include-permissions=true`. The
[resource-query API](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/azure-resource-queries)
may filter inaccessible sources and return empty results or 4xx for absent data.
The backend validates bounded `permissions.resources` and `permissions.dataSources`
metadata, matching the expected resource and referenced data sources. It emits a
separate fixed `foundry_permissions` state: missing/invalid metadata, resource not
listed, no sources, sources not listed, an explicit resource/source table denial,
or `table_not_explicitly_denied`. The last state means only that a listed path has
no explicit denial for the queried table in this response. It is not an effective
access or isolation proof. HTTP status remains separate, even for error responses.
No metadata strings, identifiers, log rows, counts or provider text are exposed.
The existing five-request/eight-second/4-KiB bounds and per-process cache remain.

The ARM preflight additionally verifies the existing Foundry resource and reads
fully paginated `assignedTo` inventories for the backend principal at workspace,
Foundry and existing subscription scopes using API 2022-04-01. Microsoft documents
[transitive group assignments](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-list-rest)
for this filter. No Graph access or new permission is requested. A failed read,
page/call/time limit or malformed inventory marks that scope incomplete. Private
assignments and conditions remain in the existing mode-0600 report; pipeline
output contains only fixed scope/grant-review labels.

The existing resource Reader warning remains a blocker: in resource-or-workspace
mode, [resource-level read access bypasses workspace conditions](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/granular-rbac-log-analytics).
Do not change roles or workspace mode without separate specific approval. Do not
silently waive the real foreign-workspace control; any qualification change must
be reviewed and approved first. No new grant or activation is included here.

## Current qualification: metadata passed, grant still off — 29 October 2026

Deploy [40828872899](https://github.com/DanAakesen/jarvis/actions/runs/40828872899)
passed live identity/runtime/workspace/schema/built-in-role checks. Its fixed
verdicts include `access_mode_resource_or_workspace`,
`existing_resource_log_grant_requires_review` and
`negative_workspace_candidate_missing`. Bicep, backend, web, hosted agent 159 and
readiness passed. Live acceptance failed again with research down and chat
`error_badrequesterror`. No log assignment or reader activation occurred.

The next increment prepares actual backend-identity observations through the
existing authenticated `GET /status/smoke`, with one optional
`backendLogAuthorization` object. Same-job private metadata configures the fixed
workspace/app/principal and an actual foreign control if one exists. Metadata discovery first uses the resource group, then only existing
subscription-metadata access; a denial/unavailable inventory is explicit and no
permission is added. Missing controls remain missing; the reader flag stays off. The probe matches the token
principal before querying and returns only fixed verdicts for unfiltered console,
other-app, other-table, foreign-workspace and Foundry resource queries. All queries
aggregate counts in a fixed last-24-hour window; no log text or rows are exposed.
At most five requests share an eight-second deadline, each response is bounded to
4 KiB, redirects/retries are disabled and cancellation cleanup never blocks.

Azure's [resource-query API](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/azure-resource-queries)
can silently filter inaccessible data. Therefore `query_allowed` or
`no_visible_rows` is an observation, not a successful negative proof. Missing,
partial, malformed, denied and HTTP/transport failures remain distinct fixed
states. Responses are cached once per backend process and timestamped; repeat
freshly after any grant change. Baseline observations cannot establish the future
conditional grant's enforcement. Actual positive controls, readback and all
required post-grant isolation checks still precede activation.

Private report and Bicep parameter files are never uploaded. A strict pipeline
formatter emits only allowlisted verdicts and no identifiers/provider text.
This stage creates no grant/credential, new endpoint/tool/UI, retention change or
activation. The generic resource-grant warning still requires effective-access
review, and a real foreign-workspace control is still required.

## Live preflight blocker — ARM role classification, 28 October 2026

The first main execution after #1346, Deploy #40761349594, stopped at
`builtin_role_mismatch` before Bicep. Identity/runtime/workspace/schema checks
precede that role check; permission inventory and enforcement were not reached.
The verifier incorrectly used the CLI model's `properties.roleType` for a raw ARM
response. The [2022-04-01 REST contract](https://learn.microsoft.com/en-us/rest/api/authorization/role-definitions/get?view=rest-authorization-2022-04-01)
uses `properties.type`. The scoped correction keeps exact permission checks,
with ARM-shaped positive and CLI-only/custom-role negative regressions. Fifteen
synthetic tests pass; successful live rerun and subsequent grant/probes remain
pending. No new permission or reader activation has occurred.

## Current activation status — owner approval received, 28 October 2026

The owner approved persistent backend-only log reads plus basic workspace
metadata. The approved route uses built-in Log Analytics Data Reader with its
exact query/read, workspace/read and table-data/read permissions and a version-2
backend table/app condition at workspace scope. No custom role, additional
operator permission or new credential is needed. The original minimal custom-role
proposal below is historical and superseded for execution.

The follow-up installs a fixed metadata-only preflight in the existing qualified
main-only deployment path. It compares live MI/runtime IDs with the intended
repository target, resolves the workspace customer GUID, validates access mode,
console schema and exact built-in permissions, and reads assignment inventories
and possible foreign workspace controls. Obvious workspace/resource/group-access
concerns are surfaced, with group membership and provider enforcement explicitly
unverified. The private mode-0600 report stays in RUNNER_TEMP and is never uploaded;
public logs contain only fixed check names. It uses no data query or write.

This stage applies no grant and leaves the reader off. After that actual readback,
continue the already-approved conditional assignment, readback and positive/
negative backend-identity proof before enabling configuration. No new approval or
Azure sign-in is required for the existing scope. The preflight's successful
metadata collection is not activation eligibility, and a foreign workspace
candidate is not a negative-access proof. If no real negative target is visible,
report that blocker; do not substitute an invented workspace or broaden access.

Main chat now explicitly uses the log tool for configured self-diagnosis and
states that access is unavailable while disabled or unconfigured. Tool exposure
uses the same distinction; configuration never guarantees Azure permission or
that current data is present. Retained logs can lag minutes.

# Backend log reader

Issue [#1341](https://github.com/DanAakesen/jarvis/issues/1341), P11-42.
Implementation is prepared for review; production activation and Azure authorization
proof are pending. No new role, assignment, credential, access mode, retention,
ingestion route or infrastructure resource is applied by this change.

## Chat contract

`read_backend_logs` uses the existing owner/Jarvis-agent authenticated `/tools`
registry. It is classified `read` and `sensitive`: generic tool-call audits retain
outcome metadata and redacted argument/result placeholders. Phone execution and
deployment-smoke invocation are refused. It has no UI or repair action.

The default window is the last 15 minutes. Optional `start` and `end` must both be
UTC timestamps; each request covers at most 24 hours within the past 30 days.
Older retained periods can be inspected in separate windows. `limit` defaults to
50 and is bounded at 100. Workspace, app, table, endpoint, projection and KQL are
owned by the server; none is a caller argument. The tool never executes commands.

Each invocation has an eight-second total deadline including identity, response
headers and body, `Prefer: wait=5` at Azure, one active query per process, no
retries, a 2 MiB provider-response cap, a 16 KiB record cap and a 32 KiB serialized
result cap. One sentinel row detects row truncation. Cancellation propagates to
token acquisition and fetch; the caller is bounded even if a transport ignores it.

Only `ContainerAppConsoleLogs_CL` records with the exact configured
`ContainerAppName_s` are queried. All returned rows, including the sentinel, are
checked again; a cross-app row invalidates the whole result. Only recognized
structured `jarvis-backend` events are returned. `logging.ts` reapplies the
existing event/field allowlists, then keeps numeric/boolean diagnostics and
validated categorical strings. Arbitrary text, stack traces, request payloads,
headers, URLs, paths, tool/parameter names and identifiers are omitted. Unknown,
malformed, oversized and out-of-window records count as excluded and mark the
result partial. Existing ingestion/export privacy controls remain in place.

Results label records as `untrusted_evidence`. Both the tool description and
shared capability instructions prohibit treating logs as instructions or
approval. No log content can authorize a repair. This is an instruction/structured
output boundary with synthetic regression evidence, not a live model guarantee.

`queriedAt`, the requested window, event timestamps, ingestion timestamps/delay
when available, and the newest **returned** event's age are explicit. That age is
not a workspace ingestion watermark. Stored logs can lag minutes. `ok` with no
records does not prove health or an absence of errors. Exclusions, Azure
`PartialError`, row/byte truncation and unavailable/denied/throttled/timeout states
remain visible. Raw Azure error bodies never reach the model.

## Configuration, currently off

The tool is advertised but returns `unavailable` / `disabled` until explicitly
configured. The chat reader requests no token or query while disabled. Separately configured deployment-only authorization probes may run fixed aggregate observations while chat access remains off.

| Setting | Value after approval and verification |
| --- | --- |
| `JARVIS_BACKEND_LOGS_ENABLED` | `true` (absent/`false` stays off) |
| `JARVIS_BACKEND_LOGS_WORKSPACE_ID` | Existing workspace customer GUID, never its shared key |
| `JARVIS_BACKEND_LOGS_APP_NAME` | Existing `ca-jarvis-backend-<suffix>` app name from this deployment |

Enabled configuration fails startup for missing/invalid settings. The query uses
`https://api.loganalytics.azure.com/v1/workspaces/<GUID>/query` and the existing
backend managed identity through `DefaultAzureCredential`, requesting
`https://api.loganalytics.io/.default`. No new credential is required. These
settings are intentionally absent from Bicep/CI. Merging or deploying this code
alone leaves the reader disabled and does not grant log access.

The existing Bicep workspace has 30-day retention and legacy Container Apps Log
Analytics console ingestion. It is shared with vault-mirror, and the linked
Application Insights also serves Foundry. Workspace-wide or Application Insights
Reader access is therefore insufficient isolation. The query is defense in depth;
it is not a substitute for Azure authorization.

## Proposed persistent grant — unapplied, requires owner approval

Resolve and present actual resource/principal IDs at action time; do not guess
IDs or approve a grant against a placeholder. The intended principal is the
existing user-assigned managed identity `id-jarvis-backend` in `rg-jarvis`. Its
assignment scope must be only the existing `law-jarvis-<suffix>` workspace
resource ID from `infra/main.bicep`, not the resource group or subscription.

Proposed custom role (no wildcard, write, export or portal permissions):

```json
{
  "Actions": ["Microsoft.OperationalInsights/workspaces/query/read"],
  "NotActions": [],
  "DataActions": ["Microsoft.OperationalInsights/workspaces/tables/data/read"],
  "NotDataActions": []
}
```

Use condition version `2.0` on that workspace-scoped assignment. Replace the app
placeholder with the verified existing backend name; match it case-sensitively:

```text
(
  !(ActionMatches{'Microsoft.OperationalInsights/workspaces/tables/data/read'})
  OR
  (
    @Resource[Microsoft.OperationalInsights/workspaces/tables:name]
      StringEquals 'ContainerAppConsoleLogs_CL'
    AND
    @Resource[Microsoft.OperationalInsights/workspaces/tables/record:ContainerAppName_s<$key_case_sensitive$>]
      StringEquals '<verified-backend-app-name>'
  )
)
```

The restrictive pattern and required actions follow Microsoft's
[granular RBAC documentation](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/granular-rbac-log-analytics)
and [condition example](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/granular-rbac-use-case),
checked 28 October 2026. Grants are additive: broader effective assignments can
bypass this condition. Resource-context access also depends on workspace access
mode. A privileged owner must inspect effective grants and supported conditions;
this implementation does not change access mode or remove existing assignments.
The overview's allowed-value character list omits underscores, while this legacy
table name contains them. The documentation alone therefore does not establish
acceptance of this exact custom-table condition; require provider acceptance and
the positive/negative proof below, without substituting a broader grant.
The repository deploy identity cannot create the proposed custom role. A future,
separately approved owner/bootstrap operation must be narrowly scoped and reviewed;
do not run the full bootstrap as a substitute or place this grant into CI.

## Activation proof still required

1. Read the deployed workspace/table schema and backend app/managed identity IDs.
   Confirm `ContainerAppConsoleLogs_CL`, `ContainerAppName_s`, `Log_s`,
   `TimeGenerated` and `ingestion_time()` behave as expected for retained data.
   Check workspace access mode and all direct, inherited and group-derived grants
   plus other reachable log-query paths. Do not activate on uncertain isolation.
2. Present the actual principal ID, workspace resource ID, role definition,
   assignment condition and rollback to the owner for action-time approval.
   No approval for that persistent access change is implied by starting this issue.
3. Only after that approval, an authorized operator may apply the exact grant.
   Read it back, wait for propagation, then use the backend identity for positive
   backend and negative vault-mirror/other-table/other-workspace queries. Include
   an unfiltered same-table query: backend rows alone must remain visible even
   without the application's `where` predicate. Verify the condition, not merely
   the application filter. Inspect outcomes privately; retain only safe verdicts
   and synthetic examples in GitHub. No real log content belongs in PR evidence.
4. Prove recent and older retained backend reads through owner/agent paths, secret
   exclusion and partial/unavailable reporting. Enable the above configuration
   through the normal reviewed release only after proof. Do not broaden access to
   bypass a failure. Turn the flag off if validation fails; revoke only the new
   scoped assignment/unused custom role under the same approved rollback scope.

Microsoft's [current migration notice](https://learn.microsoft.com/en-us/azure/container-apps/migrate-logs-azure-monitor)
says the legacy ingestion path's support ended 14 September 2026, with ingestion
continuing for TLS-compliant clients; migration changes table names. The deployed
schema/ingestion state must therefore be verified. This issue does not migrate
logging, union new tables or replace durable history with an in-memory buffer.
If production has moved to another schema, keep the feature off and revise its
exact query/grant proposal before requesting approval.

API behavior references: [request format](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/request-format),
[response/partial errors](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/response-format),
[timeouts](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/timeouts)
and [Container Apps columns](https://learn.microsoft.com/en-us/azure/container-apps/log-monitoring).

## Local verification

Synthetic fixtures cover input injection/bounds, older history, fixed selectors,
other-app rejection including the sentinel, output/transport limits, sanitization,
partial/empty/unavailable results, timeout/cancellation, concurrency, signed owner
and service authorization, read classification and redacted audits. Shared
catalogue, capability-budget and logging tests remain enforced without raised
limits. These are unit/local HTTP checks, not deployed Azure authorization proof.

Local run (Node 24.19.0/npm 11.9.0): seven focused suites passed 262 tests;
final reader/shared-instruction rerun passed 59; backend lint/build pass. The full
backend aggregate finished with 6,760 passed, one failed and one skipped. Its
workspace-language `en` acknowledgement failure passes the exact isolated case
with the original timeout and one worker; the aggregate run remains failed.
Hosted-agent checks pass 930 tests, Ruff and byte compilation. Repository script
checks pass 141, with three errors due to unavailable PowerShell. Normal hosted
Node 22 qualification remains pending while the PR is draft.

Follow-up independent review identified one deadline defect in the prepared
implementation: rejecting an invalid/oversized Content-Length awaited body
cancellation. Cancellation now runs without blocking the failed read or keeping
the query gate occupied. Two synthetic tests make cancellation never resolve,
then require both the first read and a subsequent provider read to settle. This
correction requires qualification of its new head; the earlier head is superseded.
