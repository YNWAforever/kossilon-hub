-- T19: the existing one-row-per-inbound-attachment reference is the durable
-- download job. Existing references remain pending; no network work starts here.
alter table whatsapp_message_media
  add column download_status text not null default 'pending'
    check (download_status in (
      'pending','processing','quarantined','linked','manual_reupload','failed'
    )),
  add column download_attempt_count integer not null default 0
    check (download_attempt_count >= 0),
  add column download_max_attempts integer not null default 5
    check (download_max_attempts > 0),
  add column download_next_attempt_at timestamptz not null default now(),
  add column download_lease_token uuid,
  add column download_lease_expires_at timestamptz,
  add column download_last_error_code text,
  add column download_object_key text not null
    default ('whatsapp-media/' || gen_random_uuid()::text),
  add column download_checksum_sha256 text
    check (download_checksum_sha256 is null or download_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  add column download_content_type text,
  add column download_byte_size bigint
    check (download_byte_size is null or download_byte_size between 1 and 10485760),
  add column download_file_name text,
  add column download_revision integer not null default 0
    check (download_revision >= 0),
  add constraint whatsapp_media_attempt_limit
    check (download_attempt_count <= download_max_attempts),
  add constraint whatsapp_media_lease_pair
    check ((download_lease_token is null) = (download_lease_expires_at is null)),
  add constraint whatsapp_media_quarantine_metadata
    check (
      download_status not in ('quarantined','linked')
      or (download_checksum_sha256 is not null and download_content_type is not null
          and download_byte_size is not null and download_file_name is not null)
    );
-- A provider message has one attachment at each index. Different media IDs at
-- the same position are a conflicting webhook, not a second document.
create unique index whatsapp_message_media_position_uidx
  on whatsapp_message_media(message_id, position);
create unique index whatsapp_message_media_object_key_uidx
  on whatsapp_message_media(download_object_key);
create index whatsapp_message_media_download_due_idx
  on whatsapp_message_media(download_next_attempt_at, created_at)
  where download_status in ('pending','processing');

-- The reachable per-job scheduler admits this pass only after tenant mapping proof.
alter table maintenance_job_runs drop constraint maintenance_job_runs_job_kind_check;
alter table maintenance_job_runs add constraint maintenance_job_runs_job_kind_check check (job_kind in (
  'evaluateEscalations','settleNotificationAttempts','redactNotifications',
  'escalateStalledQuarantine','runBulkOperations','drainInboundMediaDownloads'
));
