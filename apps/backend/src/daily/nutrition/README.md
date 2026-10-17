# Inactive nutrition services (P12-07)

Construct `NutritionStore.forRequest` only after existing Jarvis authentication. It resolves the existing server owner; no input selects an email/owner. This module has no routes, registered tools, composition flag, provider credentials or production writes. P12-09 owns integration with the existing sensitive-tool dispatcher and trusted confirmation/evidence context. That integration must never deserialize `IntakeAuthority` from model/client arguments.

`handlers.ts` supplies typed functions for existing P12-09 composition, not registered tools/routes. Its trusted execution context derives user intent/proposal acceptance from existing Jarvis metadata, never legacy/model `userConfirmed`. Text/voice inputs and photo/portion proposals reuse existing Jarvis transcription/attachment/frame evidence; no new vision model or upload pipeline. Explicit exact-label/favourite logging needs no second confirmation. Photo/portion estimates require acceptance of the displayed proposal even if model arguments claim accurate confidence. Lookup, recommendations and plans cannot log food. `resolveNutrients` gives exact user quantities priority over estimates; unknown macros stay null. Existing `accurate`/`approximate`/`estimate` and `voice`/`photo`/`text`/`mixed` vocabulary is preserved.

Occurrence defaults to trusted request time and Copenhagen local date when absent; explicit timestamps/offsets are retained, with a matching Copenhagen date required for new writes. Log/correction validation rejects occurrence beyond trusted time plus five minutes, unsupported meal types (breakfast/lunch/dinner/snack/other or null), kcal above 10000 and nutrient grams above 1000. Historical dates and null unknowns remain valid; imported history is not retroactively rewritten or capped. Whole-plan server totals are not subject to per-meal caps. Meals persist until explicit soft deletion: no expiry filter/cleanup is added; new handler-created meals use a non-expiring marker for the retained non-null legacy expiry column. Canonical JSON preserves replay identity across object key order. Corrections/deletions address exact owner-bound idempotency keys with expected revisions, without a seven-day cutoff or client-selected record IDs. Tombstones preserve values/provenance. Retrying the immediately committed correction/deletion returns that revision; stale competing changes refuse. No Apple Health queue/export is invoked.

SQL uses owner-bound parameterized transactions/range locks and at most three attempts for deadlock 1205 only. Other failures do not claim success; uncertain commits can be retried with the same operation key. Diagnostics are sanitized, including driver TypeErrors. IDs never normalize; padded-key collisions refuse. Favourite/plan search uses the verified legacy NFKD, combining-mark removal, lowercase, non-a-z0-9-to-space normalization. Display aliases stay raw, and legacy normalized names and display names are compared without an importer rewrite. Owner-local namespaces are locked across reuse/collision checks; more than 1000 rows fail closed rather than silently omitting matches. Genuine ambiguity refuses. Saving selects exactly one undeleted source idempotency key or an explicitly accepted supplied definition; normalized-name reuse updates the original favourite ID. Deleting source intake does not erase independent favourite snapshots. Exact saved favourites/aliases precede historical meal-name matches. Favourite/plan collections have bounded keyset pages. Like/dislike/null feedback supports retry-safe owner-bound clearing with exact operation keys. Suggestions always query persisted owner feedback for bounded canonical keys, use authoritative local time/remaining budgets (including over-budget negatives), and never recompute maintenance or invent meals/quantities. P12-09 must retain one canonical meal key across aliases.

Plans accept exactly one breakfast/lunch/dinner plus optional snacks (3–50 slots), each referencing an owned favourite. The server resolves and snapshots names/components/nutrients/provenance and sums totals; model totals are rejected. Normalized plan-name reuse preserves its ID and uses optimistic revisions. Unknown macros keep their totals null. Plans never create meals/queue rows. Additive migration 0042 permits null plan macros; 0043 permits confirmed standalone favourite definitions without fabricated source/intake IDs and retains favourite provenance. Writer-locked down scripts refuse to discard unknowns, definitions or provenance, rather than inventing zeros or source references.

The hosted saved-food continuation reuses these handlers for favourites/aliases,
plan save/soft-delete and canonical like/dislike/clear. Native review displays
actual source snapshots; trusted revision/fingerprint context is rechecked
under SQL locks. Shared `preparePlan` generates both review and persisted items
and totals. Migration 0050 adds target-only favourite/feedback revisions and
retains null-clear tombstones. Exact repeats return actual rows without another
update; older conflicting retries refuse. An absent preference's revision 0 is
only an initial-version sentinel, not a persisted record. The existing optional
internal feedback call remains available; it does not confer native authority.

## Pinned provider contract and evidence limits

