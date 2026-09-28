-- T23 guarded rollback on an explicitly authorized disposable clone only.
begin;
lock table bulk_previews, bulk_operations, bulk_reminder_reviews in access exclusive mode;
do $$
begin
  if not exists (select 1 from schema_migrations where id='0054_bulk_reminder_drafts.sql') then
    raise exception '0054 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from bulk_previews where action='reminderDrafts')
    or exists (select 1 from bulk_operations where action='reminderDrafts')
    or exists (select 1 from bulk_reminder_reviews) then
    raise exception 'reminder draft evidence exists; rollback refused';
  end if;
end
$$;
drop table bulk_reminder_reviews;
alter table bulk_previews drop constraint bulk_previews_action_check;
alter table bulk_previews add constraint bulk_previews_action_check
  check (action in ('assign','caseAssign','clientAssign','tag','importApply'));
alter table bulk_operations drop constraint bulk_operations_action_check;
alter table bulk_operations add constraint bulk_operations_action_check
  check (action in ('assign','caseAssign','clientAssign','tag','importApply'));
delete from schema_migrations where id='0054_bulk_reminder_drafts.sql';
commit;
