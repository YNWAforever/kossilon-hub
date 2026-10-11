# R16 — F27/F28, UC36/37/56/67/72/73

Candidate changes: server queue pages default/max50, SQL count/metrics over the same predicate, keyset tie breaker, scope/filter-bound cursor, page-only case/payment summary, literal Chinese/%/_ search, URL query/filter/sort/cursor/return anchor for Queue and Clients. List and work bulk snapshot/preview share queueScopeSql. Historical null SLA is displayed as pending confirmation and sorted last; it does not invent a deadline.

Real PostgreSQL fixture:50,000 equal-deadline rows plus a foreign-team row; two pages contain100 unique items, search finds the tail row, changed scope/query and malformed cursor fail,51-row request fails. Historic nullable SLA insert/DDL rolls back.6 targeted files31 tests passed0 skipped before the additional null contract; null contract1 test passed0 skipped. Typecheck passed; lint has0 errors and the existing route-export warning. Exact logs and final candidate SHA are consolidated in batch2 dossier.

The old browser listWorkQueue endpoint also returns a bounded page. Internal listQueue remains the scheduler's existing contract because evaluateEscalations depends on draining its work. R25.3 scheduler capacity/ownership remains open. Work list summaries require opening the current case for readiness approval.

Pending acceptance: real controlled actor sessions, browser back/reload/share/anchor across three pages,25 concurrent API users and the full five-endpoint10k/50k methodology. Local fixture/component results do not complete those scenarios. Production and outbound remain held.

Rollback: normal revert of the R16 source commit; no schema migration is introduced. Current actor authorization and mutation safety gates remain required.

Second capacity pass found the initial SQL joined facts before limiting51 IDs. The final query materializes only authorized sorted IDs before company/owner/case/payment summaries. Actual 25 distinct PostgreSQL backends,200 warm reads and20 fresh connections at each size:10k p95 301.24→139.26ms;50k p95 1962.65→371.28ms.50k maximum response61,447 bytes,0 errors,50 rows. Query plans and local conditions are in batch2-queue-capacity-before/after.json; ephemeral fixture IDs redacted. Fresh-connection measurements are not app cold start and these repository reads are not hosted HTTP/Auth measurements. Six-file regression including50k pagination/null SLA/Chinese search and capacity passed34 tests0 skips. Five-endpoint and real browser/role acceptance remain open.
