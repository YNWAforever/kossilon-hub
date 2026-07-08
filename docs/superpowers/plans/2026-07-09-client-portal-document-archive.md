# Client Portal And Document Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mocked client annual-return portal and staff document archive that share local document/action state and append portal activity into annual-return timelines.

**Architecture:** Add a focused `client-portal-store` that owns mocked client documents, portal actions, archive row derivation, and portal progress. Keep annual-return filing, packet, receipt, and readiness logic in `annual-return-store`; add one narrow timeline helper for portal-originated audit entries. Routes consume the store so `/portal`, `/documents`, and `/annual-returns/$id` stay synchronized without introducing real upload, auth, payment, signature, backend, or API behavior.

**Tech Stack:** React 19, TanStack Router/Start, TypeScript, Tailwind CSS v4 utility classes, Vitest, lucide-react, existing `useSyncExternalStore` store pattern.

## Global Constraints

- The implementation remains local-state only.
- No real client authentication or portal login.
- No real file upload, storage, virus scanning, or document preview.
- No real payment collection or e-signature integration.
- No real Companies Registry submission.
- No role or permission overhaul.
- No broad redesign of annual return, WhatsApp, payments, or tasks.
- Use a single `/portal` route with an optional `caseId` search parameter.
- `/documents` must accept an optional `caseId` search parameter.
- Payment acknowledgement must not mark the annual-return payment as paid.
- Packet approval must not submit the filing packet.
- Superseded documents must remain visible in `/documents` and stop satisfying requirements.
- Filed or receipt-accepted cases render portal upload, payment acknowledgement, and packet approval controls read-only.
- Portal actions append annual-return timeline events through a narrow helper.

---

## File Structure

- Modify `src/lib/annual-return-store.ts`: export `appendClientPortalTimelineEvent(caseId, label, detail)` so portal actions can add audit entries without changing filing state.
- Modify `src/lib/annual-return-store.test.ts`: cover the new timeline helper for successful and missing-case writes.
- Create `src/lib/client-portal-store.ts`: own mocked client documents/actions, archive derivation, required-action derivation, progress helpers, store hooks, test reset, and portal mutations.
- Create `src/lib/client-portal-store.test.ts`: cover archive derivation, uploads, replacements, payment acknowledgement, packet approval guardrails, read-only cases, and receipt view activity.
- Create `src/routes/portal.tsx`: client-facing portal with case selector, status/progress strip, document actions, payment acknowledgement, packet approval, receipt visibility, and activity feed.
- Replace `src/routes/documents.tsx`: staff archive table with search, source/category/status/case filters, generated rows, and case links.
- Modify `src/routes/annual-returns.$id.tsx`: add compact Client Portal Activity panel with archive count, outstanding action count, latest portal activity, and links to portal/archive.
- Modify `src/components/app-sidebar.tsx`: add a `Portal Demo` nav item using `ExternalLink`.
- Modify `src/routes/-annual-returns-workflow.test.ts`: add source-regression assertions for portal, archive, annual-return detail, and sidebar integration.
- Review generated `src/routeTree.gen.ts`: after adding `src/routes/portal.tsx`, run build so TanStack Router regenerates this file.

---

### Task 1: Annual Return Portal Timeline Helper

**Files:**
- Modify: `src/lib/annual-return-store.ts`
- Modify: `src/lib/annual-return-store.test.ts`

**Interfaces:**
- Consumes:
  - Existing `replaceCase(caseId, updater)` internal helper.
  - Existing `appendTimeline(caseItem, label, detail)` internal helper.
  - Existing `getAnnualReturnCaseById(caseId: string): AnnualReturnCase | undefined`.
- Produces:
  - `appendClientPortalTimelineEvent(caseId: string, label: string, detail: string): { ok: true } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing timeline-helper tests**

Add `appendClientPortalTimelineEvent` to the import block in `src/lib/annual-return-store.test.ts`:

```ts
  appendClientPortalTimelineEvent,
```

Append these tests inside `describe("annual return store mutations", () => { ... })` after the `beforeEach`:

```ts
  it("appends client portal timeline events without changing filing state", () => {
    const before = getAnnualReturnCaseById("ar-delta");

    expect(
      appendClientPortalTimelineEvent(
        "ar-delta",
        "Client document uploaded",
        "Joanna Poon uploaded Signed NAR1 from the client portal.",
      ),
    ).toEqual({ ok: true });

    const after = getAnnualReturnCaseById("ar-delta");

    expect(after?.status).toBe(before?.status);
    expect(after?.timeline[0]).toMatchObject({
      label: "Client document uploaded",
      detail: "Joanna Poon uploaded Signed NAR1 from the client portal.",
    });
  });

  it("returns a stable error for missing client portal timeline cases", () => {
    expect(
      appendClientPortalTimelineEvent(
        "ar-missing",
        "Client document uploaded",
        "Missing case should not mutate state.",
      ),
    ).toEqual({
      ok: false,
      reason: "Case not found",
    });
  });
```

- [ ] **Step 2: Run the focused failing test**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/lib/annual-return-store.test.ts --configLoader runner
```

Expected: FAIL with an import/export error for `appendClientPortalTimelineEvent`.

- [ ] **Step 3: Implement the annual-return timeline helper**

Add this export near the existing mutation exports in `src/lib/annual-return-store.ts`, directly before `markDocumentReceived`:

```ts
export function appendClientPortalTimelineEvent(
  caseId: string,
  label: string,
  detail: string,
): { ok: true } | { ok: false; reason: string } {
  const caseItem = cases.find((candidate) => candidate.id === caseId);
  if (!caseItem) return { ok: false, reason: "Case not found" };
  if (!label.trim()) return { ok: false, reason: "Timeline label is required" };
  if (!detail.trim()) return { ok: false, reason: "Timeline detail is required" };

  replaceCase(caseId, (currentCase) =>
    appendTimeline(currentCase, label.trim(), detail.trim()),
  );

  return { ok: true };
}
```

- [ ] **Step 4: Verify the focused test passes**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/lib/annual-return-store.test.ts --configLoader runner
```

Expected: PASS for `src/lib/annual-return-store.test.ts`.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/lib/annual-return-store.ts src/lib/annual-return-store.test.ts
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add client portal timeline events"
```

Expected: commit succeeds.

---

### Task 2: Client Portal Store And Domain Tests

**Files:**
- Create: `src/lib/client-portal-store.ts`
- Create: `src/lib/client-portal-store.test.ts`
- Review: `src/lib/annual-return-store.ts`

**Interfaces:**
- Consumes:
  - `type AnnualReturnCase`
  - `getPacketStatus(caseItem: AnnualReturnCase): AnnualReturnPacketStatus`
  - `markDocumentReceived(caseId: string, documentId: string): void`
  - `appendClientPortalTimelineEvent(caseId: string, label: string, detail: string)`
