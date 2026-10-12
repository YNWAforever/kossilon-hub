# R20 — F32; UC46/47/82/83

BASE93ad5eb8dee82ed28b48856dc27efa5bcbafa28e. Incorporation source d5615be4be737fda895af260c210a2b42b317cc6; corporate-change/source candidate cdebdb6cb3a423bb893cce34494f74f572fa6e00. Normal commits/pushes only, PR145 remains stacked draft; production/outbound held.

Added feature-specific50-row pages/counts, real company/proposed-name search, own enum status/history, owner/mine/due/sort filters and scope/query/viewer-bound keysets. Both authorized predicates precede the51-ID SQL boundary; owner names/detail fields join only those IDs. Static300-row traversal is exact without duplicate/omission. Earlier legacy read/write APIs retain their contracts; the production lists now use the paged APIs exclusively.

Route search and safe return/anchor are validated. Search goes to the request list, not just a create picker. Corporate company lookup is a separately bounded search inside the real create dialog. Next-page failure retains previous rows and exposes retry; changed filters/actor clear retained scope. Counts reflect the full authorized predicate, not loaded rows. Keyboard-sized controls wrap; native390px/1366px Auth/device acceptance remains pending.

Rulings: both schemas require an owner, so unassigned capability is visibly unavailable rather than inventing nullable ownership. Corporate effective_date is not a filing deadline: only linked active work SLA supplies one; unknown deadline remains unknown. New pure policy helpers enforce active verified staff/team before reads; real GET handlers continue resolving the actor from the current request. Admin/Manager/Staff/Client roles remain unchanged.

## Actual regressions

Owned localhost PostgreSQL17 kossilon_staff_batch3; DATABASE_URL=TEST_DATABASE_URL; DATABASE_SSL=disable; REQUIRE_INTEGRATION_TESTS=1; Node24.18.0/npm11.16.0/Bun1.4.2. These are synthetic SQL profiles/component transport DTOs, not native Auth sessions.

- r20-red-contract.log: two missing page APIs; actual fixture setup corrected first (no auth_user_id column and actual corporate repository constructor). Initial setup failures remain in r20-red.log.
- r20-ui-red.log:3 failures, global list search/next page missing.
- r20-return-red.log: legitimate business-list return target rejected.
- r20-actor-red.log:4 missing verified-actor boundary failures.
- r20-regression-attempt2.log:12files30pass0skip,5.42s.300+300 owned cases/3 companies/two teams/history/equal dates/microsecond creation times/Chinese literal100%_tail; six50-row history pages; owned positives plus missing team/Client/inactive Admin/forged authority/cursor-scope denial; mine owner and unknown deadline; real React/dialog/network/return-state contracts.
- r20-write-regression.log:5files31pass0skip,9.33s; original create/completion/cancellation and write-policy regressions retained.
- Types exit0; final installed ESLint gate0errors/two preexisting warnings. Initial matcher/URI double-decoding and async picker timing errors, plus formatter whitespace errors, were retained and corrected without changing dependencies or weakening product assertions.

The exact Vitest invocation lines and output hashes are in batch3-r20-tests.json; raw logs remain task-private. One selection included authorization.ts (a source file, not a test); no pass is attributed to it. Full candidate suite/build/exact-head CI remain final batch3 gates; older CI276 is historical evidence only for93ad5eb. No new artifact digest or genuine role acceptance is claimed here.

Source status: locally verified bounded lists; task/UC status 待驗收/partial. Remaining QA/Auth minimum: schema-bound isolated candidate and genuine existing-role sessions, native back/reload/share/anchor and390px/1366px/operator create/cancel acceptance. Exact-head auto preview readiness alone is insufficient.

Rollback: normal source revert(s), preserving current authorization and an explicitly bounded safe read. No schema, dependency, business-data, approval or provider change introduced.
