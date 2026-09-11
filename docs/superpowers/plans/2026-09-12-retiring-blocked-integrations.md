# Retiring Blocked Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a `BLOCKED_INTEGRATION` entry that has outlived its cause fail a test or raise a notice, instead of sitting there being wrong.

**Architecture:** `BlockedIntegration` gains a required `ClearingEvidence` field saying where its clearing condition could be observed — `build`, `runtime`, or `external` with a required reason. A convention test evaluates the `build` ones; a pure function over data `buildOperationsHealth` already holds evaluates the `runtime` ones and surfaces a notice on `/operations`. Nothing ever auto-clears: evidence appearing flags, and a human deletes the entry.

**Tech Stack:** TypeScript 5.8 strict, React 19, TanStack Start, Vitest 4, Bun.

**Spec:** `docs/superpowers/specs/2026-09-12-retiring-blocked-integrations-design.md` (commit `0098077`)

---

## Before you start

**Branch:** `codex/retire-blocked-integrations`, off `main`. Already checked out.

**No database is required for this plan.** Every test here is pure or reads source text. The `db` vitest project will skip without `TEST_DATABASE_URL` — that is fine and expected.

**Conflict warning:** PR #62 (`codex/staging-deploy`, open, unmerged) also modifies `src/routes/operations.tsx`. Task 4 touches the same file. Whichever merges second needs a manual resolution — the two changes sit in different sections of the JSX (#62 adds columns to the run table; Task 4 adds a notice in the blocked-integrations section), so the resolution should be mechanical. Do not rebase onto #62; just expect the conflict.

---

## File structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/features/operations/capabilities.ts` | `ClearingEvidence` type, `evidence` on every entry, runtime evidence registry, `staleBlockedIntegrations`, `runtimeCheckedIds` | 1, 2, 3 |
| `src/features/operations/capabilities.test.ts` | Build evidence registry, both exhaustiveness guards, the build check | 1, 3 |
| `src/features/operations/server-fns.ts` | Computes `staleBlockers` into `OperationsHealthView` | 4 |
| `src/features/operations/server-fns.test.ts` | Pins that an unknown maintenance state flags nothing | 4 |
| `src/routes/operations.tsx` | Renders the "may no longer be true" notice | 4 |

---

### Task 1: Declare where each blocker could be observed, and check the build ones

**This task ends with a FAILING test, on purpose, and you commit it anyway.** `local-postgres`'s build evidence is present today, so the new check catches it immediately. That failure is the only proof the mechanism works; Task 2 clears it. Do not delete the entry in this task.

**Files:**
- Modify: `src/features/operations/capabilities.ts`
- Test: `src/features/operations/capabilities.test.ts`

- [ ] **Step 1: Add the type and the field**

At the top of `src/features/operations/capabilities.ts`, add:

```ts
import type { MaintenanceHealthState } from "./health";
```

After the `BlockedIntegrationId` union, add:

```ts
/**
 * Where this blocker's clearing condition could be observed, if anywhere.
 *
 * Required, not optional, because "nothing in this system can check this" and
 * "nobody thought to check" used to look identical. `local-postgres` stayed
 * listed as release-blocking for a day after both of its own stated clearing
 * conditions were met, and no test could have noticed: `capabilities.test.ts`
 * compares entries against source markers, and here the entry and its marker
 * went stale together, so both sides agreed.
 */
export type ClearingEvidence =
  /** Observable while the test suite runs. */
  | { observable: "build" }
  /** Observable only from a deployed runtime's own data. */
  | { observable: "runtime" }
  /**
   * Not observable from inside the product. `why` is required so that
   * "external" cannot quietly become the default answer for anything awkward:
   * an author has to write down what kind of fact this is, and that sentence is
   * itself reviewable.
   */
  | { observable: "external"; why: string };
```

Then add to the `BlockedIntegration` type, after `blocksRelease`:

```ts
  /** Where a person or a test could see that this is no longer true. */
  evidence: ClearingEvidence;
```

