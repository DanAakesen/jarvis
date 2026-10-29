-- Refuse to discard runtime identity metadata for persisted test conversations.
IF EXISTS (SELECT 1 FROM dbo.session_runtime_tests)
  THROW 51000, 'Runtime test sessions exist; preserve their metadata before rollback.', 1;
DROP TABLE dbo.session_runtime_turns;
DROP TABLE dbo.session_runtime_tests;
