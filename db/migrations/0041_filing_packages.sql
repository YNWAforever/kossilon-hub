-- T14: immutable manifest/artifact revisions, with approval separate from preparation
-- and from the later T15 external submission record.
create table filing_packages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete restrict,
  revision integer not null check (revision > 0),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_payload text not null,
  artifact_key text not null,
  artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_size_bytes bigint not null check (artifact_size_bytes > 0),
  state text not null default 'draft' check (state in ('draft','approved')),
  prepared_by uuid not null references users(id) on delete restrict,
  approved_by uuid references users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (case_id, revision),
  constraint filing_packages_approval_agrees check (
    (state = 'draft' and approved_by is null and approved_at is null)
    or (state = 'approved' and approved_by is not null and approved_at is not null)
  )
);
create index filing_packages_case_latest_idx on filing_packages (case_id,revision desc);

create function enforce_filing_package_immutability() returns trigger
language plpgsql as $$
begin
  if old.case_id <> new.case_id or old.revision <> new.revision
    or old.manifest_sha256 <> new.manifest_sha256
    or old.manifest_payload <> new.manifest_payload
    or old.artifact_key <> new.artifact_key
    or old.artifact_sha256 <> new.artifact_sha256
    or old.artifact_size_bytes <> new.artifact_size_bytes
    or old.prepared_by <> new.prepared_by
    or old.created_at <> new.created_at
    or old.state = 'approved'
    or new.state <> 'approved'
  then raise exception 'Filing package manifest and artifact are immutable';
  end if;
  return new;
end $$;
create trigger filing_packages_immutable_before_update
before update on filing_packages for each row
execute function enforce_filing_package_immutability();