- Produces:
  - `type ClientPortalDocumentCategory`
  - `type ClientPortalDocumentSource`
  - `type ClientPortalDocumentStatus`
  - `type ClientPortalActionType`
  - `type ClientPortalActionStatus`
  - `type ClientPortalDocument`
  - `type ClientPortalAction`
  - `type ClientPortalArchiveRow`
  - `type ClientPortalRequiredAction`
  - `type ClientPortalProgress`
  - `type ClientPortalSnapshot`
  - `resetClientPortalStoreForTest(): void`
  - `useClientPortalSnapshot(): ClientPortalSnapshot`
  - `getClientPortalSnapshot(): ClientPortalSnapshot`
  - `getCurrentClientDocument(caseId: string, requirementId: string, snapshot?: ClientPortalSnapshot): ClientPortalDocument | undefined`
  - `getDocumentArchiveRows(cases: AnnualReturnCase[], snapshot?: ClientPortalSnapshot): ClientPortalArchiveRow[]`
  - `getClientPortalRequiredActions(caseItem: AnnualReturnCase, snapshot?: ClientPortalSnapshot): ClientPortalRequiredAction[]`
  - `getClientPortalProgress(caseItem: AnnualReturnCase, snapshot?: ClientPortalSnapshot): ClientPortalProgress`
  - `getClientPortalActivity(caseId: string, snapshot?: ClientPortalSnapshot): ClientPortalAction[]`
  - `uploadClientDocument(caseItem: AnnualReturnCase, requirementId: string, filename: string, actor?: string): { ok: true; documentId: string } | { ok: false; reason: string }`
  - `replaceClientDocument(caseItem: AnnualReturnCase, requirementId: string, filename: string, actor?: string): { ok: true; documentId: string; supersededDocumentId?: string } | { ok: false; reason: string }`
  - `acknowledgePaymentInstructions(caseItem: AnnualReturnCase, actor?: string): { ok: true } | { ok: false; reason: string }`
  - `approveClientPacket(caseItem: AnnualReturnCase, actor?: string): { ok: true } | { ok: false; reason: string }`
  - `recordReceiptViewed(caseItem: AnnualReturnCase, actor?: string): { ok: true } | { ok: false; reason: string }`

- [ ] **Step 1: Create failing store tests**

Create `src/lib/client-portal-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import {
  acceptFilingReceipt,
  completeChecklistItem,
  getAnnualReturnCaseById,
  resetAnnualReturnCasesForTest,
  submitFilingPacket,
  togglePacketRequirement,
  updatePaymentStatus,
  updateReviewStatus,
  updateSignatureStatus,
} from "./annual-return-store";
import {
  acknowledgePaymentInstructions,
  approveClientPacket,
  getClientPortalActivity,
  getClientPortalProgress,
  getClientPortalRequiredActions,
  getCurrentClientDocument,
  getDocumentArchiveRows,
  recordReceiptViewed,
  replaceClientDocument,
  resetClientPortalStoreForTest,
  uploadClientDocument,
} from "./client-portal-store";

function requireCase(caseId: string) {
  const caseItem = getAnnualReturnCaseById(caseId);
  if (!caseItem) throw new Error(`Missing fixture ${caseId}`);
  return caseItem;
}

function makeDeltaReadyForReceipt(): void {
  uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
  uploadClientDocument(
    requireCase("ar-delta"),
    "scr",
    "updated-scr.pdf",
    "Joanna Poon",
  );
  updatePaymentStatus("ar-delta", "paid");
  updateSignatureStatus("ar-delta", "received");
  completeChecklistItem("ar-delta", "collect-signed-nar1");
  completeChecklistItem("ar-delta", "verify-scr");
  completeChecklistItem("ar-delta", "confirm-payment");
  completeChecklistItem("ar-delta", "submit-registry");
  updateReviewStatus("ar-delta", "approved");

  for (const requirementId of [
    "nar1-draft",
    "company-particulars",
    "scr-confirmed",
    "signed-nar1-attached",
    "payment-proof-checked",
    "internal-filing-review",
  ]) {
    togglePacketRequirement("ar-delta", requirementId);
  }
}

describe("client portal store", () => {
  beforeEach(() => {
    resetAnnualReturnCasesForTest();
    resetClientPortalStoreForTest();
  });

  it("derives required actions from missing case documents and payment acknowledgement", () => {
    const actions = getClientPortalRequiredActions(requireCase("ar-delta"));

    expect(actions.map((action) => action.id)).toEqual([
      "action-ar-delta-document-signed-nar1",
      "action-ar-delta-document-scr",
      "action-ar-delta-payment-acknowledgement",
      "action-ar-delta-packet-approval",
    ]);
    expect(getClientPortalProgress(requireCase("ar-delta"))).toMatchObject({
      completed: 0,
      total: 5,
      nextAction: "Upload Signed NAR1",
      percentage: 0,
      isReadOnly: false,
    });
  });

  it("uploads a current client document, updates annual-return documents, and appends activity", () => {
    const result = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );

    expect(result).toMatchObject({ ok: true });
    expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toMatchObject({
      filename: "signed-nar1.pdf",
      status: "uploaded",
      source: "client-portal",
    });
    expect(
      requireCase("ar-delta").documents.find((document) => document.id === "signed-nar1"),
    ).toMatchObject({ received: true });
    expect(getClientPortalActivity("ar-delta")[0]).toMatchObject({
      type: "upload-document",
      summary: "Joanna Poon uploaded Signed NAR1.",
    });
  });

  it("replaces documents by superseding the previous upload and keeping both archive rows", () => {
    uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
    const replacement = replaceClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1-v2.pdf",
      "Joanna Poon",
    );
    const rows = getDocumentArchiveRows([requireCase("ar-delta")]).filter(
      (row) => row.requirementId === "signed-nar1" && row.source === "client-portal",
    );

    expect(replacement).toMatchObject({ ok: true });
    expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toMatchObject({
      filename: "signed-nar1-v2.pdf",
      status: "uploaded",
    });
    expect(rows.map((row) => row.status).sort()).toEqual(["superseded", "uploaded"]);
  });

  it("records payment acknowledgement without marking payment paid", () => {
    expect(acknowledgePaymentInstructions(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: true,
    });

    expect(requireCase("ar-delta").paymentStatus).toBe("pending");
    expect(getClientPortalRequiredActions(requireCase("ar-delta")).map((action) => action.id)).not.toContain(
      "action-ar-delta-payment-acknowledgement",
    );
  });

  it("blocks packet approval until portal-visible documents are uploaded", () => {
    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: false,
      reason: "Packet approval blocked: Signed NAR1; Updated significant controller register",
    });
  });

  it("approves a packet after portal-visible documents are present", () => {
    uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
    uploadClientDocument(requireCase("ar-delta"), "scr", "updated-scr.pdf", "Joanna Poon");

    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
    expect(getClientPortalActivity("ar-delta")[0]).toMatchObject({
      type: "approve-packet",
      summary: "Joanna Poon approved the filing packet.",
    });
    expect(getDocumentArchiveRows([requireCase("ar-delta")]).some((row) => row.id === "archive-ar-delta-client-packet-approval")).toBe(true);
  });

  it("derives generated submission and receipt archive rows", () => {
    makeDeltaReadyForReceipt();
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    const rows = getDocumentArchiveRows([requireCase("ar-delta")]);

    expect(rows.map((row) => row.source)).toContain("filing-submission");
    expect(rows.map((row) => row.source)).toContain("filing-receipt");
    expect(recordReceiptViewed(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
  });

  it("blocks portal mutations for filed or receipt-accepted cases", () => {
    const filedCase = requireCase("ar-summit");

    expect(uploadClientDocument(filedCase, "signed-nar1", "signed.pdf", "Carmen Ng")).toEqual({
      ok: false,
      reason: "Filed cases are read-only in the client portal",
    });
    expect(approveClientPacket(filedCase, "Carmen Ng")).toEqual({
      ok: false,
      reason: "Filed cases are read-only in the client portal",
    });
    expect(getClientPortalProgress(filedCase)).toMatchObject({ isReadOnly: true });
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/lib/client-portal-store.test.ts --configLoader runner
```

