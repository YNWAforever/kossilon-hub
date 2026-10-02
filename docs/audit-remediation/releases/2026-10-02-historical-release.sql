-- OFFLINE REVIEW PACKAGE. No authority to execute against a hosted database.
-- Never feed this divergent history into db:migrate. Existing66 receipts remain unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='2min';
SET LOCAL search_path=public;
SELECT pg_advisory_xact_lock(hashtext('kossilon:schema-migrations'));
LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $historical_release$
DECLARE before_ledger jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace=pg_my_temp_schema()) THEN
  RAISE EXCEPTION 'Existing temporary objects; use a fresh isolated execution session';
 END IF;
 IF to_regclass('schema_release_receipts') IS NOT NULL THEN
  RAISE EXCEPTION 'Historical release already recorded; do not replay or override an existing receipt table';
 END IF;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_ledger FROM schema_migrations m;
 IF (SELECT jsonb_agg(id ORDER BY id) FROM schema_migrations) IS DISTINCT FROM '["0001_annual_return_control_center.sql","0002_harden_annual_return_schema.sql","0003_annual_return_audit_events.sql","0004_retain_annual_return_audit_events.sql","0005_whatsapp_integration_foundation.sql","0006_production_assignment_sla_foundation.sql","0007_whatsapp_inbox_ordering_indexes.sql","0008_client_register.sql","0009_reclaim_stranded_outbox_rows.sql","0010_index_timeline_and_upload_intent_lookups.sql","0011_whatsapp_delivery_receipts.sql","0012_annual_return_reminder_events.sql","0013_checklist_templates.sql","0014_generalize_work_item_case_reference.sql","0015_officers_and_shareholdings.sql","0016_significant_controllers_and_dr.sql","0017_incorporation_intake.sql","0018_recurring_service_subscriptions.sql","0019_corporate_change_requests.sql","0020_corporate_change_work_items.sql","0021_whatsapp_session_window_indexes.sql","0022_notification_outbox_delivery.sql","0023_document_scan_jobs_and_quarantine_retention.sql","0024_link_uploads_to_checklist_items.sql","0025_nar_import_staging.sql","0026_case_parties_and_requirement_instances.sql","0027_document_versions.sql","0028_document_analysis_jobs_and_findings.sql","0029_whatsapp_send_mode.sql","0030_company_data_origin.sql","0031_whatsapp_message_media.sql","0032_package_handoffs_and_returns.sql","0033_maintenance_runs.sql","0034_notification_delivery_attempts.sql","0035_maintenance_job_runs.sql","0036_bulk_operations.sql","0037_bulk_scheduler_job.sql","0038_nar_import_preview.sql","0039_nar_import_approval_apply.sql","0040_payment_reconciliation.sql","0041_filing_packages.sql","0042_manual_package_submission.sql","0043_filing_return_intake.sql","0044_message_preview.sql","0045_whatsapp_media_download.sql","0046_staff_lifecycle.sql","0047_checklist_template_versions.sql","0048_case_assignment_revision.sql","0049_bulk_case_assign_action.sql","0050_client_assignment_revision.sql","0051_bulk_client_assign_action.sql","0052_resource_tags.sql","0053_bulk_tag_action.sql","0054_bulk_reminder_drafts.sql","0055_bulk_domain_actions.sql","0056_document_analysis_context.sql","0057_import_preview_scale.sql","0058_import_apply_selection_limit.sql","0059_nar_import_stage_jobs.sql","0060_nar_import_stage_error_detail.sql","0061_subscription_reminder_drafts.sql","0062_legacy_filing_completion_eligibility.sql","0063_work_items_unconfigured_sla.sql","0064_work_item_sla_policy_attachment.sql","0065_bulk_sla_policy_attach.sql","0066_nar_import_scheduler_job.sql"]'::jsonb THEN
  RAISE EXCEPTION 'Historical ledger changed; stop and review before DDL';
 END IF;
 IF (WITH historical_objects(name) AS (SELECT unnest(ARRAY['annual_return_audit_events','annual_return_case_tags','annual_return_cases','annual_return_checklist_items','annual_return_reminder_events','assignment_events','bulk_operation_attempts','bulk_operation_items','bulk_operations','bulk_previews','bulk_reminder_reviews','business_calendar_holidays','business_calendars','case_notes','case_parties','case_requirement_instances','checklist_template_versions','checklist_templates','client_company_memberships','companies','company_contacts','company_external_references','company_tags','corporate_change_checklist_items','corporate_change_requests','document_analysis_jobs','document_analysis_run_metadata','document_findings','document_scan_jobs','document_upload_intents','document_version_texts','document_versions','documents','escalation_events','filing_packages','filing_return_source_cursors','filing_return_source_objects','handoff_returns','incorporation_cases','incorporation_checklist_items','maintenance_job_runs','maintenance_runs','nar_import_apply_events','nar_import_approvals','nar_import_batches','nar_import_payment_observations','nar_import_previews','nar_import_rows','nar_import_stage_jobs','notification_delivery_attempts','notification_outbox','officers','package_handoffs','payment_proof_allocations','payment_reconciliation_events','payments','reminder_logs','requirement_evidence_links','resource_tag_events','schema_migrations','scr_inspection_requests','service_subscription_reminder_events','service_subscriptions','shareholdings','significant_controllers','sla_policies','staff_access_events','staff_profiles','staff_provisioning_requests','staff_skills','teams','timeline_events','users','whatsapp_contacts','whatsapp_message_media','whatsapp_message_previews','whatsapp_messages','whatsapp_templates','whatsapp_webhook_events','work_item_sla_attachments','work_item_tags','work_items']::text[])) SELECT encode(sha256(convert_to(jsonb_build_object(
'columns',(SELECT jsonb_agg(jsonb_build_object('table',table_name,'name',column_name,'ordinal',ordinal_position,'type',data_type,'udt',udt_name,'nullable',is_nullable,'default',column_default,'length',character_maximum_length,'precision',numeric_precision,'scale',numeric_scale) ORDER BY table_name COLLATE "C",ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name IN (SELECT name FROM historical_objects)),
'indexes',(SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename::text COLLATE "C",indexname::text COLLATE "C") FROM pg_indexes WHERE schemaname='public' AND tablename IN (SELECT name FROM historical_objects)),
'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'type',c.contype,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conrelid::regclass::text COLLATE "C",c.conname::text COLLATE "C") FROM pg_constraint c WHERE c.connamespace='public'::regnamespace AND c.conrelid::regclass::text IN (SELECT name FROM historical_objects)),
'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid)) ORDER BY p.proname::text COLLATE "C",pg_get_function_identity_arguments(p.oid) COLLATE "C") FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname=ANY(ARRAY['enforce_business_calendar_holiday_immutability','enforce_business_calendar_version_immutability','enforce_filing_package_immutability','enforce_manual_submission_identity','enforce_sla_policy_version_immutability','enforce_work_item_sla_snapshot_immutability','invalidate_verified_contact_phone','refuse_template_version_change','reject_work_item_sla_attachment_mutation']::text[])),
'triggers',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'function',p.proname) ORDER BY c.relname::text COLLATE "C",t.tgname::text COLLATE "C") FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname IN (SELECT name FROM historical_objects))
)::text,'UTF8')),'hex') AS catalog_sha256) IS DISTINCT FROM '58280602231120582ababb01ca1bc52fed211ef17ae8b047b6a87b7a56472013' THEN
  RAISE EXCEPTION 'Historical physical catalog changed; stop and review before DDL';
 END IF;
 execute $release_step_0$-- Reviewed historical contract adapter. Run only inside a transaction.
