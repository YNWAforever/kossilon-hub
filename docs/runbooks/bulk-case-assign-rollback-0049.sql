-- T22 guarded rollback for an authorized empty disposable clone only.
begin;
lock table bulk_previews, bulk_operations in access exclusive mode;
do $$
begin
  if not exists (select 1 from schema_migrations where id='0049_bulk_case_assign_action.sql') then
    raise exception '0049 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from bulk_previews where action='caseAssign')
    or exists (select 1 from bulk_operations where action='caseAssign') then
    raise exception 'case assignment operation evidence exists; rollback refused';
  end if;
end
$$;
alter table bulk_previews drop constraint bulk_previews_action_check;
alter table bulk_previews add constraint bulk_previews_action_check
  check (action in ('assign','importApply'));
alter table bulk_operations drop constraint bulk_operations_action_check;
alter table bulk_operations add constraint bulk_operations_action_check
  check (action in ('assign','importApply'));
delete from schema_migrations where id='0049_bulk_case_assign_action.sql';
commit;
