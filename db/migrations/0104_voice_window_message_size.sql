-- Generated views allow 256 KiB of UTF-8. NVARCHAR may use two bytes per ASCII character.
ALTER TABLE dbo.messages DROP CONSTRAINT CK_messages_metadata;
ALTER TABLE dbo.messages WITH CHECK ADD CONSTRAINT CK_messages_metadata CHECK (
  metadata IS NULL OR (ISJSON(metadata) = 1 AND (
    DATALENGTH(metadata) <= 64000 OR (
      DATALENGTH(metadata) <= 540000 AND role = N'jarvis' AND
      ISNULL(JSON_VALUE(metadata, '$.blocks[0].type'), N'') = N'voice-window' AND
      JSON_QUERY(metadata, '$.blocks[1]') IS NULL
    )
  ))
);
