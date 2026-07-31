# Payment Proof Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete local-state payment-proof workflow that lets clients and staff add proof, lets staff accept or reject it, updates filing readiness atomically, and connects rejected proof to mocked AI WhatsApp follow-ups.

**Architecture:** Keep annual-return payment and packet readiness in `annual-return-store.ts`, and keep proof artifacts, review metadata, portal activity, and mocked follow-up sends in `client-portal-store.ts`. Route components consume focused store helpers; the AI assistant receives read-only payment-proof context and never mutates case state.

**Tech Stack:** React 19, TypeScript, TanStack Router, `useSyncExternalStore`, Vitest, React server rendering tests, Tailwind CSS, Lucide React, Vite, ESLint, Prettier.

## Global Constraints

- The implementation remains local-state only.
- No new runtime dependency.
- No real payment processor, bank reconciliation, file transfer, object storage, OCR, WhatsApp delivery, database, server route, or authentication change.
- Both client and staff proof entry use mocked filenames and metadata.
- Only the current `pending-review` proof can be accepted or rejected.
- Pending and accepted proof block additional uploads; rejected proof can be replaced and becomes `superseded`.
- Filed and receipt-accepted cases are read-only.
- Accepted proof sets payment to `paid` and completes `payment-proof-checked` in one annual-return-store mutation.
- Rejection reason and note are client-visible; reason `other` requires a note.
- Each rejected proof derives at most one active WhatsApp draft and can be mock-sent at most once.
- AI output remains advisory and cannot mutate review, payment, packet, or send state.
- Preserve `.sdd-artifacts/` as unrelated untracked workspace content.

---

## File Map

- `src/lib/annual-return-store.ts`: add the atomic annual-return mutation and extend read-only AI context fields only where annual-return data belongs.
- `src/lib/annual-return-store.test.ts`: prove atomic payment and packet updates, idempotency, missing-case failures, and filed-case guards.
- `src/lib/client-portal-store.ts`: own payment-proof records, upload and review mutations, portal derivations, follow-up drafts, sent history, and proof AI context.
- `src/lib/client-portal-store.test.ts`: prove proof lifecycle, validation, history, follow-up deduplication, and cross-store outcomes.
- `src/routes/payments.tsx`: replace the read-only listing with the staff attachment and review workspace.
- `src/routes/portal.tsx`: render client proof upload, pending, rejected replacement, accepted, and history states.
- `src/routes/whatsapp.automation.tsx`: merge payment-proof follow-ups into the existing open, sent, and all queue.
- `src/lib/ai-agent.ts`: incorporate payment-proof context into deterministic draft copy and sources.
- `src/components/ai-assistant-panel.tsx`: derive and display read-only payment-proof context.
- `src/routes/-annual-returns-workflow.test.ts`: cover rendered Payments, Portal, WhatsApp, and AI contracts.

### Task 1: Atomic Annual-Return Payment Acceptance

**Files:**

- Modify: `src/lib/annual-return-store.ts:16-149, 827-958`
- Test: `src/lib/annual-return-store.test.ts:245-335`

**Interfaces:**

- Consumes: existing `getPacketStatus`, `replaceCase`, `withDerivedStatus`, and `appendTimeline` helpers.
- Produces: `AnnualReturnMutationResult` and `acceptPaymentProofForCase(caseId: string, actor: string): AnnualReturnMutationResult`.

- [ ] **Step 1: Write failing atomic-acceptance tests**

Add the import and these cases to `src/lib/annual-return-store.test.ts`:

```ts
import {
  acceptPaymentProofForCase,
  getAnnualReturnCaseById,
  resetAnnualReturnCasesForTest,
} from "./annual-return-store";

it("accepts payment proof by updating payment and packet readiness in one mutation", () => {
  expect(acceptPaymentProofForCase("ar-delta", "Operations")).toEqual({ ok: true });

  const caseItem = getAnnualReturnCaseById("ar-delta");
  expect(caseItem?.paymentStatus).toBe("paid");
  expect(
    caseItem?.packetRequirements.find((item) => item.id === "payment-proof-checked")?.complete,
  ).toBe(true);
  expect(caseItem?.timeline[0]).toMatchObject({
    label: "Payment proof accepted",
    detail: "Operations accepted payment proof and confirmed payment.",
  });
});

it("keeps payment proof acceptance idempotent", () => {
  acceptPaymentProofForCase("ar-delta", "Operations");
  const timelineLength = getAnnualReturnCaseById("ar-delta")?.timeline.length;

  expect(acceptPaymentProofForCase("ar-delta", "Operations")).toEqual({ ok: true });
  expect(getAnnualReturnCaseById("ar-delta")?.timeline).toHaveLength(timelineLength ?? 0);
});

it("rejects payment proof acceptance for missing and filed cases", () => {
  expect(acceptPaymentProofForCase("missing-case", "Operations")).toEqual({
    ok: false,
    reason: "Case not found",
  });

  const filed = getAnnualReturnCaseById("ar-summit");
  expect(filed?.status).toBe("filed");
  expect(acceptPaymentProofForCase("ar-summit", "Operations")).toEqual({
    ok: false,
    reason: "Filed cases are read-only",
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing export failure**

Run: `npm test -- src/lib/annual-return-store.test.ts`

Expected: FAIL because `acceptPaymentProofForCase` is not exported.

- [ ] **Step 3: Implement the atomic mutation**

Add this result type near the existing annual-return types and add the function beside `updatePaymentStatus`:

```ts
export type AnnualReturnMutationResult = { ok: true } | { ok: false; reason: string };

