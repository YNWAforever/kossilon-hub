-- 0015: officers and shareholdings registers (P1-5).
--
-- No structured director/secretary/shareholder data has existed anywhere in this
-- schema — companies.company_secretary is free text with no appointment history,
-- and grepping "director"/"shareholder" repo-wide turns up only checklist labels,
-- FAQ scripts, and demo strings. These two tables are the substrate future NAR1
-- generation (not built in this pass) and P1-6/P1-7/P1-9 will read from. Purely
-- additive — no existing column is touched.

create table if not exists officers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  officer_type text not null check (officer_type in ('director', 'secretary')),
  name text not null,
  identification_type text check (identification_type in ('hkid', 'passport', 'br_number')),
  identification_number text,
  address text,
  appointment_date date not null,
  cessation_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint officers_cessation_after_appointment check (
    cessation_date is null or cessation_date >= appointment_date
  )
);

create index if not exists officers_company_idx on officers (company_id);

create table if not exists shareholdings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  shareholder_name text not null,
  shareholder_address text,
  share_class text not null default 'Ordinary',
  number_of_shares integer not null check (number_of_shares > 0),
  allotment_date date not null,
  cessation_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shareholdings_cessation_after_allotment check (
    cessation_date is null or cessation_date >= allotment_date
  )
);

create index if not exists shareholdings_company_idx on shareholdings (company_id);
