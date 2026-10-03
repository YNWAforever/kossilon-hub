# R11 follow-up: preserve historical browser evidence

Binding spec: Oct3 R11 evidence retention and R09/R10 local browser verification; new runs must append evidence, never overwrite the prior snapshot. Baseline main `f038ee79018f9a604e2affc1ef2f85aa3a5a702b`. Genuine Auth/provider/native acceptance remains separate and blocked.

## Task 1: isolate new local browser artifacts and reconcile delivery receipts

1. Record nine protected byte hashes: four historical T20 PNGs, two historical T21 browser JSONs, original50 UAT and frozen historical SQL/manifest. Create an owned source snapshot under the ignored task folder; run the real existing browser consumer on dedicated loopback5180 in that snapshot. Assert the historical bytes remain unchanged. Expected RED: actual browser tests may pass, but the post-run historical-evidence contract fails. Never run the failing writer over the authoritative old evidence.
2. Apply the smallest runner fix: unique per-run ignored output root, native Playwright `testInfo.outputPath` for screenshots/performance JSON, and a pre/post byte guard for the nine historical artifacts. Add real-filesystem guard regressions for unchanged, modified and missing evidence. Keep the original browser scenarios, ports, retries, roles, assertions and CI gates.
3. Run the real browser consumers at390/1280, verify all nine old byte hashes unchanged and new captures exist only under their run root. Verify two independent runs preserve the first run artifacts. Run meaningful filesystem unit tests, actual npm lint/typecheck and complete real owned PG18 suite. Completion command: `pwsh.exe -NoProfile -File .worktrees/preserve-browser-evidence/verify-local.ps1` checks actual source/raw/count receipts, protected bytes, unchanged task IDs and fresh focused tests. Counts come from output.
4. Append BUG-R11-01 source-bound evidence to status/delta/environment/tracker. Resolve stale R02/R03 next steps using actual PR127/128/129 final-head/merge/main receipts; retain all historical receipts and genuine blockers. Commit, one fresh whole-branch review, draft PR and unchanged exact-final-head CI; normal green-only merge uses standing user authority. Production remains NO_GO.

Only local source/tooling/tests/docs and owned loopback fixtures are permitted. No hosted migration/config/deployment/provider/send/invite/grant operation. Original50 UAT and frozen SQL/manifest cannot change.

## Review Focus

Actual Playwright output writes must preserve the six tracked historical browser artifacts and original acceptance package. Unique run roots must survive later runs without path traversal or same-run collisions across projects/tests. The guard is pre/post byte verification, not continuous filesystem protection or genuine runtime acceptance. Verify the real config/test consumers and original browser gates, plus exact historical source/CI/merge metadata; do not judge from string-search tests alone.

## Verification dependency: BUG-R11-02

The complete unchanged PG18 suite repeatedly exposed the existing NAR failed-child regression's outer30s deadline. The original nested command initializes both projects despite executing only the DB fixture. Its profiled wall time was36905ms with three Vite configurations; selecting the existing `db` project gave16755ms with two. Both controlled children still exited1 with the expected1000ms failure and fixture identity, without hook timeout or unhandled rejection. Cache/profiling/platform differences limit attribution; do not describe this comparison as a production performance result.

Before claiming complete-suite GREEN, add only `--project=db` to the existing child command. Preserve its threads pool, original1000ms/30000ms deadlines, process ownership, actual SQL fixture cleanup and all parent assertions. Use the already observed full-suite outer timeout as RED, rerun the actual parent as GREEN, then rerun the complete suite with the original CI gates unchanged. Treat this as a separate reviewable test-harness commit. Add its actual source hash and all negative/profile/full receipts to the evidence manifest.
