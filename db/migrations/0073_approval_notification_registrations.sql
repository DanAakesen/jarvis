CREATE TABLE dbo.approval_notification_registrations (
  owner_object_id uniqueidentifier NOT NULL,
  device_token varchar(512) NOT NULL,
  language char(2) NOT NULL,
  show_actions bit NOT NULL,
  time_zone varchar(64) NOT NULL,
  expires_at datetime2(3) NOT NULL,
  CONSTRAINT PK_approval_notification_registrations PRIMARY KEY (owner_object_id, device_token),
  CONSTRAINT CK_approval_notification_registrations_language CHECK (language IN ('da', 'en')),
  CONSTRAINT CK_approval_notification_registrations_token CHECK (
    LEN(device_token) BETWEEN 64 AND 512 AND LEN(device_token) % 2 = 0
  )
);
