-- REVIEW ONLY. Restore the 0063 immutable trigger only if no policy attachment
-- has been committed. This is for a compatible pre-0064 application build.
-- Take a named database snapshot before use.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.schema_migrations in access exclusive mode;
lock table public.work_items in access exclusive mode;
lock table public.work_item_sla_attachments in access exclusive mode;
do $guard$
begin
  if (select count(*) from public.schema_migrations) <> 64
    or (select max(id) from public.schema_migrations) <> '0064_work_item_sla_policy_attachment.sql'
    or not exists (
      select 1 from public.schema_migrations
      where id = '0064_work_item_sla_policy_attachment.sql'
    ) then
    raise exception 'Ledger is not exactly canonical through 0064; do not roll back';
  end if;
  if exists (select 1 from public.work_item_sla_attachments) then
    raise exception 'SLA policy attachments exist; retain 0064 and reconcile first';
  end if;
end;
$guard$;

drop table public.work_item_sla_attachments;
drop function public.reject_work_item_sla_attachment_mutation();
create or replace function public.enforce_work_item_sla_snapshot_immutability()
returns trigger language plpgsql as $$
begin
  if old.sla_policy_version_id is distinct from new.sla_policy_version_id
    or old.sla_started_at is distinct from new.sla_started_at
    or old.sla_warning_at is distinct from new.sla_warning_at
    or old.sla_due_at is distinct from new.sla_due_at then
    raise exception 'Work item SLA snapshots are immutable';
  end if;
  if old.sla_breached_at is not null
    and old.sla_breached_at is distinct from new.sla_breached_at then
    raise exception 'Work item breach timestamps are write-once';
  end if;
  return new;
end
$$;
delete from public.schema_migrations where id = '0064_work_item_sla_policy_attachment.sql';
do $verify$
begin
  if (select count(*) from public.schema_migrations) <> 63
    or exists (select 1 from public.schema_migrations
      where id = '0064_work_item_sla_policy_attachment.sql')
    or to_regclass('public.work_item_sla_attachments') is not null then
    raise exception '0064 rollback postcondition failed';
  end if;
end;
$verify$;
commit;
