-- Additive only. No historical status, amount, date or receipt is invented.
create table if not exists payment_evidence_entries (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  document_id uuid not null references documents(id),
  proof_version_id uuid not null unique references document_versions(id),
  proof_sha256 text not null check (proof_sha256 ~ '^[0-9a-f]{64}$'),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'HKD' check (currency='HKD'),
  received_on date not null,
  reference text check (reference is null or length(reference) between 1 and 200),
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  recorded_by uuid not null references users(id),
  recorded_at timestamptz not null default now(),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  reason_code text check (reason_code in ('unreadable','amount_mismatch','date_mismatch','duplicate_proof','wrong_account','other')),
  reason_text text check (reason_text is null or length(btrim(reason_text)) between 1 and 500),
  check ((status='pending' and reviewed_by is null and reviewed_at is null)
    or (status<>'pending' and reviewed_by is not null and reviewed_at is not null)),
  check (status<>'rejected' or (reason_code is not null and reason_text is not null))
);
create unique index if not exists payment_evidence_active_hash_uidx on payment_evidence_entries(proof_sha256) where status in ('pending','verified');
create index if not exists payment_evidence_case_idx on payment_evidence_entries(case_id,payment_id,recorded_at);
