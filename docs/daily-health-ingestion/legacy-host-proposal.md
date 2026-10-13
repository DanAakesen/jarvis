# Superseded dedicated-host proposal

Historical record only. Dan replaced this design on 13 October 2026 with the existing backend and SQL inbox. **Do not deploy or activate this host, template, Blob/Queue path or recovery loop.** The old resource/budget/idle-recovery choices below are withdrawn, not outstanding user decisions. See the [current SQL boundary and gates](README.md). Retained code/tests are regression evidence, not the implementation route.

This is the code-only continuation of [#719 release 6136243434](https://github.com/DanAakesen/jarvis/issues/719#issuecomment-6136243434), after the reviewed inactive #761 boundary. Nothing here is referenced by `infra/main.bicep`, production parameters, deployment workflows or the planner. **Do not execute the template.** Resource/identity/role/secret/device/activation approvals have not been granted. Existing Jarvis startup, login, source URLs, Health Auto Export/Shortcut settings and original Daily remain unchanged. Original Daily stays canonical with normal authorized writes. Processing belongs to #720.

The existing backend image contains a separate entry point, `node apps/backend/dist/daily/health-upload/main.js` (workspace script `npm run start:health-upload --workspace @jarvis/backend`). Its default is inactive: it listens for liveness, contributes no upload endpoints and constructs no credential/storage dependencies. Explicit enabled configuration constructs **only the named user-assigned ManagedIdentityCredential**, never a developer/CLI/password credential chain. Coding tests inject isolated emulator dependencies; they do not obtain a managed-identity token or contact Azure.

## Nonsecret configuration

| Variable | Meaning / bounds |
| --- | --- |
| `DAILY_HEALTH_UPLOAD_ENABLED` | Exact `true`/`false`; absent is false. No production flag is set here. |
| `DAILY_HEALTH_MODE` | `serve` default or explicit `recover-once`. No normalization or queue consumption. |
| `DAILY_HEALTH_HOST`, `DAILY_HEALTH_PORT` | Bind `0.0.0.0` default / `127.0.0.1` / `::`; port 3001 default, 1024–65535. |
| `DAILY_HEALTH_OWNER_OBJECT_ID` | Existing Jarvis server owner GUID, never a device/model-selected owner/email. Required when enabled. |
| `DAILY_HEALTH_MANAGED_IDENTITY_CLIENT_ID` | Explicit approved dedicated identity GUID; required when enabled. No fallback identity/grant. |
| `DAILY_HEALTH_BLOB_URL`, `DAILY_HEALTH_QUEUE_URL` | Same-account global Azure HTTPS service roots only; no query/SAS/userinfo/path override. |
| `DAILY_HEALTH_RAW_CONTAINER`, `DAILY_HEALTH_DEVICE_CONTAINER`, `DAILY_HEALTH_QUEUE_NAME` | Valid lower-case storage names; raw/device containers must differ. |
| `DAILY_HEALTH_RECOVERY_ENABLED` | Exact boolean, default false; requires upload enablement. A helper alone does not recover anything. |
| `DAILY_HEALTH_RECOVERY_INTERVAL_MS` | 60000 default, 1000–300000; failures back off to at most 300000. No overlapping ticks. |
| `DAILY_HEALTH_RECOVERY_PAGE_SIZE` | 25 default, 1–100 manifests per batch. |
| `DAILY_HEALTH_RECOVERY_DEADLINE_MS` | 20000 default, 1000–20000; lease is 60 seconds, cleanup deadline 3 seconds. |
| `DAILY_HEALTH_REPLAY_QUEUED` | Default false; true allowed only in explicit `recover-once` operator mode. |
| `DAILY_HEALTH_SHUTDOWN_MS` | 35000 default, 3000–35000; blueprint proposes 25000 within a separately verified platform grace period. |
| `DAILY_HEALTH_RATE_PER_CLIENT`, `DAILY_HEALTH_RATE_PER_INSTANCE` | Defaults 60 / 120 requests per window; 1–1000, client <= instance. Always enforced when upload routes exist. |
| `DAILY_HEALTH_RATE_WINDOW_MS` | 60000 default, 1000–300000. Stable HTTP 429 + integer Retry-After; retries count against the same budget. |
| `DAILY_HEALTH_TRUSTED_PROXY_CIDRS` | Empty default ignores forwarded client claims; max eight literal CIDRs, IPv4 prefix >=16 / IPv6 >=64 (mapped IPv4 >=112). No DNS, blanket trust or zone IDs. Operator must verify actual trusted ingress hops. |

No token, connection string, human password or provider key is accepted in host configuration. Capability issuance/rotation/revocation is prepared only as the separate inactive library below; no live workflow/channel is installed. Startup validation rejects malformed configuration before listening. Storage/identity outages fail requests closed, not with fabricated acceptance. `/health` is configuration/liveness only; it does not attest Azure permission, durable connectivity or processed freshness.

## Protected device-capability preparation

`HealthCapabilityLifecycle` accepts a separately injected private `ContainerClient` and the existing configured Jarvis owner. No credential factory, CLI, endpoint, UI, schedule or production registration calls it. The upload identity's proposed capability access remains read-only; no blueprint role changes are made. Future operator write access and execution require independent approval, not an ambient developer/CLI credential chain.

`prepare()` validates exact device ID, one or both allowed scopes and a future canonical UTC expiry, then generates 32 random bytes with Node crypto. Owner GUID identity follows the existing case-insensitive `ownerId()` contract; revocation preserves the stored owner spelling and expiry along with every other field except `revoked`. No imported bearer is rewritten. The protected prepared object retains the bearer in memory; JSON/inspection is redacted. Its explicit `useSecret()` callback is a boundary for a future approved private consumer, not authorization or an implemented storage/delivery channel. Never pass it to logs, GitHub, ordinary files or model/client output. New secrets are used only in isolated synthetic emulator tests here.

`issue()` uses conditional create. The same retained handle is the retry key; an exact existing record is recognized, a revoked exact record remains revoked, and unrelated/malformed collisions fail without overwrite. `revoke()` uses bounded ETag retries and changes only `revoked` to true; an already revoked record remains terminal. Missing records report not-found, not a device-wide revocation guarantee. Record revocation does not cancel another independently issued credential for the same device.

`rotate()` reserves exactly one replacement in `health-device-rotations/<old reference>.json` with conditional creation. The private journal contains hashes/capability metadata, never the bearer. Competing replacements conflict; exact retries resume. Replacement must retain the device and may only narrow existing scopes. Old revocation commits before replacement issue: a failure can leave both denied, and a successful rotation says nothing about secret delivery. A revoked replacement is never reactivated. No cross-Blob atomicity or exactly-once handoff is promised. SDK/cancellation/response-loss errors are fixed sanitized codes with unknown mutation outcome; do not infer no write occurred.

Operator recovery is still a protected readiness gate: retain the same prepared handle securely through retries; inspect private operation evidence using the approved workflow, resume the reserved replacement, or explicitly revoke it if abandoned. Losing that handle means the bearer cannot be recovered from its SHA-256 record/journal; it must not be regenerated under a different replacement while claiming the reserved operation completed. Approved durable secret custody, authenticated recipient verification, secure delivery, response-loss reconciliation and operator role scope are NOT supplied or executed here. A leaked credential requires explicit revocation, not raw-data deletion. Real phone provisioning/rotation and deployed access tests remain separate approvals.

Synthetic HTTP/SDK/Azurite tests cover concurrent exact issue, collisions/malformed records, owner/scope/expiry/revocation denial, separate devices, competing rotations, scope narrowing, replacement failure after old revocation, committed response loss and cancellation after journal commit. Neither capability bodies nor bearers enter runtime status/errors. The dedicated host, normal human login and production module remain unchanged.

## Request-rate boundary and deployment limits

Maintained `@fastify/rate-limit` 11.2.1 guards both POST routes **before credential verification, Blob/Queue calls or body processing**. Independent per-instance and client-IP budgets complement the eight-active-request limit; maxRequestsPerSocket/body/deadline limits alone do not control sequential cost. Client buckets use a bounded 512-entry LRU, instance budget an independent one-entry store, with no raw token/device keys. IP normalization groups IPv6 /64 and mapped IPv4. Missing/invalid forwarded identities fall back to the real socket. Liveness does not consume storage or these POST budgets. Rate rejection emits sanitized fixed text and Retry-After, never raw IP/header/health/token values.

Default identification is the socket peer. Behind unconfigured ingress proxies clients can share one quota; headers cannot assert an identity. Explicit narrow trusted CIDRs use Fastify's nearest-untrusted-hop resolution only after the operator verifies ingress append/sanitization behavior. This is **per process/instance**, not deployment-wide protection: multiple replicas/revisions or restart reset/multiply independent budgets. The proposed max-one replica is not proof of an aggregate limit across deployment transitions. Multi-replica/shared-store or edge enforcement and real ingress/client identification require separate design/approval/live acceptance; no Redis, WAF, service, permission or edge change is made here. Do not dismiss CodeQL alert 19 or suppress the check; this slice supplies actual early-rejection regressions and leaves deployment-wide acceptance explicit. Adding the maintained plugin is a necessary dependency change (three packages); the shared lockfile retains its normal existing-platform deployment effects, with no planner workaround.

## Recovery ownership and lifecycle

Each configured owner has a private `control/recovery-<owner hash>.json` checkpoint in the raw container. One 60-second Blob lease owns a batch; competing owners report busy with unknown coverage. The durable cursor advances only after the bounded page finishes, persists across process/job restarts and wraps after the last page. Failed manifest deliveries remain pending and are retried on a later sweep. Malformed checkpoint/owner/pointer data fails closed. A crash before checkpoint repeats work rather than skipping it. Queue pointers are non-expiring and at least once; crash/response/lease ambiguity may duplicate them. #720 must deduplicate and record processed state independently.

The optional loop runs only while the dedicated host instance exists. SIGTERM/SIGINT stop new work, cancel SDK/HTTP operations and wait within the shutdown bound; interrupted unacknowledged uploads can retry their exact identity/bytes. A forced kill retains committed raw/acceptance evidence and may hold recovery ownership until the 60-second lease expires. No ordinary lease-breaking, payload deletion or irreversible retention policy is installed. Internal counters saturate, statuses/errors use fixed codes, and telemetry contains no records, owner/device IDs, headers, raw keys, cursors, bearer or lease values. Counters distinguish acceptance/pending/queued delivery and never processed health data.

The executable emits fixed-shape private `health_receipt_events` snapshots every 60 seconds (bounded `DAILY_HEALTH_DIAGNOSTICS_INTERVAL_MS`, 1–300 seconds) and once after shutdown drains or reaches its deadline. Its owned interval is canceled at shutdown; observer failures cannot change durable acceptance. Counters are cumulative receipt events, including duplicate retries, not unique records, current backlog or processed measurements. They saturate at one billion per counter. Private diagnostics are separate from public liveness and never expose limiter keys or source payloads. Synthetic HTTP/Azurite tests cover pending/queued/duplicate/rejected receipts, shutdown cancellation and throwing observers; the packaged inactive executable also proves its shutdown log consumer.

**Idle/scale-to-zero is an open reliability and cost gate.** A process timer cannot wake a scaled-to-zero app. Queue-length scaling cannot discover the Blob-only pending gap when Queue delivery failed. Reliable unattended idle recovery needs an explicitly approved minimum live instance (for example minReplicas=1) or a separately approved external job/schedule that invokes bounded recovery. This PR creates neither a schedule nor an Actions workflow. `recover-once` prepares one operator-triggered batch, uses the shared durable cursor and returns sanitized status: exit 0 means that batch completed, 1 means error/partial/timeout/canceled, 2 means lease busy. `hasMore=false` is a completed sweep boundary, not evidence all uploads are processed or no new uploads arrived. A dormant/uninvoked command supplies no recovery guarantee.

## Isolated blueprint

[proposal.bicep](proposal.bicep) is a self-contained proposal in the existing resource group, with required nonsecret inputs and no imported modules. It reuses the named existing Jarvis Container Apps environment and registry/log destination. Proposed new resources are one dedicated user-assigned identity, one Standard_LRS storage account, private raw/control and capability containers, a pointer queue, scoped role definitions/assignments and an optional dedicated Container App using the existing approved backend image with an explicit entry-point override. App creation, upload and recovery flags default off; minimum replicas default zero, max one. The proposed sizing is 0.5 CPU/1 GiB, **not benchmarked capacity or cost approval**.

| Proposed identity access | Scope / exclusions |
| --- | --- |
| Raw/control Blob read/write/lease + container properties | Only raw container; no delete, account keys or user-delegation keys. Immutable acceptance writes still use conditions. |
| Capability Blob read + container properties | Only separate capability container; no issuance/revocation writes. |
| Queue message add | Only pointer queue; no receive/peek/update/delete or domain processing. |
| Existing ACR Pull convention | Named existing registry only, not subscription/platform ownership. |

The coordinator verified Microsoft's public permission mapping on 13 October 2026: [Storage Queue Data Message Sender](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/storage#storage-queue-data-message-sender) uses exactly `Microsoft.Storage/storageAccounts/queueServices/queues/messages/add/action` with no management actions; [Lease Blob](https://learn.microsoft.com/en-us/rest/api/storageservices/lease-blob#permissions) is covered by Blob write; [Get Container Properties](https://learn.microsoft.com/en-us/rest/api/storageservices/get-container-properties#permissions) requires container read. The proposal retains separate raw/capability/queue assignment scopes, no Blob delete, capability write or queue consumption/update/delete. The offline `proposal.test.ts` contract checks these exact sets/scopes, inactive/max-one defaults and absence of production references; it reproduced the missing sender `/action` suffix before correction. Bicep compilation and Shared-Key emulator tests do not validate provider RBAC names or deployed authorization. Trusted operator verification of actual grants, identity propagation and private access remains required **before approving/executing grants**. Authenticated public storage service endpoints are proposed, not private-link/network-isolation proof. Retention, backups, redundancy, networking, log access and quota/alerts need protected approval. No guessed price, free allowance or spending ceiling is treated as approved.

## Readiness and rollback checklist — not executed

1. Obtain separate resource/cost/access/private-retention approval with current pricing and traffic/capacity evidence; select reliable idle recovery. Verify original protected backup/reconciliation/rollback and source/phone gates. Do not change source code/schema/records or phone configuration from coding.
2. Review exact image digest/config/owner against current main; verify existing environment/registry compatibility, custom permissions (including lease and container-property calls), propagation, private containers and TLS with the trusted operational workflow. No live record/credential belongs in GitHub/Codex.
3. Prepare separately reviewed main-only release wiring after approval; never run ad-hoc Azure deployment from this coding environment. This file is deliberately outside the watched `infra/` tree; do not edit the planner to conceal activation.
4. Provision scoped capability records only through an approved protected owner-bound issuer, never human passwords/legacy tokens. First verify denial/revocation/expiry/wrong-owner and synthetic HTTP acceptance/private raw checksum/pointer coverage with the deployed identity, redacted evidence only.
5. Rehearse SQL/agent/Queue outage, recovery restart/lease expiry/deadlines and no acknowledged-data loss. Verify accepted/pending/queued versus #720 processed timestamps. Do not claim real iPhone/Health Auto Export parity from emulator proof. Full migration/dependency/parity/reconciliation/private-backup/rollback gates still govern pre-authorized cutover.
6. On a failed live readiness gate, keep/return upload and recovery off using the separately approved release path; stop the dedicated host before operational replay. Retain raw, manifests, cursors and non-expiring pointers. Wait for abandoned lease expiry; never break a live lease casually. Explicit queued replay requires downstream dedup/reconciliation review. Do not delete data/resources, automatically requeue native effects or rewrite original Daily. Source stays canonical until full cutover acceptance.

## Executed offline checks

After explicit `source /workspace/.jarvis-tools/activate.sh`, run:

```bash
npm test --workspace @jarvis/backend -- src/daily/health-upload/buffer.emulator.test.ts src/daily/health-upload/host-config.test.ts src/daily/health-upload/recovery.test.ts
npm test --workspace @jarvis/backend -- src/daily/health-upload/proposal.test.ts
npm run lint --workspace @jarvis/backend
npm run build --workspace @jarvis/backend
/workspace/.jarvis-tools/bicep build docs/daily-health-ingestion/proposal.bicep --no-restore --outfile /tmp/daily-health-proposal.json
/workspace/.jarvis-tools/bicep lint docs/daily-health-ingestion/proposal.bicep
```

Actual synthetic HTTP/SDK/Azurite tests exercise pending recovery, persisted cursor, lease contention/cleanup, byte retention after killed gateway/recovery owner, cancellation, packaged inactive entry-point startup and real SIGTERM. The killed-recovery test simulates expiry by breaking only the isolated emulator lease after confirmed process death; it does not claim a production recovery action. Configuration/deadline/backoff tests complement that durable proof. Bicep 0.48.1 offline build/lint passes without warnings. Exact-head normal CI/container/SQL and independent review are required for the draft handoff. Azure identity/grants/resources, reliable idle recovery, production activation, protected source migration, actual provider/iPhone and physical-device acceptance remain unverified.
