-- 0022: record positively whether a dispatch was provider-acknowledged or simulated.
--
-- provider_message_id is null on a sent row for three unrelated reasons: never
-- dispatched (status <> 'sent'), redacted after retention (redacted_at is not
-- null), and a simulated or local dispatch — which nothing recorded. That last
-- one was readable only by elimination, and only because both live transports
-- happen to throw rather than return an empty id. `simulated` is a DEPLOYED mode
-- against a real database (src/server/provider-mode.ts gates it to the
-- kossilon-demo firm) and VITE_PROVIDER_MODE can flip on the same database over
-- time, after which historical rows become indistinguishable.
--
-- The dispatcher already holds this fact at the write site — NotificationDispatchResult
-- is discriminated on exactly `delivery` — so this stores what is in hand rather
-- than an inference. Deliberately NOT a new `status` value (that would change the
-- meaning of status and silently reroute every consumer that switches on it, e.g.
-- annual-return/follow-ups.ts) and NOT a provider_mode column (one inference
-- removed from what an auditor needs, and it would have to be threaded down from
-- runtime-dispatch.ts).
--
-- Nullable on purpose: rows written before this migration genuinely are unknown,
-- and recording that honestly beats defaulting them to a value an auditor would
-- then read as evidence. The CHECK tolerates NULL for the same reason.

alter table notification_outbox add column delivery text
  check (delivery is null or delivery in ('provider', 'simulated'));

-- Partial backfill. Pre-fix rows are self-describing: the simulated and local
-- transports used to mint 'simulated:<channel>:<outbox-id>' and 'local:<outbox-id>'
-- into this column, so those rows can be classified with certainty, and any other
-- non-null id came from a real vendor.
update notification_outbox
set delivery = case
  when provider_message_id like 'simulated:%' or provider_message_id like 'local:%' then 'simulated'
  else 'provider'
end
where provider_message_id is not null;

-- Everything else stays NULL. A status='sent' row with a null provider_message_id
-- is genuinely ambiguous between a post-fix simulated send and a redacted row, and
-- guessing would manufacture the exact false evidence this column exists to prevent.
