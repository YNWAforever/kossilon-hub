-- What the client actually received, as opposed to what we drafted.
--
-- whatsapp_messages.body stores the draft: a sentence naming the company and the
-- filing due date. Outside WhatsApp's 24-hour customer-service window free-form
-- text is forbidden, so the dispatcher takes the template branch instead -- and
-- its `components` come from payload.templateComponents, which no producer in
-- this codebase ever sets. The template therefore goes out with zero variables:
-- a generic "please get in touch" with no company, no date and no detail.
--
-- attachProviderMessageId then stamps that same row 'sent' with a real provider
-- id, and the staff inbox renders `body`. So a staff member reads a personalised
-- message the client never received, and may reasonably assume the client has
-- been told a date they have not been told.
--
-- Nothing recorded which branch was taken. These two columns do.
--
-- Nullable, and null means "not recorded" rather than "text": every row that
-- predates this migration was sent before anything tracked the distinction, and
-- backfilling them as 'text' would assert something nobody checked.

alter table whatsapp_messages
  add column if not exists sent_as text
    check (sent_as is null or sent_as in ('text', 'template'));

-- Which template, when it was one. Meta treats each language as a separate
-- template, but the language already lives on whatsapp_templates; this is the
-- name the wire actually carried.
alter table whatsapp_messages
  add column if not exists sent_template_name text;

-- A template send is the case where `body` is NOT what the client got, so the
-- inbox needs to find those rows cheaply to mark them.
create index if not exists whatsapp_messages_sent_as_idx
  on whatsapp_messages (contact_id, sent_as)
  where sent_as = 'template';
