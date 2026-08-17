# P0 Hardening Fixes Design (P0-5, P0-7, P0-8, P0-9)

## Overview

Four small, independent security/correctness gaps identified in `01-Kossilon-Hub-Roadmap-P0-P3.md`'s Sprint 1, never picked up when P0-1 through P0-4/P0-10 landed. Bundled into one spec/plan because each is individually tiny (S-effort) and they share no code — not because they're related. Each gets its own task in the implementation plan with no cross-dependencies.

All four were independently re-verified against the current codebase (branch `main`, 2026-08-18) rather than trusted from the roadmap review, which predates the live-email-transport and annual-return-reminder-cadence work merged since.

## P0-5: Staff document listing has no team scoping

**Problem.** `listDocuments` (`src/features/documents/server-fns.ts:281-297`) calls `assertStaffAccess(actor)` for any non-Client actor — no team filter. Two real, unscoped call sites confirmed: `src/routes/payments.tsx:52` (`listDocuments({ data: {} })`, unconditional on every `/payments` visit) and `src/routes/documents.tsx:52` (the "All cases" filter state sends `{}`). Any Staff member on any team can enumerate every document in the firm.

**Fix.** Extract the inline handler logic into an exported `listDocumentsForActor(actor, filters, dependencies)`, matching the `*ForActor` convention every other function in this file already follows (`createDocumentUploadIntentForActor`, `finalizeDocumentUploadForActor`, etc. are all separately exported and tested; `listDocuments` is the one exception, and has zero test coverage of its authorization branch today).

A new `documentFiltersForActor(actor)` helper mirrors `caseFiltersForActor` (`annual-return/permissions.ts:167-197`) — Admin → `{}` (no restriction), Manager → `{ teamId }`, Staff → `{ teamId }` (documents have no owner/reviewer concept to narrow further, unlike annual-return cases, so Staff and Manager get identical scoping here — team-wide, not "my documents only"). Throws for inactive or Client actors, matching `caseFiltersForActor`'s own guard.

`listDocumentsForActor` spreads this scope into the repository call *after* caller-supplied filters (`{ ...data, ...scope }`), so a client-supplied `companyId`/`caseId` can narrow within an actor's scope but never widen past it — same ordering `annual-return/server-fns.ts:126-139`'s `listAnnualReturnCasesForActor` already uses.

`src/features/documents/repository.ts`'s `listDocuments` (type at line 201) and `documentRows` (lines 239-247) gain a `teamId` filter, joining `documents d` → `companies c on c.id = d.company_id` → filtering `c.assigned_team_id`. Same join shape `annual-return/repository.ts:577,598` already uses against the same column, which is indexed (`schema.sql:50,195`).

**Not touched:** `src/routes/documents.tsx`/`payments.tsx` need no changes — scoping is enforced server-side, so `{}` from the client now means "the actor's own scope" rather than "no filter," transparently.

## P0-7: Admin route guards (client-side)

**Problem, re-scoped from the roadmap's framing.** `ProductionAdminConsole` (`routes/admin.tsx:86-122`) has no role check — confirmed — but it renders only a static, read-only "not available in this deployment" info panel (no working admin controls), so the actual exposure is information disclosure: any authenticated non-Client actor sees their own session name/role and that `staff_profiles` is the storage mechanism. `settings.tsx` similarly has zero role checks, but in production `settingsSectionsForMode` (`-settings-sections.ts:18-26`) already hides every mutable section behind the demo/production split, leaving only a WhatsApp status panel whose one live data call (`getWhatsAppIntegrationStatus`) is already staff-gated server-side. Both are hardening fixes, not closing an open backdoor.

**Fix.** `ProductionAdminConsole` gates on `isCurrentUserAdmin` — a flag `useAuth()` already computes (`auth-context-neon.tsx:33,225,279`) and that five other test files already stub, but that is not consumed anywhere in production route components today. Same pattern `DemoAdminConsole` already uses (`isAdmin(session)` at `admin.tsx:128`): render the existing panel only when true, an "Admin access required" denied state otherwise, matching `DemoAdminConsole`'s own denied-state copy and structure.

`settings.tsx` gets the equivalent check at its top-level component, gating the whole page the same way.

**Explicitly out of scope:** a new server-side/`beforeLoad` route guard. No such mechanism exists anywhere in this codebase today (the only `beforeLoad` role logic is Client-redirection via a `CLIENT_ROUTES` allowlist) and the actual risk here doesn't warrant introducing one now — client-side gating matching existing precedent is proportionate.

## P0-8: Outbox flush requires Admin, and is logged

