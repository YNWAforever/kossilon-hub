# Document Review Outcome Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-state document review feedback loop where staff rejection reasons become client portal replacement guidance and mock WhatsApp follow-up drafts.

**Architecture:** Keep `src/lib/client-portal-store.ts` as the owner of client document review metadata, portal activity, archive row derivation, and rejected-document follow-up drafts. Keep annual-return follow-ups in `src/lib/annual-return-store.ts`; `/whatsapp/automation` combines annual-return drafts with document-review drafts at the route layer. Store mutations append annual-return timeline events through the existing `appendClientPortalTimelineEvent` helper.

**Tech Stack:** React 19, TanStack Router, TanStack Start, TypeScript, Vitest, `useSyncExternalStore`, existing local store patterns.

## Global Constraints

- Local-state only; do not add real WhatsApp delivery, document preview, upload backend, authentication change, database persistence, or notification service.
- Do not add email, push notifications, external notification providers, server routes, database migrations, or real outbound APIs.
- Staff document rejection must require a structured reason code; the `other` reason must require a non-empty note.
- Accepted documents must not create WhatsApp follow-up drafts in this phase.
- Rejected-document follow-up drafts must be idempotent: one active draft per current rejected client document.
- Mock "Send now" must not duplicate portal activity or annual-return timeline entries.
- Replacing a rejected document must supersede the old document and remove that rejected document from the active follow-up queue.
- Preserve the existing dense operational style of `/documents`, `/portal`, and `/whatsapp/automation`; do not broadly redesign these routes.

---

## File Structure

- `src/lib/client-portal-store.ts`: add review reason types/constants, review payload normalization, rejection metadata fields, document-review follow-up draft derivation, sent-follow-up state, and `sendDocumentReviewFollowUpNow`.
- `src/lib/client-portal-store.test.ts`: add store regression tests for structured rejection metadata, invalid rejection payloads, follow-up derivation, mock send, send idempotency, and replacement retirement.
- `src/routes/documents.tsx`: replace the one-click reject path with a compact reason selector and optional note, and display reason/note/follow-up status on reviewed rows.
- `src/routes/portal.tsx`: render accepted/rejected document metadata in client-facing document action details and archive preview rows where useful.
- `src/routes/whatsapp.automation.tsx`: merge annual-return follow-ups with document-review drafts, render document replacement context, and route send actions to the right store mutation.
- `src/routes/-annual-returns-workflow.test.ts`: add rendered/source route regressions for portal rejection copy, accepted metadata, document review controls, and WhatsApp rejected-document drafts.
- `docs/superpowers/plans/2026-07-10-document-review-outcome-loop.md`: this implementation plan.

---

### Task 1: Structured Review Metadata

**Files:**

- Modify: `src/lib/client-portal-store.ts`
- Modify: `src/lib/client-portal-store.test.ts`

**Interfaces:**

- Consumes: `appendClientPortalTimelineEvent(caseId: string, label: string, detail: string)`, `markDocumentReceived(caseId: string, documentId: string)`, `markDocumentMissing(caseId: string, documentId: string)`.
- Produces: `clientPortalReviewReasons: readonly { code: ClientPortalReviewReasonCode; label: string }[]`.
- Produces: `ClientPortalReviewReasonCode`.
- Produces: `ClientPortalDocumentReviewRequest`.
- Produces: `getClientPortalReviewReason(code: ClientPortalReviewReasonCode | string | undefined): { code: ClientPortalReviewReasonCode; label: string } | undefined`.
- Updates: `reviewClientDocument(documentId, review, actor?)` accepts either the existing string decision or a structured review request.
- Updates: `ClientPortalDocument` and `ClientPortalArchiveRow` expose `reviewReasonCode`, `reviewReasonLabel`, and `reviewNote`.

- [ ] **Step 1: Add failing store tests for structured review metadata**

Update the `client-portal-store` import block in `src/lib/client-portal-store.test.ts` to include the new exports:

```ts
import {
  acknowledgePaymentInstructions,
  approveClientPacket,
  clientPortalReviewReasons,
  getClientPortalActivity,
  getClientPortalProgress,
  getClientPortalRequiredActions,
  getClientPortalReviewReason,
  getCurrentClientDocument,
  getDocumentArchiveRows,
  getClientPortalSnapshot,
  recordReceiptViewed,
  replaceClientDocument,
  resetClientPortalStoreForTest,
  reviewClientDocument,
  uploadClientDocument,
  type ClientPortalReviewReasonCode,
} from "./client-portal-store";
```

Replace existing rejected-review test calls in this file with structured payloads. For example, change this pattern:

```ts
reviewClientDocument(upload.documentId, "rejected", "Operations");
```

to this pattern:

```ts
reviewClientDocument(upload.documentId, {
  decision: "rejected",
  reasonCode: "missing-signature",
  note: "Director signature is missing on page 2.",
  actor: "Operations",
});
```

Append these tests inside `describe("client portal store", () => { ... })`:

