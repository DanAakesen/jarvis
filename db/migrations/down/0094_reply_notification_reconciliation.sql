ALTER TABLE dbo.reply_notification_deliveries
  DROP CONSTRAINT CK_reply_notification_deliveries_state;
UPDATE dbo.reply_notification_deliveries
  SET state = N'accepted', last_result = N'suppressed_before_rollback'
  WHERE state = N'suppressed';
ALTER TABLE dbo.reply_notification_deliveries
  ADD CONSTRAINT CK_reply_notification_deliveries_state CHECK (
    state IN ('pending', 'sending', 'accepted', 'failed', 'expired', 'invalid_token')
  );
DROP TABLE dbo.reply_notification_approval_deliveries;