- [ ] **Step 2: Give every entry its evidence**

Add an `evidence` field to each of the seven entries in `BLOCKED_INTEGRATIONS`:

```ts
// malware-scanner-provider
    evidence: {
      observable: "external",
      why: "一份已簽署的供應商合約與其資料處理條款，不會在這個系統內留下任何痕跡。",
    },

// document-text-extraction
    evidence: {
      observable: "external",
      why: "是否具備 Worker 可用的文字抽取層，取決於尚未開始的工程與部署面決定，系統內無從觀察。",
    },

// ai-provider
    evidence: {
      observable: "external",
      why: "與掃描供應商相同：合約與 binding 是否存在，不是這個系統可以自行查證的事。",
    },

// whatsapp-media-download
    evidence: {
      observable: "external",
      why: "WOZTELL 是否已提供媒體下載端點的正式文件，是對方的決定，系統內看不到。",
    },

// external-handoff-destination
    evidence: {
      observable: "external",
      why: "行方內部伺服器的通訊協定與存取權限由另一個團隊掌握，本系統無法探測。",
    },

// local-postgres
    evidence: { observable: "build" },

// deployment-runtime
    evidence: { observable: "runtime" },
```

- [ ] **Step 3: Write the build check**

Append to `src/features/operations/capabilities.test.ts`. Add `BLOCKED_INTEGRATIONS` and `type BlockedIntegrationId` to the existing import from `./capabilities` if they are not already there.

```ts
/**
 * What would have to be true for a `build`-kind blocker to be over.
 *
 * `local-postgres` says it is cleared by "a connectable TEST_DATABASE_URL, or
 * the CI run result on a PR". In-process both look the same: the variable is
 * set, so the `describe.skipIf(!databaseUrl)` suites ran. A developer with no
 * database sees nothing here; CI, which sets it, fails.
 */
const BUILD_EVIDENCE: Partial<Record<BlockedIntegrationId, () => boolean>> = {
  "local-postgres": () => Boolean(process.env.TEST_DATABASE_URL),
};

describe("blocked integrations that may have outlived their cause", () => {
  /**
   * A `build` entry with no evidence function would look checked and never be
   * -- the same defect this mechanism exists to catch, one level up.
   */
  it("has an evidence check for every build-kind entry", () => {
    const unchecked = BLOCKED_INTEGRATIONS.filter(
      (item) => item.evidence.observable === "build" && !BUILD_EVIDENCE[item.id],
    ).map((item) => item.id);

    expect(unchecked).toEqual([]);
  });

  /**
   * The check itself. It does not clear anything -- it fails, and a person
   * deletes the entry. A product that re-asserted its own capabilities from a
   * heuristic would be the dangerous direction of this same idea.
   */
  it("does not still list a blocker whose build evidence is present", () => {
    const stale = BLOCKED_INTEGRATIONS.filter(
      (item) => item.evidence.observable === "build" && BUILD_EVIDENCE[item.id]?.() === true,
    ).map((item) => item.id);

    expect(stale, `these blockers look cleared and should be deleted: ${stale.join(", ")}`).toEqual(
      [],
    );
  });

  it("gives every external entry a reason nothing can check it", () => {
    for (const item of BLOCKED_INTEGRATIONS) {
      if (item.evidence.observable !== "external") continue;
      expect(item.evidence.why.length, `${item.id} needs a why`).toBeGreaterThan(10);
    }
  });
});
```

- [ ] **Step 4: Run it and see the intended failure**

Run: `bunx tsc --noEmit` — expect clean.

Run **without** a database first:
`bunx vitest run src/features/operations/capabilities.test.ts`
Expected: PASS. No `TEST_DATABASE_URL`, so no build evidence, so nothing is flagged.

Now run **with** one, which is what CI does:
`TEST_DATABASE_URL=postgres://unused bunx vitest run src/features/operations/capabilities.test.ts`
Expected: **FAIL** on "does not still list a blocker whose build evidence is present", naming `local-postgres`.

