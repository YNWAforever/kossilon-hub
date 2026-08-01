# Portal Document Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the mocked client portal by making one-time client actions idempotent and adding staff accept/reject review for client-uploaded documents.

**Architecture:** Keep `src/lib/client-portal-store.ts` as the local source of truth for mocked portal documents, actions, archive rows, and review state. Keep `src/lib/annual-return-store.ts` as the source of truth for annual-return readiness and timeline state, with portal store mutations calling existing annual-return helpers for timeline and document-received synchronization.

**Tech Stack:** React 19, TanStack Router, TanStack Start, TypeScript, Vitest, `useSyncExternalStore`, existing local store patterns.

## Global Constraints

- Local-state only; do not add real upload backend, auth, notifications, file preview, object storage, virus scanning, OCR, or database persistence.
- Do not add backend persistence, migrations, email, WhatsApp delivery, push notifications, assignment queues, comment threads, or SLA dashboards.
- Do not broadly redesign `/portal`, `/documents`, or annual-return detail.
- Required portal documents are satisfied only when the latest upload for that requirement is `accepted`.
- A latest upload with `uploaded` status is pending staff review, does not count as complete, and does not reopen the client upload action.
- A latest upload with `rejected` status reopens the client replacement action.
- Repeated payment acknowledgement, packet approval, and receipt viewing return success without adding duplicate action, timeline, or store emission.

---

## File Structure

- `src/lib/client-portal-store.ts`: add review metadata, idempotent one-time action helpers, required-document review satisfaction rules, and `reviewClientDocument`.
- `src/lib/client-portal-store.test.ts`: add store-level regression tests for idempotency, review decisions, packet approval gating, and invalid review attempts.
- `src/routes/documents.tsx`: add staff review controls and review status metadata to the archive table.
- `src/routes/portal.tsx`: disable client document actions while staff review is pending and route rejected document actions through replacement.
- `src/routes/-annual-returns-workflow.test.ts`: add rendered route tests for `/portal?caseId=...` and `/documents?caseId=...`.
- `docs/superpowers/plans/2026-07-09-portal-document-review-hardening.md`: this implementation plan.

---

### Task 1: Store Idempotency And Review State

**Files:**

- Modify: `src/lib/client-portal-store.ts`
- Modify: `src/lib/client-portal-store.test.ts`

**Interfaces:**

- Consumes: `markDocumentReceived(caseId: string, documentId: string): void`, `markDocumentMissing(caseId: string, documentId: string): void`, `appendClientPortalTimelineEvent(caseId: string, label: string, detail: string)`.
- Produces: `export type ClientPortalDocumentReviewDecision = "accepted" | "rejected"`.
- Produces: `reviewClientDocument(documentId: string, decision: ClientPortalDocumentReviewDecision, actor?: string): { ok: true; documentId: string } | { ok: false; reason: string }`.
- Produces: `ClientPortalArchiveRow.reviewable: boolean`, `reviewedBy?: string`, `reviewedAt?: string`, and `reviewSummary?: string`.
- Produces: `ClientPortalRequiredAction.status` supports `"pending-review"` and `ClientPortalRequiredAction.documentAction?: "upload" | "replace"`.

- [ ] **Step 1: Write failing store tests**

Add these imports to `src/lib/client-portal-store.test.ts`:

```ts
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
  reviewClientDocument,
  uploadClientDocument,
} from "./client-portal-store";
```

Append these tests inside the existing `describe("client portal store", () => { ... })` block:

```ts
function timelineLabels(caseId: string, label: string) {
  return requireCase(caseId).timeline.filter((event) => event.label === label);
}

it("keeps payment acknowledgement idempotent without duplicating activity or timeline", () => {
  expect(acknowledgePaymentInstructions(requireCase("ar-delta"), "Joanna Poon")).toEqual({
    ok: true,
  });
  expect(acknowledgePaymentInstructions(requireCase("ar-delta"), "Joanna Poon")).toEqual({
    ok: true,
  });

  expect(
    getClientPortalActivity("ar-delta").filter((action) => action.type === "acknowledge-payment"),
  ).toHaveLength(1);
  expect(timelineLabels("ar-delta", "Payment instructions acknowledged")).toHaveLength(1);
});

it("blocks packet approval until required client uploads are accepted by staff", () => {
  uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
  uploadClientDocument(requireCase("ar-delta"), "scr", "updated-scr.pdf", "Joanna Poon");

  expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({
    ok: false,
    reason:
      "Packet approval blocked: Signed NAR1 pending staff review; Updated significant controller register pending staff review",
  });

  for (const row of getDocumentArchiveRows([requireCase("ar-delta")]).filter(
    (candidate) => candidate.source === "client-portal",
  )) {
    expect(reviewClientDocument(row.documentId ?? row.id, "accepted", "Operations")).toMatchObject({
      ok: true,
    });
  }

  expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
});

it("keeps packet approval idempotent after it succeeds", () => {
  const signed = uploadClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  const scr = uploadClientDocument(
    requireCase("ar-delta"),
    "scr",
    "updated-scr.pdf",
    "Joanna Poon",
  );

  if (!signed.ok || !scr.ok) throw new Error("Expected fixture uploads to succeed");

  reviewClientDocument(signed.documentId, "accepted", "Operations");
  reviewClientDocument(scr.documentId, "accepted", "Operations");

  expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
  expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });

  expect(
    getClientPortalActivity("ar-delta").filter((action) => action.type === "approve-packet"),
  ).toHaveLength(1);
  expect(timelineLabels("ar-delta", "Client packet approved")).toHaveLength(1);
});

it("keeps receipt viewing idempotent after a receipt exists", () => {
  makeDeltaReadyForReceipt();
  expect(submitFilingPacket("ar-delta").ok).toBe(true);
  expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

  expect(recordReceiptViewed(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
  expect(recordReceiptViewed(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });

  expect(
    getClientPortalActivity("ar-delta").filter((action) => action.type === "view-receipt"),
  ).toHaveLength(1);
  expect(timelineLabels("ar-delta", "Client viewed receipt")).toHaveLength(1);
});

it("reopens rejected required documents for replacement", () => {
  const upload = uploadClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");

  expect(reviewClientDocument(upload.documentId, "rejected", "Operations")).toEqual({
    ok: true,
    documentId: upload.documentId,
  });

  expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toMatchObject({
    status: "rejected",
    reviewedBy: "Operations",
  });
  expect(
    requireCase("ar-delta").documents.find((document) => document.id === "signed-nar1"),
  ).toMatchObject({ received: false });
  expect(
    getClientPortalRequiredActions(requireCase("ar-delta")).find(
      (action) => action.requirementId === "signed-nar1",
    ),
  ).toMatchObject({
    label: "Replace Signed NAR1",
    status: "open",
    documentAction: "replace",
  });
});

it("rejects invalid document review attempts without changing archive state", () => {
  const upload = uploadClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");

  const replacement = replaceClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1-v2.pdf",
    "Joanna Poon",
  );
  if (!replacement.ok || !replacement.supersededDocumentId) {
    throw new Error("Expected fixture replacement to supersede the first document");
  }

  expect(reviewClientDocument("missing-document", "accepted", "Operations")).toEqual({
    ok: false,
    reason: "Document not found",
  });
  expect(reviewClientDocument(replacement.supersededDocumentId, "accepted", "Operations")).toEqual({
    ok: false,
    reason: "Superseded documents cannot be reviewed",
  });
  expect(reviewClientDocument(replacement.documentId, "accepted", "Operations")).toEqual({
    ok: true,
    documentId: replacement.documentId,
  });
  expect(reviewClientDocument(replacement.documentId, "rejected", "Operations")).toEqual({
    ok: false,
    reason: "Document has already been reviewed",
  });
});
```

- [ ] **Step 2: Run store tests to verify they fail**

Run:

```powershell
npm test -- src/lib/client-portal-store.test.ts --configLoader runner
```

Expected: FAIL because `reviewClientDocument`, `row.documentId`, `pending-review`, and idempotent action guards do not exist yet.