Expected: FAIL because `src/lib/client-portal-store.ts` does not exist.

- [ ] **Step 3: Create the client portal store types and state shell**

Create `src/lib/client-portal-store.ts` with this initial structure:

```ts
import { useSyncExternalStore } from "react";

import {
  type AnnualReturnCase,
  appendClientPortalTimelineEvent,
  getPacketStatus,
  markDocumentReceived,
} from "./annual-return-store";

export type ClientPortalDocumentCategory =
  | "identity"
  | "registry"
  | "signature"
  | "payment"
  | "packet"
  | "submission"
  | "receipt"
  | "other";

export type ClientPortalDocumentSource =
  | "client-portal"
  | "staff-packet"
  | "filing-submission"
  | "filing-receipt";

export type ClientPortalDocumentStatus =
  | "required"
  | "uploaded"
  | "superseded"
  | "accepted"
  | "rejected"
  | "generated";

export type ClientPortalActionType =
  | "upload-document"
  | "replace-document"
  | "acknowledge-payment"
  | "approve-packet"
  | "view-receipt";

export type ClientPortalActionStatus = "completed" | "blocked";

export type ClientPortalDocument = {
  id: string;
  caseId: string;
  requirementId?: string;
  companyName: string;
  contactName: string;
  title: string;
  filename: string;
  category: ClientPortalDocumentCategory;
  source: ClientPortalDocumentSource;
  status: ClientPortalDocumentStatus;
  actor: string;
  createdAt: string;
  supersedesDocumentId?: string;
};

export type ClientPortalAction = {
  id: string;
  caseId: string;
  type: ClientPortalActionType;
  actor: string;
  status: ClientPortalActionStatus;
  summary: string;
  createdAt: string;
};

export type ClientPortalArchiveRow = {
  id: string;
  caseId: string;
  requirementId?: string;
  companyName: string;
  contactName: string;
  title: string;
  filename: string;
  category: ClientPortalDocumentCategory;
  source: ClientPortalDocumentSource;
  status: ClientPortalDocumentStatus;
  actor: string;
  createdAt: string;
  readonly: boolean;
};

export type ClientPortalRequiredAction = {
  id: string;
  caseId: string;
  kind: "document" | "payment" | "packet" | "receipt";
  label: string;
  status: "open" | "complete" | "blocked";
  detail: string;
  requirementId?: string;
};

export type ClientPortalProgress = {
  completed: number;
  total: number;
  percentage: number;
  nextAction: string;
  isReadOnly: boolean;
};

export type ClientPortalSnapshot = {
  documents: ClientPortalDocument[];
  actions: ClientPortalAction[];
};

const initialSnapshot: ClientPortalSnapshot = {
  documents: [],
  actions: [],
};

let snapshot: ClientPortalSnapshot = cloneSnapshot(initialSnapshot);
const listeners = new Set<() => void>();

function cloneSnapshot(value: ClientPortalSnapshot): ClientPortalSnapshot {
  return {
    documents: value.documents.map((document) => ({ ...document })),
    actions: value.actions.map((action) => ({ ...action })),
  };
}

function nowStamp(): string {
  return new Date().toISOString();
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshotInternal(): ClientPortalSnapshot {
  return snapshot;
}

export function useClientPortalSnapshot(): ClientPortalSnapshot {
  return useSyncExternalStore(subscribe, getSnapshotInternal, getSnapshotInternal);
}

export function getClientPortalSnapshot(): ClientPortalSnapshot {
  return cloneSnapshot(snapshot);
}

export function resetClientPortalStoreForTest(): void {
  snapshot = cloneSnapshot(initialSnapshot);
  emit();
}
```

- [ ] **Step 4: Add derivation helpers**

Append these helpers to `src/lib/client-portal-store.ts`:

```ts
function documentCategoryForRequirement(requirementId: string): ClientPortalDocumentCategory {
  if (requirementId.includes("payment")) return "payment";
  if (requirementId.includes("signed") || requirementId.includes("nar1")) return "signature";
  if (requirementId.includes("scr")) return "registry";
  return "registry";
}

function isReadOnlyCase(caseItem: AnnualReturnCase): boolean {
  return caseItem.status === "filed" || getPacketStatus(caseItem) === "accepted";
}

function hasCompletedAction(
  caseId: string,
  type: ClientPortalActionType,
  currentSnapshot = snapshot,
): boolean {
  return currentSnapshot.actions.some(
    (action) => action.caseId === caseId && action.type === type && action.status === "completed",
  );
}

function addAction(
  caseItem: AnnualReturnCase,
  type: ClientPortalActionType,
  actor: string,
  summary: string,
): ClientPortalAction {
  const action: ClientPortalAction = {
    id: `portal-action-${caseItem.id}-${type}-${Date.now()}-${snapshot.actions.length + 1}`,
    caseId: caseItem.id,
    type,
    actor,
    status: "completed",
    summary,
    createdAt: nowStamp(),
  };

  snapshot = { ...snapshot, actions: [action, ...snapshot.actions] };
  return action;
}

export function getCurrentClientDocument(
  caseId: string,
  requirementId: string,
  currentSnapshot = snapshot,
): ClientPortalDocument | undefined {
  return currentSnapshot.documents
    .filter(
      (document) =>
        document.caseId === caseId &&
        document.requirementId === requirementId &&
        document.status === "uploaded",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function getClientPortalActivity(
  caseId: string,
  currentSnapshot = snapshot,
): ClientPortalAction[] {
  return currentSnapshot.actions.filter((action) => action.caseId === caseId);
}
```

- [ ] **Step 5: Add required actions and progress helpers**

Append these exports to `src/lib/client-portal-store.ts`:

