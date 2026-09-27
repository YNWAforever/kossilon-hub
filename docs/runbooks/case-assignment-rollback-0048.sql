-- T22 guarded rollback of assignment revision, for an explicitly authorized empty clone only.
-- Any case-owner assignment after 0048 is business/audit evidence requiring forward repair.
begin;
lock table annual_return_cases in access exclusive mode;
do $$
begin
  if not exists (select 1 from schema_migrations where id='0048_case_assignment_revision.sql') then
    raise exception '0048 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from schema_migrations where id='0049_bulk_case_assign_action.sql') then
    raise exception '0049 depends on 0048; rollback 0049 first';
  end if;
  if exists (select 1 from annual_return_cases where assignment_revision <> 1) then
    raise exception 'case owner assignment evidence exists; rollback refused';
  end if;
end
$$;
alter table annual_return_cases drop column assignment_revision;
delete from schema_migrations where id='0048_case_assignment_revision.sql';
commit;
