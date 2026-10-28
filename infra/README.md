## Proposed backend log access (#1341; currently disabled)

[The reader and activation plan](../docs/backend-logs.md) documents a proposed
workspace-scoped conditional grant for the existing backend identity. It is not
added to Bicep, bootstrap or CI. Owner action-time approval and live schema,
effective-grant and negative other-app checks remain required. Deployment of this
code leaves the flag off and preserves existing retention and permissions.

# Infrastructure

`bootstrap.ps1` and `bootstrap.output.json` record the completed P0-06 bootstrap.
The output contains resource and identity IDs, not secrets.

Bootstrap requires Dan's signed-in Azure and GitHub CLIs. Cloud coding agents
must not run it or access Azure. P0-04 adds `main.bicep` for the core resources;
its local build and lint are verified. P0-05 adds Foundry resources, and P0-11's
[Deploy workflow](../.github/workflows/deploy.yml) deploys from GitHub Actions on
`main` using OpenID Connect. The first live deployment is P0-16.

The deploy identity's federated credential uses GitHub's immutable-ID subject
(`repo:<owner>@<owner ID>/<repo>@<repo ID>:ref:refs/heads/main`); bootstrap reads
the IDs from the GitHub API (L49). Runs before that change registered only the
name-only subject, so re-run bootstrap once before the first successful Deploy.

