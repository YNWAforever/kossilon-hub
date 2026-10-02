-- Revision 1 identifies the currently observed template, not invented old history.
alter table checklist_templates add column revision integer not null default 1 check(revision>0);
alter table annual_return_cases
  add column checklist_template_source_id uuid,
  add column checklist_template_revision integer check(checklist_template_revision>0),
  add column checklist_template_snapshot jsonb,
  add constraint case_template_snapshot_agrees check(
    (checklist_template_source_id is null and checklist_template_revision is null and checklist_template_snapshot is null)
    or (checklist_template_source_id is not null and checklist_template_revision is not null and checklist_template_snapshot is not null));
create index annual_return_case_template_source_idx on annual_return_cases(checklist_template_source_id,id)
  where checklist_template_source_id is not null;
create function preserve_case_template_snapshot() returns trigger language plpgsql as $$
begin
  if row(new.checklist_template_source_id,new.checklist_template_revision,new.checklist_template_snapshot)
    is distinct from row(old.checklist_template_source_id,old.checklist_template_revision,old.checklist_template_snapshot) then
    raise exception 'Case creation template snapshot is immutable';
  end if;
  return new;
end $$;
create trigger annual_return_case_template_immutable before update on annual_return_cases
  for each row execute function preserve_case_template_snapshot();