- [ ] **Step 3: Implement store types and review helpers**

In `src/lib/client-portal-store.ts`, update the annual-return import:

```ts
import {
  type AnnualReturnCase,
  appendClientPortalTimelineEvent,
  getPacketStatus,
  markDocumentMissing,
  markDocumentReceived,
} from "./annual-return-store";
```

Update the exported types:

```ts
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
  | "view-receipt"
  | "accept-document"
  | "reject-document";

export type ClientPortalDocumentReviewDecision = "accepted" | "rejected";
export type ClientPortalRequiredActionStatus = "open" | "complete" | "blocked" | "pending-review";
```

Add review fields to `ClientPortalDocument` and archive rows:

```ts
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
  reviewedBy?: string;
  reviewedAt?: string;
  reviewSummary?: string;
};

export type ClientPortalArchiveRow = {
  id: string;
  documentId?: string;
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
  reviewable: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewSummary?: string;
};

export type ClientPortalRequiredAction = {
  id: string;
  caseId: string;
  kind: "document" | "payment" | "packet" | "receipt";
  label: string;
  status: ClientPortalRequiredActionStatus;
  detail: string;
  requirementId?: string;
  documentAction?: "upload" | "replace";
};
```

Replace `getCurrentClientDocument` with latest non-superseded semantics:

```ts
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
        document.source === "client-portal" &&
        document.status !== "superseded",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function isAcceptedClientDocument(
  caseId: string,
  requirementId: string,
  currentSnapshot = snapshot,
): boolean {
  return getCurrentClientDocument(caseId, requirementId, currentSnapshot)?.status === "accepted";
}

function documentActionForCurrentDocument(
  document: ClientPortalDocument | undefined,
): "upload" | "replace" {
  return document?.status === "rejected" ? "replace" : "upload";
}

function requiredDocumentLabel(documentLabel: string, document?: ClientPortalDocument): string {
  if (!document) return `Upload ${documentLabel}`;
  if (document.status === "rejected") return `Replace ${documentLabel}`;
  return documentLabel;
}

function requiredDocumentDetail(documentLabel: string, document?: ClientPortalDocument): string {
  if (!document) {
    return `${documentLabel} is required before the annual return filing can proceed.`;
  }
  if (document.status === "uploaded") {
    return `${document.filename} is uploaded and waiting for staff review.`;
  }
  if (document.status === "accepted") {
    return `${document.filename} has been accepted by staff.`;
  }
  if (document.status === "rejected") {
    return `${document.filename} was rejected by staff. Please upload a replacement.`;
  }
  return `${documentLabel} is required before the annual return filing can proceed.`;
}
```

Replace the document-action mapping inside `getClientPortalRequiredActions`:

```ts
const documentActions = caseItem.documents
  .filter((document) => document.required)
  .map((document) => {
    const currentDocument = getCurrentClientDocument(caseItem.id, document.id, currentSnapshot);
    const status: ClientPortalRequiredActionStatus = isReadOnlyCase(caseItem)
      ? "blocked"
      : currentDocument?.status === "accepted"
        ? "complete"
        : currentDocument?.status === "uploaded"
          ? "pending-review"
          : "open";
    const documentAction = documentActionForCurrentDocument(currentDocument);

    return {
      id: `action-${caseItem.id}-document-${document.id}`,
      caseId: caseItem.id,
      kind: "document" as const,
      label: requiredDocumentLabel(document.label, currentDocument),
      status,
      detail: requiredDocumentDetail(document.label, currentDocument),
      requirementId: document.id,
      documentAction,
    };
  });
```

Update `getClientPortalProgress` so completed documents count only accepted uploads:

```ts
const completedDocuments = requiredDocuments.filter((document) =>
  isAcceptedClientDocument(caseItem.id, document.id, currentSnapshot),
).length;
const requiredActions = getClientPortalRequiredActions(caseItem, currentSnapshot);
const nextOpen = requiredActions.find((action) => action.status === "open");
const nextPending = requiredActions.find((action) => action.status === "pending-review");
```

Then return the progress `nextAction` like this:

