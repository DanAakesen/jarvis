CREATE TABLE dbo.activitykit_registrations (
  owner_object_id uniqueidentifier NOT NULL,
  activity_id varchar(128) NOT NULL,
  resource_kind varchar(16) NOT NULL,
  resource_id varchar(36) NOT NULL,
  push_token varchar(512) NOT NULL,
  language char(2) NOT NULL,
  expires_at datetime2(3) NOT NULL,
  CONSTRAINT PK_activitykit_registrations PRIMARY KEY (owner_object_id, activity_id),
  CONSTRAINT CK_activitykit_registrations_kind CHECK (resource_kind IN ('background_job', 'factory_task')),
  CONSTRAINT CK_activitykit_registrations_language CHECK (language IN ('da', 'en')),
  CONSTRAINT CK_activitykit_registrations_token CHECK (LEN(push_token) BETWEEN 64 AND 512)
);
