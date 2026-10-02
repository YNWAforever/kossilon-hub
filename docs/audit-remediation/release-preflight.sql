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
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name in
  ('notification_outbox','maintenance_jobs','annual_return_cases',
   'document_versions','document_upload_intents','staff_profiles',
   'bulk_jobs','nar_import_batches','case_submission_manifests')
order by table_name, ordinal_position;
select schemaname, tablename, indexname, indexdef from pg_indexes
where schemaname='public' and tablename in
  ('notification_outbox','annual_return_cases','documents','document_versions')
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
