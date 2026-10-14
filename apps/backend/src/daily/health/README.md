# Inactive health processing (P12-05)

The [local coordinator release](https://github.com/DanAakesen/jarvis/issues/720#issuecomment-6154043444) permits synthetic implementation over P12-04's existing SQL inbox. Nothing registers a processor, route, tool, schedule, device credential or production flag. Original Daily remains canonical. Both cloud workers remain idle.

## Processing contract

`SqlHealthProcessor(existingPool, configuredOwner).processNext(signal)` explicitly processes at most one eligible owner-bound inbox row. It shares acceptance's owner transaction lock, not a new dispatcher or pool.

1. Commit a claim generation and retry deadline on the retained inbox row. Another invocation can select other eligible work, not the leased row.
2. Check the original SHA-256 and UTF-8 JSON, normalize outside the transaction, and validate the bounded result.
3. Recheck the claim generation/deadline under the owner lock. Commit domain rows, ingestion lineage, applicable feed freshness and processed receipt in one transaction. A heartbeat writes only phone-sync state.

Migration 0047 adds attempt/deadline/fixed error-code columns. An invocation has a 45-second deadline; existing SQL transactions retain their 30-second/query-cancellation and five-second lock bounds. Failed/interrupted attempts become eligible after 2, 5 and 15 minutes; after three attempts the next eligible invocation quarantines the row. No timer or automatic requeue exists. Validation errors quarantine immediately. Unexpected SQL/commit failures remain retry/unknown, never false success. A lost commit response is resolved from durable state on the next invocation; accepted raw bytes are never deleted.

Ingress already conflicts on changed owner/kind/automation/session bytes or device. Exact retry retains its receipt and produces one processed result. A matching pre-existing successful ingestion with the same exact session/checksum/length is retained without rewriting original IDs or advancing freshness; conflicting historical lineage quarantines. Empty workout exports succeed and advance only their processed feed, without deleting workouts or child history. Older accepted retries cannot regress newer target timestamps or introduce stale children under a newer workout. Equal acceptance timestamps are serialized; this is arrival-snapshot ordering, not a claim that a phone's late-arriving older export is newer source data.

## Pure source contract and deliberate validation

Nonsensitive `worker/health-normalize.js`, `health-targets.js` and selected persistence code were read at original Site SHA `9e193554c9c8c7c23a788ed3d2b0582580b76c0f`. No real records, source fixtures, credentials, schema or source files were changed. This establishes code-shaped compatibility only; protected live coverage/parity is still required.

- Metrics retain daily aggregation strategy and explicit unknowns. Known physical units convert to kcal/kg/m; sleep converts to hours. Missing units stay unknown (legacy sleep's absent unit is hours). Unsupported known-dimension units, mixed unknown/known units and ambiguous `cal` fail closed instead of guessing.
- Body-fat percentage accepts only `%`/`percent` and `fraction`/`1`, converting the latter to percent. Other declared units quarantine before domain/freshness writes; missing units remain unknown without scaling. Zero and missing values, unknown dimensions and original raw evidence are preserved.
- Explicit-offset instants normalize to UTC and group by Europe/Copenhagen, including DST. Date-only values stay dates; sleep follows the export's wake-date semantics. Invalid/offset-free timestamps and rolled-over dates are rejected. Latest-value metrics use timestamp order, not array position. Source values/conversion factors remain explicit in metadata.
- Every distinct workout ID remains separate, including same-day sessions and workout type/identifier/detail. Numeric series and UTC-minute heart rate preserve min/mean/max, sample counts and source metadata. Identical duplicate IDs collapse; conflicting same-export IDs quarantine. Summaries do not fabricate missing heart rate or sleep stages.
- Known heart-rate dimensions share the same strict `bpm`/`count/min`/`beats/min` mapping in daily metrics, workout summary quantities and sample series. Other declared units (including `Hz`) quarantine without domain writes or processed freshness. Only the original workout summary slots retain implicit BPM when no unit is supplied: flat `avgHeartRate.qty`/`maxHeartRate.qty`, then nested `heartRate.avg.qty`/`max.qty`, then `Avg`/`Max` and numeric `avg`/`max`. Nested quantities inherit an explicitly declared `heartRate` unit. Validate all declared fallback units; missing numbers stay null and zero stays zero. Missing series units remain unknown, mixed known/unknown samples are refused, and heart-rate variability is not a rate. Derived numeric fields are canonical; retained raw bytes and source detail keep their original unit evidence.
- Derived workout detail excludes GPS/routes/location and classified nutrition content. Apple Health nutrition groups never become canonical meals. The original accepted bytes remain unchanged in the private SQL inbox.
- Input walk: at most 100,000 nodes and 20 nested levels. Derived output: at most 10,000 rows and 8 MiB. Mapped identifiers retain exact values within 256 UTF-16 units; overlength values quarantine, never truncate/hash-replace. No automatic source-key widening.

## Owner reads and truthful freshness

`DailyHealthReadModel.forRequest` reuses existing root human/hosted-agent authentication and server owner; device/export/coding-runner identities cannot become an owner. It adds no public endpoint.

`sync` distinguishes latest committed upload evidence, actual processing time, inbox pending/quarantine counts and phone heartbeat. Acceptance and heartbeat cannot establish a processed feed timestamp. History uses keyset pages, a maximum 366-day span and 500 rows; list reads omit large JSON detail. Minute HR uses a separate bounded cursor. Exact workout detail is capped at 8 MiB and remains owner-bound. P12-09 supplies public contracts/routes/tools and activation later.

## Checks and remaining gates

Use backend lint/build, `npm test --workspace @jarvis/backend -- src/daily/health src/daily/health-upload src/daily/index.test.ts src/auth/auth.test.ts src/database/migrations.test.ts`, then normal full CI. `health-processing.integration.test.ts` uses only the existing disposable loopback SQL CI fixture: atomic rollback, concurrent/reconstructed processing, lost commit responses, retry exhaustion, owner/keyset isolation, empty exports, historical conflicts and guarded rollback. No production SQL or local SQL image is used. Tests are synthetic; report actual executed evidence on the PR.

Migration rollback refuses any attempted/processed/quarantined evidence and takes a table lock through the existing rollback transaction. Disable future composition instead of deleting evidence. Raw capacity/retention policy, protected backup/import/reconciliation, deployed recovery/ordering, real HAE shapes/unit coverage and physical-phone parity still gate activation and cutover. This implementation does not prove complete backup or transfer Cloud SAS authority locally.
