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

create table if not exists work_items (
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
  expires_at timestamptz not null,
  uploaded_at timestamptz,
  scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

create index if not exists document_upload_intents_cleanup_idx
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
  on whatsapp_messages (direction, delivered_at, read_at)
  where direction = 'outbound';
