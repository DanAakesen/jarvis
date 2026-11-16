DROP TABLE dbo.pi_message;
DROP TABLE dbo.pi_switch;
DELETE FROM dbo.pi_turn WHERE kind = 'brain';
ALTER TABLE dbo.pi_turn DROP CONSTRAINT CK_pi_turn_kind;
ALTER TABLE dbo.pi_turn ADD CONSTRAINT CK_pi_turn_kind CHECK (kind IN ('chat', 'warm', 'smoke'));
