-- T09: allow the existing owner-gated scheduler to drain bounded SQL-only bulk work.
alter table maintenance_job_runs drop constraint maintenance_job_runs_job_kind_check;
alter table maintenance_job_runs add constraint maintenance_job_runs_job_kind_check check (job_kind in (
  'evaluateEscalations', 'settleNotificationAttempts', 'redactNotifications',
  'escalateStalledQuarantine', 'runBulkOperations'
));
