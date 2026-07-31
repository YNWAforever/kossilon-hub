-- The inbox orders every read by coalesce(sent_at, received_at, created_at): an
-- outbound row carries sent_at once the provider accepts it but is queued with
-- only created_at, and an inbound row never carries sent_at at all because the
-- table's check constraint requires received_at instead.
--
-- whatsapp_messages_contact_created_idx (contact_id, created_at desc) cannot
-- serve that expression, so listConversations fell back to a full scan and sort
-- of the whole table to return one page. coalesce over timestamptz columns is
-- immutable, so the ordering can be indexed directly.

create index if not exists whatsapp_messages_contact_occurred_idx
  on whatsapp_messages (
    contact_id,
    (coalesce(sent_at, received_at, created_at)) desc,
    id desc
  );

-- Serves the latest_case CTE, which walks back to the most recent message that
-- has a case rather than taking the case of the most recent message.
create index if not exists whatsapp_messages_contact_case_occurred_idx
  on whatsapp_messages (
    contact_id,
    (coalesce(sent_at, received_at, created_at)) desc,
    id desc
  )
  where case_id is not null;
