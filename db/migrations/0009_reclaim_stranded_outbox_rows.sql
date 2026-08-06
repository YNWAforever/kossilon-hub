-- claimDue selected only 'pending' and 'failed', and nothing else ever moved a
-- row out of 'processing'. A Worker killed between the claim and
-- markSent/markRetry left the notification stranded permanently and silently.
--
-- The dispatcher now also reclaims 'processing' rows whose updated_at is older
-- than the visibility timeout. notification_outbox_retry_idx is partial on
-- ('pending', 'failed'), so that branch had no index to use.

create index if not exists notification_outbox_stranded_idx
  on notification_outbox (updated_at)
  where status = 'processing';
