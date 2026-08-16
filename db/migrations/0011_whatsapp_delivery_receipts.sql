-- Delivery and read receipts arrive as their own webhook events (eventType
-- INBOUND, type SENT | DELIVERED | READ). Until now there was nowhere to put
-- them, so reminder_logs could attest that a statutory reminder was sent but
-- never that it arrived — for annual-return and SCR/DR chasing that is the
-- difference between evidence and an assertion.
alter table whatsapp_messages
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz;

-- Status updates arrive keyed on the provider's message id and have to find the
-- outbound row fast. The existing unique index is partial on provider_message_id
-- is not null, which already serves that lookup; this index covers the reporting
-- read of "everything delivered but not yet read".
-- `direction` is the partial predicate, so every row in the index already
-- satisfies it — carrying it as a leading key column too would add no
-- selectivity, only width.
create index if not exists whatsapp_messages_delivery_state_idx
  on whatsapp_messages (delivered_at, read_at)
  where direction = 'outbound';
