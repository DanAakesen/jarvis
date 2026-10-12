-- Unknown plan macros stay unknown, matching meals/favourites. No data rewrite.
ALTER TABLE daily.nutrition_meal_plans ALTER COLUMN protein_grams float NULL;
ALTER TABLE daily.nutrition_meal_plans ALTER COLUMN carbohydrates_grams float NULL;
ALTER TABLE daily.nutrition_meal_plans ALTER COLUMN fat_grams float NULL;
ALTER TABLE daily.nutrition_meal_plans ALTER COLUMN fiber_grams float NULL;