export function acceptPaymentProofForCase(
  caseId: string,
  actor: string,
): AnnualReturnMutationResult {
  const caseItem = cases.find((candidate) => candidate.id === caseId);
  if (!caseItem) return { ok: false, reason: "Case not found" };
  if (caseItem.status === "filed" || getPacketStatus(caseItem) === "accepted") {
    return { ok: false, reason: "Filed cases are read-only" };
  }

  const proofRequirement = caseItem.packetRequirements.find(
    (requirement) => requirement.id === "payment-proof-checked",
  );
  if (!proofRequirement) {
    return { ok: false, reason: "Payment proof packet requirement not found" };
  }
  if (caseItem.paymentStatus === "paid" && proofRequirement.complete) return { ok: true };

  replaceCase(caseId, (currentCase) =>
    appendTimeline(
      withDerivedStatus({
        ...currentCase,
        paymentStatus: "paid",
        packetRequirements: currentCase.packetRequirements.map((requirement) =>
          requirement.id === "payment-proof-checked"
            ? { ...requirement, complete: true }
            : requirement,
        ),
      }),
      "Payment proof accepted",
      `${actor} accepted payment proof and confirmed payment.`,
    ),
  );

  return { ok: true };
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- src/lib/annual-return-store.test.ts`

Expected: PASS, including existing payment and packet mutation tests.

- [ ] **Step 5: Commit the annual-return mutation**

```bash
git add src/lib/annual-return-store.ts src/lib/annual-return-store.test.ts
git commit -m "feat: accept payment proof into filing readiness"
```

### Task 2: Payment-Proof Records, Uploads, And Reviews

**Files:**

- Modify: `src/lib/client-portal-store.ts:1-460, 791-1020`
- Test: `src/lib/client-portal-store.test.ts:1-110, 948-end`

**Interfaces:**

- Consumes: `acceptPaymentProofForCase(caseId, actor)` from Task 1 and existing portal action/timeline helpers.
- Produces: `ClientPortalPaymentProof`, `ClientPortalPaymentProofReviewReasonCode`, `uploadPaymentProof`, `attachPaymentProof`, `getCurrentPaymentProof`, `getPaymentProofsForCase`, `acceptPaymentProof`, and `rejectPaymentProof`.

- [ ] **Step 1: Write failing proof-lifecycle tests**

Add imports and these cases to `src/lib/client-portal-store.test.ts`:

```ts
import {
  acceptPaymentProof,
  attachPaymentProof,
  getCurrentPaymentProof,
  getPaymentProofsForCase,
  rejectPaymentProof,
  uploadPaymentProof,
} from "./client-portal-store";

it("creates client and staff payment proof with explicit origin metadata", () => {
  expect(
    uploadPaymentProof(requireCase("ar-delta"), "fps-client.png", "Joanna Poon"),
  ).toMatchObject({
    ok: true,
  });
  expect(getCurrentPaymentProof("ar-delta")).toMatchObject({
    filename: "fps-client.png",
    origin: "client-portal",
    status: "pending-review",
  });

  resetClientPortalStoreForTest();
  expect(attachPaymentProof(requireCase("ar-delta"), "fps-staff.png", "Operations")).toMatchObject({
    ok: true,
  });
  expect(getCurrentPaymentProof("ar-delta")).toMatchObject({
    filename: "fps-staff.png",
    origin: "staff-payments",
    status: "pending-review",
  });
});

it("blocks another proof while the current proof is pending or accepted", () => {
  const upload = uploadPaymentProof(requireCase("ar-delta"), "first.png", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected proof upload");

  expect(uploadPaymentProof(requireCase("ar-delta"), "second.png", "Joanna Poon")).toEqual({
    ok: false,
    reason: "Current payment proof is still pending review",
  });
  expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
    ok: true,
    proofId: upload.proofId,
  });
  expect(attachPaymentProof(requireCase("ar-delta"), "third.png", "Operations")).toEqual({
    ok: false,
    reason: "Accepted payment proof cannot be replaced",
  });
});

