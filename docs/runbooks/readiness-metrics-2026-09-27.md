# T03 readiness and operational metrics — local evidence

## Reproduced failures

- A case with all checklist rows marked Verified but payment pending appeared in `readyToFile` (RED work-view test: one false ready row).
- Under one company scope, the board counted a Filed overdue case but the dashboard excluded it (RED disposable-Postgres test: board 2, expected 1).
- The dashboard called a count of outstanding checklist items “Missing documents”, while the board counted cases. A failed or pending board totals query rendered zeros.

## Local implementation

`evaluateCaseReadiness` consumes a consistent snapshot with evidence and payment states, existing `ManifestResult`, the current canonical-manifest hash, human approval, verified submission, reconciled return, and existing completion blockers. Unknown or superseded evidence blocks package approval. A changed manifest invalidates approval. Recording submission is available only before a submission exists; completion needs a verified submission and matched return. The evaluator makes no permission decision; each mutation must reload and re-evaluate the version inside its server transaction.

The current repository has no persisted package approval or authoritative snapshot reader. The “可以交件” view is therefore explicitly unreleased instead of treating checklist completion as filing readiness. Its interface accepts a complete map of server-evaluated readiness results for T14 to connect. An incomplete map cannot release the view.

Board and dashboard now share one authorized SQL aggregate and date, exclude Filed/Completed from active work, and split missing-evidence **cases** from missing-evidence **items**. Payment lacking a proof-document link remains pending. The board does not show zero tiles while the cases/totals queries are pending or failed; a failed totals read offers retry. The dashboard label names cases, not items. The high-risk board tile remains explicitly limited to loaded rows; a firm-wide risk aggregate requires a separately validated domain projection.

## Verification boundary

The SQL aggregate was compared with `summarizeOperationalCases` over scoped disposable-Postgres fixtures, including an active case with two missing items and a Filed overdue case. This is local evidence, not production proof. The 2026-09-28 read-only production ledger still has 21 entries through 0020 plus unknown legacy 0006; the deployed app DB binding is unverified. T14 package approval persistence and transactional revalidation now exist. T03 remains in progress until a consistent snapshot reader, indexed readyToFile view, authorized runtime role checks and deployment verification are complete.

## T03 return acceptance follow-up — 2026-09-28

A named RED test found that `evaluateCaseReadiness` returned `canComplete=true` for a matched, timestamped but **rejected** return. The existing return service and server completion path require outcome `accepted` and human reconciliation decision `confirm`; the pure readiness snapshot omitted both fields. Its contract now carries the return service outcome and decision, and reports `return-unresolved` unless ID, matched status, accepted outcome, confirmed decision and verification time are all present. A second negative case covers `mark-unmatched`.

Focused readiness, work-view, package and return tests passed 5 files / 33 tests against disposable PostgreSQL. Typecheck and Vercel preset build passed; lint had 0 errors and 1 inherited warning. No migration or provider call was needed. The evaluator still has no production snapshot reader/caller, so this is a local contract fix only. T03 remains in progress until the package and payment snapshot can be read consistently and the indexed `readyToFile` view can show complete scoped results without false zeroes; server mutations continue to revalidate inside their transactions.