```ts
nextAction: nextOpen?.label ?? (nextPending ? "Waiting for staff review" : "No client action needed"),
```

Update `rowFromDocument`:

```ts
function rowFromDocument(document: ClientPortalDocument): ClientPortalArchiveRow {
  const reviewable = document.source === "client-portal" && document.status === "uploaded";

  return {
    id: `archive-${document.id}`,
    documentId: document.id,
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
    readonly: !reviewable,
    reviewable,
    reviewedBy: document.reviewedBy,
    reviewedAt: document.reviewedAt,
    reviewSummary: document.reviewSummary,
  };
}
```

Add `reviewable: false` to every generated archive row in `generatedRowsForCase`.

- [ ] **Step 4: Implement idempotent one-time actions and packet gates**

Replace the existing `addAction` helper with these helpers:

```ts
function addActionForCase(
  caseId: string,
  type: ClientPortalActionType,
  actor: string,
  summary: string,
): ClientPortalAction {
  const action: ClientPortalAction = {
    id: `portal-action-${caseId}-${type}-${Date.now()}-${snapshot.actions.length + 1}`,
    caseId,
    type,
    actor,
    status: "completed",
    summary,
    createdAt: nowStamp(),
  };

  snapshot = { ...snapshot, actions: [action, ...snapshot.actions] };
  return action;
}

function addAction(
  caseItem: AnnualReturnCase,
  type: ClientPortalActionType,
  actor: string,
  summary: string,
): ClientPortalAction {
  return addActionForCase(caseItem.id, type, actor, summary);
}

function addActionOnce(
  caseItem: AnnualReturnCase,
  type: ClientPortalActionType,
  actor: string,
  summary: string,
): { action: ClientPortalAction; inserted: boolean } {
  const existing = snapshot.actions.find(
    (action) =>
      action.caseId === caseItem.id && action.type === type && action.status === "completed",
  );
  if (existing) return { action: existing, inserted: false };

  return { action: addAction(caseItem, type, actor, summary), inserted: true };
}

function getPacketApprovalBlockers(caseItem: AnnualReturnCase): string[] {
  return caseItem.documents
    .filter((document) => document.required)
    .flatMap((document) => {
      const current = getCurrentClientDocument(caseItem.id, document.id);
      if (!current) return [document.label];
      if (current.status === "uploaded") return [`${document.label} pending staff review`];
      if (current.status === "rejected") return [`${document.label} rejected`];
      if (current.status !== "accepted") return [document.label];
      return [];
    });
}
```

Update `acknowledgePaymentInstructions`, `approveClientPacket`, and `recordReceiptViewed` to use `addActionOnce`. The payment function should look like this:

```ts
export function acknowledgePaymentInstructions(
  caseItem: AnnualReturnCase,
  actor = caseItem.contactName,
): { ok: true } | { ok: false; reason: string } {
  const readOnly = blockReadOnlyCase(caseItem);
  if (readOnly) return readOnly;

  const summary = `${actor} acknowledged payment instructions.`;
  const { inserted } = addActionOnce(caseItem, "acknowledge-payment", actor, summary);
  if (!inserted) return { ok: true };

  appendClientPortalTimelineEvent(caseItem.id, "Payment instructions acknowledged", summary);
  emit();

  return { ok: true };
}
```

Update packet approval with accepted-document gating:

```ts
const missingDocuments = getPacketApprovalBlockers(caseItem);
if (missingDocuments.length > 0) {
  return { ok: false, reason: `Packet approval blocked: ${missingDocuments.join("; ")}` };
}

const summary = `${actor} approved the filing packet.`;
const { inserted } = addActionOnce(caseItem, "approve-packet", actor, summary);
if (!inserted) return { ok: true };

appendClientPortalTimelineEvent(caseItem.id, "Client packet approved", summary);
emit();

return { ok: true };
```

Update receipt viewing with the same pattern:

```ts
const summary = `${actor} viewed filing receipt ${caseItem.receipt.receiptNumber}.`;
const { inserted } = addActionOnce(caseItem, "view-receipt", actor, summary);
if (!inserted) return { ok: true };

appendClientPortalTimelineEvent(caseItem.id, "Client viewed receipt", summary);
emit();

return { ok: true };
```

