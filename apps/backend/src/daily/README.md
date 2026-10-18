# Daily read models

`DailyQueryService` is the shared read-only boundary for `/daily/query`,
`daily_query`, the generated-view tool and the nutrition MCP connector. It
reuses the existing owner resolver, bounded SQL readers, 30-second timeout and
768 KiB result budget; callers cannot select an owner.

Capabilities are negotiated independently from the query contract. Version 1
keeps its original nine sources, version 2 keeps its original eleven sources,
and version 3 adds `daily.health.metric-catalog` and `daily.nutrition.days`.
Clients that do not request a supported version receive version 1.

- `daily.health.metrics` optionally filters by the exact `metric_name`.
- `daily.health.metric-catalog` pages metric names over a maximum 366-day
  period, with sorted distinct non-null units (up to five), first/last dates,
  day count and latest update time.
- `daily.nutrition.days` pages only dates containing retained, non-deleted
  meals. Totals sum recorded values; null totals are unknown, nutrients with
  some but not all meal values are marked partial lower bounds, and empty days
  are never fabricated.

Both new collection queries use keyset cursors and parameterized SQL bounded
to `TOP(@limit + 1)`. Metric catalogues default to 100 (maximum 500) rows;
nutrition days default to 50 (maximum 400). Neither requires a table or index
migration. `docs/architecture.md` records the broader read boundary and
version-compatibility details.

Run the focused contracts and backend checks with:

```sh
npm test --workspace @jarvis/contracts
npm test --workspace @jarvis/backend -- --run src/daily/query.test.ts src/daily/index.test.ts src/daily/health/read-model.test.ts src/daily/show/views.test.ts src/daily/mcp/routes.test.ts
npm run test:database --workspace @jarvis/backend -- src/database/daily-schema.integration.test.ts
```

The real-SQL test requires the existing isolated loopback SQL Server fixture;
it must not target production data.
