-- T22 guarded rollback of client assignment revision, for an explicitly authorized empty clone only.
-- Any owner/team edit after 0050 is business evidence requiring forward repair.
begin;
lock table companies in access exclusive mode;
do $$
begin
  if not exists (select 1 from schema_migrations where id='0050_client_assignment_revision.sql') then
    raise exception '0050 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from schema_migrations where id='0051_bulk_client_assign_action.sql') then
    raise exception '0051 depends on 0050; rollback 0051 first';
  end if;
  if exists (select 1 from companies where assignment_revision <> 1) then
    raise exception 'client owner assignment evidence exists; rollback refused';
  end if;
end
$$;
alter table companies drop column assignment_revision;
delete from schema_migrations where id='0050_client_assignment_revision.sql';
commit;
