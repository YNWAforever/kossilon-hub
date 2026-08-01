# Dashboard Demo Path and Unavailable State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/` a working demo path, and stop it reporting invented figures when a load fails.

**Architecture:** `loadDashboardData` already accepts `DashboardDataDependencies` and defaults to the production server functions. A demo implementation satisfies the same interface and the route loader picks between them, so both modes share one render path. A narrow `DashboardCase` view model makes that possible — the production and demo case types are irreconcilable as they stand, but both can produce the ten fields the dashboard actually renders. `loadDashboardData`'s own body does not change except for error handling.

**Tech Stack:** TanStack Start 1.x (file routing, route context carries `dataMode`), React 19, TypeScript 5.8 strict, Vitest 4, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-01-production-dashboard-design.md`

---

## Baseline

```bash
npm run typecheck && npm run lint 2>&1 | tail -2 && npx vitest run 2>&1 | grep -E "Test Files|Tests "
```

Expected at the start: typecheck silent, `0 errors, 6 warnings` (pre-existing `react-refresh` warnings in `src/components/ui/`), `82 passed`, `477 passed | 37 skipped (514)`.

The suite total should only ever **rise** in this plan. Nothing is deleted.

## What the two case types look like

You will be translating between three shapes. Read this once; the tasks assume it.

**Production** — `src/features/annual-return/types.ts`, `AnnualReturnCase`, 21 fields.
Statuses are title-case English: `"Upcoming"`, `"Client reminder sent"`, `"Documents pending"`,
`"Documents received"`, `"Payment pending"`, `"Payment received"`, `"NAR1 prepared"`,
`"Signature pending"`, `"Ready to file"`, `"Filed"`, `"Completed"`.
Risk is `"green" | "yellow" | "orange" | "red"`.

**Demo** — `src/lib/annual-return-store.ts`, its own `AnnualReturnCase`, 22 different fields.
Statuses are kebab-case: `"preparing"`, `"waiting-documents"`, `"payment-pending"`,
`"internal-review"`, `"ready-to-file"`, `"filed"`.
Risk is derived by `getRiskLevel()` and is `"overdue" | "due-soon" | "blocked" | "healthy" | "ready-to-file" | "filed"`.
Evidence lives in `documents: { id, label, received, required }[]`, not in `checklist`
(the demo `checklist` is `{ id, label, complete }` and has no `required` flag).
Payment is a bare `paymentStatus: "pending" | "paid" | "overdue"`.

**View model** — `DashboardCase`, introduced in Task 2. Ten fields, production vocabulary.

Neither case type can satisfy the other. Both can produce `DashboardCase`.

## File structure

| File                                                  | Responsibility                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/lib/format-date.ts` (new)                        | `formatDate`, moved out of `lib/mock-data` so a production screen stops importing the fixture module |
| `src/features/dashboard/types.ts` (new)               | `DashboardCase` — the ten fields `/` actually renders                                                |
| `src/features/dashboard/demo-dashboard-data.ts` (new) | `demoDashboardDependencies`, the demo→production translation tables, and the demo metric derivation  |
| `src/features/dashboard/dashboard-data.ts`            | unchanged in shape; gains a real error cause and returns `DashboardCase[]`                           |
| `src/components/kpi-card.tsx`                         | gains an `unavailable` state so a failed load renders no numeral                                     |
| `src/routes/index.tsx`                                | loader picks the dependency set; tiles respect `annualReturnDataAvailable`                           |
| `src/routes/-dashboard-modes.test.tsx` (new)          | route-level tests at both data modes, including the no-numeral guard                                 |

---

### Task 1: Move `formatDate` out of the fixture module

`src/routes/index.tsx` is a production screen and its only remaining reason to import
`lib/mock-data` is one pure date helper. Moving it drops the dashboard off the fixture
module entirely.

**Files:**

- Create: `src/lib/format-date.ts`
- Modify: `src/lib/mock-data.ts:587-590`
- Modify: `src/routes/index.tsx:21`
- Modify: `src/routes/settings.tsx`
- Modify: `src/lib/-mock-data-importers.test.ts`

- [ ] **Step 1: Create the new module**

Create `src/lib/format-date.ts`:

```typescript
// Display formatting for the ISO date strings the repositories return.
// Lives outside lib/mock-data so production screens do not import fixtures
// to render a date.
export const formatDate = (isoDate: string) => {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-HK", { day: "2-digit", month: "short", year: "numeric" });
};
```

- [ ] **Step 2: Delete it from the fixture module**

In `src/lib/mock-data.ts`, delete these four lines (around line 587):

```typescript
export const formatDate = (isoDate: string) => {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-HK", { day: "2-digit", month: "short", year: "numeric" });
};
```

Leave `formatDateTime` immediately below it alone — it is a separate helper and out of scope.

- [ ] **Step 3: Repoint both importers**

In `src/routes/index.tsx`, replace line 21:

```typescript
import { formatDate } from "@/lib/mock-data";
```

with:

```typescript
import { formatDate } from "@/lib/format-date";
```

In `src/routes/settings.tsx`, find the `@/lib/mock-data` import. It imports both `cases`
and `formatDate`. Remove `formatDate` from that import (keep `cases`) and add a separate
line:

```typescript
import { formatDate } from "@/lib/format-date";
```

If removing `formatDate` leaves the mock-data import with no named bindings, delete the
whole line — but it should still import `cases`.

- [ ] **Step 4: Update the importers ratchet**

`src/lib/-mock-data-importers.test.ts` pins which files may import the fixture module.
`routes/index.tsx` no longer does. Replace the `EXPECTED_IMPORTERS` block with:

```typescript
const EXPECTED_IMPORTERS = [
  "routes/settings.tsx", // cases only, demo-gated by settingsSectionsForMode
];
```

The assertion is exact equality, so this test fails until Step 3 is done — that is the
point of it.

- [ ] **Step 5: Run the gate**

```bash
npx vitest run src/lib/-mock-data-importers.test.ts && npm run typecheck && npm run lint 2>&1 | tail -2
```

Expected: 3 passed, typecheck silent, `0 errors, 6 warnings`.

If the importers test fails naming `routes/index.tsx`, Step 3's first edit did not take.

- [ ] **Step 6: Run the full suite**

```bash
npx vitest run 2>&1 | grep -E "Test Files|Tests "
```

Expected: `82 passed`, `477 passed | 37 skipped (514)` — unchanged. This is a pure move.

- [ ] **Step 7: Commit**

```bash
git add src/lib/format-date.ts src/lib/mock-data.ts src/routes/index.tsx src/routes/settings.tsx src/lib/-mock-data-importers.test.ts
git commit -m "refactor: move formatDate out of the fixture module

The dashboard is a production screen and its only remaining reason to import
lib/mock-data was one pure date helper. Settings is now the last importer,
and its usage is demo-gated."
```

