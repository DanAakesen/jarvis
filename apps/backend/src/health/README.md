# Health module

[`composeHealth`](composition.ts) is the production entry point. It registers
nothing when the server switch is off. The checked-in
[deployment](../../../../infra/main.bicep) sets `JARVIS_HEALTH_ENABLED` to `true`;
the enabled module uses the existing backend SQL pool and resolves the owner
from the authenticated request. `daily` remains the SQL schema and source-key
namespace. `/health/*` and `health_*` are the current route and tool names.

## Read and write boundaries

- [`HealthQueryService`](query.ts) serves `/health/query`, `health_query` and
  `health_show`. Health and nutrition reads use bounded SQL queries and return
  partial data explicitly. Use `/health/capabilities` for the caller's source
  list; capability versions are separate from the query contract. Version 6
  advertises lifts only to the signed-in owner when the lift reader is composed.
- `GET` and `PATCH /health/training-targets` are Settings routes for the signed-in
  owner. Unset weekly gym/run or daily steps targets stay null. A patch changes
  only the supplied fields; null clears a field. The `daily.health.training-targets`
  query is read-only.
- [Nutrition](nutrition/README.md) owns the meal ledger and its owner-facing
  tools. [Health upload](health-upload/README.md) owns ingestion and delivery
  receipts. See the [native contract](../../../../docs/ios/integration-contract.md)
  for iPhone routes.
- Calendar and Gmail are in the [Google module](../google/tools.ts), not Health.
  The separate [nutrition MCP connector](mcp/README.md) is not composed by
  production startup.

Offline checks from the repository root:

```sh
npm test --workspace @jarvis/contracts
npm test --workspace @jarvis/backend -- src/health/routes/settings-targets.test.ts src/health/tools/source-tools.test.ts
```
