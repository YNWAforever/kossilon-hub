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
  escalation_targets jsonb not null default '[]'::jsonb,
  priority_modifier integer not null default 0 check (priority_modifier between -100 and 100),
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
  required_skill_key text,
  title text not null,
  status text not null default 'open' check (
    status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled')
  ),
  escalation_state text not null default 'none' check (escalation_state in ('none', 'warning', 'breach', 'acknowledged')),
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
  updated_at timestamptz not null default now(),
  constraint work_items_sla_order_check check (
    sla_started_at <= sla_warning_at and sla_warning_at < sla_due_at
  ),
  constraint work_items_completion_state_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create table assignment_events (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references work_items(id) on delete restrict,
  previous_assignee_id uuid references users(id) on delete restrict,
  assigned_to_id uuid not null references users(id) on delete restrict,
  assigned_by_id uuid not null references users(id) on delete restrict,
  recommendation_rank integer check (recommendation_rank > 0),
  recommendation_score numeric(10, 4),
  recommendation_factors jsonb not null default '{}'::jsonb,
  decision text not null check (decision in ('accepted_recommendation', 'override', 'manual')),
  override_reason text,
  expected_version integer not null check (expected_version > 0),
  created_at timestamptz not null default now(),
  constraint assignment_events_override_reason_check check (
    decision <> 'override' or nullif(btrim(override_reason), '') is not null
  ),
  constraint assignment_events_recommendation_evidence_check check (
    decision = 'manual'
    or (recommendation_rank is not null and recommendation_score is not null
      and recommendation_factors <> '{}'::jsonb)
  )
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
  unique (work_item_id, sla_policy_version_id, threshold),
  constraint escalation_events_acknowledgement_check check (
    (acknowledged_at is null and acknowledged_by_id is null)
    or (acknowledged_at is not null and acknowledged_by_id is not null)
  )
);

create table notification_outbox (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid references work_items(id) on delete restrict,
  company_id uuid not null references companies(id) on delete restrict,
  channel text not null check (channel in ('email', 'whatsapp', 'in_app')),
  notification_type text not null,
  idempotency_key text not null unique,
  recipient text,
  payload jsonb,
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
  retention_until timestamptz not null default (now() + interval '90 days'),
  redacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_outbox_attempts_check check (attempt_count <= max_attempts),
  constraint notification_outbox_redaction_check check (
    (redacted_at is null and recipient is not null and payload is not null)
    or (
      redacted_at is not null and recipient is null and payload is null
      and provider_message_id is null and last_error_code is null
      and last_error_message is null
    )
  )
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
  expected_size_bytes bigint not null check (
    expected_size_bytes > 0 and expected_size_bytes <= 104857600
  ),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
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
  on work_items (sla_breached_at desc nulls last, sla_due_at, priority desc, id)
  where status in ('open', 'in_progress', 'blocked');

create index work_items_owner_idx
  on work_items (owner_id, sla_breached_at desc nulls last, sla_due_at, priority desc, id)
  where status in ('open', 'in_progress', 'blocked');

create index work_items_team_idx
  on work_items (team_id, sla_breached_at desc nulls last, sla_due_at, priority desc, id)
  where status in ('open', 'in_progress', 'blocked');

create index work_items_sla_warning_idx
  on work_items (sla_warning_at, id)
  where status in ('open', 'in_progress', 'blocked');

create index work_items_sla_due_idx
  on work_items (sla_due_at, id)
  where status in ('open', 'in_progress', 'blocked');

create index assignment_events_work_item_created_idx
  on assignment_events (work_item_id, created_at desc);

create index escalation_events_work_item_created_idx
  on escalation_events (work_item_id, created_at desc);

create index notification_outbox_retry_idx
  on notification_outbox (next_attempt_at, created_at)
  where status in ('pending', 'failed');

create index notification_outbox_retention_idx
  on notification_outbox (retention_until)
  where redacted_at is null;

create index client_company_memberships_lookup_idx
  on client_company_memberships (auth_user_id, company_id, active);

create index staff_skills_active_lookup_idx
  on staff_skills (skill_key, active, staff_profile_id);

create index document_upload_intents_cleanup_idx
  on document_upload_intents (expires_at)
  where status in ('created', 'uploaded', 'quarantined');

create or replace function enforce_work_item_sla_snapshot_immutability()
returns trigger language plpgsql as $$
begin
  if old.sla_policy_version_id is distinct from new.sla_policy_version_id
    or old.sla_started_at is distinct from new.sla_started_at
    or old.sla_warning_at is distinct from new.sla_warning_at
    or old.sla_due_at is distinct from new.sla_due_at then
    raise exception 'Work item SLA snapshots are immutable';
  end if;
  if old.sla_breached_at is not null
    and old.sla_breached_at is distinct from new.sla_breached_at then
    raise exception 'Work item breach timestamps are write-once';
  end if;
  return new;
end
$$;

create trigger work_items_sla_snapshot_immutable
before update on work_items
for each row execute function enforce_work_item_sla_snapshot_immutability();

create or replace function enforce_sla_policy_version_immutability()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'SLA policy versions cannot be deleted';
  end if;
  if old.policy_key is distinct from new.policy_key
    or old.version is distinct from new.version
    or old.name is distinct from new.name
    or old.work_type is distinct from new.work_type
    or old.business_calendar_id is distinct from new.business_calendar_id
    or old.warning_minutes is distinct from new.warning_minutes
    or old.due_minutes is distinct from new.due_minutes
    or old.escalation_targets is distinct from new.escalation_targets
    or old.priority_modifier is distinct from new.priority_modifier
    or old.effective_from is distinct from new.effective_from
    or old.created_by is distinct from new.created_by then
    raise exception 'SLA policy versions are immutable';
  end if;
  return new;
end
$$;

create trigger sla_policy_versions_immutable
before update or delete on sla_policies
for each row execute function enforce_sla_policy_version_immutability();

create or replace function enforce_business_calendar_version_immutability()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Business calendar versions cannot be deleted';
  end if;
  if old.name is distinct from new.name
    or old.timezone is distinct from new.timezone
    or old.version is distinct from new.version
    or old.weekly_schedule is distinct from new.weekly_schedule
    or old.effective_from is distinct from new.effective_from
    or old.created_by is distinct from new.created_by then
    raise exception 'Business calendar versions are immutable';
  end if;
  return new;
end
$$;

create trigger business_calendar_versions_immutable
before update or delete on business_calendars
for each row execute function enforce_business_calendar_version_immutability();

create or replace function enforce_business_calendar_holiday_immutability()
returns trigger language plpgsql as $$
declare
  calendar_id uuid;
begin
  if tg_op = 'DELETE' then
    calendar_id := old.business_calendar_id;
  else
    calendar_id := new.business_calendar_id;
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from sla_policies
    where business_calendar_id = old.business_calendar_id
  ) then
    raise exception 'Holidays for the previous calendar version are immutable';
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from business_calendar_holidays
    where business_calendar_id = new.business_calendar_id
      and holiday_date = new.holiday_date
      and label = new.label
      and closed = new.closed
      and working_intervals is not distinct from new.working_intervals
  ) then
    return null;
  end if;
  if exists (select 1 from sla_policies where business_calendar_id = calendar_id) then
    raise exception 'Holidays for a referenced calendar version are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger business_calendar_holidays_immutable
before insert or update or delete on business_calendar_holidays
for each row execute function enforce_business_calendar_holiday_immutability();
