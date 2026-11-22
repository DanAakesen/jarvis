# Jarvis

Jarvis is a personal AI assistant for iPhone, Apple Watch and web. It supports
chat, voice, proactive follow-ups, notes and tasks. Software Factory manages
coding work against GitHub repositories.

Start with [p0.md](p0.md) for what comes first, [PRODUCT.md](PRODUCT.md) for scope, [PLAN.md](PLAN.md) for current
work, [architecture](docs/architecture.md) for how the system fits together,
and [agent context](docs/agent-context.md) for setup and checks. For UI work,
read [DESIGN.md](DESIGN.md), the [UI map](ui.md) and the [style guide](docs/ui/style-guide.md).

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps` | Fastify backend, React web app, native iPhone and Watch app, and vault mirror |
| `packages` | Shared TypeScript contracts |
| `agents` | PI definitions and skills, plus the hosted Python agent still used by CI and deployment |
| `runner` | Python adapter that runs coding tools over ACP |
| `pc-bridge` | Windows companion and browser extension |
| `db` | SQL migrations and test fixtures |
| `infra` | Azure infrastructure and setup |
| `scripts`, `.github` | Local tools, GitHub Actions and workflow tests |
| `templates` | Starter GitHub Actions workflows used by Software Factory |
| `.agents` | Repository working instructions and skills |
| `docs` | Architecture, operations, decisions and design references, including the [Daily migration source contract](docs/reference/README.md) |

## Install and build

Use the Node version in `.nvmrc` and the npm version in `package.json`. Python
components use the version in `.python-version`.

In the repository root:

```bash
npm ci
npm run build
npm run lint
npm test
```

The root lockfile covers the JavaScript workspaces. `npm run build --workspace @jarvis/web`
builds just the web workspace. `npm run dev` starts the web app at
`http://localhost:5173`. For checks that need a backend, use local fixtures rather
than the configured production origin; see [agent context](docs/agent-context.md).

## Contributing

Read [.github/copilot-instructions.md](.github/copilot-instructions.md) before changing the repo. Work on a task branch from
current `main` in a separate worktree. Don't push directly to `main` or merge
your own PR. Run offline checks before asking for review; don't run live or
paid checks without approval. Keep secrets, local authentication files and
generated build output out of Git.

## Licence

MIT; see [LICENSE](LICENSE). Reference code retains any upstream notices.