---

### Task 2: The `DashboardCase` view model

`DashboardData.upcomingAnnualReturns` is typed as the full production `AnnualReturnCase` —
21 fields — while the dashboard renders five and its helpers read five more. Introduce the
narrow type now, before anything needs to satisfy it from the demo side.

**Files:**

- Create: `src/features/dashboard/types.ts`
- Modify: `src/lib/daily-digest.ts`
- Modify: `src/lib/daily-digest.test.ts`

- [ ] **Step 1: Define the type**

Create `src/features/dashboard/types.ts`:

```typescript
import type {
  AnnualReturnStatus,
  ChecklistStatus,
  PaymentStatus,
  RiskLevel,
} from "@/features/annual-return/types";

// The fields the dashboard actually renders, in the production vocabulary.
//
// This exists because the production and demo case types are irreconcilable:
// production statuses are "Upcoming" / "Documents pending" / ..., the demo
// store uses "preparing" / "waiting-documents" / .... Neither type can satisfy
// the other, but both can produce this one.
//
// The nested shapes are deliberately narrower than production's. The dashboard
// only asks the checklist whether required evidence is verified, and only asks
// the payment whether it was received, so carrying invoice numbers and
// document ids here would mean fabricating them on the demo side for nothing.
export type DashboardCase = {
  id: string;
  companyName: string;
  currentStatus: AnnualReturnStatus;
  filingDueDate: string;
  ownerName: string;
  riskLevel: RiskLevel;
  checklist: Array<{ required: boolean; status: ChecklistStatus }>;
  payment: { status: PaymentStatus } | null;
  filingReference: string | null;
  confirmationDocumentId: string | null;
};
```

A production `AnnualReturnCase` is structurally assignable to `DashboardCase` — every field
is present with a compatible type — so nothing breaks by widening what accepts it.

- [ ] **Step 2: Re-type the digest builder**

`src/lib/daily-digest.ts` reads six fields off a case and nothing else. Point it at the
view model.

Replace line 1:

```typescript
import type { AnnualReturnCase, RiskLevel } from "@/features/annual-return/types";
```

with:

```typescript
import type { RiskLevel } from "@/features/annual-return/types";
import type { DashboardCase } from "@/features/dashboard/types";
```

Then replace every remaining `AnnualReturnCase` in the file with `DashboardCase`. There are
four occurrences: the `BuildDailyDigestInput.annualReturnCases` field, the
`missingRequiredCount` parameter, the `annualReturnSeverity` parameter, and the
`annualReturnItem` parameter. Confirm with:

```bash
grep -n "AnnualReturnCase" src/lib/daily-digest.ts
```

Expected after the edit: no output.

- [ ] **Step 3: Narrow the digest test fixture**

In `src/lib/daily-digest.test.ts`, replace the import on line 2:

```typescript
import type { AnnualReturnCase } from "@/features/annual-return/types";
```

with:

```typescript
import type { DashboardCase } from "@/features/dashboard/types";
```

and replace the whole `annualReturnCase` helper (lines 7–42) with the narrow version:

```typescript
function annualReturnCase(partial: Partial<DashboardCase>): DashboardCase {
  return {
    id: partial.id ?? "ar-test",
    companyName: partial.companyName ?? "Harbour Trading Ltd",
    filingDueDate: partial.filingDueDate ?? "2026-07-05",
    currentStatus: partial.currentStatus ?? "Documents pending",
    riskLevel: partial.riskLevel ?? "red",
    ownerName: partial.ownerName ?? "Amy Chan",
    checklist: partial.checklist ?? [{ required: true, status: "Missing" }],
    payment: partial.payment ?? null,
    filingReference: partial.filingReference ?? null,
    confirmationDocumentId: partial.confirmationDocumentId ?? null,
  };
}
```

The three tests below it pass `id`, `companyName`, `filingDueDate`, `riskLevel`,
`currentStatus` and `checklist: []` — all still valid. Do not change them.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/lib/daily-digest.test.ts && npm run typecheck
```

Expected: 3 passed, typecheck silent.

The scores the cap test depends on are unchanged: `ar-critical` 1659, `ar-high` 883,
`ar-medium` 575. If the cap test fails, the narrowed fixture changed a default — most
likely `checklist`, which must default to one unverified required item.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/types.ts src/lib/daily-digest.ts src/lib/daily-digest.test.ts
git commit -m "refactor(dashboard): introduce the DashboardCase view model

The dashboard depended on the entire 21-field production case type to render
ten fields. It is also the type the demo path has to satisfy, and the two case
types cannot satisfy each other."
```

---

### Task 3: A non-hook reader on the demo store

The demo store exports `useAnnualReturnCases()` (a hook) and `getAnnualReturnCaseById()`,
but no non-hook way to read the whole list. A route loader is not a component and cannot
call a hook.

This adds a read, not a write. Demo mode stays read-only per
`docs/adr/0001-demo-mode-is-read-only.md`.

**Files:**

- Modify: `src/lib/annual-return-store.ts:462`
- Modify: `src/lib/annual-return-store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/annual-return-store.test.ts`, inside the existing top-level `describe`:

```typescript
it("reads every case without a hook so a route loader can use it", () => {
  resetAnnualReturnCasesForTest();

  const cases = getAnnualReturnCases();

  expect(cases.length).toBeGreaterThan(0);
  expect(cases.map((caseItem) => caseItem.id)).toEqual(
    cases.map((caseItem) => caseItem.id).filter(Boolean),
  );

  // Callers must not be able to reach into store state through the result.
  cases.pop();
  expect(getAnnualReturnCases().length).toBe(cases.length + 1);
});
```

Add `getAnnualReturnCases` to the existing import from `./annual-return-store` at the top
of that file.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/annual-return-store.test.ts
```

Expected: FAIL — `getAnnualReturnCases is not a function`.

- [ ] **Step 3: Export the getter**

In `src/lib/annual-return-store.ts`, immediately above `export function useAnnualReturnCases`
(around line 462), add:

```typescript
// Non-hook read for route loaders, which are not components. Returns a copy so
// a caller cannot mutate store state through the result — demo mode is
// read-only (docs/adr/0001-demo-mode-is-read-only.md).
export function getAnnualReturnCases(): AnnualReturnCase[] {
  return cloneAnnualReturnCases(cases);
}
```

`cloneAnnualReturnCases` already exists in this file and is used by
`resetAnnualReturnCasesForTest`.

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/lib/annual-return-store.test.ts && npm run typecheck
```

Expected: PASS, typecheck silent.

- [ ] **Step 5: Commit**

```bash
git add src/lib/annual-return-store.ts src/lib/annual-return-store.test.ts
git commit -m "feat(demo): expose a non-hook reader for the annual-return cases

A route loader is not a component and cannot call useAnnualReturnCases. This
returns a copy, so it stays a read."
```

