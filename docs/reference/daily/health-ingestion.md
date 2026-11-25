# Health upload contract

The upload routes and SQL processor require `JARVIS_HEALTH_UPLOAD_ENABLED` and a configured SQL pool. The flag defaults off in code; checked-in Bicep sets it on. The deployed flag and credential state are not verified here. The Health Auto Export upload path is **not accepted on device**.

Health upload reuses Jarvis's backend and SQL. For legacy input compatibility, see the [original Daily v182 source protocol in Git](https://github.com/DanAakesen/jarvis/blob/060e3eb568e2a1cb4e7aa7048841640d8a47394b/docs/reference/daily-v182/README.md). It is not a runtime dependency.

## Acceptance contract

`createSqlHealthUpload(existingPool, configuredOwner)` returns the SQL-backed upload dependencies. `index.ts` passes them to `buildApp` only when `JARVIS_HEALTH_UPLOAD_ENABLED === "true"` and the SQL pool is configured. The scoped plugin installs only POST `/api/health/ingest` and `/api/health/heartbeat`. The root authentication exception requires explicit enablement, exact method/path and plugin opt-in. All other Jarvis login/service routes keep their current authentication.

- Ingest requires valid UTF-8 JSON, `automation-id` and `session-id`, with optional matching SHA-256 `checksum`/`x-payload-checksum`. Original bytes are preserved, including units/offsets/empty workouts; no measurements are normalized here.
- Bodyless heartbeat remains supported. Only bounded `shortcut-name` provenance and checked feeds `metrics`/`workouts` are retained; a heartbeat does not prove measurements arrived.
- A SQL transaction rechecks the hashed capability, owner, device, permission, expiry and revocation, then commits raw bytes and receipt together. Owner-local transaction locks also serialize issue/revoke/rotate and concurrent acceptance. The signed-in owner can view status and create, rotate or revoke the current upload credential through `/api/health/upload-credential`; only its SHA-256 reference is stored. A newly issued plaintext appears once in the authenticated, `no-store` response and is never logged.
- HTTP `202` means **SQL committed**, not processed. `storage: sql`, `queue: pending` describe the SQL inbox, not an Azure Queue.
- Exact owner/kind/automation/session, device, checksum and length retries return the original acceptance ID/time; changed bytes or device conflict (`409`). A lost response/commit acknowledgement is uncertain: retry the same identity and bytes, never invent a new session to evade the conflict.
- SQL unavailable or inbox full returns `503`, without acceptance. The phone must retain and retry its payload. Offline-SQL acceptance from the old Blob proposal is deliberately withdrawn. Real phone retry/backoff and outage behavior remain an acceptance gate.

## Bounds and raw retention

Uploads are at most **8 MiB**; ignored heartbeat bodies are at most **32 KiB**. The SQL inbox has a **256 MiB raw-byte ceiling and 10,000-row ceiling per owner** (a rehearsal caller may lower the byte limit, never raise it). All retained raw rows count, including processed/quarantined rows. Identical retries still work at capacity; new sessions fail closed. This is storage backpressure, not a billing cap or measured production sizing.

The Health query source `daily.sync` exposes `inbox.retained_bytes` (the sum of
`byte_count` for every retained owner row), `inbox.byte_limit` and
`inbox.row_limit`, alongside retained/pending/processing/quarantined counts and timestamps.
Pending, processing, processed and quarantined rows all consume capacity; other
owners' rows never count. An empty inbox reports zero retained bytes and still
returns both limits. No payload content is returned. The web Health freshness
popover shows these figures in a "Stored" row. See the [Health module](../../../apps/backend/src/health/README.md).

Raw rows have no age-based deletion or compaction. Preserve pending and quarantined rows for processing, reconciliation and rollback, and keep acceptance, checksum and idempotency evidence.

Maintained rate guards run before the credential lookup/body/SQL work: default 60 requests/client and 120/instance per minute, 512 client buckets plus one instance bucket, eight active requests, 10-second verifier and 30-second acceptance signals. SQL lock acquisition is limited to five seconds; the existing backend pool has a 30-second acquisition bound. Cancellation cancels active queries and rolls back uncommitted work. No automatic database retry is added.

The existing backend does not trust forwarded headers. Behind ingress, clients may share the socket quota; real ingress/client identity and multi-replica/edge limits require verification before activation. In-memory quotas reset per process and are not a deployment-wide guarantee. SQL failures, receipts and logs contain no payload, bearer, header identity or provider error detail. `429` includes Retry-After; `503` requires bounded client backoff.

## Processing and replay limits

