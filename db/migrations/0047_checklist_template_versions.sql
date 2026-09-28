-- T21: explicit, immutable template publications and case provenance.
-- Existing cases deliberately remain null: their template version cannot be inferred.
alter table checklist_templates
  add column revision integer not null default 1 check (revision > 0),
  add column published_version_id uuid,
  add column archived_at timestamptz;

create table checklist_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  origin text not null check (origin in ('legacy_baseline','admin_publish')),
  name text not null,
  service_type text not null,
  description text not null,
  documents jsonb not null,
  reminders jsonb not null,
  risk_rules jsonb not null,
  published_by uuid references users(id) on delete restrict,
  published_at timestamptz not null default now(),
  unique (template_id,version_number),
  constraint template_publication_actor check (
    (origin='legacy_baseline' and published_by is null)
    or (origin='admin_publish' and published_by is not null)
  )
);

create function refuse_template_version_change() returns trigger language plpgsql as $$
begin
  raise exception 'Published checklist template versions are immutable';
end
$$;
create trigger checklist_template_version_immutable
  before update or delete on checklist_template_versions
  for each row execute function refuse_template_version_change();

alter table checklist_templates
  add constraint checklist_templates_published_version_fkey
  foreign key (published_version_id)
  references checklist_template_versions(id) on delete restrict;

-- Snapshot the editable legacy definitions for future case creation only.
-- This does not claim any historic case used this exact content.
insert into checklist_template_versions (
  template_id,version_number,origin,name,service_type,description,
  documents,reminders,risk_rules
)
select id,1,'legacy_baseline',name,service_type,description,
  documents,reminders,risk_rules
from checklist_templates
where active=true;

update checklist_templates t set published_version_id=v.id
from checklist_template_versions v
where v.template_id=t.id and v.version_number=1 and v.origin='legacy_baseline';

alter table annual_return_cases
  add column template_version_id uuid references checklist_template_versions(id) on delete restrict,
  add column template_revision integer not null default 1 check (template_revision > 0);
create index annual_return_cases_template_version_idx
  on annual_return_cases(template_version_id,id)
  where template_version_id is not null;

alter table annual_return_checklist_items
  add column template_document_id text;
create unique index annual_return_checklist_template_document_uidx
  on annual_return_checklist_items(case_id,template_document_id)
  where template_document_id is not null;
