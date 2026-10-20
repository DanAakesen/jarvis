CREATE TABLE daily.training_targets (
  owner_object_id uniqueidentifier NOT NULL,
  gym_sessions_per_week int NULL,
  run_sessions_per_week int NULL,
  daily_steps int NULL,
  updated_at datetime2(3) NOT NULL,
  CONSTRAINT PK_daily_training_targets PRIMARY KEY NONCLUSTERED (owner_object_id),
  CONSTRAINT CK_daily_training_targets_gym CHECK (gym_sessions_per_week IS NULL OR gym_sessions_per_week BETWEEN 0 AND 21),
  CONSTRAINT CK_daily_training_targets_run CHECK (run_sessions_per_week IS NULL OR run_sessions_per_week BETWEEN 0 AND 21),
  CONSTRAINT CK_daily_training_targets_steps CHECK (daily_steps IS NULL OR daily_steps BETWEEN 0 AND 100000),
  CONSTRAINT CK_daily_training_targets_set CHECK (
    gym_sessions_per_week IS NOT NULL OR run_sessions_per_week IS NOT NULL OR daily_steps IS NOT NULL
  )
);