```ts
export function getClientPortalRequiredActions(
  caseItem: AnnualReturnCase,
  currentSnapshot = snapshot,
): ClientPortalRequiredAction[] {
  const documentActions = caseItem.documents
    .filter((document) => document.required)
    .map((document) => {
      const currentDocument = getCurrentClientDocument(caseItem.id, document.id, currentSnapshot);
      return {
      id: `action-${caseItem.id}-document-${document.id}`,
      caseId: caseItem.id,
      kind: "document" as const,
      label: currentDocument ? `Replace ${document.label}` : `Upload ${document.label}`,
      status: isReadOnlyCase(caseItem)
        ? ("blocked" as const)
        : currentDocument
          ? ("complete" as const)
          : ("open" as const),
      detail: currentDocument
        ? `${currentDocument.filename} is the current uploaded file.`
        : `${document.label} is required before the annual return filing can proceed.`,
      requirementId: document.id,
    };
  });

  const paymentAction = hasCompletedAction(caseItem.id, "acknowledge-payment", currentSnapshot)
    ? []
    : [
        {
          id: `action-${caseItem.id}-payment-acknowledgement`,
          caseId: caseItem.id,
          kind: "payment" as const,
          label: "Acknowledge payment instructions",
          status: isReadOnlyCase(caseItem) ? ("blocked" as const) : ("open" as const),
          detail: "Confirm the client has seen the payment instructions. Staff still controls payment status.",
        },
      ];

  const packetAction = hasCompletedAction(caseItem.id, "approve-packet", currentSnapshot)
    ? []
    : [
        {
          id: `action-${caseItem.id}-packet-approval`,
          caseId: caseItem.id,
          kind: "packet" as const,
          label: "Approve filing packet",
          status: isReadOnlyCase(caseItem) ? ("blocked" as const) : ("open" as const),
          detail: "Confirm the client has reviewed the prepared packet details.",
        },
      ];

  const receiptAction =
    caseItem.receipt && !hasCompletedAction(caseItem.id, "view-receipt", currentSnapshot)
      ? [
          {
            id: `action-${caseItem.id}-receipt-view`,
            caseId: caseItem.id,
            kind: "receipt" as const,
            label: "View filing receipt",
            status: "open" as const,
            detail: `Receipt ${caseItem.receipt.receiptNumber} is ready to view.`,
          },
        ]
      : [];

  return [...documentActions, ...paymentAction, ...packetAction, ...receiptAction];
}

export function getClientPortalProgress(
  caseItem: AnnualReturnCase,
  currentSnapshot = snapshot,
): ClientPortalProgress {
  const requiredDocuments = caseItem.documents.filter((document) => document.required);
  const completedDocuments = requiredDocuments.filter((document) =>
    getCurrentClientDocument(caseItem.id, document.id, currentSnapshot),
  ).length;
  const paymentComplete = hasCompletedAction(caseItem.id, "acknowledge-payment", currentSnapshot);
  const packetComplete = hasCompletedAction(caseItem.id, "approve-packet", currentSnapshot);
  const receiptComplete = Boolean(caseItem.receipt) && hasCompletedAction(caseItem.id, "view-receipt", currentSnapshot);
  const total = requiredDocuments.length + 3;
  const completed = completedDocuments + (paymentComplete ? 1 : 0) + (packetComplete ? 1 : 0) + (receiptComplete ? 1 : 0);
  const nextOpen = getClientPortalRequiredActions(caseItem, currentSnapshot).find(
    (action) => action.status === "open",
  );

  return {
    completed,
    total,
    percentage: total === 0 ? 100 : Math.round((completed / total) * 100),
    nextAction: nextOpen?.label ?? "No client action needed",
    isReadOnly: isReadOnlyCase(caseItem),
  };
}
```

- [ ] **Step 6: Add archive row derivation**

Append these exports to `src/lib/client-portal-store.ts`:

```ts
function rowFromDocument(document: ClientPortalDocument): ClientPortalArchiveRow {
  return {
    id: `archive-${document.id}`,
    caseId: document.caseId,
    requirementId: document.requirementId,
    companyName: document.companyName,
    contactName: document.contactName,
    title: document.title,
    filename: document.filename,
    category: document.category,
    source: document.source,
    status: document.status,
    actor: document.actor,
    createdAt: document.createdAt,
    readonly: document.source !== "client-portal" || document.status === "superseded",
  };
}

function generatedRowsForCase(
  caseItem: AnnualReturnCase,
  currentSnapshot: ClientPortalSnapshot,
): ClientPortalArchiveRow[] {
  const rows = caseItem.packetRequirements
    .filter((requirement) => requirement.complete)
    .map((requirement) => ({
      id: `archive-${caseItem.id}-packet-${requirement.id}`,
      caseId: caseItem.id,
      requirementId: requirement.id,
      companyName: caseItem.companyName,
      contactName: caseItem.contactName,
      title: requirement.label,
      filename: `${caseItem.id}-${requirement.id}.pdf`,
      category: "packet" as const,
      source: "staff-packet" as const,
      status: "generated" as const,
      actor: caseItem.owner || "Operations",
      createdAt: `${caseItem.dueDate}T09:00:00.000Z`,
      readonly: true,
    }));

  if (hasCompletedAction(caseItem.id, "approve-packet", currentSnapshot)) {
    const approvalAction = getClientPortalActivity(caseItem.id, currentSnapshot).find(
      (action) => action.type === "approve-packet",
    );
    rows.push({
      id: `archive-${caseItem.id}-client-packet-approval`,
      caseId: caseItem.id,
      companyName: caseItem.companyName,
      contactName: caseItem.contactName,
      title: "Client packet approval",
      filename: `${caseItem.id}-client-packet-approval.txt`,
      category: "packet",
      source: "client-portal",
      status: "generated",
      actor: approvalAction?.actor ?? caseItem.contactName,
      createdAt: approvalAction?.createdAt ?? nowStamp(),
      readonly: true,
    });
  }

  if (caseItem.submission) {
    rows.push({
      id: `archive-${caseItem.id}-submission`,
      caseId: caseItem.id,
      companyName: caseItem.companyName,
      contactName: caseItem.contactName,
      title: "Filing submission reference",
      filename: `${caseItem.submission.reference}.txt`,
      category: "submission",
      source: "filing-submission",
      status: "generated",
      actor: caseItem.submission.submittedBy,
      createdAt: caseItem.submission.submittedAt,
      readonly: true,
    });
  }

  if (caseItem.receipt) {
    rows.push({
      id: `archive-${caseItem.id}-receipt`,
      caseId: caseItem.id,
      companyName: caseItem.companyName,
      contactName: caseItem.contactName,
      title: "Companies Registry receipt",
      filename: `${caseItem.receipt.receiptNumber}.pdf`,
      category: "receipt",
      source: "filing-receipt",
      status: "accepted",
      actor: caseItem.receipt.acceptedBy,
      createdAt: caseItem.receipt.acceptedAt,
      readonly: true,
    });
  }

  return rows;
}

export function getDocumentArchiveRows(
  cases: AnnualReturnCase[],
  currentSnapshot = snapshot,
): ClientPortalArchiveRow[] {
  return [
    ...currentSnapshot.documents.map(rowFromDocument),
    ...cases.flatMap((caseItem) => generatedRowsForCase(caseItem, currentSnapshot)),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
```

