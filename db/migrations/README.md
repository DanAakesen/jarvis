# SQL migration format

Append reviewed files as `NNNN_name.sql`, for example `0001_core_tables.sql`.
Use four unique digits and lowercase letters/underscores in the name. Each file
is one executable SQL Server batch without `GO`, at most 1 MiB. The backend reads
at most 1,000 migration files, in ordinal sequence order. `0001_core_tables.sql`
creates data-model groups 1–3 (issue #15); `0002_sandbox_operations.sql` creates
groups 4 and 6 (issue #27).

Every migration has a reverse batch with the same name in `down/`, under the
same format rules. Startup never reads `down/`. Down scripts drop data: only
`revertMigration` runs one, under the same lock and transaction as startup. It
reverts only the latest applied migration and deletes its ledger row with it.

Startup acquires transaction-owned `jarvis.schema-migrations`, creates the
`dbo.schema_migrations` ledger and validates applied names/checksums against an
unchanged prefix of these files. All pending batches and ledger writes commit
together. Concurrent replicas wait for the same lock and cannot apply twice.
Failure or cancellation rolls back the transaction; startup does not listen.

Never edit, remove or reorder a migration that has been applied. Correct it with
a new numbered migration. Never manually edit the ledger. Back up before a
production data change and describe compatibility/restore handling in its PR.
Startup applies forward SQL only; it never performs automatic production down
migrations. CI proves every down script against SQL Server. A production revert
needs a backup and Dan's approval first, and the backend revision that expects
the reverted schema must not be running.