**Problem.** `dispatchDueNotifications` (`src/features/notifications/runtime-dispatch.ts:95-104`) requires only `requireStaffActor` for what's documented in its own comment as "the manual dispatch escape hatch" — an operator action. No UI currently calls it (confirmed: the only references anywhere are the function itself, a structural test, and a docs plan), so today's actual exposure is a direct authenticated API call, not a discoverable button — but the gate should be correct regardless of whether a UI caller exists yet.

**Fix.** Copies `cleanupExpiredUploads`'s exact pattern (`documents/server-fns.ts:323-335`, the one existing Admin-restricted server fn in this codebase): `assertStaffAccess(actor)` then `if (staff.role !== "Admin") throw new Error("Forbidden: Admin access is required.")`, matching this repo's `Forbidden: ` prefix convention for authz errors. The underlying `dispatchDueNotificationsOnServer` (the actor-free core, shared with the cron) is untouched — the gate belongs only in the outer, actor-aware `dispatchDueNotifications` server fn.

**"Recorded":** neither existing audit table fits — `timeline_events` and `annual_return_audit_events` are both scoped to a single company (the latter also requires a case), and a manual outbox flush can touch many companies in one call. Rather than design new schema for this, `dispatchDueNotifications` logs who triggered it, when, and the resulting dispatch summary via `console.log`, matching this codebase's existing pattern for firm-level operational events (the scheduled-maintenance logging already in `src/server.ts`). Deeper, queryable observability is P3-1's job (outbox observability and alerting), not this fix's.

## P0-9: Real behavioral test for dashboard-tile scoping

**Problem.** The regression gate for a real fix (commit `1990603`, scoping dashboard tiles to the actor) is a pure source-text assertion (`repository.test.ts:1735-1742`, `expect(source).toContain("scope: CaseFilters = {}")`). `getAnnualReturnDashboardMetricsForActor` (`server-fns.ts:146-156`), the actual function that computes an actor's scope and calls the repository, has zero test-suite references anywhere — confirmed by a repo-wide grep. Even the repository-level `dashboardMetrics` integration test (`repository.test.ts:714-734`) never passes a real `scope`, only exercising the unscoped default.

**Fix.** Test-only; no production code changes. Extends the existing multi-actor fixture scaffolding already present in `repository.test.ts` (`USER_AMY_ID`, `USER_PRIYA_ID`, `TEAM_ANNUAL_RETURN_ID`, `TEAM_EVIDENCE_ID`, lines 19-25) to seed `annual_return_cases` across both teams with distinguishable counts (e.g. differing `dueIn7`/`overdue` contributions), then calls `getAnnualReturnDashboardMetricsForActor` — not the raw repository function — for an actor on each team via `caseFiltersForActor`, asserting each actor's tiles reflect only their own team's cases and that the two results genuinely differ, each matching a hand-computed expectation from the fixture.

## Testing (all four)

- P0-5: unit test for `documentFiltersForActor` (Admin/Manager/Staff branching, inactive/Client throws); a `listDocumentsForActor` test proving a Staff actor on Team A never sees Team B's documents even when no `companyId`/`caseId` filter is supplied.
- P0-7: component-level test that `ProductionAdminConsole` renders the denied state for a non-Admin session and the existing panel for an Admin session; equivalent for `settings.tsx`.
- P0-8: unit test that a non-Admin Staff actor is rejected with the `Forbidden:` message; an Admin actor's call still dispatches; a call is logged (spy on `console.log`).
- P0-9: the new behavioral test described above.

Full suite + `tsc --noEmit` + `lint` at the end, same discipline as every prior feature this session.

## Out of scope

- A new firm-level audit table for P0-8's "recorded" requirement — deferred to P3-1.
- A server-side/route-level Admin guard mechanism for P0-7 — client-side gating is judged proportionate to the actual (low) current risk.
- Any UI affordance that actually calls `dispatchDueNotifications` (P0-8) — none exists today and none is being added.
- P0-6, P0-11, and every other roadmap item not named above.

## Acceptance

1. A Staff or Manager actor on Team A calling `listDocumentsForActor` with no filters sees only Team A's documents; an Admin actor sees the whole firm.
2. A non-Admin session sees a denied state on `/admin`'s production console and on `/settings`; an Admin session sees the existing content on both.
3. A non-Admin actor calling `dispatchDueNotifications` is rejected with a `Forbidden:` error; an Admin actor's call still dispatches and is logged.
4. The dashboard-metrics test suite would fail if `caseFiltersForActor`'s scope were silently dropped from `getAnnualReturnDashboardMetricsForActor` — proven by two actors on different teams genuinely seeing different tile counts in the test.