The value need not point at a real database — the check reads only whether the variable is set, exactly as `describe.skipIf(!databaseUrl)` does.

Record both outputs; they go in the commit message.

- [ ] **Step 5: Commit the failing state**

```bash
git add src/features/operations/capabilities.ts src/features/operations/capabilities.test.ts
git commit -m "test: flag blocked integrations whose clearing evidence has arrived"
```

The body must say the check fails against `local-postgres` **right now**, and that the entry is deleted in the next commit deliberately, so the history holds proof the mechanism catches a real stale entry rather than a hypothetical one.

---

### Task 2: Retire `local-postgres`

**Files:**
- Modify: `src/features/operations/capabilities.ts`

- [ ] **Step 1: Delete the entry and its id**

Remove the whole `local-postgres` object from `BLOCKED_INTEGRATIONS`, and remove `| "local-postgres"` from the `BlockedIntegrationId` union.

- [ ] **Step 2: Remove its source marker**

Run: `grep -rn "BLOCKED_INTEGRATION: local-postgres" src/`

Delete each marker found, repairing the surrounding comment so it still reads as a sentence — do not leave a dangling clause. `capabilities.test.ts` cross-checks markers against entries in both directions, so a leftover marker fails the suite.

- [ ] **Step 3: Remove its build-evidence entry**

`BUILD_EVIDENCE` in `src/features/operations/capabilities.test.ts` is typed
`Partial<Record<BlockedIntegrationId, () => boolean>>`, and you have just
removed `local-postgres` from that union — so the key is now a type error.
Delete it:

```ts
const BUILD_EVIDENCE: Partial<Record<BlockedIntegrationId, () => boolean>> = {};
```

Leave the map and its two tests in place. There are now no `build`-kind
entries, so both pass over an empty set — that is correct, not vacuous: the
mechanism is there for the next one. Add a short comment saying exactly that,
so nobody deletes the map as dead code:

```ts
/**
 * Empty since `local-postgres` was retired -- there are no build-kind blockers
 * left. Kept because the next one needs somewhere to declare its evidence, and
 * the guard below is what stops it being added without a check.
 */
```

- [ ] **Step 4: Run the tests both ways**

`bunx vitest run src/features/operations/capabilities.test.ts` — expect PASS.
`TEST_DATABASE_URL=postgres://unused bunx vitest run src/features/operations/capabilities.test.ts` — expect PASS. This is the assertion that Task 1's failure is genuinely resolved.

`bunx tsc --noEmit` — expect clean. Removing a union member can break an exhaustive switch or a `Record` key elsewhere; if it does, fix the caller rather than re-adding the member. Step 3 above handles the one known case.

- [ ] **Step 5: Commit**

```bash
git add src/features/operations/capabilities.ts src/features/operations/capabilities.test.ts src/
git commit -m "fix: stop claiming local database tests are blocked"
```

Body: both stated clearing conditions were met — CI runs every repository test against a migrated, seeded Postgres on every PR, and the suite runs locally against a container — while the entry still claimed release-blocking status and its `effect` still said every SQL judgement came from reading rather than running.

---

### Task 3: Check the runtime ones

**Files:**
- Modify: `src/features/operations/capabilities.ts`
- Test: `src/features/operations/capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/features/operations/capabilities.test.ts`. Add `staleBlockedIntegrations`, `runtimeCheckedIds` and `type BlockedIntegration` to the existing import from `./capabilities`.

