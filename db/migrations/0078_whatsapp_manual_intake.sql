-- Add an observed mapping revision and explicit universal-media lineage.
-- Existing waMediaId references remain legacy; no download, scan or receipt backfill.
alter table whatsapp_messages add column if not exists mapping_revision integer not null default 0 check (mapping_revision >= 0);
alter table whatsapp_message_media add column if not exists provider_media_kind text not null default 'legacy-wa-media' check (provider_media_kind in ('file','legacy-wa-media'));
alter table whatsapp_message_media add column if not exists intake_intent_id uuid references document_upload_intents(id) on delete restrict;
create index if not exists whatsapp_unmatched_receipt_idx on whatsapp_webhook_events ((coalesce(payload->'data'->>'messageId',payload->>'messageId')),received_at) where provider='woztell' and signature_valid and processing_status='ignored';