- [ ] **Step 5: Implement `reviewClientDocument`**

Add this export near the other mutations in `src/lib/client-portal-store.ts`:

```ts
export function reviewClientDocument(
  documentId: string,
  decision: ClientPortalDocumentReviewDecision,
  actor = "Operations",
): { ok: true; documentId: string } | { ok: false; reason: string } {
  const document = snapshot.documents.find((candidate) => candidate.id === documentId);
  if (!document) return { ok: false, reason: "Document not found" };
  if (document.source !== "client-portal") {
    return { ok: false, reason: "Only client portal documents can be reviewed" };
  }
  if (document.status === "superseded") {
    return { ok: false, reason: "Superseded documents cannot be reviewed" };
  }
  if (document.status === "accepted" || document.status === "rejected") {
    return { ok: false, reason: "Document has already been reviewed" };
  }
  if (document.status !== "uploaded") {
    return { ok: false, reason: "Document is not ready for review" };
  }

  const reviewedAt = nowStamp();
  const status = decision;
  const actionType: ClientPortalActionType =
    decision === "accepted" ? "accept-document" : "reject-document";
  const reviewSummary =
    decision === "accepted" ? `Accepted by ${actor}` : `Rejected by ${actor}; replacement required`;
  const summary =
    decision === "accepted"
      ? `${actor} accepted ${document.title}.`
      : `${actor} rejected ${document.title}.`;

  snapshot = {
    ...snapshot,
    documents: snapshot.documents.map((candidate) =>
      candidate.id === document.id
        ? { ...candidate, status, reviewedBy: actor, reviewedAt, reviewSummary }
        : candidate,
    ),
  };

  addActionForCase(document.caseId, actionType, actor, summary);

  if (document.requirementId) {
    if (decision === "accepted") {
      markDocumentReceived(document.caseId, document.requirementId);
    } else {
      markDocumentMissing(document.caseId, document.requirementId);
    }
  }

  appendClientPortalTimelineEvent(
    document.caseId,
    decision === "accepted" ? "Client document accepted" : "Client document rejected",
    summary,
  );
  emit();

  return { ok: true, documentId: document.id };
}
```

- [ ] **Step 6: Run store tests to verify they pass**

Run:

```powershell
npm test -- src/lib/client-portal-store.test.ts --configLoader runner
```

Expected: PASS for `src/lib/client-portal-store.test.ts`.

- [ ] **Step 7: Commit the store changes**

Run:

```powershell
git add src/lib/client-portal-store.ts src/lib/client-portal-store.test.ts
git commit -m "fix: harden portal document review state"
```

Expected: commit succeeds with only the store and store test files staged.

---

### Task 2: Staff Review UI And Rendered Route Coverage

**Files:**

- Modify: `src/routes/documents.tsx`
- Modify: `src/routes/portal.tsx`
- Modify: `src/routes/-annual-returns-workflow.test.ts`

**Interfaces:**

- Consumes: `reviewClientDocument(documentId, decision, actor)`.
- Consumes: `ClientPortalArchiveRow.reviewable`, `documentId`, `reviewSummary`, `reviewedBy`, and `reviewedAt`.
- Consumes: `ClientPortalRequiredAction.documentAction` and `ClientPortalRequiredAction.status`.
- Produces: `/documents` staff review controls for pending client-uploaded rows.
- Produces: rendered route tests for `/portal?caseId=ar-delta` and `/documents?caseId=ar-delta`.

- [ ] **Step 1: Write failing rendered route tests**

Update imports in `src/routes/-annual-returns-workflow.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { getAnnualReturnCaseById, resetAnnualReturnCasesForTest } from "../lib/annual-return-store";
import {
  resetClientPortalStoreForTest,
  reviewClientDocument,
  uploadClientDocument,
} from "../lib/client-portal-store";
```

Add this helper near `renderRoute`:

```ts
function requireCase(caseId: string) {
  const caseItem = getAnnualReturnCaseById(caseId);
  if (!caseItem) throw new Error(`Missing fixture ${caseId}`);
  return caseItem;
}
```

