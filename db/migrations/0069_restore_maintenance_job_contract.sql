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
