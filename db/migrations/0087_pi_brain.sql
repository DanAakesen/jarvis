-- PI brain: its wakes are turns of their own kind in the PI ledger (so the chat cap and the proactive budget stay apart), the owner's
-- test switch, and the chat messages the brain sent (the daily limit and the repeat check read them).
ALTER TABLE dbo.pi_turn DROP CONSTRAINT CK_pi_turn_kind;
ALTER TABLE dbo.pi_turn ADD CONSTRAINT CK_pi_turn_kind CHECK (kind IN ('chat', 'warm', 'smoke', 'brain'));
CREATE TABLE dbo.pi_switch (
  owner_object_id uniqueidentifier NOT NULL,
  brain bit NOT NULL CONSTRAINT DF_pi_switch_brain DEFAULT 0,
  updated_at datetime2(7) NOT NULL CONSTRAINT DF_pi_switch_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_pi_switch PRIMARY KEY (owner_object_id)
);
CREATE TABLE dbo.pi_message (
  id bigint IDENTITY(1,1) NOT NULL,
  at datetime2(7) NOT NULL CONSTRAINT DF_pi_message_at DEFAULT SYSUTCDATETIME(),
  run_id char(36) NOT NULL,
  session_id bigint NOT NULL,
  message_id bigint NOT NULL,
  text_hash char(64) NOT NULL,
  CONSTRAINT PK_pi_message PRIMARY KEY (id)
);
CREATE INDEX IX_pi_message_at ON dbo.pi_message (at DESC) INCLUDE (text_hash);
