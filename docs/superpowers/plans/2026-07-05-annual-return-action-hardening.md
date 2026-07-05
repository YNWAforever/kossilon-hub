# Annual Return Action Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden annual return case actions with explicit role-aware authorization, structured audit records, and safer mutation checks.

**Architecture:** Keep the current TanStack Start flow and repository boundary. Add a small annual-return permission module, hydrate each case with its assigned team, enforce actor rules in repository mutations, and write structured audit rows alongside existing timeline events.

**Tech Stack:** TypeScript, Vitest, TanStack Start server functions, `postgres`, Neon/Postgres migrations.

---

### Task 1: Permission Policy

**Files:**

- Create: `src/features/annual-return/permissions.ts`
- Test: `src/features/annual-return/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

Create tests for these rules:

- inactive users cannot mutate any case
- admins can mutate any case and complete any ready case
- managers can mutate cases assigned to their team
- staff can mutate cases they own or review
- completion is limited to admins, managers on the case team, or the assigned reviewer

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/features/annual-return/permissions.test.ts`
Expected: FAIL because `permissions.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement `getAnnualReturnActionPermission` and `assertAnnualReturnActionAllowed`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/features/annual-return/permissions.test.ts`
Expected: PASS.

### Task 2: Repository Enforcement

**Files:**

- Modify: `src/features/annual-return/types.ts`
- Modify: `src/features/annual-return/repository.ts`
- Test: `src/features/annual-return/repository.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Add DB-gated tests proving:

- staff from another team cannot update checklist/payment/filing proof
- assigned reviewer staff can complete a ready case
- owner staff who is not reviewer cannot complete a case
- manager from another team cannot mutate the case

- [ ] **Step 2: Run test to verify it fails**

Run with Neon-backed test database:
`TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/annual-return/repository.test.ts --runInBand`
Expected: FAIL because repository mutations do not enforce actor roles yet.

- [ ] **Step 3: Implement enforcement**

Add `companyTeamId` to `AnnualReturnCase`, select `companies.assigned_team_id`, query active actor role/team before each mutation, and call the permission policy before mutating.

- [ ] **Step 4: Run tests**

Run:

- `bunx vitest run src/features/annual-return/permissions.test.ts`
- `TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/annual-return/repository.test.ts --runInBand`

Expected: PASS.

### Task 3: Structured Audit Events

**Files:**

- Create: `db/migrations/0003_annual_return_audit_events.sql`
- Modify: `src/features/annual-return/repository.ts`
- Test: `src/features/annual-return/repository.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add a test that performs one annual return mutation and asserts `annual_return_audit_events` records actor id, role, action, case id, company id, result, and structured metadata.

- [ ] **Step 2: Run test to verify it fails**

Run:
`TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/annual-return/repository.test.ts --runInBand`
Expected: FAIL because the audit table does not exist or is not written.

- [ ] **Step 3: Add migration and audit writes**

Create the idempotent migration table and write audit rows within each successful mutation transaction.

- [ ] **Step 4: Run migration and tests**

Run:

- `bun run db:migrate`
- `TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/annual-return/repository.test.ts --runInBand`

Expected: PASS.

### Task 4: Full Verification

**Files:**

- All changed files

- [ ] **Step 1: Typecheck**

Run: `bunx tsc --noEmit --pretty false`
Expected: exit 0.

- [ ] **Step 2: Test suite**

Run: `bun run test`
Expected: all non-DB tests pass.

- [ ] **Step 3: DB suite**

Run: `TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/annual-return/repository.test.ts --runInBand`
Expected: all DB tests pass.

- [ ] **Step 4: Build**

Run: `bun run build`
Expected: exit 0, with only existing Vite advisory warnings.

- [ ] **Step 5: Review diff**

Run: `git diff --check && git status -sb`
Expected: no whitespace errors and only intended files changed.