---

### Task 4: Translate demo cases into the view model

**Files:**

- Create: `src/features/dashboard/demo-dashboard-data.ts`
- Create: `src/features/dashboard/demo-dashboard-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/dashboard/demo-dashboard-data.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  DEMO_RISK_TO_PRODUCTION,
  DEMO_STATUS_TO_PRODUCTION,
  toDashboardCase,
} from "./demo-dashboard-data";
import { getAnnualReturnCases, resetAnnualReturnCasesForTest } from "@/lib/annual-return-store";

const TODAY = new Date("2026-07-05T09:00:00+08:00");

describe("demo status translation", () => {
  it("maps every demo status to a production status", () => {
    // The demo store's status union, spelled out. If a status is added there
    // and not here, this fails rather than silently rendering undefined.
    expect(Object.keys(DEMO_STATUS_TO_PRODUCTION).sort()).toEqual([
      "filed",
      "internal-review",
      "payment-pending",
      "preparing",
      "ready-to-file",
      "waiting-documents",
    ]);

    expect(DEMO_STATUS_TO_PRODUCTION).toEqual({
      preparing: "Upcoming",
      "waiting-documents": "Documents pending",
      "payment-pending": "Payment pending",
      "internal-review": "NAR1 prepared",
      "ready-to-file": "Ready to file",
      filed: "Filed",
    });
  });

  it("maps every demo risk level onto the four production levels", () => {
    expect(Object.keys(DEMO_RISK_TO_PRODUCTION).sort()).toEqual([
      "blocked",
      "due-soon",
      "filed",
      "healthy",
      "overdue",
      "ready-to-file",
    ]);

    expect(DEMO_RISK_TO_PRODUCTION).toEqual({
      overdue: "red",
      blocked: "orange",
      "due-soon": "yellow",
      healthy: "green",
      "ready-to-file": "green",
      filed: "green",
    });
  });
});

describe("toDashboardCase", () => {
  it("builds the checklist from demo documents, which are what carry required", () => {
    resetAnnualReturnCasesForTest();
    const demoCase = getAnnualReturnCases()[0];

    const dashboardCase = toDashboardCase(demoCase, TODAY);

    expect(dashboardCase.checklist).toHaveLength(demoCase.documents.length);
    expect(dashboardCase.checklist).toEqual(
      demoCase.documents.map((document) => ({
        required: document.required,
        status: document.received ? "Verified" : "Missing",
      })),
    );
  });

  it("carries the identity fields across unchanged", () => {
    resetAnnualReturnCasesForTest();
    const demoCase = getAnnualReturnCases()[0];

    const dashboardCase = toDashboardCase(demoCase, TODAY);

    expect(dashboardCase).toMatchObject({
      id: demoCase.id,
      companyName: demoCase.companyName,
      filingDueDate: demoCase.dueDate,
      ownerName: demoCase.owner,
    });
  });

  it("reports payment received only when the demo case is paid", () => {
    resetAnnualReturnCasesForTest();
    const demoCase = getAnnualReturnCases()[0];

    expect(toDashboardCase({ ...demoCase, paymentStatus: "paid" }, TODAY).payment).toEqual({
      status: "Payment received",
    });
    expect(toDashboardCase({ ...demoCase, paymentStatus: "pending" }, TODAY).payment).toEqual({
      status: "Payment pending",
    });
    expect(toDashboardCase({ ...demoCase, paymentStatus: "overdue" }, TODAY).payment).toEqual({
      status: "Overdue",
    });
  });

  it("treats a filed case as having its filing proof recorded", () => {
    resetAnnualReturnCasesForTest();
    const demoCase = getAnnualReturnCases()[0];

    const filed = toDashboardCase(
      {
        ...demoCase,
        status: "filed",
        submission: { reference: "NAR1-9", submittedAt: "2026-06-01", submittedBy: "Amy Chan" },
      },
      TODAY,
    );

    expect(filed.currentStatus).toBe("Filed");
    expect(filed.filingReference).toBe("NAR1-9");

    const unfiled = toDashboardCase(
      { ...demoCase, status: "preparing", submission: undefined },
      TODAY,
    );
    expect(unfiled.filingReference).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/features/dashboard/demo-dashboard-data.test.ts
```

Expected: FAIL — cannot resolve `./demo-dashboard-data`.

- [ ] **Step 3: Write the module**

Create `src/features/dashboard/demo-dashboard-data.ts`:

```typescript
import type { RiskLevel } from "@/features/annual-return/types";
import type { DashboardCase } from "@/features/dashboard/types";
import type {
  AnnualReturnCase as DemoAnnualReturnCase,
  AnnualReturnRiskLevel as DemoRiskLevel,
  AnnualReturnStatus as DemoStatus,
} from "@/lib/annual-return-store";
import { getRiskLevel } from "@/lib/annual-return-store";

// Fabricating figures here is what demo mode is for. The rule this codebase
// enforces is no fabrication in production, which is why the same translation
// would be unacceptable on a production path.
//
// Mapping six demo statuses onto the eleven-value production vocabulary has no
// single correct answer. These tables encode one reading, and the tests pin
// them so a later change is deliberate rather than accidental.

export const DEMO_STATUS_TO_PRODUCTION: Record<DemoStatus, DashboardCase["currentStatus"]> = {
  preparing: "Upcoming",
  "waiting-documents": "Documents pending",
  "payment-pending": "Payment pending",
  "internal-review": "NAR1 prepared",
  "ready-to-file": "Ready to file",
  filed: "Filed",
};

export const DEMO_RISK_TO_PRODUCTION: Record<DemoRiskLevel, RiskLevel> = {
  overdue: "red",
  blocked: "orange",
  "due-soon": "yellow",
  healthy: "green",
  // A case that is ready to file, or already filed, carries no risk.
  "ready-to-file": "green",
  filed: "green",
};

const DEMO_PAYMENT_TO_PRODUCTION = {
  paid: "Payment received",
  pending: "Payment pending",
  overdue: "Overdue",
} as const;

export function toDashboardCase(demoCase: DemoAnnualReturnCase, today = new Date()): DashboardCase {
  return {
    id: demoCase.id,
    companyName: demoCase.companyName,
    currentStatus: DEMO_STATUS_TO_PRODUCTION[demoCase.status],
    filingDueDate: demoCase.dueDate,
    ownerName: demoCase.owner,
    riskLevel: DEMO_RISK_TO_PRODUCTION[getRiskLevel(demoCase, today)],
    // Production's checklist is the evidence list. The demo store keeps
    // evidence in `documents` — its `checklist` has no `required` flag, so it
    // cannot answer the question the dashboard asks.
    checklist: demoCase.documents.map((document) => ({
      required: document.required,
      status: document.received ? ("Verified" as const) : ("Missing" as const),
    })),
    payment: { status: DEMO_PAYMENT_TO_PRODUCTION[demoCase.paymentStatus] },
    filingReference: demoCase.submission?.reference ?? null,
    confirmationDocumentId: demoCase.receipt?.receiptNumber ?? null,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/features/dashboard/demo-dashboard-data.test.ts && npm run typecheck
```

