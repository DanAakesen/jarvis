IF EXISTS (SELECT 1 FROM daily.lift_entries WITH (TABLOCKX,HOLDLOCK))
  THROW 51000,'Workout lift history must be retained',1;
DROP TABLE daily.lift_entries;
