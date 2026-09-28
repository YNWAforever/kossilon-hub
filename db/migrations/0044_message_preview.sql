-- T18: verified case contact and durable, short-lived message previews.
-- Existing phones and templates deliberately remain unverified.
alter table company_contacts
  add column phone_e164 text,
  add column phone_verified_at timestamptz,
  add column phone_verified_by uuid references users(id) on delete restrict,
  add column phone_verification_evidence text,
  add column preferred_language text,
  add constraint company_contacts_phone_e164_check
    check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  add constraint company_contacts_phone_verification_check
    check (
      (phone_e164 is null and phone_verified_at is null and phone_verified_by is null
        and phone_verification_evidence is null)
      or
      (phone_e164 is not null and phone_verified_at is not null and phone_verified_by is not null
        and length(trim(phone_verification_evidence)) >= 8)
    ),
  add constraint company_contacts_preferred_language_check
    check (preferred_language is null or preferred_language in ('en','zh_HK'));

create or replace function invalidate_verified_contact_phone()
returns trigger language plpgsql as $$
begin
  if new.phone is distinct from old.phone then
    new.phone_e164 := null;
    new.phone_verified_at := null;
    new.phone_verified_by := null;
    new.phone_verification_evidence := null;
  end if;
  return new;
end
$$;
create trigger company_contacts_phone_change_invalidates_verification
before update on company_contacts
for each row execute function invalidate_verified_contact_phone();

alter table whatsapp_templates
  add column provider_approval_verified_at timestamptz,
  add column provider_approval_evidence text,
  add constraint whatsapp_templates_provider_approval_pair_check
    check ((provider_approval_verified_at is null) = (provider_approval_evidence is null));

create table whatsapp_message_previews (
  id uuid primary key,
  case_id uuid not null references annual_return_cases(id) on delete restrict,
  company_id uuid not null references companies(id) on delete restrict,
  contact_id uuid not null,
  conversation_id uuid,
  created_by uuid not null references users(id) on delete restrict,
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  queued_message_id uuid references whatsapp_messages(id) on delete restrict,
  check (expires_at > created_at),
  check (expires_at <= created_at + interval '10 minutes')
);
create index whatsapp_message_previews_case_created_idx
  on whatsapp_message_previews(case_id, created_at desc);
