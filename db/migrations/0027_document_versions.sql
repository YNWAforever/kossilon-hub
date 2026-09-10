-- Phase C-1: a document that has versions.
--
-- `documents` has no version column, no supersession pointer and nothing
-- content-derived. The nearest thing to a version is one row per attempt in
-- `document_upload_intents`. So "approve this exact version" cannot be
-- expressed, and a replacement upload has no defined relationship to the file
-- it replaces -- a reviewer approves "the document", and which bytes that meant
-- is whatever was current when they clicked.
--
-- The declared/verified split is the important part of this migration.
-- `document_upload_intents.checksum_sha256` and `expected_size_bytes` are
-- supplied by the client when the intent is created and are never checked
-- against the stored object by any enabled code path: only the provider scanner
-- reads the bytes and hashes them, and it is BLOCKED_INTEGRATION. Recording
-- that claim in a column called `checksum_sha256` and then hashing it into a
-- package manifest would certify whatever the uploader typed. So a claim is
-- stored as a claim, and content identity stays NULL until something has
-- actually read the object.

create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  version_number integer not null check (version_number >= 1),

  -- What the uploader said the bytes would be, from the intent. A claim.
  declared_checksum_sha256 text
    check (declared_checksum_sha256 is null or declared_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  declared_byte_size bigint check (declared_byte_size is null or declared_byte_size > 0),

  -- What the stored bytes actually hash to, computed server-side over the object
  -- in R2. NULL means nobody has looked. That is the true state of every row
  -- today, and it is left visible rather than backfilled from the declared value
  -- -- copying a claim into a column named `verified` is how an unverifiable
  -- document ends up in a signed manifest.
  verified_checksum_sha256 text
    check (verified_checksum_sha256 is null or verified_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  verified_byte_size bigint check (verified_byte_size is null or verified_byte_size >= 0),
  verified_at timestamptz,

  -- Nullable: known only from the intent. Deliberately not defaulted from
  -- documents.file_type, which despite its name holds the requirement category
  -- ('identity', 'registry', 'payment', ...) and not a MIME type. There is no
  -- 'address-proof' category; DOCUMENT_CATEGORIES is the vocabulary.
  content_type text,
  file_name text not null,
  storage_url text not null,

  intent_id uuid references document_upload_intents(id) on delete restrict,

  -- Forward pointer, so "the current version" is one indexable predicate rather
  -- than a not-exists over the whole chain.
  superseded_by_version_id uuid references document_versions(id) on delete restrict,
  superseded_at timestamptz,
  superseded_reason text,

  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),

  -- A version is either current or superseded. Without this, "current" quietly
  -- depends on which of the two columns the reader happened to check.
  constraint document_versions_supersede_agrees check (
    (superseded_by_version_id is null and superseded_at is null)
    or (superseded_by_version_id is not null and superseded_at is not null)
  ),
  constraint document_versions_no_self_supersede check (superseded_by_version_id <> id),
  constraint document_versions_verified_pair check (
    (verified_checksum_sha256 is null and verified_at is null)
    or (verified_checksum_sha256 is not null and verified_at is not null)
  )
);

create unique index if not exists document_versions_number_uidx
  on document_versions (document_id, version_number);

-- Exactly one current version per document, enforced rather than assumed by the
-- code that reads it.
create unique index if not exists document_versions_current_uidx
  on document_versions (document_id)
  where superseded_by_version_id is null;

-- One upload produces at most one version.
create unique index if not exists document_versions_intent_uidx
  on document_versions (intent_id)
  where intent_id is not null;

create index if not exists document_versions_verified_checksum_idx
  on document_versions (verified_checksum_sha256)
  where verified_checksum_sha256 is not null;

-- Extracted text lives in its own table so that a version row is written once,
-- at upload, and never rewritten by an analysis run. An extraction pass that
-- could touch the version row could touch storage_url or a checksum with it;
-- this makes that structurally impossible rather than a rule to remember.
create table if not exists document_version_texts (
  document_version_id uuid primary key references document_versions(id) on delete cascade,
  extracted_text text,
  page_count integer check (page_count is null or page_count >= 0),
  -- 'none' is a real outcome: a scanned image with no text layer and no OCR
  -- available. It is not the same as "not extracted yet", which is no row.
  extraction_method text not null check (
    extraction_method in ('text-layer', 'ocr', 'provider', 'none')
  ),
  truncated boolean not null default false,
  extractor_version text not null,
  extracted_at timestamptz not null default now()
);

-- Backfill: every existing document becomes version 1 of itself, so that
-- nothing in the codebase has to special-case "documents that predate
-- versioning". The intent, where one exists, supplies the declared claim; a
-- staff- or system-created document has no intent and therefore no claim, and
-- both are left NULL rather than invented.
insert into document_versions (
  document_id, version_number, declared_checksum_sha256, declared_byte_size,
  content_type, file_name, storage_url, intent_id, uploaded_by, created_at
)
select
  d.id,
  1,
  i.checksum_sha256,
  i.expected_size_bytes,
  i.content_type,
  d.file_name,
  d.storage_url,
  i.id,
  d.uploaded_by,
  d.uploaded_at
from documents d
left join lateral (
  select x.id, x.checksum_sha256, x.expected_size_bytes, x.content_type
  from document_upload_intents x
  where x.document_id = d.id
  order by x.created_at asc
  limit 1
) i on true
where not exists (select 1 from document_versions v where v.document_id = d.id);
