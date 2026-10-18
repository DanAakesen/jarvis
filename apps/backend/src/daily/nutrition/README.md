# Inactive nutrition services (P12-07)

Construct `NutritionStore.forRequest` only after existing Jarvis authentication. It resolves the existing server owner; no input selects an email/owner. This library does not register routes/tools, supply provider credentials or activate production writes. P12-09's optional compositions integrate the existing sensitive-tool dispatcher and trusted confirmation/evidence context. They must never deserialize `IntakeAuthority` from model/client arguments.

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

## Inactive internal direct intake

Explicit fourth-argument composition
`createDailyModules(true, data, undefined, data.nutrition)` registers
sensitive `daily_food` and `daily_food_review` tools in the existing dispatcher. It is independent of
MCP enablement and stays absent in production and ordinary read-only
composition. The direct `daily_food` input contains only `operation: log_favorite | log_exact`.

The persisted current Dan message supplies the complete saved name/alias or
exact label. Supported examples are `Log my favourite Dinner` and
`Log yoghurt: 200 kcal, protein 10 g`; quote multiword label names, for example
`Log "Cottage cheese": 123 kcal`. Decimal points have at most two places;
ambiguous comma/thousands quantities and unknown syntax refuse. Conditional,
negated or time-qualified requests do not write. This is an explicit-command
subset, not general conversational or new-estimate review parity.

Owner, message and active chat/voice session are verified; agent-supplied IDs
are checked against actual latest history. New writes require a current message
within ten minutes and use its instant/Copenhagen date, plus actual session
capture channel. Models cannot select a different food, quantity, date or key.
Explicit favourite selection accepts the existing saved portion without another
confirmation, preserving stored confidence and nulls. Its DTO fingerprint is
rechecked under SQL locks before commit.

One owner/session/message operation key prevents retry duplication. The stored
source-text/time fingerprint and operation bind real receipt recovery before
mutable favourite lookup. Edited sources, changed operation and deleted intake
refuse rather than silently recreating food. Exact committed replays do not
publish refresh again. Ordinary sensitive message-backed audit, canonical
meals and acknowledged-commit change publication stay shared. No new ledger,
migration, estimate approval system or Health export is added.

## Inactive internal reviewed changes

`daily_food_review` accepts a strict `change` object with one operation:
`log_estimate` and a proposed `food`, `correct` and an exact owned
`idempotencyKey`/`expectedRevision` plus `changes`, or `delete` and that exact
key/revision. Models cannot supply confirmation, owner, capture, confidence or
provenance fields. For example:

```json
{"change":{"operation":"log_estimate","food":{"mealName":"Proposed portion","energyKcal":200,"proteinGrams":null}}}
```

The current verified Dan message and active chat/voice session supply source
identity and capture. New logging defaults occurrence to the message instant;
a proposed explicit occurrence is displayed and validated, with Copenhagen
date derived server-side. Every new reviewed write requires present-mode
browser approval in Now; a plain spoken "yes" is not that approval.
The existing owner-bound one-time persisted confirmation is consumed before
its exact callback; explicit browser-only routing prevents Teams delivery even
if presence flips. Rejection, expiry, cancellation and changed presence refuse.
No new proposal dispatcher, generic approval callback or model authority.

The summary freezes exact before/after values, units, unknowns, dates and
revision within 4000 characters. Concurrent pending reviews for a target
refuse. Food cards expire after two minutes in SQL, the visible card and its
timer; the whole operation is bounded to three minutes from execution entry.
The hosted agent allows 210 seconds for this tool's response only, below the
240-second ingress ceiling. Existing approvals retain their default five
minutes; ordinary tool and connection deadlines are unchanged. No detached
write continues after cancellation. Nullable nutrient input uses a
single number/null JSON-schema type so HTTP coercion cannot invent zero values.
Store revision/range locks still own correctness after approval. Proposed
nutrient/component changes remain estimates and clear any whole-meal verified
claim; unchanged exact field provenance remains. Historical corrections and
soft deletion have no seven-day restriction and never queue Health writes.

Source/proposal fingerprints and existing SQL operation/revision identity
protect replay and actual receipt recovery. Deleted repeats return a real
`already-deleted` tombstone without pretending another delete occurred.
Direct supported exact labels and actual saved favourites use `daily_food`,
not redundant review. This source integration does not establish general
conversational/spoken/photo evidence, physical-phone or hosted-client
acceptance. Production remains off and original Daily canonical.

## Inactive internal saved food

An independent additive fifth factory composes `daily_saved_food`:
`createDailyModules(true, data, undefined, data.nutrition, data.nutrition)`.
The existing fourth argument and default/read-only/MCP compositions are intact.
`lookup_saved` takes an exact owned name/alias; `read_preferences` takes at most
50 canonical favourite IDs. Reads need no review, do not contact a provider and
distinguish missing revision0 from a persisted null clear.

`save_favorite` takes a name, aliases, expectedRevision and exactly one owned
sourceIdempotencyKey or proposed definition. `save_plan` takes a name,
description and owned favourite slot entries; `delete_plan` takes an exact ID
and expected revision. `set_feedback` takes the exact favouriteId, preference
(`like`, `dislike` or null) and expected revision. New records use revision0.
Internal operation IDs derive server-side from the verified current human
message; owner, operationId, confidence, provenance and confirmation arguments
are not accepted. New definitions are estimates, not independently verified.

