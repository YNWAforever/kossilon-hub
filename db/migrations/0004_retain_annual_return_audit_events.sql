do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'annual_return_audit_events_case_id_fkey'
      and conrelid = 'annual_return_audit_events'::regclass
  ) then
    alter table annual_return_audit_events
      drop constraint annual_return_audit_events_case_id_fkey;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'annual_return_audit_events_company_id_fkey'
      and conrelid = 'annual_return_audit_events'::regclass
  ) then
    alter table annual_return_audit_events
      drop constraint annual_return_audit_events_company_id_fkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'annual_return_audit_events_case_id_fkey'
      and conrelid = 'annual_return_audit_events'::regclass
  ) then
    alter table annual_return_audit_events
      add constraint annual_return_audit_events_case_id_fkey
      foreign key (case_id) references annual_return_cases(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'annual_return_audit_events_company_id_fkey'
      and conrelid = 'annual_return_audit_events'::regclass
  ) then
    alter table annual_return_audit_events
      add constraint annual_return_audit_events_company_id_fkey
      foreign key (company_id) references companies(id);
  end if;
end
$$;
