-- PI standing watches: one row per look at a watch. The look cap per day, the 5 minute spacing and the cost per watch per day
-- read this table. The watch itself is a note in the vault; nothing about it lives only here.
CREATE TABLE dbo.pi_watch_look (
  id bigint IDENTITY(1,1) NOT NULL,
  at datetime2(7) NOT NULL CONSTRAINT DF_pi_watch_look_at DEFAULT SYSUTCDATETIME(),
  watch nvarchar(120) NOT NULL,
  run_id char(36) NOT NULL,
  cost_dkk decimal(12,6) NOT NULL CONSTRAINT DF_pi_watch_look_cost DEFAULT 0,
  CONSTRAINT PK_pi_watch_look PRIMARY KEY (id),
  CONSTRAINT CK_pi_watch_look_cost CHECK (cost_dkk >= 0)
);
CREATE INDEX IX_pi_watch_look_watch_at ON dbo.pi_watch_look (watch, at DESC) INCLUDE (cost_dkk);
CREATE INDEX IX_pi_watch_look_run ON dbo.pi_watch_look (run_id);
