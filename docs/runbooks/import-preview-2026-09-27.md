# T10 monthly import preview: local evidence and release gate

T10 separates workbook bytes from import meaning. The source SHA-256 remains the raw file hash. New batch identity is source hash + sheet + explicitly chosen return year + parser version. Mapping revisions change the semantic key; successful mapping recomputes every affected unapplied row and its counts inside one transaction. A saved preview binds the batch revision, actor, row revisions, field before/after values, original workbook cell and policy. It is a review snapshot, not approval or apply. The payment date is observation-only and neither Nil nor a blank cell clears a human value. Existing `Filed`/`Completed` case state is not changed. Demo remains read-only.

Admin-only server functions provide paged company search, including companies with cases, bounded row review, mapping, and revisioned revalidation. A client ID already mapped to another company is rejected as a conflict; T10 does not silently overwrite that binding. Manager/Staff cannot search or preview cross-team workbook data. The UI keeps query errors distinct from empty results and offers retry. Legacy batches lack a trustworthy return year because the old staging function discarded the supplied year. A staff member must explicitly enter the year on the existing batch before revalidation; the system never derives it from the sheet name or current date. This repairs mapping without reuploading the workbook.

## Local verification

- RED: missing company search and same-byte/different-year reuse reproduced in named T10 tests; the existing serial/text/Nil/formula parser checks were GREEN before changes.
- GREEN: three named scenarios cover all three seeded existing companies, cursor pagination, same-year replay, different-year separation, immediate mapping/count refresh, stale revision refusal, legacy in-place repair, exact source cell, payment observation policy, 50-row review paging, duplicate external IDs and date provenance.
- Separate Admin-only search/preview server test and T02 read-error UI regression remain GREEN.
- Disposable PostgreSQL 17 migrated from 0001 through 0038 with `db:inspect` current. This is local schema evidence, not the observed production Neon schema.
- Full disposable-Postgres suite: 190/190 test files, 1764/1764 tests; typecheck and build passed; lint had 0 errors and 1 pre-existing Fast Refresh warning; 13 dev-server routes including `/imports` loaded without import-protection errors. `verify:firm --dry-run` performed 38 reads and 0 network calls or writes; live integrations remained BLOCKED.

## Schema, production preview and activation

Forward file: `db/migrations/0038_nar_import_preview.sql`. It adds nullable return year, parser column map, batch and row revisions, mapping revision, semantic key, and durable `nar_import_previews`. It replaces the old `(source_sha256,sheet_name)` uniqueness with semantic and legacy partial unique indexes. Old batches stay nullable and keep their original raw hash. No automatic backfill guesses a year. Production remains at the T00 read-only observation: migrations 0021–0033 were absent, an unknown legacy `0006_client_register.sql` appeared, and the deployed DB binding was not verified. Do not apply 0038 independently of that reconciliation.

Before any authorized production migration, record the target identity and counts without writing:

```sql
select current_database(), current_user, inet_server_addr();
select id, applied_at from schema_migrations where id >= '0021' order by id;
select count(*) as batches, count(*) filter (where status <> 'pending_review') as non_pending
from nar_import_batches;
select count(*) as applied_rows from nar_import_rows where applied_at is not null;
select conname from pg_constraint
where conrelid = 'nar_import_batches'::regclass and contype = 'u';
```

Review a backup/restore point, forward SQL, exact target binding, lock window and the full 0021–0038 migration path. Runtime acceptance needs an authorized Admin search that finds the existing companies, a historical workbook review, mapping with immediate counts, a second explicit return-year preview, and audit evidence without creating cases or payments. T11 approval/apply remains separate.

## Guarded reversal for an evidence-free clone

Stop import writes first. This reversal is valid only if no T10 preview, semantic batch, revised row, or column map exists. It was rehearsed on a second disposable PostgreSQL 17 database: a synthetic semantic batch made the guard reject; after deleting only that fixture, the reversal committed. `nar_import_previews` and the 0038 ledger entry were absent; the old raw-byte unique constraint was present.

```sql
begin;
lock table nar_import_previews,nar_import_rows,nar_import_batches in access exclusive mode;
do $$ begin
  if exists (select 1 from nar_import_previews)
    or exists (select 1 from nar_import_batches where return_year is not null
      or revision <> 1 or mapping_revision <> 0 or semantic_key is not null
      or column_mapping is not null)
    or exists (select 1 from nar_import_rows where source_issues is not null or revision <> 1)
  then raise exception 'T10 rollback blocked: semantic import or preview evidence exists';
  end if;
end $$;
drop table nar_import_previews;
drop index nar_import_batches_semantic_identity_idx;
drop index nar_import_batches_legacy_identity_idx;
alter table nar_import_batches
  drop column return_year,
  drop column revision,
  drop column mapping_revision,
  drop column semantic_key,
  drop column column_mapping;
alter table nar_import_batches
  add constraint nar_import_batches_source_sha256_sheet_name_key unique (source_sha256,sheet_name);
alter table nar_import_rows
  drop column source_issues,
  drop column revision;
delete from schema_migrations where id = '0038_nar_import_preview.sql';
commit;
```

No production database, external recipient, role, invitation or deployment was changed for T10.
