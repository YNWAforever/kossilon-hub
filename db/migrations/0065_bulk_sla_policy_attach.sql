-- T05: admit only the selected-policy action into the existing durable batch ledger.
-- Preview and item commits continue to use the T09 operation/attempt tables.
alter table bulk_previews drop constraint bulk_previews_action_check;
alter table bulk_previews add constraint bulk_previews_action_check
  check (action in ('assign','caseAssign','clientAssign','tag','reminderDrafts','reconcilePayments','preparePackages','recordSubmissions','matchReturns','attachSlaPolicies','importApply'));
alter table bulk_operations drop constraint bulk_operations_action_check;
alter table bulk_operations add constraint bulk_operations_action_check
  check (action in ('assign','caseAssign','clientAssign','tag','reminderDrafts','reconcilePayments','preparePackages','recordSubmissions','matchReturns','attachSlaPolicies','importApply'));