it("accepts current proof and synchronizes payment, packet, activity, and history", () => {
  const upload = uploadPaymentProof(requireCase("ar-delta"), "fps.png", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected proof upload");

  expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
    ok: true,
    proofId: upload.proofId,
  });
  expect(getCurrentPaymentProof("ar-delta")).toMatchObject({
    status: "accepted",
    reviewedBy: "Operations",
  });
  expect(requireCase("ar-delta").paymentStatus).toBe("paid");
  expect(
    requireCase("ar-delta").packetRequirements.find(
      (requirement) => requirement.id === "payment-proof-checked",
    )?.complete,
  ).toBe(true);
  expect(
    getClientPortalActivity("ar-delta").filter((action) => action.type === "accept-payment-proof"),
  ).toHaveLength(1);
});

it("rejects proof with client-visible metadata and replaces it without deleting history", () => {
  const upload = uploadPaymentProof(requireCase("ar-delta"), "blurred.png", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected proof upload");

  expect(
    rejectPaymentProof(upload.proofId, {
      reasonCode: "missing-reference",
      note: "Please include the FPS reference.",
      actor: "Operations",
    }),
  ).toEqual({ ok: true, proofId: upload.proofId });

  const replacement = uploadPaymentProof(requireCase("ar-delta"), "clear.png", "Joanna Poon");
  expect(replacement).toMatchObject({ ok: true, supersededProofId: upload.proofId });
  expect(getPaymentProofsForCase("ar-delta").map((proof) => proof.status)).toEqual([
    "pending-review",
    "superseded",
  ]);
});

it("validates rejection reasons and stale proof ids", () => {
  const upload = uploadPaymentProof(requireCase("ar-delta"), "proof.png", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected proof upload");

  expect(rejectPaymentProof(upload.proofId, { reasonCode: "other", actor: "Operations" })).toEqual({
    ok: false,
    reason: "Review note is required when reason is Other",
  });
  expect(acceptPaymentProof("missing-proof", "Operations")).toEqual({
    ok: false,
    reason: "Payment proof not found",
  });
});
```

- [ ] **Step 2: Run the portal-store test and verify missing proof APIs**

Run: `npm test -- src/lib/client-portal-store.test.ts`

Expected: FAIL because the payment-proof exports do not exist.

- [ ] **Step 3: Add proof types, reasons, snapshot arrays, and clone behavior**

Add these definitions near the existing document-review types:

```ts
export type ClientPortalPaymentProofOrigin = "client-portal" | "staff-payments";
export type ClientPortalPaymentProofStatus =
  | "pending-review"
  | "accepted"
  | "rejected"
  | "superseded";

export const clientPortalPaymentProofReviewReasons = [
  { code: "unreadable", label: "Proof is unclear, cropped, or incomplete" },
  { code: "amount-mismatch", label: "Paid amount does not match" },
  { code: "payer-mismatch", label: "Payer or company details do not match" },
  { code: "missing-reference", label: "Transaction reference is missing" },
  { code: "wrong-case", label: "Proof belongs to another company or filing" },
  { code: "duplicate-proof", label: "Proof repeats a reviewed transaction" },
  { code: "other", label: "Other issue" },
] as const;

export type ClientPortalPaymentProofReviewReasonCode =
  (typeof clientPortalPaymentProofReviewReasons)[number]["code"];

export type ClientPortalPaymentProof = {
  id: string;
  caseId: string;
  companyName: string;
  contactName: string;
  filename: string;
  origin: ClientPortalPaymentProofOrigin;
  status: ClientPortalPaymentProofStatus;
  uploadedBy: string;
  uploadedAt: string;
  supersedesProofId?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewSummary?: string;
  reviewReasonCode?: ClientPortalPaymentProofReviewReasonCode;
  reviewReasonLabel?: string;
  reviewNote?: string;
};

export type ClientPortalPaymentProofReviewRequest = {
  reasonCode?: ClientPortalPaymentProofReviewReasonCode;
  note?: string;
  actor?: string;
};
```

Extend `ClientPortalActionType` with `upload-payment-proof`, `attach-payment-proof`, `accept-payment-proof`, `reject-payment-proof`, and `send-payment-proof-review-follow-up`. Add optional `proofId` to `ClientPortalAction`. Extend `ClientPortalSnapshot` and `initialSnapshot` with `paymentProofs: ClientPortalPaymentProof[]`, and clone the array in `cloneSnapshot`.

- [ ] **Step 4: Implement current-proof selectors and entry mutations**

Implement these exact public signatures, using one private `addPaymentProof` helper for both origins:

```ts
export function getCurrentPaymentProof(
  caseId: string,
  currentSnapshot = snapshot,
): ClientPortalPaymentProof | undefined;

export function getPaymentProofsForCase(
  caseId: string,
  currentSnapshot = snapshot,
): ClientPortalPaymentProof[];

export function uploadPaymentProof(
  caseItem: AnnualReturnCase,
  filename: string,
  actor?: string,
): { ok: true; proofId: string; supersededProofId?: string } | { ok: false; reason: string };

export function attachPaymentProof(
  caseItem: AnnualReturnCase,
  filename: string,
  actor?: string,
): { ok: true; proofId: string; supersededProofId?: string } | { ok: false; reason: string };
```

The private helper must apply this decision table before changing `snapshot`:

```ts
const current = getCurrentPaymentProof(caseItem.id);
if (current?.status === "pending-review") {
  return { ok: false, reason: "Current payment proof is still pending review" };
}
if (current?.status === "accepted") {
  return { ok: false, reason: "Accepted payment proof cannot be replaced" };
}
```

When `current?.status === "rejected"`, mark it `superseded`, create the replacement with `supersedesProofId: current.id`, preserve all earlier records, add a portal action, append one annual-return timeline event, and emit once.

- [ ] **Step 5: Implement accept and reject mutations**

Implement these signatures:

```ts
export function acceptPaymentProof(
  proofId: string,
  actor?: string,
): { ok: true; proofId: string } | { ok: false; reason: string };

export function rejectPaymentProof(
  proofId: string,
  review: ClientPortalPaymentProofReviewRequest,
  actor?: string,
): { ok: true; proofId: string } | { ok: false; reason: string };
```

Both mutations must verify that the record exists, is current, is `pending-review`, and belongs to a writable case. Acceptance calls `acceptPaymentProofForCase` before updating the proof snapshot. Rejection resolves the reason from `clientPortalPaymentProofReviewReasons`, requires a trimmed note for `other`, leaves annual-return payment and packet state unchanged, appends one timeline event, and emits once.

- [ ] **Step 6: Run the focused tests and verify the lifecycle passes**

Run: `npm test -- src/lib/client-portal-store.test.ts`

Expected: PASS for existing document behavior and the new proof lifecycle tests.

- [ ] **Step 7: Commit the proof domain**

```bash
git add src/lib/client-portal-store.ts src/lib/client-portal-store.test.ts
git commit -m "feat: add payment proof review lifecycle"
```

### Task 3: Rejected-Proof WhatsApp Drafts And Mock Send

**Files:**

- Modify: `src/lib/client-portal-store.ts:154-220, 604-700, 931-977`
- Test: `src/lib/client-portal-store.test.ts:607-708`

**Interfaces:**

- Consumes: payment-proof records and review metadata from Task 2.
- Produces: `ClientPortalPaymentProofFollowUpDraft`, `getPaymentProofFollowUpDrafts`, and `sendPaymentProofFollowUpNow`.

- [ ] **Step 1: Write failing follow-up tests**

```ts
it("derives and mock-sends one follow-up for the current rejected payment proof", () => {
  const upload = uploadPaymentProof(requireCase("ar-delta"), "proof.png", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected proof upload");
  rejectPaymentProof(upload.proofId, {
    reasonCode: "missing-reference",
    note: "Please include the FPS reference.",
    actor: "Operations",
  });

  const draft = getPaymentProofFollowUpDrafts([requireCase("ar-delta")])[0];
  expect(draft).toMatchObject({
    proofId: upload.proofId,
    reasonCode: "missing-reference",
    status: "draft",
  });
  expect(draft.messagePreview).toContain("transaction reference is missing");
  expect(sendPaymentProofFollowUpNow(draft.id, "Operations")).toEqual({ ok: true });
  expect(sendPaymentProofFollowUpNow(draft.id, "Operations")).toEqual({
    ok: false,
    reason: "Follow-up already sent",
  });
  expect(getPaymentProofFollowUpDrafts([requireCase("ar-delta")])[0].status).toBe("sent");
});

it("retires an unsent rejected-proof draft after replacement", () => {
  const upload = uploadPaymentProof(requireCase("ar-delta"), "old.png", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected proof upload");
  rejectPaymentProof(upload.proofId, {
    reasonCode: "unreadable",
    actor: "Operations",
  });

  expect(getPaymentProofFollowUpDrafts([requireCase("ar-delta")])).toHaveLength(1);
  uploadPaymentProof(requireCase("ar-delta"), "new.png", "Joanna Poon");
  expect(getPaymentProofFollowUpDrafts([requireCase("ar-delta")])).toHaveLength(0);
});

it("keeps a sent rejected-proof follow-up in history after replacement", () => {
  const upload = uploadPaymentProof(requireCase("ar-delta"), "old.png", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected proof upload");
  rejectPaymentProof(upload.proofId, {
    reasonCode: "unreadable",
    actor: "Operations",
  });
  const draft = getPaymentProofFollowUpDrafts([requireCase("ar-delta")])[0];
  sendPaymentProofFollowUpNow(draft.id, "Operations");

  uploadPaymentProof(requireCase("ar-delta"), "new.png", "Joanna Poon");
  expect(getPaymentProofFollowUpDrafts([requireCase("ar-delta")])).toEqual([
    expect.objectContaining({ id: draft.id, status: "sent" }),
  ]);
});
```

- [ ] **Step 2: Run the portal-store test and verify missing follow-up exports**

Run: `npm test -- src/lib/client-portal-store.test.ts`

Expected: FAIL because the payment-proof follow-up helpers do not exist.

- [ ] **Step 3: Add follow-up types and sent records**

Mirror the existing document-review follow-up shape with proof-specific fields:

```ts
export type ClientPortalPaymentProofFollowUpDraft = {
  id: string;
  caseId: string;
  proofId: string;
  companyName: string;
  recipientName: string;
  phone: string;
  reasonCode: ClientPortalPaymentProofReviewReasonCode;
  reasonLabel: string;
  note?: string;
  suggestedTiming: string;
  messagePreview: string;
  status: "draft" | "sent" | "blocked";
  blockedReason?: string;
  sentAt?: string;
};

export type ClientPortalPaymentProofFollowUpSend = {
  id: string;
  draftId: string;
  proofId: string;
  caseId: string;
  actor: string;
  sentAt: string;
};
```

Add `paymentProofFollowUps` to `ClientPortalSnapshot`, `initialSnapshot`, and `cloneSnapshot`.

- [ ] **Step 4: Implement deterministic derivation and mock send**

Implement:

```ts
export function getPaymentProofFollowUpDrafts(
  cases: AnnualReturnCase[],
  currentSnapshot?: ClientPortalSnapshot,
): ClientPortalPaymentProofFollowUpDraft[];

export function sendPaymentProofFollowUpNow(
  draftId: string,
  actor?: string,
): { ok: true } | { ok: false; reason: string };
```

Use stable draft ids in the form `payment-proof-review-follow-up-${proof.id}`. Derive an active draft only for the current rejected proof. Also derive historical `sent` rows from `paymentProofFollowUps` even after the linked proof is superseded; never derive a historical row for an unsent superseded proof. Use this deterministic sentence structure:

```ts
return `Hi ${caseItem.contactName}, we reviewed the payment proof for ${caseItem.companyName} and need a replacement because ${reason}.${note} Please upload clearer proof in the portal.`;
```

The send mutation must check prior sends before current-state eligibility, then validate current rejected state and read-only state; write one send record; add one `send-payment-proof-review-follow-up` portal action with `proofId` and `draftId`; append one annual-return timeline event; and emit once. This preserves the stable `Follow-up already sent` response after replacement.

- [ ] **Step 5: Run focused tests and verify deduplication**

Run: `npm test -- src/lib/client-portal-store.test.ts`

Expected: PASS, including document-review follow-up regressions.

- [ ] **Step 6: Commit follow-up state**

```bash
git add src/lib/client-portal-store.ts src/lib/client-portal-store.test.ts
git commit -m "feat: add rejected payment proof follow-ups"
```

### Task 4: Staff Payments Review Workspace

**Files:**

- Modify: `src/routes/payments.tsx:1-47`
- Test: `src/routes/-annual-returns-workflow.test.ts:1-45, 123-end`

**Interfaces:**

- Consumes: `useClientPortalSnapshot`, `getCurrentPaymentProof`, `getPaymentProofsForCase`, `attachPaymentProof`, `acceptPaymentProof`, `rejectPaymentProof`, and `clientPortalPaymentProofReviewReasons`.
- Produces: a dense staff workspace with proof status, attach, accept, reject, reason, note, and history states.

- [ ] **Step 1: Add failing rendered route tests**

Add `paymentsRouteSource`, then add these tests:

```ts
const paymentsRouteSource = readFileSync(new URL("./payments.tsx", import.meta.url), "utf8");

it("renders payment proof attachment and review controls", async () => {
  const htmlWithoutProof = await renderRoute("/payments");
  expect(htmlWithoutProof).toContain("Attach proof");

  attachPaymentProof(requireCase("ar-delta"), "fps-proof.png", "Operations");
  const htmlWithProof = await renderRoute("/payments");
  expect(htmlWithProof).toContain("fps-proof.png");
  expect(htmlWithProof).toContain("Accept");
  expect(htmlWithProof).toContain("Reject");
});

it("keeps structured payment proof reasons and client-visible notes in the payments route", () => {
  expect(paymentsRouteSource).toContain("clientPortalPaymentProofReviewReasons");
  expect(paymentsRouteSource).toContain("Client-visible note");
  expect(paymentsRouteSource).toContain("acceptPaymentProof");
  expect(paymentsRouteSource).toContain("rejectPaymentProof");
});
```

- [ ] **Step 2: Run the route test and verify the missing UI**

Run: `npm test -- src/routes/-annual-returns-workflow.test.ts`

Expected: FAIL because `/payments` is still read-only.

- [ ] **Step 3: Build the staff row component**

Keep `PaymentsRoute` responsible for obtaining cases and snapshot state. Extract a focused `PaymentReviewRow` with this contract:

```ts
type PaymentReviewRowProps = {
  caseItem: AnnualReturnCase;
  proof?: ClientPortalPaymentProof;
  history: ClientPortalPaymentProof[];
};
```

Inside the row, keep `reasonCode`, `note`, and `warning` in local state. Render stable columns for company, owner/due date, payment/readiness, current proof, review outcome, and actions. Use a `<select aria-label="Payment proof rejection reason">`, a labeled `Client-visible note` input, and buttons whose handlers call the store mutations and surface `result.reason` inline.

The no-proof action uses this mocked filename:

```ts
attachPaymentProof(caseItem, `${caseItem.id}-payment-proof.png`, "Operations");
```

When the current proof is rejected, show `Attach replacement` and call `attachPaymentProof` with `${caseItem.id}-payment-proof-replacement.png`. Pending and accepted proof render no attachment action.

Disable all actions when `caseItem.status === "filed" || getPacketStatus(caseItem) === "accepted"`.

- [ ] **Step 4: Run the route test and focused store tests**

Run: `npm test -- src/routes/-annual-returns-workflow.test.ts src/lib/client-portal-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the Payments workspace**

```bash
git add src/routes/payments.tsx src/routes/-annual-returns-workflow.test.ts
git commit -m "feat: add payment proof review workspace"
```

### Task 5: Client Portal Payment-Proof Action And History

**Files:**

- Modify: `src/lib/client-portal-store.ts:327-500`
- Modify: `src/routes/portal.tsx:1-380`
- Test: `src/lib/client-portal-store.test.ts:107-386`
- Test: `src/routes/-annual-returns-workflow.test.ts:156-332`

**Interfaces:**

- Consumes: proof selectors and entry mutations from Task 2.
- Produces: `payment-proof` required-action derivation plus portal upload, pending, rejected replacement, accepted, and history states.

- [ ] **Step 1: Write failing required-action and rendered portal tests**

```ts
it("derives client payment proof actions through upload, review, and replacement", () => {
  expect(getClientPortalRequiredActions(requireCase("ar-delta"))).toContainEqual(
    expect.objectContaining({
      kind: "payment-proof",
      status: "open",
      paymentProofAction: "upload",
    }),
  );

  const upload = uploadPaymentProof(requireCase("ar-delta"), "proof.png", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected proof upload");
  expect(getClientPortalRequiredActions(requireCase("ar-delta"))).toContainEqual(
    expect.objectContaining({ kind: "payment-proof", status: "pending-review" }),
  );

  rejectPaymentProof(upload.proofId, { reasonCode: "unreadable", actor: "Operations" });
  expect(getClientPortalRequiredActions(requireCase("ar-delta"))).toContainEqual(
    expect.objectContaining({
      kind: "payment-proof",
      status: "open",
      paymentProofAction: "replace",
    }),
  );
});

it("renders rejected payment proof reason, replacement action, and history", async () => {
  const upload = uploadPaymentProof(requireCase("ar-delta"), "blurred.png", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected proof upload");
  rejectPaymentProof(upload.proofId, {
    reasonCode: "unreadable",
    note: "The transfer reference is cropped.",
    actor: "Operations",
  });

  const html = await renderRoute("/portal?caseId=ar-delta");
  expect(html).toContain("Replace payment proof");
  expect(html).toContain("Proof is unclear, cropped, or incomplete");
  expect(html).toContain("The transfer reference is cropped.");
  expect(html).toContain("Payment proof history");
});
```

- [ ] **Step 2: Run the focused tests and verify missing portal states**

Run: `npm test -- src/lib/client-portal-store.test.ts src/routes/-annual-returns-workflow.test.ts`

Expected: FAIL because required actions do not include payment proof and Portal does not render proof history.

- [ ] **Step 3: Extend the required-action contract**

Extend `ClientPortalRequiredAction` exactly as follows:

```ts
export type ClientPortalRequiredAction = {
  id: string;
  caseId: string;
  kind: "document" | "payment" | "payment-proof" | "packet" | "receipt";
  label: string;
  status: ClientPortalRequiredActionStatus;
  detail: string;
  requirementId?: string;
  documentAction?: "upload" | "replace";
  paymentProofAction?: "upload" | "replace";
};
```

Derive one proof action from `getCurrentPaymentProof(caseItem.id, currentSnapshot)`:

- no proof: `Upload payment proof`, `open`, `upload`;
- pending: `Payment proof`, `pending-review`, no action;
- accepted: `Payment proof`, `complete`, no action, with filename, reviewer, and review time in `detail`;
- rejected: `Replace payment proof`, `open`, `replace`, with reason and note in `detail`;
- read-only: `blocked`, no actionable mutation.

Insert it after the payment-instructions acknowledgement and before packet approval.

- [ ] **Step 4: Render portal proof actions and history**

In `PortalActionRow.handlePrimaryAction`, add:

```ts
if (action.kind === "payment-proof" && action.paymentProofAction) {
  const result = uploadPaymentProof(
    caseItem,
    action.paymentProofAction === "replace"
      ? `${caseItem.id}-payment-proof-replacement.png`
      : `${caseItem.id}-payment-proof.png`,
  );
  onWarning(result.ok ? undefined : result.reason);
  return;
}
```

Update `primaryActionLabel` to return `Upload payment proof` or `Replace payment proof`. Add a `PaymentProofHistory` component that receives `getPaymentProofsForCase(selectedCase.id, snapshot)`, renders filename, origin, status, review reason/note, reviewer, and timestamp, and remains visible in read-only cases.

- [ ] **Step 5: Run the portal tests**

Run: `npm test -- src/lib/client-portal-store.test.ts src/routes/-annual-returns-workflow.test.ts`

Expected: PASS for proof and existing document/packet portal behavior.

- [ ] **Step 6: Commit the client portal flow**

```bash
git add src/lib/client-portal-store.ts src/lib/client-portal-store.test.ts src/routes/portal.tsx src/routes/-annual-returns-workflow.test.ts
git commit -m "feat: add client payment proof portal flow"
```

### Task 6: WhatsApp Queue And Read-Only AI Context

**Files:**

- Modify: `src/lib/client-portal-store.ts:604-700`
- Modify: `src/routes/whatsapp.automation.tsx:1-220`
- Modify: `src/lib/ai-agent.ts:1-216`
- Modify: `src/components/ai-assistant-panel.tsx:1-199`
- Test: `src/lib/client-portal-store.test.ts:607-708`
- Test: `src/routes/-annual-returns-workflow.test.ts:333-374`

**Interfaces:**

- Consumes: proof records and follow-up helpers from Tasks 2 and 3.
- Produces: `ClientPortalPaymentProofAiContext`, `getPaymentProofAiContext`, payment-proof automation queue rows, and AI draft context.

- [ ] **Step 1: Write failing WhatsApp and AI tests**

Add a rejected-proof fixture and these assertions:

```ts
it("renders rejected payment proof drafts in WhatsApp automation", async () => {
  const upload = uploadPaymentProof(requireCase("ar-delta"), "proof.png", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected proof upload");
  rejectPaymentProof(upload.proofId, {
    reasonCode: "missing-reference",
    note: "Please include the FPS reference.",
    actor: "Operations",
  });

  const html = await renderRoute("/whatsapp/automation");
  expect(html).toContain("Payment proof replacement");
  expect(html).toContain("Transaction reference is missing");
  expect(html).toContain("Please include the FPS reference.");
  expect(html).toContain("Send now");
});

it("exposes payment proof state to AI without state-changing controls", () => {
  expect(aiAssistantPanelSource).toContain("getPaymentProofAiContext");
  expect(aiAssistantPanelSource).toContain("Payment proof");
  expect(aiAssistantPanelSource).not.toContain("acceptPaymentProof(");
  expect(aiAssistantPanelSource).not.toContain("rejectPaymentProof(");
  expect(aiAssistantPanelSource).not.toContain("sendPaymentProofFollowUpNow(");
});
```

Add `aiAssistantPanelSource` beside the other source fixtures.

- [ ] **Step 2: Run the workflow test and verify missing queue/context behavior**

Run: `npm test -- src/routes/-annual-returns-workflow.test.ts`

Expected: FAIL because the queue supports only annual-return and document-review rows and the AI panel has no proof context.

- [ ] **Step 3: Add the read-only payment-proof AI context**

Add this type and helper to `client-portal-store.ts`:

```ts
export type ClientPortalPaymentProofAiContext = {
  status: ClientPortalPaymentProofStatus | "not-uploaded";
  filename?: string;
  origin?: ClientPortalPaymentProofOrigin;
  reasonLabel?: string;
  note?: string;
};

export function getPaymentProofAiContext(
  caseId: string,
  currentSnapshot = snapshot,
): ClientPortalPaymentProofAiContext {
  const proof = getCurrentPaymentProof(caseId, currentSnapshot);
  return proof
    ? {
        status: proof.status,
        filename: proof.filename,
        origin: proof.origin,
        reasonLabel: proof.reviewReasonLabel,
        note: proof.reviewNote,
      }
    : { status: "not-uploaded" };
}
```

Add an optional `paymentProofContext` parameter to `draftReply`. When rejected, append the reason and replacement request to `enrichedCaseLine`; when pending or accepted, state that status. Add one `Case` source with id `payment-proof-status`. Do not add mutation callbacks or imports to `ai-agent.ts`.

In `AiAssistantPanel`, subscribe to `useClientPortalSnapshot`, call `getPaymentProofAiContext`, pass the result to `draftReply`, and add one `Payment proof` field to the live context grid. Do not import or call accept, reject, or send mutations.

- [ ] **Step 4: Merge payment-proof rows into WhatsApp automation**

Add a third `AutomationQueueRow` variant:

```ts
| {
    id: string;
    source: "payment-proof-review";
    caseItem: AnnualReturnCase;
    draft: ClientPortalPaymentProofFollowUpDraft;
  };
```

Derive rows with `getPaymentProofFollowUpDrafts(cases, portalSnapshot)`. In `onSend`, dispatch annual-return, document-review, or `sendPaymentProofFollowUpNow` by source. Return `Payment proof replacement` from `automationTypeLabel`, and show `draft.reasonLabel` in Timing for both review-driven sources.

- [ ] **Step 5: Run focused AI and workflow tests**

Run: `npm test -- src/routes/-annual-returns-workflow.test.ts src/lib/client-portal-store.test.ts`

Expected: PASS, including open/sent queue filtering and existing AI/document-review behavior.

- [ ] **Step 6: Commit WhatsApp and AI integration**

```bash
git add src/lib/client-portal-store.ts src/routes/whatsapp.automation.tsx src/lib/ai-agent.ts src/components/ai-assistant-panel.tsx src/routes/-annual-returns-workflow.test.ts
git commit -m "feat: connect payment proof follow-ups to whatsapp and ai"
```

### Task 7: Full Workflow Regression And Verification

**Files:**

- Modify: `src/lib/client-portal-store.test.ts`
- Modify: `src/routes/-annual-returns-workflow.test.ts`
- Modify only if generated by the existing build: `src/routeTree.gen.ts`

**Interfaces:**

- Consumes: all public interfaces from Tasks 1-6.
- Produces: end-to-end regression coverage and a verified branch ready for code review.

- [ ] **Step 1: Add one complete workflow regression**

Add this store-level scenario to `client-portal-store.test.ts`:

```ts
it("completes reject, follow-up, replacement, and acceptance without losing history", () => {
  const first = uploadPaymentProof(requireCase("ar-delta"), "cropped.png", "Joanna Poon");
  if (!first.ok) throw new Error("Expected first proof upload");
  rejectPaymentProof(first.proofId, {
    reasonCode: "missing-reference",
    note: "Please include the FPS reference.",
    actor: "Operations",
  });

  const draft = getPaymentProofFollowUpDrafts([requireCase("ar-delta")])[0];
  expect(sendPaymentProofFollowUpNow(draft.id, "Operations")).toEqual({ ok: true });

  const replacement = uploadPaymentProof(requireCase("ar-delta"), "complete.png", "Joanna Poon");
  if (!replacement.ok) throw new Error("Expected replacement proof upload");
  expect(acceptPaymentProof(replacement.proofId, "Operations")).toEqual({
    ok: true,
    proofId: replacement.proofId,
  });

  expect(getPaymentProofsForCase("ar-delta")).toEqual([
    expect.objectContaining({ id: replacement.proofId, status: "accepted" }),
    expect.objectContaining({ id: first.proofId, status: "superseded" }),
  ]);
  expect(getClientPortalSnapshot().paymentProofFollowUps).toHaveLength(1);
  expect(getPaymentProofFollowUpDrafts([requireCase("ar-delta")])).toEqual([
    expect.objectContaining({ id: draft.id, status: "sent" }),
  ]);
  expect(requireCase("ar-delta").paymentStatus).toBe("paid");
  expect(
    requireCase("ar-delta").packetRequirements.find(
      (requirement) => requirement.id === "payment-proof-checked",
    )?.complete,
  ).toBe(true);
});
```

- [ ] **Step 2: Run targeted tests**

Run: `npm test -- src/lib/annual-return-store.test.ts src/lib/client-portal-store.test.ts src/routes/-annual-returns-workflow.test.ts`

Expected: PASS with no failed tests.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: PASS with no failed test files.

- [ ] **Step 4: Run lint**

Run: `npm run lint`

Expected: exit code 0. If the repository emits known warnings, confirm no warning points to a touched file before continuing.

- [ ] **Step 5: Run the production build**

Run: `npm run build`

Expected: exit code 0 and a successful Vite production build. Inspect `src/routeTree.gen.ts`; stage it only if the build changed route registration for a real reason.

- [ ] **Step 6: Perform the browser walkthrough**

Run: `npm run dev -- --host 127.0.0.1`

Verify in the browser:

1. `/portal?caseId=ar-delta` uploads mocked payment proof and shows pending review.
2. `/payments` rejects it with `missing-reference` and a client-visible note.
3. `/portal?caseId=ar-delta` shows the reason, note, and replacement action.
4. `/whatsapp/automation` shows one payment-proof replacement draft and mock-sends it.
5. `/portal?caseId=ar-delta` uploads a replacement.
6. `/payments` accepts the replacement.
7. `/annual-returns/ar-delta` shows payment paid, packet readiness updated, and preserved history.
8. The AI assistant shows proof status but no payment-proof state-changing controls.

Expected: no console errors, no overlapping controls at desktop or mobile widths, and the open WhatsApp queue no longer shows the sent draft.

- [ ] **Step 7: Commit final regression coverage**

```bash
git add src/lib/client-portal-store.test.ts src/routes/-annual-returns-workflow.test.ts
git add src/routeTree.gen.ts
git commit -m "test: cover payment proof reconciliation workflow"
```

Before the second `git add`, omit `src/routeTree.gen.ts` when it is unchanged.