```ts
it("stores structured rejection reason metadata on the document and archive row", () => {
  const upload = uploadClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");

  expect(
    reviewClientDocument(upload.documentId, {
      decision: "rejected",
      reasonCode: "missing-signature",
      note: "Director signature is missing on page 2.",
      actor: "Operations",
    }),
  ).toEqual({ ok: true, documentId: upload.documentId });

  expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toMatchObject({
    status: "rejected",
    reviewedBy: "Operations",
    reviewReasonCode: "missing-signature",
    reviewReasonLabel: "Required signature is missing",
    reviewNote: "Director signature is missing on page 2.",
    reviewSummary: "Rejected by Operations: Required signature is missing",
  });

  expect(
    getDocumentArchiveRows([requireCase("ar-delta")]).find(
      (row) => row.documentId === upload.documentId,
    ),
  ).toMatchObject({
    reviewReasonCode: "missing-signature",
    reviewReasonLabel: "Required signature is missing",
    reviewNote: "Director signature is missing on page 2.",
    reviewSummary: "Rejected by Operations: Required signature is missing",
  });
});

it("rejects invalid rejection payloads without reviewing the document", () => {
  const upload = uploadClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");

  expect(
    reviewClientDocument(upload.documentId, {
      decision: "rejected",
      actor: "Operations",
    }),
  ).toEqual({ ok: false, reason: "Rejection reason is required" });

  expect(
    reviewClientDocument(upload.documentId, {
      decision: "rejected",
      reasonCode: "other",
      actor: "Operations",
    }),
  ).toEqual({ ok: false, reason: "Review note is required when reason is Other" });

  expect(
    reviewClientDocument(upload.documentId, {
      decision: "rejected",
      reasonCode: "not-a-reason" as ClientPortalReviewReasonCode,
      actor: "Operations",
    }),
  ).toEqual({ ok: false, reason: "Rejection reason is required" });

  expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toMatchObject({
    status: "uploaded",
    reviewedBy: undefined,
  });
});

it("keeps accepted review metadata free of rejection reason data", () => {
  const upload = uploadClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");

  expect(
    reviewClientDocument(upload.documentId, {
      decision: "accepted",
      actor: "Operations",
    }),
  ).toEqual({ ok: true, documentId: upload.documentId });

  expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toMatchObject({
    status: "accepted",
    reviewedBy: "Operations",
    reviewSummary: "Accepted by Operations",
    reviewReasonCode: undefined,
    reviewReasonLabel: undefined,
    reviewNote: undefined,
  });
});

it("publishes the supported review reason list", () => {
  expect(clientPortalReviewReasons.map((reason) => reason.code)).toEqual([
    "wrong-file",
    "expired",
    "unclear-scan",
    "name-mismatch",
    "missing-signature",
    "missing-page",
    "other",
  ]);
  expect(getClientPortalReviewReason("missing-signature")).toEqual({
    code: "missing-signature",
    label: "Required signature is missing",
  });
  expect(getClientPortalReviewReason(undefined)).toBeUndefined();
});
```

- [ ] **Step 2: Run store tests to verify they fail**

Run:

```powershell
npm.cmd test -- src/lib/client-portal-store.test.ts --configLoader runner
```

Expected: FAIL because `clientPortalReviewReasons`, `ClientPortalReviewReasonCode`, structured review payloads, and review reason fields do not exist yet.

- [ ] **Step 3: Add review reason types and metadata fields**

In `src/lib/client-portal-store.ts`, add these exports after `ClientPortalDocumentReviewDecision`:

```ts
export const clientPortalReviewReasons = [
  { code: "wrong-file", label: "Wrong document uploaded" },
  { code: "expired", label: "Document is expired or outdated" },
  { code: "unclear-scan", label: "Scan is unreadable or incomplete" },
  { code: "name-mismatch", label: "Name or company details do not match" },
  { code: "missing-signature", label: "Required signature is missing" },
  { code: "missing-page", label: "Required page or attachment is missing" },
  { code: "other", label: "Other issue" },
] as const;

export type ClientPortalReviewReasonCode = (typeof clientPortalReviewReasons)[number]["code"];

export type ClientPortalDocumentReviewRequest =
  | {
      decision: "accepted";
      actor?: string;
    }
  | {
      decision: "rejected";
      reasonCode?: ClientPortalReviewReasonCode;
      note?: string;
      actor?: string;
    };

type NormalizedClientPortalReviewRequest =
  | {
      ok: true;
      decision: "accepted";
      actor: string;
    }
  | {
      ok: true;
      decision: "rejected";
      actor: string;
      reasonCode: ClientPortalReviewReasonCode;
      reasonLabel: string;
      note?: string;
    }
  | { ok: false; reason: string };

export function getClientPortalReviewReason(
  code: ClientPortalReviewReasonCode | string | undefined,
): { code: ClientPortalReviewReasonCode; label: string } | undefined {
  return clientPortalReviewReasons.find((reason) => reason.code === code);
}
```

Add these optional fields to both `ClientPortalDocument` and `ClientPortalArchiveRow`:

```ts
reviewReasonCode?: ClientPortalReviewReasonCode;
reviewReasonLabel?: string;
reviewNote?: string;
```

Update `rowFromDocument` so archive rows receive the new fields:

```ts
reviewReasonCode: document.reviewReasonCode,
reviewReasonLabel: document.reviewReasonLabel,
reviewNote: document.reviewNote,
```

- [ ] **Step 4: Normalize structured and legacy review inputs**

Add this helper near `getPacketApprovalBlockers`:

```ts
function normalizeReviewInput(
  review: ClientPortalDocumentReviewDecision | ClientPortalDocumentReviewRequest,
  actor: string,
): NormalizedClientPortalReviewRequest {
  if (typeof review === "string") {
    if (review === "accepted") {
      return { ok: true, decision: "accepted", actor };
    }

    return { ok: false, reason: "Rejection reason is required" };
  }

  const reviewer = review.actor?.trim() || actor;

  if (review.decision === "accepted") {
    return { ok: true, decision: "accepted", actor: reviewer };
  }

  const reason = getClientPortalReviewReason(review.reasonCode);
  if (!reason) return { ok: false, reason: "Rejection reason is required" };

  const note = review.note?.trim();
  if (reason.code === "other" && !note) {
    return { ok: false, reason: "Review note is required when reason is Other" };
  }

  return {
    ok: true,
    decision: "rejected",
    actor: reviewer,
    reasonCode: reason.code,
    reasonLabel: reason.label,
    note,
  };
}
```

- [ ] **Step 5: Update `reviewClientDocument` to store structured metadata**

