-- Explicit confirmed definitions are favourites, never fabricated intake rows.
ALTER TABLE daily.nutrition_favorites ALTER COLUMN source_meal_id nvarchar(256) COLLATE Latin1_General_100_BIN2 NULL;
ALTER TABLE daily.nutrition_favorites ALTER COLUMN source_idempotency_key nvarchar(256) COLLATE Latin1_General_100_BIN2 NULL;
ALTER TABLE daily.nutrition_favorites ADD nutrient_provenance_json nvarchar(max) NOT NULL
  CONSTRAINT DF_daily_favorites_provenance DEFAULT N'{}';
ALTER TABLE daily.nutrition_favorites ADD CONSTRAINT CK_daily_favorites_provenance CHECK (ISJSON(nutrient_provenance_json, VALUE)=1);
