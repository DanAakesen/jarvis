# SQL health upload boundary

P12-04 now reuses the existing backend and SQL. See the [contract, bounds, retention and operator gates](../../../../../docs/daily-health-ingestion/README.md).

| Component | Responsibility |
| --- | --- |
| `server.ts` | Scoped upload/heartbeat routes, early rate/concurrency guards, bounded parsers, device checks and sanitized responses. `buildApp` composes them only when the explicit flag is true. |
| `sql-composition.ts` | Default-off dependencies using the injected existing pool/owner. Production enables these only through `JARVIS_HEALTH_UPLOAD_ENABLED`. |
| `sql-buffer.ts` | Owner-locked SQL raw inbox and idempotent committed acceptance. |
| `sql-capabilities.ts` | Hashed verifier plus owner credential status/create/revoke/atomic-rotation operations. |
| `capability-routes.ts` | Existing owner-authenticated status/create/rotate/revoke routes; one-time bearer response is `no-store`. |
| `capability-operation.ts` | Redacted opaque handle; plaintext is consumed only by the guarded authenticated response. |
| `../health/worker.ts` | Bounded processor worker with wake-up, idle polling and shutdown cancellation. |
| `sql-transaction.ts` | Bounded lock/query cancellation, rollback and sanitized uncertain failures. |
| migration `0046` | Empty owner-keyed capability/inbox tables; rollback refuses retained evidence. |
| migration `0060` | Reversible processing state; down migration refuses while rows are claimed. |

`backend.test.ts` exercises the real Fastify composition with injected synthetic persistence. `database/health-processing.integration.test.ts` exercises actual SQL transactions, concurrent retries, owner/device isolation, revocation/rotation, capacity, rollback, processing-state transitions and HTTP composition in normal isolated Database CI. Existing auth/app/module regressions remain required.

`azure-buffer.ts`, Blob `capability-lifecycle.ts`, standalone `main.ts`/`host.ts`, recovery and Bicep proposal are **superseded, unused historical code**, never composed into this path. Their [protocol](legacy-protocol.md) and emulator checks remain separate regression evidence. No Blob/Queue/identity/resource is needed for the approved SQL design.
