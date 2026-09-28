-- REVIEW ONLY. Not a migration: never run via db:migrate.
-- Target only after deployment DB binding, named snapshot and explicit production authorization.
-- Historical Git blob 07caa5d8f8b6924d00a07a8ba35de73e885f7c81
-- is identical for retired 0006_client_register.sql and canonical 0008_client_register.sql.
-- This removes only the duplicate ledger alias. It does not replay migration SQL.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.schema_migrations in access exclusive mode;
do $guard$
declare
  expected text[] := ARRAY[
    '0001_annual_return_control_center.sql',
    '0002_harden_annual_return_schema.sql',
    '0003_annual_return_audit_events.sql',
    '0004_retain_annual_return_audit_events.sql',
    '0005_whatsapp_integration_foundation.sql',
    '0006_client_register.sql',
    '0006_production_assignment_sla_foundation.sql',
    '0007_whatsapp_inbox_ordering_indexes.sql',
    '0008_client_register.sql',
    '0009_reclaim_stranded_outbox_rows.sql',
    '0010_index_timeline_and_upload_intent_lookups.sql',
    '0011_whatsapp_delivery_receipts.sql',
    '0012_annual_return_reminder_events.sql',
    '0013_checklist_templates.sql',
    '0014_generalize_work_item_case_reference.sql',
    '0015_officers_and_shareholdings.sql',
    '0016_significant_controllers_and_dr.sql',
    '0017_incorporation_intake.sql',
    '0018_recurring_service_subscriptions.sql',
    '0019_corporate_change_requests.sql',
    '0020_corporate_change_work_items.sql'
  ]::text[];
  actual text[];
begin
  select array_agg(id order by id) into actual from public.schema_migrations;
  if actual is distinct from expected then
    raise exception 'Ledger differs from reviewed 21-row baseline; stop';
  end if;
  if not exists (
    select 1 from public.schema_migrations
    where id = '0006_client_register.sql'
      and applied_at = timestamptz '2026-08-03 20:26:37.261+00'
  ) or not exists (
    select 1 from public.schema_migrations
    where id = '0008_client_register.sql'
      and applied_at = timestamptz '2026-08-04 19:03:12.181+00'
  ) then
    raise exception 'Historical/canonical ledger timestamp differs; stop';
  end if;
  if to_regclass('public.company_contacts') is null
     or to_regclass('public.company_contacts_company_id_idx') is null
     or to_regclass('public.company_contacts_primary_uidx') is null
     or to_regclass('public.service_subscriptions') is null
     or to_regclass('public.service_packages') is not null
     or exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='companies'
         and column_name='service_package_id'
     ) then
    raise exception 'Client-register or 0018 retirement catalog differs; stop';
  end if;
end;
$guard$;

delete from public.schema_migrations where id = '0006_client_register.sql';
do $verify$
begin
  if (select count(*) from public.schema_migrations) <> 20
     or exists (select 1 from public.schema_migrations where id = '0006_client_register.sql') then
    raise exception 'Alias reconciliation postcondition failed';
  end if;
end;
$verify$;
commit;