Change the function signature and use the normalized review payload:

```ts
export function reviewClientDocument(
  documentId: string,
  review: ClientPortalDocumentReviewDecision | ClientPortalDocumentReviewRequest,
  actor = "Operations",
): { ok: true; documentId: string } | { ok: false; reason: string } {
  const normalized = normalizeReviewInput(review, actor);
  if (!normalized.ok) return normalized;

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
  const caseItem = getAnnualReturnCaseById(document.caseId);
  if (caseItem && isReadOnlyCase(caseItem)) {
    return { ok: false, reason: "Filed cases are read-only in the client portal" };
  }

  const reviewedAt = nowStamp();
  const status = normalized.decision;
  const actionType: ClientPortalActionType =
    normalized.decision === "accepted" ? "accept-document" : "reject-document";
  const reviewSummary =
    normalized.decision === "accepted"
      ? `Accepted by ${normalized.actor}`
      : `Rejected by ${normalized.actor}: ${normalized.reasonLabel}`;
  const summary =
    normalized.decision === "accepted"
      ? `${normalized.actor} accepted ${document.title}.`
      : `${normalized.actor} rejected ${document.title}: ${normalized.reasonLabel}.`;

  snapshot = {
    ...snapshot,
    documents: snapshot.documents.map((candidate) =>
      candidate.id === document.id
        ? {
            ...candidate,
            status,
            reviewedBy: normalized.actor,
            reviewedAt,
            reviewSummary,
            reviewReasonCode:
              normalized.decision === "rejected" ? normalized.reasonCode : undefined,
            reviewReasonLabel:
              normalized.decision === "rejected" ? normalized.reasonLabel : undefined,
            reviewNote: normalized.decision === "rejected" ? normalized.note : undefined,
          }
        : candidate,
    ),
  };

  addActionForCase(document.caseId, actionType, normalized.actor, summary);

  if (document.requirementId) {
    if (normalized.decision === "accepted") {
      markDocumentReceived(document.caseId, document.requirementId);
    } else {
      markDocumentMissing(document.caseId, document.requirementId);
    }
  }

  appendClientPortalTimelineEvent(
    document.caseId,
    normalized.decision === "accepted" ? "Client document accepted" : "Client document rejected",
    summary,
  );
  emit();

  return { ok: true, documentId: document.id };
}
```

- [ ] **Step 6: Include review reason text in required document details**

Update the rejected branch in `requiredDocumentDetail`:

```ts
if (document.status === "rejected") {
  const reason = document.reviewReasonLabel ? ` Reason: ${document.reviewReasonLabel}.` : "";
  const note = document.reviewNote ? ` Note: ${document.reviewNote}` : "";
  return `${document.filename} was rejected by staff.${reason}${note} Please upload a replacement.`;
}
```

- [ ] **Step 7: Run store tests to verify Task 1 passes**

Run:

```powershell
npm.cmd test -- src/lib/client-portal-store.test.ts --configLoader runner
```

Expected: PASS for `src/lib/client-portal-store.test.ts`.

- [ ] **Step 8: Commit Task 1**

Run:

```powershell
git add src/lib/client-portal-store.ts src/lib/client-portal-store.test.ts
git commit -m "feat: add structured document review reasons"
```

Expected: commit succeeds with only the store and store test files staged.

---

### Task 2: Rejected-Document Follow-Up Drafts And Mock Send

**Files:**

- Modify: `src/lib/client-portal-store.ts`
- Modify: `src/lib/client-portal-store.test.ts`

**Interfaces:**

- Consumes: `ClientPortalDocument.reviewReasonCode`, `reviewReasonLabel`, `reviewNote`.
- Consumes: `AnnualReturnCase.phone`, `contactName`, `companyName`, `status`, and `receipt`.
- Produces: `ClientPortalDocumentReviewFollowUpDraft`.
- Produces: `getDocumentReviewFollowUpDrafts(cases: AnnualReturnCase[], currentSnapshot?: ClientPortalSnapshot): ClientPortalDocumentReviewFollowUpDraft[]`.
- Produces: `sendDocumentReviewFollowUpNow(draftId: string, actor?: string): { ok: true } | { ok: false; reason: string }`.
- Updates: `ClientPortalSnapshot` includes `documentReviewFollowUps`.
- Updates: `ClientPortalActionType` includes `"send-document-review-follow-up"`.

- [ ] **Step 1: Add failing store tests for follow-up drafts and send now**

Update the `client-portal-store` import block in `src/lib/client-portal-store.test.ts`:

```ts
import {
  acknowledgePaymentInstructions,
  approveClientPacket,
  clientPortalReviewReasons,
  getClientPortalActivity,
  getClientPortalProgress,
  getClientPortalRequiredActions,
  getClientPortalReviewReason,
  getCurrentClientDocument,
  getDocumentArchiveRows,
  getDocumentReviewFollowUpDrafts,
  getClientPortalSnapshot,
  recordReceiptViewed,
  replaceClientDocument,
  resetClientPortalStoreForTest,
  reviewClientDocument,
  sendDocumentReviewFollowUpNow,
  uploadClientDocument,
  type ClientPortalReviewReasonCode,
} from "./client-portal-store";
```

Add this helper near `makeDeltaReadyForReceipt`:

```ts
function rejectSignedNar1ForFollowUp(note = "Director signature is missing on page 2.") {
  const upload = uploadClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");

  const review = reviewClientDocument(upload.documentId, {
    decision: "rejected",
    reasonCode: "missing-signature",
    note,
    actor: "Operations",
  });
  expect(review).toEqual({ ok: true, documentId: upload.documentId });

  return upload.documentId;
}
```

Append these tests inside `describe("client portal store", () => { ... })`:

