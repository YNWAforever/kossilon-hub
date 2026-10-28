# REVIEW-3 finding 3 — annual-return failure return context

Run `cosec-20261023-79d324f0`, shared candidate `codex/cosec-20261023`, base/HEAD `1c57a67213af72bff8d776694e6ed8c986b921db` plus uncommitted concurrent changes. Parent reopened only the annual-return production detail and this worker's tests for this repair. Source freeze resumes after this receipt.

## Root cause and bounded repair

The successful case view already used `caseReturnPath(returnTo)`. The request-error view instead hardcoded `/annual-returns`; both null-result and malformed-ID views used a `CaseNotFound` component that received no return context. Thus a case entered from a client could discard both the client ID and its nested register search/cursor on failure.

`production-case-detail.tsx` now passes `returnTo` into both not-found paths and uses the existing sanitizer for the error and not-found recovery anchors. Their neutral `返回工作列表` label matches the existing successful-view action. Malformed IDs still stop before a case request. Unsafe destinations retain the annual-return fallback; the shared helper, authorization, commands, read behavior and successful-view code were not changed.

The production change is confined to the assigned detail file. The only new source-tree file is `production-case-detail.return-context.test.tsx`. `R19-review3-source-delta.txt` compares the detail against its pre-edit copy, preserving the earlier successful-view repair and concurrent edits rather than attributing the whole branch diff to this follow-up.

## Actual RED / GREEN and checks

| Evidence | Result |
| --- | --- |
| `R19-review3-case-recovery-red-attempt.txt` | Sandbox temp-file rename `EPERM`; zero tests executed. Environment evidence only, not RED. |
| `R19-review3-case-recovery-red.txt` | Same pure-unit command with authorized filesystem escalation: **3 assertion failures / 2 passes**. Request error, null result and malformed ID all rendered `/annual-returns` instead of the exact client return URI. |
| `R19-review3-case-recovery-green.txt` | **6 files / 56 tests passed**, exit 0, `--project unit --maxWorkers 1`. Includes all 5 new recovery tests, existing detail interactions/actions, all-three-business client-return tests, client-return helpers and daily-view search helpers. |
| `R19-review3-typecheck.txt` | `npm.cmd run typecheck` / `tsc --noEmit`, exit 0 on this shared-tree snapshot. |
| `R19-review3-lint.txt` | ESLint on the changed detail and new test, exit 0. |
| `R19-review3-diff-check.txt` | `git diff --check`, exit 0. |

The new regressions render the real annual-return detail, actual annual-return search validator, real router and real client detail with mocked server transports. For both rejected reads and null results, they inspect the displayed recovery anchor and follow that URI through the in-memory router. They verify the exact client ID and distinct register back link retain query, status, team and tuple cursor. The malformed-ID regression also asserts no case read; unsafe-origin regressions retain `/annual-returns`.

The tests do not substitute a placeholder case body. Native anchor document navigation is unavailable in jsdom, so following the rendered anchor uses `router.navigate({ href })`; this is local component/routing evidence, not authenticated browser or reload acceptance. The 56 count overlaps earlier batches and must not be added to them.

## Preservation and freeze disposition

`R19-review3-source-sha256.json` fingerprints the two changed/new source/test files. `R19-review3-context-preservation.json` confirms all seven REVIEW-2 client-return source/test fingerprints remain unchanged, including `daily-view-state.ts` and its `otherCursor` / router search serialization logic. No shared-helper repair was necessary.

No DB client/test, network, Auth runtime, provider, storage, migration, business send, commit, push, merge or deploy was performed. Existing isolated SQL evidence remains a separate historical layer. The graph upload refusal was respected through local-source inspection; no indexing/upload was retried. Parent aggregate verification remains parent-owned.

Source and tests are frozen after this receipt. Any further important defect must be reported before editing.