- [ ] **Step 7: Add portal mutations**

Append these exports to `src/lib/client-portal-store.ts`:

```ts
function createDocument(
  caseItem: AnnualReturnCase,
  requirementId: string,
  filename: string,
  actor: string,
  supersedesDocumentId?: string,
): ClientPortalDocument {
  const requirement = caseItem.documents.find((document) => document.id === requirementId);
  const title = requirement?.label ?? "Client document";

  return {
    id: `portal-doc-${caseItem.id}-${requirementId}-${Date.now()}-${snapshot.documents.length + 1}`,
    caseId: caseItem.id,
    requirementId,
    companyName: caseItem.companyName,
    contactName: caseItem.contactName,
    title,
    filename,
    category: documentCategoryForRequirement(requirementId),
    source: "client-portal",
    status: "uploaded",
    actor,
    createdAt: nowStamp(),
    supersedesDocumentId,
  };
}

function blockReadOnlyCase(caseItem: AnnualReturnCase): { ok: false; reason: string } | undefined {
  if (!isReadOnlyCase(caseItem)) return undefined;
  return { ok: false, reason: "Filed cases are read-only in the client portal" };
}

export function uploadClientDocument(
  caseItem: AnnualReturnCase,
  requirementId: string,
  filename: string,
  actor = caseItem.contactName,
): { ok: true; documentId: string } | { ok: false; reason: string } {
  const readOnly = blockReadOnlyCase(caseItem);
  if (readOnly) return readOnly;

  const requirement = caseItem.documents.find((document) => document.id === requirementId);
  if (!requirement) return { ok: false, reason: "Document requirement not found" };
  if (!filename.trim()) return { ok: false, reason: "Filename is required" };

  const document = createDocument(caseItem, requirementId, filename.trim(), actor);
  snapshot = { ...snapshot, documents: [document, ...snapshot.documents] };
  const summary = `${actor} uploaded ${requirement.label}.`;
  addAction(caseItem, "upload-document", actor, summary);
  markDocumentReceived(caseItem.id, requirementId);
  appendClientPortalTimelineEvent(caseItem.id, "Client document uploaded", summary);
  emit();

  return { ok: true, documentId: document.id };
}

export function replaceClientDocument(
  caseItem: AnnualReturnCase,
  requirementId: string,
  filename: string,
  actor = caseItem.contactName,
): { ok: true; documentId: string; supersededDocumentId?: string } | { ok: false; reason: string } {
  const readOnly = blockReadOnlyCase(caseItem);
  if (readOnly) return readOnly;

  const current = getCurrentClientDocument(caseItem.id, requirementId);
  const document = createDocument(caseItem, requirementId, filename.trim(), actor, current?.id);
  snapshot = {
    ...snapshot,
    documents: [
      document,
      ...snapshot.documents.map((candidate) =>
        candidate.id === current?.id ? { ...candidate, status: "superseded" as const } : candidate,
      ),
    ],
  };
  const summary = `${actor} replaced ${document.title}.`;
  addAction(caseItem, "replace-document", actor, summary);
  markDocumentReceived(caseItem.id, requirementId);
  appendClientPortalTimelineEvent(caseItem.id, "Client document replaced", summary);
  emit();

  return { ok: true, documentId: document.id, supersededDocumentId: current?.id };
}

export function acknowledgePaymentInstructions(
  caseItem: AnnualReturnCase,
  actor = caseItem.contactName,
): { ok: true } | { ok: false; reason: string } {
  const readOnly = blockReadOnlyCase(caseItem);
  if (readOnly) return readOnly;

  const summary = `${actor} acknowledged payment instructions.`;
  addAction(caseItem, "acknowledge-payment", actor, summary);
  appendClientPortalTimelineEvent(caseItem.id, "Payment instructions acknowledged", summary);
  emit();

  return { ok: true };
}

export function approveClientPacket(
  caseItem: AnnualReturnCase,
  actor = caseItem.contactName,
): { ok: true } | { ok: false; reason: string } {
  const readOnly = blockReadOnlyCase(caseItem);
  if (readOnly) return readOnly;

  const missingDocuments = caseItem.documents
    .filter((document) => document.required && !getCurrentClientDocument(caseItem.id, document.id))
    .map((document) => document.label);
  if (missingDocuments.length > 0) {
    return { ok: false, reason: `Packet approval blocked: ${missingDocuments.join("; ")}` };
  }

  const summary = `${actor} approved the filing packet.`;
  addAction(caseItem, "approve-packet", actor, summary);
  appendClientPortalTimelineEvent(caseItem.id, "Client packet approved", summary);
  emit();

  return { ok: true };
}

export function recordReceiptViewed(
  caseItem: AnnualReturnCase,
  actor = caseItem.contactName,
): { ok: true } | { ok: false; reason: string } {
  if (!caseItem.receipt) return { ok: false, reason: "No filing receipt is available" };

  const summary = `${actor} viewed filing receipt ${caseItem.receipt.receiptNumber}.`;
  addAction(caseItem, "view-receipt", actor, summary);
  appendClientPortalTimelineEvent(caseItem.id, "Client viewed receipt", summary);
  emit();

  return { ok: true };
}
```

- [ ] **Step 8: Run focused store tests**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/lib/client-portal-store.test.ts src/lib/annual-return-store.test.ts --configLoader runner
```

Expected: PASS for both store test files.

- [ ] **Step 9: Commit Task 2**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/lib/client-portal-store.ts src/lib/client-portal-store.test.ts
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add client portal document store"
```

Expected: commit succeeds.

---

### Task 3: Client Portal Route

**Files:**
- Create: `src/routes/portal.tsx`
- Modify: `src/routes/-annual-returns-workflow.test.ts`
- Generated by build: `src/routeTree.gen.ts`

**Interfaces:**
- Consumes from Task 2:
  - `useClientPortalSnapshot`
  - `getClientPortalProgress`
  - `getClientPortalRequiredActions`
  - `getClientPortalActivity`
  - `getDocumentArchiveRows`
  - `uploadClientDocument`
  - `replaceClientDocument`
  - `acknowledgePaymentInstructions`
  - `approveClientPacket`
  - `recordReceiptViewed`
  - `type ClientPortalRequiredAction`
  - `type ClientPortalArchiveRow`
- Produces:
  - `/portal` route with optional `caseId` search parameter.
  - Client case selector.
  - Mock Upload, Replace, payment acknowledgement, packet approval, and receipt view controls.

- [ ] **Step 1: Add failing source-regression assertions**

Modify `src/routes/-annual-returns-workflow.test.ts`. Add this source read after the existing route source constants:

```ts
const portalRouteSource = readFileSync(new URL("./portal.tsx", import.meta.url), "utf8");
```

Append this test:

