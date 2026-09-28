-- T21 guarded rollback. Run only against an explicitly authorized database.
-- Any published edit, case provenance, or template write since migration
-- requires forward repair that retains version/evidence history.
begin;
lock table checklist_templates, checklist_template_versions,
  annual_return_cases, annual_return_checklist_items in access exclusive mode;
do $$
declare
  migrated_at timestamptz;
begin
  select applied_at into migrated_at from schema_migrations
    where id='0047_checklist_template_versions.sql';
  if migrated_at is null then
    raise exception '0047 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from annual_return_cases
      where template_version_id is not null or template_revision <> 1)
    or exists (select 1 from annual_return_checklist_items
      where template_document_id is not null)
    or exists (select 1 from checklist_template_versions
      where origin <> 'legacy_baseline')
    or exists (select 1 from checklist_templates
      where revision <> 1 or archived_at is not null or created_at > migrated_at)
    or exists (select 1 from checklist_templates t
      left join checklist_template_versions v on v.id=t.published_version_id
      where t.active is distinct from (v.id is not null)
        or (v.id is not null and
          (v.template_id <> t.id or v.name <> t.name
           or v.service_type <> t.service_type
           or v.description <> t.description
           or v.documents <> t.documents
           or v.reminders <> t.reminders
           or v.risk_rules <> t.risk_rules))) then
    raise exception 'template publication or case evidence exists; rollback refused';
  end if;
end
$$;
drop index annual_return_checklist_template_document_uidx;
alter table annual_return_checklist_items drop column template_document_id;
drop index annual_return_cases_template_version_idx;
alter table annual_return_cases
  drop column template_version_id,
  drop column template_revision;
alter table checklist_templates drop constraint checklist_templates_published_version_fkey;
alter table checklist_templates
  drop column published_version_id,
  drop column revision,
  drop column archived_at;
drop trigger checklist_template_version_immutable on checklist_template_versions;
drop function refuse_template_version_change();
drop table checklist_template_versions;
delete from schema_migrations where id='0047_checklist_template_versions.sql';
commit;
