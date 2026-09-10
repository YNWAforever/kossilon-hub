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
  escalation_targets jsonb not null default '[]'::jsonb,
  priority_modifier integer not null default 0 check (priority_modifier between -100 and 100),
  effective_from timestamptz not null,
  active boolean not null default true,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_key, version)
);

create table if not exists checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  service_type text not null check (service_type in (
    'Annual Return — Private Ltd', 'Annual Return — Public Ltd',
    'Incorporation — HK Ltd', 'Change of Director', 'Deregistration'
  )),
  description text not null default '',
  active boolean not null default true,
  documents jsonb not null default '[]'::jsonb,
  reminders jsonb not null default '[]'::jsonb,
  risk_rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checklist_templates_service_type_idx
  on checklist_templates (service_type)
  where active;

create table if not exists work_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  case_type text not null check (case_type in ('annual_return', 'corporate_change_request')),
  annual_return_case_id uuid references annual_return_cases(id) on delete restrict,
  corporate_change_request_id uuid references corporate_change_requests(id) on delete restrict,
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
  ),
  constraint work_items_case_reference_check check (
    (case_type = 'annual_return' and annual_return_case_id is not null and corporate_change_request_id is null)
    or (case_type = 'corporate_change_request' and corporate_change_request_id is not null and annual_return_case_id is null)
  )
);

create table if not exists assignment_events (
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
      and jsonb_typeof(recommendation_factors) = 'object'
      and recommendation_factors <> '{}'::jsonb
    )
  )
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
  unique (work_item_id, sla_policy_version_id, threshold),
  constraint escalation_events_acknowledgement_check check (
    (acknowledged_at is null and acknowledged_by_id is null)
    or (acknowledged_at is not null and acknowledged_by_id is not null)
  )
);

