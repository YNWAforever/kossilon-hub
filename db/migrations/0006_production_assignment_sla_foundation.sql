create table staff_profiles (
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

create table staff_skills (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references staff_profiles(id) on delete restrict,
  skill_key text not null,
  proficiency integer not null default 1 check (proficiency between 1 and 5),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_profile_id, skill_key)
);

create table client_company_memberships (
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

create table business_calendars (
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

create table business_calendar_holidays (
  id uuid primary key default gen_random_uuid(),
  business_calendar_id uuid not null references business_calendars(id) on delete restrict,
  holiday_date date not null,
  label text not null,
  closed boolean not null default true,
  working_intervals jsonb,
  created_at timestamptz not null default now(),
  unique (business_calendar_id, holiday_date)
);

create table sla_policies (
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

create table work_items (
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

create table assignment_events (
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

create table escalation_events (
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

create table notification_outbox (
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

create table document_upload_intents (
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

create index work_items_open_queue_idx
  on work_items (status, sla_due_at, priority desc, id)
  where status in ('open', 'in_progress', 'blocked');

create index work_items_owner_team_idx
  on work_items (owner_id, team_id, status, sla_due_at);

create index work_items_sla_threshold_idx
  on work_items (sla_warning_at, sla_due_at)
  where status in ('open', 'in_progress', 'blocked');

create index assignment_events_work_item_created_idx
  on assignment_events (work_item_id, created_at desc);

create index escalation_events_work_item_created_idx
  on escalation_events (work_item_id, created_at desc);

create index notification_outbox_retry_idx
  on notification_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

create index client_company_memberships_lookup_idx
  on client_company_memberships (auth_user_id, company_id, active);

create index staff_skills_active_lookup_idx
  on staff_skills (skill_key, active, staff_profile_id);

create index document_upload_intents_cleanup_idx
  on document_upload_intents (status, expires_at)
  where status in ('created', 'uploaded', 'quarantined');
