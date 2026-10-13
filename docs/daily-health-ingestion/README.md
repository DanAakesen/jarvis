# Daily health acceptance in the existing backend

Dan directly approved the revised #719 design on 13 October 2026: reuse Jarvis's backend and SQL, with no new Azure resources. This is an **inactive, synthetic-test-only** implementation. Original Daily remains canonical and unchanged; #720 owns normalization/processing. Production `index.ts` supplies no enablement, verifier, credential or environment flag.

## Acceptance contract

`createSqlHealthUpload(existingPool, configuredOwner)` returns disabled dependencies. Explicit rehearsal composition can pass them in the `buildApp` healthUpload option with `enabled: true`; it neither opens another pool nor provisions credentials. The scoped plugin installs only POST `/api/health/ingest` and `/api/health/heartbeat`. The root authentication exception requires explicit enablement, exact method/path and plugin opt-in. All other Jarvis login/service routes keep their current authentication.

- Ingest requires valid UTF-8 JSON, `automation-id` and `session-id`, with optional matching SHA-256 `checksum`/`x-payload-checksum`. Original bytes are preserved, including units/offsets/empty workouts; no measurements are normalized here.
- Bodyless heartbeat remains supported. Only bounded `shortcut-name` provenance and checked feeds `metrics`/`workouts` are retained; a heartbeat does not prove measurements arrived.
- A SQL transaction rechecks the hashed capability, owner, device, permission, expiry and revocation, then commits raw bytes and receipt together. Owner-local transaction locks also serialize issue/revoke/rotate and concurrent acceptance.
- HTTP `202` means **SQL committed**, not processed. `storage: sql`, `queue: pending` describe the SQL inbox, not an Azure Queue. There is no accepted-data dependency on an agent or second service.
- Exact owner/kind/automation/session, device, checksum and length retries return the original acceptance ID/time; changed bytes or device conflict (`409`). A lost response/commit acknowledgement is uncertain: retry the same identity and bytes, never invent a new session to evade the conflict.
- SQL unavailable or inbox full returns `503`, without acceptance. The phone must retain and retry its payload. Offline-SQL acceptance from the old Blob proposal is deliberately withdrawn. Real phone retry/backoff and outage behavior remain an acceptance gate.

## Bounds and raw retention

Uploads are at most **8 MiB**; ignored heartbeat bodies are at most **32 KiB**. The SQL inbox has a **256 MiB raw-byte ceiling and 10,000-row ceiling per owner** (a rehearsal caller may lower the byte limit, never raise it). All retained raw rows count, including processed/quarantined rows. Identical retries still work at capacity; new sessions fail closed. This is storage backpressure, not a billing cap or measured production sizing.

**This slice retains raw rows indefinitely within that ceiling and performs no age-based deletion or compaction.** Pending/quarantined evidence must not expire while processing, reconciliation or rollback needs it. Before activation, #720 and protected migration acceptance must establish verified processing and an approved retention/compaction policy; a later reviewed change may compact processed raw bytes while preserving acceptance/checksum/idempotency evidence. No automatic cleanup or source-record deletion is authorized here.

Maintained rate guards run before the credential lookup/body/SQL work: default 60 requests/client and 120/instance per minute, 512 client buckets plus one instance bucket, eight active requests, 10-second verifier and 30-second acceptance signals. SQL lock acquisition is limited to five seconds; the existing backend pool has a 30-second acquisition bound. Cancellation cancels active queries and rolls back uncommitted work. No automatic database retry is added.

The existing backend does not trust forwarded headers. Behind ingress, clients may share the socket quota; real ingress/client identity and multi-replica/edge limits require verification before activation. In-memory quotas reset per process and are not a deployment-wide guarantee. SQL failures, receipts and logs contain no payload, bearer, header identity or provider error detail. `429` includes Retry-After; `503` requires bounded client backoff.

## Protected device-capability preparation

The unregistered `SqlHealthCapabilities` operator library generates a random 256-bit bearer in a redacted prepared handle. SQL stores only its SHA-256 reference, configured owner, device, scopes, expiry, revocation and reserved replacement reference. Only the read-only verifier reaches HTTP composition; there is no provisioning/revoke/rotate endpoint, CLI, secret channel or operator grant.

Issue is idempotent for the retained handle; revoked records never reactivate. Rotation retains the device and may only narrow scopes. Old revocation, one reserved replacement and replacement issue commit atomically in SQL. Competing replacements conflict. Response loss is still uncertain and secret delivery is not transactional: retain the same protected handle and reconcile privately. `useSecret()` is only a future approved protected-consumer boundary, never a logging/chat/GitHub channel. Handle loss cannot recover a bearer from its hash. No real credential is issued here.

## Readiness and rollback gates

1. Exact-head independent review, normal full CI and isolated SQL tests; keep #719 open for remaining acceptance. Normal main-only deployment may add empty tables, not activate the path.
2. Approved protected credential custody/delivery, owner/ingress verification, retention/capacity policy and production composition. No new resource, identity, grant, SAS extraction or plaintext credential is implied.
3. Synthetic deployed denial/revocation/expiry, byte-exact readback, concurrent retry/conflict, SQL outage/restart, capacity and cancellation checks; then actual Health Auto Export/iPhone acceptance. Coding tests do not prove these.
4. #720 processing/freshness plus complete protected backup, reconciliation, final delta and rollback gates before cutover. The #717 backup destination/preflight is a separate unresolved workflow, not required for this synthetic implementation.
5. Disable upload composition on failed readiness; preserve all SQL receipts/raw/capabilities. Migration 0046 rollback refuses either nonempty table. Never delete original Daily data or automatically requeue native effects.

## Verification commands

Run backend lint/build and `npm test --workspace @jarvis/backend -- src/daily/health-upload src/auth/auth.test.ts src/app.test.ts src/database/migrations.test.ts`. The normal `Database CI` workflow runs `health-upload.integration.test.ts` against disposable loopback SQL Server, covering concurrency, rollback, real persistence and backend composition. Do not point tests at production; no local SQL image is started by this slice.

The [legacy proposal](legacy-host-proposal.md), `proposal.bicep`, standalone `health-upload/main.ts`/host/recovery and Blob/Queue adapter remain **unused and superseded**, outside production wiring. Their existing emulator/regression tests remain; they are not SQL acceptance evidence. No old `DAILY_HEALTH_*` flag activates the new path.