create table if not exists notification_outbox (
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
  -- Added by 0022. Records positively whether a provider acknowledged the send or
  -- it was simulated; without it, provider_message_id is null for three unrelated
  -- reasons (never dispatched, redacted, simulated) and the last is readable only
  -- by elimination. Nullable because rows written before 0022 genuinely are
  -- unknown -- a default would hand an auditor a value that looks like evidence.
  delivery text check (delivery is null or delivery in ('provider', 'simulated')),
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

create table if not exists document_upload_intents (
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
  -- from 0023: where the verdict came from. NULL and 'deterministic' both mean
  -- unknown safety, never verified safety.
  scan_verdict_source text
    check (scan_verdict_source is null or scan_verdict_source in ('provider', 'deterministic')),
  -- from 0024: which checklist requirement this upload answers. Nullable, because
  -- an upload that names none is unassigned evidence a person maps rather than a
  -- guess the importer makes.
  checklist_item_id uuid references annual_return_checklist_items(id) on delete set null,
  -- Governs an upload that was never completed. Received files are governed by
  -- quarantine_retention_until instead and are never deleted by the expiry sweep.
  expires_at timestamptz not null,
  -- from 0023: how long received-but-unscanned bytes are held. Reaching it
  -- escalates; it never deletes evidence.
  quarantine_retention_until timestamptz,
  uploaded_at timestamptz,
  scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- from 0023_document_scan_jobs_and_quarantine_retention.sql
-- Durable scan work. Mechanics deliberately mirror notification_outbox: claim
-- with `for update skip locked`, attempt_count incremented at claim and used as
-- a fencing token in every terminal write, exponential backoff, and a
-- visibility timeout that reclaims rows stranded by a Worker killed mid-scan.
create table if not exists document_scan_jobs (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references document_upload_intents(id) on delete restrict,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  reason text not null default 'initial' check (reason in ('initial', 'rescan', 'retry')),
  idempotency_key text not null unique,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'succeeded', 'failed', 'cancelled')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  last_error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_scan_jobs_attempts_check check (attempt_count <= max_attempts)
);

create index if not exists work_items_open_queue_idx
  on work_items ((sla_breached_at is null), sla_due_at, priority desc, id)
  where status in ('open', 'in_progress', 'blocked');

create index if not exists work_items_owner_idx
  on work_items (owner_id, (sla_breached_at is null), sla_due_at, priority desc, id)
  where status in ('open', 'in_progress', 'blocked');

create index if not exists work_items_team_idx
  on work_items (team_id, (sla_breached_at is null), sla_due_at, priority desc, id)
  where status in ('open', 'in_progress', 'blocked');

create index if not exists work_items_sla_warning_idx
  on work_items (sla_warning_at, id)
  where status in ('open', 'in_progress', 'blocked');

create index if not exists work_items_sla_due_idx
  on work_items (sla_due_at, id)
  where status in ('open', 'in_progress', 'blocked');

create index if not exists assignment_events_work_item_created_idx
  on assignment_events (work_item_id, created_at desc);

create index if not exists escalation_events_work_item_created_idx
  on escalation_events (work_item_id, created_at desc);

create index if not exists notification_outbox_retry_idx
  on notification_outbox (next_attempt_at, created_at)
  where status in ('pending', 'failed');

create index if not exists notification_outbox_retention_idx
  on notification_outbox (retention_until)
  where redacted_at is null;

create index if not exists client_company_memberships_lookup_idx
  on client_company_memberships (auth_user_id, company_id, active);

create index if not exists staff_skills_active_lookup_idx
  on staff_skills (skill_key, active, staff_profile_id);

-- 0023 narrowed this predicate. It used to include 'quarantined' -- the status a
-- successfully received file holds -- so the sweep expired received evidence and
-- maintenance.ts deleted its bytes 15 minutes after the intent was created.
create index if not exists document_upload_intents_cleanup_idx
  on document_upload_intents (expires_at)
  where status in ('created', 'uploaded');

-- from 0023
-- from 0024
create index if not exists document_upload_intents_checklist_item_idx
  on document_upload_intents (checklist_item_id)
  where checklist_item_id is not null;

create index if not exists document_upload_intents_quarantine_retention_idx
  on document_upload_intents (quarantine_retention_until)
  where status = 'quarantined';

create index if not exists document_scan_jobs_claim_idx
  on document_scan_jobs (next_attempt_at, updated_at, created_at)
  where status in ('pending', 'failed', 'processing');

create index if not exists document_scan_jobs_intent_idx
  on document_scan_jobs (intent_id, created_at desc);

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

drop trigger if exists work_items_sla_snapshot_immutable on work_items;
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

drop trigger if exists sla_policy_versions_immutable on sla_policies;
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

drop trigger if exists business_calendar_versions_immutable on business_calendars;
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

drop trigger if exists business_calendar_holidays_immutable on business_calendar_holidays;
create trigger business_calendar_holidays_immutable
before insert or update or delete on business_calendar_holidays
for each row execute function enforce_business_calendar_holiday_immutability();

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

-- from 0015_officers_and_shareholdings.sql

create table if not exists officers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  officer_type text not null check (officer_type in ('director', 'secretary', 'designated_representative')),
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
  constraint significant_controllers_due_date_not_before_registered check (
    register_update_due_date is null or register_update_due_date >= registered_date
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
    (status = 'Completed') = (company_id is not null)
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

create table if not exists service_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  service_type text not null check (service_type in (
    'secretary', 'registered_office', 'director_correspondence_address', 'designated_representative'
  )),
  fee integer not null check (fee > 0),
  status text not null default 'Active' check (status in ('Active', 'Cancelled')),
  renewal_date date not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_subscriptions_one_per_type unique (company_id, service_type)
);

create index if not exists service_subscriptions_company_idx on service_subscriptions (company_id);
create index if not exists service_subscriptions_renewal_date_idx on service_subscriptions (renewal_date)
  where status = 'Active';

-- Mirrors annual_return_reminder_events exactly (see its own migration's
-- comment for why this needs to be a permanent record independent of
-- notification_outbox, which redacts rows after retention_until).
create table if not exists service_subscription_reminder_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references service_subscriptions(id) on delete cascade,
  milestone text not null check (milestone in ('1_month', '2_week', '1_week')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (subscription_id, milestone)
);

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
  current_name_en text,
  current_name_zh text,
  new_name_en text,
  new_name_zh text,
  transferor_shareholding_id uuid references shareholdings(id) on delete restrict,
  transferee_shareholding_id uuid references shareholdings(id) on delete restrict,
  transferee_new_shareholder_name text,
  transferee_new_shareholder_address text,
  shares_transferred integer check (shares_transferred > 0),
  consideration numeric(12, 2),
  stamp_duty_amount numeric(10, 2),
  officer_id uuid references officers(id) on delete restrict,
  officer_action text check (officer_action in ('appoint', 'resign', 'detail_change')),
  new_officer_type text check (new_officer_type in ('director', 'secretary')),
  new_officer_name text,
  new_officer_identification_type text check (new_officer_identification_type in ('hkid', 'passport', 'br_number')),
  new_officer_identification_number text,
  new_officer_address text,
  effective_date date,
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

-- ---------------------------------------------------------------------------
-- Reconciled with db/migrations/. schema.sql is a reference document (only
-- db/migrations is ever applied), and it had drifted: these five tables were
-- created by migrations 0003, 0005 and 0007 and queried by the app while being
-- absent here. verify:firm now diffs the two rather than checking four names.
-- ---------------------------------------------------------------------------

-- from 0003_annual_return_audit_events.sql

create table if not exists annual_return_audit_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id),
  company_id uuid not null references companies(id),
  actor_id uuid references users(id),
  actor_role text not null check (actor_role in ('Admin', 'Manager', 'Staff')),
  action text not null,
  result text not null default 'succeeded' check (result in ('succeeded', 'denied', 'failed')),
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists annual_return_audit_events_case_created_idx
  on annual_return_audit_events (case_id, created_at desc);

