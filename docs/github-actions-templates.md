# Managed project GitHub Actions templates

Copy [pr-checks.yml](../templates/github-actions/pr-checks.yml) and
[release.yml](../templates/github-actions/release.yml) to `.github/workflows/`
in the managed project. These examples assume Node.js, an `.nvmrc`,
`package-lock.json`, npm
scripts named `lint`, `test`, and `build`, and a build output directory named
`dist/`. Change the runtime, install, check, build, and artifact-path steps to
match the project's toolchain.

The release workflow builds and tests without cloud credentials, uploads the
build output, then deploys only after those checks pass. Its deploy job runs
only on `main` and uses the GitHub `production` environment to request an Azure
OpenID Connect token. Add `scripts/deploy.sh` to the project, or replace the
deploy step with the project's Azure CLI deployment command; it receives the
artifact path as its first argument.

For Azure OIDC:

1. Create a GitHub environment named `production` in the project repository.
2. Create an Azure federated identity credential for the deployment identity
   with issuer `https://token.actions.githubusercontent.com`, subject
   `repo:OWNER/REPO:environment:production`, and audience
   `api://AzureADTokenExchange`.
3. Add repository or environment Actions variables `AZURE_CLIENT_ID`,
   `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`. These identifiers are not
   secrets; no Azure client secret is used.
4. Ensure the deployment identity has only the Azure roles and resource scope
   required by the deployment script.

The pull-request workflow has read-only repository permissions and no OIDC
permission. Keep deployment credentials and permissions out of pull-request
jobs.
