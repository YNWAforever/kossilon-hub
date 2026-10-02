# Reviewed NAR monthly import — T14

## Scope and evidence

The existing workbook parser, staging tables, external company mapping and annual-return case domain service remain the authority. This release adds reviewed selected-row apply; it does not send reminders or mark source payment dates as paid.

The supplied audit archive contains no original `.xlsx`/`.xls` workbook. Synthetic tests cover 35 populated rows within 65 formatted rows, duplicate invoices for different companies, Nil/credit notes/absent dates, year and due-date differences, missing mappings and fees. Acceptance of the original workbook remains blocked with the business data owner. Test sessions and synthetic scan records are not fresh Auth or provider evidence.

## Operator workflow

1. Stage the original bytes, explicitly choose the return year and retain SHA256, raw cells and parser version. Replaying the same bytes/sheet reuses staging; a different chosen year is refused. Legacy batches with unknown year require a current-version Admin confirmation and a reason; filenames do not establish the year.
2. Select an existing active company for each `(source_system, external_client_id)`, review the current mapping and explicitly confirm. Existing cases do not exclude companies from this catalogue. No company is invented to fill missing CR/BR information.
3. Select rows and supply actual made-up date, positive invoice fee, invoice reference, eligible owner and annual-return checklist template where required. Review source issues, sheet-year difference and supplied due date versus the 42-day calculation. A source payment date or credit note remains an observation.
4. Preview the selected rows. Review original/candidate values, field differences, required inputs and conflicts. Historical is the default. Client activation additionally requires the current Hong Kong business year and explicit confirmation; an existing case is never silently reclassified.
5. Confirm this immutable preview and create an idempotent job. Approval creates a pending job; the operator explicitly processes at most 100 rows per command. Preview alone writes no domain data. Saved jobs have cursor history and can be reopened after navigation or interruption.
6. Review selected, unselected, applied, conflict, failed, pending and cancelled counts separately. The final item transaction marks the job completed or partial, including an exact 100-item chunk; no extra item-processing call is needed. Unselected rows keep the batch pending. Resolve conflicts through a fresh preview after reviewing the current source and staff work.

Existing case invoice/fee changes and assignments require their separate reviewed domain commands. A changed source invoice is shown beside the existing reference and blocks apply even when no override was typed; existing payment facts remain unchanged. Deadline updates are allowed only before staff progress. Documents, payment evidence, checklist/work activity, parties, requirement instances or package handoffs block an overwrite. Source/company/case/children and current actor authority are checked again inside each transaction.

## Resume and unknown results

The SQL-only worker locks the job and source row and commits case/checklist/payment/work/audit, staged result and full journal together. Two workers cannot commit the same item twice. An actually killed local process after one committed item is covered by the integration test: a new worker resumes pending rows without replaying committed domain work.

Only known PostgreSQL rollback errors (`23505`, `23514`, `40001`, `40P01`) are durably reported as failed. They are not automatically retried. A connection failure or uncertain commit throws; reload the saved job and reconcile its persisted row/journal before issuing an explicit resume. This job has no external send action. Outbox unknown delivery retains its separate no-blind-retry rule.

Cancel only pending items; committed rows and their evidence remain. A new preview/idempotency key is needed to reconsider a failed or conflicted row. Keep original source identities and every successful item visible.

## Historical safety and compensation

Case-level `import_origin` preserves historical imports even when the company is an actual client. Reminder production skips historical cases. Existing outbox claim, cancellation and dispatch-marker checks independently reject messages linked to a historical imported case through a work item or payload case ID. Existing #68 current-state, no-chase and unknown-send guards remain.

Compensation is a read-only preview with the complete before snapshot and a current version comparison covering case, checklist, payment, work, documents, handoffs, parties and requirements. The UI identifies company and source row, displays previous/current deadlines and provides the full before/current snapshot. Errors remain visible with no automatic retry. It never deletes cases or evidence. For an updated deadline, a human must review the prior values and intervening work before authorizing a fresh compensating command. A newly created case is retained for reviewed archival; downloading this preview does not reverse any work or establish submission.

## Migration, release and rollback package

Candidate SQL: `db/migrations/0074_reviewed_nar_apply.sql` and `0075_nar_legacy_year_review.sql`; both applied only to the dedicated local Postgres test database. Canonical schema and physical/ID health manifest are synchronized. The candidate expects 43 source migration IDs (0001–0034 plus 0067–0075), while production was last observed with 66 historical IDs and the separately documented dispatch-marker drift. Do not run the candidate migrator against production without the reviewed historical reconciliation sequence.

0074 adds immutable preview/job/item/journal and attributed mapping records, nullable selected year and nullable case origin. It performs no guessed year/origin backfill. 0075 adds attributed legacy-year confirmation events. Preserve original migration hashes and staging raw/parser values. Neither file activates a scheduler, grants a user, sends a message or fabricates payment evidence.

Before a separately authorized release: review the exact branch/build, reconcile historical ledger/physical shape using `schema-reconciliation.md`, create and verify a restore point, retain row counts/source hashes and inspect the exact forward SQL, deploy only after compatible schema gates pass, then run controlled fresh Admin and original-workbook acceptance. Provider owner supplies actual Auth and scanner/R2 dependencies; Operations supplies genuine scheduler evidence for any later T18 activation.

To roll back the application, stop creating/processing NAR jobs and retain all mappings, previews, jobs, journals and attribution events. Select a schema-compatible rollback build; an old manifest will not recognize these new IDs. Do not drop populated tables, undo successful rows with deletes, change ledger hashes or reset/reseed production. Review current full compensation snapshots before any authorized business correction. Database restore is a separate approved operation with reviewed intervening-data impact.

Read-only release inventory (execute only against the approved target; no mutations):

```sql
SELECT return_year, status, count(*) FROM nar_import_batches GROUP BY 1,2;
SELECT state, count(*) FROM nar_apply_jobs GROUP BY 1;
SELECT state, count(*) FROM nar_apply_job_items GROUP BY 1;
SELECT import_origin, count(*) FROM annual_return_cases GROUP BY 1;
SELECT count(*) AS applied_rows FROM nar_import_rows WHERE applied_at IS NOT NULL;
SELECT count(*) AS journal_records FROM nar_apply_journal;
```

No production SQL, restore, deployment, recipient send or invitation is authorized by this local task's completion.
