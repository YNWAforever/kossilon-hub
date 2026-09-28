-- T13: preserve untrusted import payment dates as observations until a human
-- reconciles a genuinely scanned, reviewed proof against the canonical invoice.
alter table nar_import_payment_observations
  add column revision integer not null default 1 check (revision > 0),
  add column invoice_ref text,
  add column amount_minor bigint check (amount_minor is null or amount_minor > 0),
  add column currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  add column proof_version_id uuid references document_versions(id) on delete restrict,
  add column reviewed_by uuid references users(id) on delete restrict,
  add column reviewed_at timestamptz,
  add column decision_reason text;
alter table nar_import_payment_observations
  drop constraint nar_import_payment_observations_status_check;
alter table nar_import_payment_observations
  add constraint nar_import_payment_observations_status_check
  check (status in ('pending_review','matched','rejected','exception'));

create table payment_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references nar_import_payment_observations(id) on delete restrict,
  payment_id uuid references payments(id) on delete restrict,
  proof_version_id uuid references document_versions(id) on delete restrict,
  actor_id uuid not null references users(id) on delete restrict,
  decision text not null check (decision in ('match','reject')),
  result text not null check (result in ('matched','rejected','exception')),
  observation_revision integer not null check (observation_revision > 0),
  reason text,
  before_values jsonb not null,
  after_values jsonb not null,
  created_at timestamptz not null default now()
);
create index payment_reconciliation_events_observation_idx
  on payment_reconciliation_events (observation_id,created_at desc);

create table payment_proof_allocations (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null unique references nar_import_payment_observations(id) on delete restrict,
  payment_id uuid not null references payments(id) on delete restrict,
  proof_version_id uuid not null unique references document_versions(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  invoice_ref text not null,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create unique index payment_proof_allocations_payment_uidx on payment_proof_allocations (payment_id);
create unique index nar_import_payment_observations_matched_invoice_uidx
  on nar_import_payment_observations (company_id,invoice_ref)
  where status = 'matched' and invoice_ref is not null;
