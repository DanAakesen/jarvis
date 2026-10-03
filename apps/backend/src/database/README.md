# Database ownership

`loadDatabaseConfig` accepts Azure SQL `SQL_SERVER`, `SQL_DATABASE` and the
user-assigned identity UUID `SQL_MANAGED_IDENTITY_CLIENT_ID`. Managed identity
is the default/only deployed authentication mode; TLS validates the server.
`mssql` 12.7.2/Tedious support `azure-active-directory-msi-app-service`, and the
installed Tedious implementation uses Azure Identity `ManagedIdentityCredential`.
This verifies driver support, not a live Azure token exchange.

The process owns one pool, registers its close hook and explicitly awaits
`initialize` before listening. Connection and requests have 120-second bounds;
startup has a 300-second deadline and app-lock wait a 60-second bound. Initialization
must not move into a Fastify ready hook, whose default 10-second timeout conflicts
with SQL auto-resume. On cancellation, active SQL requests are cancelled and the
transaction rolls back. An in-flight connect cannot be forcibly closed by mssql;
its owner closes it as soon as it settles and never starts a migration afterwards.
The existing five-second process shutdown deadline bounds final disposal.

No settings leaves the offline skeleton disconnected; partial settings fail
startup. The pool has minimum zero, 30-second idle eviction, and socket-only
connection validation; no idle SQL poll is added. The ledger/schema lock exist
only during startup. Driver errors and SQL text are not logged or returned.

Run offline tests with `npm test --workspace @jarvis/backend`. Aggregate CI calls
`database-ci.yml`, starts disposable SQL Server and runs
`npm run test:database --workspace @jarvis/backend`. These integration checks
cover repeat and concurrent application, rollback, immutable history, app-lock
contention, and request cancellation. Test-password authentication is allowed
only with `NODE_ENV=test` on `127.0.0.1`; CI generates and deletes unique isolated
databases. Neither agents nor Actions tests connect to Azure SQL.

The Docker image includes committed `db/migrations`; compiled and source code
resolve the same repository-relative directory. `tool_calls` writes use the
group-one schema owned by P1-01 (#15), which must be migrated before calls can be
persisted. Real Azure identity connectivity and new-revision/restart acceptance
remain issue #11.
