-- Phase F: the scheduled tick leaves a trace.
--
-- `wrangler.template.jsonc` declares a 5-minute cron, the nitro plugin fires
-- `runScheduledMaintenanceForWorker`, nine passes run, and the entire record of
-- it is one `console.log` into the Cloudflare log stream. That stream is
-- ephemeral, needs a person to go and look at it, and is not readable by the
-- product.
--
-- So if the cron stops firing -- or, under BLOCKED_INTEGRATION:
-- deployment-runtime, if the hook never registers on the deployed runtime and it
-- never fires at all -- SLA escalations are never evaluated, reminders are never
-- evaluated, the outbox is never dispatched, quarantined documents are never
-- scanned, and every screen still looks completely normal, because every screen
-- reads tables a human writes to. The first real signal is a missed statutory
-- deadline.
--
-- This table is what "record last-success and lag" (plan F2) needs to exist in.

create table if not exists maintenance_runs (
  id uuid primary key default gen_random_uuid(),

  -- The tick the trigger asked for, distinct from when the work actually
  -- started. A runtime that fires late is a different fault from one that runs
  -- slowly, and merging the two would hide both.
  scheduled_for timestamptz not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),

  -- Three states, not two.
  --   succeeded -- every pass ran.
  --   partial   -- the run completed and named which passes threw. This is the
  --                state MaintenancePassesFailedError already models: eight
  --                passes' findings survive alongside the ninth's failure.
  --   failed    -- the run did not get far enough to have passes, so
  --                failed_passes is legitimately empty.
  outcome text not null check (outcome in ('succeeded', 'partial', 'failed')),

  -- The whole ScheduledMaintenanceResult, not a handful of columns somebody
  -- guessed at in advance. A pass added later is recorded without a migration,
  -- and `null` inside it keeps meaning "this pass produced no information",
  -- which is the distinction from `0` that the result type exists to preserve.
  --
  -- Nullable, and the constraint below says when. This was `not null`, which
  -- made a `failed` run -- one that died before it had any passes -- impossible
  -- to insert: the write threw, the recorder swallowed it, and the row was lost.
  -- That is precisely the run this table was reordered to capture. CI found it
  -- the first time the insert ran against a real Postgres.
  passes jsonb,

  failed_passes text[] not null default '{}',
  -- Message only, never a thrown value: a maintenance failure can carry a
  -- provider payload or a connection string, and this row is read by a screen.
  failure_summary text,

  -- Which trigger produced this run, so a lost cron can be told apart from a
  -- deployment nobody has invoked. An operator running the entrypoint by hand
  -- must not make the schedule look alive.
  trigger_source text not null default 'scheduled'
    check (trigger_source in ('scheduled', 'manual')),

  created_at timestamptz not null default now(),

  constraint maintenance_runs_finished_after_started check (finished_at >= started_at),

  -- A run cannot claim success while naming passes that threw, and cannot claim
  -- `partial` without naming them -- otherwise "which passes failed" has two
  -- answers that can disagree. `failed` is deliberately unconstrained: a run
  -- that died before assembling its passes has none to name.
  constraint maintenance_runs_outcome_agrees check (
    (outcome = 'succeeded' and cardinality(failed_passes) = 0)
    or (outcome = 'partial' and cardinality(failed_passes) > 0)
    or outcome = 'failed'
  ),

  -- A run that reached its passes must record them. Only `failed` may have none,
  -- because only `failed` never got that far. This keeps the guarantee where it
  -- means something instead of dropping it for every row.
  constraint maintenance_runs_passes_present check (
    (outcome in ('succeeded', 'partial') and passes is not null)
    or outcome = 'failed'
  )
);

-- The health read is always "the most recent runs", so this index is the whole
-- access pattern rather than a speculative one.
create index if not exists maintenance_runs_recent_idx
  on maintenance_runs (scheduled_for desc);

-- Note on what this table can and cannot detect.
--
-- A run that cannot reach Postgres cannot write a row saying so: the record
-- lives in the thing that broke. That is why the health rule is built on the
-- ABSENCE of a recent row rather than on the presence of a failed one -- silence
-- is the signal, and a `failed` row is a bonus. An empty table therefore means
-- "never observed running", which is emphatically not the same as "healthy", and
-- is this deployment's actual state today.
