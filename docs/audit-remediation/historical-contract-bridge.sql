-- Reviewed historical contract adapter. Run only inside a transaction.
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
