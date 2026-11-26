# SQL health upload boundary

The upload path reuses the existing backend and SQL. See the [upload contract](../../../../../docs/reference/daily/health-ingestion.md) for configuration, bounds, retention and device acceptance.

| Component | Responsibility |
| --- | --- |
| `server.ts` | Scoped upload/heartbeat routes, early rate/concurrency guards, bounded parsers, device checks and sanitized responses. `buildApp` composes them only when the explicit flag is true. |
| `sql-composition.ts` | Builds upload dependencies from the existing pool and owner. Backend startup gates composition on `JARVIS_HEALTH_UPLOAD_ENABLED`. |
| `sql-buffer.ts` | Owner-locked SQL raw inbox and idempotent committed acceptance. |
| `sql-capabilities.ts` | Hashed verifier plus owner credential status/create/revoke/atomic-rotation operations. |
| `capability-routes.ts` | Existing owner-authenticated status/create/rotate/revoke routes; one-time bearer response is `no-store`. |
| `capability-operation.ts` | Redacted opaque handle; plaintext is consumed only by the guarded authenticated response. |
| [`../health/worker.ts`](../health/worker.ts) | Bounded processor worker with wake-up, idle polling and shutdown cancellation. |
| `sql-transaction.ts` | Bounded lock/query cancellation, rollback and sanitized uncertain failures. |
| migration `0046` | Empty owner-keyed capability/inbox tables; rollback refuses retained evidence. |
| migration `0060` | Reversible processing state; down migration refuses while rows are claimed. |

[`watch-credential.test.ts`](../../auth/watch-credential.test.ts) checks that the upload route's client and instance rate limits stay separate from Watch limits. [Database CI](../../../../../.github/workflows/database-ci.yml) uses disposable SQL for migration and database-contract checks. Neither establishes end-to-end upload or worker acceptance.

The standalone host, recovery and Blob/Queue adapters are not wired into this SQL path.
