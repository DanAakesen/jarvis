CREATE TABLE dbo.conversation_attachments (
  id varchar(36) COLLATE Latin1_General_100_BIN2 NOT NULL,
  owner_object_id uniqueidentifier NOT NULL,
  message_id bigint NULL,
  file_name nvarchar(255) NOT NULL,
  content_type nvarchar(127) NOT NULL,
  size_bytes int NOT NULL,
  sha256 char(64) NOT NULL,
  blob_name nvarchar(256) NOT NULL,
  status nvarchar(16) NOT NULL,
  extracted_text nvarchar(max) NULL,
  description nvarchar(max) NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_conversation_attachments_created_at DEFAULT SYSUTCDATETIME(),
  expires_at datetime2(7) NOT NULL,
  CONSTRAINT PK_conversation_attachments PRIMARY KEY (id),
  CONSTRAINT FK_conversation_attachments_message FOREIGN KEY (message_id) REFERENCES dbo.messages (id),
  CONSTRAINT CK_conversation_attachments_id CHECK (
    LEN(id) = 36 AND TRY_CONVERT(uniqueidentifier, id) IS NOT NULL AND id = LOWER(id)
  ),
  CONSTRAINT CK_conversation_attachments_name CHECK (LEN(file_name) BETWEEN 1 AND 255),
  CONSTRAINT CK_conversation_attachments_type CHECK (content_type IN (
    N'image/png', N'image/jpeg', N'image/webp', N'image/gif', N'application/pdf',
    N'text/plain', N'text/markdown', N'text/csv', N'application/json',
    N'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    N'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
  CONSTRAINT CK_conversation_attachments_size CHECK (size_bytes BETWEEN 1 AND 20971520),
  CONSTRAINT CK_conversation_attachments_sha256 CHECK (LEN(sha256) = 64),
  CONSTRAINT CK_conversation_attachments_blob CHECK (blob_name LIKE N'attachments/%'),
  CONSTRAINT CK_conversation_attachments_status CHECK (status IN (N'uploaded', N'ready', N'failed')),
  CONSTRAINT CK_conversation_attachments_content_bounds CHECK (
    (extracted_text IS NULL OR LEN(extracted_text) <= 100000) AND
    (description IS NULL OR LEN(description) <= 5000)
  )
);

CREATE INDEX IX_conversation_attachments_owner_created
  ON dbo.conversation_attachments (owner_object_id, created_at DESC)
  INCLUDE (message_id, file_name, content_type, size_bytes, status);

CREATE INDEX IX_conversation_attachments_expiry
  ON dbo.conversation_attachments (expires_at, id)
  INCLUDE (blob_name);
