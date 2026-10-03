# Jarvis

Dan's personal AI platform, starting with the Software Factory: chat and voice
request a change, a cloud coding agent delivers a PR, and GitHub Actions builds
and deploys it. Requirements live in [PRODUCT.md](PRODUCT.md); implementation
tasks and status live in [PLAN.md](PLAN.md).

## Current implementation

P0-01 provides the monorepo layout and buildable empty TypeScript workspaces.
The web and backend compile to `dist/`; they do not render a UI or start a server.
React/Vite is P0-02, Fastify is P0-03, and CI is P0-10. Production Python code,
database migrations, and deployment follow in their planned tasks. P0-04 has
added the Bicep template; Azure deployment awaits P0-11.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Web workspace; React + Vite follows in P0-02 |
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

There is no dev server, lint command, or application test suite yet. P0-02 and
P0-03 add those checks; P0-14 adds cloud setup automation. After P0-02, root
`npm run dev` will serve the web app against the production backend.

## Contributing

Read [AGENTS.md](AGENTS.md) and [docs/agent-context.md](docs/agent-context.md)
before execution. Work in an isolated cloud checkout on one task branch and
deliver one linked PR. Use the checkout provided by the cloud task; do not
create another checkout or worktree unless requested. Never push directly to
`main` or merge your own PR.

Agents do not access Azure. Deployments run through GitHub Actions on `main`;
bootstrap and sign-in steps remain Dan's responsibility. Never commit secrets,
local authentication files, or generated build output.

## Licence

MIT; see [LICENSE](LICENSE). Reference code retains any upstream notices.