```ts
it("derives one rejected-document follow-up draft for a current rejected document", () => {
  const documentId = rejectSignedNar1ForFollowUp();

  expect(getDocumentReviewFollowUpDrafts([requireCase("ar-delta")])).toEqual([
    expect.objectContaining({
      id: `document-review-follow-up-${documentId}`,
      caseId: "ar-delta",
      documentId,
      companyName: "Delta Bloom Ventures Limited",
      recipientName: "Joanna Poon",
      phone: "+852 9333 2211",
      documentTitle: "Signed NAR1",
      reasonCode: "missing-signature",
      reasonLabel: "Required signature is missing",
      note: "Director signature is missing on page 2.",
      status: "draft",
      suggestedTiming: "Send now",
    }),
  ]);

  expect(getDocumentReviewFollowUpDrafts([requireCase("ar-delta")])[0].messagePreview).toContain(
    "need a replacement because the required signature is missing",
  );
});

it("does not derive document review follow-up drafts for accepted documents", () => {
  const upload = uploadClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");

  expect(
    reviewClientDocument(upload.documentId, {
      decision: "accepted",
      actor: "Operations",
    }),
  ).toEqual({ ok: true, documentId: upload.documentId });

  expect(getDocumentReviewFollowUpDrafts([requireCase("ar-delta")])).toHaveLength(0);
});

it("mock-sends a rejected-document follow-up once and appends audit history", () => {
  const documentId = rejectSignedNar1ForFollowUp();
  const draft = getDocumentReviewFollowUpDrafts([requireCase("ar-delta")])[0];

  expect(sendDocumentReviewFollowUpNow(draft.id, "Operations")).toEqual({ ok: true });
  expect(sendDocumentReviewFollowUpNow(draft.id, "Operations")).toEqual({
    ok: false,
    reason: "Follow-up already sent",
  });

  expect(getDocumentReviewFollowUpDrafts([requireCase("ar-delta")])[0]).toMatchObject({
    id: `document-review-follow-up-${documentId}`,
    status: "sent",
  });
  expect(
    getClientPortalActivity("ar-delta").filter(
      (action) => action.type === "send-document-review-follow-up",
    ),
  ).toHaveLength(1);
  expect(timelineLabels("ar-delta", "Document replacement follow-up sent")).toHaveLength(1);
});

it("retires the rejected-document draft after the client replaces the rejected document", () => {
  rejectSignedNar1ForFollowUp();
  expect(
    getDocumentReviewFollowUpDrafts([requireCase("ar-delta")]).filter(
      (draft) => draft.status === "draft",
    ),
  ).toHaveLength(1);

  const replacement = replaceClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1-v2.pdf",
    "Joanna Poon",
  );
  expect(replacement).toMatchObject({ ok: true });

  expect(
    getDocumentReviewFollowUpDrafts([requireCase("ar-delta")]).filter(
      (draft) => draft.status === "draft",
    ),
  ).toHaveLength(0);
});

it("marks rejected-document follow-up drafts blocked when the supplied case is filed", () => {
  const documentId = rejectSignedNar1ForFollowUp();
  const filedCase = { ...requireCase("ar-delta"), status: "filed" as const };

  expect(getDocumentReviewFollowUpDrafts([filedCase])).toEqual([
    expect.objectContaining({
      id: `document-review-follow-up-${documentId}`,
      status: "blocked",
      blockedReason: "Filed cases cannot send follow-ups",
    }),
  ]);
});
```

- [ ] **Step 2: Run store tests to verify they fail**

Run:

```powershell
npm.cmd test -- src/lib/client-portal-store.test.ts --configLoader runner
```

Expected: FAIL because `getDocumentReviewFollowUpDrafts`, `sendDocumentReviewFollowUpNow`, sent state, and the new action type do not exist.

- [ ] **Step 3: Add follow-up draft and sent state types**

In `src/lib/client-portal-store.ts`, extend `ClientPortalActionType`:

```ts
  | "accept-document"
  | "reject-document"
  | "send-document-review-follow-up";
```

Extend `ClientPortalAction`:

```ts
  documentId?: string;
  draftId?: string;
```

Add these types after `ClientPortalProgress`:

```ts
export type ClientPortalDocumentReviewFollowUpStatus = "draft" | "sent" | "blocked";

export type ClientPortalDocumentReviewFollowUpDraft = {
  id: string;
  caseId: string;
  documentId: string;
  requirementId?: string;
  companyName: string;
  recipientName: string;
  phone: string;
  documentTitle: string;
  reasonCode: ClientPortalReviewReasonCode;
  reasonLabel: string;
  note?: string;
  suggestedTiming: string;
  messagePreview: string;
  status: ClientPortalDocumentReviewFollowUpStatus;
  blockedReason?: string;
  sentAt?: string;
};

export type ClientPortalDocumentReviewFollowUpSend = {
  id: string;
  draftId: string;
  documentId: string;
  caseId: string;
  actor: string;
  sentAt: string;
};
```

Update `ClientPortalSnapshot` and `initialSnapshot`:

```ts
export type ClientPortalSnapshot = {
  documents: ClientPortalDocument[];
  actions: ClientPortalAction[];
  documentReviewFollowUps: ClientPortalDocumentReviewFollowUpSend[];
};

const initialSnapshot: ClientPortalSnapshot = {
  documents: [],
  actions: [],
  documentReviewFollowUps: [],
};
```

Update `cloneSnapshot`:

```ts
function cloneSnapshot(value: ClientPortalSnapshot): ClientPortalSnapshot {
  return {
    documents: value.documents.map((document) => ({ ...document })),
    actions: value.actions.map((action) => ({ ...action })),
    documentReviewFollowUps: value.documentReviewFollowUps.map((followUp) => ({ ...followUp })),
  };
}
```

- [ ] **Step 4: Add action metadata support**

Replace `addActionForCase` with this signature and body:

