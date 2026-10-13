# Inactive SQL health upload boundary

P12-04 now reuses the existing backend and SQL. See the [contract, bounds, retention and operator gates](../../../../../docs/daily-health-ingestion/README.md).

| Component | Responsibility |
| --- | --- |
| `server.ts` | Scoped upload/heartbeat routes, early rate/concurrency guards, bounded parsers, device checks and sanitized responses. `buildApp` opts in explicitly; production does not. |
| `sql-composition.ts` | Default-off dependencies using an injected existing pool/owner; no environment flags or credentials. |
| `sql-buffer.ts` | Owner-locked SQL raw inbox and idempotent committed acceptance; no processor or cleanup. |
| `sql-capabilities.ts` | Hashed verifier plus separate inactive issue/revoke/atomic-rotation library. |
| `capability-operation.ts` | Redacted opaque prepared handle; explicit future protected secret-consumer boundary. |
| `sql-transaction.ts` | Bounded lock/query cancellation, rollback and sanitized uncertain failures. |
| migration `0046` | Empty owner-keyed capability/inbox tables; rollback refuses retained evidence. |

`backend.test.ts` exercises the real Fastify composition with injected synthetic persistence. `database/health-upload.integration.test.ts` exercises actual SQL transactions, concurrent retries, owner/device isolation, revocation/rotation, capacity, rollback and HTTP composition in normal isolated Database CI. Existing auth/app/module regressions remain required.

`azure-buffer.ts`, Blob `capability-lifecycle.ts`, standalone `main.ts`/`host.ts`, recovery and Bicep proposal are **superseded, unused historical code**, never composed into this path. Their [protocol](legacy-protocol.md) and emulator checks remain separate regression evidence. No Blob/Queue/identity/resource is needed for the approved SQL design.
