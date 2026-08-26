-- 0021: indexes supporting WhatsApp 24-hour session window resolution (P2-3).
--
-- The window is resolved by matching a notification's recipient against the contact
-- that last messaged us. The two sides are written by different normalizers and are
-- stored in three mutually incompatible formats: WOZTELL's inbound `from` is bare
-- digits, sweep recipients are raw company_contacts.phone with spaces, and staff
-- sends are plus-prefixed. The comparison is therefore digits-only.
--
-- Wrapping the predicate in a normalising expression makes
-- whatsapp_contacts_provider_phone_uidx unusable as an access path, so without the
-- first index below every dispatch sequentially scans whatsapp_contacts.
--
-- regexp_replace/4 and coalesce are both IMMUTABLE, so the expression index is legal.
-- The expression MUST stay character-identical to the one in
-- lastInboundAtForPhoneDigits (src/features/whatsapp/repository.ts) or the planner
-- will not use this index.

create index if not exists whatsapp_contacts_phone_digits_idx
  on whatsapp_contacts ((regexp_replace(coalesce(phone_e164, whatsapp_id), '[^0-9]', '', 'g')));

create index if not exists whatsapp_messages_inbound_received_idx
  on whatsapp_messages (contact_id, received_at desc)
  where direction = 'inbound';
