-- REVIEW ONLY: no production command is authorised by this file.
-- Intended historical target: Neon red-morning-00331124 /
-- br-muddy-mountain-aov8bbku / neondb. Verify endpoint/branch separately.
-- Run on an isolated populated clone first. Save UTC/build/branch identity.
begin read only;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select current_database() as database_name, current_user as database_user,
       current_setting('server_version') as postgres_version, now() as observed_at;
select id, applied_at, to_jsonb(m)->>'sha256' as recorded_hash_or_unknown
from schema_migrations m order by id;
-- Explicit inventory: absent relations stay visible rather than vanishing from filters.
with expected(table_name) as (values
('companies'),
('notification_outbox'),
('maintenance_runs'),
('maintenance_job_runs'),
('annual_return_cases'),
('payment_evidence_entries'),
('staff_profiles'),
('staff_access_events'),
('bulk_selection_snapshots'),
('bulk_operation_previews'),
('bulk_operation_jobs'),
('bulk_operation_job_items'),
('nar_import_batches'),
('nar_import_rows'),
('nar_mapping_events'),
('nar_apply_previews'),
('nar_apply_jobs'),
('nar_apply_job_items'),
('nar_apply_journal'),
('nar_batch_review_events'),
('documents'),
('document_versions'),
('document_upload_intents'),
('document_scan_jobs'),
('document_version_texts'),
('document_findings'),
('document_analysis_jobs'),
('whatsapp_messages'),
('whatsapp_message_media'),
('package_handoffs'),
('handoff_returns'),
('checklist_templates')
)
select e.table_name, case when c.oid is null then 'missing' else 'present' end as presence
from expected e
left join pg_namespace n on n.nspname='public'
left join pg_class c on c.relnamespace=n.oid and c.relname=e.table_name and c.relkind in ('r','p')
order by e.table_name;
-- Full public catalog covers all current and historical release resources.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public'
order by table_name, ordinal_position;
select schemaname, tablename, indexname, indexdef from pg_indexes
where schemaname='public'
order by tablename,indexname;
select conrelid::regclass as table_name, conname, contype, convalidated,
       pg_get_constraintdef(oid) as definition
from pg_constraint where connamespace='public'::regnamespace
order by conrelid::regclass::text,conname;
select 'companies' as resource,count(*) as row_count from companies
union all select 'documents',count(*) from documents
union all select 'document_versions',count(*) from document_versions
union all select 'notification_outbox',count(*) from notification_outbox;
select status,count(*) from notification_outbox group by status order by status;
rollback;
-- Missing columns/tables/hashes are unknown/missing evidence, never a clean verdict.
-- No UPDATE/DELETE/INSERT, reseed, trigger activation or migration-ledger repair.
