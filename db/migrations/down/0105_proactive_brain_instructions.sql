IF EXISTS (SELECT 1 FROM dbo.proactive_settings WHERE brain_instructions IS NOT NULL)
  THROW 50001, 'Archive saved background instructions before reverting.', 1;
ALTER TABLE dbo.proactive_settings DROP COLUMN brain_instructions;