```ts
  it("renders the client portal action center with mocked client actions", () => {
    expect(portalRouteSource).toContain('createFileRoute("/portal")');
    expect(portalRouteSource).toContain("caseId");
    expect(portalRouteSource).toContain("Upload");
    expect(portalRouteSource).toContain("Replace");
    expect(portalRouteSource).toContain("Acknowledge payment");
    expect(portalRouteSource).toContain("Approve packet");
    expect(portalRouteSource).toContain("View receipt");
  });
```

- [ ] **Step 2: Run the failing route regression test**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: FAIL because `src/routes/portal.tsx` does not exist.

- [ ] **Step 3: Create the portal route shell**

Create `src/routes/portal.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, FileUp, ReceiptText } from "lucide-react";

import {
  type AnnualReturnCase,
  getPacketStatus,
  useAnnualReturnCases,
} from "../lib/annual-return-store";
import {
  acknowledgePaymentInstructions,
  approveClientPacket,
  getClientPortalActivity,
  getClientPortalProgress,
  getClientPortalRequiredActions,
  getDocumentArchiveRows,
  recordReceiptViewed,
  replaceClientDocument,
  uploadClientDocument,
  useClientPortalSnapshot,
  type ClientPortalArchiveRow,
  type ClientPortalRequiredAction,
} from "../lib/client-portal-store";

type PortalSearch = {
  caseId?: string;
};

export const Route = createFileRoute("/portal")({
  validateSearch: (search): PortalSearch => ({
    caseId: typeof search.caseId === "string" ? search.caseId : undefined,
  }),
  component: PortalRoute,
});

function PortalRoute() {
  const cases = useAnnualReturnCases();
  const snapshot = useClientPortalSnapshot();
  const { caseId } = Route.useSearch();
  const [selectedCaseId, setSelectedCaseId] = useState(caseId ?? cases[0]?.id ?? "");
  const [warning, setWarning] = useState<string | undefined>();

  useEffect(() => {
    if (caseId && cases.some((caseItem) => caseItem.id === caseId)) {
      setSelectedCaseId(caseId);
    }
  }, [caseId, cases]);

  const selectedCase = cases.find((caseItem) => caseItem.id === selectedCaseId) ?? cases[0];

  if (!selectedCase) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Portal case not found</h1>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
          Back to staff app
        </Link>
      </div>
    );
  }

  const progress = getClientPortalProgress(selectedCase, snapshot);
  const requiredActions = getClientPortalRequiredActions(selectedCase, snapshot);
  const activity = getClientPortalActivity(selectedCase.id, snapshot);
  const archiveRows = getDocumentArchiveRows([selectedCase], snapshot);
  const packetStatus = getPacketStatus(selectedCase);
  const isReadOnly = progress.isReadOnly;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Client portal demo</p>
          <h1 className="mt-1 text-3xl font-semibold">{selectedCase.companyName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Annual return due {selectedCase.dueDate} / Packet {packetStatus}
          </p>
        </div>
        <select
          aria-label="Select portal case"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={selectedCase.id}
          onChange={(event) => {
            setWarning(undefined);
            setSelectedCaseId(event.target.value);
          }}
        >
          {cases.map((caseItem) => (
            <option key={caseItem.id} value={caseItem.id}>
              {caseItem.companyName}
            </option>
          ))}
        </select>
      </div>

      {warning ? (
        <div className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          {warning}
        </div>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px] md:items-center">
          <div>
            <h2 className="text-lg font-semibold">Next client action</h2>
            <p className="mt-1 text-sm text-muted-foreground">{progress.nextAction}</p>
          </div>
          <div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <p className="mt-2 text-right text-sm text-muted-foreground">
              {progress.completed}/{progress.total} complete
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Required actions</h2>
              <p className="text-sm text-muted-foreground">
                Mock client actions update the staff archive and case timeline.
              </p>
            </div>
            <CheckCircle2 className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-4 space-y-3">
            {requiredActions.map((action) => (
              <PortalActionRow
                key={action.id}
                action={action}
                caseItem={selectedCase}
                isReadOnly={isReadOnly}
                onWarning={setWarning}
              />
            ))}
            {requiredActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No client action is needed.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Portal activity</h2>
              <p className="text-sm text-muted-foreground">Newest client actions appear first.</p>
            </div>
            <ReceiptText className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-4 space-y-3">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No portal activity yet.</p>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="rounded-md border px-3 py-3 text-sm">
                  <p className="font-medium">{item.summary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatTimestamp(item.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <ArchivePreview rows={archiveRows} />
    </div>
  );
}
```

- [ ] **Step 4: Add portal route helper components**

Append these components and helpers to `src/routes/portal.tsx`:

```tsx
function PortalActionRow({
  action,
  caseItem,
  isReadOnly,
  onWarning,
}: {
  action: ClientPortalRequiredAction;
  caseItem: AnnualReturnCase;
  isReadOnly: boolean;
  onWarning: (warning: string | undefined) => void;
}) {
  const disabled = isReadOnly || action.status === "blocked";

  function handlePrimaryAction() {
    onWarning(undefined);

    if (action.kind === "document" && action.requirementId) {
      const result = uploadClientDocument(
        caseItem,
        action.requirementId,
        `${caseItem.id}-${action.requirementId}.pdf`,
      );
      onWarning(result.ok ? undefined : result.reason);
      return;
    }

    if (action.kind === "payment") {
      const result = acknowledgePaymentInstructions(caseItem);
      onWarning(result.ok ? undefined : result.reason);
      return;
    }

    if (action.kind === "packet") {
      const result = approveClientPacket(caseItem);
      onWarning(result.ok ? undefined : result.reason);
      return;
    }

    if (action.kind === "receipt") {
      const result = recordReceiptViewed(caseItem);
      onWarning(result.ok ? undefined : result.reason);
    }
  }

  function handleReplace() {
    if (!action.requirementId) return;
    const result = replaceClientDocument(
      caseItem,
      action.requirementId,
      `${caseItem.id}-${action.requirementId}-replacement.pdf`,
    );
    onWarning(result.ok ? undefined : result.reason);
  }

  return (
    <div className="rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{action.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">{action.detail}</p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{action.status}</span>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {action.kind === "document" ? (
          <button
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            disabled={disabled}
            onClick={handleReplace}
            type="button"
          >
            <FileUp className="h-4 w-4" />
            Replace
          </button>
        ) : null}
        <button
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          disabled={disabled}
          onClick={handlePrimaryAction}
          type="button"
        >
          {action.kind === "document"
            ? "Upload"
            : action.kind === "payment"
              ? "Acknowledge payment"
              : action.kind === "packet"
                ? "Approve packet"
                : "View receipt"}
        </button>
      </div>
    </div>
  );
}

function ArchivePreview({ rows }: { rows: ClientPortalArchiveRow[] }) {
  const previewRows = useMemo(() => rows.slice(0, 5), [rows]);

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Shared archive</h2>
          <p className="text-sm text-muted-foreground">
            Portal uploads and generated filing records appear here and in Documents.
          </p>
        </div>
        <Link className="rounded-md border px-3 py-2 text-sm" to="/documents">
          Open documents
        </Link>
      </div>
      <div className="mt-4 divide-y">
        {previewRows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No archive rows yet.</p>
        ) : (
          previewRows.map((row) => (
            <div key={row.id} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_140px_120px]">
              <span className="font-medium">{row.title}</span>
              <span>{row.source}</span>
              <span>{row.status}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-HK", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
```

