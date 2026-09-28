-- T24: only actions backed by actor-scoped single-item services are executable.
-- Document classify/assign/retry remain disabled until an authorized service exists.
alter table bulk_previews drop constraint bulk_previews_action_check;
alter table bulk_previews add constraint bulk_previews_action_check
  check (action in ('assign','caseAssign','clientAssign','tag','reminderDrafts',
    'reconcilePayments','preparePackages','recordSubmissions','matchReturns','importApply'));
alter table bulk_operations drop constraint bulk_operations_action_check;
alter table bulk_operations add constraint bulk_operations_action_check
  check (action in ('assign','caseAssign','clientAssign','tag','reminderDrafts',
    'reconcilePayments','preparePackages','recordSubmissions','matchReturns','importApply'));
