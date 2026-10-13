# Approved Daily migration to Jarvis

Dan approved P12 on 12 October 2026 and explicitly released only P12-01 for this worker. The later [execution authorization](https://github.com/DanAakesen/jarvis/issues/716#issuecomment-6124634183) supersedes the original backlog-only and extra cutover-approval wording: eventual production cutover is pre-authorized only after dependency, parity, reconciliation, backup and rollback gates pass. Original Daily continues ordinary authorized food/health writes and remains running/canonical before cutover. Migration tooling must not alter its application/source code/schema or rewrite its records; final-delta reconciliation accounts for ongoing normal use. Read-only export belongs in the protected migration workflow. Legacy operation may be deprecated only after all in-scope data, features and sync are migrated and verified and rollback is protected; never delete the original repository or data. New secrets/access and unapproved paid resources retain their explicit-confirmation boundaries. This issue performs no cutover or production writes.

## Integration contract implemented by P12-01

- Existing Jarvis authentication, session and server-resolved user/owner across pages, meals, chat/voice and artifacts. No second login, copied human password, client-provided owner or replacement shell/dispatcher/voice stack.
- `apps/backend/src/daily/index.ts` exports `createDailyModules(enabled = false)`. This trusted server composition flag accepts only boolean true; disabled composition is an empty array. Production composition does not import or enable Daily yet. No environment variable, navigation or write activation is added by P12-01.
- Explicitly enabled contract composition provides only authenticated `GET /daily/capabilities` metadata with no-store caching. It reports contract-only stage, reserved view IDs, and empty implemented page/tool lists. It accepts no query fields or owner parameters and exposes no identity or health record. This is not a Daily data API.
- `resolveDailyOwner(request)` consumes only existing root-authenticated request principals and `request.server.ownerObjectId`. A matching delegated user or verified hosted Jarvis agent resolves to the same configured owner; the agent's service object ID is never used as a data owner. Coding runners, bridge/event/deploy identities and other users are denied. Device authentication/scopes remain P12-04/P12-11/P12-12, not implemented here.
- Shared contracts reserve `daily-status`, `daily-recomp`, `daily-review`, `daily-ready` under source/module `daily`, version 1. These are stable future native view IDs, not generated renderer registrations or functioning views. P12-16 supplies native rendering in the one existing conversation.

## Downstream interfaces and ownership

P12-09 owns actual `/daily/…` data routes, shared services used by pages and tools, module composition activation, source-message idempotency and revision invalidation. Use the existing sensitive tool registry/dispatcher with content-redacted audit outcomes; no new dispatcher. Writes publish revisions only after committed persistence. P12-15 owns gated navigation/pages, P12-16 owns native assistant views and bounded generated datasets. Same-ID updates and reconnect/refocus refresh reuse existing workspace/artifact lifecycle and owner-authorized reads; do not widen CSP, bridge or generated-code network permissions.

P12-03 owns SQL owner mapping to the configured Jarvis owner, stable source IDs, revisions and tombstones. No client or device selects a source owner. Future device credentials bind server-side to that owner with narrow upload, widget-read or nutrition-export scopes; no arbitrary tools or unrelated data. Coding sandboxes receive neither those credentials nor private Daily records. No production schema or device auth is implemented in P12-01.

Daily implementation stays under `apps/backend/src/daily/**`, future frontend `apps/web/src/daily/**`, and minimal additive `packages/contracts/src/**`. Coordinate shared contract/composition/navigation files with ongoing Jarvis work; preserve all unrelated shared-doc entries. P12-01 avoids GitHub App, presence, Google approval, shell, voice and dispatcher runtime areas touched by other PRs. Later PRs must recheck ownership and latest main.

## Approved scope by existing issue

The following are planned downstream functions, not implemented claims. Existing issue URLs and native dependency links are reused; do not create duplicate issues or automatically dispatch work. TickTick adapters, tasks/habits/countdown surfaces and active TickTick snapshots are excluded throughout.

### [P12-01: Shared owner, module & staged-rollout contract](https://github.com/DanAakesen/jarvis/issues/716)

**REUSE EXISTING JARVIS — permanent** · Integration contract & protected inventory

Bind Daily to the existing server-resolved user and app-wide login; agree API / tool / view interfaces, gated activation and shared-file ownership with ongoing Jarvis work.

Before downstream engineering, record this approved P12 backlog and its existing issue URLs in PLAN.md and relevant product/architecture/decision documents; never create duplicate issues. Define the activation flag and owner resolution for user and hosted-agent calls.

### [P12-02: Protected export & inventory](https://github.com/DanAakesen/jarvis/issues/717)

**TEMPORARY — migration-only; remove after acceptance/retention gates** · Integration contract & protected inventory

Complete original backup of the 31-table inventory and retained raw objects; manifest separates in-scope migration from excluded source snapshots.

Re-inventory the current Sites D1 schema (31 tables at review) and retained R2 objects. Prove complete, untruncated export; record table counts/checksums and retained-object coverage. Keep real records in encrypted private storage; no credentials, real exports or health fixtures in this public repo. Exporter/staging is temporary.

### [P12-03: Daily SQL schema & owner mapping](https://github.com/DanAakesen/jarvis/issues/718)

Sequentially released after closed #716; parked #717 is not a dependency. [Explicit source-table/field mapping and reconciliation limits](daily-schema-mapping.md) distinguish supplied schema definitions from live schema/export evidence. P12-03 adds only empty owner-bound SQL tables and an inactive authenticated-owner read boundary; no import, downstream service, device auth, UI or Daily activation.

**NEW DAILY CAPABILITY — permanent** · Integration contract & protected inventory

Owner-bound health / food / coaching / Google-feed tables; stable IDs, revisions, soft deletes and idempotency. Allocate migration numbers against current main.

Preserve source IDs, revisions, deleted tombstones, ingestion provenance, readiness, recovery, nutrition feedback and Google-feed suppressions. Bind every imported record to Jarvis's existing owner, resolved server-side; never trust a client-supplied owner or email.

### [P12-04: Azure ingestion, device auth & durable buffer](https://github.com/DanAakesen/jarvis/issues/719)

**Revised inactive scope, directly approved 13 October 2026:** `daily/health-upload` reuses the existing backend and SQL. Explicit default-off composition registers the two exact POST paths with hashed owner/scoped/revocable device checks. Migration 0046 adds a raw inbox and capability table. HTTP 202 follows the raw/receipt SQL commit, never processing; SQL unavailable returns 503 for the phone to retry. Owner/kind/automation/session, device, checksum and length protect exact retries and conflicts. No separate host, Blob/Queue, identity, resources, grants or activation. [Contract/checks/gates](daily-health-ingestion/README.md); #720 and live/device acceptance remain separate.

Verified source heartbeat accepts authenticated bodyless POST without Content-Type. The target stores bounded private `shortcut-name` provenance (default `Daily Overview heartbeat`) and checked feeds `metrics`/`workouts`, without claiming measurements were received or processed. Upload JSON validation remains separate and strict.

The separate unregistered SQL lifecycle library retains protected random prepared handles, idempotent issue and terminal revocation. A transaction atomically revokes the old capability and reserves/issues one same-device, narrowed-scope replacement. Retain the same handle after response ambiguity; SQL atomicity does not make secret delivery exactly once. No real provisioning or protected custody/delivery channel is created.

Maintained client/instance request-rate guards still run before credential/database work. Uploads are bounded to 8 MiB; an owner inbox retains at most 256 MiB and 10,000 rows before 503 backpressure, without automatic age deletion. Verified processing/retention/compaction, ingress identity, deployed quotas, actual phone retries and protected backup/rollback remain activation gates. The [old host/Blob/Queue proposal](daily-health-ingestion/legacy-host-proposal.md) is superseded and unused; its cost/recovery questions are withdrawn.

**NEW DAILY CAPABILITY — permanent** · Backend & migration rehearsal

Existing backend upload / heartbeat routes, owner-bound SQL raw inbox, hashed device capabilities and truthful acceptance state.

Keep Health Auto Export JSON uploads and heartbeat. Device credentials are owner-bound, scoped and revocable, never the human password. Commit acceptance durably in existing SQL, distinguish accepted from processed, and return 503/retry when SQL cannot accept. An acknowledged upload remains in SQL through agent/processor downtime. Secret/access changes and any future paid service still require normal explicit approval.

### [P12-05: Health processor & sync read models](https://github.com/DanAakesen/jarvis/issues/720)

**NEW DAILY CAPABILITY — permanent** · Backend & migration rehearsal

Metrics, sleep, workouts, workout detail and minute HR; unit conversion, local dates, retry / poison-queue handling.

Preserve metrics, sleep/wake dates, distinct qualifying workouts, workout details and minute heart rate. Normalize units and Copenhagen local dates. Same session/checksum is idempotent; changed payload conflicts safely; empty workout exports succeed without erasing history. Bound retries and poison handling; update processed freshness after committed SQL, not after heartbeat.

### [P12-06: Import, reconcile & shadow comparison](https://github.com/DanAakesen/jarvis/issues/721)

**TEMPORARY — migration-only; remove after acceptance/retention gates** · Backend & migration rehearsal

Private repeatable migration runner, staging, retained raw objects, SQL integrity and in-scope Daily-to-Azure comparison.

Every exported record has an import or explicit exclusion decision. Import in-scope data, stable IDs, revisions and tombstones; exclude TickTick payloads from active feeds. Copy only retained sanitized raw objects with remaining retention, never fabricate expired originals. Compare read-only Azure results against Sites and prove resumable import and reverse-delta recovery. Importer/staging/comparison tooling is temporary.

### [P12-07: Nutrition tools, Frida & meal planning](https://github.com/DanAakesen/jarvis/issues/722)

Released after closed/deployed #718. Draft #743 implements inactive nutrition services/typed handlers from supplied legacy contracts, server-resolved plan snapshots and guarded 0042/0043 migrations. [Boundary and validation](../apps/backend/src/daily/nutrition/README.md) records read-only source/public format evidence. Preserve Frida 5.5/release 10 with DTU/DOI attribution, per-100-g units, nullable nutrients/unavailable provenance and separate incomplete subtotals. Bootstrap is verified empty-body plus public token header/cookie; no session values are borrowed. Cloud CONNECT is blocked with HTTP 403. No live provider success, real import, Apple Health queue or activation. P12-09 owns trusted evidence/confirmation/runtime registration. Final exact-head CI and independent review precede readiness/release; backup/import/live/phone gates stay separate.

**NEW DAILY CAPABILITY — permanent** · Backend & migration rehearsal

Lookup, log / edit / delete, full history, favourites / aliases, plans and persisted like / dislike / clear behaviour. Draft #743 restores legacy name normalization and raw display-alias compatibility, rejects deleted source intake for new favourites, validates new-write meal domains/caps/trusted time/Copenhagen dates, and verifies Frida group/row identity and finite arithmetic. Synthetic SQL covers stable-ID reuse, ambiguity, owner isolation and clearing; exact-head CI and independent acceptance remain required.

Text/voice/photo lookup and current Frida data; exact-once confirmed food logging; full history and edits beyond 7 days; soft deletion, aliases, favourites, plans and persistent likes/dislikes. Suggest proactively using time of day and remaining budget; disliked meals must not return. Keep intake, protein and other macros from actual records; never silently invent missing quantities.

### [P12-08: Coaching, recovery & recomp services](https://github.com/DanAakesen/jarvis/issues/723)

**NEW DAILY CAPABILITY — permanent** · Backend & migration rehearsal

Profile, targets, consistency, four body metrics, review / experiments, readiness and sick-day treatment.

Preserve tough-but-fair concise coaching with natural profanity, evidence-based praise and contextual orders. Status: deficit-target kcal remaining, protein remaining first, active separate from resting, 8,000 steps, 7 hours sleep, protein max(180 g, 2 g/kg), 14-day body trends and 7-day eligible consistency. Deficits >=15% count; keep maintenance and deficit budgets distinct. Four scan metrics are weight, fat mass, fat percentage and actual lean mass, not invented muscle-only values. Readiness accepts rating plus context and asks only when missing; no extra steps/workout after the target/session is met. Keep sick-day measurements but exclude those dates from eligible aggregates/misses; no imputation or blaming missing/stale data. Weekly review preserves the one-experiment commitment flow.

### [P12-09: Daily API, tool registry & live revisions](https://github.com/DanAakesen/jarvis/issues/724)

**NEW DAILY CAPABILITY — permanent** · Backend & migration rehearsal

Gated Daily BackendModule, source IDs, shared read-model contracts, sensitive outcome audit and UI invalidation.

Register Daily through BackendModule, with shared services for UI and tools, owner validation for user and hosted-agent calls, source-message idempotency and sensitive audit metadata only. Refresh stable views after committed revisions/reconnect/refocus. Gated-off Daily contributes no accidental routes/tools/navigation or production writes; no new dispatcher or alternate user authentication.

### [P12-10: Google feed, all calendars & attention](https://github.com/DanAakesen/jarvis/issues/725)

After inactive #746 merged, scoped continuation draft #754 corrects caller calendar-range preflight, numberless delivery grouping and SENT-alias direction. No live acceptance or activation is implied. Exact-head synthetic/isolated SQL/full CI and independent review are required; only explicit coordinator release may mark this follow-up ready. Issue/native gates remain open.

Released after closed/deployed #718 and merged #722. [Inactive feed services](../apps/backend/src/daily/feeds/README.md) use coordinator-verified pure consumer/public producer contracts for resumable bounded Gmail/calendar reads, exact selectors, mapped owner-local snapshots/suppressions and manual refresh. The existing protected chat identity/settings/catalogue/usage boundary supplies tool-free JSON extraction with strict local schema and source-timestamp checks; failures remain unavailable, never guessed. Per-source size checks preserve healthy-source success. Consent, deployed-model/live parity/private/phone gates remain open; no new resource/key, OAuth change or activation. Coordinator accepted 895b7c3/full CI 38310725882 for a reviewed inactive intermediate release through #746; final documentation/exact-head CI precede readiness. Refs #725 remains, with the issue open and native dependencies intact. Full acceptance still requires manual CalendarList owner consent, deployed identity/model and Google/provider parity, protected backup/import/reconciliation and physical-device evidence.

**REUSE EXISTING JARVIS — permanent** · Personal integrations & phone surfaces

Reuse existing Google auth and read APIs; extend all visible calendars, Gmail attention, waiting states, deliveries and suppressions. Coordinate shared Google code with ongoing approval work.

Reuse Jarvis Gmail/Google Calendar connections for the same user. Include all visible calendars, waiting-for-you/others, active deliveries, suppressions, freshness and manual refresh. Verify required provider scopes and do not claim an unavailable feed works. No TickTick adapter, personal-task/habit/countdown UI or active snapshot import.

### [P12-11: Read-only iPhone widget & deep links](https://github.com/DanAakesen/jarvis/issues/726)

**NEW DAILY CAPABILITY — permanent** · Personal integrations & phone surfaces

Minimal Azure widget surface, narrow device credential and links into Jarvis Daily / conversation.

Keep a small read-only phone glance with owner-bound credentials and Jarvis links. Verify actual iPhone refresh and navigation. Credentials must not log food, call arbitrary tools or expose unrelated private records.

### [P12-12: Apple Health nutrition export Shortcut](https://github.com/DanAakesen/jarvis/issues/727)

Released inactive slice on `codex/p12-12-nutrition-export` / draft #758 after closed/deployed #722. Coordinator [verified pure source contract](https://github.com/DanAakesen/jarvis/issues/727#issuecomment-6134567097) supplies claim/complete DTOs and optional native-write guidance; no original records were read. Target replaces unsafe requeue/ACK behavior with scoped owner-bound device capability, exact-period trusted confirmation, revision/expiry uncertainty, no-instruction claim replay and identical receipt replay. Canonical SQL meals/ordinary logging remain independent; no native re-ingestion or automatic export. [Inactive boundary](../apps/backend/src/daily/nutrition-export/README.md) and [unverified phone guide](nutrition-export-shortcut.md) keep provisioning/activation/live/private/iPhone gates visible. Keep Refs #727, issue/native gates open and PR draft until explicit coordinator readiness release.

**NEW DAILY CAPABILITY — permanent** · Personal integrations & phone surfaces

Claim / complete export endpoints and updated optional iPhone Shortcut; SQL meals remain canonical.

Preserve claim/complete and duplicate-safe retries. Use scoped owner-bound device credentials; never place the human login password in a Shortcut. Verify actual iPhone execution and one nutrition export per canonical meal.

### [P12-13: Football preferences & live table behaviour](https://github.com/DanAakesen/jarvis/issues/728)

**REUSE EXISTING JARVIS — permanent** · Personal integrations & phone surfaces

Existing Jarvis research / views with men’s Chelsea-first, top-six-next preferences and per-conversation table state.

Men's football only; Chelsea priority 1, classic top six priority 2. Use credible current sources and timestamped table data. First football request in the same conversation ends with the full live table; subsequent requests do not repeat it unless asked. All stays in the one Jarvis conversation.

### [P12-14: Brief history & disabled notification support](https://github.com/DanAakesen/jarvis/issues/729)

**REUSE EXISTING JARVIS — permanent** · Personal integrations & phone surfaces

Import brief history; reuse Jarvis notification infrastructure. Recurring notifications stay disabled; any future schedule is a separate decision.

Preserve historical briefs and notification capability, but recurring Daily notifications stay off. Do not resurrect the old 09:00/13:00/19:00 schedules. Any future notification schedule is a separate user decision.

### [P12-15: Daily, Workouts & Nutrition pages](https://github.com/DanAakesen/jarvis/issues/730)

**NEW DAILY CAPABILITY — permanent** · Native UI & one assistant experience

Gated Jarvis navigation / source contracts; current card deck and complete health / food / workout details. Keep existing shell and voice workflow.

Port Daily/Workouts/Nutrition functionality into the existing Jarvis shell/design system: period selectors, card deck, health/food/workout histories, scan charts, source freshness and loading/error states. Mobile first: readable units/axes/legend, every actual scan point, no overflow at narrow phone widths. No TickTick surfaces. Disabled Daily preserves existing navigation.

### [P12-16: Status, Recomp, Review & Ready views](https://github.com/DanAakesen/jarvis/issues/731)

**NEW DAILY CAPABILITY — permanent** · Native UI & one assistant experience

Native React assistant views, stable IDs, contextual routing and bounded Daily datasets for generated UI.

Status/recomp/review/ready short commands show the correct native React view in the one conversation and existing sign-in. Stable IDs prevent duplicate cards. Support bounded Daily datasets for ad-hoc generated UI while preserving CSP/bridge validation; generated apps cannot fetch credentials/backend data arbitrarily. Use robust native icons, short contextual readiness summaries and mobile-first charts.

### [P12-17: End-to-end, mobile & real-iPhone acceptance](https://github.com/DanAakesen/jarvis/issues/732)

**TEMPORARY — migration-only; remove after acceptance/retention gates** · Prove parity

Parity campaign: shared-user auth / denied-access checks, exact-once writes, four modes, recovery days, phone sync / widget / Shortcut, outage recovery and existing-Jarvis regression tests. Keep useful regression tests permanently.

Verify data manifests, one-user access/denial, retries/exact-once meals, four views in text/voice, recovery exclusions, actual iPhone Health Auto Export, widget/Shortcut, outage/reconnect and existing Jarvis regressions. Confirm SQL capacity/availability and rehearse reverse-delta rollback. Keep production evidence private/redacted and explicitly distinguish browser fixtures from physical-phone/live-provider results. Migration-specific comparison campaign is temporary; useful regression tests remain.

### [P12-18: Final delta, cutover & rollback window](https://github.com/DanAakesen/jarvis/issues/733)

**TEMPORARY — migration-only.** Final delta, endpoint switch and one canonical Azure writer after all evidence gates. Migration tooling leaves original source code/schema/records untouched; ordinary authorized source writes continue before cutover. Protect a private backup, agreed rollback window and reverse-delta recovery of new Azure writes. No dual canonical food writes. Latest execution authorization governs any older source-freeze/read-only wording.

### [P12-19: Retire legacy and migration-only tooling](https://github.com/DanAakesen/jarvis/issues/734)

**TEMPORARY — migration-only.** Deprecate legacy operation only after complete verified migration and protected rollback/retention gates. Remove temporary export/import/staging/comparison tooling when eligible; preserve permanent ingestion, queues, processors, SQL/Blob, services, regression tests and required backups/evidence. Never delete or modify original repository/data. Credential/access changes still require their normal explicit confirmation.

## Staged rollout and evidence gates

Standing execution direction: the approved migration proceeds under the coordinator's dependency/gate releases without another generic permission request. The protected #717 export blocker and all evidence/privacy/release gates remain; no worker independently dispatches blocked work or merges its own PR.

Standing UI requirement (recorded on #730/#731/#732/#726): every migrated React/rich UI must fully match current Jarvis layout and styling. Current DESIGN.md, canonical `apps/web/src/styles.css` tokens, shared components, themes/density/motion settings and native phone/workspace patterns are authoritative. Preserve capabilities/data semantics while restyling/recomposing legacy Daily visuals; do not carry its separate navy/plum/card skin, add a second theme or replace shell/voice/window management. Generated/ad-hoc views receive safe trusted Jarvis theme context through the existing bridge without widened permissions. Mobile-first real-browser visual acceptance belongs to those UI issues; P12-03 does no frontend implementation.

1. Contract-only/default-off: synthetic tests, unchanged current Jarvis when disabled; no private exports, production writes or actual Daily views.
2. Private inventory/backup and owner-bound schema/services: protected export is complete and untruncated with counts/checksums/retained-object coverage. Every source record has an import or explicit exclusion decision; no fabricated expired raw objects.
3. Read-only shadow and bounded synthetic workflows: prove resumability, exact-once confirmed food writes, scope denials, freshness/revisions, recovery dates and parity; original Daily stays canonical, no automatic food dual-writes.
4. P12-17 acceptance: dependency work completed, reconciled manifests, real iPhone Health Auto Export/widget/Shortcut, live providers, existing Jarvis regression, SQL availability, private backup and rehearsed reverse-delta rollback. Keep live/private evidence protected and redacted; browser fixtures are not physical-device acceptance.
5. P12-18 cutover: pre-authorization applies only after every gate passes; agree rollback window, recover new Jarvis writes on rollback, confirm one canonical writer and endpoint/sync parity. No original source edits or deletions.
6. P12-19 legacy deprecation and temporary cleanup only after verified complete migration plus rollback/retention gates. Preserve original source/data and permanent services.

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

