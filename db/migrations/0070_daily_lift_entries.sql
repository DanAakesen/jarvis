CREATE TABLE daily.lift_entries (
  id uniqueidentifier NOT NULL CONSTRAINT DF_daily_lift_entries_id DEFAULT NEWID(),
  owner_object_id uniqueidentifier NOT NULL,
  exercise_name nvarchar(80) NOT NULL,
  exercise_key nvarchar(80) NOT NULL,
  weight_kg decimal(6,2) NOT NULL,
  reps int NOT NULL,
  sets int NOT NULL,
  performed_at datetime2(3) NOT NULL,
  deleted_at datetime2(3) NULL,
  updated_at datetime2(3) NOT NULL CONSTRAINT DF_daily_lift_entries_updated_at DEFAULT SYSUTCDATETIME(),
  revision bigint NOT NULL CONSTRAINT DF_daily_lift_entries_revision DEFAULT 1,
  idempotency_key uniqueidentifier NOT NULL,
  CONSTRAINT PK_daily_lift_entries PRIMARY KEY NONCLUSTERED (id),
  CONSTRAINT CK_daily_lift_entries_exercise_name CHECK (LEN(exercise_name) BETWEEN 1 AND 80),
  CONSTRAINT CK_daily_lift_entries_exercise_key CHECK (exercise_key = LOWER(LTRIM(RTRIM(exercise_name)))),
  CONSTRAINT CK_daily_lift_entries_weight CHECK (weight_kg BETWEEN 0 AND 1000),
  CONSTRAINT CK_daily_lift_entries_reps CHECK (reps BETWEEN 1 AND 1000),
  CONSTRAINT CK_daily_lift_entries_sets CHECK (sets BETWEEN 1 AND 100),
  CONSTRAINT CK_daily_lift_entries_revision CHECK (revision > 0),
  CONSTRAINT UQ_daily_lift_entries_owner_idempotency UNIQUE (owner_object_id, idempotency_key)
);

CREATE INDEX IX_daily_lift_entries_owner_exercise_performed
  ON daily.lift_entries (owner_object_id, exercise_key, performed_at DESC)
  INCLUDE (id, exercise_name, weight_kg, reps, sets, deleted_at, updated_at, revision);

CREATE INDEX IX_daily_lift_entries_owner_performed
  ON daily.lift_entries (owner_object_id, performed_at DESC, id DESC)
  INCLUDE (exercise_key, exercise_name, weight_kg, reps, sets, updated_at, revision);
