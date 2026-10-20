# Daily health acceptance in the existing backend

Dan directly approved the revised #719 design on 13 October 2026: reuse Jarvis's backend and SQL, with no new Azure resources. Production composition is behind the explicit `JARVIS_HEALTH_UPLOAD_ENABLED` switch; its code default is false and the reviewed backend infrastructure explicitly sets it true. The post-merge deployment succeeded, but no upload-specific production authentication/processing or phone acceptance is established. Current credential status is not available to this report. See the [Daily v182 delivery status](../reference/daily-v182/delivery-status.md).

## Acceptance contract

`createSqlHealthUpload(existingPool, configuredOwner)` returns the SQL-backed upload dependencies. Production `index.ts` passes them to the existing `buildApp` only when `JARVIS_HEALTH_UPLOAD_ENABLED === "true"` and the existing SQL pool is configured; the switch defaults off. The scoped plugin installs only POST `/api/health/ingest` and `/api/health/heartbeat`. The root authentication exception requires explicit enablement, exact method/path and plugin opt-in. All other Jarvis login/service routes keep their current authentication.

- Ingest requires valid UTF-8 JSON, `automation-id` and `session-id`, with optional matching SHA-256 `checksum`/`x-payload-checksum`. Original bytes are preserved, including units/offsets/empty workouts; no measurements are normalized here.
- Bodyless heartbeat remains supported. Only bounded `shortcut-name` provenance and checked feeds `metrics`/`workouts` are retained; a heartbeat does not prove measurements arrived.
- A SQL transaction rechecks the hashed capability, owner, device, permission, expiry and revocation, then commits raw bytes and receipt together. Owner-local transaction locks also serialize issue/revoke/rotate and concurrent acceptance. The signed-in owner can view status and create, rotate or revoke the current upload credential through `/api/health/upload-credential`; only its SHA-256 reference is stored. A newly issued plaintext appears once in the authenticated, `no-store` response and is never logged.
- HTTP `202` means **SQL committed**, not processed. `storage: sql`, `queue: pending` describe the SQL inbox, not an Azure Queue. There is no accepted-data dependency on an agent or second service.
- Exact owner/kind/automation/session, device, checksum and length retries return the original acceptance ID/time; changed bytes or device conflict (`409`). A lost response/commit acknowledgement is uncertain: retry the same identity and bytes, never invent a new session to evade the conflict.
- SQL unavailable or inbox full returns `503`, without acceptance. The phone must retain and retry its payload. Offline-SQL acceptance from the old Blob proposal is deliberately withdrawn. Real phone retry/backoff and outage behavior remain an acceptance gate.

## Bounds and raw retention

Uploads are at most **8 MiB**; ignored heartbeat bodies are at most **32 KiB**. The SQL inbox has a **256 MiB raw-byte ceiling and 10,000-row ceiling per owner** (a rehearsal caller may lower the byte limit, never raise it). All retained raw rows count, including processed/quarantined rows. Identical retries still work at capacity; new sessions fail closed. This is storage backpressure, not a billing cap or measured production sizing.

The Daily `daily.sync` source exposes numeric `inbox.retained_bytes` (the sum of
stored `byte_count` for every retained owner row), `inbox.byte_limit` and
`inbox.row_limit`, alongside retained/pending/quarantined counts and timestamps.
Pending, processing, processed and quarantined rows all consume capacity; other
owners' rows never count. An empty inbox reports zero retained bytes and still
returns both limits. No payload content is returned. See the
[Daily query reference](../../apps/backend/src/daily/README.md).

**This slice retains raw rows indefinitely within that ceiling and performs no age-based deletion or compaction.** Pending/quarantined evidence must not expire while processing, reconciliation or rollback needs it. A later reviewed change may compact processed raw bytes while preserving acceptance/checksum/idempotency evidence. No automatic cleanup or source-record deletion is authorized here.

Maintained rate guards run before the credential lookup/body/SQL work: default 60 requests/client and 120/instance per minute, 512 client buckets plus one instance bucket, eight active requests, 10-second verifier and 30-second acceptance signals. SQL lock acquisition is limited to five seconds; the existing backend pool has a 30-second acquisition bound. Cancellation cancels active queries and rolls back uncommitted work. No automatic database retry is added.

The existing backend does not trust forwarded headers. Behind ingress, clients may share the socket quota; real ingress/client identity and multi-replica/edge limits require verification before activation. In-memory quotas reset per process and are not a deployment-wide guarantee. SQL failures, receipts and logs contain no payload, bearer, header identity or provider error detail. `429` includes Retry-After; `503` requires bounded client backoff.

## Processing and replay limits

