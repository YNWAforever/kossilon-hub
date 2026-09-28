-- Review only. Run on an explicitly authorized disposable clone.
begin;
lock table bulk_previews, bulk_operations in access exclusive mode;
do $$
begin
  if not exists (select 1 from schema_migrations where id='0065_bulk_sla_policy_attach.sql') then
    raise exception '0065 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from bulk_previews where action='attachSlaPolicies')
    or exists (select 1 from bulk_operations where action='attachSlaPolicies') then
    raise exception 'SLA policy batch evidence exists; rollback refused';
  end if;
end
$$;
alter table bulk_previews drop constraint bulk_previews_action_check;
alter table bulk_previews add constraint bulk_previews_action_check
  check (action in ('assign','caseAssign','clientAssign','tag','reminderDrafts','reconcilePayments','preparePackages','recordSubmissions','matchReturns','importApply'));
alter table bulk_operations drop constraint bulk_operations_action_check;
alter table bulk_operations add constraint bulk_operations_action_check
  check (action in ('assign','caseAssign','clientAssign','tag','reminderDrafts','reconcilePayments','preparePackages','recordSubmissions','matchReturns','importApply'));
delete from schema_migrations where id='0065_bulk_sla_policy_attach.sql';
commit;
