# Inactive Daily coaching services

P12-08/#723 supplies one calculation path for future Daily UI and assistant
callers. Nothing imports this directory from production composition. There are
no routes, tools, timers, provider calls, new tables or migrations.

`DailyCoachingService.forRequest` resolves the existing authenticated server
owner. It reuses `DailyHealthReadModel`, `NutritionStore` and exact-key
`DailyOwnerStore` reads. Reads cover at most fourteen Copenhagen dates, twenty
500-row pages per health kind and one hundred 100-row intake pages, with a
45-second cancellation deadline. Exceeding a bound fails visibly instead of
returning a complete-looking truncated summary.

These are independent owner-scoped reads, not an atomic cross-domain snapshot.
Output says `partial` and returns committed health-sync evidence separately
from heartbeat. Pending/quarantined work makes prior health observations stale
for coaching; a heartbeat never makes them current. No elapsed-time freshness
expiry rule has been established.

## Calculations and missing contracts

`calculateCoaching` is pure and requires trusted, server-owned observations and
coverage. Models/clients cannot supply authoritative completeness or budgets.
Defaults are 8,000 steps, seven hours sleep and max(180 g, 2 g/kg) protein;
retained profile targets/preferences remain authoritative when present. Missing
same-date weight leaves the exact weight-dependent protein target unavailable.
Orders put remaining protein first and do not request extra steps after the
observed target, an extra workout after a recorded session, or activity on a
recovery day. Coaching preferences are data, not global prompt changes.

The seven completed calendar days have separate eligible, assessed, unknown,
met and missed counts. Partial historical shortfalls are unknown, not misses.
Recovery dates retain measurements but are excluded from eligible aggregates.
Four recorded fourteen-day metrics expose observed counts and dates: weight,
waist circumference in canonical metres, fat percentage, and actual recorded
lean mass. Waist points retain ingestion provenance; stale waist is excluded,
and recovery waist points remain visible but do not enter eligible trends.
Same-date weight-times-fat-percentage fat mass remains a separate derived
metric, explicitly marked `derived: true`; it cannot replace recorded waist.
No muscle/lean estimate, zero-fill, carried-forward weight
or invented average is substituted. Readiness preserves its recorded integer
and context, asks only for missing fields and assigns no clinical scale.

**Unresolved acceptance:** no authoritative maintenance/TDEE derivation or
nutrition-day completeness contract was supplied or found in the approved
repository context. The owner adapter therefore returns maintenance,
deficit-target/remaining budgets and deficit consistency as unavailable. It
keeps recorded active/resting energy separate and logged meal totals partial;
an empty meal list is not zero intake. Synthetic explicitly supplied complete
maintenance/intake proves only arithmetic: maintenance and deficit budgets
remain distinct, and an unrounded deficit of exactly 15% counts. It is not
verified source/live acceptance or an approved TDEE formula.

## Existing-table changes

All writes are unregistered service methods requiring separate trusted explicit
user-intent metadata. P12-09 must derive that metadata and request time from the
existing trusted execution boundary, never model arguments.

`updateTargets` uses the mapped profile revision as a compare-and-set, touching
only policy/preferences and never recreating or replacing a profile.
`recordReadiness` patches rating/context independently; context-only updates
require a retained rating. `recordRecovery` only records the recovery marker
and context; it cannot delete measurements, food or history.

`commitExperiment` retains one explicitly chosen experiment, baseline, review
period, rationale and locked variables in `coach_experiments`. The existing
health SQL transaction/owner lock serializes writes. Same-operation replay
compares canonical fields, accepts retained terminal results and rejects
changed payloads, padded identities, conflicting IDs or another active
experiment. `reviewExperiment` explicitly completes/abandons that exact
experiment before another can be committed. No automatic experiment, medical
conclusion or extra commitment is created. Cancellation and uncertain commit
failures do not return success; retry the same operation identity.

## Checks and gates

Focused Vitest cases are `model.test.ts`, `evidence.test.ts` and
`service.test.ts`. The existing isolated SQL runner also discovers
`src/database/coaching.integration.test.ts`, which uses a unique loopback-only
database and synthetic rows. It covers concurrent/replayed/conflicting
commitments, owner isolation, review transitions, readiness patches, recovery
retention and profile revision conflicts.

Local native Node assertions execute actual arithmetic and SQL-row adapters;
the waist correction also executes the actual service read body with explicit
in-memory boundary doubles. The same nine waist checks fail eight cases against
the retained first freeze and pass all nine against the correction. These
native service checks do not verify authentication, persistence or real SQL.
The corrected candidate also passes all three focused Vitest suites: 47 tests
using approved read-only Node 22.23.3 x64/Vitest 5.0.2 dependencies in an owned
fixture, with contracts aliased to the exact candidate and owned caches.
The first ARM64 attempt failed before discovery because the existing native
binding is x64; it remains recorded. No dependencies were installed or changed.
This qualified unit execution is not pinned Vitest 5.0.3 CI, strict TypeScript,
lint, real SQL or live acceptance. Those checks remain unexecuted in this
assignment. Parent integrated review and normal batched pinned CI remain
required; #723 is not fully accepted and #724 is not activated.

The UI contract is one Daily page plus existing on-demand GenUI, not a widget,
separate Workouts/Nutrition pages or four fixed native views. No UI is supplied
here. Original Daily remains unchanged/canonical; protected export/backup,
private parity, real phone/provider, final-delta and rollback/cutover gates are
separate and unproven by synthetic checks. TickTick remains excluded.
