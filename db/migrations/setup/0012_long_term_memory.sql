IF FULLTEXTSERVICEPROPERTY(N'IsFullTextInstalled') = 1
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = N'jarvis_memories')
    CREATE FULLTEXT CATALOG jarvis_memories;
  IF NOT EXISTS (
    SELECT 1 FROM sys.fulltext_indexes WHERE object_id = OBJECT_ID(N'dbo.memories')
  )
    CREATE FULLTEXT INDEX ON dbo.memories
      (memory_key LANGUAGE 0, content LANGUAGE 0)
      KEY INDEX PK_memories ON jarvis_memories WITH CHANGE_TRACKING AUTO;
END;