Expected: 6 passed, typecheck silent.

If the `Record<DemoStatus, ...>` line fails to compile, a demo status is missing from the
table — TypeScript will name it. That is the table doing its job.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/demo-dashboard-data.ts src/features/dashboard/demo-dashboard-data.test.ts
git commit -m "feat(dashboard): translate demo cases into the view model

Two exhaustive Record tables, so adding a demo status is a compile error
rather than an undefined rendered on screen."
```

---

### Task 5: Derive the demo metrics and assemble the dependency set

**Files:**

- Modify: `src/features/dashboard/demo-dashboard-data.ts`
- Modify: `src/features/dashboard/demo-dashboard-data.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/features/dashboard/demo-dashboard-data.test.ts`:

```typescript
import { demoDashboardMetrics, demoDashboardDependencies } from "./demo-dashboard-data";

describe("demoDashboardMetrics", () => {
  // These fields are exactly what getRiskLevel reads. Omitting checklist,
  // signatureStatus or reviewStatus makes getReadinessScore throw on undefined
  // rather than fail an assertion, which is a confusing way to find out.
  const openCase = {
    dueDate: "2026-07-09",
    status: "waiting-documents" as const,
    paymentStatus: "pending" as const,
    signatureStatus: "missing" as const,
    reviewStatus: "not-started" as const,
    checklist: [{ id: "c1", label: "Directors confirmed", complete: false }],
    documents: [
      { id: "d1", label: "Signed NAR1", required: true, received: false },
      { id: "d2", label: "Register of members", required: true, received: true },
      { id: "d3", label: "Optional extra", required: false, received: false },
    ],
  };

  it("counts deadline windows, missing required evidence, and unpaid cases", () => {
    const metrics = demoDashboardMetrics(
      [
        // 4 days out, one required document missing, unpaid
        { ...openCase, id: "a", dueDate: "2026-07-09" },
        // 20 days out, same shape
        { ...openCase, id: "b", dueDate: "2026-07-25" },
        // overdue
        { ...openCase, id: "c", dueDate: "2026-06-30" },
        // filed: excluded from every count
        { ...openCase, id: "d", dueDate: "2026-07-09", status: "filed", paymentStatus: "paid" },
      ],
      TODAY,
    );

    expect(metrics).toMatchObject({
      dueIn7: 1,
      dueIn30: 2,
      overdue: 1,
      missingDocuments: 3,
      paymentPending: 3,
    });
  });

  it("counts open cases as assigned to the viewer, since the demo has one operator", () => {
    const metrics = demoDashboardMetrics(
      [
        { ...openCase, id: "a" },
        { ...openCase, id: "b", status: "filed" },
      ],
      TODAY,
    );

    expect(metrics.assignedToMe).toBe(1);
  });

  it("counts red and orange cases as high risk", () => {
    const metrics = demoDashboardMetrics(
      [
        { ...openCase, id: "overdue-case", dueDate: "2026-06-01" },
        { ...openCase, id: "healthy-case", dueDate: "2026-12-01" },
      ],
      TODAY,
    );

    expect(metrics.highRisk).toBe(1);
  });
});

describe("demoDashboardDependencies", () => {
  it("satisfies the loader's dependency contract with demo figures", async () => {
    resetAnnualReturnCasesForTest();

    const [metrics, cases] = await Promise.all([
      demoDashboardDependencies.getAnnualReturnDashboardMetrics(),
      demoDashboardDependencies.listAnnualReturnCases({ data: {} }),
    ]);

    expect(cases.length).toBeGreaterThan(0);
    // Production vocabulary, not the demo store's kebab-case.
    for (const dashboardCase of cases) {
      expect(dashboardCase.currentStatus).toMatch(/^[A-Z]/);
      expect(["green", "yellow", "orange", "red"]).toContain(dashboardCase.riskLevel);
    }

    // Not the all-zero fallback — that is the defect this whole plan fixes.
    const total = Object.values(metrics).reduce((sum, value) => sum + value, 0);
    expect(total).toBeGreaterThan(0);
  });
});
```

Merge the two new `import` lines into the existing import block at the top of the file
rather than leaving imports in the middle — Prettier will not do this for you.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/features/dashboard/demo-dashboard-data.test.ts
```

Expected: FAIL — `demoDashboardMetrics` is not exported.

- [ ] **Step 3: Add the derivation and the dependency set**

Append to `src/features/dashboard/demo-dashboard-data.ts`:

```typescript
import type { AnnualReturnDashboardMetrics } from "@/features/annual-return/repository";
import { getAnnualReturnCases } from "@/lib/annual-return-store";

// The demo store keeps this private, so it is restated here rather than
// exported from a read-only fixture module for one caller.
function daysUntil(date: string, today: Date): number {
  const target = new Date(`${date}T00:00:00`);
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - start.getTime()) / 86_400_000);
}

// Everything demoDashboardMetrics reads directly, plus everything getRiskLevel
// reads underneath it. Keep these in step: getRiskLevel takes a full demo case,
// so the call below casts, and a field it reads that is missing here would
// throw at runtime with no compile error.
type MetricsInput = Pick<
  DemoAnnualReturnCase,
  | "id"
  | "dueDate"
  | "status"
  | "paymentStatus"
  | "documents"
  | "checklist"
  | "signatureStatus"
  | "reviewStatus"
>;

export function demoDashboardMetrics(
  demoCases: MetricsInput[],
  today = new Date(),
): AnnualReturnDashboardMetrics {
  const open = demoCases.filter((demoCase) => demoCase.status !== "filed");

  const missingRequired = (demoCase: MetricsInput) =>
    demoCase.documents.filter((document) => document.required && !document.received).length;

  return {
    dueIn7: open.filter((demoCase) => {
      const days = daysUntil(demoCase.dueDate, today);
      return days >= 0 && days <= 7;
    }).length,
    dueIn30: open.filter((demoCase) => {
      const days = daysUntil(demoCase.dueDate, today);
      return days >= 0 && days <= 30;
    }).length,
    overdue: open.filter((demoCase) => daysUntil(demoCase.dueDate, today) < 0).length,
    highRisk: open.filter((demoCase) => {
      const risk = DEMO_RISK_TO_PRODUCTION[getRiskLevel(demoCase as DemoAnnualReturnCase, today)];
      return risk === "red" || risk === "orange";
    }).length,
    missingDocuments: open.reduce((total, demoCase) => total + missingRequired(demoCase), 0),
    paymentPending: open.filter((demoCase) => demoCase.paymentStatus !== "paid").length,
    // The demo is a single-operator story, so every open case is the viewer's.
    assignedToMe: open.length,
  };
}

// Satisfies DashboardDataDependencies. The route loader swaps this in for the
// production server functions when dataMode is "demo".
export const demoDashboardDependencies = {
  getAnnualReturnDashboardMetrics: async () => demoDashboardMetrics(getAnnualReturnCases()),
  listAnnualReturnCases: async () =>
    getAnnualReturnCases().map((demoCase) => toDashboardCase(demoCase)),
};
```

