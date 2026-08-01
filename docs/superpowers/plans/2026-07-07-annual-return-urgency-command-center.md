# Annual Return Urgency Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-real mocked annual return command center where staff can see urgency, blockers, ownership, readiness, and next actions, then resolve blockers through local state updates that propagate to tasks, payments, and WhatsApp AI context.

**Architecture:** Add one focused annual return domain store with pure derived helpers and `useSyncExternalStore` mutations. Routes consume the store and keep business logic out of components. Cross-page surfaces derive tasks, payments, and AI context from the same store so mocked actions feel connected.

**Tech Stack:** TanStack Start/Router, React 19, TypeScript, Tailwind CSS v4 utility classes, Vitest for pure helper tests, existing `useSyncExternalStore` local-store pattern.

## Global Constraints

- The implementation remains mocked and local-state only.
- No real database persistence.
- No real file uploads or storage.
- No real auth, roles, or permissions.
- No real AI calls.
- No new external integrations.
- No broad redesign of unrelated app sections.
- The UI should remain restrained, dense, and operator-focused.
- Avoid landing-page patterns, oversized hero sections, decorative cards, or visual treatments that make repeated staff work harder to scan.
- If `git`, `bun`, `node`, or test tooling is unavailable in the shell, record the exact missing command in the task notes and continue with static source review where possible.

---

## File Structure

- Create `src/lib/annual-return-store.ts`: annual return case types, seeded case state, pure derived helpers, `useSyncExternalStore` hook, and mutations.
- Create `src/lib/annual-return-store.test.ts`: Vitest coverage for risk, readiness, blockers, next action, metrics, and mutation effects through pure reducer-style helpers.
- Modify `src/lib/app-data.ts`: keep client/enquiry metadata as the shared lightweight CRM source; add helper to find a client by annual return case id if needed.
- Modify `src/routes/annual-returns.tsx`: replace the simple list with the urgency command center.
- Modify `src/routes/annual-returns.$id.tsx`: replace the simple detail with the action workflow.
- Modify `src/routes/tasks.tsx`: derive work queue rows from annual return blockers and next actions.
- Modify `src/routes/payments.tsx`: derive finance rows from annual return payment state.
- Modify `src/lib/ai-agent.ts`: accept richer annual return context while preserving fallback behavior.
- Modify `src/components/ai-assistant-panel.tsx`: pass enriched annual return context into the draft engine when available.

---

### Task 1: Annual Return Store And Derived Helpers

**Files:**

- Create: `src/lib/annual-return-store.ts`
- Create: `src/lib/annual-return-store.test.ts`
- Modify: `src/lib/app-data.ts`

**Interfaces:**

- Produces:
  - `type AnnualReturnCase`
  - `type AnnualReturnRiskLevel = "overdue" | "due-soon" | "blocked" | "healthy" | "ready-to-file" | "filed"`
  - `type AnnualReturnBlocker`
  - `type AnnualReturnAiContext`
  - `useAnnualReturnCases(): AnnualReturnCase[]`
  - `useAnnualReturnCase(caseId: string): AnnualReturnCase | undefined`
  - `getRiskLevel(caseItem: AnnualReturnCase, today?: Date): AnnualReturnRiskLevel`
  - `getReadinessScore(caseItem: AnnualReturnCase): number`
  - `getBlockers(caseItem: AnnualReturnCase): AnnualReturnBlocker[]`
  - `getNextAction(caseItem: AnnualReturnCase, today?: Date): string`
  - `getCaseMetrics(cases: AnnualReturnCase[], today?: Date): AnnualReturnMetrics`
  - `getCaseTasks(caseItem: AnnualReturnCase, today?: Date): AnnualReturnTask[]`
  - `getAnnualReturnAiContext(caseItem: AnnualReturnCase, today?: Date): AnnualReturnAiContext`
  - mutations listed in the spec: `markDocumentReceived`, `markDocumentMissing`, `updatePaymentStatus`, `completeChecklistItem`, `reopenChecklistItem`, `updateSignatureStatus`, `updateReviewStatus`, `assignOwner`, `addCaseNote`, `markFiled`