Add this reset before the route regression tests:

```ts
beforeEach(() => {
  resetAnnualReturnCasesForTest();
  resetClientPortalStoreForTest();
});
```

Append these tests inside the existing `describe("annual return workflow route regressions", () => { ... })` block:

```ts
it("renders the selected portal case from the case search parameter", async () => {
  const html = await renderRoute("/portal?caseId=ar-delta");

  expect(html).toContain("Delta Bloom Ventures Limited");
  expect(html).toContain("Upload Signed NAR1");
  expect(html).toContain("Acknowledge payment");
  expect(html).toContain("Approve packet");
});

it("renders document archive review controls for pending client uploads", async () => {
  uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");

  const html = await renderRoute("/documents?caseId=ar-delta");

  expect(html).toContain("Delta Bloom Ventures Limited");
  expect(html).toContain("signed-nar1.pdf");
  expect(html).toContain('aria-label="Accept Signed NAR1"');
  expect(html).toContain('aria-label="Reject Signed NAR1"');
});

it("renders document archive review metadata after staff review", async () => {
  const upload = uploadClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");

  reviewClientDocument(upload.documentId, "accepted", "Operations");
  const html = await renderRoute("/documents?caseId=ar-delta");

  expect(html).toContain("Accepted by Operations");
  expect(html).toContain("signed-nar1.pdf");
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```powershell
npm test -- src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: FAIL because `/documents` does not yet render review controls or metadata.

- [ ] **Step 3: Add review controls to `/documents`**

In `src/routes/documents.tsx`, update the portal-store import:

```ts
import {
  getDocumentArchiveRows,
  reviewClientDocument,
  useClientPortalSnapshot,
  type ClientPortalArchiveRow,
  type ClientPortalDocumentReviewDecision,
} from "../lib/client-portal-store";
```

Add warning state inside `DocumentsRoute`:

```ts
const [warning, setWarning] = useState<string | undefined>();
```

Add the warning banner below the page header:

```tsx
{
  warning ? (
    <div className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
      {warning}
    </div>
  ) : null;
}
```

Update the table header grid to include review:

```tsx
<div className="hidden grid-cols-[1.4fr_1fr_120px_130px_130px_150px_140px_170px_100px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
  <span>Document</span>
  <span>Company</span>
  <span>Category</span>
  <span>Source</span>
  <span>Status</span>
  <span>Uploaded by</span>
  <span>Updated</span>
  <span>Review</span>
  <span className="text-right">Case</span>
</div>
```

Update row rendering:

```tsx
visibleRows.map((row) => <DocumentRow key={row.id} row={row} onWarning={setWarning} />);
```

Replace `DocumentRow` with:

```tsx
function DocumentRow({
  row,
  onWarning,
}: {
  row: ClientPortalArchiveRow;
  onWarning: (warning: string | undefined) => void;
}) {
  function handleReview(decision: ClientPortalDocumentReviewDecision) {
    if (!row.documentId) return;
    const result = reviewClientDocument(row.documentId, decision, "Operations");
    onWarning(result.ok ? undefined : result.reason);
  }

  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.4fr_1fr_120px_130px_130px_150px_140px_170px_100px] lg:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium">{row.title}</p>
        <p className="truncate text-muted-foreground">{row.filename}</p>
      </div>
      <Field label="Company" value={row.companyName} />
      <Field label="Category" value={labelValue(row.category)} />
      <Field label="Source" value={labelValue(row.source)} />
      <Field label="Status" value={labelValue(row.status)} />
      <Field label="Uploaded by" value={row.actor} />
      <Field label="Updated" value={formatTimestamp(row.createdAt)} />
      <ReviewCell row={row} onReview={handleReview} />
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
```

Add this component below `DocumentRow`:

