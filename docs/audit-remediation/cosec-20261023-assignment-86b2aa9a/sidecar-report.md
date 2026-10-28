UI sidecar is frozen at HEAD 8a0fbdcc860981d43fb9e12f794d7b549e331435. Authoritative fingerprints and verification receipts are in sidecar-source-freeze.json. Only src/routes/work-queue.tsx and src/routes/-work-queue.interaction.test.tsx were changed by this sidecar, plus sidecar-* receipts and the authorized transient .worktrees/sidecar-assignment-86b2aa9a test scratch.

Root cause: AssignmentDialog retained its opening item.version for every attempt, displayed a generic mutation error without an alert, lacked explicit recovery reads, allowed a stored selection absent from current eligible candidates, and relied on asynchronous isPending to prevent duplicates. Dialog dismissal could also outlive an in-flight callback.

The repair keeps a reviewed snapshot until manual queueQuery.refetch and recommendation refetch both succeed, preserves current filters/cursor, and shows current owner/reviewer/status/version. Every mutation error blocks retry regardless of code or serialization, and clears selection. Recognized codes and both current/legacy messages give conflict, assignee or actor guidance. Recovery preserves target and typed reason, clears selection, requires a deliberate new choice, and submits the freshly reviewed version. Missing, closed or failed queue reads and failed/ineligible recommendations refuse confirmation. The retry requirement survives cancel/reopen for the same item in the current actor session. Synchronous guards block duplicate writes and rereads. Cancel, close, Escape and outside dismissal are guarded during pending operations; actor changes unmount the old session and late callbacks are ignored.

Actual verification:

- sidecar-red2.log: original UI SHA256 e4ec3abb8b5d709c138328da6da2f54eeee60305961b19029ddbd8d4b8f086c2; 16 failures and 9 passes. Original UI and failing test snapshots retained. sidecar-red.log also retained; red2 corrects the test's wait for React Query notification before checking eligibility removal.
- sidecar-green1.log: 24 passes and one failure caused by duplicate recovery alerts; the alert duplication was repaired.
- sidecar-red3.log: four background queue-state failures on the partial repair. sidecar-red4.log: one selected cancel/reopen regression fails after the test was corrected to await the reopened recommendation fetch (29 cases intentionally filtered out).
- sidecar-green2.log: 30/30 passed, zero failures/skips; 7 existing tests retained and 23 added cases. Includes UC130 v1 conflict -> explicit fresh v2 review -> deliberate confirmation; UC131 unavailable selected staff -> preserved reviewer/reason -> refreshed eligible replacement; structured/plain Error/legacy messages; ambiguous and actor errors; failed/missing/closed recovery; background queue and eligibility changes; cancel/reopen; pending duplicates/dismissal; actor changes/late success.
- Command: C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --configLoader runner --config docs/audit-remediation/cosec-20261023-assignment-86b2aa9a/sidecar-vitest.config.mts
- Test process environment was cleared and replaced with a fixed Windows/runtime/PATH/TEMP/TMP/NODE_ENV/NO_COLOR whitelist. envDir and TEMP/TMP point to per-run .worktrees scratch; checkout .env files were not loaded. Actual server functions/auth/bulk boundaries are mocked; this is component evidence only.
- Both source files formatted using installed Prettier. Focused ESLint exited 0: zero errors, one existing react-refresh/only-export-components warning at work-queue.tsx:49. git diff --check passed for the two source paths.

Frozen SHA256:

- src/routes/work-queue.tsx: 753f1dc9b20a9c5410403f9a0b633f509c9c3f6623ab35e13c8ba1ffb64c17e8
- src/routes/-work-queue.interaction.test.tsx: 8c3a008d50ca73bee1b22c623942b9e88d369c85b35d73108744f185b0a26b7b

Remaining limits: native server-error serialization and actual HTTP/browser behavior were not exercised. Backend contracts, disposable DB harness, real SQL concurrency, final aggregate unit/type/lint/build and delivery belong to the parent. This sidecar made no DB clients, actual HTTP/browser/external requests, env reads, graph-upload retries, migrations, commits, push, merge or deployments. Parent-owned dirty source files were preserved.
