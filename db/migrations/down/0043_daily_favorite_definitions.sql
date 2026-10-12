IF EXISTS(SELECT 1 FROM daily.nutrition_favorites WITH (TABLOCKX,HOLDLOCK)
  WHERE source_meal_id IS NULL OR source_idempotency_key IS NULL OR nutrient_provenance_json<>N'{}' OR DATALENGTH(nutrient_provenance_json)<>DATALENGTH(N'{}'))
  THROW 51000, 'Favorite rollback cannot discard definitions or provenance', 1;
ALTER TABLE daily.nutrition_favorites DROP CONSTRAINT CK_daily_favorites_provenance;
ALTER TABLE daily.nutrition_favorites DROP CONSTRAINT DF_daily_favorites_provenance;
ALTER TABLE daily.nutrition_favorites DROP COLUMN nutrient_provenance_json;
ALTER TABLE daily.nutrition_favorites ALTER COLUMN source_meal_id nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL;
ALTER TABLE daily.nutrition_favorites ALTER COLUMN source_idempotency_key nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL;