```ts
function addActionForCase(
  caseId: string,
  type: ClientPortalActionType,
  actor: string,
  summary: string,
  metadata: Pick<ClientPortalAction, "documentId" | "draftId"> = {},
): ClientPortalAction {
  const action: ClientPortalAction = {
    id: `portal-action-${caseId}-${type}-${Date.now()}-${snapshot.actions.length + 1}`,
    caseId,
    type,
    actor,
    status: "completed",
    summary,
    createdAt: nowStamp(),
    ...metadata,
  };

  snapshot = { ...snapshot, actions: [action, ...snapshot.actions] };
  return action;
}
```

Keep `addAction` calling `addActionForCase(caseItem.id, type, actor, summary)` with no metadata changes.

- [ ] **Step 5: Implement rejected-document draft derivation**

Add these helpers near `getDocumentArchiveRows`:

```ts
function documentReviewFollowUpId(documentId: string): string {
  return `document-review-follow-up-${documentId}`;
}

function isCurrentRejectedDocument(
  document: ClientPortalDocument,
  currentSnapshot = snapshot,
): boolean {
  if (document.status !== "rejected") return false;
  if (!document.requirementId) return false;
  return (
    getCurrentClientDocument(document.caseId, document.requirementId, currentSnapshot)?.id ===
    document.id
  );
}

function documentReviewFollowUpMessage(
  caseItem: AnnualReturnCase,
  document: ClientPortalDocument,
): string {
  const reason = document.reviewReasonLabel
    ? document.reviewReasonLabel.charAt(0).toLowerCase() + document.reviewReasonLabel.slice(1)
    : "the document needs changes";
  const note = document.reviewNote ? ` Note: ${document.reviewNote}` : "";

  return `Hi ${caseItem.contactName}, we reviewed ${document.title} for ${caseItem.companyName} and need a replacement because ${reason}.${note} Please upload a corrected file in the portal.`;
}

function followUpBlockedReason(caseItem: AnnualReturnCase): string | undefined {
  return isReadOnlyCase(caseItem) ? "Filed cases cannot send follow-ups" : undefined;
}
```

Add the exported derivation:

```ts
export function getDocumentReviewFollowUpDrafts(
  cases: AnnualReturnCase[],
  currentSnapshot = snapshot,
): ClientPortalDocumentReviewFollowUpDraft[] {
  const casesById = new Map(cases.map((caseItem) => [caseItem.id, caseItem] as const));
  const sentByDraftId = new Map(
    currentSnapshot.documentReviewFollowUps.map(
      (followUp) => [followUp.draftId, followUp] as const,
    ),
  );

  return currentSnapshot.documents
    .filter((document) => {
      if (document.source !== "client-portal") return false;
      if (!document.reviewReasonCode || !document.reviewReasonLabel) return false;
      if (!casesById.has(document.caseId)) return false;
      return isCurrentRejectedDocument(document, currentSnapshot);
    })
    .map((document) => {
      const caseItem = casesById.get(document.caseId);
      if (!caseItem || !document.reviewReasonCode || !document.reviewReasonLabel) {
        throw new Error("Expected rejected document follow-up inputs to be complete");
      }

      const id = documentReviewFollowUpId(document.id);
      const sent = sentByDraftId.get(id);
      const blockedReason = sent ? undefined : followUpBlockedReason(caseItem);

      return {
        id,
        caseId: caseItem.id,
        documentId: document.id,
        requirementId: document.requirementId,
        companyName: caseItem.companyName,
        recipientName: caseItem.contactName,
        phone: caseItem.phone,
        documentTitle: document.title,
        reasonCode: document.reviewReasonCode,
        reasonLabel: document.reviewReasonLabel,
        note: document.reviewNote,
        suggestedTiming: "Send now",
        messagePreview: documentReviewFollowUpMessage(caseItem, document),
        status: sent ? "sent" : blockedReason ? "blocked" : "draft",
        blockedReason,
        sentAt: sent?.sentAt,
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName));
}
```

- [ ] **Step 6: Implement `sendDocumentReviewFollowUpNow`**

Add this exported mutation near the other client portal mutations:

```ts
export function sendDocumentReviewFollowUpNow(
  draftId: string,
  actor = "Operations",
): { ok: true } | { ok: false; reason: string } {
  const documentId = draftId.replace(/^document-review-follow-up-/, "");
  const document = snapshot.documents.find((candidate) => candidate.id === documentId);
  if (!document) return { ok: false, reason: "The rejected document is no longer current" };

  const caseItem = getAnnualReturnCaseById(document.caseId);
  if (!caseItem) return { ok: false, reason: "Case not found" };

  const draft = getDocumentReviewFollowUpDrafts([caseItem]).find(
    (candidate) => candidate.id === draftId,
  );
  if (!draft) return { ok: false, reason: "The rejected document is no longer current" };
  if (draft.status === "sent") return { ok: false, reason: "Follow-up already sent" };
  if (draft.status === "blocked") {
    return { ok: false, reason: draft.blockedReason ?? "Follow-up cannot be sent" };
  }

  const sentAt = nowStamp();
  const sendRecord: ClientPortalDocumentReviewFollowUpSend = {
    id: `document-review-follow-up-send-${document.id}-${Date.now()}-${snapshot.documentReviewFollowUps.length + 1}`,
    draftId,
    documentId: document.id,
    caseId: caseItem.id,
    actor,
    sentAt,
  };

  snapshot = {
    ...snapshot,
    documentReviewFollowUps: [sendRecord, ...snapshot.documentReviewFollowUps],
  };

  const summary = `${actor} sent a document replacement follow-up for ${document.title}.`;
  addActionForCase(caseItem.id, "send-document-review-follow-up", actor, summary, {
    documentId: document.id,
    draftId,
  });
  appendClientPortalTimelineEvent(caseItem.id, "Document replacement follow-up sent", summary);
  emit();

  return { ok: true };
}
```

