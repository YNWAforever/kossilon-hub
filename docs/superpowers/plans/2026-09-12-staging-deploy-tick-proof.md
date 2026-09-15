# Staging Deploy: Prove The Tick Fires — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Worker to staging and prove the five-minute cron actually fires, clearing `BLOCKED_INTEGRATION: deployment-runtime`.

**Architecture:** Tasks 1–3 are local code and documentation changes, developed TDD, that make the deployment's outcome observable before it happens. Tasks 4–9 are the operational sequence: local gate, render, migrate (approval-gated), deploy, observe. No provider is integrated; the four provider-gated capabilities stay disabled by leaving their credentials unset.

**Tech Stack:** TypeScript 5.8 strict, React 19, TanStack Start, `postgres.js` raw SQL, Vitest 4, Bun, Cloudflare Workers (Wrangler), R2, Hyperdrive.

**Spec:** `docs/superpowers/specs/2026-09-12-staging-deploy-tick-proof-design.md`

---

## File structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/features/operations/health.ts` | `MaintenanceRunRecord.dispatch` field + `dispatchCountLabel` display rule | 1 |
| `src/features/operations/health.test.ts` | Pins that unknown ≠ zero for dispatch counts | 1 |
| `src/features/operations/repository.ts` | Reads `passes -> 'dispatch'` in both run queries | 1 |
| `src/features/operations/repository.integration.test.ts` | Proves the jsonb read works against a real database | 1 |
| `src/routes/operations.tsx` | Shows 已派送 / 已攔截 per run | 1 |
| `docs/runbooks/firm-deployment.md` | Gains the missing render-and-deploy step | 2 |
| `scripts/verify-firm-deployment.test.ts` | Asserts the runbook documents that step | 2 |
| `docs/implementation/kossilon/status.md` | Stale claims corrected | 3 |
| `src/features/operations/capabilities.ts` | `deployment-runtime` removed **only if** observed | 9 |

---

### Task 1: Make the dispatch outcome visible on /operations

Acceptance check 4 of the spec — fixture-origin notifications cancelled, `sent = 0` — is written into `maintenance_runs.passes` by `recordRun` but never read back. Without this task the safety property of the whole deploy is unobservable.

`ScheduledMaintenanceResult.dispatch` is a `DispatchSummary | null`, so the jsonb path is `passes -> 'dispatch' ->> 'sent'` and `passes -> 'dispatch' ->> 'suppressedFixtureOrigin'`.

**Files:**
- Modify: `src/features/operations/health.ts`
- Modify: `src/features/operations/repository.ts`
- Modify: `src/routes/operations.tsx`
- Test: `src/features/operations/health.test.ts`
- Test: `src/features/operations/repository.integration.test.ts`

- [ ] **Step 1: Write the failing display-rule test**

Append to `src/features/operations/health.test.ts`:

```ts
describe("dispatchCountLabel", () => {
  /**
   * A run with no recorded dispatch and a run that dispatched nothing are
   * different facts. Rendering both as "0" would say "no messages went out"
   * about a run where nobody knows what went out.
   */
  it("does not render an unknown count as zero", () => {
    expect(dispatchCountLabel(null)).toBe("未知");
    expect(dispatchCountLabel(0)).toBe("0");
    expect(dispatchCountLabel(null)).not.toBe(dispatchCountLabel(0));
  });

  it("renders a real count", () => {
    expect(dispatchCountLabel(7)).toBe("7");
  });
});
```

Add `dispatchCountLabel` to the existing import from `./health` at the top of that file.

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run src/features/operations/health.test.ts`
Expected: FAIL — `dispatchCountLabel is not a function` (or a TS error that it is not exported).

- [ ] **Step 3: Add the type field and the display rule**

In `src/features/operations/health.ts`, add to `MaintenanceRunRecord` (after `failedPasses`):

```ts
  /**
   * What the dispatch pass did on this run.
   *
   * Null when the run recorded no `passes` at all, or when the dispatch pass
   * itself threw. Null is not zero: "nothing was sent" and "nobody knows what
   * was sent" are different facts and only one of them is reassuring.
   */
  dispatch: { sent: number; suppressedFixtureOrigin: number } | null;