create index if not exists annual_return_audit_events_actor_created_idx
  on annual_return_audit_events (actor_id, created_at desc);

create index if not exists annual_return_audit_events_action_created_idx
  on annual_return_audit_events (action, created_at desc);

-- from 0012_annual_return_reminder_events.sql

-- evaluateReminders (src/features/annual-return/repository.ts) needs a permanent
-- record of which milestone reminders have already fired per case, independent of
-- notification_outbox — those rows get redacted after retention_until (see
-- redactExpired in src/features/notifications/outbox.ts), so deriving "already
-- sent" from the outbox would silently forget and re-send once a row aged out.
-- Mirrors escalation_events, which solves the identical problem for SLA warnings
-- and breaches.
create table if not exists annual_return_reminder_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id),
  milestone text not null check (milestone in ('1_month', '2_week', '1_week')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (case_id, milestone)
);

-- from 0005_whatsapp_integration_foundation.sql

create table if not exists whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'woztell' check (provider in ('woztell')),
  whatsapp_id text,
  phone_e164 text,
  display_name text,
  company_id uuid references companies(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_contacts_identity_check check (
    whatsapp_id is not null or phone_e164 is not null
  )
);

create unique index if not exists whatsapp_contacts_provider_whatsapp_id_uidx
  on whatsapp_contacts (provider, whatsapp_id)
  where whatsapp_id is not null;

create unique index if not exists whatsapp_contacts_provider_phone_uidx
  on whatsapp_contacts (provider, phone_e164)
  where phone_e164 is not null;

create table if not exists whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'woztell' check (provider in ('woztell')),
  template_name text not null,
  language_code text not null default 'en',
  category text not null check (
    category in ('annual_return', 'payment', 'document', 'signature', 'general')
  ),
  status text not null default 'draft' check (
    status in ('draft', 'active', 'paused', 'archived')
  ),
  body text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists whatsapp_templates_provider_name_language_uidx
  on whatsapp_templates (provider, template_name, language_code);

create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'woztell' check (provider in ('woztell')),
  provider_message_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null check (
    status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')
  ),
  contact_id uuid references whatsapp_contacts(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  case_id uuid references annual_return_cases(id) on delete set null,
  template_id uuid references whatsapp_templates(id) on delete set null,
  phone_e164 text,
  whatsapp_id text,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  sent_by uuid references users(id) on delete set null,
  received_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_messages_inbound_received_at_check check (
    direction <> 'inbound' or received_at is not null
  )
);