-- Retains all historical work, years, revisions and migration receipts.
set local lock_timeout = '5s';
lock table maintenance_job_runs, nar_import_batches, checklist_templates, handoff_returns in share row exclusive mode;
create temporary table kossilon_bridge_job_before (
 job_kind text check(job_kind in ('evaluateEscalations','settleNotificationAttempts','redactNotifications','escalateStalledQuarantine','runBulkOperations','drainInboundMediaDownloads','runNarImportStageJobs'))
) on commit drop;
create temporary table kossilon_bridge_job_after (
 job_kind text check(job_kind in ('evaluateEscalations','settleNotificationAttempts','redactNotifications','escalateStalledQuarantine','runBulkOperations','drainInboundMediaDownloads','runNarImportStageJobs','runBulkAssignments'))
) on commit drop;
create temporary table kossilon_bridge_year (return_year integer check(return_year between 1900 and 2100)) on commit drop;
create temporary table kossilon_bridge_revision (revision integer not null default 1 check(revision>0)) on commit drop;
do $bridge$
declare
 current_name text; current_def text; before_def text; after_def text;
 checks integer; validated boolean; expected record; actual_oid oid; attribute smallint;
begin
 -- Validate every collision before changing any contract.
 for expected in select * from (values
  ('nar_import_batches','return_year',false,null::text,'kossilon_bridge_year'),
  ('checklist_templates','revision',true,'1','kossilon_bridge_revision')
 ) contract(table_name,column_name,required_not_null,required_default,reference_table)
 loop
  actual_oid:=to_regclass(expected.table_name);
  select attnum into attribute from pg_attribute where attrelid=actual_oid and attname=expected.column_name
   and not attisdropped and atttypid='integer'::regtype and atttypmod=-1
   and attnotnull=expected.required_not_null and attidentity='' and attgenerated='';
  if attribute is null or (
   select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d where d.adrelid=actual_oid and d.adnum=attribute
  ) is distinct from expected.required_default then
   raise exception 'Incompatible historical %.% type/nullability/default; preserve data',expected.table_name,expected.column_name;
  end if;
  select count(*),min(pg_get_constraintdef(oid)),bool_and(convalidated) into checks,current_def,validated
   from pg_constraint where conrelid=actual_oid and contype='c' and conkey=array[attribute]::smallint[];
  select pg_get_constraintdef(oid) into before_def from pg_constraint
   where conrelid=to_regclass(expected.reference_table) and contype='c';
  if checks<>1 or validated is not true or current_def is distinct from before_def then
   raise exception 'Incompatible historical %.% CHECK; preserve data',expected.table_name,expected.column_name;
  end if;
 end loop;
 for expected in select * from (values ('external_reference','text'),('document_version_id','uuid')) contract(column_name,kind)
 loop
  select attnum into attribute from pg_attribute where attrelid='handoff_returns'::regclass and attname=expected.column_name
   and not attisdropped and format_type(atttypid,atttypmod)=expected.kind and not attnotnull and attidentity='' and attgenerated='';
  if attribute is null or exists(select 1 from pg_attrdef where adrelid='handoff_returns'::regclass and adnum=attribute) then
   raise exception 'Incompatible historical handoff_returns.% column; preserve evidence',expected.column_name;
  end if;
 end loop;
 select count(*) into checks from pg_constraint where conrelid='handoff_returns'::regclass and contype='f'
  and conkey=array[attribute]::smallint[];
 if checks<>1 or not exists(select 1 from pg_constraint where conrelid='handoff_returns'::regclass and contype='f'
  and conkey=array[attribute]::smallint[] and confrelid='document_versions'::regclass
  and confkey=array[(select attnum from pg_attribute where attrelid='document_versions'::regclass and attname='id')]::smallint[]
  and convalidated and not condeferrable and confdeltype='r' and confupdtype='a') then
  raise exception 'Incompatible historical handoff document-version FK; preserve evidence';
 end if;
 select attnum into attribute from pg_attribute where attrelid='maintenance_job_runs'::regclass and attname='job_kind'
  and not attisdropped and atttypid='text'::regtype and attnotnull and attidentity='' and attgenerated='';
 if attribute is null then raise exception 'Incompatible historical job-kind column; preserve data'; end if;
 select count(*),min(conname),min(pg_get_constraintdef(oid)),bool_and(convalidated)
  into checks,current_name,current_def,validated from pg_constraint
  where conrelid='maintenance_job_runs'::regclass and contype='c' and conkey=array[attribute]::smallint[];
 select pg_get_constraintdef(oid) into before_def from pg_constraint where conrelid='kossilon_bridge_job_before'::regclass and contype='c';
 select pg_get_constraintdef(oid) into after_def from pg_constraint where conrelid='kossilon_bridge_job_after'::regclass and contype='c';
 if checks<>1 or validated is not true or current_def not in (before_def,after_def) then
  raise exception 'Unrecognized historical maintenance job-kind contract; preserve data and review';
 end if;
 if current_def=before_def then
  execute format('alter table maintenance_job_runs drop constraint %I',current_name);
  alter table maintenance_job_runs add constraint maintenance_job_runs_job_kind_check
   check(job_kind in ('evaluateEscalations','settleNotificationAttempts','redactNotifications','escalateStalledQuarantine','runBulkOperations','drainInboundMediaDownloads','runNarImportStageJobs','runBulkAssignments'));
 end if;
