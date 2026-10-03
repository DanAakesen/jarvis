# Database

Reserved for plain SQL migrations and database test fixtures. P0-07 adds the
migration runner; P1 adds the first domain tables.

The backend will apply migrations at startup under a SQL application lock.
Database tests run against SQL Server in CI, without connecting to Azure SQL.
See the [data model](../docs/data-model.md).