create unique index if not exists whatsapp_messages_provider_message_uidx
  on whatsapp_messages (provider, provider_message_id)
  where provider_message_id is not null;

create index if not exists whatsapp_messages_contact_created_idx
  on whatsapp_messages (contact_id, created_at desc);

create index if not exists whatsapp_messages_company_created_idx
  on whatsapp_messages (company_id, created_at desc);

create index if not exists whatsapp_messages_case_created_idx
  on whatsapp_messages (case_id, created_at desc);

create table if not exists whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'woztell' check (provider in ('woztell')),
  provider_event_id text,
  signature_valid boolean not null default false,
  payload jsonb not null,
  normalized_message_id uuid references whatsapp_messages(id) on delete set null,
  processing_status text not null check (
    processing_status in ('received', 'processed', 'ignored', 'failed')
  ),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists whatsapp_webhook_events_provider_event_uidx
  on whatsapp_webhook_events (provider, provider_event_id)
  where provider_event_id is not null;

create index if not exists whatsapp_webhook_events_received_idx
  on whatsapp_webhook_events (received_at desc);

-- from 0007_whatsapp_inbox_ordering_indexes.sql

-- The inbox orders every read by coalesce(sent_at, received_at, created_at): an
-- outbound row carries sent_at once the provider accepts it but is queued with
-- only created_at, and an inbound row never carries sent_at at all because the
-- table's check constraint requires received_at instead.
--
-- whatsapp_messages_contact_created_idx (contact_id, created_at desc) cannot
-- serve that expression, so listConversations fell back to a full scan and sort
-- of the whole table to return one page. coalesce over timestamptz columns is
-- immutable, so the ordering can be indexed directly.

create index if not exists whatsapp_messages_contact_occurred_idx
  on whatsapp_messages (
    contact_id,
    (coalesce(sent_at, received_at, created_at)) desc,
    id desc
  );

-- Serves the latest_case CTE, which walks back to the most recent message that
-- has a case rather than taking the case of the most recent message.
create index if not exists whatsapp_messages_contact_case_occurred_idx
  on whatsapp_messages (
    contact_id,
    (coalesce(sent_at, received_at, created_at)) desc,
    id desc
  )
  where case_id is not null;
-- from 0009_reclaim_stranded_outbox_rows.sql

create index if not exists notification_outbox_stranded_idx
  on notification_outbox (updated_at)
  where status = 'processing';

-- from 0010_index_timeline_and_upload_intent_lookups.sql

create index if not exists timeline_events_company_created_idx
  on timeline_events (company_id, created_at desc);

create index if not exists document_upload_intents_document_idx
  on document_upload_intents (document_id)
  where document_id is not null;

-- from 0011_whatsapp_delivery_receipts.sql

create index if not exists whatsapp_messages_delivery_state_idx
  on whatsapp_messages (delivered_at, read_at)
  where direction = 'outbound';

-- from 0021_whatsapp_session_window_indexes.sql
-- Digits-only comparison indexes for 24-hour session window resolution. The
-- contacts expression must stay character-identical to the query in
-- lastInboundAtForPhoneDigits or the planner will not use it.
create index if not exists whatsapp_contacts_phone_digits_idx
  on whatsapp_contacts ((regexp_replace(coalesce(phone_e164, whatsapp_id), '[^0-9]', '', 'g')));

create index if not exists whatsapp_messages_inbound_received_idx
  on whatsapp_messages (contact_id, received_at desc)
  where direction = 'inbound';

-- from 0025_nar_import_staging.sql
-- 0025: staging for the monthly NAR workbook import.
--
-- Nothing here writes a company or a case. That is the point.
--
-- `companies` requires cr_number, br_number, incorporation_date,
-- annual_return_basis_date, registered_office, company_secretary,
-- assigned_owner_id and assigned_team_id -- all NOT NULL, and the two registry
-- numbers globally unique. The workbook supplies a client id and a name. A
-- fabricated BR number would permanently burn a value the real one later needs,
-- so an unmatched row stages here and waits for a person instead.
--
-- `payments` is the same shape of trap from the other direction: unique(case_id)
-- and amount NOT NULL CHECK (amount > 0), and a case with no payment row renders
-- normally on the board but can never be advanced -- staff hit "Annual return
-- payment not found." with no UI anywhere to create one. The workbook has
-- invoice numbers and no amounts, so the importer records the invoice
-- observation here and the apply step asks a human for the fee.

