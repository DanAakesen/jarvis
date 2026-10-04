-- Reverses ../0009_github_release_records.sql and deletes all rows in these tables.
-- Run only through revertMigration after a backup; see ../README.md.

DROP TABLE dbo.deployments;
DROP TABLE dbo.workflow_runs;
DROP TABLE dbo.releases;
DROP TABLE dbo.pull_requests;
