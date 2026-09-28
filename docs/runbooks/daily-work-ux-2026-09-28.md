# T26 daily work UX and zh-HK (2026-09-28)

Branch: `codex/kossilon-daily-work-ux`, stacked on T25. This slice changes route and component behavior only; no migration or production data write is included.

## Local behavior

- Today rows derive their next action from the existing server work-view key and blocker, not from a new client-side status guess. Chase opens the case reminder section. New or awaiting documents open the exact current document row in the production vault, scoped by case ID. Ready-to-file opens manual submission and returns open the return-intake section only when those server views are released.
- An absent document ID disables the direct review action with a reason. Read failures stay distinct from empty lists; unreleased views explain the missing capability and name the responsible staff action.
- Today view is encoded in URL search. The existing router has `scrollRestoration: true`; browser back can restore the view and scroll position. The document route scrolls and focuses the target after its server query renders.
- The production board keeps the company and action cells sticky in the wide scrolling table and displays its action directly in each narrow card. Company names and repeated actions identify the case. The case detail has document, payment, message, filing, return and audit anchors; primary operational copy and dates use zh-HK/HKT.
- The demo remains read-only. Document review, payment, reminder, package and submission calls continue through their existing server functions and authorization gates.

## Evidence and limits

The three named T26 tests were RED when the operational-copy module did not exist, then GREEN. The focused route/component suites exercise board links, case actions, portal reachability and document scoping. JSDOM can assert the responsive DOM/action is present at 1440/1280/768/390 widths; it cannot prove CSS visibility or capture an actual screenshot. A local code-path comparison shows the chase action now opens the reminder section directly and a new-document action opens its production review row directly. These are navigation paths, not measured pilot step counts.

The before/after screenshot and measured chase/review step-count gate remains **runtime-blocked**: this checkout has no authorized authenticated production or staging case/browser session and cannot substitute demo or mock records as production evidence. To finish that gate after runtime access is supplied, capture the same real case at 1440/1280/768/390 before and after, verify action visibility without horizontal scroll, run one chase draft and one new-document review with a reviewed current version, record actual clicks/back-scroll behavior and identify the case/version only by non-sensitive evidence references. Do not send a live reminder as part of this verification.

Final local verification: 220/220 test files passed, 1,895 tests passed and 2 skipped against disposable PostgreSQL; typecheck and production build passed; lint reported 0 errors and the pre-existing Fast Refresh warning in `src/routes/work-queue.tsx`. Prettier and `git diff --check` passed. No T26 schema change was made.

No production migration, recipient send, invitation, permission change or deployment was performed.
