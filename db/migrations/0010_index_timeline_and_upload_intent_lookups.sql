-- Two query shapes the repositories rely on had no index behind them.
--
-- The client detail timeline reads timeline_events by company
-- (src/features/clients/repository.ts: `where te.company_id = ...`), but the only
-- index on that table is (case_id, created_at desc), so the busiest table in the
-- schema was sequentially scanned on every client page load.
--
-- The document reads join document_upload_intents on document_id
-- (src/features/documents/repository.ts: `join document_upload_intents i on
-- i.document_id = d.id`), and document_id carried no index at all —
-- document_upload_intents_cleanup_idx covers the expiry sweep, not this join.

create index if not exists timeline_events_company_created_idx
  on timeline_events (company_id, created_at desc);

create index if not exists document_upload_intents_document_idx
  on document_upload_intents (document_id)
  where document_id is not null;