Move the two new `import` statements up into the existing import block at the top of the
file — imports below other code will fail lint.

`getRiskLevel` needs a full demo case; `MetricsInput` is a subset so the call site casts.
That cast is safe because `getRiskLevel` only reads `status`, `dueDate`, `documents`,
`paymentStatus`, `signatureStatus`, `checklist` and `reviewStatus` — but the cast is a real
sharp edge. If `getRiskLevel` starts reading a field `MetricsInput` does not carry, this
throws at runtime with no compile error. If that worries you, widen `MetricsInput` to the
full `DemoAnnualReturnCase` and build fuller fixtures in the test instead.

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/features/dashboard/demo-dashboard-data.test.ts && npm run typecheck && npm run lint 2>&1 | tail -2
```

Expected: 10 passed, typecheck silent, `0 errors, 6 warnings`.

If `highRisk` comes back different from 1, `getRiskLevel` also considers blockers — read it
in `src/lib/annual-return-store.ts:555` and adjust the _test's_ expectation to the real
behaviour, not the derivation to the guessed number. Report which you did.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/demo-dashboard-data.ts src/features/dashboard/demo-dashboard-data.test.ts
git commit -m "feat(dashboard): derive demo metrics and expose the dependency set

demoDashboardDependencies satisfies the same interface as the production
server functions, so both modes can share one render path."
```

---

### Task 6: Stop discarding the error, and return the view model

`loadDashboardData` has a bare `catch {}`. An authorization failure, a network blip and a
genuine outage all render one fixed string and nothing is logged.

**Files:**

- Modify: `src/features/dashboard/dashboard-data.ts`
- Modify: `src/features/dashboard/dashboard-data.test.ts`
- Modify: `src/routes/index.tsx:280` (`nextAnnualReturnAction` signature only)

- [ ] **Step 1: Write the failing test**

In `src/features/dashboard/dashboard-data.test.ts`, replace the import on line 2:

```typescript
import type { AnnualReturnCase } from "@/features/annual-return/types";
```

with:

```typescript
import type { DashboardCase } from "@/features/dashboard/types";
import { demoDashboardDependencies } from "./demo-dashboard-data";
import { resetAnnualReturnCasesForTest } from "@/lib/annual-return-store";
```

and replace the `annualReturnCase` helper (lines 15–38) with:

```typescript
function annualReturnCase(partial: Partial<DashboardCase>): DashboardCase {
  return {
    id: partial.id ?? "ar-test",
    companyName: partial.companyName ?? "Harbour Trading Ltd",
    filingDueDate: partial.filingDueDate ?? "2026-07-05",
    currentStatus: partial.currentStatus ?? "Documents pending",
    riskLevel: partial.riskLevel ?? "red",
    ownerName: partial.ownerName ?? "Amy Chan",
    checklist: partial.checklist ?? [],
    payment: partial.payment ?? null,
    filingReference: partial.filingReference ?? null,
    confirmationDocumentId: partial.confirmationDocumentId ?? null,
  };
}
```

Then replace the second test ("falls back instead of throwing…") with these four:

```typescript
it("carries the real cause through instead of a fixed string", async () => {
  const data = await loadDashboardData({
    getAnnualReturnDashboardMetrics: async () => {
      throw new Error("connection terminated unexpectedly");
    },
    listAnnualReturnCases: async () => [],
  });

  expect(data.annualReturnDataAvailable).toBe(false);
  expect(data.annualReturnDataErrorKind).toBe("unavailable");
  expect(data.annualReturnDataError).toContain("connection terminated unexpectedly");
});

it("distinguishes an authorization failure from an outage", async () => {
  const data = await loadDashboardData({
    getAnnualReturnDashboardMetrics: async () => {
      throw new Error("Forbidden: staff access required");
    },
    listAnnualReturnCases: async () => [],
  });

  expect(data.annualReturnDataErrorKind).toBe("forbidden");
  expect(data.annualReturnDataError).not.toBe(
    (
      await loadDashboardData({
        getAnnualReturnDashboardMetrics: async () => {
          throw new Error("connection terminated unexpectedly");
        },
        listAnnualReturnCases: async () => [],
      })
    ).annualReturnDataError,
  );
});

it("returns the demo set when given the demo dependencies", async () => {
  // The spec's integration check: no server function is touched, and the
  // shape the dashboard renders comes back intact. This test lives here
  // rather than beside the demo module because it needs the widened
  // DashboardCase[] return type introduced in this task.
  resetAnnualReturnCasesForTest();

  const data = await loadDashboardData(demoDashboardDependencies);

  expect(data.annualReturnDataAvailable).toBe(true);
  expect(data.annualReturnDataError).toBeNull();
  expect(data.annualReturnDataErrorKind).toBeNull();
  expect(data.upcomingAnnualReturns.length).toBeGreaterThan(0);
  // loadDashboardData drops completed cases and caps the list at 8.
  expect(data.upcomingAnnualReturns.length).toBeLessThanOrEqual(8);
  expect(data.upcomingAnnualReturns.every((c) => c.currentStatus !== "Completed")).toBe(true);
});

it("still degrades rather than throwing, and reports no cases", async () => {
  const data = await loadDashboardData({
    getAnnualReturnDashboardMetrics: async () => {
      throw new Error("boom");
    },
    listAnnualReturnCases: async () => [],
  });

  expect(data.upcomingAnnualReturns).toEqual([]);
  expect(data.metrics).toEqual({
    dueIn7: 0,
    dueIn30: 0,
    overdue: 0,
    highRisk: 0,
    missingDocuments: 0,
    paymentPending: 0,
    assignedToMe: 0,
  });
});
```

