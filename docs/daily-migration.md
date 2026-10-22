# Approved Daily migration to Jarvis

## Withdrawn database export/import approach (18 October 2026)

The owner cancelled the Sites database-export/bundle-import approach. PRs #741
and #987 remain closed and unmerged; #717, #721 and #982 are not planned.
Merged P12-22/#968 bundle-validation tooling and its dedicated format/runbook
documentation were removed under #1006. That synthetic tooling never read or
moved source records.

The source-contract-first direction is #1005: implement the Jarvis API and SQL
schema from the original Daily API/schema and support historical ingestion
through that contract. This is separate from eventual legacy retirement under
#734. Preserve the original Daily and its data; this cleanup does not switch it
off, alter its API, or change permanent health ingestion/processing or SQL
migrations. Keep the [source-to-SQL mapping](daily-schema-mapping.md) as
implementation evidence, not as an export manifest or bundle-import plan.

## Owner-approved #1005 scope (18 October 2026)

For the sixteen selected source capabilities only, this scope supersedes the
15 October exclusion below: nutrition history, analysis and calorie balance,
conversational coach status, profile, meal-preference and recovery-period reads
and confirmed owner writes are delivered as data-only native tools on the
existing services. The exclusion still stands for new coaching, recomposition
and recovery automation, commitments, orders, weekly experiments, meal plans,
fixed Status renderers and Apple Health meal write-back. The decision is
recorded in [the decision log](decisions.md) and `PRODUCT.md`, and the
source-to-Jarvis mapping is in
[the implementation matrix](reference/daily-v182/source-to-jarvis-matrix.md).

## Current approved scope (15 October 2026)

Dan explicitly excluded NEW P12-08/#723 coaching/recovery/recomp automation
from planned scope and the combined release. This is a confirmed exclusion,
not a proposal, completed acceptance or permission to remove existing main
Daily health, nutrition, workout/tracking, integration capabilities or records.
The first and corrected unmerged coaching freezes remain byte-exact archived
evidence only; they are not release inputs.

Keep one mobile-first Daily page plus existing on-demand GenUI in the single
assistant conversation: no widget, separate Workouts/Nutrition pages or four
mandatory Status/Recomp/Review/Ready views. Conflicting widget/fixed-view and
coaching descriptions in the historical issue inventory below are superseded.
Core #724 API/tools work excludes new coaching and does not require #723
completion; replace only PLAN P12-09's dependency cell with retained completed
P12-05/#720 and P12-07/#722 so plan-status cannot recreate the removed blocker.
All Status cells, task IDs and the other 380 table rows remain byte-exact;
parent owns native dependency/issue reconciliation after the source update.
Neither this scope decision nor retained reserved IDs activates Daily or
releases #724.

Do not invent maintenance/TDEE, nutrition-completeness, elapsed freshness
expiry or readiness-scale semantics for an excluded feature. The one exception
is Dan's later, narrow ruling on owner-configured nutrition targets: the
suggestion allowance is the owner's resting burn plus active energy so far today
minus the owner's deficit (see the decision log), with no BMR/TDEE estimate and
no coaching. Missing new
coaching contracts are not completion gates for retained core work. Existing
core validation, truthful unknowns/freshness and source-compatible API/schema,
historical ingestion, authoritative-source/parity, real-device/provider, final-delta,
rollback and cutover gates remain unchanged. Scope the acceptance campaign to
retained capabilities, not removed coaching/widget/fixed-view deliverables.
Original Daily continues normal authorized use and remains canonical before
cutover; original source/schema/data and retained records are not changed.
The original Gym/Run weekly targets and daily steps came from a task source
outside this approved scope; P14-45 replaces that source only with owner-set
Jarvis targets and adds no task-source integration.

