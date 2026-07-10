import { beforeEach, describe, expect, it } from "vitest";

import {
  acceptFilingReceipt,
  completeChecklistItem,
  getAnnualReturnCaseById,
  removeAnnualReturnCaseForTest,
  resetAnnualReturnCasesForTest,
  subscribeAnnualReturnCasesForTest,
  submitFilingPacket,
  togglePacketRequirement,
  updatePaymentStatus,
  updateReviewStatus,
  updateSignatureStatus,
} from "./annual-return-store";
import {
  acceptPaymentProof,
  acknowledgePaymentInstructions,
  attachPaymentProof,
  approveClientPacket,
  clientPortalReviewReasons,
  getClientPortalActivity,
  getClientPortalProgress,
  getClientPortalRequiredActions,
  getClientPortalReviewReason,
  getPaymentProofAiContext,
  getCurrentClientDocument,
  getCurrentPaymentProof,
  getDocumentArchiveRows,
  getDocumentReviewFollowUpDrafts,
  getPaymentProofFollowUpDrafts,
  getPaymentProofsForCase,
  getClientPortalSnapshot,
  recordReceiptViewed,
  rejectPaymentProof,
  replaceClientDocument,
  resetClientPortalStoreForTest,
  reviewClientDocument,
  sendDocumentReviewFollowUpNow,
  sendPaymentProofFollowUpNow,
  subscribeClientPortalStoreForTest,
  uploadPaymentProof,
  uploadClientDocument,
  type ClientPortalReviewReasonCode,
} from "./client-portal-store";

function requireCase(caseId: string) {
  const caseItem = getAnnualReturnCaseById(caseId);
  if (!caseItem) throw new Error(`Missing fixture ${caseId}`);
  return caseItem;
}

function timelineLabels(caseId: string, label: string) {
  return requireCase(caseId).timeline.filter((event) => event.label === label);
}

function acceptDeltaPaymentProof(): void {
  const upload = uploadPaymentProof(requireCase("ar-delta"), "payment-proof.png", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected payment proof upload to succeed");

  expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
    ok: true,
    proofId: upload.proofId,
  });
}