The all-zero `metrics` object stays in the return value — the fix is that the _tiles_ stop
rendering it (Tasks 7 and 8), not that the field disappears. Removing it would mean every
tile needs a null check.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/features/dashboard/dashboard-data.test.ts
```

Expected: FAIL — `annualReturnDataErrorKind` is `undefined`.

- [ ] **Step 3: Rewrite the error path**

In `src/features/dashboard/dashboard-data.ts`:

Replace the import on line 6:

```typescript
import type { AnnualReturnCase } from "@/features/annual-return/types";
```

with:

```typescript
import type { DashboardCase } from "@/features/dashboard/types";
```

Export the dependency type and widen the case type — replace lines 8–18:

```typescript
export type DashboardDataDependencies = {
  getAnnualReturnDashboardMetrics: () => Promise<AnnualReturnDashboardMetrics>;
  listAnnualReturnCases: (input: { data: Record<string, never> }) => Promise<DashboardCase[]>;
};

export type DashboardDataErrorKind = "forbidden" | "unavailable";

export type DashboardData = {
  metrics: AnnualReturnDashboardMetrics;
  upcomingAnnualReturns: DashboardCase[];
  annualReturnDataAvailable: boolean;
  annualReturnDataError: string | null;
  annualReturnDataErrorKind: DashboardDataErrorKind | null;
};
```

Replace the fixed message constant on line 29:

```typescript
const fallbackAnnualReturnDataError = "Annual return data is temporarily unavailable.";
```

with:

```typescript
// The repository throws `Forbidden: ` / `Unauthorized: ` prefixed errors by
// convention for authz failures. Those mean sign in again; anything else means
// try again later. Collapsing them into one message, as this used to, told the
// reader nothing about which.
function describeAnnualReturnError(error: unknown): {
  kind: DashboardDataErrorKind;
  message: string;
} {
  const cause = error instanceof Error ? error.message : String(error);

  if (/^(Forbidden|Unauthorized):/.test(cause)) {
    return {
      kind: "forbidden",
      message: `You do not have access to annual return data. ${cause}`,
    };
  }

  return { kind: "unavailable", message: `Annual return data could not be loaded. ${cause}` };
}
```

Then replace the `catch` block (lines 53–60):

```typescript
  } catch (error) {
    // This is a staff-only internal screen, so surfacing the cause is a help
    // rather than a disclosure. Do not copy this onto a client-facing route.
    console.error("Dashboard annual-return load failed", error);
    const { kind, message } = describeAnnualReturnError(error);

    return {
      metrics: fallbackAnnualReturnMetrics,
      upcomingAnnualReturns: [],
      annualReturnDataAvailable: false,
      annualReturnDataError: message,
      annualReturnDataErrorKind: kind,
    };
  }
