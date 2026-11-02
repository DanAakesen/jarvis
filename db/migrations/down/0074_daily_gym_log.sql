SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM daily.workout_entries WITH (TABLOCKX,HOLDLOCK))
  THROW 51000, 'Workout log history must be retained', 1;
ALTER TABLE daily.lift_entries DROP COLUMN workout_id, gym_day, vault_synced_revision;
DROP TABLE daily.workout_entries;
COMMIT TRANSACTION;
