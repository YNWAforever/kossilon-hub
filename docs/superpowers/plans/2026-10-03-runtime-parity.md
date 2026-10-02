# Runtime parity and DB ownership evidence

> **For agentic workers:** Use superpowers:executing-plans inline, task by task.

**Goal:** Cover both Node22 and the observed production Node24 in the existing full CI,
and replace unknown technical DB ownership with dated read-only facts.
**Architecture:** Extend the existing CI job into isolated runtime legs, retaining a
stable fail-closed `verify` check. Preserve the existing Postgres/browser/gates.
**Tech Stack:** Existing TanStack/Postgres17/Bun1.4.2/GitHub Actions; no new dependency.
**Spec:** docs/audit-remediation/historical-release-runbook.md remaining gates;
docs/audit-remediation/release-checklist.md T01/T22/T23 runtime/owner requirements.
**Baseline:** main da792232879d3ac626c02ea464da3bd3adb459c8, full CI37031330748
231files/2200PASS/0skip/ChromeDEMO12, normal merge and production hold verified.

## Global constraints

- Reuse the clean isolated linked worktree, new codex branch; preserve Lovable history.
- Provider access is read-only metadata. No production SQL/env/deploy/send/grant/invite.
- Preserve published migration bytes, actual ledger rows, strict drift refusal and UAT50.
- Real local Postgres and local demo browser tests are not provider/runtime acceptance.
- Do not infer business ownership, no grants, no consumers or DDL freeze from pg_catalog.
- Keep current CI commands, timeouts, Postgres isolation and both dependency audits.

## Review Focus

1. Runtime legs really select Node22/24; an installed wrong major must fail the guard.
2. The existing stable `verify` check must fail if either runtime leg fails/skips/cancels.
3. Matrix legs must not share Postgres data/browser processes or omit existing gates.
4. Null ACL and connector-role metadata must not be described as no grants/app identity.
5. RLS/catalog dependencies must not be described as exhaustive external attribution.

### Task 1: Verify Node24 and make both runtime legs mandatory

Files: modify .github/workflows/ci.yml; dated runtime evidence/runbook.
Interfaces: consumes unchanged main test suite; produces actual Node24 outcomes and
mandatory Node22/24 CI legs plus the stable `verify` result.

- [ ] Run the runtime-major guard under Node24 with expected22; observe the mismatch.
- [ ] Run it with expected24 and execute existing `npm run test` on localhost55441
  actual Postgres17, plus lint/typecheck/build/local Chrome/demo/dev/cron/offline gates.
- [ ] Add a Node22/24 matrix, fail-fast=false, explicit selected-runtime guard and
  stable `verify` aggregate requiring needs.verify-runtime.result exactly success.
- [ ] Reproduce aggregate failure with non-success and success outcomes; retain logs.
- [ ] Commit only explicit files. Push/draft PR after Task2 and fresh whole-branch review.
Expected: genuine runtime guard RED/GREEN, full existing contracts on Node24 pass,
and no existing CI gate is removed or allowed to fail silently.

### Task 2: Record owner facts and the narrowed release blockers

Files: evidence/2026-10-03-db-owner-metadata.json; owner/runtime runbook;
status.md, environment-matrix.md, release-checklist.md. Original UAT CSV unchanged.
Interfaces: consumes the exact-target read-only metadata snapshot; produces technical
ownership/dependency facts separately from business attribution/freeze/provider gates.

- [ ] Preserve the actual dated SELECT result without business rows/secrets.
- [ ] Record owner neondb_owner/ACL defaults, observed RLS/FK dependencies, connector
  role flags and unknown app-role/consumer/sole-owner facts; retain NO_GO.
- [ ] Update current source integration receipts and gate owner/next-action entries.
- [ ] Execute verify:audit-release; prove all50 original rows/results unchanged.
- [ ] Commit, fresh whole-branch review, one RED/GREEN fix pass if needed, full matrix CI.
Expected: accurate evidence with providerWrites0; no false release/UAT/ownership claim;
original50 remains19LOCALONLYpass/31blocked/0not_run. Merge only after all checks green.
