-- T22 guarded rollback of tag action on an explicitly authorized disposable clone.
begin;
lock table bulk_previews, bulk_operations in access exclusive mode;
do $$
begin
  if not exists (select 1 from schema_migrations where id='0053_bulk_tag_action.sql') then
    raise exception '0053 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from bulk_previews where action='tag')
    or exists (select 1 from bulk_operations where action='tag') then
    raise exception 'tag operation evidence exists; rollback refused';
  end if;
end
$$;
alter table bulk_previews drop constraint bulk_previews_action_check;
alter table bulk_previews add constraint bulk_previews_action_check
  check (action in ('assign','caseAssign','clientAssign','importApply'));
alter table bulk_operations drop constraint bulk_operations_action_check;
alter table bulk_operations add constraint bulk_operations_action_check
  check (action in ('assign','caseAssign','clientAssign','importApply'));
delete from schema_migrations where id='0053_bulk_tag_action.sql';
commit;