function makeDeltaReadyForReceipt(): void {
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
    if (
      !requireCase("ar-delta").packetRequirements.find((item) => item.id === requirementId)
        ?.complete
    ) {
      togglePacketRequirement("ar-delta", requirementId);
    }
  }
}

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
      "action-ar-delta-payment-proof",
      "action-ar-delta-packet-approval",
    ]);
    expect(getClientPortalProgress(requireCase("ar-delta"))).toMatchObject({
      completed: 0,
      total: 6,
      nextAction: "Upload Signed NAR1",
      percentage: 0,
      isReadOnly: false,
    });
  });

  it("uploads a current client document, leaves annual-return readiness pending review, and appends activity", () => {
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
    ).toMatchObject({ received: false });
    expect(getClientPortalActivity("ar-delta")[0]).toMatchObject({
      type: "upload-document",
      summary: "Joanna Poon uploaded Signed NAR1.",
    });
  });

  it("blocks a second normal upload while a current document exists", () => {
    expect(
      uploadClientDocument(
        requireCase("ar-delta"),
        "signed-nar1",
        "signed-nar1.pdf",
        "Joanna Poon",
      ),
    ).toMatchObject({ ok: true });

    expect(
      uploadClientDocument(
        requireCase("ar-delta"),
        "signed-nar1",
        "signed-nar1-v2.pdf",
        "Joanna Poon",
      ),
    ).toEqual({
      ok: false,
      reason: "A current document already exists",
    });
    expect(
      getDocumentArchiveRows([requireCase("ar-delta")]).filter(
        (row) => row.requirementId === "signed-nar1" && row.source === "client-portal",
      ),
    ).toHaveLength(1);
  });

  it("resolves canonical cases before document upload and replacement", () => {
    const canonicalCase = requireCase("ar-delta");
    const fabricatedCase = {
      ...canonicalCase,
      id: "ar-missing",
      companyName: "Fabricated Company Limited",
    };

    expect(
      uploadClientDocument(fabricatedCase, "signed-nar1", "orphan.pdf", "Fabricated Contact"),
    ).toEqual({ ok: false, reason: "Case not found" });
    expect(
      replaceClientDocument(fabricatedCase, "signed-nar1", "orphan-v2.pdf", "Fabricated Contact"),
    ).toEqual({ ok: false, reason: "Case not found" });
    expect(getCurrentClientDocument("ar-missing", "signed-nar1")).toBeUndefined();
  });

  it("rejects document review when its canonical case is missing", () => {
    const upload = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );
    if (!upload.ok) throw new Error("Expected fixture upload to succeed");
    removeAnnualReturnCaseForTest("ar-delta");
    const before = getClientPortalSnapshot();

    expect(reviewClientDocument(upload.documentId, "accepted", "Operations")).toEqual({
      ok: false,
      reason: "Case not found",
    });
    expect(getClientPortalSnapshot()).toEqual(before);
  });

  it("rejects stale document mutations after the canonical case becomes read-only", () => {
    const staleCase = requireCase("ar-delta");
    makeDeltaReadyForReceipt();
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    expect(uploadClientDocument(staleCase, "signed-nar1", "stale.pdf", "Joanna Poon")).toEqual({
      ok: false,
      reason: "Filed cases are read-only in the client portal",
    });
    expect(replaceClientDocument(staleCase, "signed-nar1", "stale-v2.pdf", "Joanna Poon")).toEqual({
      ok: false,
      reason: "Filed cases are read-only in the client portal",
    });
  });

  it("replaces rejected documents by superseding the previous upload and keeping both archive rows", () => {
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

  it("reopens annual-return readiness when a rejected required document is replaced", () => {
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
    expect(
      getAnnualReturnCaseById("ar-delta")?.documents.find(
        (document) => document.id === "signed-nar1",
      ),
    ).toMatchObject({ received: false });

    const replacement = replaceClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1-v2.pdf",
      "Joanna Poon",
    );
    if (!replacement.ok) throw new Error("Expected fixture replacement to succeed");

    expect(
      getAnnualReturnCaseById("ar-delta")?.documents.find(
        (document) => document.id === "signed-nar1",
      ),
    ).toMatchObject({
      received: false,
    });
    expect(reviewClientDocument(replacement.documentId, "accepted", "Operations")).toEqual({
      ok: true,
      documentId: replacement.documentId,
    });
    expect(
      getAnnualReturnCaseById("ar-delta")?.documents.find(
        (document) => document.id === "signed-nar1",
      ),
    ).toMatchObject({
      received: true,
    });
  });

  it("scopes client-uploaded archive rows to the requested cases", () => {
    uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
    uploadClientDocument(
      requireCase("ar-crestview"),
      "signed-nar1",
      "crestview-signed.pdf",
      "Samuel Cheng",
    );

    const rows = getDocumentArchiveRows([requireCase("ar-delta")]).filter(
      (row) => row.source === "client-portal",
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseId: "ar-delta",
          filename: "signed-nar1.pdf",
        }),
      ]),
    );
    expect(rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseId: "ar-crestview",
          filename: "crestview-signed.pdf",
        }),
      ]),
    );
  });

  it("rejects invalid replacement inputs without creating archive rows", () => {
    expect(
      replaceClientDocument(requireCase("ar-delta"), "missing-doc", "named.pdf", "Joanna Poon"),
    ).toEqual({
      ok: false,
      reason: "Document requirement not found",
    });
    expect(
      replaceClientDocument(requireCase("ar-delta"), "signed-nar1", "   ", "Joanna Poon"),
    ).toEqual({
      ok: false,
      reason: "Filename is required",
    });

    expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toBeUndefined();
    expect(
      getDocumentArchiveRows([requireCase("ar-delta")]).filter(
        (row) => row.caseId === "ar-delta" && row.source === "client-portal",
      ),
    ).toHaveLength(0);
    expect(getClientPortalActivity("ar-delta")).toHaveLength(0);
  });

  it("records payment acknowledgement without marking payment paid", () => {
    expect(acknowledgePaymentInstructions(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: true,
    });

    expect(requireCase("ar-delta").paymentStatus).toBe("pending");
    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).map((action) => action.id),
    ).not.toContain("action-ar-delta-payment-acknowledgement");
  });

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

  it("derives current payment proof state for read-only AI context", () => {
    expect(getPaymentProofAiContext("ar-delta")).toEqual({ status: "not-uploaded" });

    const upload = uploadPaymentProof(requireCase("ar-delta"), "proof.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");
    expect(
      rejectPaymentProof(upload.proofId, {
        reasonCode: "missing-reference",
        note: "Please include the FPS reference.",
        actor: "Operations",
      }),
    ).toEqual({ ok: true, proofId: upload.proofId });

    expect(getPaymentProofAiContext("ar-delta")).toEqual({
      status: "rejected",
      filename: "proof.png",
      origin: "client-portal",
      reasonLabel: "Transaction reference is missing",
      note: "Please include the FPS reference.",
    });
  });

  it("derives accepted payment proof detail with its reviewer and review time", () => {
    const upload = uploadPaymentProof(requireCase("ar-delta"), "proof.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");
    expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
      ok: true,
      proofId: upload.proofId,
    });

    const proof = getCurrentPaymentProof("ar-delta");
    if (!proof?.reviewedAt) throw new Error("Expected accepted proof review time");

    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).find(
        (action) => action.kind === "payment-proof",
      ),
    ).toMatchObject({
      label: "Payment proof",
      status: "complete",
      detail: expect.stringContaining("proof.png"),
    });
    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).find(
        (action) => action.kind === "payment-proof",
      )?.detail,
    ).toContain("Operations");
    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).find(
        (action) => action.kind === "payment-proof",
      )?.detail,
    ).toContain(proof.reviewedAt);
  });

  it("blocks packet approval until portal-visible documents are uploaded", () => {
    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: false,
      reason:
        "Packet approval blocked: Signed NAR1; Updated significant controller register; Payment proof required",
    });
  });

  it("shows waiting for staff review when uploads are pending review", () => {
    acknowledgePaymentInstructions(requireCase("ar-delta"), "Joanna Poon");
    uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
    uploadClientDocument(requireCase("ar-delta"), "scr", "updated-scr.pdf", "Joanna Poon");
    uploadPaymentProof(requireCase("ar-delta"), "proof.png", "Joanna Poon");

    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).find(
        (action) => action.kind === "packet",
      ),
    ).toMatchObject({ status: "blocked" });
    expect(getClientPortalProgress(requireCase("ar-delta"))).toMatchObject({
      nextAction: "Waiting for staff review",
    });
  });

  it("keeps pending-review uploads non-actionable in the portal contract", () => {
    uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");

    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).find(
        (action) => action.requirementId === "signed-nar1",
      ),
    ).toMatchObject({
      label: "Signed NAR1",
      status: "pending-review",
    });
    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).find(
        (action) => action.requirementId === "signed-nar1",
      ),
    ).not.toHaveProperty("documentAction");
    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).find(
        (action) => action.kind === "document",
      ),
    ).toMatchObject({
      status: "pending-review",
    });
  });

  it("uses the explicit snapshot when deriving packet availability", () => {
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
    acceptDeltaPaymentProof();

    const explicitSnapshot = getClientPortalSnapshot();
    resetClientPortalStoreForTest();

    expect(
      getClientPortalRequiredActions(requireCase("ar-delta"), explicitSnapshot).find(
        (action) => action.kind === "packet",
      ),
    ).toMatchObject({ status: "open" });
    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).find(
        (action) => action.kind === "packet",
      ),
    ).toMatchObject({ status: "blocked" });
  });

  it("approves a packet after portal-visible documents are present", () => {
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
    expect(reviewClientDocument(signed.documentId, "accepted", "Operations")).toEqual({
      ok: true,
      documentId: signed.documentId,
    });
    expect(reviewClientDocument(scr.documentId, "accepted", "Operations")).toEqual({
      ok: true,
      documentId: scr.documentId,
    });
    acceptDeltaPaymentProof();

    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
    expect(getClientPortalActivity("ar-delta")[0]).toMatchObject({
      type: "approve-packet",
      summary: "Joanna Poon approved the filing packet.",
    });
    expect(
      getDocumentArchiveRows([requireCase("ar-delta")]).some(
        (row) => row.id === "archive-ar-delta-client-packet-approval",
      ),
    ).toBe(true);
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

  it("blocks reviewing pending portal uploads after receipt acceptance makes the case read-only", () => {
    makeDeltaReadyForReceipt();
    resetClientPortalStoreForTest();
    const upload = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1-pending.pdf",
      "Joanna Poon",
    );
    if (!upload.ok) throw new Error("Expected fixture upload to succeed");

    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    const row = getDocumentArchiveRows([requireCase("ar-delta")]).find(
      (candidate) => candidate.documentId === upload.documentId,
    );

    expect(row).toMatchObject({
      documentId: upload.documentId,
      status: "uploaded",
      reviewable: false,
      readonly: true,
    });
    expect(reviewClientDocument(upload.documentId, "accepted", "Operations")).toEqual({
      ok: false,
      reason: "Filed cases are read-only in the client portal",
    });
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

  it("keeps one-time actions idempotent after receipt acceptance turns the case read-only", () => {
    acceptDeltaPaymentProof();
    makeDeltaReadyForReceipt();
    expect(acknowledgePaymentInstructions(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: true,
    });
    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    expect(acknowledgePaymentInstructions(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: true,
    });
    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
  });

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
        "Packet approval blocked: Signed NAR1 pending staff review; Updated significant controller register pending staff review; Payment proof required",
    });

    for (const row of getDocumentArchiveRows([requireCase("ar-delta")]).filter(
      (candidate) => candidate.source === "client-portal",
    )) {
      expect(
        reviewClientDocument(row.documentId ?? row.id, "accepted", "Operations"),
      ).toMatchObject({
        ok: true,
      });
    }

    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: false,
      reason: "Packet approval blocked: Payment proof required",
    });
  });

  it("blocks packet approval for missing, pending, and rejected payment proof until staff accepts it", () => {
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

    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: false,
      reason: "Packet approval blocked: Payment proof required",
    });

    const pendingProof = uploadPaymentProof(
      requireCase("ar-delta"),
      "pending-proof.png",
      "Joanna Poon",
    );
    if (!pendingProof.ok) throw new Error("Expected proof upload");
    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: false,
      reason: "Packet approval blocked: Payment proof pending staff review",
    });

    expect(
      rejectPaymentProof(pendingProof.proofId, { reasonCode: "unreadable", actor: "Operations" }),
    ).toEqual({ ok: true, proofId: pendingProof.proofId });
    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: false,
      reason: "Packet approval blocked: Payment proof rejected",
    });

    const acceptedProof = uploadPaymentProof(
      requireCase("ar-delta"),
      "accepted-proof.png",
      "Joanna Poon",
    );
    if (!acceptedProof.ok) throw new Error("Expected replacement proof upload");
    expect(acceptPaymentProof(acceptedProof.proofId, "Operations")).toEqual({
      ok: true,
      proofId: acceptedProof.proofId,
    });
    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
  });

  it("keeps an earlier document review ahead of later open workflow actions", () => {
    const document = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );
    if (!document.ok) throw new Error("Expected document upload");

    expect(getClientPortalProgress(requireCase("ar-delta"))).toMatchObject({
      nextAction: "Waiting for staff review",
    });
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
    acceptDeltaPaymentProof();

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

  it("keeps the old sent draft idempotent after the rejected proof is replaced", () => {
    const upload = uploadPaymentProof(requireCase("ar-delta"), "old.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");
    rejectPaymentProof(upload.proofId, {
      reasonCode: "unreadable",
      actor: "Operations",
    });
    const draft = getPaymentProofFollowUpDrafts([requireCase("ar-delta")])[0];

    expect(sendPaymentProofFollowUpNow(draft.id, "Operations")).toEqual({ ok: true });
    expect(uploadPaymentProof(requireCase("ar-delta"), "new.png", "Joanna Poon")).toMatchObject({
      ok: true,
      supersededProofId: upload.proofId,
    });

    expect(sendPaymentProofFollowUpNow(draft.id, "Operations")).toEqual({
      ok: false,
      reason: "Follow-up already sent",
    });
  });

  it("writes one payment-proof follow-up record, action, and timeline event", () => {
    const upload = uploadPaymentProof(requireCase("ar-delta"), "proof.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");
    rejectPaymentProof(upload.proofId, {
      reasonCode: "missing-reference",
      actor: "Operations",
    });
    const draft = getPaymentProofFollowUpDrafts([requireCase("ar-delta")])[0];

    expect(sendPaymentProofFollowUpNow(draft.id, "Operations")).toEqual({ ok: true });
    expect(sendPaymentProofFollowUpNow(draft.id, "Operations")).toEqual({
      ok: false,
      reason: "Follow-up already sent",
    });

    expect(getClientPortalSnapshot().paymentProofFollowUps).toHaveLength(1);
    expect(
      getClientPortalActivity("ar-delta").filter(
        (action) => action.type === "send-payment-proof-review-follow-up",
      ),
    ).toHaveLength(1);
    expect(timelineLabels("ar-delta", "Payment proof replacement follow-up sent")).toHaveLength(1);
  });

  it("blocks payment-proof follow-up sending after receipt acceptance without mutations", () => {
    const upload = uploadPaymentProof(requireCase("ar-delta"), "proof.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");
    rejectPaymentProof(upload.proofId, {
      reasonCode: "unreadable",
      actor: "Operations",
    });
    const draft = getPaymentProofFollowUpDrafts([requireCase("ar-delta")])[0];

    makeDeltaReadyForReceipt();
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    const before = getClientPortalSnapshot();
    const beforeActions = getClientPortalActivity("ar-delta");
    const beforeTimeline = requireCase("ar-delta").timeline;

    expect(sendPaymentProofFollowUpNow(draft.id, "Operations")).toEqual({
      ok: false,
      reason: "Filed cases are read-only in the client portal",
    });

    expect(getClientPortalSnapshot().paymentProofFollowUps).toEqual(before.paymentProofFollowUps);
    expect(getClientPortalActivity("ar-delta")).toEqual(beforeActions);
    expect(requireCase("ar-delta").timeline).toEqual(beforeTimeline);
  });

  it("blocks replacing accepted required documents", () => {
    const upload = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );
    if (!upload.ok) throw new Error("Expected fixture upload to succeed");

    expect(reviewClientDocument(upload.documentId, "accepted", "Operations")).toEqual({
      ok: true,
      documentId: upload.documentId,
    });

    expect(
      replaceClientDocument(
        requireCase("ar-delta"),
        "signed-nar1",
        "signed-nar1-v2.pdf",
        "Joanna Poon",
      ),
    ).toEqual({
      ok: false,
      reason: "Only rejected documents can be replaced",
    });
    expect(
      getDocumentArchiveRows([requireCase("ar-delta")]).filter(
        (row) => row.requirementId === "signed-nar1" && row.source === "client-portal",
      ),
    ).toHaveLength(1);
  });

  it("allows replacing rejected required documents and supersedes the rejected upload", () => {
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

    const replacement = replaceClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1-v2.pdf",
      "Joanna Poon",
    );

    expect(replacement).toMatchObject({
      ok: true,
      supersededDocumentId: upload.documentId,
    });
    expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toMatchObject({
      filename: "signed-nar1-v2.pdf",
      status: "uploaded",
    });
    expect(
      getDocumentArchiveRows([requireCase("ar-delta")]).filter(
        (row) => row.requirementId === "signed-nar1" && row.source === "client-portal",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: upload.documentId,
          status: "superseded",
        }),
        expect.objectContaining({
          documentId: replacement.ok ? replacement.documentId : undefined,
          status: "uploaded",
        }),
      ]),
    );
  });

  it("rejects invalid document review attempts without changing archive state", () => {
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
    expect(
      reviewClientDocument(replacement.supersededDocumentId, "accepted", "Operations"),
    ).toEqual({
      ok: false,
      reason: "Superseded documents cannot be reviewed",
    });
    expect(reviewClientDocument(replacement.documentId, "accepted", "Operations")).toEqual({
      ok: true,
      documentId: replacement.documentId,
    });
    expect(
      reviewClientDocument(replacement.documentId, {
        decision: "rejected",
        reasonCode: "missing-signature",
        note: "Director signature is missing on page 2.",
        actor: "Operations",
      }),
    ).toEqual({
      ok: false,
      reason: "Document has already been reviewed",
    });
  });

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
    expect(
      attachPaymentProof(requireCase("ar-delta"), "fps-staff.png", "Operations"),
    ).toMatchObject({
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
      getClientPortalActivity("ar-delta").filter(
        (action) => action.type === "accept-payment-proof",
      ),
    ).toHaveLength(1);
  });

  it("commits accepted proof and annual-return readiness before either store notifies", () => {
    const upload = uploadPaymentProof(requireCase("ar-delta"), "fps.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");

    const observations: Array<{
      proofStatus: string | undefined;
      paymentStatus: string | undefined;
      proofChecked: boolean | undefined;
    }> = [];
    const observe = () => {
      const caseItem = getAnnualReturnCaseById("ar-delta");
      observations.push({
        proofStatus: getCurrentPaymentProof("ar-delta")?.status,
        paymentStatus: caseItem?.paymentStatus,
        proofChecked: caseItem?.packetRequirements.find(
          (requirement) => requirement.id === "payment-proof-checked",
        )?.complete,
      });
    };
    const unsubscribeAnnualReturns = subscribeAnnualReturnCasesForTest(observe);
    const unsubscribePortal = subscribeClientPortalStoreForTest(observe);

    expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
      ok: true,
      proofId: upload.proofId,
    });

    unsubscribeAnnualReturns();
    unsubscribePortal();
    expect(observations.length).toBeGreaterThanOrEqual(2);
    expect(observations).toEqual(
      observations.map(() => ({
        proofStatus: "accepted",
        paymentStatus: "paid",
        proofChecked: true,
      })),
    );
  });

  it("treats repeated acceptance of the accepted current proof as a successful no-op", () => {
    const upload = uploadPaymentProof(requireCase("ar-delta"), "fps.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");
    expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
      ok: true,
      proofId: upload.proofId,
    });
    const activityCount = getClientPortalActivity("ar-delta").filter(
      (action) => action.type === "accept-payment-proof",
    ).length;
    const timelineCount = requireCase("ar-delta").timeline.filter(
      (event) => event.label === "Payment proof accepted",
    ).length;

    expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
      ok: true,
      proofId: upload.proofId,
    });
    expect(
      getClientPortalActivity("ar-delta").filter(
        (action) => action.type === "accept-payment-proof",
      ),
    ).toHaveLength(activityCount);
    expect(
      requireCase("ar-delta").timeline.filter((event) => event.label === "Payment proof accepted"),
    ).toHaveLength(timelineCount);
  });

  it("reconciles annual payment state when the accepted proof is accepted again", () => {
    const upload = uploadPaymentProof(requireCase("ar-delta"), "fps.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");
    expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
      ok: true,
      proofId: upload.proofId,
    });

    updatePaymentStatus("ar-delta", "pending");
    togglePacketRequirement("ar-delta", "payment-proof-checked");
    expect(requireCase("ar-delta").paymentStatus).toBe("pending");
    expect(
      requireCase("ar-delta").packetRequirements.find(
        (requirement) => requirement.id === "payment-proof-checked",
      )?.complete,
    ).toBe(false);

    expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
      ok: true,
      proofId: upload.proofId,
    });
    expect(requireCase("ar-delta").paymentStatus).toBe("paid");
    expect(
      requireCase("ar-delta").packetRequirements.find(
        (requirement) => requirement.id === "payment-proof-checked",
      )?.complete,
    ).toBe(true);
    expect(
      requireCase("ar-delta").timeline.filter((event) => event.label === "Payment proof accepted"),
    ).toHaveLength(1);
    expect(
      getClientPortalActivity("ar-delta").filter(
        (action) => action.type === "accept-payment-proof",
      ),
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

    expect(
      rejectPaymentProof(upload.proofId, { reasonCode: "other", actor: "Operations" }),
    ).toEqual({
      ok: false,
      reason: "Review note is required when reason is Other",
    });
    expect(acceptPaymentProof("missing-proof", "Operations")).toEqual({
      ok: false,
      reason: "Payment proof not found",
    });
  });

  it("blocks a stale retained case from uploading proof after receipt acceptance", () => {
    const staleCase = requireCase("ar-delta");
    makeDeltaReadyForReceipt();
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    expect(uploadPaymentProof(staleCase, "stale-upload.png", "Joanna Poon")).toEqual({
      ok: false,
      reason: "Filed cases are read-only in the client portal",
    });
  });

  it("blocks a stale retained case from attaching proof after receipt acceptance", () => {
    const staleCase = requireCase("ar-delta");
    makeDeltaReadyForReceipt();
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    expect(attachPaymentProof(staleCase, "stale-attachment.png", "Operations")).toEqual({
      ok: false,
      reason: "Filed cases are read-only in the client portal",
    });
  });

  it("rejects payment proof creation for a fabricated missing case", () => {
    const fabricatedCase = {
      ...requireCase("ar-delta"),
      id: "ar-missing",
      companyName: "Fabricated Company Limited",
    };

    expect(uploadPaymentProof(fabricatedCase, "orphan-upload.png", "Joanna Poon")).toEqual({
      ok: false,
      reason: "Case not found",
    });
    expect(attachPaymentProof(fabricatedCase, "orphan-attachment.png", "Operations")).toEqual({
      ok: false,
      reason: "Case not found",
    });
    expect(getPaymentProofsForCase("ar-missing")).toEqual([]);
  });

  it("uses canonical case metadata and default actor for payment proof uploads", () => {
    const canonicalCase = requireCase("ar-delta");
    const tamperedCase = {
      ...canonicalCase,
      companyName: "Fabricated Company Limited",
      contactName: "Fabricated Contact",
    };

    expect(uploadPaymentProof(tamperedCase, "canonical.png")).toMatchObject({ ok: true });
    expect(getCurrentPaymentProof("ar-delta")).toMatchObject({
      companyName: canonicalCase.companyName,
      contactName: canonicalCase.contactName,
      uploadedBy: canonicalCase.contactName,
    });
  });

  it("blocks accepting or rejecting a superseded payment proof", () => {
    const upload = uploadPaymentProof(requireCase("ar-delta"), "blurred.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");
    expect(
      rejectPaymentProof(upload.proofId, {
        reasonCode: "unreadable",
        actor: "Operations",
      }),
    ).toEqual({ ok: true, proofId: upload.proofId });

    expect(uploadPaymentProof(requireCase("ar-delta"), "clear.png", "Joanna Poon")).toMatchObject({
      ok: true,
      supersededProofId: upload.proofId,
    });
    expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
      ok: false,
      reason: "Payment proof is not current",
    });
    expect(
      rejectPaymentProof(upload.proofId, {
        reasonCode: "unreadable",
        actor: "Operations",
      }),
    ).toEqual({
      ok: false,
      reason: "Payment proof is not current",
    });
  });
});
