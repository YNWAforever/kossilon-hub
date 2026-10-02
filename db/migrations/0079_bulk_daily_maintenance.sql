-- Add actions to the existing durable jobs; no scheduler activation or historical rewrites.
set local lock_timeout = '5s';
alter table bulk_selection_snapshots drop constraint bulk_selection_snapshots_resource_check;
alter table bulk_selection_snapshots add constraint bulk_selection_snapshots_resource_check check(resource in ('annual_return_case','work_item','client_company','document'));
alter table bulk_operation_previews drop constraint bulk_operation_previews_resource_check;
alter table bulk_operation_previews add constraint bulk_operation_previews_resource_check check(resource in ('annual_return_case','work_item','client_company','document'));
alter table bulk_operation_jobs drop constraint bulk_operation_jobs_resource_check;
alter table bulk_operation_jobs add constraint bulk_operation_jobs_resource_check check(resource in ('annual_return_case','work_item','client_company','document'));
alter table bulk_operation_previews add column action_key text not null default 'assignment' check(action_key in ('assignment','client_maintenance','document_assignment','document_return_draft','document_list_export','follow_up_draft','payment_list_export'));
alter table bulk_operation_jobs add column action_key text not null default 'assignment' check(action_key in ('assignment','client_maintenance','document_assignment','document_return_draft','document_list_export','follow_up_draft','payment_list_export'));