- [ ] **Step 5: Run route source test**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: PASS for source-regression tests.

- [ ] **Step 6: Run build to regenerate the route tree**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' run build -- --configLoader runner
```

Expected: PASS and `src/routeTree.gen.ts` includes `/portal`.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/routes/portal.tsx src/routes/-annual-returns-workflow.test.ts src/routeTree.gen.ts
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add client portal action center"
```

Expected: commit succeeds.

---

### Task 4: Documents Archive Route

**Files:**
- Replace: `src/routes/documents.tsx`
- Modify: `src/routes/-annual-returns-workflow.test.ts`

**Interfaces:**
- Consumes from Task 2:
  - `useClientPortalSnapshot`
  - `getDocumentArchiveRows`
  - `type ClientPortalArchiveRow`
- Produces:
  - `/documents` route with optional `caseId` search parameter.
  - Search by company, contact, title, filename.
  - Filter by source, category, status, and case.
  - Read-only generated rows and linked annual-return cases.

- [ ] **Step 1: Add failing archive route assertions**

Append this test to `src/routes/-annual-returns-workflow.test.ts`:

```ts
  it("renders the document archive with source, category, status, and case filters", () => {
    const documentsRouteSource = readFileSync(new URL("./documents.tsx", import.meta.url), "utf8");

    expect(documentsRouteSource).toContain('createFileRoute("/documents")');
    expect(documentsRouteSource).toContain("caseId");
    expect(documentsRouteSource).toContain("Filter by source");
    expect(documentsRouteSource).toContain("Filter by category");
    expect(documentsRouteSource).toContain("Filter by status");
    expect(documentsRouteSource).toContain("getDocumentArchiveRows");
    expect(documentsRouteSource).toContain('to="/annual-returns/$id"');
  });
```

- [ ] **Step 2: Run the failing archive source test**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: FAIL because the current `/documents` route is still the simple stub.

- [ ] **Step 3: Replace the documents route**

Replace `src/routes/documents.tsx` with:

```tsx
import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { useAnnualReturnCases } from "../lib/annual-return-store";
import {
  getDocumentArchiveRows,
  useClientPortalSnapshot,
  type ClientPortalArchiveRow,
} from "../lib/client-portal-store";

type DocumentsSearch = {
  caseId?: string;
};

export const Route = createFileRoute("/documents")({
  validateSearch: (search): DocumentsSearch => ({
    caseId: typeof search.caseId === "string" ? search.caseId : undefined,
  }),
  component: DocumentsRoute,
});

function DocumentsRoute() {
  const cases = useAnnualReturnCases();
  const snapshot = useClientPortalSnapshot();
  const { caseId } = Route.useSearch();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [caseFilter, setCaseFilter] = useState(caseId ?? "all");

  const rows = useMemo(() => getDocumentArchiveRows(cases, snapshot), [cases, snapshot]);
  const visibleRows = rows.filter((row) => {
    const queryText = `${row.companyName} ${row.contactName} ${row.title} ${row.filename}`.toLowerCase();
    return (
      queryText.includes(query.toLowerCase()) &&
      (source === "all" || row.source === source) &&
      (category === "all" || row.category === category) &&
      (status === "all" || row.status === status) &&
      (caseFilter === "all" || row.caseId === caseFilter)
    );
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Workspace</p>
        <h1 className="mt-1 text-3xl font-semibold">Documents</h1>
      </div>

      <section className="rounded-lg border bg-card">
        <div className="grid gap-3 border-b p-4 xl:grid-cols-[1fr_180px_180px_180px_220px]">
          <input
            aria-label="Search documents"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search company, contact, title, or filename"
            value={query}
          />
          <FilterSelect label="Filter by source" value={source} onChange={setSource} values={["client-portal", "staff-packet", "filing-submission", "filing-receipt"]} />
          <FilterSelect label="Filter by category" value={category} onChange={setCategory} values={["identity", "registry", "signature", "payment", "packet", "submission", "receipt", "other"]} />
          <FilterSelect label="Filter by status" value={status} onChange={setStatus} values={["required", "uploaded", "superseded", "accepted", "rejected", "generated"]} />
          <select
            aria-label="Filter by case"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={caseFilter}
            onChange={(event) => setCaseFilter(event.target.value)}
          >
            <option value="all">All cases</option>
            {cases.map((caseItem) => (
              <option key={caseItem.id} value={caseItem.id}>
                {caseItem.companyName}
              </option>
            ))}
          </select>
        </div>

        <div className="hidden grid-cols-[1.4fr_1fr_120px_150px_120px_150px_100px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>Document</span>
          <span>Company</span>
          <span>Category</span>
          <span>Source</span>
          <span>Status</span>
          <span>Updated</span>
          <span className="text-right">Case</span>
        </div>

        <div className="divide-y">
          {visibleRows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No documents match these filters.</p>
          ) : (
            visibleRows.map((row) => <DocumentRow key={row.id} row={row} />)
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Add archive route helper components**

Append this to `src/routes/documents.tsx`:

```tsx
function FilterSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      className="rounded-md border bg-background px-3 py-2 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="all">{label.replace("Filter by ", "All ")}</option>
      {values.map((item) => (
        <option key={item} value={item}>
          {labelValue(item)}
        </option>
      ))}
    </select>
  );
}

function DocumentRow({ row }: { row: ClientPortalArchiveRow }) {
  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.4fr_1fr_120px_150px_120px_150px_100px] lg:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium">{row.title}</p>
        <p className="truncate text-muted-foreground">{row.filename}</p>
      </div>
      <Field label="Company" value={row.companyName} />
      <Field label="Category" value={labelValue(row.category)} />
      <Field label="Source" value={labelValue(row.source)} />
      <Field label="Status" value={labelValue(row.status)} />
      <Field label="Updated" value={formatTimestamp(row.createdAt)} />
      <div className="flex justify-start lg:justify-end">
        <Link
          className="rounded-md border px-3 py-2 text-sm"
          to="/annual-returns/$id"
          params={{ id: row.caseId }}
        >
          Open
        </Link>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <p className="truncate">{value}</p>
    </div>
  );
}

