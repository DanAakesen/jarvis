-- Existing rollback transaction holds writer locks through validation and ALTER.
IF EXISTS(SELECT 1 FROM daily.nutrition_meal_plans WITH (TABLOCKX,HOLDLOCK)
  WHERE protein_grams IS NULL OR carbohydrates_grams IS NULL OR fat_grams IS NULL OR fiber_grams IS NULL)
  THROW 51000, 'Plan rollback cannot replace unknown nutrient values', 1;
ALTER TABLE daily.nutrition_meal_plans ALTER COLUMN protein_grams float NOT NULL;
ALTER TABLE daily.nutrition_meal_plans ALTER COLUMN carbohydrates_grams float NOT NULL;
ALTER TABLE daily.nutrition_meal_plans ALTER COLUMN fat_grams float NOT NULL;
ALTER TABLE daily.nutrition_meal_plans ALTER COLUMN fiber_grams float NOT NULL;
