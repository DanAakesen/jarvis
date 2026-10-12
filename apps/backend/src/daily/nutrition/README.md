# Inactive nutrition services (P12-07)

Construct `NutritionStore.forRequest` only after existing Jarvis authentication. It resolves the existing server owner; no input selects an email/owner. This module has no routes, registered tools, composition flag, provider credentials or production writes. P12-09 owns integration with the existing sensitive-tool dispatcher and trusted confirmation/evidence context. That integration must never deserialize `IntakeAuthority` from model/client arguments.

`log` needs explicit intake intent; an already explicit exact-food request needs no second confirmation. Estimates (including ambiguous photo evidence) require accepted estimated intake. Lookup, recommendations and plans cannot log food. `MealInput` preserves supplied kcal, nullable macros, local date and original timestamp/offset, components and nutrient provenance. No Apple Health queue/export is invoked. Corrections/removals use expected revisions and retain tombstones; keyset history includes all dates. A retry of the immediately committed correction/removal returns that revision, while a stale competing change refuses. A logging retry after subsequent correction/deletion refuses rather than restoring old values.

SQL uses owner-bound parameterized operations, transaction-held key-range locks and at most three attempts for SQL deadlock 1205 only. Other failures do not claim success; callers can retry the same operation key. Source IDs are not normalized. SQL padded-key collisions fail closed. Favourite display-name aliases deliberately normalize NFKC/case/whitespace within the owner-local namespace; source IDs remain exact. Favourites copy an existing active intake. Persisted feedback excludes disliked canonical meal keys from `suggest`; P12-09 must use the same stable key for every alias of a meal. Suggestions use supplied authoritative local time and remaining kcal/protein context, never calculate maintenance calories. Missing budgets remain unknown.

Plan snapshots are separate from eaten food and never create meals/queue rows. Totals must equal supplied component quantities; any unknown macro keeps the total null. Additive migration 0042 permits null plan macros without rewriting data. Its down migration holds a table writer lock and refuses rollback while nulls exist; it never invents replacement zeros.

## Evidence still required

These are synthetic services, not live Daily/source/provider parity. The available source definitions establish tables/fields only. The nonsensitive source nutrition action/evidence contract and verified current Frida lookup/export format, food/nutrient identifiers, units, release/freshness and usage conditions are not supplied in this checkout. The official `https://frida.fooddata.dk/` request returned HTTP 403 in the coding environment. No endpoint/response format or current-reference values are invented, and no private source tools/records/exports are called. Lookup/provider completion remains open pending coordinator evidence. Existing Jarvis photo/voice evidence must be reused at composition; this module does not introduce another media model or ingestion pipeline.

Protected #717 backup, source/import reconciliation, live provider and physical-phone acceptance remain separate. Original Daily stays canonical and continues normal authorized writes; this code does not touch its code/schema/records. Daily remains default-off; no TickTick, frontend, infrastructure, second auth, production activation or cutover.

## Checks

`npm test --workspace @jarvis/backend -- src/daily/nutrition/model.test.ts src/daily/store/owner-store.test.ts src/daily/index.test.ts src/database/migrations.test.ts`

`npm run lint --workspace @jarvis/backend` and `npm run build --workspace @jarvis/backend`.

Real synthetic persistence is in `src/database/nutrition.integration.test.ts`, discovered by existing `npm run test:database --workspace @jarvis/backend` and authoritative GitHub Database CI. Local SQL image access remains forbidden; never target production. Exact-head results belong in the PR evidence, not assumed here.
