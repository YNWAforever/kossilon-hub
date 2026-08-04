create table if not exists service_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_fee integer not null constraint service_packages_fee_positive_check check (default_fee > 0),
  currency text not null default 'HKD' constraint service_packages_currency_hkd_check check (currency = 'HKD'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into service_packages (id, name, default_fee, sort_order)
values
  ('30000000-0000-0000-0000-000000000001', 'Basic', 2800, 1),
  ('30000000-0000-0000-0000-000000000002', 'Standard', 3800, 2),
  ('30000000-0000-0000-0000-000000000003', 'Premium', 5200, 3)
on conflict (name) do nothing;

alter table companies
  add column if not exists service_package_id uuid references service_packages(id);

update companies
set service_package_id = '30000000-0000-0000-0000-000000000002'
where service_package_id is null;

create table if not exists company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  role text not null,
  email text,
  phone text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_contacts_reachable_check check (email is not null or phone is not null)
);

create index if not exists company_contacts_company_id_idx
  on company_contacts (company_id);

create unique index if not exists company_contacts_primary_uidx
  on company_contacts (company_id)
  where is_primary;
