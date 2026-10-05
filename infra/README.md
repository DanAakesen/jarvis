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

## Required deployment inputs

`main.bicep` requires `backendIdentityResourceId`, `sqlAdminGroupObjectId`,
`foundryNameTimestamp`, and `budgetContactEmails`. The Deploy workflow reads
the comma-separated addresses from the `JARVIS_BUDGET_CONTACT_EMAILS` GitHub
secret and writes a protected temporary parameters file; do not put addresses
in the repository. This configures the email-only Azure Monitor action group
used by both app alert rules and budget thresholds. `backendImage` is optional: empty skips the backend app,
which the Deploy workflow uses only before ACR holds the first backend image.
The workflow takes the IDs from `bootstrap.output.json` and deploys as
`jarvis-infra`.

The optional `codexToolModel` parameter defaults to `gpt-5.5` and sets the
backend's `JARVIS_CODEX_TOOL_MODEL` for P7-14. It selects a model for the
existing Codex subscription; it does not provision a search service or API key.

The Foundry timestamp is a 14-digit UTC value (`yyyyMMddHHmmss`) fixed at
`20261003200000` in [`main.parameters.json`](main.parameters.json); every deploy
reuses it. A new value would create a new account and project, so change it only
after the account was deleted, and then to a fresh value (L2). Normal updates
keep the existing resources; deletion is not part of routine deployment.

## Notes search setup

P7-10 uses the `notesFolderPath` deployment parameter, defaulting to `/Jarvis/Notes`,
and the backend identity for Microsoft Graph. Graph Search requires the tenant-wide
`Files.Read.All` application role and does not support `Sites.Selected`. After
reviewing and approving that permission, the coordinator can run
[`setup-notes-search.ps1`](setup-notes-search.ps1) from an Azure CLI session
authorized to assign Graph application roles. The script is safe to rerun. The
backend fixes searches to Dan's OneDrive and filters both the Graph query and
returned links to the configured folder. No Azure or OneDrive live check was
performed by the coding agent.

## Google Calendar and Gmail setup

After the approved core deployment, Dan creates an OAuth **Desktop app** client
in Google Cloud Console, enables the Gmail and Calendar APIs, and publishes the
consent screen **In production**. From Windows PowerShell 5.1 at the repository
root, run `& .\infra\setup-google.ps1`. The PKCE loopback flow stores the OAuth
client ID, client secret, and refresh token only in the deployed Key Vault, then
removes the temporary Key Vault Secrets Officer assignment. It sets
`JARVIS_GOOGLE_TIME_ZONE` as a nonsecret GitHub Actions variable; deploy `main`
afterwards to enable the tools. Exact console steps and Google consent scopes
are in [agent context](../docs/agent-context.md#azure).
