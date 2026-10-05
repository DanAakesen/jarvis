DELETE FROM dbo.usage
WHERE source = N'jarvis_model' AND metric = N'screen_frames';

DROP INDEX IX_usage_screen_frames_at ON dbo.usage;

ALTER TABLE dbo.usage DROP CONSTRAINT CK_usage_source_metric;
ALTER TABLE dbo.usage ADD CONSTRAINT CK_usage_source_metric CHECK (
  (source = N'sandbox' AND metric = N'minutes') OR
  (source IN (N'codex', N'copilot') AND metric IN (N'turns', N'input_tokens', N'output_tokens', N'premium_requests')) OR
  (source = N'jarvis_model' AND metric IN (N'input_tokens', N'output_tokens')) OR
  (source = N'voice' AND metric = N'minutes')
);
