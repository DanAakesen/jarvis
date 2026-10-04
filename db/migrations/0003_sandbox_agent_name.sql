-- P2-06 (#32): retain the Foundry agent route for heartbeat and restart recovery.
-- The check is declared with the column: SQL Server compiles the whole batch first, so a
-- separate ALTER that names the new column fails with "Invalid column name".

ALTER TABLE dbo.sandbox_sessions ADD agent_name nvarchar(255) COLLATE Latin1_General_100_BIN2 NULL
  CONSTRAINT CK_sandbox_sessions_agent_name CHECK (agent_name IS NULL OR LEN(agent_name) > 0);
