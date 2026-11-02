CREATE TABLE daily.workout_entries (
  id uniqueidentifier NOT NULL CONSTRAINT DF_daily_workout_entries_id DEFAULT NEWID(),
  owner_object_id uniqueidentifier NOT NULL,
  session_type varchar(24) NOT NULL,
  title nvarchar(80) NULL,
  started_at datetime2(3) NOT NULL,
  gym_day char(10) NOT NULL,
  duration_minutes int NULL,
  note nvarchar(500) NULL,
  deleted_at datetime2(3) NULL,
  updated_at datetime2(3) NOT NULL CONSTRAINT DF_daily_workout_entries_updated_at DEFAULT SYSUTCDATETIME(),
  revision bigint NOT NULL CONSTRAINT DF_daily_workout_entries_revision DEFAULT 1,
  vault_synced_revision bigint NULL,
  idempotency_key uniqueidentifier NOT NULL,
  CONSTRAINT PK_daily_workout_entries PRIMARY KEY NONCLUSTERED (id),
  CONSTRAINT CK_daily_workout_entries_session_type CHECK (session_type IN
    ('chest_triceps_core', 'back_biceps_core', 'arms_shoulders', 'legs_core', 'cardio', 'other')),
  CONSTRAINT CK_daily_workout_entries_title CHECK (title IS NULL OR (session_type = 'other' AND LEN(title) BETWEEN 1 AND 80)),
  CONSTRAINT CK_daily_workout_entries_gym_day CHECK (gym_day LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT CK_daily_workout_entries_duration CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
  CONSTRAINT CK_daily_workout_entries_revision CHECK (revision > 0),
  CONSTRAINT UQ_daily_workout_entries_owner_idempotency UNIQUE (owner_object_id, idempotency_key)
);

CREATE INDEX IX_daily_workout_entries_owner_started
  ON daily.workout_entries (owner_object_id, started_at DESC, id DESC)
  INCLUDE (session_type, title, gym_day, duration_minutes, deleted_at, updated_at, revision, vault_synced_revision);

ALTER TABLE daily.lift_entries ADD
  workout_id uniqueidentifier NULL,
  gym_day char(10) NULL,
  vault_synced_revision bigint NULL;

EXEC(N'UPDATE daily.lift_entries SET vault_synced_revision = revision;');
