create table if not exists whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'woztell' check (provider in ('woztell')),
  whatsapp_id text,
  phone_e164 text,
  display_name text,
  company_id uuid references companies(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_contacts_identity_check check (
    whatsapp_id is not null or phone_e164 is not null
  )
);

create unique index if not exists whatsapp_contacts_provider_whatsapp_id_uidx
  on whatsapp_contacts (provider, whatsapp_id)
  where whatsapp_id is not null;

create unique index if not exists whatsapp_contacts_provider_phone_uidx
  on whatsapp_contacts (provider, phone_e164)
  where phone_e164 is not null;

create table if not exists whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'woztell' check (provider in ('woztell')),
  template_name text not null,
  language_code text not null default 'en',
  category text not null check (
    category in ('annual_return', 'payment', 'document', 'signature', 'general')
  ),
  status text not null default 'draft' check (
    status in ('draft', 'active', 'paused', 'archived')
  ),
  body text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists whatsapp_templates_provider_name_language_uidx
  on whatsapp_templates (provider, template_name, language_code);

create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'woztell' check (provider in ('woztell')),
  provider_message_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null check (
    status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')
  ),
  contact_id uuid references whatsapp_contacts(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  case_id uuid references annual_return_cases(id) on delete set null,
  template_id uuid references whatsapp_templates(id) on delete set null,
  phone_e164 text,
  whatsapp_id text,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  sent_by uuid references users(id) on delete set null,
  received_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_messages_inbound_received_at_check check (
    direction <> 'inbound' or received_at is not null
  )
);

create unique index if not exists whatsapp_messages_provider_message_uidx
  on whatsapp_messages (provider, provider_message_id)
  where provider_message_id is not null;

create index if not exists whatsapp_messages_contact_created_idx
  on whatsapp_messages (contact_id, created_at desc);

create index if not exists whatsapp_messages_company_created_idx
  on whatsapp_messages (company_id, created_at desc);

create index if not exists whatsapp_messages_case_created_idx
  on whatsapp_messages (case_id, created_at desc);

create table if not exists whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'woztell' check (provider in ('woztell')),
  provider_event_id text,
  signature_valid boolean not null default false,
  payload jsonb not null,
  normalized_message_id uuid references whatsapp_messages(id) on delete set null,
  processing_status text not null check (
    processing_status in ('received', 'processed', 'ignored', 'failed')
  ),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists whatsapp_webhook_events_provider_event_uidx
  on whatsapp_webhook_events (provider, provider_event_id)
  where provider_event_id is not null;

create index if not exists whatsapp_webhook_events_received_idx
  on whatsapp_webhook_events (received_at desc);