The same upload switch gates the bounded `SqlHealthProcessor` worker. It claims one owner inbox row at a time under the owner transaction lock, marks a 45-second processing lease, and recovers expired leases after restart. Accepted, processing, succeeded (`health_ingestions.status`), and quarantined evidence are distinct; SQL acceptance never claims processing success. The worker drains at most ten completed/quarantined rows before a one-second pause, polls idle/retry states every 30 seconds, and wakes after durable acceptance. Retry delays are bounded; exhausted/invalid rows remain quarantined with raw evidence retained.

Existing writes reject older `accepted_at` snapshots from replacing newer per-key rows, and an older workout retry cannot replace newer child details. Empty workout exports do not delete history. This does **not** establish complete-day replacement safety: the original Health Auto Export request has no verified day-completeness marker, and a later partial chunk can replace the values it supplies for a metric/date key.

### Historical exporter batching guidance

- Keep each source metric/date group intact within one request; never split the values that define one daily snapshot across sessions. Retry only the exact same bytes with the same automation and session identifiers.
- Keep each original request at or below **8 MiB**. The normalized processor output must remain at or below **10,000 rows and 8 MiB**; the retained inbox ceiling is **256 MiB or 10,000 rows per owner**. These are hard limits, not target batch sizes.
- Upload only exporter payloads that can preserve complete metric/date groups within all three limits. If the exporter cannot do that, stop instead of splitting an oversized group or sending a partial replacement. A `202` response proves SQL acceptance only, not processing or historical completeness.
- Processed-feed freshness and aggregate inbox counts do not prove that a particular historical session completed. Do not use them as per-session receipts or as evidence of complete history.
- The source contract does not establish Health Auto Export's date-range controls, automatic chunking behavior, or settings-screen sequence. Those app-specific steps and the current exporter version remain **unverified**; do not substitute Health Sync or claim a verified phone workflow.

No real historical replay or complete-day guarantee is claimed. Current hard limits are not permission to exceed the source-compatible contract.

Use **Health Auto Export**, not Health Sync. The live exporter version, payload acceptance and app-specific setup remain unverified.

## Protected device-capability management

`SqlHealthCapabilities` generates a random 256-bit bearer in a redacted prepared handle. SQL stores only its SHA-256 reference, configured owner, device, scopes, expiry, revocation and reserved replacement reference. The existing owner-authenticated route is the only issuance/rotation/revocation interface; no CLI, second authentication service or operator grant exists. The credential can be created only after the explicit flag is enabled.

Issue is idempotent for the retained handle; revoked records never reactivate. Rotation retains the device and may only narrow scopes. Old revocation, one reserved replacement and replacement issue commit atomically in SQL. Competing replacements conflict. Response loss remains uncertain; the owner must check status and rotate if the one-time reveal was lost. `useSecret()` is confined to the authenticated response and never writes logs/chat/GitHub. Handle loss cannot recover a bearer from its hash. No real credential is issued here.

## Readiness and rollback gates

1. Use exact-head independent review, applicable CI and isolated SQL tests for changes. Deployment alone does not verify the endpoint or worker. To disable the path, revert the backend flag to `'false'` with the matching pin test and redeploy through the normal workflow. Preserve stored credential hashes and ingested data.
2. The owner creates the credential through the owner-authenticated route after deployment. Verify endpoint origin/ingress and protected one-time credential custody; no new resource, identity, grant, SAS extraction or plaintext credential in GitHub is implied.
3. Synthetic deployed denial/revocation/expiry, byte-exact readback, concurrent retry/conflict, SQL outage/restart, capacity and cancellation checks remain unverified, as does actual Health Auto Export/iPhone acceptance. Coding tests do not prove these.
4. Verify processing and freshness separately from upload acceptance. Synthetic tests do not verify complete historical replay or cutover readiness. The withdrawn database-export path is not a prerequisite.
5. Disable upload composition on failed readiness; preserve all SQL receipts/raw/capabilities. Migration 0046 rollback refuses either nonempty table. Never delete original Daily data or automatically requeue native effects.

## Verification commands

For auth, app composition and migration changes, run `npm test --workspace @jarvis/backend -- src/auth/auth.test.ts src/app.test.ts src/database/migrations.test.ts`. [Database CI](../../../.github/workflows/database-ci.yml) uses disposable loopback SQL Server. These checks do not establish end-to-end upload or processing acceptance. Never point them at production.

The dedicated host and Blob/Queue design was withdrawn. The standalone host/recovery and Blob/Queue adapters are outside production wiring. Their emulator/regression tests are not SQL acceptance evidence. No old `DAILY_HEALTH_*` flag activates the new path.
