# Database ownership

`loadDatabaseConfig` accepts Azure SQL `SQL_SERVER`, `SQL_DATABASE` and the
user-assigned identity UUID `SQL_MANAGED_IDENTITY_CLIENT_ID`. Managed identity
is the default/only deployed authentication mode; TLS validates the server.
`mssql` 12.7.2/Tedious support `azure-active-directory-msi-app-service`, and the
installed Tedious implementation uses Azure Identity `ManagedIdentityCredential`.
This verifies driver support, not a live Azure token exchange.

The process owns one pool, registers its close hook and explicitly awaits
`initialize` before listening. Connection creation and pool acquisition attempts
have 30-second bounds; executed queries retain their 120-second timeout.
Startup has a 300-second deadline and app-lock wait a 60-second bound. Initialization
must not move into a Fastify ready hook, whose default 10-second timeout conflicts
with SQL auto-resume. On cancellation, active SQL requests are cancelled and the
transaction rolls back. An in-flight connect cannot be forcibly closed by mssql;
its owner closes it as soon as it settles and never starts a migration afterwards.
The existing five-second process shutdown deadline bounds final disposal.

Startup connection and on-demand pool acquisition retry Azure SQL resume errors
40613, 40197, 40501 and connection/acquisition timeouts with exponential backoff
(1, 2, 4, 8, then at most 10 seconds). Each wait has a strict 90-second total
deadline, including an in-flight attempt and backoff. The `mssql` public `acquire`
callback and promise overloads are preserved; retries happen before a request,
transaction BEGIN or prepared statement executes. Explicitly marked independent,
nonstreaming read queries also retry execution-phase resume errors. Read retries
and their nested acquisitions share one 90-second budget from the original read
start; ordinary reads without resume failures retain the 120-second query timeout.
The marking is at reviewed store call sites, never inferred from SQL text.
Writes, transactional reads, transaction BEGIN and prepared statements are never
replayed after execution.
Request cancellation and shutdown stop waits immediately. A late acquisition
is released without executing SQL; late startup connections are closed.

`database.isWaking()` reports whether any concurrent retry wait is active.
Success, terminal failure, cancellation and shutdown settle each wait separately;
this in-memory status never queries SQL and does not keep an idle database awake.

No settings leaves the offline skeleton disconnected; partial settings fail
startup. The pool has minimum zero, 30-second idle eviction, and socket-only
connection validation; no idle SQL poll is added. The ledger/schema lock exist
only during startup. Driver errors and SQL text are not logged or returned.

Run offline tests with `npm test --workspace @jarvis/backend`. Aggregate CI calls
`database-ci.yml`, starts disposable SQL Server and runs
`npm run test:database --workspace @jarvis/backend`. These integration checks
cover repeat and concurrent application, rollback, immutable history, app-lock
contention, request cancellation, and down migrations. Test-password authentication is allowed
only with `NODE_ENV=test` on `127.0.0.1`; CI generates and deletes unique isolated
databases. Neither agents nor Actions tests connect to Azure SQL.

The Docker image includes committed `db/migrations`; compiled and source code
resolve the same repository-relative directory. `tool_calls` and the conversation
store use the group-one schema in `0001_core_tables.sql` (#15);
`0002_sandbox_operations.sql` adds sandbox and operations data-model groups 4 and 6
(#27), `0003_sandbox_agent_name.sql` adds the heartbeat routing field, and
`0005_task_event_archives.sql` indexes committed task-event blobs. Real Azure
identity connectivity and new-revision/restart acceptance remain issue #11.
`schema.integration.test.ts` checks the schema's constraints, and reverts and
reapplies every committed migration in its own database.
`conversation-store.integration.test.ts` exercises conversation writes, history
pagination, tool-call/task references and session closure against that isolated
SQL Server.
