-- T11: explicit approvals, per-row audit and payment-date observations.
-- Case writes continue to use annual_return_cases(company_id,return_year) uniqueness.
create table nar_import_approvals (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null unique references nar_import_previews(id) on delete restrict,
  batch_id uuid not null references nar_import_batches(id) on delete restrict,
  batch_revision integer not null check (batch_revision > 0),
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  approved_by uuid not null references users(id) on delete restrict,
  approved_at timestamptz not null default now()
);
create index nar_import_approvals_batch_idx on nar_import_approvals (batch_id,approved_at desc);

create table nar_import_apply_events (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references nar_import_approvals(id) on delete restrict,
  row_id uuid not null unique references nar_import_rows(id) on delete restrict,
  case_id uuid not null references annual_return_cases(id) on delete restrict,
  company_id uuid not null references companies(id) on delete restrict,
  actor_id uuid not null references users(id) on delete restrict,
  row_revision integer not null check (row_revision > 0),
  result text not null check (result in ('created','updated','skipped')),
  before_values jsonb not null,
  after_values jsonb not null,
  raw_source jsonb not null,
  created_at timestamptz not null default now()
);
create index nar_import_apply_events_case_idx on nar_import_apply_events (case_id,created_at desc);

create table nar_import_payment_observations (
  id uuid primary key default gen_random_uuid(),
  source_row_id uuid not null unique references nar_import_rows(id) on delete restrict,
  case_id uuid not null references annual_return_cases(id) on delete restrict,
  company_id uuid not null references companies(id) on delete restrict,
  observed_date date not null,
  raw_value text not null,
  status text not null default 'pending_review' check (status in ('pending_review','matched','rejected')),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index nar_import_payment_observations_pending_idx
  on nar_import_payment_observations (status,created_at) where status = 'pending_review';