-- The identity column that did not exist. A repo-wide grep for
-- external_ref|external_id|source_system|client_code returned nothing, so a
-- per-firm client code from the spreadsheet had nowhere to land and a second
-- import could not re-identify the row the first one created.
create table if not exists company_external_references (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  source_system text not null,
  external_client_id text not null,
  -- Who confirmed the mapping, and when. A mapping is a human judgement about
  -- which company a client code means, and it is worth being able to ask who.
  mapped_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One external id means one company, within its source system. Without this a
  -- second import could quietly attach the same client code to a second company.
  unique (source_system, external_client_id)
);

create index if not exists company_external_references_company_idx
  on company_external_references (company_id);

create table if not exists nar_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'nar-monthly-workbook',
  source_file_name text not null,
  -- The exact bytes, so a batch can be tied back to the file it came from and a
  -- re-upload of the same file is recognised rather than duplicated.
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_size_bytes bigint not null check (source_size_bytes > 0),
  sheet_name text not null,
  -- Which reader produced the parsed values. A later parser fix changes what a
  -- row means, and without this there is no way to tell which rows predate it.
  parser_version text not null,
  -- The operating period staff chose. Null until they do: the supplied sheet is
  -- named "8.2025" and historical, and reading a period out of a sheet name
  -- would be a guess that silently activates the wrong year's cases.
  period_year integer check (period_year is null or period_year between 1900 and 2100),
  period_month integer check (period_month is null or period_month between 1 and 12),
  status text not null default 'pending_review' check (
    status in ('pending_review', 'applying', 'applied', 'cancelled', 'failed')
  ),
  row_count integer not null default 0 check (row_count >= 0),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  -- Re-importing the same bytes finds the same batch instead of making a second
  -- one. Per sheet, because one workbook legitimately carries a sheet per month.
  unique (source_sha256, sheet_name)
);

create index if not exists nar_import_batches_status_idx
  on nar_import_batches (status, created_at desc);

create table if not exists nar_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references nar_import_batches(id) on delete cascade,
  -- The sheet row, not an ordinal. Column A of the supplied worksheet is a row
  -- number that has a single space on one row, so it is never an identity.
  row_number integer not null check (row_number > 0),
  external_client_id text not null,
  company_name text not null,
  -- Every cell verbatim, with its OOXML type and date-formatted flag, so a
  -- mapping decision can be revisited without re-reading the file.
  raw jsonb not null,
  -- The normalized candidates, with explicit unknowns. A day and month with no
  -- year stays a day and month with no year.
  parsed jsonb not null,
  issues jsonb not null default '[]'::jsonb,
  disposition text not null check (
    disposition in ('new', 'updated', 'unchanged', 'conflict', 'invalid', 'needs_company_mapping')
  ),
  matched_company_id uuid references companies(id) on delete set null,
  matched_case_id uuid references annual_return_cases(id) on delete set null,
  -- Row-level apply results, so an interrupted batch resumes instead of
  -- restarting and a partial success is never presented as all applied.
  applied_at timestamptz,
  applied_case_id uuid references annual_return_cases(id) on delete set null,
  apply_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, row_number)
);

create index if not exists nar_import_rows_batch_disposition_idx
  on nar_import_rows (batch_id, disposition, row_number);

-- Finds every staged row still waiting on a company mapping, across batches.
create index if not exists nar_import_rows_unmapped_idx
  on nar_import_rows (external_client_id)
  where disposition = 'needs_company_mapping';

