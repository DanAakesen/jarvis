-- Reverses ../0002_sandbox_operations.sql and deletes all rows in these tables.
-- Run only through revertMigration after a backup; see ../README.md.

DROP TABLE dbo.credential_status;
DROP TABLE dbo.webhook_deliveries;
DROP TABLE dbo.artifacts;
DROP TABLE dbo.sandbox_turns;
DROP TABLE dbo.sandbox_sessions;
