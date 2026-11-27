IF EXISTS (SELECT 1 FROM dbo.pi_daily_weather WHERE result_json IS NOT NULL)
  THROW 51000, 'Recorded trip forecasts must be preserved before reverting this migration.', 1;
DROP TABLE dbo.pi_daily_weather;