- Consumes:
  - `clients`, `findEnquiryForClient`, and `daysUntil` from `src/lib/app-data.ts`

- [ ] **Step 1: Add a client lookup helper to app data**

Modify `src/lib/app-data.ts` by adding this function after `findEnquiryForClient`:

```ts
export function findClientForAnnualReturnCase(caseId: string): ClientCase | undefined {
  return clients.find((client) => client.annualReturnCaseId === caseId);
}
```

- [ ] **Step 2: Write failing helper tests**

Create `src/lib/annual-return-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  getBlockers,
  getCaseMetrics,
  getCaseTasks,
  getNextAction,
  getReadinessScore,
  getRiskLevel,
  type AnnualReturnCase,
} from "./annual-return-store";

const baseCase: AnnualReturnCase = {
  id: "ar-test",
  clientId: "c-test",
  enquiryId: "wa-test",
  companyName: "Test Company Limited",
  contactName: "Ada Staff",
  phone: "+852 6000 0000",
  owner: "Iris Wong",
  basisDate: "2026-06-01",
  dueDate: "2026-07-13",
  status: "waiting-documents",
  documents: [
    { id: "signed-nar1", label: "Signed NAR1", received: false, required: true },
    { id: "scr", label: "Updated significant controller register", received: true, required: true },
  ],
  checklist: [
    { id: "confirm-particulars", label: "Confirm company particulars", complete: true },
    { id: "submit-registry", label: "Submit to Companies Registry", complete: false },
  ],
  signatureStatus: "missing",
  paymentStatus: "pending",
  reviewStatus: "not-started",
  notes: [],
  timeline: [],
};

describe("annual return derived helpers", () => {
  it("prioritizes overdue risk before blocker risk", () => {
    expect(getRiskLevel(baseCase, new Date("2026-07-20T00:00:00"))).toBe("overdue");
  });

  it("calculates readiness from documents, payment, signatures, checklist, and review", () => {
    expect(getReadinessScore(baseCase)).toBe(0);
  });

  it("normalizes blockers across documents, payment, signatures, and review", () => {
    expect(getBlockers(baseCase).map((blocker) => blocker.label)).toEqual([
      "Signed NAR1",
      "Payment pending",
      "Signature missing",
      "Internal review not started",
    ]);
  });

  it("selects the most useful next action", () => {
    expect(getNextAction(baseCase, new Date("2026-07-07T00:00:00"))).toBe("Request Signed NAR1");
  });

  it("aggregates command center metrics", () => {
    const metrics = getCaseMetrics([baseCase], new Date("2026-07-20T00:00:00"));
    expect(metrics).toEqual({ overdue: 1, dueSoon: 0, blocked: 1, readyToFile: 0, filed: 0 });
  });

  it("derives task rows from blockers", () => {
    expect(getCaseTasks(baseCase, new Date("2026-07-07T00:00:00"))[0]).toMatchObject({
      caseId: "ar-test",
      companyName: "Test Company Limited",
      owner: "Iris Wong",
      title: "Request Signed NAR1",
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bunx vitest run src/lib/annual-return-store.test.ts`

Expected if tooling is available: FAIL with an import error for `./annual-return-store`.

If `bunx` is unavailable, run: `Get-Command bunx,bun,node,npm -ErrorAction SilentlyContinue` and record which commands are missing in the task notes.

- [ ] **Step 4: Implement store types, seeds, helpers, and mutations**

Create `src/lib/annual-return-store.ts` with these exported types and functions. Keep the implementation in this one file for this phase; split later only if it becomes hard to hold in context.

