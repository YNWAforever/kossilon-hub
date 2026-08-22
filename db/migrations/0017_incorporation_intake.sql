-- 0017: incorporation intake case type (P1-7).
--
-- Every existing case type (annual_return_cases) operates on an ALREADY-EXISTING
-- company. An incorporation case has no company at all until it completes, so it
-- cannot use work_items/documents (both company_id not null) or the SLA-policy
-- engine without generalizing all three — deliberately deferred, per the design
-- spec. This migration is fully self-contained: two new tables, nothing altered.

create table if not exists incorporation_cases (
  id uuid primary key default gen_random_uuid(),
  proposed_company_name_en text not null,
  proposed_company_name_zh text,
  proposed_registered_office text not null,
  proposed_company_secretary text not null,
  registered_capital integer not null check (registered_capital > 0),
  business_nature text not null,
  status text not null default 'Intake' check (status in (
    'Intake', 'Documents pending', 'Ready to file', 'Filed with Registrar', 'Completed'
  )),
  owner_id uuid not null references users(id),
  team_id uuid not null references teams(id),
  target_completion_date date not null,
  company_id uuid references companies(id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incorporation_cases_completed_has_company check (
    status <> 'Completed' or company_id is not null
  )
);

create index if not exists incorporation_cases_status_idx on incorporation_cases (status);
create index if not exists incorporation_cases_company_idx on incorporation_cases (company_id);

create table if not exists incorporation_checklist_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references incorporation_cases(id) on delete cascade,
  item_label text not null,
  required boolean not null default true,
  status text not null default 'Missing' check (status in ('Missing', 'Received', 'Verified', 'Rejected')),
  note text,
  received_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incorporation_checklist_items_case_idx on incorporation_checklist_items (case_id);
