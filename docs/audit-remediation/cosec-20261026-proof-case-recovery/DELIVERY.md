# Per-proof case read recovery — local only; Native NO_GO

Date: 2026-10-26. Continued existing draft PR #147 on `codex/cosec-20261023` from `9aaf2b8912dc6bb3606abde2e8122e8846ab6e18`. Reviewed the current PR description, Native blockers, COVERAGE, APPROVAL-CHECKLIST target gates, and the preceding payment-list delivery. Existing scratch files under work/ were preserved.

## Product change and reproduction

Payment-list recovery did not retry the actor-scoped `getAnnualReturnCase` request used by each proof. A transient failure in that separate read left the proof permanently unavailable in-page even though both lists had loaded. This is a newly reproduced local recovery gap, not an outstanding Native item being relabelled as locally complete.

The unavailable proof row now offers `重新載入案件資料`, with the proof filename in its accessible name. It retries only that case read with `cancelRefetch: false`; it does not replay record/review commands or refetch successful lists. Loading hides the initial retry and all review fields; for retained unavailable data the retry is disabled during fetching. Missing, denied or mismatched case results still expose no case details or review controls. If a document-list refresh failed, row recovery is unavailable until list recovery succeeds, preserving the existing fail-closed document gate. Actor-scoped query keys and all server authorization/version checks are unchanged.

Five new component cases cover transient case failure → pending read → fresh source version → explicit version-bound action; three unavailable retry results (missing, denied, mismatched); and document-list failure preventing row recovery. Four new cases failed before the fix at the absent retry control; the document-gate control already passed. Targeted RED: 4 failed / 21 passed. Targeted GREEN includes the payment-list suite: 34 passed / 2 files.

These are real component interactions with mocked server boundaries in JSDOM. The explicit action assertion proves the submitted local request uses the newly read source version; it is not evidence of an actual persisted payment, authorization, HTTP, independent DB readback or Native acceptance.

## Verification

Exact commands, exit codes, tested file SHA256 values and code commit are in receipt.json; RED and GREEN logs are retained. The broader run selects the repository's unit project, excluding DB/integration targets, and uses executor child-process support because CLI tests were blocked by sandbox spawnSync EPERM in the preceding session. No dependency reinstall or test weakening was needed.

No DB client, fixture, migration, Native packet, Auth session, storage/provider action, production resource change or deployment was executed. Build and hosted CI acceptance were not run or claimed. New product source requires fresh candidate/artifact binding before any later approved Native acceptance; earlier build receipts remain historical.

## Remaining blockers and next steps

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Original 184 acceptance rows, IDs, relationships and failure history are untouched. APPROVAL-CHECKLIST and approval-request.json remain preparation only; no new Native authority is inferred from local repair/push authorization.

- Next local review candidate: mutation conflict/unknown-result recovery with a concrete reproduction; do not replay writes simply because a read recovered. Today/case/doc journeys still require full runtime evidence, not inferred coverage from this payment slice.
- Bind the new candidate/artifact, required CI/security acceptance, isolated DB catalog/ledger/app-role and real Auth identities before Native execution.
- Complete Today → correct case → safe documents/payment/blocker → authorized action → API + independent data readback → return/reload with true roles, revocation, cross-team denial and HTTP/RLS concurrency, including UC186's 104 responsibilities.
- Approved Hong Kong calendar/UC134, storage/scan/provider receipts, scheduler ticks, backup/object restore and actual device/accessibility/performance evidence remain outstanding.

This delivery closes only per-proof case-read recovery locally. It does not close payment mutation recovery or any Native gate. PR stays draft; no merge or ready-for-review transition.
