# Backend modules

[`index.ts`](index.ts) owns production composition and passes the selected
[`BackendModule`](modules.ts) instances to [`buildApp`](app.ts). The app
installs global authentication, CORS, safe logging and error handling before
registering the modules as isolated Fastify plugins. Each module declares its
routes and tools. An explicit `modules` option replaces the default composition;
include [core](core/index.ts) when the app needs health probes or tool dispatch.

- [Core](core/index.ts) owns `GET /tools` and schema-validated `POST /tools/:name`.
  The dispatcher returns the outcome and attempts to persist it for calls with a
  valid message ID. Some calls, such as proactive wakes, do not have one.
  A `ToolRefusal` supplies a safe reason; a failed action can carry an unknown
  outcome. Use the actual receipt instead of assuming a retry is safe.
- [Factory](factory/index.ts) owns projects, tasks and the worker event stream.
  [Foundry](foundry/README.md) owns the sandbox client.
- [Health](health/README.md) owns the optional SQL-backed Health composition
  and its native routes, read models and tool catalogue.

Add a module through composition, not by adding its routes to Core. Register
explicit route paths, keep inherited authentication, opt into service identity
only where the route needs it, and attach resource cleanup to the plugin
lifecycle. Registration rejects duplicate module IDs and tool names.

Run `npm test --workspace @jarvis/backend -- src/app.test.ts` for offline app checks.
