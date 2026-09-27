-- Guarded rollback for 0044_message_preview.sql. Execute only after authorized
-- database binding review and only if no T18 data has been used.
begin;
lock table company_contacts, whatsapp_templates, whatsapp_message_previews
  in access exclusive mode;
do $$
begin
  if not exists (
    select 1 from schema_migrations where id = '0044_message_preview.sql'
  ) then
    raise exception '0044 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from whatsapp_message_previews) then
    raise exception 'message previews exist; rollback refused';
  end if;
  if exists (
    select 1 from company_contacts
    where phone_e164 is not null or phone_verified_at is not null
      or phone_verified_by is not null or phone_verification_evidence is not null
      or preferred_language is not null
  ) then
    raise exception 'verified contact data exists; rollback refused';
  end if;
  if exists (
    select 1 from whatsapp_templates
    where provider_approval_verified_at is not null
      or provider_approval_evidence is not null
  ) then
    raise exception 'provider template approval evidence exists; rollback refused';
  end if;
end
$$;
drop table whatsapp_message_previews;
alter table whatsapp_templates
  drop column provider_approval_verified_at,
  drop column provider_approval_evidence;
drop trigger company_contacts_phone_change_invalidates_verification
  on company_contacts;
drop function invalidate_verified_contact_phone();
alter table company_contacts
  drop column phone_e164,
  drop column phone_verified_at,
  drop column phone_verified_by,
  drop column phone_verification_evidence,
  drop column preferred_language;
delete from schema_migrations where id = '0044_message_preview.sql';
commit;
