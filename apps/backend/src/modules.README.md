# Backend modules

`buildApp` installs global request security, CORS, safe logging and error handling,
then registers the selected modules as isolated Fastify plugins. The production
default is `coreModule` and `factoryModule`. Each module contributes its routes
and Jarvis tool definitions through the same `BackendModule` contract.

| Owner | Current implementation | Later domain work |
| --- | --- | --- |
| `core/` | Health route; per-app tool catalogue and authenticated HTTP dispatcher | Settings, activity, persisted events and SSE hub |
| `factory/` | Module registration boundary | Projects/tasks routes and their real Jarvis tools |
| `foundry/` | Existing bounded sandbox client | Used by the dispatcher and task controls |

Empty production tool lists are intentional: the domain API tasks have not
implemented those operations yet. The registration boundary does not return
fabricated settings, projects or tasks, and does not advertise unavailable tools.
Event persistence and SSE publication/replay retain their own tasks. Root bearer
authentication is implemented in issue #8 and inherited by every area route;
only core health GET/HEAD and generated CORS preflights are public. Service
identities and browser sign-in require their separate policies and integration.

To add an area, implement a module and include it in the composition. No code in
`core/` needs to change:

```ts
import type { BackendModule } from './modules.js';
import { coreModule } from './core/index.js';
import { factoryModule } from './factory/index.js';

const newArea: BackendModule = {
  id: 'new-area',
  tools: [], // Add only implemented, validated domain operations.
  registerRoutes: async (app) => {
    // Register the area's actual routes here; inherited root hooks still apply.
    // Add owned-resource cleanup with app.addHook('onClose', ...) during startup.
  },
};
const app = buildApp(config, logger, { modules: [coreModule, factoryModule, newArea] });
```

The `modules` option replaces the full composition, so include `coreModule` to
keep `/health`. Modules register explicit route paths; Factory routes will use
`/factory/…`. Fastify isolates module decorators and hooks from sibling modules.
Async registration failures reject readiness/listening; attach startup/close
hooks before `ready()` or `listen()`. `index.ts` remains the process resource owner.

`app.jarvisTools.list()` and `.get(name)` are internal APIs. Registration validates
module IDs, tool names/descriptions and object-shaped input schemas, rejects
duplicate module IDs/tool names and snapshots/freeze schemas. Each descriptor
retains its owning module and handler. `GET /tools` exposes each registered name,
description and input schema. Core creates a schema-validated `POST /tools/{name}`
route for each tool, so new modules need no agent or core changes. Calls require
`X-Jarvis-Message-ID`, run with the request and a cancellation signal, and record
arguments, result and outcome through the SQL-backed tool-call store. Missing
persistence returns 503 before executing a tool. Global delegated-user
authentication applies; service-identity policy remains separate.

From the repository root, `npm test --workspace @jarvis/backend` verifies extension
registration, root security inheritance, lifecycle failures/cleanup and catalogue
isolation alongside existing health, logging and Foundry contracts. These are
offline tests; deployment remains issue #11.
