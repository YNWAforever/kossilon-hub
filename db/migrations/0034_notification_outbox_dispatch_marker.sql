-- Stops a notification being SENT twice, which is a different defect from being
-- COUNTED twice.
--
-- claimDue's reclaim branch and the dispatcher's `sentButUnrecorded` path both
-- leave a row in 'processing' AFTER transport.dispatch has already run. The
-- attempt_count fence on the terminal writes only makes the loser's markSent fail
-- -- by then the client has two copies of the same statutory reminder. WOZTELL's
-- BotAPI /sendResponses takes no client-side idempotency key to collapse them
-- (the Resend transport does send an `idempotency-key` header, so email was never
-- exposed to this), so the guard has to live on our side.
--
-- dispatch_started_attempt is written immediately BEFORE the transport call and
-- cleared by every terminal write. A row still carrying one is a row whose
-- outcome nobody knows, and the rule is that an unknown outcome never defaults to
-- re-sending: claimDue refuses such a row, and failStranded settles it as
-- 'dispatch_outcome_unknown' so a human can decide.
--
-- Nullable with no default: existing rows genuinely have no marker, and a default
-- of 0 would read as "a dispatch was begun on attempt 0", which is a claim about
-- history this migration cannot make.
alter table notification_outbox
  add column if not exists dispatch_started_attempt integer;

-- Both consumers of the column filter on it inside an existing 'processing'
-- predicate, so the index is partial on exactly that shape rather than a full
-- index on a column that is null for almost every row.
create index if not exists notification_outbox_dispatch_marker_idx
  on notification_outbox (updated_at)
  where status = 'processing' and dispatch_started_attempt is not null;
