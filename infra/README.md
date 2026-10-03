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

`main.bicep` requires `backendIdentityResourceId`, `sqlAdminGroupObjectId` and
`foundryNameTimestamp`. `backendImage` is optional: empty skips the backend app,
which the Deploy workflow uses only before ACR holds the first backend image.
The workflow takes the IDs from `bootstrap.output.json` and deploys as
`jarvis-infra`.

The Foundry timestamp is a 14-digit UTC value (`yyyyMMddHHmmss`) fixed at
`20261003200000` in [`main.parameters.json`](main.parameters.json); every deploy
reuses it. A new value would create a new account and project, so change it only
after the account was deleted, and then to a fresh value (L2). Normal updates
keep the existing resources; deletion is not part of routine deployment.