```

Then append to the same file:

```ts
/**
 * A count from a run's dispatch summary, or the fact that there is none.
 *
 * Separated from the JSX for the same reason `earliestMissingLabel` was: the
 * distinction between "zero" and "unknown" is the whole point, and it is
 * exactly the kind of thing a `?? 0` quietly destroys at the last moment.
 */
export function dispatchCountLabel(count: number | null): string {
  return count === null ? "未知" : String(count);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `bunx vitest run src/features/operations/health.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing repository test**

Append inside the `describe.skipIf(!databaseUrl)("maintenance run repository", ...)` block in `src/features/operations/repository.integration.test.ts`:

```ts
  it(
    "reads the dispatch outcome back out of the passes column",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        await repository.recordRun(
          draft({
            passes: {
              now: "2026-09-12T10:00:00.000Z",
              dispatch: {
                claimed: 3,
                sent: 0,
                retried: 0,
                permanentlyFailed: 0,
                superseded: 0,
                sentButUnrecorded: 0,
                suppressedFixtureOrigin: 3,
              },
              failures: [],
            },
          }),
        );

        const [latest] = await repository.listRecentRuns(1);

        // The safety fact this whole deploy turns on: three fixture reminders
        // cancelled, none sent.
        expect(latest?.dispatch).toEqual({ sent: 0, suppressedFixtureOrigin: 3 });
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "reports a run with no recorded dispatch as null rather than zero",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        await repository.recordRun(
          draft({ passes: { now: "2026-09-12T10:05:00.000Z", failures: [] } }),
        );

        const [latest] = await repository.listRecentRuns(1);

        expect(latest?.dispatch).toBeNull();
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
```

- [ ] **Step 6: Run it and watch it fail**

Run: `$env:TEST_DATABASE_URL = "<local throwaway connection string>"; $env:DATABASE_SSL = "disable"; bunx vitest run`
Expected: FAIL — `latest.dispatch` is `undefined`, because `mapRun` does not produce the field yet.

Note: run the whole suite, not a single file. Filtering to one file leaves the `db` project's group 0 empty and the run hangs.

- [ ] **Step 7: Read the column in the repository**

In `src/features/operations/repository.ts`, add to `type RunRow`:

```ts
  dispatch_sent: number | string | null;
  dispatch_suppressed: number | string | null;
```

Add to `mapRun`, after `failedPasses`:

```ts
    dispatch:
      row.dispatch_sent === null || row.dispatch_suppressed === null
        ? null
        : {
            sent: Number(row.dispatch_sent),
            suppressedFixtureOrigin: Number(row.dispatch_suppressed),
          },
```

Then update **both** run queries — `listRecentScheduledRuns` and `listRecentRuns` — replacing their select list with:

```sql
        select id, scheduled_for, started_at, finished_at, duration_ms,
               outcome, failed_passes, trigger_source,
               (passes -> 'dispatch' ->> 'sent')::int dispatch_sent,
               (passes -> 'dispatch' ->> 'suppressedFixtureOrigin')::int dispatch_suppressed
```

Both, deliberately: they are two copies of the same column list, and updating one leaves the other returning rows whose `dispatch` is always null — which would read as "unknown" forever on whichever surface uses it.

- [ ] **Step 8: Run the suite and watch it pass**

Run: `$env:TEST_DATABASE_URL = "<local throwaway connection string>"; $env:DATABASE_SSL = "disable"; bunx vitest run`
Expected: PASS, no failures.

- [ ] **Step 9: Show it on the screen**

In `src/routes/operations.tsx`, add to the run table's `<thead>` row, after 觸發:

```tsx
                      <th className="px-4 py-2 font-medium">已派送</th>
                      <th className="px-4 py-2 font-medium">已攔截</th>
```

And to the body row, after the 觸發 cell:

```tsx
                        <td className="px-4 py-2 tabular-nums">
                          {dispatchCountLabel(entry.dispatch?.sent ?? null)}
                        </td>
                        <td className="px-4 py-2 tabular-nums">
                          {dispatchCountLabel(entry.dispatch?.suppressedFixtureOrigin ?? null)}
                        </td>
```

Add `dispatchCountLabel` to the existing `@/features/operations/health` import.

- [ ] **Step 10: Typecheck, lint, format**

Run: `bunx tsc --noEmit` — expected: no output.
Run: `bunx prettier --write src/features/operations/health.ts src/features/operations/repository.ts src/routes/operations.tsx src/features/operations/health.test.ts src/features/operations/repository.integration.test.ts`
Run: `bunx eslint src/features/operations/ src/routes/operations.tsx` — expected: no output.

- [ ] **Step 11: Commit**

```bash
git add src/features/operations src/routes/operations.tsx
git commit -m "feat: show what the dispatch pass actually did on /operations"
```

---

### Task 2: Add the missing render-and-deploy step to the runbook

`docs/runbooks/firm-deployment.md` goes from "Migration rehearsal" straight to "Runtime health", whose first words are "After the deploy" — with no step that performs one.

**Files:**
- Modify: `docs/runbooks/firm-deployment.md`
- Test: `scripts/verify-firm-deployment.test.ts`

- [ ] **Step 1: Write the failing documentation test**

Append to `scripts/verify-firm-deployment.test.ts`:

```ts
describe("firm deployment runbook", () => {
  const runbook = readFileSync(
    new URL("../docs/runbooks/firm-deployment.md", import.meta.url),
    "utf8",
  );

  /**
   * The runbook used to jump from the migration rehearsal to a section opening
   * "After the deploy", with nothing in between that deploys anything.
   */
  it("documents rendering the template before the deploy", () => {
    expect(runbook).toContain("wrangler.template.jsonc");
    expect(runbook).toContain("## REQUIRES EXPLICIT APPROVAL: Render and deploy");
  });

  it("orders render-and-deploy after the migration rehearsal and before runtime health", () => {
    const rehearsal = runbook.indexOf("## REQUIRES EXPLICIT APPROVAL: Migration rehearsal");
    const deploy = runbook.indexOf("## REQUIRES EXPLICIT APPROVAL: Render and deploy");
    const health = runbook.indexOf("## Runtime health");

    expect(rehearsal).toBeGreaterThanOrEqual(0);
    expect(deploy).toBeGreaterThan(rehearsal);
    expect(health).toBeGreaterThan(deploy);
  });
});
```

Ensure `readFileSync` and `describe`/`it`/`expect` are imported at the top of that file; add them if absent.

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run scripts/verify-firm-deployment.test.ts`
Expected: FAIL — the runbook contains no "Render and deploy" heading.

- [ ] **Step 3: Add the section**

In `docs/runbooks/firm-deployment.md`, insert between the migration-rehearsal section and `## Runtime health`:

```markdown
## REQUIRES EXPLICIT APPROVAL: Render and deploy

Approval is required before deploying to any hosted runtime.

1. Render `wrangler.template.jsonc` into `wrangler.jsonc`. Six values must be
   real, not placeholders: `FIRM_ID`, `NEON_AUTH_URL`, `WOZTELL_API_BASE_URL`,
   `WOZTELL_CHANNEL_ID`, `EMAIL_FROM`, `RESEND_FROM`.
   `scripts/validate-firm-runtime.ts` rejects a file whose placeholders survive.
2. Set every secret through `wrangler secret put` or the provider dashboard.
   Secrets never belong in the rendered file, in source control, or in a chat
   transcript.
3. Re-run the gate against the rendered file: `npm.cmd run verify:firm`.
4. Deploy: `npx wrangler deploy`.

Rendering `WOZTELL_API_BASE_URL` and `WOZTELL_CHANNEL_ID` is routing
configuration and does not enable sending. Sending requires the auth secret,
which is a separate decision and a separate approval.
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `bunx vitest run scripts/verify-firm-deployment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/firm-deployment.md scripts/verify-firm-deployment.test.ts
git commit -m "docs: give the deployment runbook a step that actually deploys"
```

---

### Task 3: Correct the stale claims in status.md

**Files:**
- Modify: `docs/implementation/kossilon/status.md`

- [ ] **Step 1: Find them**

Run: `grep -n "No branch has been pushed\|CI run on a PR" docs/implementation/kossilon/status.md`
Expected: two matches in the "Exact next step" section.

- [ ] **Step 2: Replace the stale bullet**

Replace the numbered item reading "**A `TEST_DATABASE_URL`, or the CI run on a PR.** Every SQL claim in A–F rests on reading, not running." with:

```markdown
2. ~~A `TEST_DATABASE_URL`, or the CI run on a PR.~~ **Done.** CI runs every
   repository test against a migrated and seeded Postgres on each pull request,
   and the suite also runs locally against a container. The first CI run found
   eight SQL defects; a rehearsal against a populated database found a ninth
   that CI structurally cannot see.
```

Then replace any remaining sentence claiming no branch has been pushed with:

```markdown
Branches have been pushed and PRs #59, #60 and #61 opened; #59 and #60 are
merged. What still needs authorization is a non-local `DATABASE_URL` and a
deployment.
```

- [ ] **Step 3: Verify no stale claim survives**

Run: `grep -n "No branch has been pushed" docs/implementation/kossilon/status.md`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docs/implementation/kossilon/status.md
git commit -m "docs: stop claiming nothing has been pushed and CI has not run"
```

---

### Task 4: Local gate

**Files:** none modified.

- [ ] **Step 1: Run the offline gates**

Run:
```powershell
npm.cmd run check:production-imports
npm.cmd run verify:firm -- --dry-run
```
Expected: both exit 0. `verify:firm --dry-run` reports binding **names** only; if it prints a value, stop and report it as a defect.

- [ ] **Step 2: Run the full suite once more**

Run: `$env:TEST_DATABASE_URL = "<local throwaway connection string>"; $env:DATABASE_SSL = "disable"; bunx vitest run`
Expected: PASS with zero failures. Record the file and test counts; they go in the deploy record.

---

### Task 5: Render the template

**Files:**
- Create: `wrangler.jsonc` (rendered; confirm it is gitignored before writing anything into it)

- [ ] **Step 1: Confirm the rendered file cannot be committed**

Run: `git check-ignore -v wrangler.jsonc`
Expected: a matching `.gitignore` rule. **If there is no match, stop** and add one before rendering — a rendered file carries deployment identity and must not enter source control.

- [ ] **Step 2: Ask the operator for the six values**

Request `FIRM_ID`, `NEON_AUTH_URL`, `WOZTELL_API_BASE_URL`, `WOZTELL_CHANNEL_ID`, `EMAIL_FROM`, `RESEND_FROM`, plus `FIRM_WORKER_NAME`, `FIRM_DOCUMENTS_BUCKET_NAME` and `FIRM_HYPERDRIVE_CONFIGURATION_ID`. These are configuration, not secrets. **Do not request any secret**; the operator sets those themselves in Step 3.

- [ ] **Step 3: Operator sets the secrets**

The operator runs, for each secret binding name:
```powershell
npx wrangler secret put <BINDING_NAME>
```
`RESEND_API_KEY` is required. The WOZTELL auth secret is **deliberately not set** in this phase — that is what keeps sending impossible.

- [ ] **Step 4: Run the gate against the rendered file**

Run: `npm.cmd run verify:firm`
Expected: exit 0. A non-zero exit naming an unrendered placeholder means Step 2 is incomplete.

---

### Task 6: Decide whether the staging database needs a rehearsal

The spec's open question. `0026` carries a data backfill and is not purely additive.

- [ ] **Step 1: Ask whether the staging database holds rows**

If **empty** → skip to Task 7.
If it **holds rows** → continue to Step 2. Do not guess; ask.

- [ ] **Step 2: Rehearse against a throwaway copy**

Take a dump of staging, restore it into a local throwaway container, and run
`bun scripts/db-migrate.ts` against the copy with `DATABASE_URL` pointing at it.
Expected: every migration `0023`–`0033` reports `Applied`. Then re-run it and
expect every line to report `Skipped` — proving the ledger records them and a
second run is a no-op.

This is the technique that caught the `data_origin` defect CI cannot see, because
CI only ever exercises the INSERT path against an empty database.

---

### Task 7: Apply the migrations to staging

> **REQUIRES EXPLICIT APPROVAL AT THE MOMENT OF RUNNING.** `CLAUDE.md` requires
> approval for any non-local `DATABASE_URL`. Approval of this plan is **not**
> approval of this step.

- [ ] **Step 1: Get approval, naming the target**

State which database is about to be migrated and that `0026` carries a backfill. Wait for an explicit yes.

- [ ] **Step 2: Apply**

Run:
```powershell
$env:DATABASE_URL = "<approved staging connection string>"
npm.cmd run db:migrate
```
Expected: `Applied 0023_...` through `Applied 0033_maintenance_runs.sql`.

- [ ] **Step 3: Confirm the ledger**

Run: `select count(*) from schema_migrations;`
Expected: equal to `EXPECTED_MIGRATIONS.length` in `src/features/operations/schema-health.ts` (33 at time of writing).

- [ ] **Step 4: Confirm the SLA policy the runbook warns about**

Run: `select id from sla_policies where work_type = 'corporate_change_request' and active;`
Expected: one row. If empty, corporate change requests will fail with "No active SLA policy exists for work type corporate_change_request" — seed it before continuing.

---

### Task 8: Deploy

- [ ] **Step 1: Deploy the Worker**

Run: `npx wrangler deploy`
Expected: a success line naming the worker and its routes, and the cron trigger `*/5 * * * *` registered.

- [ ] **Step 2: Record the deployed version**

Note the version id wrangler prints. It goes in the deploy record so a later `/operations` reading can be tied to a known build.

---

### Task 9: Observe, and record what is actually true

- [ ] **Step 1: Wait two cron intervals**

Ten minutes. That is `MISSED_TICKS_BEFORE_STALE` — a tick absent after it is late by the product's own definition, not by impatience.

- [ ] **Step 2: Open /operations and record four facts**

| Check | Expected | Meaning if it fails |
| --- | --- | --- |
| Schema panel | 一致, applied = expected | `behind` names the earliest missing migration; `ahead` means the code is older than the database — do **not** migrate |
| A run row | trigger 排程 | `never-observed` after 10 minutes means the cron did not fire; `deployment-runtime` stands |
| Maintenance state | not `never-observed` | as above |
| 已攔截 / 已派送 | 已攔截 > 0 and 已派送 = 0 | **Stop.** 已派送 > 0 means the send-gate did not hold; pause per `pilot-operations.md` before investigating |

- [ ] **Step 3: If, and only if, a 排程 run was observed — clear the blocker**

In `src/features/operations/capabilities.ts`, remove the `deployment-runtime` entry, and remove the `BLOCKED_INTEGRATION: deployment-runtime` markers from `src/features/operations/health.ts` and any other source file carrying one.

Run: `bunx vitest run src/features/operations/capabilities.test.ts`
Expected: PASS. That test cross-checks the inventory against the markers in both directions, so a marker left behind fails it and an entry left behind fails it too.

Do **not** perform this step on the strength of a successful deploy. The entry is cleared by an observed 排程 run and by nothing else.

- [ ] **Step 4: Write the deploy record**

Add a section to `docs/implementation/kossilon/status.md` stating: the date, the deployed version id, the four observed values verbatim, and which blockers changed. If the cron did **not** fire, record that instead — a negative result observed on a real runtime is the most valuable output this phase can produce, and it is not a failure of the phase.

- [ ] **Step 5: Commit**

```bash
git add src/features/operations docs/implementation/kossilon/status.md
git commit -m "feat: record the first observed scheduled run on a real runtime"
```

---

## Notes for the executor

- **Never** ask the user to paste a secret into chat, and never echo one. Binding names only.
- Tasks 1–3 are safe and reversible. Tasks 5, 7 and 8 touch systems outside this machine and each needs its own approval.
- Run the **whole** vitest suite rather than filtering to one file: the `db` project is pinned to `sequence.groupOrder: 1`, and filtering leaves group 0 empty, which hangs.
- Local DB runs need `TEST_DATABASE_URL` **and** `DATABASE_SSL=disable`. Without the second, the client defaults to `ssl: "require"` and fails with `Client network socket disconnected before secure TLS connection was established`, which reads like a network fault rather than a configuration one.
- **Do not try to set `VITE_PROVIDER_MODE=simulated` on staging.** `resolveProviderMode` rejects `simulated` unless `FIRM_ID === "kossilon-demo"`, and `local` throws in a production build; an absent value resolves to `live` deliberately. A staging deployment of any other firm is therefore forced into live provider mode, and there is no setting that means "this is staging, do not send". That is exactly why the safety argument rests on `data_origin` and the dispatcher's `cancelFixtureOriginNotifications` instead — and why Task 9's 已攔截 / 已派送 check is an acceptance criterion rather than a formality. Changing this would mean changing `resolveProviderMode`, which is out of scope here.
- The two new integration tests in Task 1 use the existing `draft()` helper, whose default `failureSummary` carries `TEST_MARKER`, so the suite's existing teardown removes their rows. Do not write these fixtures without that marker: rows the teardown cannot see survive every run and break the *next* one.