end $bridge$;
drop table pg_temp.kossilon_bridge_job_before,pg_temp.kossilon_bridge_job_after,pg_temp.kossilon_bridge_year,pg_temp.kossilon_bridge_revision;
$release_step_0$;
execute $release_step_1$-- Source input: 0067_repair_outbox_dispatch_marker.sql
-- Additive reconciliation after the 0066 history observed on 2026-10-01.
-- Do not rewrite 0034 or any recorded migration ID. Pause dispatch and drain
-- active workers before the approved production operation. Execute in a transaction.
set local lock_timeout = '5s';
lock table notification_outbox in access exclusive mode;

alter table notification_outbox
  add column if not exists dispatch_started_attempt integer;

do $$
begin
  if not exists (
    select 1 from pg_attribute a
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='notification_outbox'::regclass
      and a.attname='dispatch_started_attempt' and not a.attisdropped
      and a.atttypid='integer'::regtype and not a.attnotnull and d.oid is null
  ) then
    raise exception 'dispatch marker definition differs; review forward repair';
  end if;
end $$;

create index if not exists notification_outbox_dispatch_marker_idx
  on notification_outbox (updated_at)
  where status = 'processing' and dispatch_started_attempt is not null;

do $$
begin
  if not exists (
    select 1 from pg_index i
    join pg_class idx on idx.oid=i.indexrelid
    join pg_am am on am.oid=idx.relam
    where i.indrelid='notification_outbox'::regclass
      and idx.relname='notification_outbox_dispatch_marker_idx'
      and i.indisvalid and i.indisready and i.indnkeyatts=1 and i.indnatts=1
      and am.amname='btree' and pg_get_indexdef(i.indexrelid,1,true)='updated_at'
      and pg_get_expr(i.indpred,i.indrelid)=
        '((status = ''processing''::text) AND (dispatch_started_attempt IS NOT NULL))'
  ) then
    raise exception 'dispatch marker index definition differs; review forward repair';
  end if;
end $$;

