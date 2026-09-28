# T21 checklist template versions and usage

Scope: local T21 implementation on `codex/kossilon-template-usage`, stacked on T20. K15 and the template portion of K22 have local evidence. No production database, case, external recipient, or deployment was changed.

## Version and case contract

`db/migrations/0047_checklist_template_versions.sql` creates immutable published snapshots. It snapshots active legacy template definitions as `legacy_baseline` **for future cases only**. Historical cases keep a null version reference: their actual prior template cannot be inferred. The settings page shows the count of these unknown cases separately; the current version's usage count is labelled **all linked cases**, with paged links to the actual annual-return case IDs. It does not display the old mock count.

New templates and duplicates start as drafts. An Admin publishes a reviewed revision into an immutable version. A stale editor revision fails, and an unchanged already published Admin version is refused. Newly created annual-return cases lock and copy the selected published version, store its ID on the case, and store each template document ID on the case checklist item. The new-case chooser uses the immutable published name and service type even when an Admin has edited an unpublished draft. Publishing a later version changes only future cases. Archiving a template preserves published versions and old case links. Demo remains read-only.

`previewTemplateRolloutForActor` checks selected cases against two published versions of one template and returns the requirement diff, current case revision, preserved evidence IDs, and a recalculated required-document readiness result. It flags changed or removed Verified requirements and excludes package handoffs and Filed/Completed cases. `applyTemplateVersionToCaseForActor` is the transaction-safe single-case domain write: it rechecks the current Admin profile, locks case and checklist rows, requires the previewed version and expected revision, preserves Verified evidence, inserts new required rows as Missing, retains removed unverified rows as nonrequired, then records the version and audit event. A stale replay fails. This T21 PR exposes preview, **not a user-facing batch commit**; a later batch runner must call the single-case service for each item with T09-style durable preview, authorization, dedupe, progress, and resume. Template publication itself is never a case batch approval.

## Database gate and rollback

The local disposable database reached migration 0047 with no missing, unknown, or definition-mismatched ledger entries and eleven compatibility capabilities ready. The exact guarded rollback is `docs/runbooks/checklist-template-rollback-0047.sql`. On a second disposable database, forward migration, empty rollback, and reapply passed. A fixture with a changed template revision made that rollback refuse; a direct UPDATE of a published version was refused by the immutable trigger. Once a case references a version or an Admin publication exists, use forward repair preserving history.

Before any separately authorized production migration, bind the **actual intended database**, compare its migration ledger and schema definitions, back it up, and review these read-only data checks:

```sql
select count(*) as historic_cases_without_version
from annual_return_cases;

select t.id, t.name, d.value->>'id' as document_id, count(*) as duplicate_count
from checklist_templates t
cross join lateral jsonb_array_elements(t.documents) as d(value)
where t.active
 group by t.id,t.name,d.value->>'id'
having count(*) > 1 or d.value->>'id' is null or d.value->>'id' = '';
```

The first query is a **pre-migration** baseline count, not a version attribution. Active templates with duplicate or absent document IDs need review before cases can use their baseline snapshot. T03's production binding and legacy 0006 ledger discrepancy, plus migrations 0021–0047, remain unresolved. This assignment does not authorize production SQL.

## Runtime proof still required

1. Reconcile and authorize the target database migration and current deployment SHA; inspect the real legacy usage count and sampled case provenance without assigning a guessed version.
2. In an authorized nonproduction runtime, test Admin edit/publish/archive with two staff sessions, a newly created case, and a prior case. Verify the prior case retains its old checklist and Verified evidence.
3. Verify preview and any later approved batch apply against locked/delivered/closed cases, concurrent case edits, partial failures, and resume. Do not label a preview or template publication as an applied batch.
4. Check independent remote CI and deployment results. A preview build or local green suite alone does not prove pilot acceptance.

## Local verification on 2026-09-27

- Named T21 RED import failure before the usage module, then focused GREEN: 6 files, 98 tests, including the disposable PostgreSQL version/apply fixture.
- Disposable migration 0047 forward, empty rollback/reapply, nonempty rollback refusal, and immutable-version trigger refusal passed. Local schema inspection current with eleven capabilities.
- Final disposable-Postgres full suite: 211/211 files, 1,855 passed, two environment-gated tests skipped. The first run found two stale demo-import allowlists after settings stopped importing fixtures; those allowlists were tightened, focused tests passed 32/32, and the complete suite then passed. The unpublished-draft chooser regression was RED 1/20 and GREEN 20/20. A 51-case usage pagination check passed.
- Typecheck and build passed. Lint had zero errors and one existing `react-refresh/only-export-components` warning in `src/routes/work-queue.tsx`. `verify:firm --dry-run` made 38 reads, zero network calls and zero writes.
