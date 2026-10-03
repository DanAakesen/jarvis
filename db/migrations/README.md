# SQL migration format

Append reviewed files as `NNNN_name.sql`, for example `0001_core_tables.sql`.
Use four unique digits and lowercase letters/underscores in the name. Each file
is one executable SQL Server batch without `GO`, at most 1 MiB. The backend reads
at most 1,000 migration files, in ordinal sequence order. Domain schema is P1-01
(#15); this directory currently contains no domain migration.

Startup acquires transaction-owned `jarvis.schema-migrations`, creates the
`dbo.schema_migrations` ledger and validates applied names/checksums against an
unchanged prefix of these files. All pending batches and ledger writes commit
together. Concurrent replicas wait for the same lock and cannot apply twice.
Failure or cancellation rolls back the transaction; startup does not listen.

Never edit, remove or reorder a migration that has been applied. Correct it with
a new numbered migration. Never manually edit the ledger. Back up before a
production data change and describe compatibility/restore handling in its PR.
This startup runner applies forward SQL only; it does not perform automatic
production down migrations. Reversible domain schema acceptance remains #17.
