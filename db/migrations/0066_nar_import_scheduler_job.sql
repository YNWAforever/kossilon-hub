-- Admit the existing live NAR staging worker without changing any job evidence.
-- The migrator wraps this file and its ledger entry in one transaction.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table maintenance_job_runs
  drop constraint maintenance_job_runs_job_kind_check;
alter table maintenance_job_runs
  add constraint maintenance_job_runs_job_kind_check check (job_kind in (
    'evaluateEscalations',
    'settleNotificationAttempts',
    'redactNotifications',
    'escalateStalledQuarantine',
    'runBulkOperations',
    'drainInboundMediaDownloads',
    'runNarImportStageJobs'
  ));