-- from 0026_case_parties_and_requirement_instances.sql
-- 0026: who a requirement applies to, and which pages answer it.
--
-- `annual_return_checklist_items` is one row per requirement per case, with a
-- single `document_id`. That shape cannot express the thing this firm actually
-- does: two directors need two identity documents, and one row with one document
-- column has no way to say that the second one is missing. Five uploaded files
-- containing duplicates and no CDD look, to that model, like plenty.
--
-- These three tables extend the checklist rather than replace it. Every
-- requirement instance points at the checklist item it refines, so
-- hasRequiredChecklistEvidence, the board metrics, the completion blockers and
-- every existing read keep working on exactly the rows they always did. Nothing
-- here is a second, competing checklist authority.
--
-- Parties reference `officers` where the person is already known to the company.
-- Duplicating names into a new table would have created two spellings of the same
-- director and no way to tell which was current.

create table if not exists case_parties (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  -- Set when this party is a company officer already on file. Null for a party
  -- the officer register does not carry -- a corporate shareholder, say -- which
  -- is real and must not be forced into the officer table to be representable.
  officer_id uuid references officers(id) on delete restrict,
  party_type text not null check (
    party_type in (
      'director', 'secretary', 'designated_representative', 'shareholder', 'company', 'other'
    )
  ),
  display_name text not null,
  -- Confirmation is a human act. An unconfirmed party is a candidate, and a
  -- requirement must never be judged complete or incomplete against a guess
  -- about who the parties are.
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists case_parties_case_idx on case_parties (case_id, active);

-- One row per officer per case. Partial, because officer_id is null for parties
-- the officer register does not carry and several of those on one case is normal.
create unique index if not exists case_parties_case_officer_uidx
  on case_parties (case_id, officer_id)
  where officer_id is not null;

create table if not exists case_requirement_instances (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  -- The checklist row this refines. The existing item stays the authority for
  -- the case's overall state; this says who it applies to.
  checklist_item_id uuid not null references annual_return_checklist_items(id) on delete cascade,
  -- Null means the requirement is about the company rather than a person -- an
  -- NAR1 is not owed by a director.
  party_id uuid references case_parties(id) on delete cascade,
  requirement_key text not null,
  -- Which version of the approved template produced this. A rule change makes a
  -- new instance rather than editing an old one, so a decision recorded under
  -- the previous rule stays legible as a decision under the previous rule.
  template_version text not null,
  applicability text not null default 'required' check (
    applicability in ('required', 'not_applicable', 'waived')
  ),
  applicability_reason text,
  -- For age-limited evidence such as address proof: the date the age is measured
  -- from. Null where the requirement has no such rule; never defaulted to today,
  -- which would silently re-age every document each time it was read.
  reference_date date,
  -- A waiver is somebody's decision and is attributable.
  authorized_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_requirement_waiver_needs_reason check (
    applicability = 'required' or applicability_reason is not null
  )
);

create index if not exists case_requirement_instances_case_idx
  on case_requirement_instances (case_id);

create index if not exists case_requirement_instances_item_idx
  on case_requirement_instances (checklist_item_id);

-- One instance per party per checklist item, and exactly one company-level
-- instance per item. Split in two because a plain unique constraint treats every
-- NULL party_id as distinct, which would let an item collect any number of
-- company-level instances.
create unique index if not exists case_requirement_instances_party_uidx
  on case_requirement_instances (checklist_item_id, party_id)
  where party_id is not null;

create unique index if not exists case_requirement_instances_company_uidx
  on case_requirement_instances (checklist_item_id)
  where party_id is null;

create table if not exists requirement_evidence_links (
  id uuid primary key default gen_random_uuid(),
  requirement_instance_id uuid not null
    references case_requirement_instances(id) on delete cascade,
  -- on delete restrict: the link is the record of why a document was accepted,
  -- and losing it silently would leave a satisfied requirement with no evidence.
  document_id uuid not null references documents(id) on delete restrict,
  -- A single PDF can answer several requirements from different pages. Null means
  -- the whole document.
  page_from integer check (page_from is null or page_from >= 1),
  page_to integer check (page_to is null or page_from is null or page_to >= page_from),
  linked_by uuid references users(id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists requirement_evidence_links_instance_idx
  on requirement_evidence_links (requirement_instance_id);

create index if not exists requirement_evidence_links_document_idx
  on requirement_evidence_links (document_id);

-- coalesce, because the plain tuple would treat two whole-document links as
-- distinct and let the same file be attached to one requirement repeatedly.
create unique index if not exists requirement_evidence_links_uidx
  on requirement_evidence_links (
    requirement_instance_id, document_id, coalesce(page_from, 0), coalesce(page_to, 0)
  );

-- from 0027_document_versions.sql
create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  version_number integer not null check (version_number >= 1),

  -- What the uploader said the bytes would be, from the intent. A claim.
  declared_checksum_sha256 text
    check (declared_checksum_sha256 is null or declared_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  declared_byte_size bigint check (declared_byte_size is null or declared_byte_size > 0),

  -- What the stored bytes actually hash to, computed server-side over the object
  -- in R2. NULL means nobody has looked. That is the true state of every row
  -- today, and it is left visible rather than backfilled from the declared value
  -- -- copying a claim into a column named `verified` is how an unverifiable
  -- document ends up in a signed manifest.
  verified_checksum_sha256 text
    check (verified_checksum_sha256 is null or verified_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  verified_byte_size bigint check (verified_byte_size is null or verified_byte_size >= 0),
  verified_at timestamptz,

  -- Nullable: known only from the intent. Deliberately not defaulted from
  -- documents.file_type, which despite its name holds the requirement category
  -- ('identity', 'registry', 'payment', ...) and not a MIME type. There is no
  -- 'address-proof' category; DOCUMENT_CATEGORIES is the vocabulary.
  content_type text,
  file_name text not null,
  storage_url text not null,

  intent_id uuid references document_upload_intents(id) on delete restrict,

  -- Forward pointer, so "the current version" is one indexable predicate rather
  -- than a not-exists over the whole chain.
  superseded_by_version_id uuid references document_versions(id) on delete restrict,
  superseded_at timestamptz,
  superseded_reason text,

  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),

  -- A version is either current or superseded. Without this, "current" quietly
  -- depends on which of the two columns the reader happened to check.
  constraint document_versions_supersede_agrees check (
    (superseded_by_version_id is null and superseded_at is null)
    or (superseded_by_version_id is not null and superseded_at is not null)
  ),
  constraint document_versions_no_self_supersede check (superseded_by_version_id <> id),
  constraint document_versions_verified_pair check (
    (verified_checksum_sha256 is null and verified_at is null)
    or (verified_checksum_sha256 is not null and verified_at is not null)
  )
);

create unique index if not exists document_versions_number_uidx
  on document_versions (document_id, version_number);

-- Exactly one current version per document, enforced rather than assumed by the
-- code that reads it.
create unique index if not exists document_versions_current_uidx
  on document_versions (document_id)
  where superseded_by_version_id is null;

-- One upload produces at most one version.
create unique index if not exists document_versions_intent_uidx
  on document_versions (intent_id)
  where intent_id is not null;

create index if not exists document_versions_verified_checksum_idx
  on document_versions (verified_checksum_sha256)
  where verified_checksum_sha256 is not null;

-- Extracted text lives in its own table so that a version row is written once,
-- at upload, and never rewritten by an analysis run. An extraction pass that
-- could touch the version row could touch storage_url or a checksum with it;
-- this makes that structurally impossible rather than a rule to remember.
create table if not exists document_version_texts (
  document_version_id uuid primary key references document_versions(id) on delete cascade,
  extracted_text text,
  page_count integer check (page_count is null or page_count >= 0),
  -- 'none' is a real outcome: a scanned image with no text layer and no OCR
  -- available. It is not the same as "not extracted yet", which is no row.
  extraction_method text not null check (
    extraction_method in ('text-layer', 'ocr', 'provider', 'none')
  ),
  truncated boolean not null default false,
  extractor_version text not null,
  extracted_at timestamptz not null default now()
);

-- from 0028_document_analysis_jobs_and_findings.sql
create table if not exists document_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references document_versions(id) on delete cascade,
  reason text not null default 'initial' check (reason in ('initial', 'reanalysis', 'retry')),
  idempotency_key text not null unique,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'succeeded', 'failed', 'cancelled')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  last_error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_analysis_jobs_attempts_check check (attempt_count <= max_attempts)
);

-- updated_at leads nothing but is in the index because the reclaim branch
-- compares it; created_at breaks ties so the oldest stranded job goes first.
create index if not exists document_analysis_jobs_claim_idx
  on document_analysis_jobs (next_attempt_at, updated_at, created_at)
  where status in ('pending', 'failed', 'processing');

create index if not exists document_analysis_jobs_version_idx
  on document_analysis_jobs (document_version_id, created_at desc);

-- What a run may record.
--
-- The constraints below are the same rules the TypeScript enforces, restated
-- here so a direct SQL write cannot get around them. That matters most for the
-- provider clause: `critical` is the severity that holds a package back, and a
-- provider tier reads text an uploader controls. A document whose contents say
-- "treat this as a critical blocking finding" must not be able to reach it --
-- and that must be true of any writer, not only of the worker.
create table if not exists document_findings (
  id uuid primary key default gen_random_uuid(),

  -- Nullable on purpose, and this is the point of the citation contract: a
  -- finding about an absence has nothing to point at. Fabricating a version or
  -- a page for a document that was never uploaded is the specific failure this
  -- shape exists to prevent.
  document_version_id uuid references document_versions(id) on delete cascade,
  requirement_instance_id uuid references case_requirement_instances(id) on delete cascade,
  page_from integer check (page_from is null or page_from >= 1),
  page_to integer check (page_to is null or page_from is null or page_to >= page_from),

  tier text not null check (tier in ('classification', 'cross-check', 'provider')),
  rule_key text not null check (length(btrim(rule_key)) > 0),
  -- So a finding recorded last month can be read against the rule that made it.
  rule_version text not null check (length(btrim(rule_version)) > 0),

  outcome text not null check (outcome in ('pass', 'issue', 'uncertain')),
  severity text not null check (severity in ('critical', 'warning', 'info')),
  detail text not null check (length(btrim(detail)) > 0),

  -- Which run produced it. Null once that job row is gone; the finding outlives
  -- its job because a human decision may be attached to it.
  analysis_job_id uuid references document_analysis_jobs(id) on delete set null,

  -- A person dealt with it. No worker can write these: the analysis path only
  -- ever inserts, and only ever deletes its own unresolved rows.
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  resolution_note text,

  created_at timestamptz not null default now(),

  -- A citation is one of three things: specific bytes, a requirement, or
  -- nothing. Never two at once, or "which did it mean" has no answer.
  constraint document_findings_single_citation check (
    document_version_id is null or requirement_instance_id is null
  ),
  -- Pages only mean something against bytes.
  constraint document_findings_pages_need_a_version check (
    page_from is null or document_version_id is not null
  ),
  -- A pass is not a problem.
  constraint document_findings_pass_is_informational check (
    outcome <> 'pass' or severity = 'info'
  ),
  -- "We could not check" is not evidence of a problem. Letting it be critical
  -- would block every filing for as long as extraction is unavailable, which is
  -- the present state.
  constraint document_findings_uncertain_is_not_critical check (
    outcome <> 'uncertain' or severity <> 'critical'
  ),
  -- The prompt-injection defence, in the database.
  constraint document_findings_provider_is_advisory check (
    tier <> 'provider' or severity <> 'critical'
  ),
  constraint document_findings_resolution_agrees check (
    (resolved_by is null and resolved_at is null)
    or (resolved_by is not null and resolved_at is not null)
  )
);

create index if not exists document_findings_version_idx
  on document_findings (document_version_id)
  where document_version_id is not null;

create index if not exists document_findings_requirement_idx
  on document_findings (requirement_instance_id)
  where requirement_instance_id is not null;

-- The reviewer's queue and the manifest's blocker check: open problems only.
create index if not exists document_findings_open_issue_idx
  on document_findings (document_version_id, severity)
  where resolved_by is null and outcome = 'issue';