-- Pre-marker processing rows may have reached a provider. Retain them, fence
-- them for reconciliation, and let failStranded record outcome_unknown; never
-- make them retryable just because the marker did not exist on the old build.
update notification_outbox
set dispatch_started_attempt = attempt_count
where status = 'processing' and dispatch_started_attempt is null;
$release_step_1$;
execute $release_step_2$-- Source input: 0068_company_historical_data_origin.sql
-- Extend the existing source field; never infer or reclassify existing rows.
-- All non-client values remain suppressed by every outbox gate.
set local lock_timeout = '5s';
lock table companies in access exclusive mode;
do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='companies'::regclass and conname='companies_data_origin_check';
  if definition is distinct from 'CHECK ((data_origin = ANY (ARRAY[''client''::text, ''fixture''::text])))'
    and definition is distinct from 'CHECK ((data_origin = ANY (ARRAY[''client''::text, ''fixture''::text, ''historical''::text])))' then
    raise exception 'Unexpected data origin constraint; review before extending';
  end if;
end $$;
alter table companies drop constraint companies_data_origin_check;
alter table companies add constraint companies_data_origin_check
  check (data_origin in ('client', 'fixture', 'historical'));
$release_step_2$;
execute $release_step_3$-- Source input: 0069_restore_maintenance_job_contract.sql
-- Reuse the historical0035 job registry without inventing its ledger receipt.
-- Existing rows/leases are preserved. This candidate never activates a trigger.
set local lock_timeout = '5s';
create table if not exists maintenance_job_runs (
 id uuid primary key default gen_random_uuid(),
 scheduled_for timestamptz not null,
 job_kind text not null check(job_kind in ('evaluateEscalations','settleNotificationAttempts','redactNotifications','escalateStalledQuarantine')),
 trigger_source text not null check(trigger_source in ('scheduled','manual')),
 run_id text not null,
 lease_token uuid not null default gen_random_uuid() unique,
 state text not null check(state in ('claimed','started','succeeded','failed','unknown')),
 claimed_at timestamptz not null,
 lease_expires_at timestamptz not null,
 started_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz not null default now(),
 constraint maintenance_job_started_check check(state='claimed' or started_at is not null)
);
lock table maintenance_job_runs in share row exclusive mode;
create unique index if not exists maintenance_job_scheduled_once_idx
 on maintenance_job_runs(scheduled_for,job_kind) where trigger_source='scheduled';
create index if not exists maintenance_job_unresolved_idx
 on maintenance_job_runs(lease_expires_at) where state in ('claimed','started');
do $$
declare required record;
begin
 for required in select * from (values
  ('id','uuid',true),('scheduled_for','timestamp with time zone',true),
  ('job_kind','text',true),('trigger_source','text',true),('run_id','text',true),
  ('lease_token','uuid',true),('state','text',true),
  ('claimed_at','timestamp with time zone',true),('lease_expires_at','timestamp with time zone',true),
  ('started_at','timestamp with time zone',false),('finished_at','timestamp with time zone',false)
  ,('created_at','timestamp with time zone',true)
 ) cols(name,kind,required_not_null)
 loop
  if not exists(select 1 from pg_attribute where attrelid='maintenance_job_runs'::regclass
   and attname=required.name and format_type(atttypid,atttypmod)=required.kind
   and attnotnull=required.required_not_null and not attisdropped) then
   raise exception 'Incompatible maintenance_job_runs column: %',required.name;
  end if;
 end loop;
 for required in select * from (values ('id'),('lease_token')) cols(name)
 loop
  if not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid='maintenance_job_runs'::regclass and a.attname=required.name
   and pg_get_expr(d.adbin,d.adrelid)='gen_random_uuid()') then
   raise exception 'Missing maintenance job identity default: %',required.name;
  end if;
 end loop;
 if not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='maintenance_job_runs'::regclass and a.attname='created_at'
  and pg_get_expr(d.adbin,d.adrelid)='now()') then
  raise exception 'Missing maintenance job created_at default; retain rows and review';
 end if;
 if not exists(select 1 from pg_constraint where conrelid='maintenance_job_runs'::regclass
  and contype='p' and conkey=array[(select attnum from pg_attribute where attrelid='maintenance_job_runs'::regclass and attname='id')]::smallint[]) then
  raise exception 'Missing maintenance job primary key; retain rows and review';
 end if;
 if not exists(select 1 from pg_index i where i.indexrelid='maintenance_job_scheduled_once_idx'::regclass
  and i.indrelid='maintenance_job_runs'::regclass and i.indisunique and i.indisvalid and i.indisready
  and i.indnkeyatts=2 and i.indnatts=2
  and pg_get_indexdef(i.indexrelid,1,true)='scheduled_for' and pg_get_indexdef(i.indexrelid,2,true)='job_kind'
  and pg_get_expr(i.indpred,i.indrelid)='(trigger_source = ''scheduled''::text)') then
  raise exception 'Incompatible scheduled slot uniqueness; retain rows and review';
 end if;
 if not exists(select 1 from pg_constraint where conrelid='maintenance_job_runs'::regclass
  and contype='u' and conkey=array[(select attnum from pg_attribute where attrelid='maintenance_job_runs'::regclass and attname='lease_token')]::smallint[]) then
  raise exception 'Missing lease token uniqueness; retain rows and review';
 end if;