```ts
function entry(overrides: Partial<BlockedIntegration>): BlockedIntegration {
  return {
    id: "deployment-runtime",
    capability: "x",
    effect: "x",
    pilotFallback: "x",
    clearedBy: "x",
    blocksRelease: true,
    evidence: { observable: "runtime" },
    ...overrides,
  };
}

describe("staleBlockedIntegrations", () => {
  it("says nothing while the evidence is absent", () => {
    expect(
      staleBlockedIntegrations({ blocked: [entry({})], maintenanceState: "never-observed" }),
    ).toEqual([]);
  });

  /**
   * Any state other than `never-observed` means a scheduled run has been
   * recorded, which is exactly what `deployment-runtime` says would clear it.
   */
  it("flags the entry once a scheduled run has been observed", () => {
    expect(staleBlockedIntegrations({ blocked: [entry({})], maintenanceState: "healthy" })).toEqual(
      ["deployment-runtime"],
    );
  });

  it("flags it even when the schedule is unhealthy, because it still ran", () => {
    expect(staleBlockedIntegrations({ blocked: [entry({})], maintenanceState: "stale" })).toEqual([
      "deployment-runtime",
    ]);
  });

  it("has nothing to say once the entry is gone", () => {
    expect(staleBlockedIntegrations({ blocked: [], maintenanceState: "healthy" })).toEqual([]);
  });

  it("never flags an entry whose evidence does not live at runtime", () => {
    const external = entry({ id: "ai-provider", evidence: { observable: "external", why: "x" } });

    expect(staleBlockedIntegrations({ blocked: [external], maintenanceState: "healthy" })).toEqual(
      [],
    );
  });

  /**
   * The same guard the build side has. A runtime entry with no check would look
   * checked and never be.
   */
  it("has an evidence check for every runtime-kind entry", () => {
    const checked = runtimeCheckedIds();
    const unchecked = BLOCKED_INTEGRATIONS.filter(
      (item) => item.evidence.observable === "runtime" && !checked.includes(item.id),
    ).map((item) => item.id);

    expect(unchecked).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run src/features/operations/capabilities.test.ts`
Expected: FAIL — `staleBlockedIntegrations is not a function`.

- [ ] **Step 3: Implement it**

Append to `src/features/operations/capabilities.ts`:

```ts
/**
 * What would have to be true for a `runtime`-kind blocker to be over.
 *
 * A record rather than a switch, so `runtimeCheckedIds` can report what is
 * covered and a test can fail on an entry nobody wired up.
 */
const RUNTIME_EVIDENCE: Partial<
  Record<BlockedIntegrationId, (input: { maintenanceState: MaintenanceHealthState }) => boolean>
> = {
  // `never-observed` is the absence of any scheduled run at all, so every other
  // state IS the evidence this blocker names. No extra query: the operations
  // screen already computes this state.
  "deployment-runtime": ({ maintenanceState }) => maintenanceState !== "never-observed",
};

/** The ids that have a runtime check, so a test can spot one that does not. */
export function runtimeCheckedIds(): readonly BlockedIntegrationId[] {
  return Object.keys(RUNTIME_EVIDENCE) as BlockedIntegrationId[];
}

/**
 * Blockers still declared whose runtime evidence has arrived.
 *
 * Reports; never clears. The dangerous direction of this idea is a product that
 * re-asserts its own capabilities from a heuristic, so the result is worded as a
 * prompt for a person and the entry stays until somebody deletes it.
 */
export function staleBlockedIntegrations(input: {
  blocked: readonly BlockedIntegration[];
  maintenanceState: MaintenanceHealthState;
}): readonly BlockedIntegrationId[] {
  return input.blocked
    .filter((item) => item.evidence.observable === "runtime")
    .filter((item) => RUNTIME_EVIDENCE[item.id]?.(input) === true)
    .map((item) => item.id);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `bunx vitest run src/features/operations/capabilities.test.ts` — expect PASS.
Run: `bunx tsc --noEmit` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/operations/capabilities.ts src/features/operations/capabilities.test.ts
git commit -m "feat: flag deployment-runtime once a scheduled run has been recorded"
```

---

### Task 4: Surface it on /operations

**Files:**
- Modify: `src/features/operations/server-fns.ts`
- Modify: `src/routes/operations.tsx`
- Test: `src/features/operations/server-fns.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("buildOperationsHealth", ...)` block in `src/features/operations/server-fns.test.ts`:

```ts
  it("flags nothing while no scheduled run has been recorded", async () => {
    const view = await buildOperationsHealth({ now: NOW }, { repository: repository([]) });

    expect(view.staleBlockers).toEqual([]);
  });

  /**
   * Null maintenance means the reads failed and the state is unknown -- which is
   * not evidence that a schedule ran. Guessing here would be the exact
   * false reassurance this codebase refuses everywhere else.
   */
  it("flags nothing when the maintenance state could not be read at all", async () => {
    const repo = repository([]);
    repo.schemaLedger.mockResolvedValue({ present: false, applied: [] });
    repo.queueDepths.mockRejectedValue(new Error('relation "maintenance_runs" does not exist'));

    const view = await buildOperationsHealth({ now: NOW }, { repository: repo });

    expect(view.maintenance).toBeNull();
    expect(view.staleBlockers).toEqual([]);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run src/features/operations/server-fns.test.ts`
Expected: FAIL — `view.staleBlockers` is `undefined`.

- [ ] **Step 3: Compute it**

In `src/features/operations/server-fns.ts`, add `staleBlockedIntegrations` and `type BlockedIntegrationId` to the existing import from `./capabilities`, then add to `OperationsHealthView` after `blockedIntegrations`:

```ts
  /**
   * Blockers still declared whose runtime evidence has arrived, so somebody can
   * go and delete them. Empty when the maintenance state is unknown -- an
   * unreadable database is not evidence that a schedule ran.
   */
  staleBlockers: readonly BlockedIntegrationId[];
```

In the `catch` branch that returns the degraded view, add `staleBlockers: []`.

In `readOperationsState`, lift the maintenance value out of the returned object literal so both fields read the same value:

```ts
  const maintenance = maintenanceHealthOf({
    runs: scheduledRuns,
    now: input.now,
    toleranceSeconds: defaultToleranceSeconds(),
    lastScheduledSuccessAt,
  });
```

then return `maintenance` plus:

```ts
    staleBlockers: staleBlockedIntegrations({
      blocked: BLOCKED_INTEGRATIONS,
      maintenanceState: maintenance.state,
    }),
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `bunx vitest run src/features/operations/server-fns.test.ts` — expect PASS.
Run: `bunx tsc --noEmit` — expect clean.

- [ ] **Step 5: Show it**

In `src/routes/operations.tsx`, inside the blocked-integrations `<section>`, directly above the `<ul>`, add:

```tsx
            {view.staleBlockers.length > 0 ? (
              <p className="border-b bg-status-yellow-soft px-4 py-3 text-sm text-status-yellow">
                以下功能仍被列為停用，但它們所說的解除條件看來已經達成：
                {view.staleBlockers.join("、")}。
                這不代表功能已恢復——請由人確認後，把它從 capabilities.ts 移除。
              </p>
            ) : null}
```

The wording matters: it says the condition *appears* met and asks a person to confirm. It must never say the capability is restored.

- [ ] **Step 6: Verify and commit**

Run: `bunx tsc --noEmit` — expect clean.
Run: `bunx prettier --write src/features/operations/server-fns.ts src/features/operations/server-fns.test.ts src/routes/operations.tsx`
Run: `bunx eslint src/features/operations/ src/routes/operations.tsx` — expect no errors (a pre-existing react-refresh warning in `src/routes/work-queue.tsx` is unrelated).
Run: `bunx vitest run` — expect all passing. Without `TEST_DATABASE_URL` the `db` project skips; expected here.

```bash
git add src/features/operations src/routes/operations.tsx
git commit -m "feat: tell the operations screen when a blocker looks cleared"
```

---

## Notes for the executor

- **Task 1 ends red on purpose.** Do not "fix" it by deleting `local-postgres` early. The two-commit split is the deliverable: commit one shows the mechanism catching a real stale entry, commit two resolves it.
- **Never auto-clear anything.** Every check here reports; a human deletes.
- No database is needed. `TEST_DATABASE_URL=postgres://unused` in Task 1 Step 4 tests whether the variable is *set*, not whether it connects.
- Expect a merge conflict with PR #62 in `src/routes/operations.tsx`. Different sections of the same file; resolve by keeping both.
