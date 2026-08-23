-- 0019: ad hoc corporate change requests (P1-9).
--
-- Four separately-quoted one-off services the firm already sells (Q8 of the Q&A):
-- company name change, share transfer (with stamp duty), officer
-- appointment/resignation/detail-change, and registered-office address change.
-- One table with a change_type discriminator, mirroring how officers.officer_type
-- and significant_controllers cover multiple sub-kinds in one table. Unlike
-- incorporation_cases (0017), every request here operates on an ALREADY-EXISTING
-- company, so it can join the work_items/SLA engine directly — see 0020.

create table corporate_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  change_type text not null check (change_type in (
    'name_change', 'share_transfer', 'officer_change', 'address_change'
  )),
  status text not null default 'Requested' check (status in (
    'Requested', 'Documents pending', 'Ready to file', 'Filed with Registrar', 'Completed', 'Cancelled'
  )),
  owner_id uuid not null references users(id),
  quoted_fee numeric(10, 2) not null check (quoted_fee >= 0),

  -- name_change fields
  current_name_en text,
  current_name_zh text,
  new_name_en text,
  new_name_zh text,

  -- share_transfer fields
  transferor_shareholding_id uuid references shareholdings(id) on delete restrict,
  transferee_shareholding_id uuid references shareholdings(id) on delete restrict,
  transferee_new_shareholder_name text,
  transferee_new_shareholder_address text,
  shares_transferred integer check (shares_transferred > 0),
  consideration numeric(12, 2),
  stamp_duty_amount numeric(10, 2),

  -- officer_change fields
  officer_id uuid references officers(id) on delete restrict,
  officer_action text check (officer_action in ('appoint', 'resign', 'detail_change')),
  new_officer_type text check (new_officer_type in ('director', 'secretary')),
  new_officer_name text,
  new_officer_identification_type text check (new_officer_identification_type in ('hkid', 'passport', 'br_number')),
  new_officer_identification_number text,
  new_officer_address text,
  effective_date date,

  -- address_change fields
  current_registered_office text,
  new_registered_office text,

  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint corporate_change_requests_completed_has_timestamp check (
    (status = 'Completed') = (completed_at is not null)
  ),
  constraint corporate_change_requests_type_fields_check check (
    (change_type = 'name_change' and new_name_en is not null)
    or (
      change_type = 'share_transfer'
      and transferor_shareholding_id is not null
      and shares_transferred is not null
      and consideration is not null
      and stamp_duty_amount is not null
      and (transferee_shareholding_id is not null) <> (transferee_new_shareholder_name is not null)
    )
    or (
      change_type = 'officer_change'
      and officer_action is not null
      and (
        (officer_action = 'appoint' and officer_id is null and new_officer_type is not null and new_officer_name is not null)
        or (officer_action = 'resign' and officer_id is not null)
        or (officer_action = 'detail_change' and officer_id is not null)
      )
    )
    or (change_type = 'address_change' and new_registered_office is not null)
  )
);

create index corporate_change_requests_company_idx on corporate_change_requests (company_id);
create index corporate_change_requests_status_idx on corporate_change_requests (status);
create index corporate_change_requests_change_type_idx on corporate_change_requests (change_type);

create table corporate_change_checklist_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references corporate_change_requests(id) on delete cascade,
  item_label text not null,
  required boolean not null default true,
  status text not null default 'Missing' check (status in ('Missing', 'Received', 'Verified', 'Rejected')),
  note text,
  received_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index corporate_change_checklist_items_request_idx on corporate_change_checklist_items (request_id);
