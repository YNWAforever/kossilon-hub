-- T22 guarded rollback, only after all clientAssign preview/operation evidence is absent.
begin;
lock table bulk_previews, bulk_operations in access exclusive mode;
do $$
begin
  if not exists (select 1 from schema_migrations where id='0051_bulk_client_assign_action.sql') then
    raise exception '0051 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from bulk_previews where action='clientAssign')
     or exists (select 1 from bulk_operations where action='clientAssign') then
    raise exception 'client assignment evidence exists; rollback refused';
  end if;
end
$$;
alter table bulk_previews drop constraint bulk_previews_action_check;
alter table bulk_previews add constraint bulk_previews_action_check
  check (action in ('assign','caseAssign','importApply'));
alter table bulk_operations drop constraint bulk_operations_action_check;
alter table bulk_operations add constraint bulk_operations_action_check
  check (action in ('assign','caseAssign','importApply'));
delete from schema_migrations where id='0051_bulk_client_assign_action.sql';
commit;
