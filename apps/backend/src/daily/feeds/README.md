# Inactive Daily Google feed checkpoint (#725)

`DailyCalendarFeed` is a reusable read boundary, not production composition. Construct it with the existing server-owned `GoogleApiClient`; every refresh resolves the authenticated Jarvis owner, denies runners/other identities and the nutrition-only connector, and accepts no caller-selected account/owner. Provider operations are GET only. Existing Gmail/Calendar writes, OAuth setup and tool catalogue limits are unchanged.

Calendar-list pages include hidden visible calendars; each listed calendar gets separately paged event reads. Snapshot IDs preserve the producer's calendarId:eventId format, with original date-only/offset/time-zone metadata alongside normalized source fields. Cancelled/deleted and source week-number calendars/titles are excluded; only timed overlaps are conflicts (bounded output reports truncation). No guessed primary-only fallback. Bounds: 62-day range, 10 pages per enumeration/read, 32 calendars, 2000 events, four concurrent requests/cache ranges, 30-second manual-refresh cooldown and 20-second combined cancellation/deadline. Duplicate/repeated-page or invalid responses fail truthfully. Coverage limits and individual denied calendars report partial coverage. Only complete snapshots enter the in-memory owner/range cache; failed refresh can return the last complete snapshot explicitly stale, with its original capture timestamp. Cancellation never claims success.

`DailyGmailFeed` obtains the connected account and mailbox `historyId` from the existing Google profile. Missing/invalid generation is an error, not verified coverage. The verified 180-day thread query is retained. Each call advances at most five list pages, fetches at most 100 full threads sequentially and performs at most 50 new classifications under a 60-second deadline. Private process-local staging permits later calls to finish a stable mailbox; incomplete calls publish no items. Staging is bounded to four owners, 100 pages/10000 IDs, 8 MiB of full rows and 2000 validated semantic results per owner. A mailbox/account/model-generation or UTC-date change discards the scan. Completion checks the mailbox and model generation again; successful calls re-enumerate the rolling window on next refresh and reuse only unchanged full rows/classifications. Process restart loses progress, never establishes coverage. No snapshot isolation or guaranteed completion for a continuously changing mailbox is claimed.

Full threads allow 100 messages with bounded MIME/headers. Plain text precedes HTML fallback; body/snippet/labels retain 5000/2000/30 limits. Automatic-message and 24-hour attention filters are preserved; physical orders are extracted first. Semantic input is at most 32 KiB, output at most 16 KiB/1024 tokens. Tool-free strict local schema and exact source timestamp membership are required; mail content cannot authorize actions. No keyword fallback, provider key or model choice is accepted from arguments.

`createFoundryMailSemanticModel` supplies the inactive adapter through Jarvis's established managed-identity token callback, validated configured Foundry project origin and chat-completions API. It resolves the canonical existing `roles.chat` model/reasoning against the catalogue, requires known existing pricing and usage accounting, and sends no tools. It uses `json_object` plus strict local validation, not an unverified provider `json_schema` claim. Requests use `max_completion_tokens`, bounded 40 KiB request/32 KiB response, one concurrent call, 50 calls/minute and 30-second cancellation/deadline. Usage records contain only role/model/token counts/event ID; billed refusal/truncation is counted and rejected. Request/token caps bound refresh cost at the existing configured model rates; they are not an invoice guarantee. No new deployment, credential, model role or resource is introduced. P12-09 owns composition with the existing credential/settings/catalogue/usage stores.

`attention.ts` implements the verified seven-state selectors, exact Copenhagen business-day/holiday calendar, producer-ID/consumer-key distinction, order merge/terminal behavior and incoming-only thread revival. The consumer punctuation helper is copied semantically from the coordinator's pure source evidence: no diacritic folding/prefix stripping; grouping compares trimmed lowercase raw numbers separately from canonical keys. Received is terminal for visibility even though the producer considered it active.