end $$;
$release_step_3$;
execute $release_step_4$-- Source input: 0070_payment_evidence_entries.sql
-- Additive only. No historical status, amount, date or receipt is invented.
create table if not exists payment_evidence_entries (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  document_id uuid not null references documents(id),
  proof_version_id uuid not null unique references document_versions(id),
  proof_sha256 text not null check (proof_sha256 ~ '^[0-9a-f]{64}$'),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'HKD' check (currency='HKD'),
  received_on date not null,
  reference text check (reference is null or length(reference) between 1 and 200),
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  recorded_by uuid not null references users(id),
  recorded_at timestamptz not null default now(),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  reason_code text check (reason_code in ('unreadable','amount_mismatch','date_mismatch','duplicate_proof','wrong_account','other')),
  reason_text text check (reason_text is null or length(btrim(reason_text)) between 1 and 500),
  check ((status='pending' and reviewed_by is null and reviewed_at is null)
    or (status<>'pending' and reviewed_by is not null and reviewed_at is not null)),
  check (status<>'rejected' or (reason_code is not null and reason_text is not null))
);
create unique index if not exists payment_evidence_active_hash_uidx on payment_evidence_entries(proof_sha256) where status in ('pending','verified');
create index if not exists payment_evidence_case_idx on payment_evidence_entries(case_id,payment_id,recorded_at);
$release_step_4$;
execute $release_step_5$-- Source input: 0071_staff_admin_contract.sql
-- Forward-only existing-staff maintenance. No Auth identities, invitations or grants.
alter table staff_profiles add column if not exists access_revision integer not null default 1 check(access_revision>0);
create table if not exists staff_access_events (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references users(id) on delete restrict,
  actor_user_id uuid not null references users(id) on delete restrict,
  event_type text not null check(event_type in ('linked','access_changed','disabled')),
  old_role text,
  new_role text,
  old_team_id uuid,
  new_team_id uuid,
  handover_operation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists staff_access_events_target_idx on staff_access_events(target_user_id,created_at desc);
$release_step_5$;
execute $release_step_6$-- Source input: 0072_durable_bulk_assignment.sql
-- Separate from notification outbox; no external side effects or historical rewrites.
create table bulk_selection_snapshots (
 id uuid primary key default gen_random_uuid(), actor_user_id uuid not null references users(id),
 auth_user_id text not null, resource text not null check(resource in ('annual_return_case','work_item')),
 filters jsonb not null, items jsonb not null check(jsonb_typeof(items)='array'), snapshot_hash text not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default(now()+interval '30 minutes')
);
create table bulk_operation_previews (
 id uuid primary key default gen_random_uuid(), actor_user_id uuid not null references users(id),auth_user_id text not null,
 resource text not null check(resource in ('annual_return_case','work_item')), assignment jsonb not null,items jsonb not null check(jsonb_typeof(items)='array'),
 payload_hash text not null,created_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '30 minutes')
);
create table bulk_operation_jobs (
 id uuid primary key default gen_random_uuid(),preview_id uuid not null references bulk_operation_previews(id),
 actor_user_id uuid not null references users(id),auth_user_id text not null,idempotency_key text not null,payload_hash text not null,
 resource text not null check(resource in ('annual_return_case','work_item')),assignment jsonb not null,total integer not null check(total>=0),
 state text not null default 'queued' check(state in ('queued','running','completed','partial','cancelled')),
 lease_token uuid,lease_until timestamptz,cancel_requested boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(actor_user_id,idempotency_key)
);
create table bulk_operation_job_items (
 job_id uuid not null references bulk_operation_jobs(id),ordinal integer not null check(ordinal>=0),resource_id uuid not null,expected_version text not null,
 state text not null default 'pending' check(state in ('pending','succeeded','forbidden','locked','conflict','failed','unknown','cancelled')),
 reason text,retryable boolean not null default false,attempts integer not null default 0 check(attempts>=0),
 result jsonb,started_at timestamptz,finished_at timestamptz,
 primary key(job_id,ordinal),unique(job_id,resource_id)
);
create index bulk_operation_jobs_owner_idx on bulk_operation_jobs(actor_user_id,created_at desc,id);
create index bulk_operation_jobs_pending_idx on bulk_operation_jobs(state,lease_until) where state in ('queued','running');
create index bulk_operation_items_pending_idx on bulk_operation_job_items(job_id,ordinal) where state='pending';
-- Enforce snapshots' immutability in the database, not only in application conventions.
create function reject_bulk_snapshot_update() returns trigger language plpgsql as $$begin raise exception 'Bulk snapshots and previews are immutable'; end$$;
create trigger bulk_selection_snapshots_immutable before update on bulk_selection_snapshots for each row execute function reject_bulk_snapshot_update();
create trigger bulk_operation_previews_immutable before update on bulk_operation_previews for each row execute function reject_bulk_snapshot_update();
$release_step_6$;
execute $release_step_7$-- Source input: 0074_reviewed_nar_apply.sql
-- Reviewed NAR apply is additive; legacy chosen years remain unknown, never inferred.
-- Existing column validated and preserved by historical-contract-bridge.sql.
alter table annual_return_cases add column import_origin text check(import_origin in ('client','historical'));
create index annual_return_cases_historical_import_idx on annual_return_cases(id) where import_origin='historical';
create table nar_mapping_events (
 id uuid primary key default gen_random_uuid(),source_system text not null,external_client_id text not null,
 before_company_id uuid references companies(id),after_company_id uuid not null references companies(id),
 actor_user_id uuid not null references users(id),created_at timestamptz not null default now()
);
create table nar_apply_previews (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references nar_import_batches(id),
 actor_user_id uuid not null references users(id),auth_user_id text not null,items jsonb not null check(jsonb_typeof(items)='array'),
 payload_hash text not null,created_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '30 minutes')
);
create trigger nar_apply_previews_immutable before update on nar_apply_previews for each row execute function reject_bulk_snapshot_update();
create table nar_apply_jobs (
 id uuid primary key default gen_random_uuid(),preview_id uuid not null references nar_apply_previews(id),batch_id uuid not null references nar_import_batches(id),
 actor_user_id uuid not null references users(id),auth_user_id text not null,idempotency_key text not null,payload_hash text not null,
 state text not null default 'queued' check(state in ('queued','running','completed','partial','cancelled')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(actor_user_id,idempotency_key)
);
create table nar_apply_job_items (
 job_id uuid not null references nar_apply_jobs(id),row_id uuid not null references nar_import_rows(id),ordinal integer not null,
 snapshot jsonb not null,state text not null default 'pending' check(state in ('pending','applied','conflict','failed','cancelled')),
 reason text,attempts integer not null default 0,case_id uuid references annual_return_cases(id),finished_at timestamptz,
 primary key(job_id,row_id),unique(job_id,ordinal)
);
create table nar_apply_journal (
 id uuid primary key default gen_random_uuid(),job_id uuid not null references nar_apply_jobs(id),batch_id uuid not null references nar_import_batches(id),
 row_id uuid not null references nar_import_rows(id),case_id uuid not null references annual_return_cases(id),
 actor_user_id uuid not null references users(id),before_value jsonb,after_value jsonb not null,after_revision text not null,
 command text not null check(command in ('create','update','unchanged','already_applied')),created_at timestamptz not null default now(),unique(job_id,row_id)
);
create index nar_apply_jobs_owner_idx on nar_apply_jobs(actor_user_id,created_at desc,id);
create index nar_apply_items_pending_idx on nar_apply_job_items(job_id,ordinal) where state='pending';
$release_step_7$;
execute $release_step_8$-- Source input: 0075_nar_legacy_year_review.sql
-- Explicit legacy-year review; no filename inference or backfill.
create table nar_batch_review_events (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references nar_import_batches(id),
 actor_user_id uuid not null references users(id),before_year integer,after_year integer not null check(after_year between 1900 and 2100),
 expected_version text not null,reason text not null check(length(btrim(reason))>=10),created_at timestamptz not null default now()
);
create index nar_batch_review_events_batch_idx on nar_batch_review_events(batch_id,created_at,id);
$release_step_8$;
execute $release_step_9$-- Source input: 0076_document_scan_review_versions.sql
-- Add exact scan/job/review identities without certifying historical verdicts.
-- NULL remains unknown. No scan, review, migration history or receipt backfill.
alter table document_upload_intents
  add column if not exists scan_document_version_id uuid
    references document_versions(id) on delete set null;
alter table document_scan_jobs
  add column if not exists document_version_id uuid
    references document_versions(id) on delete set null;
alter table documents
  add column if not exists reviewed_document_version_id uuid
    references document_versions(id) on delete set null;
create index if not exists document_scan_jobs_version_idx
  on document_scan_jobs(document_version_id) where document_version_id is not null;
$release_step_9$;
execute $release_step_10$-- Source input: 0077_document_analysis_evidence.sql
-- Add source-bound evidence and run provenance. Historical NULL is unknown;
-- no clean verdict, page citation, human resolution or model metadata backfill.
alter table document_version_texts
  add column if not exists evidence jsonb
    check (evidence is null or jsonb_typeof(evidence) = 'object');
alter table document_findings
  add column if not exists evidence jsonb
    check (evidence is null or jsonb_typeof(evidence) = 'object');
alter table document_analysis_jobs
  add column if not exists provenance jsonb
    check (provenance is null or jsonb_typeof(provenance) = 'object');
$release_step_10$;
execute $release_step_11$-- Source input: 0078_whatsapp_manual_intake.sql
-- Add an observed mapping revision and explicit universal-media lineage.
-- Existing waMediaId references remain legacy; no download, scan or receipt backfill.
alter table whatsapp_messages add column if not exists mapping_revision integer not null default 0 check (mapping_revision >= 0);
alter table whatsapp_message_media add column if not exists provider_media_kind text not null default 'legacy-wa-media' check (provider_media_kind in ('file','legacy-wa-media'));
alter table whatsapp_message_media add column if not exists intake_intent_id uuid references document_upload_intents(id) on delete restrict;
create index if not exists whatsapp_unmatched_receipt_idx on whatsapp_webhook_events ((coalesce(payload->'data'->>'messageId',payload->>'messageId')),received_at) where provider='woztell' and signature_valid and processing_status='ignored';
$release_step_11$;
execute $release_step_12$-- Source input: 0079_bulk_daily_maintenance.sql
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
$release_step_12$;
execute $release_step_13$-- Source input: 0080_manual_handoff_provenance.sql
-- Forward-only facts. Legacy NULL is unknown; never invent a receipt or scan.
alter table package_handoffs
  add column delivery_fact text check(delivery_fact in ('prepared','exported','manual_recorded','provider_accepted','unknown')),
  add column exported_at timestamptz,
  add column exported_by uuid references users(id),
  add column manual_recorded_at timestamptz,
  add column manual_recorded_by uuid references users(id),
  add column manual_occurred_at timestamptz,
  add column manual_reference text,
  add column manual_note text,
  add column manual_evidence_document_id uuid references documents(id),
  add column manual_evidence_version_id uuid references document_versions(id),
  add constraint handoff_export_actor_agrees check((exported_at is null)=(exported_by is null)),
  add constraint handoff_manual_actor_agrees check((manual_recorded_at is null)=(manual_recorded_by is null)),
  add constraint handoff_manual_evidence_agrees check((manual_evidence_document_id is null)=(manual_evidence_version_id is null)),
  add constraint handoff_manual_fact_agrees check(delivery_fact is distinct from 'manual_recorded' or (
    manual_recorded_by is not null and manual_occurred_at is not null
    and length(btrim(manual_reference))>0 and length(btrim(manual_note))>0
    and destination_reference is null));

-- Duplicate history is a deployment blocker: unique creation refuses it,
-- rather than deleting or rewriting any existing approval.
create unique index package_handoffs_manifest_uidx on package_handoffs(case_id,manifest_sha256);
create or replace function preserve_handoff_manifest() returns trigger language plpgsql as $$
begin
  if row(new.case_id,new.manifest_sha256,new.manifest_payload,new.approved_by)
    is distinct from row(old.case_id,old.manifest_sha256,old.manifest_payload,old.approved_by) then
    raise exception 'Approved handoff manifest is immutable';
  end if;
  return new;
end $$;
create trigger package_handoffs_manifest_immutable before update on package_handoffs
  for each row execute function preserve_handoff_manifest();

alter table handoff_returns
  add column source text check(source in ('manual','provider')),
  add column recorded_by uuid references users(id),
-- Existing handoff column/FK validated and preserved.
  add column returned_manifest_sha256 text check(returned_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  add column reported_outcome text check(reported_outcome in ('accepted','rejected','partial','unmatched')),
-- Existing handoff column/FK validated and preserved.
  add column idempotency_key uuid,
  add column payload_sha256 text check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  add column reconciliation_note text;
create unique index handoff_returns_idempotency_uidx on handoff_returns(handoff_id,idempotency_key) where idempotency_key is not null;
$release_step_13$;
execute $release_step_14$-- Source input: 0081_handoff_attempt_idempotency.sql
-- Idempotency belongs to the active attempt, not every immutable historical approval.
-- Unknown results (including legacy NULL) remain outstanding and cannot be retried.
drop index package_handoffs_manifest_uidx;
create unique index package_handoffs_manifest_uidx on package_handoffs(case_id,manifest_sha256)
  where status in ('prepared','transmitted','acknowledged') or delivery_fact='unknown'
    or (delivery_fact is null and status not in ('cancelled','returned'));
drop index package_handoffs_live_uidx;
create unique index package_handoffs_live_uidx on package_handoffs(case_id)
  where status in ('prepared','transmitted','acknowledged') or delivery_fact='unknown'
    or (delivery_fact is null and status not in ('cancelled','returned'));
$release_step_14$;
execute $release_step_15$-- Source input: 0082_case_template_snapshots.sql
-- Revision 1 identifies the currently observed template, not invented old history.
-- Existing column validated and preserved by historical-contract-bridge.sql.
alter table annual_return_cases
  add column checklist_template_source_id uuid,
  add column checklist_template_revision integer check(checklist_template_revision>0),
  add column checklist_template_snapshot jsonb,
  add constraint case_template_snapshot_agrees check(
    (checklist_template_source_id is null and checklist_template_revision is null and checklist_template_snapshot is null)
    or (checklist_template_source_id is not null and checklist_template_revision is not null and checklist_template_snapshot is not null));
create index annual_return_case_template_source_idx on annual_return_cases(checklist_template_source_id,id)
  where checklist_template_source_id is not null;
create function preserve_case_template_snapshot() returns trigger language plpgsql as $$
begin
  if row(new.checklist_template_source_id,new.checklist_template_revision,new.checklist_template_snapshot)
    is distinct from row(old.checklist_template_source_id,old.checklist_template_revision,old.checklist_template_snapshot) then
    raise exception 'Case creation template snapshot is immutable';
  end if;
  return new;
end $$;
create trigger annual_return_case_template_immutable before update on annual_return_cases
  for each row execute function preserve_case_template_snapshot();
$release_step_15$;
 IF (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM schema_migrations m) IS DISTINCT FROM before_ledger THEN
  RAISE EXCEPTION 'Historical ledger changed during release; roll back';
 END IF;
 CREATE TABLE schema_release_receipts (id text PRIMARY KEY,payload_sha256 text NOT NULL CHECK(length(payload_sha256)=64),manifest jsonb NOT NULL,executed_at timestamptz NOT NULL DEFAULT now());
 INSERT INTO schema_release_receipts(id,payload_sha256,manifest) VALUES('kossilon-historical-release-20261002','b84f9b5a9dc489ced544a39040af9d62678464ae4496d396a5420aba0e010c01','{"id":"kossilon-historical-release-20261002","historicalSource":"b87dfbba374add601d6a5fdbf772dd539c73cd88","historicalAppliedHashes":"unknown","inputs":[{"file":"0067_repair_outbox_dispatch_marker.sql","sha256":"660dbe9226514a66cdfedda2a2ed14300c960aee3e384908c28db73ccdf47014","executedVerbatim":true},{"file":"0068_company_historical_data_origin.sql","sha256":"3bada03551f73882074930732205b70986e30ff450445b30152f80f22c34a8eb","executedVerbatim":true},{"file":"0069_restore_maintenance_job_contract.sql","sha256":"54c8fb08e54524b89502c44db02de202ecaca159549ba1d38ee4a34ac2b361ec","executedVerbatim":true},{"file":"0070_payment_evidence_entries.sql","sha256":"77be3213c6eef6529f0f0712afb219158dc1b3b2d42a1d94df13b705714ad4e1","executedVerbatim":true},{"file":"0071_staff_admin_contract.sql","sha256":"41caa6f1b2cab4ab5ce603af67d24c31755154e6d99b9a3aeb68be91c8e7bbd9","executedVerbatim":true},{"file":"0072_durable_bulk_assignment.sql","sha256":"96828ee76f44b7917736c7f1e322f7765424873aa8b1f7121c5459a95ffe7b7f","executedVerbatim":true},{"file":"0073_bulk_maintenance_job_kind.sql","sha256":"0115de0f7773498fc44b105e2614600fe92df84267cd26c998e96b15ff1c6be4","executedVerbatim":false},{"file":"0074_reviewed_nar_apply.sql","sha256":"076adf128c7a55b12572fd5415e698c78190fa744a0e1ae2790a652967094e9e","executedVerbatim":false},{"file":"0075_nar_legacy_year_review.sql","sha256":"1770530e8dc0ab536ada101e64fe201afeb3fdb9d3a94390c12b4d3b770c8078","executedVerbatim":true},{"file":"0076_document_scan_review_versions.sql","sha256":"ee11fedf4f2cc9d2faf4cd845a2e821b9829110fa253d210c2a46a799d902887","executedVerbatim":true},{"file":"0077_document_analysis_evidence.sql","sha256":"e893065da028d8266e384c365fc8d5bd7eb5da7001872118dec9b5a72a08da75","executedVerbatim":true},{"file":"0078_whatsapp_manual_intake.sql","sha256":"5ed629d5ac915e62f126fdc97929da9bcdd87814d451e6dd1117013fc280db69","executedVerbatim":true},{"file":"0079_bulk_daily_maintenance.sql","sha256":"b3666b32fd4a92e49acd9c43959bfa751d1135f9b59b338eb6f5456d9a4732f7","executedVerbatim":true},{"file":"0080_manual_handoff_provenance.sql","sha256":"f7f955a5b186aa4ed16fa95c136402e15c3f265fd6c81a90a0c42c0f9e53866d","executedVerbatim":false},{"file":"0081_handoff_attempt_idempotency.sql","sha256":"dc4cc45e37c05f69e59f19ddd33b37c18960b525726d995ddfe0b864db3a8e45","executedVerbatim":true},{"file":"0082_case_template_snapshots.sql","sha256":"29f13a7f58668c93f25141c90d17206332144a282833597ab43ec654b01dd231","executedVerbatim":false}],"adaptedInputs":["0073_bulk_maintenance_job_kind.sql","0074_reviewed_nar_apply.sql","0080_manual_handoff_provenance.sql","0082_case_template_snapshots.sql"],"bridgeSha256":"e39fcb75ab7a9e1d977e0e32880be71ec8521a7b95b3be2a574220a7a7b4f3de","payloadSha256":"b84f9b5a9dc489ced544a39040af9d62678464ae4496d396a5420aba0e010c01","catalogSha256":"58280602231120582ababb01ca1bc52fed211ef17ae8b047b6a87b7a56472013","compilerSha256":"50eacaa6530e65c1e1061a0f83591826972ed5433dc64fefb840428df97fcab4","normalization":"UTF-8 with LF; input hashes are provenance, never historical applied receipts","releaseDecision":"NO_GO: provider clone/restore, lineage policy, owners and runtime acceptance pending"}'::jsonb);
END $historical_release$;
COMMIT;