Every mutation uses the existing present/browser-only native approval profile:
120-second SQL/card/timer expiry,180-second operation/voice-relay bound and
210-second hosted-agent read. Phone refuses before generic approval. Actual
source/target snapshots freeze before review; source revisions and favourite
fingerprints are checked again under canonical SQL locks. Replays return actual
rows/tombstones, and uncertain failures permit one matching readback, never a
write retry. Summaries over4000characters refuse without truncation.
Preference commits refresh favourites only after acknowledgement; unchanged
and replayed rows do not notify. None of these operations logs eaten food,
exports Health, activates Daily or proves real client/account/device acceptance.

## Owner nutrition targets

The owner's resting energy burn, daily deficit and protein target are three
Daily-owned `dbo.settings` rows (global scope, keys from `nutritionTargetKey`).
`targets.ts` holds the pure fields, ranges, key builder and strict parsers, and
`targets-store.ts` reads and writes them for the resolved owner. An absent row
means "needs configuration", not a default: nothing in this directory supplies a
value. `../routes/nutrition-targets.ts` serves `GET`/`PATCH
/daily/nutrition-targets` to the signed-in owner only, and
`../tools/nutrition-targets.ts` exposes `daily_nutrition_targets` (`read`, and
`set_targets`, which needs the exact browser Now approval). The sixth
`createDailyModules` argument composes both, only with Daily on and shared data.
Tests use synthetic values; a real figure never belongs in a fixture, document,
log or PR text because these are the owner's private health data.

## Personalised suggestion budget

`budget.ts` holds the pure arithmetic: allowance = resting target + active energy
burned so far today - deficit target; energy left = allowance - energy eaten so
far today; protein left = protein target - protein eaten so far today. Nothing
projects the rest of the day or estimates a BMR/TDEE. A missing target, a missing
or malformed burn reading, an unread page or a meal without a value is named by a
reason code and leaves the dependent figure null, never zero; a meal without a
protein value makes protein left an upper bound (`partial`).

`suggestion-adapter.ts` (`readNutritionSuggestions`) reads the owner's targets,
today's meals (the existing `history`), today's `active_energy` Health row
(`DailyHealthReadModel.history('metrics', ...)`) and the saved favourites, each in
at most three bounded pages, then calls the unchanged `suggestions` (energy filter,
protein ordering, persisted dislikes). Only the exact `active_energy` metric is
read, so resting energy is not counted twice; that name is trusted as stored and
is not verified against a live export. Only meals logged in Jarvis count and only
saved favourites are candidates, so unlogged food is invisible to it.

`../tools/nutrition-suggest.ts` exposes the read-only `daily_nutrition_suggest`
(sensitive, phone-denied, optional `limit`, 20-second bound). The seventh
`createDailyModules` argument composes it with Daily on and the targets accessor;
there is no production caller yet. Tests use synthetic values only.

## Pinned provider contract and evidence limits

An explicit optional Frida argument to `createDailyData(pool, owner, now, frida)`
adds owner-bound `foodLookup`; `createDailyModules(true, data)` then registers
read-only `daily_food_lookup` in the existing dispatcher. No adapter means no
new tool or network request. Existing module/write/MCP arguments stay unchanged.
Input contains only1-25 generic components with name, positive grams or null,
and preparationMethod or null. Shared schemas preserve the external MCP form;
the HTTP shape cannot coerce unknown grams into zero. Caller endpoints,
credentials, owners and confirmation fields are not accepted.

The tool and existing adapter use20second cancellation within ordinary caller
budgets; voice retains30seconds, not the reviewed-food exception. Preserve the
returned DTU5.5/release10/DOI attribution, retrieval time, incomplete totals,
matched subtotals and unknowns. Reference quantities are not verified eaten food,
and `confirmationRequired` never supplies native write authority. The shared
response-byte limit refuses oversized evidence rather than truncating it.
No SQL request/intake/Health write or refresh results from reference lookup.
Sensitive audit and unsupported-phone denial remain; this source binding does
not activate Daily, provision an account or verify a live provider/device.

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
That read-only composition registers no intake/write route or tool. The separate
internal composition above is explicit. An optional fourth
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

`npm test --workspace @jarvis/backend -- src/daily/nutrition/model.test.ts src/daily/nutrition/review.test.ts src/daily/nutrition/store.test.ts src/daily/nutrition/frida.test.ts src/daily/nutrition/handlers.test.ts src/daily/tools/food.test.ts src/daily/tools/food-review.test.ts src/core/owner-interactions.test.ts src/daily/store/owner-store.test.ts src/daily/index.test.ts src/database/migrations.test.ts src/modules.test.ts`

`npm run lint --workspace @jarvis/backend` and `npm run build --workspace @jarvis/backend`.

Real synthetic persistence is in `src/database/nutrition.integration.test.ts`, discovered by existing `npm run test:database --workspace @jarvis/backend` and authoritative GitHub Database CI. Local SQL image access remains forbidden; never target production. Exact-head results belong in the PR evidence, not assumed here.
