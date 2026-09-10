-- 0024: let an upload say which checklist item it answers.
--
-- There was no link at all. `grep -rn "checklist" src/features/documents/`
-- returned nothing: the upload carried company, case, category, file name,
-- content type, size and checksum, and stopped there. So a document a client
-- sent was invisible to the checklist that had asked for it, and the checklist
-- item stayed 'Missing' forever.
--
-- The consequences ran straight out to the client. Both the portal summary and
-- the case detail counted `required && status <> 'Verified'` as "still waiting
-- on you", and `deriveProductionFollowUpDrafts` emitted a chase for every
-- mutable case with no outstanding-work test at all -- so a client who had
-- uploaded every document was told, and re-told, that we were still waiting for
-- them. (Before 0023 the cron then deleted the bytes about fifteen minutes
-- later, so the document was neither visible nor recoverable.)
--
-- 'Received' has been in the status check constraint since 0001 and nothing ever
-- wrote it. This column is what lets a finalize write it honestly.
--
-- Nullable on purpose. An upload that names no checklist item is real and stays
-- real: it is unassigned evidence a person has to map, and forcing a link would
-- either block that upload or invite a guessed one. `on delete set null` because
-- a checklist item can be replaced when a template changes, and losing the item
-- must not take the document with it -- the bytes and the review history outlive
-- the requirement that asked for them.

alter table document_upload_intents
  add column checklist_item_id uuid references annual_return_checklist_items(id) on delete set null;

-- Supports "which uploads answer this requirement", which is the read the case
-- detail and the review workspace both make. Partial because the column is null
-- for every unassigned upload and those are not looked up this way.
create index if not exists document_upload_intents_checklist_item_idx
  on document_upload_intents (checklist_item_id)
  where checklist_item_id is not null;

-- Existing rows are deliberately left null rather than back-linked by guessing
-- from (case_id, category). That mapping is exactly the ambiguity Phase C's
-- person-level requirement slots exist to resolve, and a wrong guess here would
-- mark a requirement satisfied by a document that does not answer it.