`DailyFeedStore` uses the existing owner-bound 0041 tables, parameterized SQL and transaction-owned per-owner locks for run/checksum idempotency, source snapshots, suppressions and consistent reads. Latest attempt and success are selected independently by capture/receipt time; Missing/Stale/Current and the strict >18-hour age rule retain successful items after failed/incomplete attempts. Explicit trusted intent is required for dismiss/Received/clear; automatic refresh can only mark the defined newer-incoming thread revival, retaining history. Order suppressions never auto-revive. Exact imported keys/IDs are not rewritten; TickTick/task/habit/countdown sources/types are refused. No new migration or production data is added.

`DailyFeedRefresh` executes bounded manual refresh with running/completed/limited states and independent source errors. Before the combined transaction, each source is limited to 1000 items, 480 KiB serialized UTF-8 and 32000 UTF-8 bytes per content object. Transport may return 2000 calendar events, but an oversized source becomes an explicit coverage-limit error with no partial items; healthy Gmail still commits and prior calendar success remains available. Two reserved source budgets fit the unchanged 1 MiB run ceiling; persistence enforces the same byte limits. It never dispatches the original workflow, claims queued work was processed, or promotes stale/partial cache to a new success. Durable ingestion is duplicate-safe; in-flight provider work is coalesced within the service instance. Repeated provider/model reads across backend instances are not claimed exactly once. P12-09 owns runtime registration and derives intent from trusted Jarvis metadata, never model/client confirmation booleans.

## Inactive P12-09 tool binding

Optional `createDailyData(pool, owner, now, frida, { google, semantic })` shares
the existing pool/change hub and builds the actual calendar/Gmail/refresh
services without provider work during construction. `semantic` is the existing
protected `createFoundryMailSemanticModel` adapter with the established token,
settings, catalogue and usage dependencies. No provider key/scope/model is
accepted from tool input. `{}` enables retained reads with refresh explicitly
unconfigured; absent semantic capability reports `semantic-unavailable`, never
a fabricated empty success.

`createDailyModules(true, data)` adds sensitive `daily_feed` only when
`data.feeds` is supplied. Its six grouped operations are `read_attention`,
`read_suppressions`, `refresh`, `dismiss_thread`, `receive_order` and
`clear_suppression`. The same shared service retains the existing selectors,
source metadata, exact IDs/consumer keys and bounded timed conflicts. Read DTOs
have the shared768KiB ceiling; raw Gmail snapshots are not duplicated. The
retained calendar request range is unknown. Query/capability source versions
and the external nutrition MCP allowlist do not change.

The four mutating operations require a current verified Dan chat/browser-voice
session, present mode and one-time browser-only Now approval. Review lasts
120seconds inside210second operation/relay and225second agent-read budgets.
The full60second provider window plus30seconds of setup/persistence overhead
fits after near-expiry review; the existing240second ingress is unchanged.
Exact frozen target/suppression hashes are rechecked under owner SQL locks;
merged terminal order updates cannot be suppressed through an older active ID.
Only Daily visibility changes, never Google or the physical order. Manual
refresh derives its operation key from server-verified message/context and
selectors, preserves independent source failures and recovers stored runs.
Completed is an attempt receipt, not proof of fresh/complete providers.
Cancellation, rejection, changed context/targets and missing configuration do
not claim commitment. Every feed entrypoint explicitly denies nutrition-only
principals, including direct store/provider-service calls.

New acknowledged snapshot/suppression commits publish `daily.feed` through the
existing change hub/Now refresh; reads, replay, no-op and failed transactions do
not. Listener failures are isolated after commit. No route, scheduler, migration,
production composition, grant or live acceptance is added.

New active suppressions are refused at1,000 per type inside the owner transaction;
existing updates/no-ops remain allowed. Restoration reads and rechecks only its
exact owned type/key, not the entire bounded list. This preserves reviewed
known-key recovery even if an imported set already exceeds the limit. Restoring
one entry frees capacity; failed additions cannot poison subsequent reads or
publish a committed change.

