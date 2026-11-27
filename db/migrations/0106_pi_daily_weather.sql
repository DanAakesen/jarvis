CREATE TABLE dbo.pi_daily_weather (
  owner_object_id uniqueidentifier NOT NULL,
  local_day date NOT NULL,
  event_ref nvarchar(512) NOT NULL,
  result_json nvarchar(max) NULL,
  CONSTRAINT PK_pi_daily_weather PRIMARY KEY (owner_object_id, local_day),
  CONSTRAINT CK_pi_daily_weather_result CHECK (result_json IS NULL OR ISJSON(result_json) = 1)
);

-- A legacy observation already made today also spends today's allowance.
DECLARE @today date = CONVERT(date, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Romance Standard Time');
INSERT dbo.pi_daily_weather (owner_object_id, local_day, event_ref)
SELECT owner_object_id, @today, N'legacy-weather-observation'
FROM dbo.proactive_source_status
WHERE source_id = N'weather'
  AND CONVERT(date, observed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Romance Standard Time') = @today;
