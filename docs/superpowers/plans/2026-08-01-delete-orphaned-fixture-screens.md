# Delete Orphaned Fixture Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete five screens that are out of navigation and backed by `lib/mock-data`, plus the code that exists only to serve them.

**Architecture:** Pure deletion, no new capability. Ordering is load-bearing: the `daily-digest` route variants are removed _before_ the route files, because `index.tsx` renders typed `<Link to="/enquiries">` and TanStack will not compile a link to a deleted route. Every task ends with a green typecheck and a commit.

**Tech Stack:** TanStack Start 1.x (file routing, generated `routeTree.gen.ts`), React 19, TypeScript 5.8 strict, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-01-delete-orphaned-fixture-screens-design.md`

---

## Baseline

Before Task 1, record the numbers you will compare against at the end:

```bash
npx vitest run 2>&1 | grep -E "Test Files|Tests "
npx vitest run --reporter=verbose 2>&1 | grep -E "^ (✓|×)" | sed 's/ [0-9]*ms$//' | sort > /tmp/tests-before.txt
wc -l /tmp/tests-before.txt
```

Expected now: `82 passed`, `485 passed | 37 skipped`.

`/tmp/tests-before.txt` is the list Task 7 diffs against. Capture it before deleting anything or that check cannot be run.

The suite total is expected to **fall** by the end of this plan. That is correct — `enquiry-triage.test.ts` is deleted and `daily-digest.test.ts` loses assertions. Task 7 diffs the test-name list so an unrelated disappearance cannot hide inside the expected decrease.

---

### Task 1: Delete the two already-dead modules

`src/lib/risk.ts` and `src/components/case-card.tsx` are imported by nothing today. Deleting them first proves the gate works before anything load-bearing moves.

**Files:**

- Delete: `src/lib/risk.ts`
- Delete: `src/components/case-card.tsx`

- [ ] **Step 1: Confirm both are unreferenced**

```bash
grep -rn "lib/risk\"\|components/case-card\"" src/ scripts/
```

Expected: no output. If anything prints, stop — the spec's premise is wrong and the file must be kept.

- [ ] **Step 2: Delete them**

```bash
git rm src/lib/risk.ts src/components/case-card.tsx
```

- [ ] **Step 3: Verify the gate is green**

```bash
npm run typecheck && npx vitest run 2>&1 | grep -E "Test Files|Tests "
```

Expected: typecheck silent, `82 passed`, `485 passed | 37 skipped` — unchanged, because nothing referenced these.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: delete two modules nothing imports

risk.ts and case-card.tsx have no importers. They predate the annual-return
feature slice that replaced them."
```

---

### Task 2: Remove the enquiry and task digest items

`DailyDigestRoute` names `/enquiries` and `/tasks`. This task removes those variants, their item builders, and the `enquiries`/`tasks` inputs. `src/routes/index.tsx:58` already passes hardcoded empty arrays, so no behaviour changes.

**Files:**

- Modify: `src/lib/daily-digest.ts`
- Modify: `src/lib/daily-digest.test.ts`
- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Update the failing test first**

In `src/lib/daily-digest.test.ts`, replace the `describe("daily AI digest")` block's first test with the annual-return-only version. Change its name and drop the `enquiries` and `tasks` inputs:

```typescript
it("prioritizes overdue annual returns", () => {
  const digest = buildDailyDigest({
    now: NOW,
    annualReturnCases: [
      annualReturnCase({
        id: "ar-critical",
        companyName: "Harbour Trading Ltd",
        filingDueDate: "2026-07-04",
        riskLevel: "red",
      }),
    ],
  });

  expect(digest.items.map((item) => item.id)).toEqual(["annual-return:ar-critical"]);
  expect(digest.items[0].route).toEqual({
    to: "/annual-returns/$id",
    params: { id: "ar-critical" },
  });
});
```

