-- 0025: staging for the monthly NAR workbook import.
--
-- Nothing here writes a company or a case. That is the point.
--
-- `companies` requires cr_number, br_number, incorporation_date,
-- annual_return_basis_date, registered_office, company_secretary,
-- assigned_owner_id and assigned_team_id -- all NOT NULL, and the two registry
-- numbers globally unique. The workbook supplies a client id and a name. A
-- fabricated BR number would permanently burn a value the real one later needs,
-- so an unmatched row stages here and waits for a person instead.
--
-- `payments` is the same shape of trap from the other direction: unique(case_id)
-- and amount NOT NULL CHECK (amount > 0), and a case with no payment row renders
-- normally on the board but can never be advanced -- staff hit "Annual return
-- payment not found." with no UI anywhere to create one. The workbook has
-- invoice numbers and no amounts, so the importer records the invoice
-- observation here and the apply step asks a human for the fee.

-- The identity column that did not exist. A repo-wide grep for
-- external_ref|external_id|source_system|client_code returned nothing, so a
-- per-firm client code from the spreadsheet had nowhere to land and a second
-- import could not re-identify the row the first one created.
create table if not exists company_external_references (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  source_system text not null,
  external_client_id text not null,
  -- Who confirmed the mapping, and when. A mapping is a human judgement about
  -- which company a client code means, and it is worth being able to ask who.
  mapped_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One external id means one company, within its source system. Without this a
  -- second import could quietly attach the same client code to a second company.
  unique (source_system, external_client_id)
);

create index if not exists company_external_references_company_idx
  on company_external_references (company_id);

create table if not exists nar_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'nar-monthly-workbook',
  source_file_name text not null,
  -- The exact bytes, so a batch can be tied back to the file it came from and a
  -- re-upload of the same file is recognised rather than duplicated.
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_size_bytes bigint not null check (source_size_bytes > 0),
  sheet_name text not null,
  -- Which reader produced the parsed values. A later parser fix changes what a
  -- row means, and without this there is no way to tell which rows predate it.
  parser_version text not null,
  -- The operating period staff chose. Null until they do: the supplied sheet is
  -- named "8.2025" and historical, and reading a period out of a sheet name
  -- would be a guess that silently activates the wrong year's cases.
  period_year integer check (period_year is null or period_year between 1900 and 2100),
  period_month integer check (period_month is null or period_month between 1 and 12),
  status text not null default 'pending_review' check (
    status in ('pending_review', 'applying', 'applied', 'cancelled', 'failed')
  ),
  row_count integer not null default 0 check (row_count >= 0),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  -- Re-importing the same bytes finds the same batch instead of making a second
  -- one. Per sheet, because one workbook legitimately carries a sheet per month.
  unique (source_sha256, sheet_name)
);

create index if not exists nar_import_batches_status_idx
  on nar_import_batches (status, created_at desc);

create table if not exists nar_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references nar_import_batches(id) on delete cascade,
  -- The sheet row, not an ordinal. Column A of the supplied worksheet is a row
  -- number that has a single space on one row, so it is never an identity.
  row_number integer not null check (row_number > 0),
  external_client_id text not null,
  company_name text not null,
  -- Every cell verbatim, with its OOXML type and date-formatted flag, so a
  -- mapping decision can be revisited without re-reading the file.
  raw jsonb not null,
  -- The normalized candidates, with explicit unknowns. A day and month with no
  -- year stays a day and month with no year.
  parsed jsonb not null,
  issues jsonb not null default '[]'::jsonb,
  disposition text not null check (
    disposition in ('new', 'updated', 'unchanged', 'conflict', 'invalid', 'needs_company_mapping')
  ),
  matched_company_id uuid references companies(id) on delete set null,
  matched_case_id uuid references annual_return_cases(id) on delete set null,
  -- Row-level apply results, so an interrupted batch resumes instead of
  -- restarting and a partial success is never presented as all applied.
  applied_at timestamptz,
  applied_case_id uuid references annual_return_cases(id) on delete set null,
  apply_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, row_number)
);

create index if not exists nar_import_rows_batch_disposition_idx
  on nar_import_rows (batch_id, disposition, row_number);

-- Finds every staged row still waiting on a company mapping, across batches.
create index if not exists nar_import_rows_unmapped_idx
  on nar_import_rows (external_client_id)
  where disposition = 'needs_company_mapping';
