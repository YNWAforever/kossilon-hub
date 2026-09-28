-- REVIEW ONLY. Technical rollback of 0063 before a later migration or any
-- unconfigured work item exists. Use only with the pre-0063 application build.
-- The guard deliberately refuses to discard a work item that cannot satisfy
-- the old NOT NULL schema. Take a named snapshot first.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.schema_migrations in access exclusive mode;
lock table public.work_items in access exclusive mode;
do $guard$
begin
  if (select count(*) from public.schema_migrations) <> 63
    or (select max(id) from public.schema_migrations) <> '0063_work_items_unconfigured_sla.sql'
    or not exists (
      select 1 from public.schema_migrations
      where id = '0063_work_items_unconfigured_sla.sql'
    ) then
    raise exception 'Ledger is not exactly canonical through 0063; do not roll back';
  end if;
  if exists (
    select 1 from public.work_items
    where sla_policy_version_id is null
      or sla_started_at is null
      or sla_warning_at is null
      or sla_due_at is null
  ) then
    raise exception 'Unconfigured work items exist; retain 0063 and reconcile first';
  end if;
end;
$guard$;

alter table public.work_items drop constraint work_items_sla_snapshot_check;
alter table public.work_items
  alter column sla_policy_version_id set not null,
  alter column sla_started_at set not null,
  alter column sla_warning_at set not null,
  alter column sla_due_at set not null;
alter table public.work_items add constraint work_items_sla_order_check check (
  sla_started_at <= sla_warning_at and sla_warning_at < sla_due_at
);
delete from public.schema_migrations where id = '0063_work_items_unconfigured_sla.sql';
do $verify$
begin
  if (select count(*) from public.schema_migrations) <> 62
    or exists (select 1 from public.schema_migrations where id = '0063_work_items_unconfigured_sla.sql')
    or exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'work_items'
        and column_name in ('sla_policy_version_id','sla_started_at','sla_warning_at','sla_due_at')
        and is_nullable = 'YES'
    ) then
    raise exception '0063 rollback postcondition failed';
  end if;
end;
$verify$;
commit;
