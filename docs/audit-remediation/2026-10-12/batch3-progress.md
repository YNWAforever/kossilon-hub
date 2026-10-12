# Execution ledger — plan: docs/superpowers/plans/2026-10-12-kossilon-staff-remediation.md

Batch3 requested scope: R15 / R19 / R20 / R18.2–3 / R22. BASE93ad5eb8dee82ed28b48856dc27efa5bcbafa28e, clean existing isolated PR145 worktree, normal branch codex/staff-remediation-20261012. Main da82677bdeb35b9255425be61bd66abd295f5cc1 unchanged. Production/outbound hold and release NO_GO retained. Prior batch evidence remains immutable.

Ruling: approved implementation plan is the design authority; execute inline with TDD and one fresh whole-batch review. This plan uses R headings rather than Task N helper syntax, so use its exact R briefs and this persistent ledger. Retain the user-required private evidence workspace instead of deleting evidence at skill completion.

Pre-flight interfaces:
- R20 bounded incorporation/change rows feed R15 union summaries and R19 company case tabs; use original status enums and R14 team policy, not AR status/readiness.
- R15 / R19 reuse R16 cursor/URL helpers and R17 authorized document/payment reads; summaries do not hydrate all cases/documents.
- R18.2 uses canonical R17 filters/frozen snapshots; R18.3 reuses existing jobs/results/worker, preserving unknown and successful outcomes. R22 handoff consumes these durable outcomes before any deactivation.
- R22 imports stays Admin-only; navigation and direct route align. Template version conflicts retain local edits and never rewrite existing case snapshots.

Ruling: implement R20 backend/list contracts first because R15/R19 consume the same source summaries, then R15, R19, R18.2–3 and R22. Costs if wrong: source DTO adaptation only; no schema change.
Ruling: incorporation/change schemas require owner_id; expose truthful mandatory-owner/unassigned capability text rather than adding nullable ownership. Corporate effective_date is not a filing deadline; deadlines come from linked work SLA and missing deadlines stay unknown.

| Task | State | Verification / next |
|---|---|---|
| R20 |待驗收 |d5615be4/cdebdb6c;12files30pass0skip +5files31pass0skip original writes; types/lint; full/native gates pending |
| R15 |進行中 |6 mixed business cases, mine/team, partial source and AR five categories |
| R19 |待開始 |company summary/tab-scoped bounded reads and lawful current-document links |
| R18.2–3 |待開始 |1000 frozen selection, labelled jobs,47/1/1/1 safe recovery and export |
| R22 |待開始 |role navigation, safe handoff, template conflict retention, staff copy/accessibility |

Environment: fresh owned localhost PG17 kossilon_staff_batch3, DATABASE_SSL=disable, DATABASE_URL=TEST_DATABASE_URL, REQUIRE_INTEGRATION_TESTS=1. PG18 customer public restore stays stopped; no production/provider/account mutation. Synthetic local actors are contract evidence only. Native role/browser/scheduler/provider gates remain separate.

R20 source complete (local): d5615be4be737fda895af260c210a2b42b317cc6 and cdebdb6cb3a423bb893cce34494f74f572fa6e00; exact receipts in batch3-r20.md/tests.json. Failed setup/matcher/encoding/timing/format attempts preserved; no skip or historical CI used for current acceptance. Next R15 mixed-source daily model; native gates remain separate.

R15: source/local complete 348b94e6afe29d196d1dc34ed8edd38642aa3539; 6files12pass0skip; six mixed own cases plus foreign; exact whole1-row traversal, Unicode/global search, five original AR categories/metrics, HK midnight and source coverage cursor rejection, actual SQL role/team/active denial; real component partial/outage/return scenarios retained; types/lint0(two prior warnings). Exact evidence batch3-r15.md / batch3-r15-tests.json. Native gates remain待驗收/受阻, release NO_GO. Next: Continue R19 company workspace, R18.2–3 and R22; final batch3 build/CI plus genuine role/device/operator journeys pending.

R19: source/local complete 53c1973aa8a0112ac666897cb89a95429aabaa25; 7files29pass0skip plus navigation1pass; SQL3files3pass; linked UUIDs not names, metadata links, debt, microsecond activities/current role-team-active checks; active-tab/retained errors and legacy maintenance regressions; types/lint0 with two prior warnings. Exact evidence batch3-r19.md / batch3-r19-tests.json. Native gates remain待驗收/受阻, release NO_GO. Next: Continue R18.2–3/R22; final batch3 build/CI and genuine role/device journeys pending.

R18: source/local complete 60202a6e16cf84f76645e33e14d12fe9418ee00b; 6files42pass0skip;1000documents/page50/998preview/997eligible/1locked;1000committed interruption/lease takeover/1000 audit effects;50mixed47success/1conflict/1retryable/1unknown no success replay; scoped job metadata, worker receipt separately from unknown heartbeat; final composite types/CI pending. Exact evidence batch3-r18.md / batch3-r18-tests.json. Native gates remain待驗收/受阻, release NO_GO. Next: R22 handover/role/settings; final batch3 whole suite/build/CI and native scheduler/device/auth acceptance pending.

R22: source/local complete 3bf8d8ecdd278e2fd48c21de67251740c83ed52e; 7files29pass0skip; same-key SQL business receipts, version conflict/re-preview/recount, role navigation, original last Admin/current session/in-flight assignment checks and template immutable snapshots; explicit confirmation/unknown receipt read and retained draft; types/lint0 two prior warnings. Exact evidence batch3-r22.md / batch3-r22-tests.json. Native gates remain待驗收/受阻, release NO_GO. Next: Single whole-batch review, complete candidate suite/build/exact-head CI; genuine four-role sessions/device/provider/native scheduler remain release gates.
