-- Phase E: what was handed to the filing agent, and what came back.
--
-- C-5 produces the manifest -- the exact requirements, parties, document
-- versions and verified hashes a Kossilon approval was recorded over -- and
-- canonicalManifestPayload is the byte string that approval covers. This is
-- where that package leaves the building, and where its return is reconciled
-- against it.
--
-- Nothing here transmits anything. The destination is the firm's internal
-- server, and its protocol, address and rights are not known to this repository.
-- BLOCKED_INTEGRATION: external-handoff-destination. So a handoff is prepared and
-- stays prepared; `transmitted_at` is null on every row, and the adapter that
-- would fill it is written against a declared contract and disabled.
--
-- The manifest hash is the identity of the package, not a convenience. A return
-- is reconciled against it: if the agent hands back something that does not
-- correspond to what the hash covers, that is an exception a person must see
-- rather than a discrepancy the system absorbs.

create table if not exists package_handoffs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete restrict,

  -- The approval this handoff carries. Both the hash and the payload it was
  -- computed over: the payload so a later reader can recompute and verify rather
  -- than trust, and the hash so a comparison is cheap.
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_payload text not null,

  -- Who approved the package, and who released it. Deliberately two columns:
  -- approving a package and handing it to an outside party are different acts,
  -- and a firm may well want them to be different people.
  approved_by uuid not null references users(id),
  released_by uuid not null references users(id),

  status text not null default 'prepared' check (
    status in ('prepared', 'transmitted', 'acknowledged', 'returned', 'failed', 'cancelled')
  ),

  -- Null until something actually transmits. That is every row today.
  transmitted_at timestamptz,
  -- The destination's own identifier for the submission, when it gives one.
  destination_reference text,
  last_error_code text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A status that claims transmission must carry the moment it happened, or
  -- "has this been sent" has two answers that can disagree.
  constraint package_handoffs_transmission_agrees check (
    (status in ('prepared', 'failed', 'cancelled') and transmitted_at is null)
    or (status in ('transmitted', 'acknowledged', 'returned') and transmitted_at is not null)
  )
);

-- One live handoff per case. A second prepared package for a case already out
-- with the agent is a mistake, not a second filing; the partial predicate lets a
-- cancelled or failed one be replaced.
create unique index if not exists package_handoffs_live_uidx
  on package_handoffs (case_id)
  where status in ('prepared', 'transmitted', 'acknowledged');

create index if not exists package_handoffs_status_idx
  on package_handoffs (status, created_at desc);

-- What came back.
--
-- A return is evidence about a handoff, so it points at one. It may also carry a
-- document -- the stamped filing, a receipt -- which goes through the ordinary
-- document pipeline and therefore the ordinary malware gate.
create table if not exists handoff_returns (
  id uuid primary key default gen_random_uuid(),
  handoff_id uuid not null references package_handoffs(id) on delete restrict,

  -- Null when no document accompanied the return, and null for a return nobody
  -- could match to material we sent. An unmatched return is precisely the
  -- exception this table exists to surface; discarding it would make the anomaly
  -- invisible.
  document_id uuid references documents(id) on delete set null,

  outcome text not null check (
    outcome in ('accepted', 'rejected', 'partial', 'unmatched')
  ),
  -- The agent's own words, kept verbatim. Never parsed into a decision.
  detail text,
  -- Whether the returned material corresponds to the manifest that was sent.
  -- Null means nobody has checked yet, which is different from checked-and-fine.
  reconciled_at timestamptz,
  reconciled_by uuid references users(id),

  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint handoff_returns_reconciliation_agrees check (
    (reconciled_by is null and reconciled_at is null)
    or (reconciled_by is not null and reconciled_at is not null)
  )
);

create index if not exists handoff_returns_handoff_idx
  on handoff_returns (handoff_id, received_at desc);

-- The exception queue: returns nobody has reconciled, and returns that came back
-- rejected. Both need a person.
create index if not exists handoff_returns_open_idx
  on handoff_returns (received_at)
  where reconciled_at is null or outcome in ('rejected', 'partial', 'unmatched');
