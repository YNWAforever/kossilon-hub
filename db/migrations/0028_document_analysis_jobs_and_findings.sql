-- Phase C-2: durable analysis work, and what an analysis run is allowed to say.
--
-- The job table is document_scan_jobs (migration 0023) with a different payload
-- and nothing else changed: claim with `for update skip locked`, attempt_count
-- incremented at claim and used as a fencing token in every terminal write,
-- exponential backoff, and a visibility timeout that reclaims rows stranded by a
-- Worker killed mid-run. That pattern is proven twice here; a third variant
-- would be the mistake.
--
-- It is keyed on a document VERSION rather than an upload intent, because that
-- is what a finding cites and what an approval names. A replacement upload gets
-- its own version and therefore its own job, rather than colliding with the
-- analysis of the bytes it replaced.

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
