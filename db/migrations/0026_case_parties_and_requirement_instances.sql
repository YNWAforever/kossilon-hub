-- 0026: who a requirement applies to, and which pages answer it.
--
-- `annual_return_checklist_items` is one row per requirement per case, with a
-- single `document_id`. That shape cannot express the thing this firm actually
-- does: two directors need two identity documents, and one row with one document
-- column has no way to say that the second one is missing. Five uploaded files
-- containing duplicates and no CDD look, to that model, like plenty.
--
-- These three tables extend the checklist rather than replace it. Every
-- requirement instance points at the checklist item it refines, so
-- hasRequiredChecklistEvidence, the board metrics, the completion blockers and
-- every existing read keep working on exactly the rows they always did. Nothing
-- here is a second, competing checklist authority.
--
-- Parties reference `officers` where the person is already known to the company.
-- Duplicating names into a new table would have created two spellings of the same
-- director and no way to tell which was current.

create table if not exists case_parties (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  -- Set when this party is a company officer already on file. Null for a party
  -- the officer register does not carry -- a corporate shareholder, say -- which
  -- is real and must not be forced into the officer table to be representable.
  officer_id uuid references officers(id) on delete restrict,
  party_type text not null check (
    party_type in (
      'director', 'secretary', 'designated_representative', 'shareholder', 'company', 'other'
    )
  ),
  display_name text not null,
  -- Confirmation is a human act. An unconfirmed party is a candidate, and a
  -- requirement must never be judged complete or incomplete against a guess
  -- about who the parties are.
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists case_parties_case_idx on case_parties (case_id, active);

-- One row per officer per case. Partial, because officer_id is null for parties
-- the officer register does not carry and several of those on one case is normal.
create unique index if not exists case_parties_case_officer_uidx
  on case_parties (case_id, officer_id)
  where officer_id is not null;

create table if not exists case_requirement_instances (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  -- The checklist row this refines. The existing item stays the authority for
  -- the case's overall state; this says who it applies to.
  checklist_item_id uuid not null references annual_return_checklist_items(id) on delete cascade,
  -- Null means the requirement is about the company rather than a person -- an
  -- NAR1 is not owed by a director.
  party_id uuid references case_parties(id) on delete cascade,
  requirement_key text not null,
  -- Which version of the approved template produced this. A rule change makes a
  -- new instance rather than editing an old one, so a decision recorded under
  -- the previous rule stays legible as a decision under the previous rule.
  template_version text not null,
  applicability text not null default 'required' check (
    applicability in ('required', 'not_applicable', 'waived')
  ),
  applicability_reason text,
  -- For age-limited evidence such as address proof: the date the age is measured
  -- from. Null where the requirement has no such rule; never defaulted to today,
  -- which would silently re-age every document each time it was read.
  reference_date date,
  -- A waiver is somebody's decision and is attributable.
  authorized_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_requirement_waiver_needs_reason check (
    applicability = 'required' or applicability_reason is not null
  )
);

create index if not exists case_requirement_instances_case_idx
  on case_requirement_instances (case_id);

create index if not exists case_requirement_instances_item_idx
  on case_requirement_instances (checklist_item_id);

-- One instance per party per checklist item, and exactly one company-level
-- instance per item. Split in two because a plain unique constraint treats every
-- NULL party_id as distinct, which would let an item collect any number of
-- company-level instances.
create unique index if not exists case_requirement_instances_party_uidx
  on case_requirement_instances (checklist_item_id, party_id)
  where party_id is not null;

create unique index if not exists case_requirement_instances_company_uidx
  on case_requirement_instances (checklist_item_id)
  where party_id is null;

create table if not exists requirement_evidence_links (
  id uuid primary key default gen_random_uuid(),
  requirement_instance_id uuid not null
    references case_requirement_instances(id) on delete cascade,
  -- on delete restrict: the link is the record of why a document was accepted,
  -- and losing it silently would leave a satisfied requirement with no evidence.
  document_id uuid not null references documents(id) on delete restrict,
  -- A single PDF can answer several requirements from different pages. Null means
  -- the whole document.
  page_from integer check (page_from is null or page_from >= 1),
  page_to integer check (page_to is null or page_from is null or page_to >= page_from),
  linked_by uuid references users(id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists requirement_evidence_links_instance_idx
  on requirement_evidence_links (requirement_instance_id);

create index if not exists requirement_evidence_links_document_idx
  on requirement_evidence_links (document_id);

-- coalesce, because the plain tuple would treat two whole-document links as
-- distinct and let the same file be attached to one requirement repeatedly.
create unique index if not exists requirement_evidence_links_uidx
  on requirement_evidence_links (
    requirement_instance_id, document_id, coalesce(page_from, 0), coalesce(page_to, 0)
  );

-- Conservative backfill.
--
-- One company-level instance per existing checklist item, and nothing else. A
-- generic identity requirement is NOT split into per-director instances here:
-- the existing row records that some identity evidence was wanted, not whose,
-- and inventing two directors from one row would manufacture exactly the
-- per-person judgement this phase exists to let a human make.
--
-- template_version says 'legacy' so a row that predates any approved template is
-- never mistaken for one produced under it.
insert into case_requirement_instances (
  case_id, checklist_item_id, party_id, requirement_key, template_version, applicability,
  applicability_reason
)
select
  i.case_id,
  i.id,
  null,
  i.item_label,
  'legacy',
  case when i.required then 'required' else 'not_applicable' end,
  case when i.required then null else 'Not marked required on the original checklist row.' end
from annual_return_checklist_items i
on conflict do nothing;

-- Carry across the one document each item already pointed at, so an existing
-- approval keeps its evidence. Whole-document links: the old model had no page
-- ranges and inventing them would be a claim about content nobody made.
insert into requirement_evidence_links (requirement_instance_id, document_id, note)
select r.id, i.document_id, 'Carried over from the checklist item document link.'
from annual_return_checklist_items i
join case_requirement_instances r
  on r.checklist_item_id = i.id and r.party_id is null
where i.document_id is not null
on conflict do nothing;
