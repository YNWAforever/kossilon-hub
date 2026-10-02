# Failed test fixture lifetime

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** Prevent a timed-out NAR test from leaving owned fixtures or continuing SQL after teardown, while retaining its actual failure.
**Architecture:** A test-only SQL lifetime guard follows Vitest's actual abort signal. NAR fixture teardown awaits its original task before closing the pool and uses the raw client for owned cleanup. Production services remain unchanged.
**Tech Stack:** Existing Vitest4.1.11/Postgres17/Node22 and24; no new dependencies.
**Spec:** docs/audit-remediation/runtime-parity-and-db-owners.md Windows diagnostics; user requires genuine RED/GREEN, preserved failed evidence, no timeout/skip relaxation or false runtime acceptance.
**Baseline:** main baaa1a2b1e6fd17985e81e16d4c0761a7098de0b; original controlled timeout exit1 left1company/1batch/2users in unique local kossilon_b07_7af5802709824915b72e5a11ec5b822e.

## Global constraints

- Preserve previous failed databases/logs and all unrelated work/history.
- Existing30s/120s test and10s hook limits stay unchanged. A child deliberately times out at1s only to test cleanup; its exit must remain1.
- No production code/migration/provider/env/deploy/send/grant changes or automatic retry.
- Preserve original50 UAT19LOCALONLYpass31blocked0not_run and productionNO_GO.
- Root100-row latency and Today timing remain unresolved; cleanup correctness does not claim to fix them.

## Review Focus

1. Abort after the final callback write must still roll back before commit.
2. Tagged SQL, unsafe statements and nested savepoints must share the captured lifetime.
3. A timed-out fixture must settle and perform owned raw-client cleanup before pool shutdown/next test.
4. Cleanup must preserve the original timeout failure and propagate independent cleanup failures.
5. Normal transaction values/binding and existing application/authorization/timeout/CI behavior must remain intact.

### Task 1: Bound the NAR fixture's SQL lifetime and prove actual failed-child cleanup

Files: src/test/sql-test-lifetime.ts, sql-test-lifetime.integration.test.ts; src/features/nar-import/apply.integration.test.ts, fixture-timeout.integration.test.ts; src/test/db-integration-files.ts; dated evidence/status/environment notes.
Interfaces: consumes actual SqlClient and captured Vitest AbortSignal; produces guardSqlTestLifetime(client,getSignal) and awaited NAR fixture completion. Raw client is teardown-only.

- [ ] Write realPG tests for aborted tagged/unsafe writes, pre-commit rollback, nested savepoint rollback and normal JSON/result behavior; baseline guard returns raw client. Write parent regression that executes an actual child NAR fixture, requires timeout exit1 and checks its scoped rows are gone. Register both files in existing serialized DB project.
- [ ] Run both files on the unique local DB. Expected: actual cancelled writes/commits still happen and failed child retains scoped rows; preserve RED log and DB.
- [ ] Implement test-only guard and captured-signal fixture/drain hook, raw teardown. Expected: no new SQL after abort, rollback before commit, original timeout remains failed but owned rows0; no retry.
- [ ] Run regressions and existing NAR integration on a fresh uniquely owned local DB, then original complete suite/gates. Record every failure separately; default Linux22/24 full matrix remains mandatory for source merge.
- [ ] Commit explicit files, sole independent whole-range review, fix Important/Critical once with RED/GREEN, preserve declared minors/rulings; draftPR/exact-head full CI/normal merge only if all checks green/new main CI.

Expected: real failed-child outcome preserved, scoped cleanup verified and original acceptance/production gates unchanged. Never describe a deliberately failed child as full-suite PASS or provider acceptance.
