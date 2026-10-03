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