```ts
import { useSyncExternalStore } from "react";

export type AnnualReturnStatus =
  | "preparing"
  | "waiting-documents"
  | "payment-pending"
  | "internal-review"
  | "ready-to-file"
  | "filed";

export type AnnualReturnRiskLevel =
  | "overdue"
  | "due-soon"
  | "blocked"
  | "healthy"
  | "ready-to-file"
  | "filed";

export type AnnualReturnPaymentStatus = "pending" | "paid" | "overdue";
export type AnnualReturnSignatureStatus = "missing" | "requested" | "received";
export type AnnualReturnReviewStatus = "not-started" | "in-review" | "approved";

export type AnnualReturnDocument = {
  id: string;
  label: string;
  received: boolean;
  required: boolean;
};

export type AnnualReturnChecklistItem = {
  id: string;
  label: string;
  complete: boolean;
};

export type AnnualReturnNote = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

export type AnnualReturnTimelineEvent = {
  id: string;
  label: string;
  detail: string;
  createdAt: string;
};

export type AnnualReturnCase = {
  id: string;
  clientId: string;
  enquiryId?: string;
  companyName: string;
  contactName: string;
  phone: string;
  owner: string;
  basisDate: string;
  dueDate: string;
  status: AnnualReturnStatus;
  documents: AnnualReturnDocument[];
  checklist: AnnualReturnChecklistItem[];
  signatureStatus: AnnualReturnSignatureStatus;
  paymentStatus: AnnualReturnPaymentStatus;
  reviewStatus: AnnualReturnReviewStatus;
  notes: AnnualReturnNote[];
  timeline: AnnualReturnTimelineEvent[];
};

export type AnnualReturnBlocker = {
  id: string;
  type: "document" | "payment" | "signature" | "review" | "owner";
  label: string;
  action: string;
};

export type AnnualReturnMetrics = {
  overdue: number;
  dueSoon: number;
  blocked: number;
  readyToFile: number;
  filed: number;
};

export type AnnualReturnTask = {
  id: string;
  caseId: string;
  companyName: string;
  owner: string;
  title: string;
  dueDate: string;
  riskLevel: AnnualReturnRiskLevel;
};

export type AnnualReturnAiContext = {
  companyName: string;
  status: AnnualReturnStatus;
  owner: string;
  dueDate: string;
  daysToDue: number;
  readinessScore: number;
  paymentStatus: AnnualReturnPaymentStatus;
  blockers: AnnualReturnBlocker[];
  nextAction: string;
};
```

Seed at least five cases: one overdue, one due soon and blocked, one payment-pending, one ready-to-file, and one filed. Use owners `Iris Wong`, `Calvin Ho`, and `Mandy Lee` so the owner filter is meaningful.

Implement derived helper rules exactly:

```ts
function daysUntilDate(date: string, today = new Date()): number {
  const target = new Date(`${date}T00:00:00`);
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - start.getTime()) / 86_400_000);
}

export function getBlockers(caseItem: AnnualReturnCase): AnnualReturnBlocker[] {
  const documentBlockers = caseItem.documents
    .filter((doc) => doc.required && !doc.received)
    .map((doc) => ({
      id: `document-${doc.id}`,
      type: "document" as const,
      label: doc.label,
      action: `Request ${doc.label}`,
    }));

  const blockers: AnnualReturnBlocker[] = [...documentBlockers];

  if (caseItem.paymentStatus !== "paid") {
    blockers.push({
      id: "payment",
      type: "payment",
      label: caseItem.paymentStatus === "overdue" ? "Payment overdue" : "Payment pending",
      action: "Follow up payment",
    });
  }

  if (caseItem.signatureStatus !== "received") {
    blockers.push({
      id: "signature",
      type: "signature",
      label: caseItem.signatureStatus === "requested" ? "Signature requested" : "Signature missing",
      action: "Collect signature",
    });
  }

  if (caseItem.reviewStatus !== "approved") {
    blockers.push({
      id: "review",
      type: "review",
      label:
        caseItem.reviewStatus === "in-review"
          ? "Internal review in progress"
          : "Internal review not started",
      action: "Complete internal review",
    });
  }

  if (!caseItem.owner.trim()) {
    blockers.push({
      id: "owner",
      type: "owner",
      label: "No owner assigned",
      action: "Assign owner",
    });
  }

  return blockers;
}
```

Implement readiness score as five equal 20-point groups:

- Required documents all received: 20 points.
- Payment paid: 20 points.
- Signature received: 20 points.
- Checklist all complete: 20 points.
- Review approved: 20 points.