Then remove the `enquiries:` and `tasks:` properties from the two remaining tests ("caps digest items…" and "returns a calm headline…"), and delete the now-unused `enquiry()` and `task()` fixture helpers and the `import type { Enquiry, Task } from "@/lib/mock-data";` line at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/daily-digest.test.ts
```

Expected: FAIL — `buildDailyDigest` still requires `enquiries` and `tasks`, so TypeScript reports missing properties.

- [ ] **Step 3: Remove the variants from daily-digest.ts**

In `src/lib/daily-digest.ts`:

Delete these two imports:

```typescript
import { triageEnquiry } from "@/lib/enquiry-triage";
import type { Enquiry, Task } from "@/lib/mock-data";
```

Narrow the kind and route types:

```typescript
export type DailyDigestKind = "annual-return";

export type DailyDigestRoute = { to: "/annual-returns/$id"; params: { id: string } };
```

Narrow the input type:

```typescript
export type BuildDailyDigestInput = {
  annualReturnCases: AnnualReturnCase[];
  now?: Date;
  maxItems?: number;
};
```

Delete the `enquiryItem`, `taskSeverity` and `taskItem` functions entirely.

Replace the `candidates` assembly in `buildDailyDigest` and its destructuring:

```typescript
export function buildDailyDigest({
  annualReturnCases,
  now = new Date(),
  maxItems = 5,
}: BuildDailyDigestInput): DailyDigest {
  const candidates = [...annualReturnCases.map((case_) => annualReturnItem(case_, now))]
    .filter((item): item is DailyDigestItem => item !== null)
    .sort(compareItems);
```

Leave the rest of `buildDailyDigest` unchanged.

- [ ] **Step 4: Remove the switch cases in index.tsx**

In `src/routes/index.tsx`, replace the whole `DigestActionLink` function with:

```tsx
function DigestActionLink({ item }: { item: DailyDigestItem }) {
  const className =
    "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent";

  return (
    <Link to="/annual-returns/$id" params={item.route.params} className={className}>
      {item.actionLabel} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}
```

Then update the `buildDailyDigest` call at line 58, removing the two empty arrays:

```typescript
const digest = buildDailyDigest({
  annualReturnCases: upcoming,
  maxItems: 4,
});
```

Delete the three-line comment above that call that explains why enquiries and tasks are withheld — it no longer describes the code.

- [ ] **Step 5: Run tests and typecheck to verify they pass**

```bash
npx vitest run src/lib/daily-digest.test.ts && npm run typecheck
```

Expected: PASS, typecheck silent.

- [ ] **Step 6: Commit**

```bash
git add src/lib/daily-digest.ts src/lib/daily-digest.test.ts src/routes/index.tsx
git commit -m "refactor(digest): drop the enquiry and task item kinds

DailyDigestRoute named /enquiries and /tasks, which blocks deleting those
routes: a typed Link will not compile against a route that is gone.

No behaviour changes. index.tsx already called buildDailyDigest with
hardcoded empty arrays for both, so neither item kind has ever reached the
dashboard in either data mode."
```

---

### Task 3: Delete enquiry-triage

The enquiry item builder deleted in Task 2 was the only caller of `triageEnquiry`.

**Files:**

- Delete: `src/lib/enquiry-triage.ts`
- Delete: `src/lib/enquiry-triage.test.ts`

- [ ] **Step 1: Confirm the only remaining importer is the doomed screen**

```bash
grep -rn "enquiry-triage" src/
```

Expected: only `src/routes/enquiries.tsx` and `src/lib/enquiry-triage.test.ts`. If `daily-digest.ts` still appears, Task 2 Step 3 was not completed.

- [ ] **Step 2: Delete both files**

```bash
git rm src/lib/enquiry-triage.ts src/lib/enquiry-triage.test.ts
```

- [ ] **Step 3: Verify typecheck fails in exactly one place**

```bash
npm run typecheck
```

Expected: FAIL, reporting only `src/routes/enquiries.tsx` cannot find `@/lib/enquiry-triage`. That file is deleted in Task 4. Do not fix it here — do not commit yet either, because the tree does not compile.

- [ ] **Step 4: Proceed directly to Task 4**

This is the one point in the plan where the tree is intentionally red between tasks. Task 4 restores it.

---

### Task 4: Delete the five screens and what they exclusively own

**Files:**

- Delete: `src/routes/clients.tsx`
- Delete: `src/routes/clients.$id.tsx`
- Delete: `src/routes/enquiries.tsx`
- Delete: `src/routes/teams.tsx`
- Delete: `src/routes/tasks.tsx`
- Delete: `src/lib/clients-store.ts`
- Delete: `src/components/convert-to-client-dialog.tsx`
- Delete: `src/components/timeline.tsx`
- Modify (generated): `src/routeTree.gen.ts`

- [ ] **Step 1: Confirm the exclusively-owned modules have no other importer**

```bash
grep -rn "clients-store\|convert-to-client-dialog\|components/timeline" src/ | grep -v "routes/clients\|routes/enquiries\|convert-to-client-dialog.tsx:"
```

Expected: no output.

**Do not** widen this to `client*store`. `src/lib/client-portal-store.ts` is production code behind `/portal` and must survive.

- [ ] **Step 2: Delete the screens and their modules**

```bash
git rm src/routes/clients.tsx src/routes/clients.\$id.tsx src/routes/enquiries.tsx \
       src/routes/teams.tsx src/routes/tasks.tsx \
       src/lib/clients-store.ts src/components/convert-to-client-dialog.tsx \
       src/components/timeline.tsx
```

- [ ] **Step 3: Regenerate the route tree**

```bash
npm run build
```

The TanStack plugin rewrites `src/routeTree.gen.ts` during the build. Expected: build succeeds.

- [ ] **Step 4: Confirm client-portal-store survived**

```bash
test -f src/lib/client-portal-store.ts && echo "OK: portal store intact"
```

Expected: `OK: portal store intact`.

- [ ] **Step 5: Run the full gate**

```bash
npm run typecheck && npm run lint && npx vitest run 2>&1 | grep -E "Test Files|Tests "
```

Expected: typecheck silent, lint 0 errors (6 pre-existing `react-refresh` warnings in `components/ui/` are unrelated), and a **reduced** test total — `enquiry-triage.test.ts` is gone.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete the orphaned fixture screens

clients, clients/\$id, enquiries, teams and tasks were out of navigation and
backed by lib/mock-data. Each is superseded by a screen already running on
Postgres — tasks by /work-queue, clients by /annual-returns — or has no table
behind it at all, which is the case for enquiries.

clients-store, convert-to-client-dialog and timeline had no importer outside
these screens. enquiry-triage went with the digest builder that called it.

This removes them from demo mode as well as production."
```

---

### Task 5: Correct the navigation comment

`src/components/navigation.ts` still promises these routes are "reachable by URL — re-add an entry here once a screen reads real data". That promise is now void.

**Files:**

- Modify: `src/components/navigation.ts`

- [ ] **Step 1: Replace the comment**

Replace the comment block that begins `// Deliberately absent: /clients, /enquiries, /teams and /tasks.` with:

```typescript
// /clients, /clients/$id, /enquiries, /teams and /tasks were deleted, not
// parked. Each was either superseded by a screen already reading Postgres
// (/work-queue, /annual-returns) or had no table behind it. Adding an entry
// here means the screen reads live data — there is no fixture-backed tier.
```

- [ ] **Step 2: Verify the gate**

```bash
npm run typecheck && npm run lint
```

Expected: typecheck silent, lint 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/navigation.ts
git commit -m "docs(nav): record that the orphaned screens were deleted

The comment promised they were parked pending real data. They are gone."
```

---

### Task 6: Pin the remaining mock-data importers

Nothing stops `lib/mock-data` spreading again. This test documents each survivor and makes the finish line enforceable: the list may shrink, never grow.

**Files:**

- Create: `src/lib/-mock-data-importers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const srcDir = new URL("../", import.meta.url);

function sourcesUnder(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return sourcesUnder(new URL(`${entry.name}/`, dir));
    if (!/\.tsx?$/.test(entry.name)) return [];
    return [new URL(entry.name, dir).pathname];
  });
}

