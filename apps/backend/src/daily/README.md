# Health read models

The area is named Health in the owner-facing workspace. Internal module and API
identifiers, including the `/daily/*` routes and `daily` source ids, remain unchanged.

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
- `daily.sync` returns separate `feeds`, `heartbeat` and `inbox` evidence.
  Inbox fields are `retained`, `retained_bytes`, `byte_limit`, `row_limit`,
  `pending`, `processing`, `quarantined`, `last_accepted_at` and `last_processed_upload_at`.
  `retained_bytes` sums stored `byte_count` across all retained rows for the
  authenticated owner, regardless of processing status. It is zero for an
  empty inbox. The numeric limits always report the shared upload store ceilings
  (256 MiB and 10,000 rows), including when empty. These additive fields expose
  no payload content and do not change ingest, processing or retention.

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

## Owner training targets (P14-45, #1132)

The owner sets weekly gym sessions, weekly run sessions and steps per day in
Settings. The target values have no defaults; every read returns `null` for an
unset value and the server-owned bounds. Migration `0061_daily_training_targets`
stores only nonempty, owner-keyed rows in `daily.training_targets`; a down
migration refuses to discard any such row.

`GET` and `PATCH /daily/training-targets` are signed-in-owner Settings routes
only. They reject agent, runner, connector and other identities, query strings
and invalid or oversized patches. A clear is `null`; partial updates preserve
the other values and commit transactionally. The assistant has no training
target write tool because the production tool catalogue must retain at least
eight free slots. A read-only query source may be added later.

The web client validates the full target response and owns the Settings
editor's load/save recovery states. `useTrainingTargets` provides a validated
loading/settled/error read and retry contract for later Overview, Workouts and
Health consumers; this change does not modify those views.

Focused checks:

```sh
npm test --workspace @jarvis/backend -- src/daily/training/targets.test.ts src/daily/training/targets-store.test.ts src/daily/routes/training-targets.test.ts src/daily/composition.test.ts src/daily/index.test.ts src/database/migrations.test.ts
npm test --workspace @jarvis/web -- src/daily/training-targets.test.ts src/daily/TrainingTargetsSettings.test.tsx src/SettingsPage.test.tsx
```
