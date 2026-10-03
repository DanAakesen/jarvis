# Infrastructure

`bootstrap.ps1` and `bootstrap.output.json` record the completed P0-06 bootstrap.
The output contains resource and identity IDs, not secrets.

Bootstrap requires Dan's signed-in Azure and GitHub CLIs. Cloud coding agents
must not run it or access Azure. P0-04 and P0-05 add Bicep; P0-11 deploys it from
GitHub Actions on `main` using OpenID Connect.

See the [Azure constraints](../docs/agent-context.md#azure) and
[architecture](../docs/architecture.md).
