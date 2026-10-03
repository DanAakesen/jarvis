# Infrastructure

`bootstrap.ps1` and `bootstrap.output.json` record the completed P0-06 bootstrap.
The output contains resource and identity IDs, not secrets.

Bootstrap requires Dan's signed-in Azure and GitHub CLIs. Cloud coding agents
must not run it or access Azure. P0-04 adds `main.bicep` for the core resources;
its local build and lint are verified. P0-05 adds Foundry resources, and P0-11
deploys from GitHub Actions on `main` using OpenID Connect. Azure deployment
remains unverified.

See the [Azure constraints](../docs/agent-context.md#azure) and
[architecture](../docs/architecture.md).

## Required deployment inputs

`main.bicep` requires `backendIdentityResourceId`, `sqlAdminGroupObjectId`,
`backendImage`, and `foundryNameTimestamp`.

Choose the Foundry timestamp once as a 14-digit UTC value (`yyyyMMddHHmmss`,
for example `20261003120000`). P0-11 must save it in deployment configuration
and reuse it on every normal redeployment. Generating a new value on each run
would create a new account and project. Normal updates keep the existing
resources; deletion is not part of routine deployment.
