# Payment read recovery — local evidence; Native NO_GO

Date: 2026-10-26. Continued draft PR #147 on `codex/cosec-20261023` from `9c5127938060ad1ed7fdc42d155ff2c78abd9f26` (base main `1c57a67213af72bff8d776694e6ed8c986b921db`). No existing work was overwritten and no pushed history was rewritten.

## Reproduction and repair

The payment page already separated failed reads from an empty queue, but its initial case-list/document-list error had no in-page recovery control. The new three-case regression failed at the missing retry button (3 failed / 5 passed). This is a newly reproduced local gap, not a reinterpretation of the older COVERAGE review as a known outstanding defect.

The error now offers `重新載入付款資料`. It refetches only failed reads, uses `cancelRefetch: false`, and disables while either list is fetching. Initial recovery uses the existing loading state. Payment record/review commands are never called by recovery. Four new component cases cover case-only, document-only, combined failure and pending recovery; recovered empty state appears only after successful reads. Server functions remain mocked; these are JSDOM interactions, not HTTP/Auth/RLS proof.

The pending-recovery test first expected a disabled error button, then was corrected after observing TanStack's initial refetch transitions to pending and removes the error control. The implementation did not change for that test correction.

## Verification and limits

See receipt.json for exact commands, results, tested file hashes and code commit. RED and sandbox failure logs are retained alongside successful receipts. The first broader unit run used the three new regression cases; the final run includes the fourth pending-recovery test. Typecheck and changed-file lint were repeated after the fourth test. No DB client, fixture, migration, browser deployment, production resource change or Native packet was executed. Build and hosted CI are not claimed by this delivery.

Historical source `4d63818` and its local build receipts remain historical. This repair changes product source: a future Native run must review the delta and bind the new candidate/artifact; it cannot reuse old source/artifact equivalence claims.

## Remaining gates and next engineering steps

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Original 184 acceptance rows, IDs, relations and historical failures are untouched.

1. Review employee-path recovery with concrete reproductions; expand local coverage only for real gaps, rather than adding mock counts to close Native gates. Per-proof case-read recovery and mutation-conflict recovery remain separate review candidates, not claims made by this repair.
2. Bind the approved isolated candidate deployment, required CI/security results, DB catalog/ledger/app-role and actual Auth roles before executing any Native packet. Current approval files are preparation only; prior AP-01 metadata authority is closed.
3. Run Today → correct company/case → document safety/payment/blocker → authorized action → independent readback → return/reload under real roles, including rejected/duplicate/cancel/unknown outcomes. Real HTTP/RLS concurrency and UC186's 104 responsibilities remain outstanding.
4. Obtain approved calendar/UC134 oracle, storage/scan/provider receipts, scheduler ticks, backup/object restore and device/accessibility/performance evidence as specified in the existing Native checklist. No production deployment or resource change is authorized by this work.

References: ../cosec-20261025-native-plan-fccb7c22/blockers.md, APPROVAL-CHECKLIST.md and COVERAGE.md in that directory. No Native approvals or statuses were changed.
