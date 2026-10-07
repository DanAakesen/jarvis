DECLARE @fullTextInstalled bit = 0;
BEGIN TRY
  SET @fullTextInstalled = CASE
    WHEN FULLTEXTSERVICEPROPERTY(N'IsFullTextInstalled') = 1 THEN 1 ELSE 0 END;
END TRY
BEGIN CATCH
  SET @fullTextInstalled = 0;
END CATCH;

IF @fullTextInstalled = 1
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = N'jarvis_memories')
    CREATE FULLTEXT CATALOG jarvis_memories;
  IF NOT EXISTS (
    SELECT 1 FROM sys.fulltext_indexes WHERE object_id = OBJECT_ID(N'dbo.messages')
  )
    EXEC(N'CREATE FULLTEXT INDEX ON dbo.messages
      (text LANGUAGE 0)
      KEY INDEX PK_messages ON jarvis_memories WITH CHANGE_TRACKING AUTO;');
END;
