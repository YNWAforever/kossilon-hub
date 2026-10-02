-- Forward-only facts. Legacy NULL is unknown; never invent a receipt or scan.
alter table package_handoffs
  add column delivery_fact text check(delivery_fact in ('prepared','exported','manual_recorded','provider_accepted','unknown')),
  add column exported_at timestamptz,
  add column exported_by uuid references users(id),
  add column manual_recorded_at timestamptz,
  add column manual_recorded_by uuid references users(id),
  add column manual_occurred_at timestamptz,
  add column manual_reference text,
  add column manual_note text,
  add column manual_evidence_document_id uuid references documents(id),
  add column manual_evidence_version_id uuid references document_versions(id),
  add constraint handoff_export_actor_agrees check((exported_at is null)=(exported_by is null)),
  add constraint handoff_manual_actor_agrees check((manual_recorded_at is null)=(manual_recorded_by is null)),
  add constraint handoff_manual_evidence_agrees check((manual_evidence_document_id is null)=(manual_evidence_version_id is null)),
  add constraint handoff_manual_fact_agrees check(delivery_fact is distinct from 'manual_recorded' or (
    manual_recorded_by is not null and manual_occurred_at is not null
    and length(btrim(manual_reference))>0 and length(btrim(manual_note))>0
    and destination_reference is null));

-- Duplicate history is a deployment blocker: unique creation refuses it,
-- rather than deleting or rewriting any existing approval.
create unique index package_handoffs_manifest_uidx on package_handoffs(case_id,manifest_sha256);
create or replace function preserve_handoff_manifest() returns trigger language plpgsql as $$
begin
  if row(new.case_id,new.manifest_sha256,new.manifest_payload,new.approved_by)
    is distinct from row(old.case_id,old.manifest_sha256,old.manifest_payload,old.approved_by) then
    raise exception 'Approved handoff manifest is immutable';
  end if;
  return new;
end $$;
create trigger package_handoffs_manifest_immutable before update on package_handoffs
  for each row execute function preserve_handoff_manifest();

alter table handoff_returns
  add column source text check(source in ('manual','provider')),
  add column recorded_by uuid references users(id),
  add column external_reference text,
  add column returned_manifest_sha256 text check(returned_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  add column reported_outcome text check(reported_outcome in ('accepted','rejected','partial','unmatched')),
  add column document_version_id uuid references document_versions(id),
  add column idempotency_key uuid,
  add column payload_sha256 text check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  add column reconciliation_note text;
create unique index handoff_returns_idempotency_uidx on handoff_returns(handoff_id,idempotency_key) where idempotency_key is not null;
