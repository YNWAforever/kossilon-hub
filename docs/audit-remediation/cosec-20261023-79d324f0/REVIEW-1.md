# REVIEW-1 — immutable review as delivered

Date: 2026-10-23 (Asia/Hong_Kong)
Worktree: `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`
Branch: `codex/cosec-20261023`
Base and HEAD: `1c57a67213af72bff8d776694e6ed8c986b921db`
Candidate: dirty tracked and new files; no candidate commit.

This preserves the review delivered before subsequent repairs. Later dispositions belong in separate evidence files; do not amend this record.

Four actionable findings remain in the updated source:

1. **[P1] Pending sign-out can restore the same account.** `src/features/auth/auth-context-neon.tsx:311` clears the session and marks hydration complete before remote sign-out settles. The protected shell redirects to login, remounting the actor-keyed provider. If sign-out is slower than the new session reads, login restores the still-valid account and navigates back to protected content. Keep an explicit sign-out state that prevents rehydration across remounts. Regression: defer remote sign-out while session/actor reads still return the previous account; assert protected content cannot return.

2. **[P2] Breached-view snapshots disagree with visible rows.** `src/routes/work-queue.tsx:140` passes the raw SLA selection to bulk filtering, while the queue forces `breach` in the breached view. With `view=breached&sla=warning`, rows remain visible but the snapshot requires both states and selects zero. Derive both requests from the same effective predicate. Regression: compare visible and snapshot IDs for each SLA selection in the breached view.

3. **[P2] Changing queue views retains an incompatible cursor.** `src/routes/work-queue.tsx:193` spreads the previous cursor into view links. From page two of the team queue, switching to “mine” changes the server scope, causing cursor rejection instead of opening the new view. Clear `cursor` when changing views. Regression: switch views from a later page and assert the destination requests its first page.

4. **[P2] Retained rows carry the failed page’s return context.** `src/routes/work-queue.tsx:145` builds `returnTo` from current URL state, although line 108 can display the previous successful page after pagination fails. Opening one of those retained rows therefore returns to the failed cursor rather than the page displayed. Retain the successful search/cursor alongside its rows and use that context for links. Regression: fail the next-page request, open a retained row, and verify return restores its successful page.

Confirmed the updated actor/data-mode wrapper and mobile `returnTo` wiring; neither is reported as outstanding.

Reviewed the completed scope, including relevant full new helper files. Deferred unfinished R20, R15, and document/client-overview work. No edits, commits, tests, DB access, or network calls performed during that review. Parent-reported checks were not rerun; native Auth behavior remains unverified.