const relativeToSrc = (path: string) => path.slice(path.lastIndexOf("/src/") + "/src/".length);

// lib/mock-data is the demo fixture set. Every importer here is a known
// exception with a reason; the list is allowed to shrink and never to grow.
// Deleting an entry is the definition of done for the dashboard phase.
const ALLOWED_IMPORTERS = new Set([
  "lib/mock-data.ts", // the module itself
  "lib/mock-data.test.ts", // its own tests, if any
  "routes/index.tsx", // formatDate only
  "routes/settings.tsx", // cases + formatDate, demo-gated by settingsSectionsForMode
]);

describe("lib/mock-data importers", () => {
  it("finds the sources it is meant to police", () => {
    // A typo in the traversal would make the assertion below vacuously pass.
    expect(sourcesUnder(srcDir).map(relativeToSrc)).toContain("lib/mock-data.ts");
  });

  it("is imported only by the known exceptions", () => {
    const importers = sourcesUnder(srcDir)
      .map(relativeToSrc)
      .filter((path) => path !== "lib/mock-data.ts")
      .filter((path) =>
        /from "[^"]*lib\/mock-data"/.test(readFileSync(new URL(path, srcDir), "utf8")),
      );

    expect(importers.filter((path) => !ALLOWED_IMPORTERS.has(path))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it passes and is not vacuous**

```bash
npx vitest run src/lib/-mock-data-importers.test.ts
```

Expected: 2 passed.

Now prove it can fail. Temporarily delete `"routes/index.tsx"` from `ALLOWED_IMPORTERS`, re-run, and confirm the second test fails naming `routes/index.tsx`. Restore the entry.

- [ ] **Step 3: Commit**

```bash
git add src/lib/-mock-data-importers.test.ts
git commit -m "test: pin the remaining lib/mock-data importers

After the orphaned-screen deletions the set is two routes, both documented.
Nothing previously stopped the fixtures spreading back into new code."
```

---

### Task 7: Final gate and browser verification

**Files:** none modified.

- [ ] **Step 1: Run the whole gate**

```bash
npm run typecheck && npm run lint && npx vitest run 2>&1 | grep -E "Test Files|Tests " && npm run build
```

Expected: typecheck silent, lint 0 errors, build succeeds, tests pass with a total **lower** than the 485 baseline.

- [ ] **Step 2: Diff the test names against the baseline**

```bash
npx vitest run --reporter=verbose 2>&1 | grep -E "^ (✓|×)" | sed 's/ [0-9]*ms$//' | sort > /tmp/tests-after.txt
diff /tmp/tests-before.txt /tmp/tests-after.txt
```

Every `<` line is a test that disappeared. Confirm each is either from `enquiry-triage.test.ts` or is the renamed digest test from Task 2. Expect one `>` line: the renamed `prioritizes overdue annual returns`, plus the two new tests from Task 6.

Any other missing test is a regression — stop and investigate.

- [ ] **Step 3: Verify demo mode in the browser**

Start the preview with `preview_start`, then check:

- the sidebar shows no entry for clients, enquiries, teams or tasks
- `/` renders its KPI tiles and the digest without a console error
- `/annual-returns` and `/whatsapp` still render, confirming nothing shared was removed

Capture a screenshot of the dashboard as evidence.

- [ ] **Step 4: Confirm the deleted routes 404 rather than crash**

Navigate to `/clients` in the preview. Expected: the router's not-found screen from `__root.tsx`, not a blank page or a thrown error.

- [ ] **Step 5: Commit any fixes**

If Steps 1–4 required changes, commit them. If nothing changed, there is nothing to commit — say so rather than creating an empty commit.

---

## Done when

- The five route files and the six modules listed in the spec are gone
- `lib/mock-data` has exactly two importers, both pinned by the Task 6 test
- The full gate is green and every missing test is accounted for
- Demo mode renders with no dead navigation entries
