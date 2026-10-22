# Review 2 / finding 5 — R20 refresh recovery and SQL-test handoff

Candidate: `C:/Users/laich/Documents/kossilon-hub/cosec-20261023`, branch `codex/cosec-20261023`, base `1c57a67213af72bff8d776694e6ed8c986b921db`; shared uncommitted source. No commit, DB execution, or external action by this worker.

## Verified finding and repair

The previous refresh button removed `cursor` then navigated. With no cursor on the first page, this generated the same URL and left the React Query key unchanged; `retry: false` left an initial failed request unretried. The prior cursor-clear test covered later-page navigation and missed this case.

- `src/features/incorporation/components/case-list-controls.tsx`: required `onRefresh` callback; first-page refresh invokes it, later-page refresh still clears cursor while preserving filters. Refresh is disabled during an active fetch.
- `src/features/incorporation/components/production-incorporation-list.tsx`: callback explicitly calls `casesQuery.refetch()`.
- `src/features/corporate-changes/components/production-corporate-change-list.tsx`: callback explicitly calls `requestsQuery.refetch()`.
- `src/features/incorporation/components/case-lists.test.tsx`: for **each** list, reject initial read, verify exactly one call, click refresh, verify a second request with the same filters, render the recovered record, remove the alert, and verify no navigation. Mock response queues reset between tests; existing later-page cursor recovery remains covered.

## Red/green and checks actually run

1. `npm.cmd test -- --project unit --maxWorkers 1 src/features/incorporation/components/case-lists.test.tsx -t 'refetches a rejected first page'`
   - **RED: 2 failed / 6 intentionally filtered tests skipped**, both expected failures to render the recovered second response. `REVIEW-2-R20-refresh-red.txt`.
2. `npm.cmd test -- --project unit --maxWorkers 1 src/features/incorporation/components/case-lists.test.tsx src/features/incorporation/case-list-page.test.ts src/features/incorporation/components/production-incorporation-detail.test.tsx src/features/corporate-changes/components/production-corporate-change-detail.test.tsx src/components/incorporation/create-incorporation-case-dialog.test.tsx src/components/corporate-changes/create-corporate-change-request-dialog.test.tsx`
   - **GREEN: 6 files / 60 tests passed**, zero skips. Includes both refresh cases, later-page recovery, microsecond/page contracts, and existing detail/create/cancel/duplicate protections. `REVIEW-2-R20-refresh-green.txt`.
3. `npm.cmd test -- --project unit --maxWorkers 1 src/test/db-integration-files.convention.test.ts`
   - **2 passed**. Confirms the new SQL test is in the serialized DB registry and excluded from the unit project. `REVIEW-2-R20-registry-unit.txt`.
4. Targeted ESLint for the four changed list files plus the new integration source: exit 0, no diagnostics (`REVIEW-2-R20-eslint.txt`). TypeScript **syntax transpilation only**, without importing/executing the integration module: exit 0 (`REVIEW-2-R20-sql-source-syntax.txt`). This is not a typecheck or DB result. Owned-path `git diff --check` also passed. Final source hashes: `REVIEW-2-R20-fingerprints.txt`.

Unit commands retain process-local TEMP/TMP at candidate `node_modules/.cache/r14-test-tmp`. No installs or environment-file copies.

## Definite parent-only SQL test, authored NOT RUN

New file: `src/features/incorporation/read-page.integration.test.ts`; one entry added beside the existing incorporation suite in `src/test/db-integration-files.ts`. Other workers' registry additions preserved.

The test uses real repositories and role helpers with **assumed actors**, one transaction, a unique run UUID, and 300 incorporation + 300 corporate-change records split A/B (200/100). It authors:

- Staff A/B, Manager A/B, Admin; no-team Staff/Manager, inactive Staff/Admin, and Client denial. Incorporation legacy array and both cursor-page reads, allowed/foreign/missing detail reads, checklist content, and zero-query denial where the read policy promises it.
- Full 25-row page traversal and exact ordered ID equality, nonzero microseconds within one millisecond, repeated sort keys with unique ID ties, company/due sorting, cross-team owner filters with exact 100-row counts, Admin team narrowing, nonempty bilingual/status/owner/due intersections, literal wildcard search, and changed-actor cursor rejection.
- Status values imported from the existing domain constants; completed incorporation records have a company, completed corporate requests have a completion timestamp, address-change fields satisfy the existing constraint. Corporate due dates come from owned open work-item SLA records; an existing migrated/seeded SLA policy is read, never modified.
- Raw fixture timestamp strings travel in JSON and are cast to timestamps **on the server**, retaining microseconds. No JS Date timestamp round trip.
- Intentional rollback, then exact-ID readback of teams/users/companies/both case tables/both checklist tables/work items, all required to be zero. No delete/truncate or broad cleanup. Optional `COSEC_EVIDENCE_DIR` writes `R14-R20-owned-SQL-<runUUID>.json` with exact owned IDs, server identity, assertions status, ID/count measurements and rollback readback.