Implement risk and action rules:

```ts
export function getRiskLevel(
  caseItem: AnnualReturnCase,
  today = new Date(),
): AnnualReturnRiskLevel {
  if (caseItem.status === "filed") return "filed";
  if (getReadinessScore(caseItem) === 100) return "ready-to-file";
  if (daysUntilDate(caseItem.dueDate, today) < 0) return "overdue";
  if (daysUntilDate(caseItem.dueDate, today) <= 14) return "due-soon";
  if (getBlockers(caseItem).length > 0) return "blocked";
  return "healthy";
}

export function getNextAction(caseItem: AnnualReturnCase, today = new Date()): string {
  const blockers = getBlockers(caseItem);
  if (caseItem.status === "filed") return "No action needed";
  const documentBlocker = blockers.find((blocker) => blocker.type === "document");
  if (documentBlocker) return documentBlocker.action;
  const paymentBlocker = blockers.find((blocker) => blocker.type === "payment");
  if (paymentBlocker) return paymentBlocker.action;
  const signatureBlocker = blockers.find((blocker) => blocker.type === "signature");
  if (signatureBlocker) return signatureBlocker.action;
  const reviewBlocker = blockers.find((blocker) => blocker.type === "review");
  if (reviewBlocker) return reviewBlocker.action;
  if (getReadinessScore(caseItem) === 100) return "File with Companies Registry";
  return daysUntilDate(caseItem.dueDate, today) <= 14 ? "Review due-soon case" : "Monitor case";
}
```

Implement store subscription and mutations following the existing knowledge-base pattern:

```ts
let cases = seedAnnualReturnCases;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAnnualReturnCases(): AnnualReturnCase[] {
  return useSyncExternalStore(
    subscribe,
    () => cases,
    () => cases,
  );
}
```

Each mutation should update only the matching case and call `appendTimeline(caseItem, label, detail)`. `markFiled(caseId)` must return `{ ok: false, reason: string }` when `getReadinessScore(caseItem) < 100`, and `{ ok: true }` when filing succeeds.

- [ ] **Step 5: Run helper tests**

Run: `bunx vitest run src/lib/annual-return-store.test.ts`

Expected: PASS for all helper tests.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/lib/annual-return-store.ts src/lib/annual-return-store.test.ts src/lib/app-data.ts
git commit -m "feat: add annual return operations store"
```

If `git` is unavailable, record `git unavailable on PATH` in the task notes and continue without committing.

---

### Task 2: Annual Returns Urgency Command Center

**Files:**

- Modify: `src/routes/annual-returns.tsx`

**Interfaces:**

- Consumes from Task 1:
  - `useAnnualReturnCases`
  - `getRiskLevel`
  - `getReadinessScore`
  - `getBlockers`
  - `getNextAction`
  - `getCaseMetrics`
  - `AnnualReturnRiskLevel`
- Produces:
  - A command center route with metrics, search, filters, owner filter, urgency sorting, and case rows.

- [ ] **Step 1: Replace static client list with store-backed route**

Modify imports in `src/routes/annual-returns.tsx`:

```ts
import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import {
  getBlockers,
  getCaseMetrics,
  getNextAction,
  getReadinessScore,
  getRiskLevel,
  useAnnualReturnCases,
  type AnnualReturnCase,
  type AnnualReturnRiskLevel,
} from "../lib/annual-return-store";
import { daysUntil } from "../lib/app-data";
```

- [ ] **Step 2: Add filter state and derived case list**

Inside `AnnualReturnsRoute`, replace the body with this state and derivation:

```tsx
const cases = useAnnualReturnCases();
const [query, setQuery] = useState("");
const [filter, setFilter] = useState<"all" | "urgent" | "blocked" | "ready" | "filed">("all");
const [owner, setOwner] = useState("all");

const metrics = getCaseMetrics(cases);
const owners = Array.from(new Set(cases.map((caseItem) => caseItem.owner))).sort();

