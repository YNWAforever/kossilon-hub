create extension if not exists pgcrypto;

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  manager_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null check (role in ('Admin', 'Manager', 'Staff')),
  team_id uuid references teams(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'teams_manager_id_fkey'
      and conrelid = 'teams'::regclass
  ) then
    alter table teams
      add constraint teams_manager_id_fkey
      foreign key (manager_id) references users(id)
      deferrable initially deferred;
  end if;
end
$$;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  cr_number text not null unique,
  br_number text not null unique,
  incorporation_date date not null,
  annual_return_basis_date date not null,
  registered_office text not null,
  company_secretary text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  assigned_owner_id uuid not null references users(id),
  assigned_team_id uuid not null references teams(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  case_id uuid,
  file_type text not null,
  file_name text not null,
  storage_url text not null,
  upload_source text not null check (upload_source in ('staff', 'client', 'system')),
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  uploaded_by uuid references users(id),
  uploaded_at timestamptz not null default now(),
  verified_by uuid references users(id),
  verified_at timestamptz
);

create table if not exists annual_return_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  return_year integer not null constraint annual_return_cases_return_year_check check (return_year between 1900 and 2100),
  made_up_date date not null,
  filing_due_date date not null,
  current_status text not null check (
    current_status in (
      'Upcoming',
      'Client reminder sent',
      'Documents pending',
      'Documents received',
      'Payment pending',
      'Payment received',
      'NAR1 prepared',
      'Signature pending',
      'Ready to file',
      'Filed',
      'Completed'
    )
  ),
  risk_level text not null default 'green' check (risk_level in ('green', 'yellow', 'orange', 'red')),
  owner_id uuid not null references users(id),
  reviewer_id uuid references users(id),
  reminders_sent integer not null default 0 constraint annual_return_cases_reminders_sent_nonnegative_check check (reminders_sent >= 0),
  filing_reference text,
  confirmation_document_id uuid references documents(id),
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, return_year)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_case_id_fkey'
      and conrelid = 'documents'::regclass
  ) then
    alter table documents
      add constraint documents_case_id_fkey
      foreign key (case_id) references annual_return_cases(id) on delete cascade
      deferrable initially deferred;
  end if;
end
$$;

create table if not exists annual_return_checklist_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  item_label text not null,
  required boolean not null default true,
  status text not null default 'Missing' check (status in ('Missing', 'Received', 'Verified', 'Rejected')),
  due_date date not null,
  received_at timestamptz,
  verified_at timestamptz,
  document_id uuid references documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  invoice_number text not null,
  amount integer not null constraint payments_amount_positive_check check (amount > 0),
  currency text not null default 'HKD' constraint payments_currency_hkd_check check (currency = 'HKD'),
  status text not null default 'Payment pending' check (status in ('Not invoiced', 'Payment pending', 'Payment received', 'Overdue')),
  due_date date not null,
  paid_at timestamptz,
  payment_proof_document_id uuid references documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id)
);

create table if not exists timeline_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  case_id uuid references annual_return_cases(id) on delete cascade,
  event_type text not null,
  actor_type text not null check (actor_type in ('system', 'user')),
  actor_id uuid references users(id),
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  author_id uuid not null references users(id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reminder_logs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  channel text not null default 'WhatsApp',
  template_label text not null,
  recipient_name text not null,
  recipient_phone text not null,
  draft_body text not null,
  recorded_sent_at timestamptz not null,
  staff_actor_id uuid not null references users(id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists annual_return_cases_due_idx on annual_return_cases (filing_due_date);
create index if not exists annual_return_cases_status_idx on annual_return_cases (current_status);
create index if not exists annual_return_cases_risk_idx on annual_return_cases (risk_level);
create index if not exists annual_return_cases_owner_idx on annual_return_cases (owner_id);
create index if not exists checklist_case_idx on annual_return_checklist_items (case_id);
create index if not exists timeline_case_created_idx on timeline_events (case_id, created_at desc);
create index if not exists documents_case_idx on documents (case_id);
create index if not exists documents_company_idx on documents (company_id);
create index if not exists case_notes_case_idx on case_notes (case_id);
create index if not exists reminder_logs_case_idx on reminder_logs (case_id);
create index if not exists companies_assigned_team_idx on companies (assigned_team_id);