Dan approved P12 on 12 October 2026 and explicitly released only P12-01 for this worker. The later [execution authorization](https://github.com/DanAakesen/jarvis/issues/716#issuecomment-6124634183) supersedes the original backlog-only and extra cutover-approval wording: any eventual production cutover follows dependency, source-parity, rollback and retention gates. Original Daily continues ordinary authorized food/health writes and remains running/canonical before cutover. The cancelled database-export/import tooling must not alter its application/source code/schema or rewrite records; the source-contract-first API/schema and supported historical ingestion/replay are specified in #1005. Any future final-delta reconciliation accounts for ongoing normal use. Legacy operation may be deprecated only after all in-scope data, features and sync are migrated and verified and rollback is protected; never delete the original repository or data. New secrets/access and unapproved paid resources retain their explicit-confirmation boundaries. This issue performs no cutover or production writes.

## Integration contract implemented by P12-01

- Existing Jarvis authentication, session and server-resolved user/owner across pages, meals, chat/voice and artifacts. No second login, copied human password, client-provided owner or replacement shell/dispatcher/voice stack.
- `apps/backend/src/daily/index.ts` exports `createDailyModules(enabled = false)`. This trusted server composition flag accepts only boolean true; disabled composition is an empty array. Production composition does not import or enable Daily yet. No environment variable, navigation or write activation is added by P12-01. (P12-09 later adds the default-off `JARVIS_DAILY_ENABLED` composition described below.)
- Explicitly enabled contract composition provides only authenticated `GET /daily/capabilities` metadata with no-store caching. It reports contract-only stage, reserved view IDs, and empty implemented page/tool lists. It accepts no query fields or owner parameters and exposes no identity or health record. This is not a Daily data API.
- `resolveDailyOwner(request)` consumes only existing root-authenticated request principals and `request.server.ownerObjectId`. A matching delegated user or verified hosted Jarvis agent resolves to the same configured owner; the agent's service object ID is never used as a data owner. Coding runners, bridge/event/deploy identities and other users are denied. Device authentication/scopes remain P12-04/P12-11/P12-12, not implemented here.
- Shared contracts reserve `daily-status`, `daily-recomp`, `daily-review`, `daily-ready` under source/module `daily`, version 1. These are reserved identifiers only, not generated renderer registrations or functioning views; Dan's 15 October scope does not require native views for them, and P12-16 is on-demand GenUI instead.

## Downstream interfaces and ownership

Dan's tool-parity reminder applies to all retained Daily workflows: page and
chat/voice share services, data, calculations, owner checks and write authority.
Periods, history/details, requested visuals and permitted changes need a working
tool equivalent. Use existing query/workspace/GenUI tools where appropriate;
do not add a tool per UI button or declare UI-only functionality complete.
Protected or unavailable operations stay explicitly gated, not bypassed through
a model flag. Excluded coaching/widgets and private activation are not restored.

P12-09 owns actual `/daily/…` data routes, shared services used by pages and tools, module composition activation, source-message idempotency and revision invalidation. Use the existing sensitive tool registry/dispatcher with content-redacted audit outcomes; no new dispatcher. Writes publish revisions only after committed persistence. P12-15 owns the gated single Daily page, P12-16 owns on-demand GenUI over bounded Daily datasets. Same-ID updates and reconnect/refocus refresh reuse existing workspace/artifact lifecycle and owner-authorized reads; do not widen CSP, bridge or generated-code network permissions.

The inactive internal direct-intake continuation adds an optional sensitive
`daily_food` catalogue entry, independently of external MCP writes. Current
verified Dan messages supply names/label quantities and stable source-message
identity; model arguments contain only the operation. Saved favourite snapshots
are checked under SQL locks, receipts recover actual committed rows, and
deleted/source-edited retries refuse. This first explicit-command subset is not
full internal estimate/correction/deletion or conversational acceptance.
Released inactive #874 adds `daily_food_review` using real
browser-only Now one-time approval for estimates, revisioned corrections and
soft deletion, preserving the one-step direct tool. Reviews bind frozen
before/after values and dates to source/operation identity, require present mode,
and cannot route health summaries into Teams. Rejected/cancelled/stale reviews
do not write; canonical locks/replay/tombstones/commit refresh stay shared.
Food cards use an explicit two-minute expiry with matching SQL/card/timer
lifetimes, a three-minute whole-operation bound and a 210-second agent read
deadline, within the actual hosting request ceiling. Other approvals retain
their five-minute default; no detached mutation queue or infrastructure change.
Browser approval is not verified spoken/photo/device or general conversation
acceptance; no complete #724 claim follows.
Qualified `d17fe622` and actual merge `f1d410b1` share tree `c0f112bf`.
Normal Deploy39006050135 passed backend/agent/Smoke with infrastructure/web
skipped, ready backend0000335 and active hosted-agent106. Routine smoke14/15ok
retains the PC bridge warning; chat identity was ok without a causal-fix claim.
The #724 opening retains remaining internal saved-food/plan/preference/lookup,
conversational, actual client and private migration acceptance.
Released inactive #875 groups those internal saved-food operations in
an independently opt-in fifth factory. `daily_saved_food` reads owned matches
and preferences, and native-reviews favourite/alias saves, server-snapshotted
plans/soft deletion and canonical like/dislike/clear. Canonical writers,
source/revision/fingerprint checks and real receipts stay shared; no intake or
Health write follows. Browser voice and agent wrapper deadlines are explicitly
aligned with the existing two-minute food approval. Qualified14e and actual
merge195bc89c share treec12eca94; normal Deploy39010283459 released ready
backend0000336/active agent107 with14/15smokeok, only existing PC bridge down.
This does not complete conversational or client acceptance.
Released inactive #876 binds the existing Frida adapter through
an optional owner-bound data capability, preserving default compositions and
external component validation. It returns public reference/unknown/partial
evidence only, never intake authority; no live-provider call or proof follows.
Qualifieda8 and actualmerge9334d3ed share tree6da17b0c; Deploy39012842333 selected
backend only, ready0000337/health200. Actual13/15smokeok retains PC bridge down
and recurring identity degraded, without source attribution. Native UI links
remain open; any early inactive UI preparation needs an explicit source-work
decision, not a claim that actual grant/private/client/device acceptance passed.
No production activation, private migration, provider/device action or native
dependency change follows from this source work; #724 remains open.

P12-03 owns SQL owner mapping to the configured Jarvis owner, stable source IDs, revisions and tombstones. No client or device selects a source owner. Future device credentials bind server-side to that owner with narrow upload, widget-read or nutrition-export scopes; no arbitrary tools or unrelated data. Coding sandboxes receive neither those credentials nor private Daily records. No production schema or device auth is implemented in P12-01.

Daily implementation stays under `apps/backend/src/daily/**`, future frontend `apps/web/src/daily/**`, and minimal additive `packages/contracts/src/**`. Coordinate shared contract/composition/navigation files with ongoing Jarvis work; preserve all unrelated shared-doc entries. P12-01 avoids GitHub App, presence, Google approval, shell, voice and dispatcher runtime areas touched by other PRs. Later PRs must recheck ownership and latest main.

## Approved scope by existing issue

The following are planned downstream functions, not implemented claims. Existing issue URLs and native dependency links are reused; do not create duplicate issues or automatically dispatch work. TickTick adapters, tasks/habits/countdown surfaces and active TickTick snapshots are excluded throughout.

### [P12-01: Shared owner, module & staged-rollout contract](https://github.com/DanAakesen/jarvis/issues/716)

**REUSE EXISTING JARVIS — permanent** · Integration contract & protected inventory

Bind Daily to the existing server-resolved user and app-wide login; agree API / tool / view interfaces, gated activation and shared-file ownership with ongoing Jarvis work.

Before downstream engineering, record this approved P12 backlog and its existing issue URLs in PLAN.md and relevant product/architecture/decision documents; never create duplicate issues. Define the activation flag and owner resolution for user and hosted-agent calls.

### [P12-02: Protected export & inventory](https://github.com/DanAakesen/jarvis/issues/717)

**CANCELLED — not planned (18 October 2026).** No Sites database exporter,
private export inventory, or bundle prerequisite is active. The historical
source-to-SQL mapping remains in [daily-schema-mapping.md](daily-schema-mapping.md);
source-contract-first API/schema and supported historical ingestion are tracked
in #1005.

### [P12-03: Daily SQL schema & owner mapping](https://github.com/DanAakesen/jarvis/issues/718)

Sequentially released after closed #716; #717's cancelled export path is not a prerequisite. [Explicit source-table/field mapping and compatibility limits](daily-schema-mapping.md) preserve supplied schema definitions and source-to-target constraints. P12-03 adds only empty owner-bound SQL tables and an inactive authenticated-owner read boundary; no source records were imported, and no downstream service, device auth, UI or Daily activation follows from this schema work.

**NEW DAILY CAPABILITY — permanent** · Integration contract & protected inventory

Owner-bound health / food / coaching / Google-feed tables; stable IDs, revisions, soft deletes and idempotency. Allocate migration numbers against current main.

Preserve source IDs, revisions, deleted tombstones, ingestion provenance, readiness, recovery, nutrition feedback and Google-feed suppressions. Bind every imported record to Jarvis's existing owner, resolved server-side; never trust a client-supplied owner or email.

### [P12-04: Azure ingestion, device auth & durable buffer](https://github.com/DanAakesen/jarvis/issues/719)

**Revised inactive scope, directly approved 13 October 2026:** `daily/health-upload` reuses the existing backend and SQL. Explicit default-off composition registers the two exact POST paths with hashed owner/scoped/revocable device checks. Migration 0046 adds a raw inbox and capability table. HTTP 202 follows the raw/receipt SQL commit, never processing; SQL unavailable returns 503 for the phone to retry. Owner/kind/automation/session, device, checksum and length protect exact retries and conflicts. No separate host, Blob/Queue, identity, resources, grants or activation. [Contract/checks/gates](daily-health-ingestion/README.md); #720 and live/device acceptance remain separate.

Verified source heartbeat accepts authenticated bodyless POST without Content-Type. The target stores bounded private `shortcut-name` provenance (default `Health Overview heartbeat`) and checked feeds `metrics`/`workouts`, without claiming measurements were received or processed. Upload JSON validation remains separate and strict.

The separate unregistered SQL lifecycle library retains protected random prepared handles, idempotent issue and terminal revocation. A transaction atomically revokes the old capability and reserves/issues one same-device, narrowed-scope replacement. Retain the same handle after response ambiguity; SQL atomicity does not make secret delivery exactly once. No real provisioning or protected custody/delivery channel is created.

Maintained client/instance request-rate guards still run before credential/database work. Uploads are bounded to 8 MiB; an owner inbox retains at most 256 MiB and 10,000 rows before 503 backpressure, without automatic age deletion. Verified processing/retention/compaction, ingress identity, deployed quotas, actual phone retries and protected backup/rollback remain activation gates. The [old host/Blob/Queue proposal](daily-health-ingestion/legacy-host-proposal.md) is superseded and unused; its cost/recovery questions are withdrawn.

**NEW DAILY CAPABILITY — permanent** · Backend & migration rehearsal

Existing backend upload / heartbeat routes, owner-bound SQL raw inbox, hashed device capabilities and truthful acceptance state.

Keep Health Auto Export JSON uploads and heartbeat. Device credentials are owner-bound, scoped and revocable, never the human password. Commit acceptance durably in existing SQL, distinguish accepted from processed, and return 503/retry when SQL cannot accept. An acknowledged upload remains in SQL through agent/processor downtime. Secret/access changes and any future paid service still require normal explicit approval.

### [P12-05: Health processor & sync read models](https://github.com/DanAakesen/jarvis/issues/720)

**Current inactive local slice:** the [coordinator release](https://github.com/DanAakesen/jarvis/issues/720#issuecomment-6154043444) follows reviewed/deployed #805's revised existing-backend/SQL design. `daily/health` supplies a pure source-shaped normalizer, explicit one-row transactional processor and authenticated owner read models; migration 0047 adds bounded retry/lease/quarantine evidence. No automatic processing or production route/tool composition. [Contract and acceptance limits](../apps/backend/src/daily/health/README.md); live/device/privacy gates remain open even when code dependencies are closed.

**NEW DAILY CAPABILITY — permanent** · Backend & migration rehearsal

Metrics, sleep, workouts, workout detail and minute HR; unit conversion, local dates, retry / poison-queue handling.

Preserve metrics, sleep/wake dates, distinct qualifying workouts, workout details and minute heart rate. Normalize units and Copenhagen local dates. Same session/checksum is idempotent; changed payload conflicts safely; empty workout exports succeed without erasing history. Bound retries and poison handling; update processed freshness after committed SQL, not after heartbeat.

### [P12-06: Import, reconcile & shadow comparison](https://github.com/DanAakesen/jarvis/issues/721)

**CANCELLED — not planned (18 October 2026).** No bundle importer, database
staging or Sites-to-Azure shadow comparison is being delivered. Stable IDs,
revisions, tombstones, owner mapping and source-specific semantics remain
relevant to the source-compatible API/schema and historical ingestion work in
#1005; this cancellation does not authorize data movement or change permanent
ingestion.

### [P12-07: Nutrition tools, Frida & meal planning](https://github.com/DanAakesen/jarvis/issues/722)

Released after closed/deployed #718. Draft #743 implements inactive nutrition services/typed handlers from supplied legacy contracts, server-resolved plan snapshots and guarded 0042/0043 migrations. [Boundary and validation](../apps/backend/src/daily/nutrition/README.md) records read-only source/public format evidence. Preserve Frida 5.5/release 10 with DTU/DOI attribution, per-100-g units, nullable nutrients/unavailable provenance and separate incomplete subtotals. Bootstrap is verified empty-body plus public token header/cookie; no session values are borrowed. Cloud CONNECT is blocked with HTTP 403. No live provider success, historical replay, Apple Health queue or activation. P12-09 owns trusted evidence/confirmation/runtime registration. Final exact-head CI and independent review precede readiness/release; source-contract, replay/live-provider and phone acceptance remain separate.

**NEW DAILY CAPABILITY — permanent** · Backend & migration rehearsal

Lookup, log / edit / delete, full history, favourites / aliases, plans and persisted like / dislike / clear behaviour. Draft #743 restores legacy name normalization and raw display-alias compatibility, rejects deleted source intake for new favourites, validates new-write meal domains/caps/trusted time/Copenhagen dates, and verifies Frida group/row identity and finite arithmetic. Synthetic SQL covers stable-ID reuse, ambiguity, owner isolation and clearing; exact-head CI and independent acceptance remain required.

Text/voice/photo lookup and current Frida data; exact-once confirmed food logging; full history and edits beyond 7 days; soft deletion, aliases, favourites, plans and persistent likes/dislikes. Suggest proactively using time of day and remaining budget; disliked meals must not return. Keep intake, protein and other macros from actual records; never silently invent missing quantities.

### [P12-08: Coaching, recovery & recomp services](https://github.com/DanAakesen/jarvis/issues/723)

**WITHDRAWN NEW FEATURE - confirmed 15 October 2026.** Retain this native issue
link as historical scope context, not an active implementation or acceptance
requirement.

The earlier proposal covered automated coaching/targets, deficit comparisons,
recomp trends, consistency, readiness/recovery guidance and experiment
commitments. Dan has excluded that new automation; neither missing semantic
contracts nor its candidate tests are remaining core-delivery prerequisites.
The two frozen candidates are archived, not accepted/merged release inputs.

Preserve existing main tracking capabilities, measurements and retained
readiness/recovery records. Exclusion does not authorize original-source,
schema or data changes, deletion, invented budgets/classifications or weaker
core parity/backup/device/cutover gates.

### [P12-09: Daily API, tool registry & live revisions](https://github.com/DanAakesen/jarvis/issues/724)

17 October bounded feed continuation adds opt-in `daily_feed` over the retained
#725 snapshot, attention, manual-refresh and suppression services. Reads expose
independent source freshness and exact restore keys; mutations use actual
browser Now approval and under-lock target checks. Shared sensitive audit and
post-commit refresh remain authoritative. The nutrition-only MCP principal is
denied by every feed entrypoint. Missing Google/model configuration remains
explicit; no fake adapter, new dispatcher, query-version expansion or provider
write is introduced. Daily stays off; real grant/provider/private/device
acceptance remains distinct under #725. #724 and native dependencies stay open.

The next retained lookup slice exposes the existing saved favourite/alias and
exact history resolver through `lookup_food.savedName`, sharing query DTOs.
It adds no tool name, write authority, migration or activation.

The following cohesive saved-food continuation adds retained favourite/alias
saves, owned-favourite plan snapshots/save/soft-delete and persistent canonical
likes/dislikes/clears. It uses native review, shared snapshot preparation,
under-lock source rechecks and real versioned receipts. Additive 0050 protects
favourite/feedback revisions, clears and new constrained audit names without
rewriting 0049. No intake, activation or internal message authority follows.
Exact-head source qualification is required; account/device/private/cutover
acceptance and #724 remain open.

17 October source continuation: the existing JarvisPM session adds an optional
[nutrition-only hosted MCP adapter](../apps/backend/src/daily/mcp/README.md).
It reuses delivered reads and existing typed writers, a separate delegated
Entra principal, exact route isolation and native signed proposal review.
Existing audit storage gets constrained UUID correlation rather than fake
conversation IDs; no new audit table. Browser Origin requests are unsupported
and rejected, without broadening shared CORS.
Production composition/configuration and the write gate remain off. Source
delivery does not establish a linked, accepted ChatGPT account.
Modern-protocol/native-review compatibility and complete retained tool parity
remain explicit acceptance gaps, alongside real scopes/grants, source/provider,
phone, source-compatible historical ingestion and cutover. No access/consent or private
operation is performed; #724 stays open and #730 retains its dependencies.

16 October continuation after #866's successful release: the current JarvisPM
UI session extends the delivered read foundation with retained favourites and
meal plans. Reuse existing owner-bound collection stores, ID-only pagination
(100 maximum), whitelisted snapshots and the same post-commit refresh hub.
Definitions/plans are not consumed meals. This is another partial inactive
#724 slice, not the hosted authenticated ChatGPT food-write path or activation.
Original Daily and all private/provider/device/reconciliation/cutover gates stay
unchanged; no coaching, widget or duplicate worker.

16 October bounded resumption: the existing Daily session owns an inactive
shared read-contract/API/tool and post-commit refresh slice over #720/#722.
Production composition and all existing data remain unchanged. This does not
complete #724 or implement its hosted authenticated ChatGPT food-write path.
Connector authorisation and trusted proposal-acceptance contracts, the one-page
UI/on-demand GenUI, source-compatible API/replay, source/parity, device and cutover gates
remain explicit; coaching and widgets stay excluded. Historical task-table
Status cells are workflow-owned and are not implementation evidence.

**NEW DAILY CAPABILITY — permanent** · Backend & migration rehearsal

Gated Daily BackendModule, source IDs, shared read-model contracts, sensitive outcome audit and UI invalidation.

Register Daily through BackendModule, with shared services for UI and tools, owner validation for user and hosted-agent calls, source-message idempotency and sensitive audit metadata only. Refresh stable views after committed revisions/reconnect/refocus. Gated-off Daily contributes no accidental routes/tools/navigation or production writes; no new dispatcher or alternate user authentication.

Current core scope explicitly excludes NEW P12-08/#723 coaching/recovery/recomp
automation and its routes/tools/views. #723 completion and missing
coaching-specific semantics are not prerequisites for this retained
integration. Its PLAN dependency cell instead retains completed P12-05/#720
and P12-07/#722 prerequisites, not bypassed checks. Parent reconciles native
dependencies separately after this source update; no #724 implementation or
activation is released by this documentation change.

### [P12-10: Google feed, all calendars & attention](https://github.com/DanAakesen/jarvis/issues/725)

After inactive #746 merged, scoped continuation draft #754 corrects caller calendar-range preflight, numberless delivery grouping and SENT-alias direction. No live acceptance or activation is implied. Exact-head synthetic/isolated SQL/full CI and independent review are required; only explicit coordinator release may mark this follow-up ready. Issue/native gates remain open.

Released after closed/deployed #718 and merged #722. [Inactive feed services](../apps/backend/src/daily/feeds/README.md) use coordinator-verified pure consumer/public producer contracts for resumable bounded Gmail/calendar reads, exact selectors, mapped owner-local snapshots/suppressions and manual refresh. The existing protected chat identity/settings/catalogue/usage boundary supplies tool-free JSON extraction with strict local schema and source-timestamp checks; failures remain unavailable, never guessed. Per-source size checks preserve healthy-source success. Consent, deployed-model/live parity/private/phone gates remain open; no new resource/key, OAuth change or activation. Coordinator accepted 895b7c3/full CI 38310725882 for a reviewed inactive intermediate release through #746; final documentation/exact-head CI precede readiness. Refs #725 remains, with the issue open and native dependencies intact. Full acceptance still requires manual CalendarList owner consent, deployed identity/model and Google/provider parity, source-compatible Daily ingestion and physical-device evidence.

**REUSE EXISTING JARVIS — permanent** · Personal integrations & phone surfaces

Reuse existing Google auth and read APIs; extend all visible calendars, Gmail attention, waiting states, deliveries and suppressions. Coordinate shared Google code with ongoing approval work.

Reuse Jarvis Gmail/Google Calendar connections for the same user. Include all visible calendars, waiting-for-you/others, active deliveries, suppressions, freshness and manual refresh. Verify required provider scopes and do not claim an unavailable feed works. No TickTick adapter, personal-task/habit/countdown UI or active snapshot import.

### [P12-11: iPhone widget — cancelled](https://github.com/DanAakesen/jarvis/issues/726)

Cancelled by Dan on 15 October 2026 and closed as not planned (#726), not delivered.
The text below is the superseded original requirement, not a backlog; the ordinary
mobile destination is the single Daily page (P12-15). No widget endpoint, device
credential, refresh or deep-link work is planned. Health Auto Export ingestion and
the optional nutrition export (P12-12) are unaffected.

**NEW DAILY CAPABILITY — permanent** · Personal integrations & phone surfaces

Minimal Azure widget surface, narrow device credential and links into Jarvis Daily / conversation.

Keep a small read-only phone glance with owner-bound credentials and Jarvis links. Verify actual iPhone refresh and navigation. Credentials must not log food, call arbitrary tools or expose unrelated private records.

### [P12-12: Apple Health nutrition export Shortcut](https://github.com/DanAakesen/jarvis/issues/727)

Released inactive slice on `codex/p12-12-nutrition-export` / draft #758 after closed/deployed #722. Coordinator [verified pure source contract](https://github.com/DanAakesen/jarvis/issues/727#issuecomment-6134567097) supplies claim/complete DTOs and optional native-write guidance; no original records were read. Target replaces unsafe requeue/ACK behavior with scoped owner-bound device capability, exact-period trusted confirmation, revision/expiry uncertainty, no-instruction claim replay and identical receipt replay. Canonical SQL meals/ordinary logging remain independent; no native re-ingestion or automatic export. [Inactive boundary](../apps/backend/src/daily/nutrition-export/README.md) and [unverified phone guide](nutrition-export-shortcut.md) keep provisioning/activation/live/private/iPhone gates visible. Keep Refs #727, issue/native gates open and PR draft until explicit coordinator readiness release.

**NEW DAILY CAPABILITY — permanent** · Personal integrations & phone surfaces

Claim / complete export endpoints and updated optional iPhone Shortcut; SQL meals remain canonical.

Preserve claim/complete and duplicate-safe retries. Use scoped owner-bound device credentials; never place the human login password in a Shortcut. Verify actual iPhone execution and one nutrition export per canonical meal.

### [P12-13: Football preferences & live table behaviour](https://github.com/DanAakesen/jarvis/issues/728)

Closed as not planned on 12 October 2026 (#728) and excluded from the retained
scope. The text below is the original requirement, not a backlog.

**REUSE EXISTING JARVIS — permanent** · Personal integrations & phone surfaces

Existing Jarvis research / views with men’s Chelsea-first, top-six-next preferences and per-conversation table state.

Men's football only; Chelsea priority 1, classic top six priority 2. Use credible current sources and timestamped table data. First football request in the same conversation ends with the full live table; subsequent requests do not repeat it unless asked. All stays in the one Jarvis conversation.

### [P12-14: Brief history & disabled notification support](https://github.com/DanAakesen/jarvis/issues/729)

17 October inactive source continuation adds the missing shared query/tool and
single-page history/detail path over existing `briefing_runs`, not an import or
notification job. Preserve exact IDs, raw timestamp text, historical delivery and
nullable body data. Bound metadata/body reads; do not expose provider snapshots
or delivery evidence, infer timezone/freshness, or grant nutrition-connector
access. Original history and native dependencies remain unchanged. Qualification
is in progress; #729 is not complete and no recurring schedule is created.

**REUSE EXISTING JARVIS — permanent** · Personal integrations & phone surfaces

Import brief history; reuse Jarvis notification infrastructure. Recurring notifications stay disabled; any future schedule is a separate decision.

Preserve historical briefs and notification capability, but recurring Daily notifications stay off. Do not resurrect the old 09:00/13:00/19:00 schedules. Any future notification schedule is a separate user decision.

### [P12-15: Single Daily page, data browsing & visuals](https://github.com/DanAakesen/jarvis/issues/730)

**NEW DAILY CAPABILITY — permanent** · One Daily page in the existing Jarvis app

17 October source preparation follows the confirmed 15 October one-page scope,
not the superseded separate pages/card-deck requirement. The default-off page
uses delivered shared queries for measurements, sleep, workouts/detail/heart rate,
food history, favourites, plans and sync evidence. It provides applied periods,
opaque cursor paging, inspectable records and direct-observation charts in the
existing Jarvis shell. Production bootstrap is unchanged; #730 is not complete
and its native open #724/#725 dependencies are not removed.

Tool parity uses `daily_query` for the same source/period/cursor/detail reads and
existing acknowledged workspace/GenUI commands for requested display. Opening
Daily does not claim to set its local filters; present the queried subset in a
shared view instead. `daily_show` (P12-16, below) now builds and shows one bounded
page of that subset itself. Existing direct/reviewed food and saved-food tools retain
their authority/confirmation rules. Provider/grant completeness, briefs/history,
source reconciliation and physical-device/activation/cutover acceptance remain
separate unfinished gates, not implicit features of this record-browser source
slice. Budget-backed advice has its own inactive source slice (next paragraph)
and no acceptance.

The current tool ledger is partial, not full migration acceptance. Shared
record/detail/sync and brief reads use `daily_query`, and `daily_show` shows one
bounded page of the same stored data on screen (P12-16, below);
direct/reviewed intake, saved foods/plans/preferences and reference lookup
have explicit inactive tools. The owner's resting-burn, deficit and protein
targets are stored settings with an inactive `daily_nutrition_targets` tool.
Personalised suggestions have an inactive source slice: the read-only
`daily_nutrition_suggest` tool is the budget/candidate adapter for the existing
`suggest` calculation. It reads those targets, today's stored active energy and
the meals logged in Jarvis, and offers saved favourites only. It has no
live-export check of the `active_energy` metric name and
no acceptance; reference lookup is not that adapter. Daily Google-feed/attention/manual-refresh/
suppression equivalence and stored all-calendar grants remain unestablished,
not completed by the record browser. Device/export provisioning and real-phone/
provider acceptance retain their separate approval gates. No UI-only capability
or generic lookup may be reported as full retained-tool parity.

The default-off composition (`apps/backend/src/daily/composition.ts`) is the only
production entry to these sources. The backend switch `JARVIS_DAILY_ENABLED` is
off unless exactly `true`. It is off by default in code; production sets it, with
the web switch, in exactly two reviewed deployment files (18 October 2026), and a
scan test allows no other file to mention either. With it off, Jarvis's routes,
tools, instructions and startup are unchanged. With it on, one owner-bound module
adds only the capabilities, query and nutrition-targets routes and seven tools,
fail-closed on the owner, with no connector, Google or Gmail feed,
provider call, upload, job or timer. No parity or acceptance is claimed.

18 October source (P12-15): the page opens on an overview, "What Daily holds
today". For each collection the backend exposes it says in plain English what the
collection is for and shows the result of a read-only, one-record check (has
records, none returned, could not read). Open goes to the record browser above and
Back returns. It uses only `GET /daily/capabilities` and `POST /daily/query`,
shows no invented count or estimate, and never treats "none returned" as proof
that the original source is empty. The page, route and navigation exist only when
the web build switch `VITE_DAILY_ENABLED` is exactly `true`; it is off by default
in code, so a build without it keeps the released navigation. Dan pre-authorised
switching Daily on for his account once the page is live and checked, and the
production deployment files then set both switches (18 October 2026). No parity,
real-data or physical-phone/provider acceptance is claimed, and #730 is not
complete.

One gated Daily destination in the existing Jarvis app (side rail and mobile navigation) for Dan to browse retained health, food, workout and scan history himself, from the same owner-authorised sources as P12-16. Keep existing shell and voice workflow.

Reuse the existing side rail (canonical gym/dumbbell icon), mobile navigation, login, module gate, styling and shared components. Make retained history usable through the shared data contracts: period/filter selection, inspectable records, charts with correct units/dates/axes, every actual scan point, and visible source freshness/coverage; missing or partial data stays explicit. Mobile first, no overflow at narrow phone widths. The legacy card deck, separate Daily/Workouts/Nutrition pages, fixed Status/Recomp/Review/Ready screens and the iPhone widget are not required, and detailed composition is not fixed. Requests for particular summaries or visuals use P12-16. No second shell, sidebar, login or rendering framework; TickTick stays excluded. Disabled Daily preserves existing navigation.

### [P12-16: On-demand Daily GenUI integration](https://github.com/DanAakesen/jarvis/issues/731)

**REUSE EXISTING JARVIS — permanent** · On-demand Daily GenUI, not four fixed views

Owner-authorised, bounded Daily data and capabilities exposed through the existing chat/voice, GenUI and workspace/artifact lifecycle.

When Dan asks for a status, trend, workout detail, nutrition/recomp analysis, readiness or review, Jarvis chooses a data-backed summary or visual on demand. These topics are capabilities, not prebuilt native React screens or exact short-command routes. Reuse the P12-09 source/read-model contracts and backend calculations, coordinate self-service access with the P12-15 page, and keep provenance, freshness/coverage, dates, units, missing-data semantics and bounded payloads explicit; trusted calculations never move into generated code. Reuse stable artifact IDs, same-ID revision refresh, owner-authorised fetch, sandbox validation and the trusted theme bridge; generated content receives no credentials or arbitrary backend/network access. No new GenUI engine, parallel renderer, Daily shell, extra permanent navigation page or widget.

18 October source (P12-16): `daily_show` is the on-demand display tool. It reads
through the same owner-authorised read model as the page and `daily_query` and
publishes one bounded page (at most 366 days and 200 rows, no cursor) as a table,
chart or detail through the existing workspace view lifecycle. Sources are
measurements, sleep, workouts, one workout's heart rate, food history, favourites,
meal plans and sync status; brief history and single-record detail stay with
`daily_query`. It calculates nothing: values are the stored values with their
units and dates, missing means unknown rather than zero, and a footnote under every
table, chart and detail names the source, period, read time and that completeness
and freshness are not established. View IDs are stable and keyed by what is shown,
so asking again refreshes the same window instead of adding another. The tool is
sensitive and phone-denied, refuses a connector or a non-owner before SQL, and
refuses before reading when no workspace tab is connected. The reserved Status,
Recomp, Review and Ready IDs stay unused. It adds no endpoint, renderer, page,
widget, migration, account, consent or secret and follows the Daily switch. It is
checked with synthetic data and a real headless Chromium only: no parity, real-data
or physical-phone/provider acceptance is claimed, and #731 stays open for that.

### [P12-17: End-to-end, mobile & real-iPhone acceptance](https://github.com/DanAakesen/jarvis/issues/732)

**TEMPORARY — migration-only; remove after acceptance/retention gates** · Prove parity

Parity campaign: shared-user auth / denied-access checks, exact-once writes, four modes, recovery days, phone sync / widget / Shortcut, outage recovery and existing-Jarvis regression tests. Keep useful regression tests permanently.

Verify source-compatible ingestion coverage, one-user access/denial, retries/exact-once meals, current text/voice workflows, actual iPhone Health Auto Export, outage/reconnect and existing Jarvis regressions. Confirm SQL capacity/availability and rehearse authorized rollback. Keep production evidence private/redacted and distinguish browser fixtures from physical-phone/live-provider results. Preserve useful runtime/API/schema tests; the cancelled database comparison campaign is not a prerequisite.

### [P12-18: Final delta, cutover & rollback window](https://github.com/DanAakesen/jarvis/issues/733)

**EVENTUAL CUTOVER — separate from this cleanup.** Final delta, endpoint switch and one canonical Azure writer only after the source-compatible ingestion, parity and rollback gates pass. This cleanup leaves original source code/schema/records untouched; ordinary authorized source writes continue. Any future backup and reverse-delta recovery follow their separately approved gates. No dual canonical food writes.

### [P12-19: Retire legacy and migration-only tooling](https://github.com/DanAakesen/jarvis/issues/734)

**EVENTUAL LEGACY RETIREMENT — #734; not part of this cleanup.** Deprecate legacy operation only after complete verified source-compatible ingestion and separately approved rollback/retention gates. This code cleanup does not switch off or delete the original Daily or its data. Preserve permanent ingestion, queues, processors, SQL, services and regression tests. Credential/access changes still require their normal explicit confirmation.

## Staged rollout and evidence gates

Current direction (18 October 2026): source-contract-first API/schema and supported historical ingestion/replay are specified in #1005. The cancelled #717/#721/#982 database export/import approach is not an active blocker or prerequisite. Remaining source, device/provider, parity, rollback and release acceptance stays explicit; no worker independently dispatches work or merges its own PR.

Standing UI requirement (recorded on #730/#731/#732/#726): every migrated React/rich UI must fully match current Jarvis layout and styling. Current DESIGN.md, canonical `apps/web/src/styles.css` tokens, shared components, themes/density/motion settings and native phone/workspace patterns are authoritative. Preserve capabilities/data semantics while restyling/recomposing legacy Daily visuals; do not carry its separate navy/plum/card skin, add a second theme or replace shell/voice/window management. Generated/ad-hoc views receive safe trusted Jarvis theme context through the existing bridge without widened permissions. Mobile-first real-browser visual acceptance belongs to those UI issues; P12-03 does no frontend implementation.

1. Source contract first: #1005 documents the original API/schema, selected capabilities and source-to-target behavior; documentation is not implementation or replay evidence.
2. Implement and verify the corresponding owner-bound API/SQL schema and bounded source-compatible ingestion/replay. Keep unknowns explicit and preserve original IDs, units, dates, nulls and retries.
3. Complete synthetic and appropriate SQL/runtime regressions, then separately verify physical-device/provider behavior, source coverage, SQL availability and rollback evidence. Synthetic fixtures are not live-data or device acceptance.
4. Any eventual cutover or legacy retirement follows its own approved evidence gates under #733/#734. This cleanup neither changes the original Daily nor replaces those acceptance decisions.

Use normal main-only release workflows; cloud coding agents have no direct Azure access. Real health/food records, exports, credentials and private fixtures never enter public Git or coding environments. Recurring Daily notifications remain off; new schedules require a separate user decision.

## P12-01 verification evidence (12 October 2026)

- Unmodified `npm test --workspace @jarvis/contracts`: 43 passed, zero failed/skipped with the pinned Node 22.23.3/npm 10.9.9. No isolation changes.
- `npm test --workspace @jarvis/backend -- src/daily/index.test.ts src/modules.test.ts src/auth/auth.test.ts src/core/workspace-pins.test.ts src/core/read-window.test.ts`: 109 passed across five files, zero failed/skipped. Synthetic identities prove the same server owner for delegated user/hosted agent, non-owner/runner refusal, owner-query rejection and unchanged disabled health/tool registration.
- Contracts/backend/web lint and builds pass; web retains its existing large-chunk advisory. PLAN parser recognizes all 19 unique P12 tasks with existing issue URLs/dependencies. Architecture-flow script syntax and diff whitespace checks pass.
- Initial shell socket restriction prevented the existing auth fixture's local JWKS server; rerun with socket access passed. The initial Daily query regression caught Fastify stripping extra fields; rejection now precedes validation. Tests were not weakened.
- Production composition remains untouched. No Daily SQL/device auth/data tool/page, import, live sign-in/provider/device test, production write, deployment or cutover was performed. Synthetic checks do not satisfy downstream physical-phone/parity/backup/rollback gates.

### Production package boundary correction

Independent review found that CI run 38253105188 on `dfe04b2a51cb636abb0991618f1bad9880e49192` failed backend image startup: the contracts entrypoint imported `daily.js`, but the Docker context and runtime copy both selected only `index.js`. The backend Dockerfile is also used by main-only deployment. Web consumes contracts through Vite bundling; runner and hosted-agent images do not package this npm workspace. No other selective contracts runtime copy was found.

The Docker context now admits runtime contracts JavaScript while excluding contract tests. The runtime stage copies the admitted source directory and executes `import('@jarvis/contracts')` during the image build, so a missing transitive runtime module fails the build itself. Existing container smoke checks remain unchanged. PR #738's separate presence-instruction packaging additions are preserved by avoiding those lines. Exact new-SHA container/CI outcomes are recorded in PR #740; the failed earlier run is not a passing release result.
