# T04 board pagination and search — 2026-09-27

RED reproductions on the disposable Postgres and component harness:

- An exact 200-row page returned a non-null continuation cursor. The same ambiguity affected the second page of 400 rows.
- After a 401st row returned `nextCursor: null`, the board fell back to the first page's cursor and kept “載入更多” visible.
- A slower response from an old q filter was appended after the board switched to a new filter.
- A malformed cursor silently restarted at page one.

The repository now selects one SQL lookahead row but hydrates and returns only the requested page. `nextCursor` comes from the last returned SQL row only when the lookahead proves another row exists. The same keyset ordering is retained through a risk-filtered page with zero visible results. Invalid cursors are rejected before SQL.

The board now uses TanStack Query's filter-keyed infinite query. A server `null` ends the sequence, old filter responses stay in their old query cache, and repeated Load more clicks share the same in-flight request. A failed next page leaves prior rows visible and offers retry at the same cursor. Duplicate IDs are suppressed on display as a guard; errors still surface. A separate cache key prevents ordinary annual-return list queries from receiving infinite-query data. Scope totals use owner/status keys, excluding q/risk/cursor from the aggregate; the tile names this scope. Company search waits 300ms and merges the latest owner/status filter.

Focused tests cover 200/400/401, a risk-filtered empty middle page, duplicate IDs, out-of-order responses, rapid repeated clicks, failed-page retry, and 300ms search. Local DB and browser harness evidence only; live authorized pagination and T27 high-volume performance remain unverified. No production data or deployment was changed.
Local gates: ESLint exit 0 (one existing work-queue warning); TypeScript exit 0; PostgreSQL-backed Vitest 183 files / 1,739 tests passed; 
pm run verify:firm dry-run exit 0 with provider and live-binding blocks reported; production build exit 0. These results do not establish production readiness.
