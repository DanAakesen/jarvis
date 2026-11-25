# Infrastructure

For authorised setup or repair, `bootstrap.ps1` uses the operator's Azure and
GitHub CLI sign-ins. It provisions both name-only and immutable-ID OIDC subjects
for `main` and records non-secret deploy references in `bootstrap.output.json`.
Do not copy environment IDs into docs or run bootstrap as a coding agent.
The [Deploy workflow](../.github/workflows/deploy.yml) applies `main.bicep` from
GitHub Actions using the `main` OIDC identity.

See the [Azure constraints](../docs/agent-context.md#azure) and
[architecture](../docs/architecture.md).

## Backend diagnostic access

The backend managed identity uses **Log Analytics Data Reader** at the existing workspace, with a version 2.0 condition allowing only the backend app's rows in **ContainerAppConsoleLogs_CL**. Other apps and tables are outside this grant. Log retention stays at 30 days.

The Bicep parameter **backendLogAccess** accepts **off**, **grant** (assignment only) or **enabled** (assignment and reader). Production parameters select **enabled**. For first activation, apply the scoped assignment, read it back and verify the backend identity can read its own records and cannot read known records from other apps or tables. The existing deploy preflight reports identity and schema metadata. Empty negative controls do not establish isolation. **off** disables the tool; remove the role assignment explicitly to revoke it after an incremental deployment.

## Authentication after remote image builds

The backend and hosted-agent Deploy jobs obtain a fresh GitHub OIDC assertion
through the existing pinned `azure/login` action after each image build and push to ACR (built on the GitHub runner) and
immediately before reading its manifest digest. The action uses the same existing
client, tenant and subscription; permissions, image tags, digest guards, deployment
readiness and release receipts are unchanged. Failed login or metadata resolution
stops the job before image deployment. There is no automatic build/write retry,
admin credential fallback or new secret.

The [OIDC flow](https://github.com/Azure/login/blob/a641126d1b8aa4d1fa005f4f92df94a3a4c4c906/src/Cli/AzureCliLogin.ts)
does not depend on refreshing the pre-build assertion. A generic registry
authentication error does not distinguish expiry, authorization or connectivity.
Keep raw tokens and debug authentication logs out of deployment evidence.

## Application alerts

The email action group and budget notifications remain. The backend still writes
`jarvis.alert` traces, but Bicep does not create log-alert rules for credential
expiry, deployment failures or sandbox crashes.

## Required deployment inputs

`main.bicep` requires `backendIdentityResourceId`, `sqlAdminGroupObjectId`,
`foundryNameTimestamp`, `budgetContactEmails`, and `terraChatCapacity`. The Deploy workflow reads
the comma-separated addresses from the `JARVIS_BUDGET_CONTACT_EMAILS` GitHub
secret and writes a protected temporary parameters file; do not put addresses
in the repository. These addresses are used for budget notifications.
`backendImage` is optional: empty skips the backend app,
which the Deploy workflow uses only before ACR holds the first backend image.
The workflow takes the IDs from `bootstrap.output.json` and deploys as
`jarvis-infra`.

### Terra main-chat rollout (#1337)

[`main.bicep`](main.bicep) deploys `gpt-6.1-terra` version `2026-10-26` as
GlobalStandard. [`main.parameters.json`](main.parameters.json) requests 600
capacity units (600K TPM) via `terraChatCapacity`. The
[deployment automation guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/automate-quota-deployments)
defines the unit; the [region matrix](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability)
does not prove available subscription quota. Measure context via `pi.turn`
`inputTokens` before proposing a lower limit. Deploy, not offline Bicep CI,
validates Azure's current limits. If Azure rejects an allocation, do not change
quota, region, SKU or permissions without approval.

Normal Chat uses the serving [PI agent definition](../docs/architecture.md#the-two-foundry-agents),
not the legacy hosted-agent Chat setting. A Bicep parameter is not proof of the
serving version. Use the owner [readback procedure](../docs/agent-context.md#verify-the-live-agents-read-only)
when explicitly authorised.

GlobalStandard is [metered per token](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types),
not reserved capacity. Budget notifications are not a hard cap or permission
to increase spend.

Microsoft's 26 October [Terra announcement](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/gpt-6-1-terra-now-generally-available-in-microsoft-foundry-build-agents-that-see/4567769)
publishes these Global Standard list rates in USD per million tokens:

| Context tier | Input | Cached input | Cache writes | Output |
| --- | ---: | ---: | ---: | ---: |
| Short | $1.00 | $0.05 | $1.25 | $5.00 |
| Long | $2.00 | $0.10 | $2.50 | $7.50 |

See [Azure pricing](https://azure.microsoft.com/en-us/pricing/details/azure-openai/)
for public rates. Account pricing and the context-tier billing threshold are not
verified here.

The optional `codexToolModel` parameter defaults to `gpt-5.5` and sets the
backend's `JARVIS_CODEX_TOOL_MODEL` for P7-14 web research and P7-15 image
generation. It selects a model for the existing Codex subscription; it does not
provision a search or image service or API key.

Foundry resource names use the 14-digit UTC timestamp (`yyyyMMddHHmmss`) in
[`main.parameters.json`](main.parameters.json). Keep it pinned in normal Deploy:
a new value creates a different account and project. Change it only for an
authorised rebuild after the previous account is removed.

## GitHub vault setup

The configured private GitHub vault is Jarvis's long-term knowledge source.
Install the existing Jarvis GitHub App on that vault with Contents read/write.
Select only the vault when GitHub offers repository selection. The backend
verifies `push` webhook signatures and indexes the vault at startup.

No personal access token, Microsoft Graph permission or Azure role is needed.
A missing App installation leaves vault indexing and writes unavailable.

## Vault mirror setup

The mirror is opt-in and requires the core infrastructure to be deployed first.
Before enabling it, install the existing GitHub App on the private vault
repository with Contents read/write permission, set the non-secret repository
variable `JARVIS_GITHUB_APP_ID`, and ensure the companion mirror image is
available from `apps/vault-mirror/Dockerfile`. The job tolerates missing
Key Vault secrets at deployment time; its credentials are read at run time.

Install the [official Obsidian Headless CLI](https://github.com/obsidianmd/obsidian-headless)
only to create the auth token, then run `ob login`. Do not run `ob sync-setup` or
`ob sync` on a computer that runs desktop Obsidian Sync. The live Obsidian
service and CLI behavior remain unverified against the live service.

From the repository root in Windows PowerShell 5.1, sign in to the expected
Azure subscription with `az` and authenticate `gh` to this repository, then
run:

```powershell
& .\infra\setup-vault-mirror.ps1
```

The script asks for the vault name, optional encryption password, policy JSON
and change caps. Enter the Obsidian token at the hidden prompt, or explicitly
confirm reading the CLI's own token file. It sends credential values directly
to Key Vault over HTTPS without writing them to disk, and confirms only secret
presence and version. It temporarily grants the signed-in owner Key Vault
Secrets Officer only if the exact-scope assignment is not already present,
then removes only the assignment it created, including on failure. It sets the
write-back repository variable to `dry-run` and stores the selected caps as
non-secret repository variables; it never turns on the mirror switch. If an
unencrypted vault no longer needs an old password secret, remove that old
secret separately after confirming the vault's encryption state.

After the setup script completes and the image Dockerfile is on `main`, set
repository variable `JARVIS_VAULT_MIRROR_ENABLED` to `true` and manually
dispatch **Deploy** from `main`. The workflow builds a digest-pinned image
before enabling the Bicep resources. While that switch is true, a missing
Dockerfile, image, digest, App ID or invalid cap fails the infrastructure job
before Bicep; the release cannot silently call a partial result successful.
Leave `JARVIS_VAULT_MIRROR_WRITE_BACK` as `dry-run` for initial runs.

Review the Deploy **Deterministic runtime readiness** job. With the switch on,
the read-only probe verifies the schedule, digest-pinned image, one fresh
terminal execution and the runner's bounded outcome summary. It starts no
manual execution and changes no resource. An ordinary `needs-attention`
outcome is printed as a warning; `needs-attention / guard-tripped` fails
readiness because the planner applied nothing. Missing executions,
configuration drift, auth failure and other failed outcomes also fail.

When the summary is `guard-tripped`, read its `guardReasons` and proposed
directional counts. Ordinary cap overflow no longer trips: it drains as a
bounded batch. A remaining guard is a hard source-loss/safety condition, not a
reason to guess at a larger cap. Any policy change still requires a separate
owner-reviewed production decision and Deploy.

The same owner-side check is:

```sh
python .github/scripts/vault_mirror_probe.py \
  --subscription <subscription-id> \
  --resource-group <resource-group> \
  --write-back on \
  --max-changed 25 \
  --max-deletes 3 \
  --wait-seconds 1200
```

This command reads Container Apps configuration, the dedicated user-assigned
identity/client ID, executions and allow-listed logs only. It never prints a
vault note, conflict path or credential. It confirms the job's ACR identity
and required runtime settings. The 1,200-second wait covers the ten-minute
schedule interval, the eight-minute replica timeout and two minutes for the
terminal log to become readable. A shorter positive wait is rejected because
it cannot prove a fresh scheduled execution had enough time to finish. The
first execution's fixed auth/policy reason remains the proof that Key Vault
secrets were readable. Also
review the authenticated Jarvis Status page for counts, last run/outcome and
safe read-failure reasons. **No status yet** is evidence about the status
document only; it is not proof the job is off. Do not enable write-back until
the initial dry runs are clean and the status indicates no unresolved conflicts
or credential matches. To go live, set
`JARVIS_VAULT_MIRROR_WRITE_BACK` to `on`, keep conservative caps in
`JARVIS_VAULT_MIRROR_MAX_CHANGED` and `JARVIS_VAULT_MIRROR_MAX_DELETES`, then
dispatch **Deploy** again.

To roll back writes without stopping reads, set
`JARVIS_VAULT_MIRROR_WRITE_BACK` back to `dry-run` and dispatch **Deploy**
again. The scheduled job remains active but does not write changes to Obsidian.

To stop the mirror, explicitly set `JARVIS_VAULT_MIRROR_ENABLED` to `false` and
dispatch **Deploy** from `main`. The deployment deletes the scheduled
job, its dedicated identity and that identity's role assignments. The private
state/status containers remain in the existing storage account so the state
can be recovered if the mirror is enabled again. Do not delete those containers
unless the owner has separately backed up the state and approved permanent
teardown.
Deploy retries the idempotent teardown on every later infrastructure run while
the switch remains explicitly `false`; a push-triggered teardown failure emits a
warning and does not block the rest of infrastructure deployment.

## Google Calendar and Gmail setup

After the approved core deployment, Dan creates an OAuth **Desktop app** client
in Google Cloud Console, enables the Gmail and Calendar APIs, and publishes the
consent screen **In production**. From Windows PowerShell 5.1 at the repository
root, run `& .\infra\setup-google.ps1`. If a new scope is added, Dan must add it
under Google Auth Platform **Data Access** and rerun the script to re-consent
and replace the Key Vault refresh token. The PKCE loopback flow stores the OAuth
client ID, client secret, and refresh token only in the deployed Key Vault, then
removes the temporary Key Vault Secrets Officer assignment. It sets
`JARVIS_GOOGLE_TIME_ZONE` as a nonsecret GitHub Actions variable; deploy `main`
afterwards to enable the tools. The setup script lists the required consent scopes.

## Azure access through PI

The Azure MCP app keeps its system-assigned identity and Contributor at the
Jarvis resource group. `grant-azure-mcp-inventory-reader.ps1` assigns the
built-in Reader role at the subscription for resource inventory, after checking
the current subscription, the deployed app identity and inherited assignments.
The infra setup script does not perform this independent role assignment.
The MCP image uses an exact allowlist of pinned 3.0.0 tools: subscription and
resource-group inventory, Container Apps inventory, existing storage account
and blob reads, container creation, Monitor metrics and resource-health reads,
and Monitor workbook list/show/create/update. Group resource listing takes one
resource group, so whole-subscription inventory visits each group. Storage
Blob Data Contributor is scoped to the existing Jarvis storage account. The
backend's separate `read_backend_logs` diagnostic tool remains the bounded,
sanitized log path; raw Log Analytics queries are not exposed through Azure MCP.
This is an MCP tool-surface boundary, not identity-level log isolation: the
Azure MCP subscription Reader and resource-group Contributor roles can include
workspace data-read permissions under Azure's role union.
The pinned Azure MCP Container Apps namespace has only a list tool, so it does
not provide Container Apps get, scale or revision operations.

Azure MCP 3.0.0 does not expose Azure Storage Queue tools. PI's own bounded
Storage Queue tools use the backend identity, which receives Storage Queue Data
Contributor at the existing account's queue service. They list one page of
queues, inspect properties, create queues, send messages, peek, and explicitly
receive messages. Peek never leases or changes visibility; receive temporarily
hides messages and returns a pop receipt. Deleting a queue and its messages or
deleting an individual message requires Dan's existing browser confirmation.