const visibleCases = useMemo(() => {
  return cases
    .filter((caseItem) => {
      const risk = getRiskLevel(caseItem);
      const matchesQuery = `${caseItem.companyName} ${caseItem.contactName}`
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesOwner = owner === "all" || caseItem.owner === owner;
      const matchesFilter =
        filter === "all" ||
        (filter === "urgent" && (risk === "overdue" || risk === "due-soon")) ||
        (filter === "blocked" && getBlockers(caseItem).length > 0 && risk !== "filed") ||
        (filter === "ready" && risk === "ready-to-file") ||
        (filter === "filed" && risk === "filed");
      return matchesQuery && matchesOwner && matchesFilter;
    })
    .sort((a, b) => riskSortValue(getRiskLevel(a)) - riskSortValue(getRiskLevel(b)));
}, [cases, filter, owner, query]);
```

Add helpers below the component:

```tsx
function riskSortValue(risk: AnnualReturnRiskLevel): number {
  return { overdue: 0, "due-soon": 1, blocked: 2, "ready-to-file": 3, healthy: 4, filed: 5 }[risk];
}

function riskLabel(risk: AnnualReturnRiskLevel): string {
  return {
    overdue: "Overdue",
    "due-soon": "Due soon",
    blocked: "Blocked",
    healthy: "Healthy",
    "ready-to-file": "Ready",
    filed: "Filed",
  }[risk];
}
```

- [ ] **Step 3: Render metrics, controls, and case rows**

Use this page structure:

```tsx
return (
  <div className="space-y-6 p-6">
    <div>
      <p className="text-sm font-medium text-muted-foreground">Cases</p>
      <h1 className="mt-1 text-3xl font-semibold">Annual returns</h1>
    </div>

    <div className="grid gap-3 md:grid-cols-5">
      <Metric label="Overdue" value={metrics.overdue} tone="red" />
      <Metric label="Due soon" value={metrics.dueSoon} tone="orange" />
      <Metric label="Blocked" value={metrics.blocked} tone="yellow" />
      <Metric label="Ready to file" value={metrics.readyToFile} tone="green" />
      <Metric label="Filed" value={metrics.filed} tone="blue" />
    </div>

    <section className="rounded-lg border bg-card">
      <div className="grid gap-3 border-b p-4 lg:grid-cols-[1fr_auto_auto]">
        <input
          className="rounded-md border bg-background px-3 py-2 text-sm"
          aria-label="Search company or contact"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {(["all", "urgent", "blocked", "ready", "filed"] as const).map((value) => (
            <button
              key={value}
              className={`rounded-md border px-3 py-2 text-sm ${filter === value ? "bg-primary text-primary-foreground" : ""}`}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "All" : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <select
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        >
          <option value="all">All owners</option>
          {owners.map((ownerName) => (
            <option key={ownerName} value={ownerName}>
              {ownerName}
            </option>
          ))}
        </select>
      </div>

      <div className="divide-y">
        {visibleCases.map((caseItem) => (
          <CaseRow key={caseItem.id} caseItem={caseItem} />
        ))}
      </div>
    </section>
  </div>
);
```

Define `Metric` and `CaseRow` in the same file. `CaseRow` must show company, owner, risk, due date, readiness, blockers, payment, next action, and an `Open` link to `/annual-returns/$id`.

- [ ] **Step 4: Run route-level static checks**

Run: `bunx tsc --noEmit`

Expected: PASS.

If `bunx` or `tsc` is unavailable, run `rg -n "clients|checklistTemplates" src/routes/annual-returns.tsx` and expect no output.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/routes/annual-returns.tsx
git commit -m "feat: build annual return command center"
```

If `git` is unavailable, record `git unavailable on PATH` in the task notes and continue.

---

### Task 3: Annual Return Detail Workflow

**Files:**

- Modify: `src/routes/annual-returns.$id.tsx`

**Interfaces:**

- Consumes from Task 1:
  - `useAnnualReturnCase`
  - `getRiskLevel`
  - `getReadinessScore`
  - `getBlockers`
  - `getNextAction`
  - all store mutations
- Consumes from app data:
  - `findEnquiryForClient`
  - `daysUntil`
- Produces:
  - A detail route with reversible controls, timeline, notes, filing guardrail, and case-not-found state.

- [ ] **Step 1: Replace imports**

Use these imports:

```ts
import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { daysUntil, findEnquiryForClient } from "../lib/app-data";
import {
  addCaseNote,
  assignOwner,
  completeChecklistItem,
  getBlockers,
  getNextAction,
  getReadinessScore,
  getRiskLevel,
  markDocumentMissing,
  markDocumentReceived,
  markFiled,
  reopenChecklistItem,
  updatePaymentStatus,
  updateReviewStatus,
  updateSignatureStatus,
  useAnnualReturnCase,
} from "../lib/annual-return-store";
```

- [ ] **Step 2: Add not-found state and header derivations**

Inside the component:

```tsx
const { id } = Route.useParams();
const caseItem = useAnnualReturnCase(id);
const [note, setNote] = useState("");
const [filingWarning, setFilingWarning] = useState<string | undefined>();

if (!caseItem) {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Case not found</h1>
      <p className="text-sm text-muted-foreground">
        This annual return case does not exist in the mocked workspace.
      </p>
      <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
        Back to command center
      </Link>
    </div>
  );
}

const enquiry = findEnquiryForClient(caseItem.clientId);
const risk = getRiskLevel(caseItem);
const readiness = getReadinessScore(caseItem);
const blockers = getBlockers(caseItem);
const nextAction = getNextAction(caseItem);
```

- [ ] **Step 3: Render action header and readiness panel**

Render a dense header with company, risk badge, owner select, due date, readiness, next action, and Ask AI link. Owner select values must include `Iris Wong`, `Calvin Ho`, `Mandy Lee`, and `Operations`.

For `markFiled`, wire the button:

```tsx
const result = markFiled(caseItem.id);
if (!result.ok) setFilingWarning(result.reason);
else setFilingWarning(undefined);
```

Show `filingWarning` inline in a status-colored warning block.

- [ ] **Step 4: Render blocker controls**

Document rows:

```tsx
{
  caseItem.documents.map((doc) => (
    <div
      key={doc.id}
      className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0"
    >
      <div>
        <p className="font-medium">{doc.label}</p>
        <p className="text-sm text-muted-foreground">{doc.received ? "Received" : "Missing"}</p>
      </div>
      <button
        className="rounded-md border px-3 py-2 text-sm"
        onClick={() =>
          doc.received
            ? markDocumentMissing(caseItem.id, doc.id)
            : markDocumentReceived(caseItem.id, doc.id)
        }
      >
        {doc.received ? "Mark missing" : "Mark received"}
      </button>
    </div>
  ));
}
```

Payment, signature, and review controls must be `select` elements bound to `updatePaymentStatus`, `updateSignatureStatus`, and `updateReviewStatus`.

- [ ] **Step 5: Render checklist, timeline, and notes**

Checklist rows must toggle complete/reopen:

```tsx
{
  caseItem.checklist.map((item) => (
    <button
      key={item.id}
      className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm"
      onClick={() =>
        item.complete
          ? reopenChecklistItem(caseItem.id, item.id)
          : completeChecklistItem(caseItem.id, item.id)
      }
    >
      <span>{item.label}</span>
      <span>{item.complete ? "Complete" : "Open"}</span>
    </button>
  ));
}
```

Notes form:

```tsx
<textarea value={note} onChange={(event) => setNote(event.target.value)} />
<button
  onClick={() => {
    if (!note.trim()) return;
    addCaseNote(caseItem.id, "Operations", note.trim());
    setNote("");
  }}
>
  Add note
</button>
```

Timeline should render newest first from `caseItem.timeline`.

- [ ] **Step 6: Run static checks**

Run: `bunx tsc --noEmit`

Expected: PASS.

If tooling is unavailable, run `rg -n "clients|checklistTemplates" "src/routes/annual-returns.$id.tsx"` and expect no output.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add src/routes/annual-returns.$id.tsx
git commit -m "feat: add annual return case workflow"
```

If `git` is unavailable, record `git unavailable on PATH` in the task notes and continue.

---

### Task 4: Derived Tasks, Payments, And WhatsApp AI Context

**Files:**

- Modify: `src/routes/tasks.tsx`
- Modify: `src/routes/payments.tsx`
- Modify: `src/lib/ai-agent.ts`
- Modify: `src/components/ai-assistant-panel.tsx`

**Interfaces:**

- Consumes from Task 1:
  - `useAnnualReturnCases`
  - `getCaseTasks`
  - `getAnnualReturnAiContext`
  - `getReadinessScore`
  - `AnnualReturnAiContext`
- Produces:
  - Tasks and payments derived from annual return store.
  - WhatsApp draft copy that includes enriched blockers, readiness, owner, and next action.

- [ ] **Step 1: Update tasks route**

Replace `src/routes/tasks.tsx` with a store-backed work queue:

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { getCaseTasks, useAnnualReturnCases } from "../lib/annual-return-store";

export const Route = createFileRoute("/tasks")({
  component: TasksRoute,
});

function TasksRoute() {
  const cases = useAnnualReturnCases();
  const tasks = cases.flatMap((caseItem) => getCaseTasks(caseItem));

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Work queue</p>
        <h1 className="mt-1 text-3xl font-semibold">Tasks</h1>
      </div>
      <div className="rounded-lg border bg-card">
        {tasks.length ? (
          tasks.map((task) => (
            <div
              key={task.id}
              className="grid gap-2 border-b p-4 text-sm last:border-b-0 md:grid-cols-[1fr_180px_140px]"
            >
              <div>
                <p className="font-medium">{task.title}</p>
                <p className="text-muted-foreground">{task.companyName}</p>
              </div>
              <span>{task.owner}</span>
              <span>{task.riskLevel}</span>
            </div>
          ))
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No open tasks.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update payments route**

Replace static client import with `useAnnualReturnCases`. Each row should show company, owner, due date, payment status, and readiness score:

```tsx
const cases = useAnnualReturnCases();
```

Render:

```tsx
{
  cases.map((caseItem) => (
    <div
      key={caseItem.id}
      className="grid gap-3 border-b p-4 text-sm last:border-b-0 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]"
    >
      <span>{caseItem.companyName}</span>
      <span>{caseItem.owner}</span>
      <span>{caseItem.dueDate}</span>
      <span className="font-medium">{caseItem.paymentStatus}</span>
      <span>{getReadinessScore(caseItem)}% ready</span>
    </div>
  ));
}
```

- [ ] **Step 3: Extend AI agent types**

In `src/lib/ai-agent.ts`, import:

```ts
import { type AnnualReturnAiContext } from "./annual-return-store";
```

Update signatures:

```ts
export function draftReply(
  enquiry: Enquiry,
  context: RetrievalContext,
  clientCase?: ClientCase,
  annualReturnContext?: AnnualReturnAiContext,
): DraftReply;
```

Use annual return context first when building `caseLine`:

```ts
const enrichedCaseLine = annualReturnContext
  ? `\n\nFor **${annualReturnContext.companyName}**, owner **${annualReturnContext.owner}** is currently tracking **${annualReturnContext.status}**. The filing due date is **${annualReturnContext.dueDate}** (${annualReturnContext.daysToDue} days from today), readiness is **${annualReturnContext.readinessScore}%**, and the next action is **${annualReturnContext.nextAction}**. ${
      annualReturnContext.blockers.length
        ? `Current blockers: **${annualReturnContext.blockers.map((blocker) => blocker.label).join(", ")}**.`
        : "No blockers are currently open."
    } Payment status: **${annualReturnContext.paymentStatus}**.`
  : "";
```

Then set `caseLine` to `enrichedCaseLine || existingBasicClientCaseLine`.

Add annual return context to sources:

```ts
...(annualReturnContext
  ? annualReturnContext.blockers.slice(0, 4).map((blocker) => ({
      id: `annual-return-${blocker.id}`,
      type: "Case" as const,
      label: blocker.label,
      preview: blocker.action,
    }))
  : []),
```

- [ ] **Step 4: Pass enriched context from AI assistant panel**

In `src/components/ai-assistant-panel.tsx`, import:

```ts
import { getAnnualReturnAiContext, useAnnualReturnCase } from "../lib/annual-return-store";
```

Inside the component:

```tsx
const annualReturnCase = useAnnualReturnCase(clientCase ? clientCase.annualReturnCaseId : "");
const annualReturnContext = annualReturnCase
  ? getAnnualReturnAiContext(annualReturnCase)
  : undefined;
```

Update draft call:

```tsx
const draft = useMemo(
  () => tweakDraft(draftReply(enquiry, context, clientCase, annualReturnContext), generation),
  [annualReturnContext, clientCase, context, enquiry, generation],
);
```

Update live case context fields to prefer `annualReturnContext.readinessScore`, `annualReturnContext.nextAction`, and `annualReturnContext.blockers.length` when present.

- [ ] **Step 5: Run static checks**

Run: `bunx tsc --noEmit`

Expected: PASS.

If unavailable, run:

```powershell
rg -n "from \"../lib/app-data\"|clients" src\routes\tasks.tsx src\routes\payments.tsx
```

Expected: no `clients` import in `tasks.tsx` or `payments.tsx`.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/routes/tasks.tsx src/routes/payments.tsx src/lib/ai-agent.ts src/components/ai-assistant-panel.tsx
git commit -m "feat: connect annual return state across surfaces"
```

If `git` is unavailable, record `git unavailable on PATH` in the task notes and continue.

---

### Task 5: Verification, Polish, And Guardrail Pass

**Files:**

- Review: `src/lib/annual-return-store.ts`
- Review: `src/routes/annual-returns.tsx`
- Review: `src/routes/annual-returns.$id.tsx`
- Review: `src/routes/tasks.tsx`
- Review: `src/routes/payments.tsx`
- Review: `src/lib/ai-agent.ts`
- Review: `src/components/ai-assistant-panel.tsx`

**Interfaces:**

- Consumes all prior task outputs.
- Produces a verified implementation with no missing spec coverage.

- [ ] **Step 1: Run automated checks**

Run:

```bash
bunx vitest run src/lib/annual-return-store.test.ts
bunx tsc --noEmit
```

Expected: both commands pass.

If commands are unavailable, run:

```powershell
Get-Command bunx,bun,node,npm,tsc -ErrorAction SilentlyContinue
```

Record the missing commands in the final implementation notes.

- [ ] **Step 2: Manual source verification**

Run:

```powershell
rg -n "clients|checklistTemplates" src\routes\annual-returns.tsx src\routes\tasks.tsx src\routes\payments.tsx
```

Expected: no output.

Run:

```powershell
rg -n "markFiled|filingWarning|Case not found|getAnnualReturnAiContext|getCaseTasks" src
```

Expected: matches in the annual return detail, AI panel, AI agent, tasks route, and annual return store.

- [ ] **Step 3: Manual browser verification if a runtime is available**

Run:

```bash
npm run dev
```

Expected: the dev server prints a local URL.

Verify:

- `/annual-returns` shows overdue, due soon, blocked, ready to file, and filed counts.
- Search filters by company/contact.
- Owner filter changes visible rows.
- Urgent filter shows overdue and due-soon cases.
- Blocked filter shows cases with open blockers.
- Ready filter shows ready-to-file cases.
- `/annual-returns/$id` shows header risk, due date, owner, readiness, and next action.
- Marking a missing document received updates blockers and readiness.
- Updating payment to paid updates `/payments`.
- Completing signature/review/checklist can make a case ready to file.
- Filing a blocked case shows the inline guardrail.
- Filing a ready case changes state to filed.
- `/tasks` updates after blockers change.
- `/whatsapp?enquiry=wa-lee` AI context mentions annual return blockers/readiness when linked.

If no runtime is available, record that browser verification could not run because no JS runtime command is present.

- [ ] **Step 4: Commit Task 5**

Run:

```bash
git add src docs/superpowers/plans/2026-07-07-annual-return-urgency-command-center.md
git commit -m "test: verify annual return command center"
```

If `git` is unavailable, record `git unavailable on PATH` in the final response.
