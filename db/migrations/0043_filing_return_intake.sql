-- T16: preserve unmatched/manual returns and read-only source intake provenance.
-- Existing handoff_returns rows remain; source fields are nullable for legacy rows.
create table filing_return_source_cursors (
  source_key text primary key,
  cursor text,
  lease_token uuid,
  lease_until timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now(),
  constraint filing_return_source_lease_agrees check (
    (lease_token is null and lease_until is null)
    or (lease_token is not null and lease_until is not null)
  )
);

create table filing_return_source_objects (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references filing_return_source_cursors(source_key) on delete restrict,
  object_id text not null,
  object_version text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null,
  content_type text not null,
  byte_size bigint not null check (byte_size > 0),
  object_key text not null,
  scan_state text not null check (scan_state in ('pending','unsafe','verified')),
  provider_reference text,
  first_seen_at timestamptz not null default now(),
  unique (source_key,object_id,source_sha256)
);
create index filing_return_source_objects_review_idx
  on filing_return_source_objects (scan_state,first_seen_at);

alter table handoff_returns
  alter column handoff_id drop not null,
  add column case_id uuid references annual_return_cases(id) on delete restrict,
  add column company_id uuid references companies(id) on delete restrict,
  add column return_year integer,
  add column source_kind text check (source_kind in ('manual','internal')),
  add column source_object_id text,
  add column source_version text,
  add column source_sha256 text check (source_sha256 ~ '^[0-9a-f]{64}$'),
  add column document_version_id uuid references document_versions(id) on delete restrict,
  add column external_reference text,
  add column manifest_sha256 text check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  add column candidate_handoff_ids uuid[] not null default '{}',
  add column match_state text not null default 'unmatched'
    check (match_state in ('unmatched','candidate','reconciled')),
  add column revision integer not null default 1 check (revision > 0),
  add column reconciliation_decision text,
  add column reconciliation_reason text;
update handoff_returns hr
set case_id = ph.case_id,
    company_id = arc.company_id,
    return_year = arc.return_year,
    match_state = case when hr.reconciled_at is null then 'candidate' else 'reconciled' end
from package_handoffs ph
join annual_return_cases arc on arc.id = ph.case_id
where hr.handoff_id = ph.id;
alter table handoff_returns add constraint handoff_returns_manual_evidence check (
  source_kind is distinct from 'manual'
  or (
    case_id is not null and company_id is not null and return_year is not null
    and document_id is not null and document_version_id is not null
    and source_object_id is not null and source_sha256 is not null
    and external_reference is not null and length(btrim(external_reference)) > 0
  )
);
create unique index handoff_returns_source_identity_uidx
  on handoff_returns (source_kind,source_object_id,source_sha256)
  where source_kind is not null;
create index handoff_returns_case_open_idx
  on handoff_returns (case_id,received_at desc)
  where reconciled_at is null or outcome in ('rejected','partial','unmatched');