- [ ] **Step 7: Run store tests to verify Task 2 passes**

Run:

```powershell
npm.cmd test -- src/lib/client-portal-store.test.ts --configLoader runner
```

Expected: PASS for `src/lib/client-portal-store.test.ts`.

- [ ] **Step 8: Commit Task 2**

Run:

```powershell
git add src/lib/client-portal-store.ts src/lib/client-portal-store.test.ts
git commit -m "feat: add rejected document follow-ups"
```

Expected: commit succeeds with only the store and store test files staged.

---

### Task 3: Staff, Portal, And WhatsApp Route Integration

**Files:**

- Modify: `src/routes/documents.tsx`
- Modify: `src/routes/portal.tsx`
- Modify: `src/routes/whatsapp.automation.tsx`
- Modify: `src/routes/-annual-returns-workflow.test.ts`

**Interfaces:**

- Consumes: `clientPortalReviewReasons`.
- Consumes: `reviewClientDocument(documentId, reviewRequest)`.
- Consumes: `getDocumentReviewFollowUpDrafts(cases, snapshot)`.
- Consumes: `sendDocumentReviewFollowUpNow(draftId, actor?)`.
- Produces: `/documents` rejection reason selector and note input.
- Produces: `/portal` rejected reason/note and accepted metadata in rendered document details.
- Produces: `/whatsapp/automation` combined annual-return and document-review follow-up queue.

- [ ] **Step 1: Add failing route tests**

Update imports in `src/routes/-annual-returns-workflow.test.ts`:

```ts
import {
  getClientPortalSnapshot,
  resetClientPortalStoreForTest,
  reviewClientDocument,
  sendDocumentReviewFollowUpNow,
  uploadClientDocument,
} from "../lib/client-portal-store";
```

Update `seedRejectedPortalDocument` to use a structured rejection:

```ts
function seedRejectedPortalDocument() {
  resetAnnualReturnCasesForTest();
  resetClientPortalStoreForTest();

  const caseItem = requireCase("ar-delta");

  const upload = uploadClientDocument(caseItem, "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");

  expect(
    reviewClientDocument(upload.documentId, {
      decision: "rejected",
      reasonCode: "missing-signature",
      note: "Director signature is missing on page 2.",
      actor: "Operations",
    }),
  ).toEqual({
    ok: true,
    documentId: upload.documentId,
  });
}
```

Update other route-test calls that reject documents so they pass the same structured payload.

Append these tests inside `describe("annual return workflow route regressions", () => { ... })`:

```ts
it("keeps structured rejection controls in the documents route source", () => {
  expect(documentsRouteSource).toContain("clientPortalReviewReasons");
  expect(documentsRouteSource).toContain("Rejection reason");
  expect(documentsRouteSource).toContain("Optional review note");
});

it("renders rejected document reason and note in the client portal", async () => {
  seedRejectedPortalDocument();

  const html = await renderRoute("/portal?caseId=ar-delta");

  expect(html).toContain("Replace Signed NAR1");
  expect(html).toContain("Required signature is missing");
  expect(html).toContain("Director signature is missing on page 2.");
  expect(html).toContain("Please upload a replacement");
});

it("renders accepted document review metadata in the client portal", async () => {
  const upload = uploadClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");
  expect(
    reviewClientDocument(upload.documentId, {
      decision: "accepted",
      actor: "Operations",
    }),
  ).toEqual({
    ok: true,
    documentId: upload.documentId,
  });

  const html = await renderRoute("/portal?caseId=ar-delta");

  expect(html).toContain("signed-nar1.pdf has been accepted by staff.");
  expect(html).toContain("Accepted by Operations");
});

it("renders rejected-document drafts in WhatsApp automation", async () => {
  seedRejectedPortalDocument();

  const html = await renderRoute("/whatsapp/automation");

  expect(html).toContain("Delta Bloom Ventures Limited");
  expect(html).toContain("Document replacement");
  expect(html).toContain("Required signature is missing");
  expect(html).toContain("Director signature is missing on page 2.");
  expect(html).toContain("Send now");
});

it("renders sent rejected-document drafts in WhatsApp automation", async () => {
  seedRejectedPortalDocument();
  const rejectedDocument = getClientPortalSnapshot().documents.find(
    (document) => document.status === "rejected",
  );
  if (!rejectedDocument) throw new Error("Expected rejected document fixture");

  expect(
    sendDocumentReviewFollowUpNow(`document-review-follow-up-${rejectedDocument.id}`, "Operations"),
  ).toEqual({ ok: true });

  const html = await renderRoute("/whatsapp/automation");

  expect(html).toContain("Document replacement");
  expect(html).toContain("Sent");
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```powershell
npm.cmd test -- src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: FAIL because route UI does not yet render the new controls, portal metadata, or document-review follow-up drafts.

- [ ] **Step 3: Update `/documents` imports and review handler**

Change the client portal import in `src/routes/documents.tsx`:

```ts
import {
  clientPortalReviewReasons,
  getDocumentArchiveRows,
  getDocumentReviewFollowUpDrafts,
  reviewClientDocument,
  useClientPortalSnapshot,
  type ClientPortalArchiveRow,
  type ClientPortalDocumentReviewDecision,
  type ClientPortalReviewReasonCode,
} from "../lib/client-portal-store";
```

In `DocumentRow`, derive draft state and accept structured review input:

```tsx
const followUp = getDocumentReviewFollowUpDrafts(cases, snapshot).find(
  (draft) => draft.documentId === row.documentId,
);

function handleReview(
  decision: ClientPortalDocumentReviewDecision,
  options: { reasonCode?: ClientPortalReviewReasonCode; note?: string } = {},
) {
  if (!row.documentId) return;
  const result =
    decision === "accepted"
      ? reviewClientDocument(row.documentId, {
          decision: "accepted",
          actor: "Operations",
        })
      : reviewClientDocument(row.documentId, {
          decision: "rejected",
          reasonCode: options.reasonCode,
          note: options.note,
          actor: "Operations",
        });
  onWarning(result.ok ? undefined : result.reason);
}
```

Pass `cases` and `snapshot` into `DocumentRow` from the map call:

```tsx
visibleRows.map((row) => (
  <DocumentRow key={row.id} row={row} cases={cases} snapshot={snapshot} onWarning={setWarning} />
));
```

Update the `DocumentRow` props:

```tsx
function DocumentRow({
  row,
  cases,
  snapshot,
  onWarning,
}: {
  row: ClientPortalArchiveRow;
  cases: ReturnType<typeof useAnnualReturnCases>;
  snapshot: ReturnType<typeof useClientPortalSnapshot>;
  onWarning: (warning: string | undefined) => void;
}) {
```

- [ ] **Step 4: Replace `ReviewCell` with reason controls and follow-up status**

Replace the current `ReviewCell` implementation with:

```tsx
function ReviewCell({
  row,
  followUpStatus,
  onReview,
}: {
  row: ClientPortalArchiveRow;
  followUpStatus?: string;
  onReview: (
    decision: ClientPortalDocumentReviewDecision,
    options?: { reasonCode?: ClientPortalReviewReasonCode; note?: string },
  ) => void;
}) {
  const [isRejecting, setIsRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState<ClientPortalReviewReasonCode>("missing-signature");
  const [note, setNote] = useState("");

  if (row.reviewable) {
    return (
      <div className="space-y-2">
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
            onClick={() => setIsRejecting((current) => !current)}
            type="button"
          >
            Reject
          </button>
        </div>
        {isRejecting ? (
          <div className="space-y-2">
            <select
              aria-label={`Rejection reason for ${row.title}`}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={reasonCode}
              onChange={(event) =>
                setReasonCode(event.target.value as ClientPortalReviewReasonCode)
              }
            >
              {clientPortalReviewReasons.map((reason) => (
                <option key={reason.code} value={reason.code}>
                  {reason.label}
                </option>
              ))}
            </select>
            <input
              aria-label={`Optional review note for ${row.title}`}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional review note"
            />
            <button
              className="rounded-md border px-3 py-2 text-sm"
              onClick={() => onReview("rejected", { reasonCode, note })}
              type="button"
            >
              Confirm rejection
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (row.reviewSummary || row.reviewedBy || row.reviewedAt) {
    return (
      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="truncate text-sm font-medium text-foreground">
          {row.reviewSummary ?? "Reviewed"}
        </p>
        {row.reviewReasonLabel ? <p>{row.reviewReasonLabel}</p> : null}
        {row.reviewNote ? <p>{row.reviewNote}</p> : null}
        {followUpStatus ? <p>{`Follow-up: ${followUpStatus}`}</p> : null}
        {row.reviewedBy ? <p>{`Reviewed by ${row.reviewedBy}`}</p> : null}
        {row.reviewedAt ? <p>{`Reviewed ${formatTimestamp(row.reviewedAt)}`}</p> : null}
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

Update the `ReviewCell` call:

```tsx
<ReviewCell row={row} followUpStatus={followUp?.status} onReview={handleReview} />
```

- [ ] **Step 5: Update `/portal` document details and archive preview**

In `src/lib/client-portal-store.ts`, Task 1 already updates `requiredDocumentDetail` for rejected documents. In `src/routes/portal.tsx`, update the archive preview row to show review metadata under document rows:

```tsx
previewRows.map((row) => (
  <div key={row.id} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_140px_120px]">
    <span className="font-medium">
      {row.title}
      {row.reviewSummary ? (
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          {row.reviewSummary}
          {row.reviewReasonLabel ? ` - ${row.reviewReasonLabel}` : ""}
          {row.reviewNote ? ` - ${row.reviewNote}` : ""}
        </span>
      ) : null}
    </span>
    <span>{row.source}</span>
    <span>{row.status}</span>
  </div>
));
```

Update the accepted branch in `requiredDocumentDetail` in `src/lib/client-portal-store.ts` if it does not include `reviewSummary`:

```ts
if (document.status === "accepted") {
  const review = document.reviewSummary ? ` ${document.reviewSummary}.` : "";
  return `${document.filename} has been accepted by staff.${review}`;
}
```

- [ ] **Step 6: Merge document-review drafts into `/whatsapp/automation`**

Change imports in `src/routes/whatsapp.automation.tsx`:

```ts
import {
  getFollowUpDrafts,
  sendFollowUpNow,
  useAnnualReturnCases,
  type AnnualReturnCase,
  type AnnualReturnFollowUpDraft,
} from "../lib/annual-return-store";
import {
  getDocumentReviewFollowUpDrafts,
  sendDocumentReviewFollowUpNow,
  useClientPortalSnapshot,
  type ClientPortalDocumentReviewFollowUpDraft,
} from "../lib/client-portal-store";
```

Add the local row union:

```ts
type AutomationQueueRow =
  | {
      id: string;
      source: "annual-return";
      caseItem: AnnualReturnCase;
      draft: AnnualReturnFollowUpDraft;
    }
  | {
      id: string;
      source: "document-review";
      caseItem: AnnualReturnCase;
      draft: ClientPortalDocumentReviewFollowUpDraft;
    };
```

Update `WhatsAppAutomationRoute`:

```tsx
const cases = useAnnualReturnCases();
const portalSnapshot = useClientPortalSnapshot();
const [filter, setFilter] = useState<"open" | "sent" | "all">("open");
const [warning, setWarning] = useState<string | undefined>();