No client at module import. The reusable test has **no pinned hostname, port, database name or TLS mode**: it consumes the executing runner's `TEST_DATABASE_URL` and the existing client's TLS configuration. Actual server identity is recorded for evidence without asserting this run's database name. A URL label or localhost check is not isolation proof; the external runner's identity gate remains authoritative.

**This run's target requirement belongs only to this receipt:** parent checks exact container label/run `cosec-20261023-79d324f0`, container `4f5c362905d14782f4bc2c4bf74af3fc8f2b4e76259342e873bfd1ea78424580`, loopback mapping **60953**, database **cosec_79d324f0**, tmpfs/no mounts, against `isolated-target.json` immediately before its command. These values are not a universal test precondition. CI and future authorized disposable runners must establish their own current external identity binding. Parent exclusively owns this run's DB execution.

**Parent command, not executed here:** `npm.cmd test -- --project db --maxWorkers 1 src/features/incorporation/read-page.integration.test.ts` with the parent's verified existing `TEST_DATABASE_URL` and optional evidence directory. No new env file is needed. The schema inputs were read from migrations 0001, 0006, 0014, 0017, 0019 and 0020; no migrations changed.

Remaining evidence: the SQL suite is authored/unrun, build remains parent-owned, and real Auth/HTTP/RLS/browser acceptance is not established. Passing this future suite would verify the actual SQL/read-policy layer with assumed actors, not a live authentication session. The portability amendment's static typecheck/lint result is recorded separately; it does not execute or import the SQL test/DB client.

## Portability amendment / ready for parent SQL execution

Removed the run-specific URL guard, pinned database-name assertion, and `ssl: false` override from the reusable integration test. Actual server identity is retained as optional evidence. Only this run-specific receipt carries the parent's target binding; CI/future runners use their own verified target and configured TLS settings.

- `npm.cmd run typecheck -- --pretty false`: completed with exit **2**, eight diagnostics in other workers' return-context tests: `annual-return/daily-view-state.test.ts`, `annual-return/work-views-today.test.tsx`, `clients/client-return-context.test.ts`, and `clients/components/client-case-return-context.test.tsx`. No diagnostic names the SQL test. Shared files were preserved. Full output: `REVIEW-2-R20-portable-typecheck.txt`; workspace typecheck is **not green**.
- Focused TypeScript semantic/source check using repository compiler options/ambient declarations plus the existing Node test types: **passed** (`REVIEW-2-R20-portable-source-typecheck.txt`). Its initial isolated invocation omitted Node ambient types; that checker-context failure is retained in `REVIEW-2-R20-portable-source-typecheck-context.txt`, then corrected without modifying product/test source.
- `prettier --check` and targeted ESLint on `read-page.integration.test.ts`: both exit **0**, no diagnostics (`REVIEW-2-R20-portable-lint.txt`). Source review confirms no run host/port/database/container/TLS pin; `git diff --check` passes.

The authored SQL regression is ready for the parent's verified DB runner. No DB test/client module was imported or executed by this worker during these static checks, and no DB client was created. No SQL pass is claimed here.

## Source-freeze disposition

Parent source freeze acknowledged. From this checkpoint, this worker makes **no source, test, registry, or formatting changes** and starts no DB client or test run. Only receipt/evidence updates are permitted until the parent supplies aggregate results and authorizes any necessary follow-up. Any newly observed important defect will be reported before editing.

Read-only checkpoint: HEAD remains `1c57a67213af72bff8d776694e6ed8c986b921db`; portable SQL-test SHA256 is `986b16b0e5487c1e823255496a128c931524afc68438366b822497fe4b6d4d34`. Refresh source/tests and SQL registry handoff remain as recorded above. No new defect was identified in this disposition check.

Earlier local unit/static results and the eight workspace typecheck diagnostics remain historical evidence. Current aggregate/typecheck/SQL status will come from the parent's frozen-candidate verification; no parent result is inferred here. All new SQL-task tests remain exclusively parent-run, and Auth/runtime acceptance remains unproved by this worker. No commits or external actions were performed.
