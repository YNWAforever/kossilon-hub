-- A client sent a file, and until now we threw the reference away.
--
-- `inboundBody` reads data.attachments only to build a placeholder -- "[video]",
-- "[image]" -- and then discards the objects, waMediaId included. whatsapp_messages
-- has no media column, so the only surviving copy is inside the raw `payload`
-- jsonb, which no read query in the codebase selects. After commit nothing can
-- distinguish a client's photograph of a signed NAR1 from a client who typed the
-- literal text "[image]".
--
-- This records the reference. It does NOT record the file: fetching the bytes
-- needs a WOZTELL media-download endpoint, and none appears in the webhook
-- documentation the fixtures are copied from. BLOCKED_INTEGRATION:
-- whatsapp-media-download. So `document_id` stays null on every row today, and
-- the column exists to make the eventual join obvious rather than to imply the
-- work is done.

create table if not exists whatsapp_message_media (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references whatsapp_messages(id) on delete cascade,

  -- WOZTELL's own identifier for the media. The only handle we have, and the
  -- only thing a future download could be issued against.
  provider_media_id text not null,

  -- WOZTELL's vocabulary, stored as it arrives (documented payloads use
  -- uppercase, e.g. 'VIDEO'). Deliberately unconstrained: the webhook
  -- documentation shows one media example, so any CHECK here would be a guess
  -- at the full set and would reject a real message rather than record it.
  media_type text not null,

  -- Order within the message. A client can attach several files, and "the third
  -- one" has to stay the third one.
  position integer not null check (position >= 0),

  -- Set if this media ever becomes a document. Null on every row today.
  -- on delete set null: losing the document must not erase the record that the
  -- client sent something.
  document_id uuid references documents(id) on delete set null,

  created_at timestamptz not null default now(),

  -- One row per attachment per message. A redelivered webhook re-records the
  -- same attachments, and two rows for one file would show the client sending it
  -- twice.
  constraint whatsapp_message_media_uidx unique (message_id, provider_media_id, position)
);

create index if not exists whatsapp_message_media_message_idx
  on whatsapp_message_media (message_id);

-- Finding media nobody has turned into a document yet: the staff queue, and the
-- backlog that will exist the moment a download endpoint is available.
create index if not exists whatsapp_message_media_unattached_idx
  on whatsapp_message_media (created_at)
  where document_id is null;
