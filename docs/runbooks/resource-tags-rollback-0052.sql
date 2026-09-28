-- T22 guarded rollback of tag schema on an explicitly authorized disposable clone.
begin;
lock table companies, annual_return_cases, work_items, company_tags,
  annual_return_case_tags, work_item_tags, resource_tag_events in access exclusive mode;
do $$
begin
  if not exists (select 1 from schema_migrations where id='0052_resource_tags.sql') then
    raise exception '0052 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from schema_migrations where id='0053_bulk_tag_action.sql') then
    raise exception '0053 depends on 0052; rollback 0053 first';
  end if;
  if exists (select 1 from company_tags)
    or exists (select 1 from annual_return_case_tags)
    or exists (select 1 from work_item_tags)
    or exists (select 1 from resource_tag_events)
    or exists (select 1 from companies where tag_revision <> 1)
    or exists (select 1 from annual_return_cases where tag_revision <> 1)
    or exists (select 1 from work_items where tag_revision <> 1) then
    raise exception 'tag business evidence exists; rollback refused';
  end if;
end
$$;
drop table resource_tag_events;
drop table company_tags;
drop table annual_return_case_tags;
drop table work_item_tags;
alter table companies drop column tag_revision;
alter table annual_return_cases drop column tag_revision;
alter table work_items drop column tag_revision;
delete from schema_migrations where id='0052_resource_tags.sql';
commit;
