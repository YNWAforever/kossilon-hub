-- T20 guarded rollback. Run only against an explicitly authorized database.
-- Any provider reservation, access event or changed revision requires forward repair.
begin;
lock table staff_profiles, staff_provisioning_requests, staff_access_events in access exclusive mode;
do $$
begin
  if not exists (select 1 from schema_migrations
    where id='0046_staff_lifecycle.sql') then
    raise exception '0046 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from staff_provisioning_requests)
    or exists (select 1 from staff_access_events)
    or exists (select 1 from staff_profiles where access_revision <> 1) then
    raise exception 'staff lifecycle or provider evidence exists; rollback refused';
  end if;
end
$$;
drop index staff_access_events_target_idx;
drop table staff_access_events;
drop table staff_provisioning_requests;
alter table staff_profiles drop column access_revision;
delete from schema_migrations where id='0046_staff_lifecycle.sql';
commit;
