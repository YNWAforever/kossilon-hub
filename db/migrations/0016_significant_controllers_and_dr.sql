-- 0016: significant controllers register + Designated Representative (P1-6).
--
-- No structured significant-controller or inspection-request data has existed
-- anywhere in this schema — "significant control" appears only as demo fixture
-- text, and "designated represent" has zero hits repo-wide. This closes the
-- highest-liability gap in the roadmap catalogue (non-compliance exposure up to
-- HK$25,000 plus a daily fine). Purely additive except for widening
-- officers.officer_type, which has no other consumer of its current two-value
-- assumption (grepped repo-wide: only `officer_type in (...)` itself and the
-- Zod enum in clients/server-fns.ts reference the value list).

create table if not exists significant_controllers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  controller_name text not null,
  identification_type text check (identification_type in ('hkid', 'passport', 'br_number')),
  identification_number text,
  address text,
  control_bases text[] not null,
  registered_date date not null,
  cessation_date date,
  register_update_due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint significant_controllers_cessation_after_registered check (
    cessation_date is null or cessation_date >= registered_date
  ),
  constraint significant_controllers_control_bases_valid check (
    control_bases <@ array['shares_over_25pct', 'votes_over_25pct',
                            'board_appointment_right', 'significant_influence']::text[]
    and cardinality(control_bases) > 0
  )
);

create index if not exists significant_controllers_company_idx on significant_controllers (company_id);

create table if not exists scr_inspection_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  requester_name text not null,
  requester_authority text not null,
  request_date date not null,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scr_inspection_requests_company_idx on scr_inspection_requests (company_id);

-- officers.officer_type's current constraint is the inline, unnamed
-- `check (officer_type in ('director', 'secretary'))` from migration 0015,
-- which Postgres names by its standard <table>_<column>_check rule.
alter table officers drop constraint if exists officers_officer_type_check;
alter table officers add constraint officers_officer_type_check
  check (officer_type in ('director', 'secretary', 'designated_representative'));
