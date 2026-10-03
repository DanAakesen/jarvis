# Jarvis

Dan's personal AI platform, starting with the Software Factory: chat and voice
request a change, a cloud coding agent delivers a PR, and GitHub Actions builds
and deploys it. Requirements live in [PRODUCT.md](PRODUCT.md); implementation
tasks and status live in [PLAN.md](PLAN.md).

## Current implementation

P0-02 adds the React/Vite web skeleton, routing, lint, Vitest, and a focused
web CI workflow. The home page shows the pending sign-in and deployment state;
unknown routes provide a working return link. The backend still compiles an
empty module; Fastify follows in P0-03. Monorepo CI is P0-10, sign-in is P0-09,
and deployment is P0-11. P0-04 provides the Bicep template.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web` | React + Vite web app, routing, lint and Vitest |
| `apps/backend` | Backend workspace; Fastify follows in P0-03 |
| `agents/jarvis` | Reserved for the Python Jarvis agent (P4) |
| `runner` | Reserved for the Python coding-sandbox ACP adapter (P2) |
| `infra` | Completed bootstrap, Bicep template, and future deploy configuration |
| `db` | Reserved for SQL migrations and database fixtures |
| `docs` | Architecture, data model, decisions, agent context, and flow diagrams |
| `docs/reference` | Read-only prototype code and evidence; excluded from npm workspaces |

## Install and build

Use Node.js **22.23.3** (`.nvmrc`) and npm **10.9.9** (`packageManager`). Python
**3.12.14** (`.python-version`) is the baseline for future Python components;
it is not needed for the current TypeScript builds. The voice reference uses
Python 3.13 in its own container.

In the repository root:

```bash
npm ci
npm run build
```

`npm ci` installs the two workspaces from the single root lockfile. Build one
workspace with `npm run build --workspace @jarvis/web` or
`npm run build --workspace @jarvis/backend`. Both use the shared strict
TypeScript configuration and fail on compilation errors.

## Run and check the web app

After installation, run from the repository root:

```bash
npm run dev
```

Open `http://localhost:5173`. No sign-in, Azure access, backend process, or
configuration file creation is needed to open the skeleton. Port 5173 is fixed;
if another process uses it, Vite reports an error rather than changing ports.

```bash
npm run lint
npm test
```

`npm test` runs once; `npm run test:watch --workspace @jarvis/web` watches tests.
`Web CI` runs installation, lint, tests, and root builds on every PR and `main`
push. P0-10 will extend CI to the backend and Python components.

### Public configuration

Vite selects only the tenant ID, web application ID and API scope from
`infra/bootstrap.output.json`. Deployment and owner metadata stay out of the
client bundle. `apps/web/config.json` stores the production HTTPS backend
origin; it is currently `null` because the first deployment is P0-11. P0-11
must record its `backendFqdn` output there as `https://<backendFqdn>` so a new
checkout starts against production without an additional setup step.

A build or dev session can override that public URL with `VITE_BACKEND_URL`,
including in a git-ignored root `.env.local`. Never put secrets in that variable.
Invalid URLs or bootstrap identity fields stop startup/build with a configuration
error. With no URL, the shell shows that deployment is pending. A configured
address is not reported as a verified connection; API calls and MSAL sign-in
follow in P0-09. Production connectivity has not been tested.

## Contributing

Read [AGENTS.md](AGENTS.md) and [docs/agent-context.md](docs/agent-context.md)
before execution. Work in an isolated cloud checkout on one task branch and
deliver one linked PR. Dan requests a fresh checkout of the latest `main` for each task; use a new
cloud checkout or a separate Git worktree when continuing in one cloud session. Never push directly to
`main` or merge your own PR.

Agents do not access Azure. Deployments run through GitHub Actions on `main`;
bootstrap and sign-in steps remain Dan's responsibility. Never commit secrets,
local authentication files, or generated build output.

## Licence

MIT; see [LICENSE](LICENSE). Reference code retains any upstream notices.
