-- T19 guarded rollback. Run only against an explicitly authorized database.
-- Any attempted download or linked document requires a forward repair instead.
begin;
lock table whatsapp_message_media, maintenance_job_runs in access exclusive mode;
do $$
begin
  if not exists (select 1 from schema_migrations
    where id='0045_whatsapp_media_download.sql') then
    raise exception '0045 ledger row is absent; rollback refused';
  end if;
  if exists (select 1 from whatsapp_message_media where
    download_status <> 'pending' or download_attempt_count <> 0
    or download_checksum_sha256 is not null or document_id is not null
    or download_lease_token is not null or download_last_error_code is not null) then
    raise exception 'inbound media download evidence exists; rollback refused';
  end if;
  if exists (select 1 from maintenance_job_runs
    where job_kind='drainInboundMediaDownloads') then
    raise exception 'media scheduler audit exists; rollback refused';
  end if;
end
$$;
drop index whatsapp_message_media_download_due_idx;
drop index whatsapp_message_media_object_key_uidx;
drop index whatsapp_message_media_position_uidx;
alter table whatsapp_message_media
  drop constraint whatsapp_media_quarantine_metadata,
  drop constraint whatsapp_media_lease_pair,
  drop constraint whatsapp_media_attempt_limit,
  drop column download_status,
  drop column download_attempt_count,
  drop column download_max_attempts,
  drop column download_next_attempt_at,
  drop column download_lease_token,
  drop column download_lease_expires_at,
  drop column download_last_error_code,
  drop column download_object_key,
  drop column download_checksum_sha256,
  drop column download_content_type,
  drop column download_byte_size,
  drop column download_file_name,
  drop column download_revision;
alter table maintenance_job_runs drop constraint maintenance_job_runs_job_kind_check;
alter table maintenance_job_runs add constraint maintenance_job_runs_job_kind_check check (job_kind in (
  'evaluateEscalations','settleNotificationAttempts','redactNotifications',
  'escalateStalledQuarantine','runBulkOperations'
));
delete from schema_migrations where id='0045_whatsapp_media_download.sql';
commit;