```

And add `annualReturnDataErrorKind: null` to the success return (after
`annualReturnDataError: null`).

- [ ] **Step 4: Keep `index.tsx` compiling**

`upcomingAnnualReturns` is now `DashboardCase[]`, but `nextAnnualReturnAction` in
`src/routes/index.tsx:280` still takes `AnnualReturnCase`. Change its signature:

```typescript
function nextAnnualReturnAction(case_: DashboardCase) {
```

and add `DashboardCase` to the imports at the top of `index.tsx`:

```typescript
import type { DashboardCase } from "@/features/dashboard/types";
```

Its body reads `checklist`, `payment?.status`, `filingReference`, `confirmationDocumentId`
and `currentStatus` — all present on `DashboardCase`. No body change.

If `AnnualReturnCase` is now unused in `index.tsx`, remove it from the type import on
line 16, keeping `AnnualReturnStatus`.

- [ ] **Step 5: Run the gate**

```bash
npx vitest run src/features/dashboard/dashboard-data.test.ts && npm run typecheck && npm run lint 2>&1 | tail -2
```

Expected: 5 passed, typecheck silent, `0 errors, 6 warnings`.

- [ ] **Step 6: Commit**

```bash
git add src/features/dashboard/dashboard-data.ts src/features/dashboard/dashboard-data.test.ts src/routes/index.tsx
git commit -m "fix(dashboard): stop discarding the cause of a failed load

A bare catch {} rendered one fixed string for an authz failure, a network blip
and a genuine outage alike, and logged nothing. The cause now reaches the
reader and an authz failure reads differently from an outage."
```

---

### Task 7: A KPI tile that can say "unavailable"

`fallbackAnnualReturnMetrics` is all zeros and the tiles render it unconditionally, so a
failed load reads as "0 overdue cases" in the same typography as a real figure. This is the
same defect class as fixtures in production, expressed numerically: a figure a user can act
on, presented as fact, that is not a measurement of anything.

**Files:**

- Modify: `src/components/kpi-card.tsx`
- Create: `src/components/kpi-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/kpi-card.test.tsx`:

```typescript
// @vitest-environment jsdom
import { CalendarClock } from "lucide-react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KpiCard } from "./kpi-card";

function render(props: Parameters<typeof KpiCard>[0]) {
  return renderToString(createElement(KpiCard, props));
}

describe("KpiCard", () => {
  it("renders the figure when data is available", () => {
    const html = render({ label: "Overdue cases", value: 4, icon: CalendarClock });

    expect(html).toContain('data-testid="kpi-value"');
    expect(html).toMatch(/data-testid="kpi-value"[^>]*>4</);
  });

  it("renders no numeral at all when the figure is unavailable", () => {
    const html = render({
      label: "Overdue cases",
      value: 4,
      icon: CalendarClock,
      unavailable: true,
    });

    const rendered = html.match(/data-testid="kpi-value"[^>]*>([^<]*)</)?.[1] ?? "";

    expect(rendered).not.toMatch(/\d/);
    expect(html).toContain("Unavailable");
  });
});
```

Note: `// @vitest-environment jsdom` must be the very first line of the file. This project
has no Vitest setup file and no `@testing-library/jest-dom`; `renderToString` is the house
style for component tests.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/components/kpi-card.test.tsx
```

Expected: FAIL — no `data-testid="kpi-value"` in the output.

- [ ] **Step 3: Add the unavailable state**

Replace the whole of `src/components/kpi-card.tsx`:

```tsx
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { StatusTone } from "@/lib/status";
import { toneClasses } from "@/lib/status";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  unavailable = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: StatusTone;
  // When the figure could not be measured, render an em dash rather than the
  // caller's fallback. A zero in this typography reads as a measurement.
  unavailable?: boolean;
}) {
  const t = toneClasses[tone];
  return (
    <div className="group relative flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", t.bg)}>
          <Icon className={cn("h-4 w-4", t.text)} />
        </div>
      </div>
      <div className="mt-4">
        <p
          data-testid="kpi-value"
          aria-label={unavailable ? `${label}: unavailable` : undefined}
          className={cn(
            "font-display text-3xl font-semibold tabular-nums",
            unavailable ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {unavailable ? "—" : value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{unavailable ? "Unavailable" : hint}</p>
      </div>
    </div>
  );
}
```

The hint `<p>` is now rendered unconditionally rather than behind `hint && ...`, so the
"Unavailable" caption has somewhere to go. Every current caller passes a `hint`, so nothing
regresses.

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/components/kpi-card.test.tsx && npm run typecheck
```

Expected: 2 passed, typecheck silent.

- [ ] **Step 5: Commit**

```bash
git add src/components/kpi-card.tsx src/components/kpi-card.test.tsx
git commit -m "feat(ui): let a KPI tile report that its figure is unavailable

An all-zero fallback rendered in the same typography as a real figure is a
number a user can act on that is not a measurement of anything."
```

---

### Task 8: Branch the loader and gate the tiles

**Files:**

- Modify: `src/routes/index.tsx:23-36` (loader)
- Modify: `src/routes/index.tsx:38-127` (component)

- [ ] **Step 1: Branch the loader**

In `src/routes/index.tsx`, replace line 24:

```typescript
  loader: () => loadDashboardData(),
```

with:

```typescript
  loader: ({ context }) =>
    loadDashboardData(context.dataMode === "demo" ? demoDashboardDependencies : undefined),
```

Compare against `"demo"`, never against `"production"` — `dataMode` has more than two
possible spellings of "not demo" and the house rule is to branch on demo.

Add the import:

```typescript
import { demoDashboardDependencies } from "@/features/dashboard/demo-dashboard-data";
```

`loadDashboardData` itself does not change. Passing `undefined` selects its default
production dependencies.

- [ ] **Step 2: Gate the tiles**

In `DashboardPage`, add `unavailable={!annualReturnDataAvailable}` to all six `KpiCard`
elements. The block becomes:

```tsx
<section data-testid="kpi-grid" className="grid grid-cols-2 gap-4 md:grid-cols-4">
  <KpiCard
    label="Due in 7 days"
    value={m.dueIn7}
    hint="Annual returns"
    icon={CalendarClock}
    tone="orange"
    unavailable={!annualReturnDataAvailable}
  />
  <KpiCard
    label="Due in 30 days"
    value={m.dueIn30}
    hint="Annual returns"
    icon={CalendarClock}
    tone="yellow"
    unavailable={!annualReturnDataAvailable}
  />
  <KpiCard
    label="Overdue cases"
    value={m.overdue}
    hint="Immediate action"
    icon={Flame}
    tone="red"
    unavailable={!annualReturnDataAvailable}
  />
  <KpiCard
    label="Missing documents"
    value={m.missingDocs}
    hint="Across all cases"
    icon={FileWarning}
    tone="yellow"
    unavailable={!annualReturnDataAvailable}
  />
  <KpiCard
    label="Payment pending"
    value={m.paymentPending}
    hint="Clients unpaid"
    icon={CreditCard}
    tone="orange"
    unavailable={!annualReturnDataAvailable}
  />
  <KpiCard
    label="Assigned to me"
    value={m.myCases}
    hint="Open cases"
    icon={UserCheck}
    tone="blue"
    unavailable={!annualReturnDataAvailable}
  />
</section>
```

Note the added `data-testid="kpi-grid"` on the `<section>` — Task 9 uses it.

- [ ] **Step 3: Stop the other two numerals from lying**

Two more figures on this page are read straight off `metrics` and would still render `0`
on a failed load.

Replace the `PageHeader` subtitle (line 64):

```tsx
        subtitle={
          annualReturnDataAvailable
            ? `Good morning, ${session?.name.split(" ")[0] ?? "there"} — you have ${m.myCases} active cases.`
            : `Good morning, ${session?.name.split(" ")[0] ?? "there"}.`
        }
```

And in the "Requires immediate attention" section near the bottom, replace the paragraph:

```tsx
<p className="mt-1 text-xs text-status-red/80">
  {annualReturnDataAvailable
    ? `${m.overdue} annual returns are overdue. Assign or escalate now to avoid Companies Registry penalties.`
    : "Overdue counts are unavailable. Open the board to check directly."}
</p>
```

- [ ] **Step 4: Show the error cause in the banner**

Replace the unavailable banner block (lines 67–81) so it uses the real message and varies
its guidance by kind:

```tsx
{
  !annualReturnDataAvailable && (
    <section className="rounded-lg border border-status-yellow/40 bg-status-yellow-soft px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 text-status-orange" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {annualReturnDataErrorKind === "forbidden"
              ? "You do not have access to annual return data"
              : "Annual return data is temporarily unavailable"}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {annualReturnDataErrorKind === "forbidden"
              ? "Sign in again, or ask an administrator to grant staff access."
              : "Annual-return figures are hidden until the live query recovers."}
          </p>
          {annualReturnDataError && (
            <p className="mt-1 text-xs text-muted-foreground/80">{annualReturnDataError}</p>
          )}
        </div>
      </div>
    </section>
  );
}
```

Destructure the two new fields from the loader data at the top of `DashboardPage`:

```typescript
const {
  metrics: realMetrics,
  upcomingAnnualReturns,
  annualReturnDataAvailable,
  annualReturnDataError,
  annualReturnDataErrorKind,
} = Route.useLoaderData() as DashboardData;
```

The old copy said "Showing fallback annual-return KPI totals", which is no longer true —
the tiles now show nothing rather than fallback totals.

- [ ] **Step 5: Run the gate**

```bash
npm run typecheck && npm run lint 2>&1 | tail -2 && npx vitest run 2>&1 | grep -E "Test Files|Tests "
```

Expected: typecheck silent, `0 errors, 6 warnings`, all tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat(dashboard): give demo mode a working landing page

The loader picks demo or production dependencies from route context. In demo
mode / previously called the production server functions, they failed, and a
bare catch degraded the first screen a prospect sees into a yellow banner over
empty tiles.

Tiles, the subtitle and the overdue banner now render nothing rather than a
zero when the load failed."
```

---

### Task 9: Route-level tests at both data modes

The unit tests prove the pieces. This proves the wiring, and is the guard that would have
caught the original defect.

**Files:**

- Create: `src/routes/-dashboard-modes.test.tsx`

The `-` prefix is required. Without it the router treats the file as a route.

- [ ] **Step 1: Write the failing test**

Create `src/routes/-dashboard-modes.test.tsx`:

```tsx
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-admin" }),
}));

vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/auth-context-neon")>();
  const session = {
    id: "test-admin",
    name: "Test Admin",
    email: "admin@example.com",
    role: "Admin" as const,
    initials: "TA",
    team: "Operations",
    signedInAt: "2026-07-11T00:00:00.000Z",
  };

  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
      session,
      isHydrated: true,
      demoUsers: [],
      isCurrentUserAdmin: true,
      login: vi.fn(),
      loginDemo: vi.fn(),
      loginDemoUser: vi.fn(),
      signOut: vi.fn(),
    }),
  };
});

const productionFailure = vi.hoisted(() => ({ error: new Error("boom") }));

vi.mock("@/features/annual-return/server-fns", () => ({
  getAnnualReturnDashboardMetrics: () => Promise.reject(productionFailure.error),
  listAnnualReturnCases: () => Promise.reject(productionFailure.error),
}));