function labelValue(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-HK", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
```

- [ ] **Step 5: Run archive route tests**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: PASS for source-regression tests.

- [ ] **Step 6: Run store tests**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/lib/client-portal-store.test.ts --configLoader runner
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/routes/documents.tsx src/routes/-annual-returns-workflow.test.ts
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add document archive workspace"
```

Expected: commit succeeds.

---

### Task 5: Staff Integration, Verification, And PR Update

**Files:**
- Modify: `src/routes/annual-returns.$id.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/routes/-annual-returns-workflow.test.ts`
- Review: `src/lib/client-portal-store.ts`
- Review: `src/routes/portal.tsx`
- Review: `src/routes/documents.tsx`
- Generated by build: `src/routeTree.gen.ts`

**Interfaces:**
- Consumes:
  - `useClientPortalSnapshot`
  - `getClientPortalActivity`
  - `getClientPortalRequiredActions`
  - `getDocumentArchiveRows`
- Produces:
  - Client Portal Activity panel in annual-return detail.
  - Staff links to `/portal?caseId=<id>` and `/documents?caseId=<id>`.
  - Sidebar `Portal Demo` route.
  - Final verified branch.

- [ ] **Step 1: Add failing integration assertions**

Append this test to `src/routes/-annual-returns-workflow.test.ts`:

```ts
  it("connects annual-return detail and sidebar to portal activity", () => {
    const sidebarSource = readFileSync(new URL("../components/app-sidebar.tsx", import.meta.url), "utf8");

    expect(annualReturnDetailRouteSource).toContain("Client portal activity");
    expect(annualReturnDetailRouteSource).toContain('to="/portal"');
    expect(annualReturnDetailRouteSource).toContain('to="/documents"');
    expect(annualReturnDetailRouteSource).toContain("getClientPortalRequiredActions");
    expect(annualReturnDetailRouteSource).toContain("getDocumentArchiveRows");
    expect(sidebarSource).toContain("Portal Demo");
    expect(sidebarSource).toContain('to: "/portal"');
  });
```

- [ ] **Step 2: Run failing integration test**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: FAIL because annual-return detail and sidebar do not yet include portal integration.

- [ ] **Step 3: Import portal helpers into annual-return detail**

In `src/routes/annual-returns.$id.tsx`, add this import after the annual-return store import:

```ts
import {
  getClientPortalActivity,
  getClientPortalRequiredActions,
  getDocumentArchiveRows,
  useClientPortalSnapshot,
} from "../lib/client-portal-store";
```

Inside `AnnualReturnDetailRoute`, after `const followUps = getFollowUpDrafts(caseItem);`, add:

```ts
  const portalSnapshot = useClientPortalSnapshot();
  const portalActions = getClientPortalRequiredActions(caseItem, portalSnapshot);
  const portalActivity = getClientPortalActivity(caseItem.id, portalSnapshot);
  const archiveRows = getDocumentArchiveRows([caseItem], portalSnapshot);
  const latestPortalActivity = portalActivity[0];
```

- [ ] **Step 4: Add the Client Portal Activity panel**

In `src/routes/annual-returns.$id.tsx`, place this section at the top of the right column, before the Timeline section:

```tsx
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Client portal activity</h2>
                <p className="text-sm text-muted-foreground">
                  Client-facing actions and archive records for this case.
                </p>
              </div>
              <span className="text-sm text-muted-foreground">
                {portalActions.filter((action) => action.status === "open").length} open
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <DenseStat
                label="Outstanding"
                value={`${portalActions.filter((action) => action.status === "open").length}`}
                tone={portalActions.some((action) => action.status === "open") ? "yellow" : "green"}
              />
              <DenseStat label="Archive" value={`${archiveRows.length}`} tone="blue" />
              <DenseStat
                label="Latest"
                value={latestPortalActivity ? formatTimestamp(latestPortalActivity.createdAt) : "None"}
                tone={latestPortalActivity ? "green" : "blue"}
              />
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Link
                className="rounded-md border px-3 py-2 text-sm"
                to="/documents"
                search={{ caseId: caseItem.id }}
              >
                Open archive
              </Link>
              <Link
                className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                to="/portal"
                search={{ caseId: caseItem.id }}
              >
                Open portal
              </Link>
            </div>
          </section>
```

Wrap the existing Timeline section in the same new right-column `<div className="space-y-4">` and close the div after the Timeline section:

```tsx
        </div>
```

- [ ] **Step 5: Add Portal Demo to the sidebar**

In `src/components/app-sidebar.tsx`, update the lucide import:

```ts
  ExternalLink,
```

Add this nav item after Documents:

```ts
  { to: "/portal", label: "Portal Demo", icon: ExternalLink },
```

- [ ] **Step 6: Run source tests**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: PASS.

- [ ] **Step 7: Run full automated verification**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- --configLoader runner
& 'C:\Program Files\nodejs\npm.cmd' run lint
& 'C:\Program Files\nodejs\npm.cmd' run build -- --configLoader runner
```

Expected:

- Tests PASS.
- Lint exits 0 with only the existing Fast Refresh warnings in `src/components/ui/*`.
- Build PASS and `src/routeTree.gen.ts` includes `/portal`.

- [ ] **Step 8: Manual browser verification**

Start the dev server:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' run dev
```

Expected: Vite prints a local URL.

Verify:

- `/portal` loads with a case selector and progress strip.
- `/portal?caseId=ar-delta` selects Delta Bloom Ventures Limited.
- Uploading Signed NAR1 changes the required action list and activity feed.
- Replacing Signed NAR1 keeps both current and superseded rows visible in archive preview.
- Acknowledging payment does not change annual-return payment status.
- Packet approval is blocked until the portal-visible required documents are uploaded.
- `/documents?caseId=ar-delta` shows client uploads and generated rows, with filters working.
- `/annual-returns/ar-delta` shows Client portal activity with archive count and portal/archive links.
- `/portal?caseId=ar-summit` renders upload and packet approval controls as read-only.

Stop the dev server before finishing.

- [ ] **Step 9: Review diff scope**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' status -sb
& 'C:\Program Files\Git\cmd\git.exe' diff --stat
```

Expected changes are limited to:

- `src/lib/annual-return-store.ts`
- `src/lib/annual-return-store.test.ts`
- `src/lib/client-portal-store.ts`
- `src/lib/client-portal-store.test.ts`
- `src/routes/portal.tsx`
- `src/routes/documents.tsx`
- `src/routes/annual-returns.$id.tsx`
- `src/routes/-annual-returns-workflow.test.ts`
- `src/components/app-sidebar.tsx`
- `src/routeTree.gen.ts`
- This plan and the approved design spec.

- [ ] **Step 10: Commit Task 5**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/routes/annual-returns.$id.tsx src/components/app-sidebar.tsx src/routes/-annual-returns-workflow.test.ts src/routeTree.gen.ts
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: connect portal activity to staff workspace"
```

Expected: commit succeeds.

- [ ] **Step 11: Push the branch**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' push
```

Expected: the existing PR branch updates successfully.

- [ ] **Step 12: Final response**

Report:

- PR branch name: `codex-annual-return-urgency-command-center`.
- Newest commit hash.
- Verification commands and outcomes.
- Remaining lint warnings, if any.
- Whether browser verification ran.
