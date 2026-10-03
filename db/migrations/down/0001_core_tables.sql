-- Reverses ../0001_core_tables.sql and deletes all rows in these tables.
-- Run only through revertMigration after a backup; see ../README.md.

DROP TABLE dbo.task_events;
DROP TABLE dbo.tool_calls;
DROP TABLE dbo.tasks;
DROP TABLE dbo.projects;
DROP TABLE dbo.activity;
DROP TABLE dbo.messages;
DROP TABLE dbo.jarvis_sessions;
DROP TABLE dbo.settings;
