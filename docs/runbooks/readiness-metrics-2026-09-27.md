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

The SQL aggregate was compared with `summarizeOperationalCases` over scoped disposable-Postgres fixtures, including an active case with two missing items and a Filed overdue case. This is local evidence, not production proof. Production still lacks migrations 0021–0033. T03 remains in progress until the T14 package approval/snapshot reader, server mutation re-evaluation, authorized live role checks, and deployment verification are complete.