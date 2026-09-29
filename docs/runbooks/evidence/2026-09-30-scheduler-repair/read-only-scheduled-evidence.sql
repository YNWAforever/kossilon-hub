-- Run inside a read-only transaction on the explicitly named Neon target.
-- Metadata/counts/digests only; no recipients, document bytes or credentials.
select jsonb_build_object(
  'database', current_database(),
  'ledgerCount', (select count(*) from schema_migrations),
  'runs', (select coalesce(jsonb_agg(to_jsonb(r) order by scheduled_for), '[]'::jsonb) from (
    select id, scheduled_for, started_at, finished_at, duration_ms, outcome,
           trigger_source, passes, failed_passes
    from maintenance_runs
    where scheduled_for >= '2026-09-29T16:30:00Z'
    order by scheduled_for
  ) r),
  'jobs', (select coalesce(jsonb_agg(to_jsonb(j) order by scheduled_for, job_kind), '[]'::jsonb) from (
    select id, scheduled_for, job_kind, trigger_source, run_id, state, started_at, finished_at
    from maintenance_job_runs
    where scheduled_for >= '2026-09-29T16:30:00Z'
  ) j),
  'historicalJobs', (select jsonb_build_object(
    'count', count(*), 'row_digest', md5(coalesce(jsonb_agg(to_jsonb(h) order by id)::text, '[]')))
    from maintenance_job_runs h where scheduled_for < '2026-09-29T16:30:00Z'),
  'outbox', (select jsonb_build_object(
    'count', count(*), 'row_digest', md5(coalesce(jsonb_agg(to_jsonb(o) order by id)::text, '[]')))
    from notification_outbox o),
  'outboxStatuses', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from (
    select status, count(*)::int as count from notification_outbox group by status order by status
  ) s),
  'bulkOperations', (select count(*) from bulk_operations),
  'narStageJobs', (select count(*) from nar_import_stage_jobs)
) as evidence;
