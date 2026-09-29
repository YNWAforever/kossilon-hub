-- REVIEW ONLY. Technical undo for the alias reconciliation, before any further migration.
-- Reintroduces the original ledger row and its observed timestamp; does not undo schema.
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
    raise exception 'Ledger advanced or differs; do not restore alias';
  end if;
  if not exists (
    select 1 from public.schema_migrations
    where id = '0008_client_register.sql'
      and applied_at = timestamptz '2026-08-04 19:03:12.181889+00'
  ) then
    raise exception 'Canonical ledger timestamp differs; stop';
  end if;
end;
$guard$;

insert into public.schema_migrations (id, applied_at)
values ('0006_client_register.sql', timestamptz '2026-08-03 20:26:37.261845+00');
do $verify$
begin
  if (select count(*) from public.schema_migrations) <> 21
     or not exists (
       select 1 from public.schema_migrations
       where id = '0006_client_register.sql'
         and applied_at = timestamptz '2026-08-03 20:26:37.261845+00'
     ) then
    raise exception 'Alias rollback postcondition failed';
  end if;
end;
$verify$;
commit;
