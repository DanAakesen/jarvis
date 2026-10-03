# Backend modules

`buildApp` installs global request security, CORS, safe logging and error handling,
then registers the selected modules as isolated Fastify plugins. The production
default is `coreModule` and `factoryModule`. Each module contributes its routes
and Jarvis tool definitions through the same `BackendModule` contract.

| Owner | Current implementation | Later domain work |
| --- | --- | --- |
| `core/` | Health route; per-app read-only tool catalogue | Settings, activity, persisted events and SSE hub |
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
retains its owning module and handler. Fastify separately rejects duplicate routes.
There is no runtime registration API, module loading from requests or HTTP tool
dispatcher. Future Jarvis dispatch must authenticate and authorize the caller,
validate input against the tool schema and supply the handler with the request and
a bounded cancellation signal. Registration alone does not perform those checks.

From the repository root, `npm test --workspace @jarvis/backend` verifies extension
registration, root security inheritance, lifecycle failures/cleanup and catalogue
isolation alongside existing health, logging and Foundry contracts. These are
offline tests; deployment remains issue #11.