See the [Azure constraints](../docs/agent-context.md#azure) and
[architecture](../docs/architecture.md).

## Application alerts

The three scheduled-query rules match `jarvis.alert` traces whose
`Properties.alertType` is `credential_expiry`, `deployment_failure` or
`sandbox_crash`, matching the backend emitter. Bicep multi-line strings do not
interpolate: each rule uses `replace()` to insert its type into the query.
Infrastructure CI rejects compiled alert queries containing literal `${`.
The backend also records `budget_threshold`; budget notifications use the
separate Azure Consumption budget resource, not these three trace rules.

Once deployed, this correction may notify the existing action group for alerts
that were previously silent. After the normal Deploy, read back each
`jarvis-<alertType>` rule in Azure Monitor and confirm its query contains
`alertType == "<alertType>"` with the corresponding type and no `${`.
Offline build/lint does not verify deployed rules or email delivery.

## Required deployment inputs

`main.bicep` requires `backendIdentityResourceId`, `sqlAdminGroupObjectId`,
`foundryNameTimestamp`, `budgetContactEmails`, and `terraChatCapacity`. The Deploy workflow reads
the comma-separated addresses from the `JARVIS_BUDGET_CONTACT_EMAILS` GitHub
secret and writes a protected temporary parameters file; do not put addresses
in the repository. This configures the email-only Azure Monitor action group
used by both app alert rules and budget thresholds. `backendImage` is optional: empty skips the backend app,
which the Deploy workflow uses only before ACR holds the first backend image.
The workflow takes the IDs from `bootstrap.output.json` and deploys as
`jarvis-infra`.

### Terra main-chat rollout (#1337)

`terraChatCapacity` is a required positive integer. The committed parameters now
request 150, matching the repository's established chat allocation. This is a
requested throughput limit, not a claim of available live quota. Capacity 1 was
too small for a Jarvis turn; 50K TPM also throttled the recorded 57K–66K/minute
acceptance workload (#1232/L91). Matching 150 is the practical starting request,
not a proof of the mathematical minimum for every workload.

Microsoft's [deployment automation guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/automate-quota-deployments)
defines one capacity unit as 1,000 TPM. A Terra-specific live minimum/maximum or
remaining allocation has not been read here. GlobalStandard is
[pay-per-token](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types),
with no reserved PTU purchase introduced by this allocation.

PR CI builds/lints Bicep offline; it cannot prove current Azure availability. The
existing main-only Deploy authenticates with its existing OIDC identity and
submits the template, where Azure validates model/SKU limits, quota and capacity.
A separate owner sign-in or live quota read is not a prerequisite for preparing
this ordinary deployment request. Normal qualification/review still precedes
merge; no worker merges or directly deploys. If Azure rejects the allocation,
report the exact failure and stop: do not silently increase quota, change region
or SKU, create access, or claim success. No deployment is performed here.
The template adds `gpt-6.1-terra` / `2026-10-26`, GlobalStandard, after Sol in the
existing Foundry account's serialized model deployment chain.

After the normal infrastructure/backend/agent release, verify Terra in the live
catalogue. Read authenticated `GET /settings` to observe the effective chat model
and reasoning; a source-code default is not evidence of Dan's active selection.
If needed, use the existing Settings update with only
`{"settings":{"roles":{"chat":{"model":"gpt-6.1-terra"}}}}` to retain the
existing valid reasoning and all unrelated settings. Verify the returned
effective model with owner `GET /settings`; a new hosted-agent session must
resolve Terra through its normal agent-only `GET /agent/settings` read. The
existing owner `set_jarvis_model` tool uses the same
validated settings write path and returns the saved model for the next session.
The regression test covers the persisted model-only update and both readbacks;
the hosted-agent regression preserves an explicit session model. Do not claim
activation from the code fallback alone. Do not rewrite stored settings globally
or replace explicit session models. Danish `/voice/da` uses the realtime voice
role when `options.connect` is configured; only the `connectDanish` hosted-agent
fallback inherits chat settings on its next session. The voice-role default
remains unchanged.
If the saved effort is `minimal`, the model-only update is refused: resolve a
supported effort with the owner rather than silently changing it.
Existing approval interpretation and proactive summarization also read the chat
setting. Account for those shared consumers in the spending decision. No new
background model role or Terra price estimate is introduced here. The inactive
semantic-mail adapter requires known pricing and therefore refuses an unpriced model.
The proactive unknown-model estimate uses existing known rates; it is not a
verified Terra spending bound.
Dan approved a USD 20/month Terra budget and accepted the existing alert-based
controls. Keep those alerts unchanged; no new spending guard is required or
implemented, and the alerts are not an enforced hard cap. The ordinary metered
model deployment does not authorize unlimited spending or reserved capacity.

Discovery on 27 October: this executor has no Azure CLI, Azure identity
configuration or existing Azure login, and no authorized owner-settings route.
Actual quota/capacity and the saved model could not be observed. Microsoft's
[availability matrix](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability)
lists Terra in Sweden Central; it does not prove subscription quota or capacity.
The [Azure pricing page](https://azure.microsoft.com/en-us/pricing/details/azure-openai/)
timed out, and the public Retail Prices API request returned proxy HTTP 403.

Microsoft's 26 October [Terra announcement](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/gpt-6-1-terra-now-generally-available-in-microsoft-foundry-build-agents-that-see/4567769)
publishes these Global Standard list rates in USD per million tokens:

| Context tier | Input | Cached input | Cache writes | Output |
| --- | ---: | ---: | ---: | ---: |
| Short | $1.00 | $0.05 | $1.25 | $5.00 |
| Long | $2.00 | $0.10 | $2.50 | $7.50 |

The canonical article returned HTTP 403 here; the complete table was verified in
Microsoft's indexed [model catalog tag page](https://techcommunity.microsoft.com/tag/model%20catalog).
These are public list prices, not verified account-specific rates. Azure's
short/long context threshold and whether a threshold changes billing for the
whole request were not verified; do not import OpenAI's billing rules into this
Azure rollout. Actual quota/capacity and account-specific rates remain
unobserved; the normal authenticated Deploy determines whether Azure accepts the
requested allocation. Runtime pricing tables and currency conversion remain
unchanged. USD 20/month and existing alerts are the owner's accepted budget
direction; no new budget subsystem or login handoff is introduced.

The optional `codexToolModel` parameter defaults to `gpt-5.5` and sets the
backend's `JARVIS_CODEX_TOOL_MODEL` for P7-14 web research and P7-15 image
generation. It selects a model for the existing Codex subscription; it does not
provision a search or image service or API key.

The Foundry timestamp is a 14-digit UTC value (`yyyyMMddHHmmss`) fixed at
`20261003200000` in [`main.parameters.json`](main.parameters.json); every deploy
reuses it. A new value would create a new account and project, so change it only
after the account was deleted, and then to a fresh value (L2). Normal updates
keep the existing resources; deletion is not part of routine deployment.

## GitHub vault setup

P7-40 uses Dan's private `DanAakesen/vault` repository on `master` as Jarvis's
long-term knowledge source. Dan must install the existing Jarvis GitHub App on
that repository and grant Contents read/write permission (the installation token
is restricted to the vault). Select only the vault for the installation if
GitHub offers repository selection. The App already subscribes to `push`; the
backend verifies webhook signatures and also indexes the vault at startup.

No personal access token, Microsoft Graph permission, or Azure role is needed.
If the App is not installed on the vault, Jarvis reports that indexing and
writes are unavailable. The vault is private and was not accessible for live
verification by the coding agent.

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
before enabling the Bicep resources. If the Dockerfile, image digest or
non-secret App ID is unavailable, the log shows a notice and the core
infrastructure deploys without creating/updating the mirror. Leave
`JARVIS_VAULT_MIRROR_WRITE_BACK` as `dry-run` for initial runs.

Review the Container Apps job's **Executions** history for completion, duration
and failures. After the companion backend status reader is deployed, also review
the authenticated Jarvis Status page for counts, outcomes and any bounded
conflict paths. Note text and ordinary vault paths are never logged. Do not
enable write-back until the initial dry runs are clean and the status indicates
no unresolved conflicts or credential matches. To go live, set
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
afterwards to enable the tools. Exact console steps and Google consent scopes
are in [agent context](../docs/agent-context.md#azure).
