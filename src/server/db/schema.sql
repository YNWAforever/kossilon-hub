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

create table if not exists staff_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete restrict,
  auth_user_id text not null unique,
  role text not null check (role in ('Admin', 'Manager', 'Staff', 'Client')),
  team_id uuid references teams(id) on delete set null,
  capacity_points integer not null default 100 check (capacity_points >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staff_skills (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references staff_profiles(id) on delete restrict,
  skill_key text not null,
  proficiency integer not null default 1 check (proficiency between 1 and 5),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_profile_id, skill_key)
);

create table if not exists client_company_memberships (
  id uuid primary key default gen_random_uuid(),
  auth_user_id text not null,
  company_id uuid not null references companies(id) on delete restrict,
  role text not null default 'Client' check (role in ('Admin', 'Manager', 'Staff', 'Client')),
  active boolean not null default true,
  invited_by uuid references users(id) on delete restrict,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, company_id)
);

create table if not exists business_calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Hong_Kong',
  version integer not null default 1 check (version > 0),
  weekly_schedule jsonb not null,
  effective_from date not null,
  active boolean not null default true,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, version)
);

create table if not exists business_calendar_holidays (
  id uuid primary key default gen_random_uuid(),
  business_calendar_id uuid not null references business_calendars(id) on delete restrict,
  holiday_date date not null,
  label text not null,
  closed boolean not null default true,
  working_intervals jsonb,
  created_at timestamptz not null default now(),
  unique (business_calendar_id, holiday_date)
);

create table if not exists sla_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  version integer not null check (version > 0),
  name text not null,
  work_type text not null,
  business_calendar_id uuid not null references business_calendars(id) on delete restrict,
  warning_minutes integer not null check (warning_minutes > 0),
  due_minutes integer not null check (due_minutes > warning_minutes),
  effective_from timestamptz not null,
  active boolean not null default true,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_key, version)
);

create table if not exists work_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  case_id uuid not null references annual_return_cases(id) on delete restrict,
  source_event_key text not null unique,
  source_event_type text not null,
  work_type text not null,
  title text not null,
  status text not null default 'open' check (
    status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled')
  ),
  priority integer not null default 50 check (priority between 0 and 100),
  owner_id uuid references users(id) on delete set null,
  reviewer_id uuid references users(id) on delete set null,
  team_id uuid references teams(id) on delete set null,
  sla_policy_version_id uuid not null references sla_policies(id) on delete restrict,
  sla_started_at timestamptz not null,
  sla_warning_at timestamptz not null,
  sla_due_at timestamptz not null,
  sla_breached_at timestamptz,
  version integer not null default 1 check (version > 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assignment_events (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references work_items(id) on delete restrict,
  previous_assignee_id uuid references users(id) on delete restrict,
  assigned_to_id uuid not null references users(id) on delete restrict,
  assigned_by_id uuid not null references users(id) on delete restrict,
  recommendation_rank integer check (recommendation_rank > 0),
  recommendation_score numeric(10, 4),
  override_reason text,
  expected_version integer not null check (expected_version > 0),
  created_at timestamptz not null default now()
);

create table if not exists escalation_events (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references work_items(id) on delete restrict,
  sla_policy_version_id uuid not null references sla_policies(id) on delete restrict,
  threshold text not null check (threshold in ('warning', 'breach')),
  occurred_at timestamptz not null,
  acknowledged_by_id uuid references users(id) on delete restrict,
  acknowledged_at timestamptz,
  acknowledgement_note text,
  created_at timestamptz not null default now(),
  unique (work_item_id, sla_policy_version_id, threshold)
);

create table if not exists notification_outbox (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid references work_items(id) on delete restrict,
  company_id uuid not null references companies(id) on delete restrict,
  channel text not null check (channel in ('email', 'whatsapp', 'in_app')),
  notification_type text not null,
  idempotency_key text not null unique,
  recipient text not null,
  payload jsonb not null,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'sent', 'failed', 'cancelled')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  last_error_code text,
  last_error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists document_upload_intents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  case_id uuid references annual_return_cases(id) on delete restrict,
  document_id uuid references documents(id) on delete restrict,
  requested_by_auth_user_id text not null,
  category text not null,
  file_name text not null,
  content_type text not null,
  expected_size_bytes bigint not null check (expected_size_bytes > 0),
  checksum_sha256 text not null,
  object_key text not null unique,
  status text not null default 'created' check (
    status in ('created', 'uploaded', 'quarantined', 'available', 'rejected', 'expired', 'failed')
  ),
  scan_provider_reference text,
  scan_error_code text,
  expires_at timestamptz not null,
  uploaded_at timestamptz,
  scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_items_open_queue_idx
  on work_items (status, sla_due_at, priority desc, id)
  where status in ('open', 'in_progress', 'blocked');

create index if not exists work_items_owner_team_idx
  on work_items (owner_id, team_id, status, sla_due_at);

create index if not exists work_items_sla_threshold_idx
  on work_items (sla_warning_at, sla_due_at)
  where status in ('open', 'in_progress', 'blocked');

create index if not exists assignment_events_work_item_created_idx
  on assignment_events (work_item_id, created_at desc);

create index if not exists escalation_events_work_item_created_idx
  on escalation_events (work_item_id, created_at desc);

create index if not exists notification_outbox_retry_idx
  on notification_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

create index if not exists client_company_memberships_lookup_idx
  on client_company_memberships (auth_user_id, company_id, active);

create index if not exists staff_skills_active_lookup_idx
  on staff_skills (skill_key, active, staff_profile_id);

create index if not exists document_upload_intents_cleanup_idx
  on document_upload_intents (status, expires_at)
  where status in ('created', 'uploaded', 'quarantined');