The existing `SqlHealthProcessor` is wired to a bounded worker only in the same default-off production composition. It claims one owner inbox row at a time under the existing owner transaction lock, marks a 45-second processing lease, and recovers expired leases after restart. Accepted, processing, succeeded (`health_ingestions.status`), and quarantined evidence are distinct; SQL acceptance never claims processing success. The worker drains at most ten completed/quarantined rows before a one-second pause, polls idle/retry states every 30 seconds, and wakes after durable acceptance. Retry delays are bounded; exhausted/invalid rows remain quarantined with raw evidence retained.

Existing writes reject older `accepted_at` snapshots from replacing newer per-key rows, and an older workout retry cannot replace newer child details. Empty workout exports do not delete history. This does **not** establish complete-day replacement safety: the original Health Auto Export request has no verified day-completeness marker, and a later partial chunk can replace the values it supplies for a metric/date key.

### Historical exporter batching guidance

- Keep each source metric/date group intact within one request; never split the values that define one daily snapshot across sessions. Retry only the exact same bytes with the same automation and session identifiers.
- Keep each original request at or below **8 MiB**. The normalized processor output must remain at or below **10,000 rows and 8 MiB**; the retained inbox ceiling is **256 MiB or 10,000 rows per owner**. These are hard limits, not target batch sizes.
- Upload only exporter payloads that can preserve complete metric/date groups within all three limits. If the exporter cannot do that, stop instead of splitting an oversized group or sending a partial replacement. A `202` response proves SQL acceptance only, not processing or historical completeness.
- Processed-feed freshness and aggregate inbox counts do not prove that a particular historical session completed. Do not use them as per-session receipts or as evidence of complete history.
- The source contract does not establish Health Auto Export's date-range controls, automatic chunking behavior, or settings-screen sequence. Those app-specific steps and the current exporter version remain **unverified**; do not substitute Health Sync or claim a verified phone workflow.

No real historical replay or complete-day guarantee is claimed. Current hard limits are not permission to exceed the source-compatible contract.

The pinned source identifies **Health Auto Export**. Do not substitute Health Sync or issue device setup instructions as if the apps were interchangeable. Live exporter version/payload acceptance and app-specific UI steps remain unverified.

## Protected device-capability management

`SqlHealthCapabilities` generates a random 256-bit bearer in a redacted prepared handle. SQL stores only its SHA-256 reference, configured owner, device, scopes, expiry, revocation and reserved replacement reference. The existing owner-authenticated route is the only issuance/rotation/revocation interface; no CLI, second authentication service or operator grant exists. The credential can be created only after the explicit flag is enabled and is not currently provisioned.

Issue is idempotent for the retained handle; revoked records never reactivate. Rotation retains the device and may only narrow scopes. Old revocation, one reserved replacement and replacement issue commit atomically in SQL. Competing replacements conflict. Response loss remains uncertain; the owner must check status and rotate if the one-time reveal was lost. `useSecret()` is confined to the authenticated response and never writes logs/chat/GitHub. Handle loss cannot recover a bearer from its hash. No real credential is issued here.

## Readiness and rollback gates

1. Exact-head independent review, normal full CI and isolated SQL tests remain required. This PR sets the existing backend flag in `infra/main.bicep` to `'true'` as explicitly authorized; it creates no new resource, identity or grant. Deployment is not evidence of successful endpoint/worker verification. Rollback sets the flag to `'false'` and updates the matching pin test in the same change, then redeploys; stored credential hashes and ingested data remain untouched.
2. The owner creates the credential through the owner-authenticated route after deployment. Verify endpoint origin/ingress and protected one-time credential custody; no new resource, identity, grant, SAS extraction or plaintext credential in GitHub is implied.
3. Synthetic deployed denial/revocation/expiry, byte-exact readback, concurrent retry/conflict, SQL outage/restart, capacity and cancellation checks remain unverified, as does actual Health Auto Export/iPhone acceptance. Coding tests do not prove these.
4. #720 processing/freshness and the historical upload path's bounded grouping/limits require verification. The owner withdrew the #717 database-export/preflight route; do not revive it or treat it as a prerequisite. This synthetic implementation does not establish complete historical replay or cutover readiness.
5. Disable upload composition on failed readiness; preserve all SQL receipts/raw/capabilities. Migration 0046 rollback refuses either nonempty table. Never delete original Daily data or automatically requeue native effects.

## Verification commands

Run backend lint/build and `npm test --workspace @jarvis/backend -- src/daily/health-upload src/auth/auth.test.ts src/app.test.ts src/database/migrations.test.ts`. The normal `Database CI` workflow runs `health-upload.integration.test.ts` against disposable loopback SQL Server, covering concurrency, rollback, real persistence and backend composition. Do not point tests at production; no local SQL image is started by this slice.

The [legacy proposal](legacy-host-proposal.md), `proposal.bicep`, standalone `health-upload/main.ts`/host/recovery and Blob/Queue adapter remain **unused and superseded**, outside production wiring. Their existing emulator/regression tests remain; they are not SQL acceptance evidence. No old `DAILY_HEALTH_*` flag activates the new path.