const rows = useMemo<AutomationQueueRow[]>(() => {
  const casesById = new Map(cases.map((caseItem) => [caseItem.id, caseItem] as const));
  const annualReturnRows = cases.flatMap((caseItem) =>
    getFollowUpDrafts(caseItem).map((draft) => ({
      id: draft.id,
      source: "annual-return" as const,
      caseItem,
      draft,
    })),
  );
  const documentReviewRows = getDocumentReviewFollowUpDrafts(cases, portalSnapshot).flatMap(
    (draft) => {
      const caseItem = casesById.get(draft.caseId);
      return caseItem
        ? [
            {
              id: draft.id,
              source: "document-review" as const,
              caseItem,
              draft,
            },
          ]
        : [];
    },
  );

  return [...annualReturnRows, ...documentReviewRows];
}, [cases, portalSnapshot]);
```

Update the row render:

```tsx
visibleRows.map((row) => (
  <AutomationRow
    key={`${row.source}-${row.id}`}
    row={row}
    onSend={() => {
      const result =
        row.source === "annual-return"
          ? sendFollowUpNow(row.caseItem.id, row.draft.id)
          : sendDocumentReviewFollowUpNow(row.draft.id, "Operations");
      setWarning(result.ok ? undefined : result.reason);
    }}
  />
));
```

Replace `AutomationRow` props and field usage:

```tsx
function AutomationRow({ row, onSend }: { row: AutomationQueueRow; onSend: () => void }) {
  const { caseItem, draft } = row;
  const disabled = draft.status !== "draft";

  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.2fr_1fr_160px_120px_110px_minmax(0,1.5fr)_120px] lg:items-center">
      <div className="min-w-0">
        <Link
          className="font-medium hover:underline"
          to="/annual-returns/$id"
          params={{ id: caseItem.id }}
        >
          {caseItem.companyName}
        </Link>
        <p className="text-muted-foreground">{caseItem.owner}</p>
      </div>
      <Field label="Recipient" value={`${draft.recipientName} / ${draft.phone}`} />
      <Field label="Type" value={automationTypeLabel(row)} />
      <Field
        label="Timing"
        value={row.source === "document-review" ? draft.reasonLabel : draft.suggestedTiming}
      />
      <Field
        label="Status"
        value={
          <span
            className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${statusToneClass(draft.status)}`}
          >
            {statusLabel(draft.status)}
          </span>
        }
      />
      <Field label="Preview" value={draft.messagePreview} />
      <div className="flex justify-start lg:justify-end">
        <button
          className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          disabled={disabled}
          onClick={onSend}
          type="button"
        >
          {draft.status === "sent" ? "Sent" : draft.status === "blocked" ? "Blocked" : "Send now"}
        </button>
      </div>
    </div>
  );
}
```

Add this helper:

```ts
function automationTypeLabel(row: AutomationQueueRow): string {
  if (row.source === "document-review") return "Document replacement";
  return followUpTypeLabel(row.draft.type);
}
```

- [ ] **Step 7: Run route tests to verify Task 3 passes**

Run:

```powershell
npm.cmd test -- src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: PASS for `src/routes/-annual-returns-workflow.test.ts`.

- [ ] **Step 8: Run targeted store and route tests together**

Run:

```powershell
npm.cmd test -- src/lib/client-portal-store.test.ts src/routes/-annual-returns-workflow.test.ts --configLoader runner
```

Expected: PASS for both files.

- [ ] **Step 9: Commit Task 3**

Run:

```powershell
git add src/routes/documents.tsx src/routes/portal.tsx src/routes/whatsapp.automation.tsx src/routes/-annual-returns-workflow.test.ts src/lib/client-portal-store.ts
git commit -m "feat: connect document review outcomes to portal and whatsapp"
```

Expected: commit succeeds with route files, route tests, and the small `requiredDocumentDetail` update in `src/lib/client-portal-store.ts` staged.

---

### Task 4: Final Verification And Branch Readiness

**Files:**

- Review: `src/lib/client-portal-store.ts`
- Review: `src/lib/client-portal-store.test.ts`
- Review: `src/routes/documents.tsx`
- Review: `src/routes/portal.tsx`
- Review: `src/routes/whatsapp.automation.tsx`
- Review: `src/routes/-annual-returns-workflow.test.ts`

**Interfaces:**

- Consumes: all exports and route behavior added in Tasks 1 through 3.
- Produces: verified branch ready for review, push, or PR update.

- [ ] **Step 1: Run the full Vitest suite**

Run:

```powershell
npm.cmd test -- --configLoader runner
```

Expected: PASS for all test files. Existing skipped tests may remain skipped.

- [ ] **Step 2: Run lint**

Run:

```powershell
npm.cmd run lint
```

Expected: PASS. Existing Fast Refresh warnings in `src/components/ui/*` may remain if they match the current baseline.

- [ ] **Step 3: Run production build**

Run:

```powershell
npm.cmd run build -- --configLoader runner
```

Expected: PASS. If the sandbox blocks `.output` creation with `EPERM`, rerun the same command with sandbox escalation and report that the first failure was sandbox-only.

- [ ] **Step 4: Inspect final branch state**

Run:

```powershell
git status -sb
git diff --stat origin/main..HEAD
git diff --check
```

Expected: branch has only intended commits and `git diff --check` reports no whitespace errors. Local scratch artifacts such as `.sdd-artifacts/` should remain untracked and uncommitted.

- [ ] **Step 5: Summarize readiness**

Report:

```text
Implemented document review outcome loop.
Verification:
- npm.cmd test -- --configLoader runner: PASS
- npm.cmd run lint: PASS with known baseline warnings only, or PASS with no warnings
- npm.cmd run build -- --configLoader runner: PASS with known baseline warnings only, or PASS with no warnings
Branch status: clean except ignored/untracked scratch artifacts
```