import { routeTree } from "../routeTree.gen";
import { resetAnnualReturnCasesForTest } from "../lib/annual-return-store";

async function renderDashboard(dataMode: "demo" | "production") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient: new QueryClient(), dataMode },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

function kpiValues(html: string): string[] {
  const grid = html.match(/data-testid="kpi-grid"[\s\S]*?<\/section>/)?.[0] ?? "";
  return [...grid.matchAll(/data-testid="kpi-value"[^>]*>([^<]*)</g)].map((match) => match[1]);
}

describe("dashboard at both data modes", () => {
  beforeEach(() => {
    resetAnnualReturnCasesForTest();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows the demo story rather than an error state", async () => {
    const html = await renderDashboard("demo");

    expect(html).not.toContain("temporarily unavailable");
    expect(html).not.toContain("could not be loaded");

    const values = kpiValues(html);
    expect(values).toHaveLength(6);
    expect(values.some((value) => /[1-9]/.test(value))).toBe(true);
  });

  it("renders the digest and the upcoming table from demo data", async () => {
    const html = await renderDashboard("demo");

    expect(html).toContain("AI daily digest");
    expect(html).toContain("Upcoming annual returns");
    expect(html).not.toContain("No priority work detected from annual returns.");
  });

  it("renders no numeral in any tile when the production load fails", async () => {
    const html = await renderDashboard("production");

    const values = kpiValues(html);
    expect(values).toHaveLength(6);
    for (const value of values) {
      expect(value).not.toMatch(/\d/);
    }
  });

  it("distinguishes an authorization failure from an outage", async () => {
    productionFailure.error = new Error("connection terminated unexpectedly");
    const outage = await renderDashboard("production");

    productionFailure.error = new Error("Forbidden: staff access required");
    const forbidden = await renderDashboard("production");

    productionFailure.error = new Error("boom");

    expect(outage).toContain("Annual return data is temporarily unavailable");
    expect(forbidden).toContain("You do not have access to annual return data");
    expect(forbidden).toContain("Sign in again");
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/routes/-dashboard-modes.test.tsx
```

Expected: 4 passed.

Two things commonly go wrong here, both fixable without changing the assertions:

- **`kpiValues` returns `[]`.** React 19 may insert `<!-- -->` between adjacent
  expressions. Check the raw HTML around `data-testid="kpi-value"` and loosen the capture
  to `>([^<]*)` → `>((?:[^<]|<!--[^>]*-->)*)<` if so. Do not delete the
  `toHaveLength(6)` assertion — it is what stops the test passing vacuously when the
  regex matches nothing.
- **The production render throws instead of degrading.** `loadDashboardData` catches, so
  this means the failure is escaping somewhere else — most likely `__root.beforeLoad`.
  Report it rather than adding a try/catch to the test.

- [ ] **Step 3: Prove the no-numeral guard is load-bearing**

Temporarily remove `unavailable={!annualReturnDataAvailable}` from the "Overdue cases"
`KpiCard` in `src/routes/index.tsx`, re-run, and confirm the third test **fails** because a
`0` reappears. Restore the prop and confirm green again.

This is the guard the spec asks for: it should fail if the tiles go back to reading metrics
unconditionally.

- [ ] **Step 4: Run the full suite**

```bash
npm run typecheck && npm run lint 2>&1 | tail -2 && npx vitest run 2>&1 | grep -E "Test Files|Tests "
```

Expected: typecheck silent, `0 errors, 6 warnings`, and a total **higher** than the 514
baseline.

- [ ] **Step 5: Commit**

```bash
git add src/routes/-dashboard-modes.test.tsx
git commit -m "test(dashboard): pin both data modes at the route level

The no-numeral assertion is the guard that would have caught the original
defect: an all-zero fallback rendered in the same typography as a measurement.
Mutation-checked by dropping the unavailable prop from one tile."
```

---

### Task 10: Final gate and browser verification

**Files:** none modified, unless a step below turns something up.

- [ ] **Step 1: Run the whole gate**

```bash
npm run typecheck && npm run lint 2>&1 | tail -2 && npx vitest run 2>&1 | grep -E "Test Files|Tests " && npm run build 2>&1 | tail -2
```

Expected: typecheck silent, `0 errors, 6 warnings`, build succeeds, and the test total up
from the 514 baseline by the tests added in Tasks 3–9.

- [ ] **Step 2: Confirm the fixture module has one importer left**

```bash
npx vitest run src/lib/-mock-data-importers.test.ts
```

Expected: 3 passed. `routes/settings.tsx` is the only entry left in `EXPECTED_IMPORTERS`.

- [ ] **Step 3: Verify demo mode in the browser**

Start the preview with `preview_start` using the `kossilon-demo` configuration in
`.claude/launch.json`, sign in with a demo identity, and check `/`:

- **no yellow banner** — this is the whole point of the change
- KPI tiles show real demo figures, not zeros and not em dashes
- the AI daily digest lists items rather than "No priority work detected"
- the upcoming annual returns table has rows, with dates formatted by the moved
  `formatDate`
- no console errors

Capture a screenshot as evidence, and compare it against the pre-change state: a yellow
"Annual return data is temporarily unavailable" banner over six zeros.

- [ ] **Step 4: Confirm the rest of demo mode still renders**

Visit `/annual-returns`, `/work-queue` and `/whatsapp`. Task 1 moved `formatDate` and
Task 3 touched the demo store, so this confirms neither broke a neighbour.

- [ ] **Step 5: Commit any fixes**

If Steps 1–4 required changes, commit them. If nothing changed, say so rather than creating
an empty commit.

---

## Done when

- `/` in demo mode shows demo figures with no error banner
- A failed production load renders an em dash in every tile, never a zero, and the banner
  names the cause and says whether to re-authenticate or retry
- `lib/mock-data` has exactly one importer, `routes/settings.tsx`
- `DashboardCase` is the only case type the dashboard and the digest builder depend on
- The full gate is green and the route-level no-numeral guard has been mutation-checked

## Known limitations, carried from the spec

- **Production rendering stays unverified in a browser.** The dev server runs in demo mode,
  so the production dashboard path is exercised only by tests. Unchanged from the previous
  phases.
- **The status translation is a judgement call.** Six demo statuses onto an eleven-value
  production vocabulary has no single correct answer. The tables in
  `demo-dashboard-data.ts` encode one reading and the tests pin it.
- **`assignedToMe` counts every open demo case.** A route loader has no session, and the
  demo is a single-operator story. Pinned by a test so the choice is visible.
- **The error message reaches the UI verbatim.** Acceptable because `/` is staff-only.
  Do not copy `describeAnnualReturnError` onto a client-facing route such as `/portal`.
