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
