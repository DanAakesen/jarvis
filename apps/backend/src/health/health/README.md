# Health inbox processing

The bounded worker drains the existing SQL inbox when upload is enabled. See the [upload contract](../../../../../docs/reference/daily/health-ingestion.md) for the Bicep setting, retention and readiness. Health Auto Export is **not accepted on device**.

## Processing contract

`SqlHealthProcessor(existingPool, configuredOwner).processNext(signal)` explicitly processes at most one eligible owner-bound inbox row. It shares acceptance's owner transaction lock, not a new dispatcher or pool.

1. Commit a claim generation and retry deadline on the retained inbox row. Another invocation can select other eligible work, not the leased row.
2. Check the original SHA-256 and UTF-8 JSON, normalize outside the transaction, and validate the bounded result.
3. Recheck the claim generation/deadline under the owner lock. Commit domain rows, ingestion lineage, applicable feed freshness and processed receipt in one transaction. A heartbeat writes only phone-sync state.

An invocation and its claim each have a 45-second deadline. A handled storage failure defers the next attempt by 2, 5 or 15 minutes; an interrupted claim becomes eligible when its lease expires. After three attempts, the next eligible invocation quarantines the row. Validation errors quarantine immediately. For batch bounds and retention, see the [processing contract](../../../../../docs/reference/daily/health-ingestion.md#processing-and-replay-limits).

Exact upload retries keep the original receipt; different bytes or devices conflict for the same upload identity. A matching successful ingestion is retained without rewriting IDs or advancing freshness; conflicting lineage quarantines. Empty workout exports advance only their processed feed without deleting history. Older accepted retries cannot regress newer target timestamps or add stale children to a newer workout. This orders accepted snapshots, not the age of their source data.

## Normalization

- Metrics retain daily aggregation strategy and explicit unknowns. Known physical units convert to kcal/kg/m; sleep converts to hours. Missing units stay unknown (legacy sleep's absent unit is hours). Unsupported known-dimension units, mixed unknown/known units and ambiguous `cal` fail closed instead of guessing.
- Body-fat percentage accepts only string `%`/`percent` and `fraction`/`1`, converting the latter to percent. Validate both raw `units`/`unit` aliases on every group, sample and workout quantity before sanitization or fallback selection, including empty groups and shadowed declarations. Non-string declarations (including numeric `1`) and unsupported strings quarantine before domain/freshness writes; absent/null/blank units remain missing and inherit a valid group unit or stay unknown without scaling. Zero and missing values, unknown dimensions and original raw evidence are preserved.
- Explicit-offset instants normalize to UTC and group by Europe/Copenhagen, including DST. Date-only values stay dates; sleep follows the export's wake-date semantics. Invalid/offset-free timestamps and rolled-over dates are rejected. Latest-value metrics use timestamp order, not array position. Source values/conversion factors remain explicit in metadata.
- Every distinct workout ID remains separate, including same-day sessions and workout type/identifier/detail. Numeric series and UTC-minute heart rate preserve min/mean/max, sample counts and source metadata. Identical duplicate IDs collapse; conflicting same-export IDs quarantine. Summaries do not fabricate missing heart rate or sleep stages.
- Known heart-rate dimensions share the same strict `bpm`/`count/min`/`beats/min` mapping in daily metrics, workout summary quantities and sample series. Other declared units (including `Hz`) quarantine without domain writes or processed freshness. Only the original workout summary slots retain implicit BPM when no unit is supplied: flat `avgHeartRate.qty`/`maxHeartRate.qty`, then nested `heartRate.avg.qty`/`max.qty`, then `Avg`/`Max` and numeric `avg`/`max`. Nested quantities inherit an explicitly declared `heartRate` unit. Validate all declared fallback units; missing numbers stay null and zero stays zero. Missing series units remain unknown, mixed known/unknown samples are refused, and heart-rate variability is not a rate. Derived numeric fields are canonical; retained raw bytes and source detail keep their original unit evidence.
- Derived workout detail excludes GPS/routes/location and classified nutrition content. Apple Health nutrition groups never become canonical meals. The original accepted bytes remain unchanged in the private SQL inbox.
- Input walk: at most 100,000 nodes and 20 nested levels. Derived output: at most 10,000 rows and 8 MiB. Mapped identifiers retain exact values within 256 UTF-16 units; overlength values quarantine, never truncate/hash-replace. No automatic source-key widening.

## Owner reads and truthful freshness

The owner-authorised HTTP and tool read paths do not depend on upload being enabled.
The processor can forward changes to an injected sink; production does not pass
the Health query hub to it. When a sink is supplied, changes publish only after
commit. New normalized lineage notifies affected health sources; heartbeats,
retained lineage replays and quarantines notify sync only. No-ops and uncertain
commits do not notify, and listener failures do not retry SQL effects.

`HealthReadModel.forRequest` reuses existing root human/hosted-agent authentication and server owner; device/export/coding-runner identities cannot become an owner. It adds no public endpoint.

`sync` distinguishes latest committed upload evidence, actual processing time, inbox accepted/pending, processing, succeeded, quarantine counts and phone heartbeat. Acceptance and heartbeat cannot establish a processed feed timestamp. History uses keyset pages, a maximum 366-day span and 500 rows; list reads omit large JSON detail. Minute HR uses a separate bounded cursor. Exact workout detail is capped at 8 MiB and remains owner-bound.

The shared query contract optionally filters `daily.health.metrics` by the
exact retained `metric_name`, preserving its date/name cursor order.
`daily.health.metric-catalog` pages retained metric names for the same
366-day maximum; each item reports sorted distinct non-null units (up to five),
first/last dates, distinct day count and latest update time. Catalogue pages
default to 100 and cap at 500 rows. Both reads use the existing owner-scoped SQL
boundary; capability versions 1 and 2 do not advertise the version-3 source.

The iPhone, Chat and Voice daily budget uses one Copenhagen-day total from `active_energy_burned` or `active_energy`. Native HealthKit totals use their coverage end time. Exported totals use their update time. The latest valid total wins, with `active_energy_burned` first for a tie. Native interval batches do not establish a daily total.

To disable processing, use the [upload rollback procedure](../../../../../docs/reference/daily/health-ingestion.md#readiness-and-rollback-gates). Preserve the SQL receipts and raw rows.