Coordinator supplied read-only source action contracts at original HEAD `9e193554c9c8c7c23a788ed3d2b0582580b76c0f` and independently verified public Frida DTOs/session/endpoints. The migration deliberately pins release 10 / Frida 5.5 (November 2025), DOI https://doi.org/10.11583/DTU.29500682, dataset version 8 published 19 January 2026. DTU XLSX/ODS data are CC BY 4.0; PDF documentation retains DTU copyright. We use the documented public API, not downloaded dataset bytes, so no binary checksum/export claim is made. Every lookup carries DTU/version/release/DOI attribution and per-100-g edible-food basis.

`FridaLookupAdapter` uses only `https://fcdb.fooddata.dk/api`: anonymous `/antiforgery`, `/food/10` and `/foodParameter/10/{foodId}/consumer`. No borrowed cookie/token or provider credential is used. Coordinator-observed immutable catalogue count 1381 guards against silent truncation, with duplicate/release validation. Nutrient IDs 356 kcal, 218 protein g, 172 available carbohydrates g, 168 fibre g, 141 fat g retain nullable values and source IDs. Inputs are 1–25 components, names/preparation ≤120 characters, grams >0 and ≤5000, with at most three candidates. Matching normalizes Danish ae/oe/aa/accents; a unique exact match or conservative separated token match is selected, otherwise ambiguity is explicit. Unverified preparation has an uncertainty marker, not an invented yield factor. Scale known values by grams/100; incomplete totals stay null and matched subtotals are separately labelled. Every lookup is read-only and confirmation-required.

Coordinator public-format verification at 16:17:51 UTC confirms an empty `/antiforgery` body, response `X-XSRF-TOKEN` header and `XSRF-TOKEN` cookie, synonym arrays, numeric nutrient values and numeric provenance arrays in the inspected sample. The adapter rejects string/null synonym fields and numeric-string nutrients; missing/null values and provenance stay unavailable rather than inventing zeros/IDs or source coverage. Unknown object/string provenance structures fail closed. No anonymous session values were shared or borrowed.

Coordinator verification at 17:21:55 UTC confirms requested food/release identity on groups and mapped nutrient rows. Both identities must match before caching; donor `sourceFoodIds` remain independent provenance. Scaling and accumulation reject non-finite calculated values rather than reporting complete totals.

Requests have a 20-second overall deadline/cancellation, bounded JSON, three transient HTTP attempts maximum, ten-minute public caches capped at 200 nutrient records and sanitized failures. Synthetic tests verify the supplied contract/boundaries; live availability and complete-source migration parity are not inferred. Cloud fcdb access fails at CONNECT with HTTP 403; no network-policy bypass. No private source tools/records/exports are called.

Protected #717 backup, source/import reconciliation, live provider and physical-phone acceptance remain separate. Original Daily stays canonical and continues normal authorized writes; this code does not touch its code/schema/records. Daily remains default-off; no TickTick, frontend, infrastructure, second auth, production activation or cutover.

## Checks

The optional [hosted nutrition MCP adapter](../mcp/README.md) now provides
an inactive external composition of these same typed handlers. It has a
separate least-privilege delegated identity and native proposal review; it
does not deserialize the trusted execution context from model input.
Its all-write review requirement is an explicit external limitation, not a
change to internal exact-label logging. Production composition stays off.

The inactive P12-09 shared query service reads bounded meal history, favourites
and meal plans. Collection sources use exact ID-only cursors (at most 100 rows),
not invented date periods or intake totals. Whitelisted DTOs preserve raw display
aliases, saved nutrient provenance and plan snapshots/revisions/tombstones.
No new intake/write route or tool is registered. An optional fourth
`NutritionStore.forRequest` argument (third `createNutritionHandlers` argument)
accepts the shared Daily change hub. Log/correction/deletion mark a domain
change inside their existing transaction and publish only after acknowledged
commit; exact operation/revision replays do not publish again. Failed attempts,
uncertain commits and deadlock retries cannot advertise a committed revision.
Supplied notification sinks use the existing event-listener error boundary;
a sink failure cannot fail an acknowledged mutation or trigger SQL replay.
Existing intent/proposal checks and Apple Health metadata behavior are unchanged.
The new synthetic commit/publication controls supplement, not replace, real
SQL and hosted-client/device acceptance.
Favourite saves and plan saves/deletions use the same safe hub with their
actual collection source; retained plan replays do not announce another change.

`npm test --workspace @jarvis/backend -- src/daily/nutrition/model.test.ts src/daily/nutrition/store.test.ts src/daily/nutrition/frida.test.ts src/daily/nutrition/handlers.test.ts src/daily/store/owner-store.test.ts src/daily/index.test.ts src/database/migrations.test.ts src/modules.test.ts`

`npm run lint --workspace @jarvis/backend` and `npm run build --workspace @jarvis/backend`.

Real synthetic persistence is in `src/database/nutrition.integration.test.ts`, discovered by existing `npm run test:database --workspace @jarvis/backend` and authoritative GitHub Database CI. Local SQL image access remains forbidden; never target production. Exact-head results belong in the PR evidence, not assumed here.