```tsx
function ReviewCell({
  row,
  onReview,
}: {
  row: ClientPortalArchiveRow;
  onReview: (decision: ClientPortalDocumentReviewDecision) => void;
}) {
  if (row.reviewable) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          aria-label={`Accept ${row.title}`}
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
          onClick={() => onReview("accepted")}
          type="button"
        >
          Accept
        </button>
        <button
          aria-label={`Reject ${row.title}`}
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => onReview("rejected")}
          type="button"
        >
          Reject
        </button>
      </div>
    );
  }

  return (
    <Field
      label="Review"
      value={row.reviewSummary ?? (row.readonly ? "Read-only" : "No review needed")}
    />
  );
}
```

- [ ] **Step 4: Update `/portal` for pending and rejected document states**

In `src/routes/portal.tsx`, update `PortalActionRow` action gating:

```ts
const primaryDisabled = action.status !== "open" || (action.kind !== "receipt" && isReadOnly);
const replaceDisabled = action.status !== "complete" || isReadOnly;
```

Update document handling in `handlePrimaryAction`:

```ts
if (action.kind === "document" && action.requirementId) {
  const filename =
    action.documentAction === "replace"
      ? `${caseItem.id}-${action.requirementId}-replacement.pdf`
      : `${caseItem.id}-${action.requirementId}.pdf`;
  const result =
    action.documentAction === "replace"
      ? replaceClientDocument(caseItem, action.requirementId, filename)
      : uploadClientDocument(caseItem, action.requirementId, filename);
  onWarning(result.ok ? undefined : result.reason);
  return;
}
```

Add this helper near `formatTimestamp`:

```ts
function primaryActionLabel(action: ClientPortalRequiredAction): string {
  if (action.kind === "document") return action.documentAction === "replace" ? "Replace" : "Upload";
  if (action.kind === "payment") return "Acknowledge payment";
  if (action.kind === "packet") return "Approve packet";
  return "View receipt";
}
```

Replace the primary button label expression with:

```tsx
{
  primaryActionLabel(action);
}
```

- [ ] **Step 5: Run route tests to verify they pass**

Run:

```powershell
npm test -- src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: PASS for `src/routes/-annual-returns-workflow.test.ts`.

- [ ] **Step 6: Run targeted store and route tests together**

Run:

```powershell
npm test -- src/lib/client-portal-store.test.ts src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: PASS for both test files.

- [ ] **Step 7: Commit the UI and route-test changes**

Run:

```powershell
git add src/routes/documents.tsx src/routes/portal.tsx src/routes/-annual-returns-workflow.test.ts
git commit -m "feat: add staff document review controls"
```

Expected: commit succeeds with only route and route-test files staged.

---

### Task 3: Final Verification And Branch Readiness

**Files:**

- Review: `src/lib/client-portal-store.ts`
- Review: `src/lib/client-portal-store.test.ts`
- Review: `src/routes/documents.tsx`
- Review: `src/routes/portal.tsx`
- Review: `src/routes/-annual-returns-workflow.test.ts`

**Interfaces:**

- Consumes: all exports and route behavior added in Tasks 1 and 2.
- Produces: verified branch ready for push or PR update.

- [ ] **Step 1: Run the full test suite**

Run:

```powershell
npm test -- --configLoader runner
```

Expected: PASS for the full Vitest suite.

- [ ] **Step 2: Run lint**

Run:

```powershell
npm run lint
```

Expected: PASS. Existing Fast Refresh warnings in `src/components/ui/*` may remain if they match the current baseline.

- [ ] **Step 3: Run production build**

Run:

```powershell
npm run build -- --configLoader runner
```

Expected: PASS. Existing Vite or Nitro warnings may remain if they match the current baseline.

- [ ] **Step 4: Inspect the final diff**

Run:

```powershell
git status -sb
git diff --stat origin/main..HEAD
git diff --check
```

Expected: working tree is clean after Task 2 commit, branch includes the design/plan commits and the two implementation commits, and `git diff --check` reports no whitespace errors.

- [ ] **Step 5: Summarize branch state**

Report:

```text
Implemented portal document review hardening.
Verification:
- npm test -- --configLoader runner: PASS
- npm run lint: PASS with known baseline warnings only, or PASS with no warnings
- npm run build -- --configLoader runner: PASS with known baseline warnings only, or PASS with no warnings
Branch status: clean
```
