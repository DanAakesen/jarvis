# Database

Plain SQL migrations and their reviewed down scripts. P0-07 added the migration
runner; P1-01 (#15) added the first domain tables (data-model groups 1–3).

The backend will apply migrations at startup under a SQL application lock.
Database tests run against SQL Server in CI, without connecting to Azure SQL.
See the [data model](../docs/data-model.md).
