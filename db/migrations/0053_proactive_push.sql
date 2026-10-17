CREATE TABLE dbo.push_vapid_keys (
  id int NOT NULL CONSTRAINT PK_push_vapid_keys PRIMARY KEY,
  public_key varchar(128) NOT NULL,
  private_key nvarchar(1024) NOT NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_push_vapid_keys_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_push_vapid_keys_singleton CHECK (id = 1)
);

CREATE TABLE dbo.push_subscriptions (
  id uniqueidentifier NOT NULL CONSTRAINT PK_push_subscriptions PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  endpoint_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  endpoint nvarchar(2048) NOT NULL,
  p256dh varchar(128) NOT NULL,
  auth varchar(32) NOT NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_push_subscriptions_created_at DEFAULT SYSUTCDATETIME(),
  last_accepted_at datetime2(7) NULL,
  last_failed_at datetime2(7) NULL,
  failure_count int NOT NULL CONSTRAINT DF_push_subscriptions_failure_count DEFAULT 0,
  CONSTRAINT CK_push_subscriptions_failure_count CHECK (failure_count >= 0)
);
CREATE UNIQUE INDEX UX_push_subscriptions_owner_endpoint_hash
  ON dbo.push_subscriptions (owner_object_id, endpoint_hash);

CREATE TABLE dbo.proactive_items (
  id uniqueidentifier NOT NULL CONSTRAINT PK_proactive_items PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  kind nvarchar(20) NOT NULL,
  title nvarchar(200) NOT NULL,
  body nvarchar(500) NOT NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_proactive_items_created_at DEFAULT SYSUTCDATETIME(),
  delivery_state nvarchar(20) NOT NULL,
  delivery_status_code int NULL,
  delivered_at datetime2(7) NULL,
  opened_at datetime2(7) NULL,
  CONSTRAINT CK_proactive_items_kind CHECK (kind = N'test'),
  CONSTRAINT CK_proactive_items_delivery_state CHECK (delivery_state IN (N'queued', N'accepted', N'failed'))
);
CREATE INDEX IX_proactive_items_owner_created_at
  ON dbo.proactive_items (owner_object_id, created_at DESC);
