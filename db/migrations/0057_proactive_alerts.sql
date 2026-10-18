CREATE TABLE dbo.proactive_alerts (
  id uniqueidentifier NOT NULL CONSTRAINT PK_proactive_alerts PRIMARY KEY,
  owner_object_id uniqueidentifier NOT NULL,
  alert_key char(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  class nvarchar(32) NOT NULL,
  item_id uniqueidentifier NOT NULL,
  run_id uniqueidentifier NOT NULL,
  day_key char(10) NOT NULL,
  status nvarchar(8) NOT NULL,
  reason nvarchar(64) NULL,
  attempts tinyint NOT NULL,
  created_at datetime2(7) NOT NULL CONSTRAINT DF_proactive_alerts_created_at DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(7) NOT NULL CONSTRAINT DF_proactive_alerts_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_proactive_alerts_key CHECK (LEN(alert_key) = 32 AND alert_key NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT CK_proactive_alerts_class CHECK (class IN (N'deadline_24h', N'calendar_clash', N'travel_disruption')),
  CONSTRAINT CK_proactive_alerts_day_key CHECK (day_key LIKE '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  CONSTRAINT CK_proactive_alerts_status CHECK (status IN (N'sent', N'failed')),
  CONSTRAINT CK_proactive_alerts_reason CHECK (
    reason IS NULL OR reason IN (N'quiet_hours', N'no_subscription', N'aborted', N'provider_rejected', N'provider_unavailable')
  ),
  CONSTRAINT CK_proactive_alerts_attempts CHECK (attempts BETWEEN 1 AND 255)
);
CREATE UNIQUE INDEX UX_proactive_alerts_owner_alert_key
  ON dbo.proactive_alerts (owner_object_id, alert_key);
CREATE INDEX IX_proactive_alerts_owner_day_status
  ON dbo.proactive_alerts (owner_object_id, day_key, status);
