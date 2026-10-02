-- Local release candidate only; this does not activate any scheduler.
set local lock_timeout = '5s';
lock table maintenance_job_runs in share row exclusive mode;
create temporary table bulk_kind_before (job_kind text check(job_kind in ('evaluateEscalations','settleNotificationAttempts','redactNotifications','escalateStalledQuarantine'))) on commit drop;
create temporary table bulk_kind_after (job_kind text check(job_kind in ('evaluateEscalations','settleNotificationAttempts','redactNotifications','escalateStalledQuarantine','runBulkAssignments'))) on commit drop;
do $$
declare current_name text; current_def text; before_def text; after_def text; checks integer;
begin
 select count(*),min(conname),min(pg_get_constraintdef(oid)) into checks,current_name,current_def
 from pg_constraint where conrelid='maintenance_job_runs'::regclass and contype='c'
 and conkey=array[(select attnum from pg_attribute where attrelid='maintenance_job_runs'::regclass and attname='job_kind')]::smallint[];
 select pg_get_constraintdef(oid) into before_def from pg_constraint where conrelid='bulk_kind_before'::regclass and contype='c';
 select pg_get_constraintdef(oid) into after_def from pg_constraint where conrelid='bulk_kind_after'::regclass and contype='c';
 if checks<>1 or current_def not in (before_def,after_def) then
  raise exception 'Unrecognized maintenance job-kind contract; preserve data and review';
 end if;
 if current_def=before_def then
  execute format('alter table maintenance_job_runs drop constraint %I',current_name);
  alter table maintenance_job_runs add constraint maintenance_job_runs_job_kind_check check(job_kind in ('evaluateEscalations','settleNotificationAttempts','redactNotifications','escalateStalledQuarantine','runBulkAssignments'));
 end if;
end $$;