## Blocked acceptance

Post-merge #725 continuation on `codex/p12-10-feed-boundary-corrections`: the shared calendar-range validator rejects malformed, missing, reversed or over-62-day input before either feed, model, cooldown or storage work. Numberless deliveries require nonempty matching normalized delivery details to merge; genuine nonempty raw numbers retain their existing grouping and source/suppression keys. Gmail uses validated full provider `SENT` labels before the 30-label DTO truncation, with primary-profile address fallback, preserving sent aliases and incoming-only revival. Synthetic tests and isolated SQL regressions cover these boundaries. The follow-up stays draft pending exact-head CI and explicit coordinator readiness release; merged #746 does not complete live acceptance.

Serialization correction: node/depth/type failures during source preflight become sanitized independent coverage-limit errors, preserving the healthy sibling and prior complete snapshot. Each source retains nutrition canonical JSON's 10000-node/16-depth guards, 480 KiB byte ceiling and item/content limits. The fixed two-source run composes those canonical subtrees with a bounded scalar envelope (at most 20005 nodes/depth 18 and 1 MiB), preserving earlier supported run bytes/checksums. Validation and checksum use the same composition; shared nutrition guards are unchanged. The ready-triggered finding holds intermediate release pending exact-head CI and independent correction review; earlier review does not waive it.

The current repository Google consent requests `calendar.events`, not calendar-list read scope (`infra/setup-google.ps1`). Existing decision L125 records calendarList's denied-scope failure. Coordinator verified the primary [CalendarList:list contract](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list): `items`, `nextPageToken`, `nextSyncToken`, maxResults up to 250. This checkpoint requests full enumeration in pages of 100, follows `nextPageToken` and does not claim delta sync from `nextSyncToken`. Enumeration requires `calendar.calendarlist.readonly` (least-privilege addition), `calendar.readonly`, `calendar.calendarlist` or `calendar`; current calendar.events alone is insufficient. Owner consent is a separate manual gate; no sandbox tokens, scope/credential changes or working live enumeration are authorized or claimed. A public official-document request from this cloud environment returned HTTP 403; the coordinator's public contract evidence does not establish provider/account access.

Source-semantic evidence is now supplied: original pure consumer code HEAD 9e193554c9c8c7c23a788ed3d2b0582580b76c0f; public producer code pinned at cc526f9d9bf158a70b17e4f7668b7d72f083852a. Only the named source files were read; no original records/seeds/generated payloads/credentials were accessed. The earlier missing-semantics blocker is resolved.

Coordinator-verified existing protected chat-completions evidence resolves the earlier coding interface gap. The adapter is tested with synthetic responses, not deployed identity/model or actual mail. Absent/failed capability still reports semantic-unavailable and retains stale success; it never substitutes a classifier guess. Coordinator accepted code at 895b7c3422d5004d47bbb2b4372f876aeedd1641 and full CI 38310725882 for an inactive intermediate release. Final documentation requires exact-head CI before PR readiness. Full #725 acceptance remains open: CalendarList owner consent, deployed identity/model and Google/provider parity, protected backup/import/reconciliation and physical-device evidence are unverified. Keep Refs #725, the issue open and native dependencies intact; this review authorizes no activation or new permissions.

Tests use synthetic mail/calendar fixtures only. Run `npm test --workspace @jarvis/backend -- src/daily/feeds src/google src/core/tool-registry.test.ts src/modules.test.ts src/auth/auth.test.ts`, backend lint/build and exact-head normal CI/container smoke. `src/database/feeds.integration.test.ts` runs the real owner/snapshot/suppression transactions in existing isolated SQL CI; local SQL image access remains forbidden. Live Google scope/account/data, protected model/source parity, protected backup/import and physical-phone acceptance remain unverified. No private records/tokens, original Daily changes, Azure access, new resources/secrets, activation or cutover.
